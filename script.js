class AsistenteVozFormulario {
    constructor() {
        this.recognition = null;
        this.isRecording = false;
        this.currentData = null;
        this.API_URL = 'http://localhost:5000/extract'; // <--- URL de tu API REST
        this.initializeElements();
        this.initializeSpeechRecognition();
        this.setupEventListeners();
        this.addLog('Sistema inicializado correctamente', 'info');
    }

    initializeElements() {
        this.elements = {
            startBtn: document.getElementById('startRecording'),
            confirmBtn: document.getElementById('confirmData'),
            correctBtn: document.getElementById('correctData'),
            status: document.getElementById('status'),
            confidence: document.getElementById('confidence'),
            form: document.getElementById('productForm'),
            confirmationPanel: document.getElementById('confirmationPanel'),
            confirmationData: document.getElementById('confirmationData'),
            confirmYes: document.getElementById('confirmYes'),
            confirmNo: document.getElementById('confirmNo'),
            activityLog: document.getElementById('activityLog')
        };
    }

    initializeSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            this.recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'es-ES';
            this.recognition.maxAlternatives = 3;

            this.recognition.onstart = () => {
                this.isRecording = true;
                this.updateStatus('Escuchando...', 'recording');
                this.addLog('Grabación de audio iniciada', 'info');
            };

            this.recognition.onresult = (event) => {
                this.handleRecognitionResult(event);
            };

            this.recognition.onerror = (event) => {
                this.handleRecognitionError(event);
            };

            this.recognition.onend = () => {
                this.isRecording = false;
                this.elements.startBtn.disabled = false;
                this.elements.startBtn.innerHTML = '🎤 Iniciar Grabación';
            };
        } else {
            this.addLog('Error: Navegador no compatible con reconocimiento de voz', 'error');
            alert('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
        }
    }

    setupEventListeners() {
        this.elements.startBtn.addEventListener('click', () => this.startRecording());
        this.elements.confirmBtn.addEventListener('click', () => this.showConfirmation());
        this.elements.correctBtn.addEventListener('click', () => this.enableManualCorrection());
        this.elements.confirmYes.addEventListener('click', () => this.confirmAndSave());
        this.elements.confirmNo.addEventListener('click', () => this.repeatRecording());
        
        // Validación en tiempo real para corrección manual
        Object.keys(this.getValidationRules()).forEach(field => {
            const input = document.getElementById(field);
            if (input) {
                // Al salir de un campo, validamos y actualizamos currentData
                input.addEventListener('blur', () => {
                    this.validateField(field);
                    this.updateCurrentDataFromForm();
                });
            }
        });
    }

    // NUEVA FUNCIÓN: Actualiza currentData con los valores actuales del formulario
    updateCurrentDataFromForm() {
        const fields = this.getFieldsToExtract();
        const updatedData = {};
        let allValid = true;

        fields.forEach(field => {
            const input = document.getElementById(field);
            if (input) {
                // Validación estricta para números/precios
                if (input.type === 'number') {
                    updatedData[field] = parseFloat(input.value) || null;
                } else {
                    updatedData[field] = input.value.trim() || null;
                }
                
                // Si la validación del campo falla, marcamos el formulario como no válido
                if (!this.validateField(field)) {
                    allValid = false;
                }
            }
        });
        
        this.currentData = updatedData;

        // Si estamos en corrección manual, actualiza el estado del botón Confirmar
        if (!this.elements.correctBtn.disabled) {
            this.elements.confirmBtn.disabled = !allValid;
        }

        return allValid;
    }

    // Define los campos que siempre intentaremos extraer
    getFieldsToExtract() {
        return ['nombre', 'categoria', 'cantidad', 'precio_compra', 'precio_venta'];
    }

    async startRecording() {
        if (!this.recognition) {
            this.addLog('Error: Reconocimiento de voz no disponible', 'error');
            return;
        }

        try {
            this.elements.startBtn.disabled = true;
            this.elements.startBtn.innerHTML = '⏹️ Detener';
            this.clearForm();
            this.recognition.start();
        } catch (error) {
            this.addLog(`Error al iniciar grabación: ${error.message}`, 'error');
            this.handleError(error);
        }
    }

    async handleRecognitionResult(event) {
        this.updateStatus('Procesando audio...', 'processing');
        
        const alternatives = Array.from(event.results[0])
            .map(result => ({ transcript: result.transcript, confidence: result.confidence }))
            .sort((a, b) => b.confidence - a.confidence);

        const bestMatch = alternatives[0];
        this.elements.confidence.textContent = `Confianza: ${(bestMatch.confidence * 100).toFixed(1)}%`;

        this.addLog(`Texto reconocido: "${bestMatch.transcript}" (${(bestMatch.confidence * 100).toFixed(1)}% confianza)`, 'info');

        try {
            // Llama a la API de Python para la extracción
            const processedData = await this.procesarConIA(bestMatch.transcript);
            
            // La validación en el cliente es clave
            if (this.validarDatos(processedData)) {
                this.currentData = processedData;
                this.llenarFormulario(processedData);
                this.updateStatus('Datos extraídos correctamente', 'success');
                this.enableActionButtons(true);
                this.addLog('Datos procesados y validados correctamente', 'success');
            } else {
                // Si la data no es válida, permitimos corrección manual
                this.currentData = processedData;
                this.llenarFormulario(processedData);
                this.updateStatus('Advertencia: Datos incompletos o inválidos. Corrija manualmente.', 'warning');
                this.enableActionButtons(true); // Permitir corrección
                this.addLog('Datos incompletos/inválidos. Habilitando corrección manual.', 'warning');
                this.elements.confirmBtn.disabled = true; // Deshabilitar confirmación automática si es inválido
            }
        } catch (error) {
            this.addLog(`Error en la API de procesamiento: ${error.message}`, 'error');
            this.handleError(error);
        }
    }

    handleRecognitionError(event) {
        const errorMap = {
            'no-speech': 'No se detectó voz',
            'audio-capture': 'No se pudo acceder al micrófono',
            'network': 'Error de red',
            'not-allowed': 'Permiso de micrófono denegado'
        };

        const errorMessage = errorMap[event.error] || `Error desconocido: ${event.error}`;
        this.addLog(`Error de reconocimiento: ${errorMessage}`, 'error');
        
        this.updateStatus(`Error: ${errorMessage}`, 'error');
        this.elements.startBtn.disabled = false;
        this.elements.startBtn.innerHTML = '🎤 Reintentar';
    }

    // ----------------------------------------------------------------------------------
    // FUNCIÓN CRÍTICA: Llama a tu API de Python
    // ----------------------------------------------------------------------------------
    async procesarConIA(texto) {
        this.addLog(`Enviando a API REST (${this.API_URL})...`, 'info');
        
        // La lista de campos a extraer que tu API de Python espera
        const fieldsToExtract = this.getFieldsToExtract(); 

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: texto,
                    fields: fieldsToExtract 
                })
            });

            if (!response.ok) {
                // Manejar errores HTTP (400, 500, etc.)
                const errorBody = await response.json();
                throw new Error(errorBody.error || `Error HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.success) {
                // Retorna los datos extraídos por la API de Python
                return result.data;
            } else {
                throw new Error(result.error || 'La API devolvió un resultado no exitoso.');
            }

        } catch (error) {
            this.addLog(`Fallo al conectar o procesar con la API: ${error.message}`, 'error');
            // Retorna un objeto vacío en caso de error para no detener la aplicación
            return {}; 
        }
    }
    // ----------------------------------------------------------------------------------

    getValidationRules() {
        return {
            nombre: { required: true, type: 'string', minLength: 2 },
            categoria: { required: false, type: 'string', minLength: 2 }, // La categoría no siempre es requerida al dictar
            cantidad: { required: true, type: 'number', min: 1 },
            precio_compra: { required: true, type: 'number', min: 0 },
            precio_venta: { required: true, type: 'number', min: 0 }
        };
    }

    // Mantiene la validación del backend pero usa la data ya parseada
    validarDatos(data) {
        const rules = this.getValidationRules();
        let isValid = true;

        for (const [field, rule] of Object.entries(rules)) {
            const value = data[field];
            
            // 1. Requerido
            if (rule.required && (!value || value.toString().trim() === '' || value === 'null')) {
                // Un valor "null" de la API cuenta como inválido para campos requeridos
                this.addLog(`Campo requerido faltante: ${field}`, 'warning');
                isValid = false;
                continue;
            }

            // 2. Tipo y Mínimo
            if (value && value.toString().trim() !== '') {
                if (rule.type === 'number') {
                    const numValue = parseFloat(value);
                    if (isNaN(numValue) || (rule.min !== undefined && numValue < rule.min)) {
                        this.addLog(`Valor inválido o fuera de rango para ${field}: ${value}`, 'warning');
                        isValid = false;
                    }
                } else if (rule.type === 'string' && rule.minLength && value.length < rule.minLength) {
                    this.addLog(`${field} demasiado corto: ${value}`, 'warning');
                    isValid = false;
                }
            }
        }
        
        // 3. Validación de Negocio: precio venta > precio compra
        if (data.precio_venta && data.precio_compra) {
            const precioVenta = parseFloat(data.precio_venta);
            const precioCompra = parseFloat(data.precio_compra);
            
            if (precioVenta <= precioCompra && precioVenta > 0) { // Permitimos 0 si es solo advertencia
                this.addLog('Advertencia: Precio de venta debería ser mayor al de compra', 'warning');
            }
        }

        return isValid;
    }
    
    // ... (El resto de funciones se mantienen iguales o con pequeños ajustes para la robustez) ...

    validateField(fieldName) {
        const input = document.getElementById(fieldName);
        const errorElement = document.getElementById(`error-${fieldName}`);
        const rules = this.getValidationRules()[fieldName];
        const value = input.value.trim();

        let isValid = true;
        let errorMessage = '';

        if (rules.required && (!value || value === '')) {
            isValid = false;
            errorMessage = 'Este campo es requerido';
        } else if (value) {
            if (rules.type === 'number') {
                const numValue = parseFloat(value);
                if (isNaN(numValue)) {
                    isValid = false;
                    errorMessage = 'Debe ser un número válido';
                } else if (rules.min !== undefined && numValue < rules.min) {
                    isValid = false;
                    errorMessage = `El valor mínimo es ${rules.min}`;
                }
            } else if (rules.type === 'string' && rules.minLength && value.length < rules.minLength) {
                isValid = false;
                errorMessage = `Mínimo ${rules.minLength} caracteres`;
            }
        }

        // Actualizar UI
        if (isValid) {
            input.classList.remove('error');
            errorMessage = '';
        } else {
            input.classList.add('error');
        }

        errorElement.textContent = errorMessage;

        // Validación de negocio solo al final, si ambos campos son válidos
        if (fieldName === 'precio_venta' || fieldName === 'precio_compra') {
            const pv = parseFloat(document.getElementById('precio_venta').value);
            const pc = parseFloat(document.getElementById('precio_compra').value);
            
            if (!isNaN(pv) && !isNaN(pc) && pv <= pc && pv > 0) {
                 // Si la venta es menor o igual a la compra, es un error de negocio (no fatal)
                 if (fieldName === 'precio_venta') {
                     errorElement.textContent = 'Advertencia: Venta menor o igual a compra.';
                     input.classList.add('error');
                 }
            }
        }
        
        return isValid;
    }
    
    llenarFormulario(data) {
        Object.keys(data).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                // Limpiamos $ y , para que los inputs tipo number los acepten
                let value = data[key] || '';
                if (typeof value === 'string') {
                    value = value.replace('$', '').replace(',', '').trim();
                }

                // Si el valor es "null" o una cadena vacía, no llenamos
                element.value = (value === 'null' || value === '') ? '' : value;
                this.validateField(key); // Validar inmediatamente después de llenar
            }
        });
    }

    clearForm() {
        const fields = ['nombre', 'categoria', 'cantidad', 'precio_compra', 'precio_venta'];
        fields.forEach(field => {
            const element = document.getElementById(field);
            if (element) {
                element.value = '';
                element.classList.remove('error');
                document.getElementById(`error-${field}`).textContent = '';
            }
        });
        this.enableActionButtons(false);
        this.hideConfirmationPanel();
        this.currentData = null; // Limpiar la data actual
    }

    enableActionButtons(enabled) {
        this.elements.confirmBtn.disabled = !enabled;
        this.elements.correctBtn.disabled = !enabled;
    }

    showConfirmation() {
        // Obtenemos la data FINAL (ya sea extraída o corregida manualmente)
        const finalData = this.currentData || {};

        if (!this.validarDatos(finalData)) {
            this.addLog('Error: No se puede mostrar confirmación. Hay datos inválidos/faltantes.', 'error');
            this.updateStatus('Corrija los datos antes de confirmar', 'error');
            return;
        }

        const confirmationHTML = `
            <div class="confirmation-data-item"><strong>Producto:</strong> ${finalData.nombre || 'No especificado'}</div>
            <div class="confirmation-data-item"><strong>Categoría:</strong> ${finalData.categoria || 'No especificado'}</div>
            <div class="confirmation-data-item"><strong>Cantidad:</strong> ${finalData.cantidad || 'No especificado'}</div>
            <div class="confirmation-data-item"><strong>Precio Compra:</strong> $${parseFloat(finalData.precio_compra || 0).toFixed(2)}</div>
            <div class="confirmation-data-item"><strong>Precio Venta:</strong> $${parseFloat(finalData.precio_venta || 0).toFixed(2)}</div>
        `;

        this.elements.confirmationData.innerHTML = confirmationHTML;
        this.elements.confirmationPanel.classList.remove('hidden');
        this.addLog('Panel de confirmación mostrado', 'info');
    }

    hideConfirmationPanel() {
        this.elements.confirmationPanel.classList.add('hidden');
    }

    confirmAndSave() {
        // Asegurarse de usar la data más actual del formulario
        if (!this.updateCurrentDataFromForm()) {
            this.addLog('Error: Datos inválidos no pueden ser guardados', 'error');
            alert('Por favor, corrige los errores antes de guardar.');
            return;
        }

        // Simular guardado en base de datos
        this.addLog('Guardando datos en la base de datos...', 'info');
        
        // Aquí iría tu lógica real de guardado (ej. fetch a un endpoint /save)
        setTimeout(() => {
            this.addLog('✅ Producto guardado exitosamente', 'success');
            this.updateStatus('Producto guardado correctamente', 'success');
            this.hideConfirmationPanel();
            this.clearForm();
            
            console.log('Datos guardados:', this.currentData);
        }, 1000);
    }

    repeatRecording() {
        this.hideConfirmationPanel();
        this.startRecording();
        this.addLog('Regrabación solicitada por el usuario', 'info');
    }

    enableManualCorrection() {
        this.hideConfirmationPanel();
        
        // Habilitar todos los campos para edición
        const fields = this.getFieldsToExtract();
        fields.forEach(field => {
            const element = document.getElementById(field);
            if (element) {
                element.disabled = false;
                // Al entrar en modo corrección, asegurarse de que la data actual sea la del form
                this.updateCurrentDataFromForm();
            }
        });

        // Asegurarse de que el botón de Confirmar refleje el estado de validación del formulario
        this.elements.confirmBtn.disabled = !this.updateCurrentDataFromForm(); 
        this.addLog('Corrección manual habilitada', 'info');
        this.updateStatus('Modo corrección manual activado', 'processing');
    }
    
    // ... (updateStatus, addLog, handleError se mantienen iguales) ...

    updateStatus(message, type = '') {
        this.elements.status.textContent = message;
        this.elements.status.className = `status ${type}`;
    }

    addLog(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        
        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${message}`;
        
        this.elements.activityLog.appendChild(logEntry);
        this.elements.activityLog.scrollTop = this.elements.activityLog.scrollHeight;
    }

    handleError(error) {
        console.error('Error del sistema:', error);
        this.addLog(`Error: ${error.message}`, 'error');
        this.updateStatus('Error en el sistema', 'error');
        
        this.elements.startBtn.disabled = false;
        this.elements.startBtn.innerHTML = '🎤 Reintentar';
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new AsistenteVozFormulario();
});