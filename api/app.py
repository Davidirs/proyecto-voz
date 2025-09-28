import re
import json
from flask import Flask, request, jsonify
from flask_graphql import GraphQLView
from graphene import ObjectType, String, List, Field, Schema, Mutation, Boolean, Int, InputObjectType
from flask_cors import CORS
from openai import OpenAI
import os
from dotenv import load_dotenv

client = OpenAI(api_key="TU_API_KEY_AQUI")

# 🔹 Cargar variables del archivo .env
load_dotenv()

# 🔹 Crear cliente con la API key
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
def extract_fields(text: str, fields: list[str], model: str = "gpt-5-nano"):
    """
    Extrae información estructurada desde texto usando OpenAI.
    Devuelve un diccionario con los campos solicitados.
    """
    prompt = f"""
Extrae del siguiente texto los valores correspondientes a los campos solicitados.
Devuelve únicamente un JSON con los campos como claves y sus valores como texto plano.

Texto:
{text}

Campos a extraer: {fields}

Reglas:
- Si no encuentras un campo, devuélvelo con valor vacío.
- No incluyas texto adicional fuera del JSON.
"""

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Eres un asistente que extrae datos de texto de manera precisa."},
            {"role": "user", "content": prompt}
        ],
        response_format={"type": "json_object"}  # 🔹 Garantiza JSON válido
    )

    data = json.loads(response.choices[0].message.content)

    # Construir la respuesta estándar
    result = {
        "data": data,
        "success": True,
        "totalFields": len(fields),
        "extractedFields": sum(1 for v in data.values() if str(v).strip() != ""),
    }

    return result

# ------------------------------------------------------------------------------
# 2. CONFIGURACIÓN DE FLASK Y ENDPOINT REST
# ------------------------------------------------------------------------------

app = Flask(__name__)
CORS(app) # Habilita CORS en toda la aplicación

# Endpoint REST: /extract
@app.route('/extract', methods=['POST'])
def rest_extract():
    """Maneja las peticiones REST para la extracción de texto."""
    
    if not request.is_json:
        return jsonify({"success": False, "error": "Content-Type debe ser 'application/json'"}), 400

    # MEJORA: Usa silent=True para evitar un 500 si el JSON es inválido o vacío.
    data = request.get_json(silent=True) 
    
    if data is None:
        # Respuesta clara si el JSON es inválido (aunque el Content-Type sea correcto)
        return jsonify({"success": False, "error": "Petición JSON inválida o vacía. Asegúrate de que el formato JSON sea correcto."}), 400

    text = data.get('text')
    fields = data.get('fields')

    if not text or not fields:
        return jsonify({"success": False, "error": "Se requieren 'text' y 'fields' en el cuerpo de la petición."}), 400

    try:
        extracted_data = extract_fields(text, fields)
        return extracted_data, 200
    except Exception as e:
        # Registra el error interno para debugging en producción
        app.logger.error(f"Error en el procesamiento REST: {e}") 
        return jsonify({"success": False, "error": "Error interno de procesamiento en el servidor."}), 500

# ------------------------------------------------------------------------------
# 3. CONFIGURACIÓN DE GRAPHQL (CORREGIDA)
# ------------------------------------------------------------------------------

class FieldInput(InputObjectType):
    name = String(required=True)
    type = String()
    pattern = String()

class ExtractionResult(ObjectType):
    success = Boolean()
    data = String() 
    extractedFields = Int()
    totalFields = Int()
    error = String()

class ExtractInformation(Mutation):
    class Arguments:
        text = String(required=True)
        fields = List(FieldInput, required=True)

    Output = ExtractionResult

    def mutate(root, info, text, fields):
        try:
            # 🔹 Extraer solo los nombres de los campos (si vienen como objetos FieldInput)
            field_names = [f.name for f in fields]

            # 🔹 Ejecutar extracción
            extracted_data = extract_fields(text, field_names)

            # 🔹 Convertir el resultado a string JSON
            data_str = json.dumps(extracted_data["data"], ensure_ascii=False)

            return ExtractionResult(
                success=extracted_data["success"],
                data=data_str,
                totalFields=extracted_data["totalFields"],
                extractedFields=extracted_data["extractedFields"],
                error=None
            )

        except Exception as e:
            app.logger.error(f"Error en el procesamiento GraphQL: {e}")
            return ExtractionResult(
                success=False,
                data="{}",
                totalFields=0,
                extractedFields=0,
                error=str(e)
            )


# Define el tipo principal de Mutación
class MutationType(ObjectType):
    extract_information = ExtractInformation.Field()

# Crea el Esquema GraphQL
schema = Schema(mutation=MutationType)

# Endpoint GraphQL: /graphql
app.add_url_rule(
    '/graphql',
    view_func=GraphQLView.as_view(
        'graphql',
        schema=schema,
        graphiql=True 
    )
)

# ------------------------------------------------------------------------------
# 4. FUNCIÓN PARA PRUEBAS LOCALES
# ------------------------------------------------------------------------------

def run_local():
    """Función auxiliar para ejecutar la aplicación localmente."""
    print("Iniciando Flask en modo local...")
    # debug=True es ideal para desarrollo local
    app.run(host='0.0.0.0', port=5000, debug=True)

if __name__ == '__main__':
    run_local()