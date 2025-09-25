import re
import json
from flask import Flask, request, jsonify
from flask_graphql import GraphQLView
from graphene import ObjectType, String, List, Field, Schema, Mutation, Boolean, Int, InputObjectType
from flask_cors import CORS

# ------------------------------------------------------------------------------
# 1. LÓGICA CENTRAL DE EXTRACCIÓN
# ------------------------------------------------------------------------------

# Patrones Regex básicos para tipos comunes (usados por defecto)
DEFAULT_PATTERNS = {
    "email": r"[\w\.-]+@[\w\.-]+\.\w+",
    "date": r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}",
    # Captura patrones de moneda flexibles
    "currency": r"\$?\s*\d{1,3}(?:[.,]?\d{3})*(?:[.,]\d{2})?",
    "phone": r"(\+?\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}",
    "number": r"\b\d+(\.\d+)?\b",
    "string": None
}

# Patrones Regex Específicos para el Dominio de Productos
PRODUCT_PATTERNS = {
    # CRÍTICO: Captura el número antes (\d+)[\s:]*unidades (group 1) O después unidades[\s:]*(\d+) (group 2).
    "cantidad": r"(\d+)[\s:]*(?:cantidad|unidades|pzas?)\b|\b(?:cantidad|unidades|pzas?)[\s:]*(\d+)",
    
    # CRÍTICO: Usa .*? (captura perezosa) para ignorar texto/símbolos intermedios y captura el patrón numérico flexible.
    "precio_compra": r"(?:precio de compra|compra|costo).*?(\$?\s*\d+(?:[.,]\d{1,2})?)",
    "precio_venta": r"(?:precio de venta|venta).*?(\$?\s*\d+(?:[.,]\d{1,2})?)"
}


def extract_data_from_text(text: str, fields: list) -> dict:
    """Procesa el texto para extraer los campos solicitados."""
    extracted_data = {}

    for field in fields:
        value = None
        
        # Manejo seguro de la entrada (dict es común en GraphQL, str en REST simple)
        if isinstance(field, str):
            field_name = field
            field_type = 'string'
            field_pattern = None
        elif isinstance(field, dict):
            field_name = field.get('name')
            field_type = field.get('type', 'string')
            field_pattern = field.get('pattern')
        else:
            continue

        if not field_name:
            continue
        
        field_name_lower = field_name.lower()

        # 1. Usar patrón explícito del usuario (mayor prioridad)
        if field_pattern:
            match = re.search(field_pattern, text, re.IGNORECASE)
            if match:
                # Usa group(1) si hay grupos, sino group(0)
                value = match.group(1).strip() if match.groups() else match.group(0).strip()
        
        # 2. Usar patrón específico para campos de producto (e.g., cantidad, precio_venta)
        elif field_name_lower in PRODUCT_PATTERNS:
            pattern = PRODUCT_PATTERNS[field_name_lower]
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                if field_name_lower == "cantidad":
                    # Lógica CRÍTICA: Usa group(1) o group(2) debido a la Regex de OR (|) para cantidad
                    value = match.group(1) or match.group(2)
                else:
                    # Precios usan solo group(1)
                    value = match.group(1).strip()

        # 3. Usar patrón por defecto (regex) si el tipo es conocido (e.g., email, date, currency)
        elif field_type in DEFAULT_PATTERNS and DEFAULT_PATTERNS[field_type]:
            pattern = DEFAULT_PATTERNS[field_type]
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = match.group(0).strip()
        
        # 4. Extracción de string por palabra clave (para 'nombre', 'categoria')
        elif field_type.lower() == 'string' and field_name_lower in ['nombre', 'categoria', 'producto']:
            
            # Lógica para Nombre/Producto (Más robusta para GraphQL y REST)
            if field_name_lower in ['nombre', 'producto']:
                
                # Opción A (REST): Capturar texto después de una palabra clave de producto/nombre (e.g., "producto 'Mouse Optico'")
                match_a = re.search(
                    r"(?:producto|nombre|articulo|se\s+llama|es\s+un)[\s:]*['\"]?(.+?)['\"]?(?:[.,]|\Z|cantidad|categor[ií]a|precio)", 
                    text, 
                    re.IGNORECASE | re.DOTALL
                )

                # Opción B (CRÍTICO para GraphQL): Capturar texto entre la cantidad y el primer precio/costo.
                match_b = re.search(
                    r"(?:\d+\s*(?:cantidad|unidades|pzas?)\s+(?:de\s+)?)(.+?)(?=[\.,]|\Z|costo|precio)",
                    text,
                    re.IGNORECASE | re.DOTALL
                )
                
                if match_a:
                    value = match_a.group(1)
                elif match_b:
                    value = match_b.group(1)

                if value:
                    # Limpiamos el valor capturado
                    value = value.strip().strip('\'"').strip()

            # Lógica para Categoría (se mantiene)
            elif field_name_lower == 'categoria':
                match = re.search(r"(?:categor[ií]a|tipo)[\s:]*(.+?)(?=,|\.|$|cantidad|precio)", text, re.IGNORECASE)
                if match:
                    value = match.group(1).strip()
        
        extracted_data[field_name] = value

    return extracted_data

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

    data = request.get_json()
    text = data.get('text')
    fields = data.get('fields')

    if not text or not fields:
        return jsonify({"success": False, "error": "Se requieren 'text' y 'fields' en el cuerpo de la petición."}), 400

    try:
        extracted_data = extract_data_from_text(text, fields)
        return jsonify({
            "success": True,
            "data": extracted_data,
            "totalFields": len(fields),
            "extractedFields": sum(1 for v in extracted_data.values() if v is not None)
        }), 200
    except Exception as e:
        # Registra el error interno en la consola del servidor
        app.logger.error(f"Error en el procesamiento REST: {e}")
        return jsonify({"success": False, "error": f"Error interno de procesamiento: {str(e)}"}), 500


# ------------------------------------------------------------------------------
# 3. CONFIGURACIÓN DE GRAPHQL
# ------------------------------------------------------------------------------

# Define el tipo de entrada para los campos (usado en la mutación)
class FieldInput(InputObjectType):
    name = String(required=True)
    type = String()
    pattern = String()

# Define el tipo de respuesta para la mutación
class ExtractionResult(ObjectType):
    success = Boolean()
    data = String() 
    extractedFields = Int()
    totalFields = Int()
    error = String()

# Define la Mutación 
class ExtractInformation(Mutation):
    class Arguments:
        text = String(required=True)
        fields = List(FieldInput, required=True)

    Output = ExtractionResult

    def mutate(root, info, text, fields):
        try:
            extracted_data = extract_data_from_text(text, fields)
            data_str = json.dumps(extracted_data)
            success = True
            error = None

        except Exception as e:
            app.logger.error(f"Error en el procesamiento GraphQL: {e}")
            data_str = "{}"
            success = False
            error = str(e)

        return ExtractionResult(
            success=success,
            data=data_str,
            totalFields=len(fields),
            extractedFields=sum(1 for v in extracted_data.values() if v is not None),
            error=error
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
# 4. INICIO DE LA APLICACIÓN
# ------------------------------------------------------------------------------

if __name__ == '__main__':
    # Se recomienda usar host='0.0.0.0' para asegurar la accesibilidad si no usas localhost exacto
    app.run(host='0.0.0.0', port=5000)


