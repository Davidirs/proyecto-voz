class AsistenteVozFormulario {
    constructor() {
        this.recognition = null;
        this.isRecording = false;
        this.currentData = null;
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
                input.addEventListener('blur', () => this.validateField(field));
            }
        });
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
            const processedData = await this.procesarConIA(bestMatch.transcript);
            if (this.validarDatos(processedData)) {
                this.currentData = processedData;
                this.llenarFormulario(processedData);
                this.updateStatus('Datos extraídos correctamente', 'success');
                this.enableActionButtons(true);
                this.addLog('Datos procesados y validados correctamente', 'success');
            } else {
                throw new Error('Datos insuficientes o inválidos');
            }
        } catch (error) {
            this.addLog(`Error en procesamiento: ${error.message}`, 'error');
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

    getValidationRules() {
        return {
            nombre: { required: true, type: 'string', minLength: 2 },
            categoria: { required: true, type: 'string', minLength: 2 },
            cantidad: { required: true, type: 'number', min: 1 },
            precio_compra: { required: true, type: 'number', min: 0 },
            precio_venta: { required: true, type: 'number', min: 0 }
        };
    }

    validarDatos(data) {
        const rules = this.getValidationRules();
        let isValid = true;

        for (const [field, rule] of Object.entries(rules)) {
            if (rule.required && (!data[field] || data[field].toString().trim() === '')) {
                this.addLog(`Campo requerido faltante: ${field}`, 'warning');
                isValid = false;
                continue;
            }

            if (data[field]) {
                if (rule.type === 'number') {
                    const value = parseFloat(data[field]);
                    if (isNaN(value) || (rule.min !== undefined && value < rule.min)) {
                        this.addLog(`Valor inválido para ${field}: ${data[field]}`, 'warning');
                        isValid = false;
                    }
                } else if (rule.type === 'string' && rule.minLength && data[field].length < rule.minLength) {
                    this.addLog(`${field} demasiado corto: ${data[field]}`, 'warning');
                    isValid = false;
                }
            }
        }

        // Validación adicional: precio venta > precio compra
        if (data.precio_venta && data.precio_compra) {
            const precioVenta = parseFloat(data.precio_venta);
            const precioCompra = parseFloat(data.precio_compra);
            
            if (precioVenta <= precioCompra) {
                this.addLog('Advertencia: Precio de venta debería ser mayor al de compra', 'warning');
                // No marcamos como inválido, solo advertimos
            }
        }

        return isValid;
    }

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
        return isValid;
    }

    async procesarConIA(texto) {
        // Simulación de procesamiento con IA - Reemplaza con tu API real
        this.addLog('Procesando texto con IA...', 'info');
        
        return new Promise((resolve) => {
            setTimeout(() => {
                // Expresiones regulares mejoradas para extracción
                const patterns = {
                    nombre: /(?:producto|nombre|articulo)[\s:]*([^,.\d]+?)(?=,|\.|$|cantidad|categoría|precio)/i,
                    categoria: /(?:categor[ií]a|tipo)[\s:]*([^,.\d]+?)(?=,|\.|$|cantidad|precio)/i,
                    cantidad: /(?:cantidad|unidades)[\s:]*(\d+)/i,
                    precio_compra: /(?:precio de compra|compra|costo)[\s:]*\$?(\d+(?:\.\d{1,2})?)/i,
                    precio_venta: /(?:precio de venta|venta)[\s:]*\$?(\d+(?:\.\d{1,2})?)/i
                };

                const resultado = {};
                for (const [key, pattern] of Object.entries(patterns)) {
                    const match = texto.match(pattern);
                    resultado[key] = match ? match[1].trim() : '';
                }

                // Fallback: buscar números para cantidades y precios si no se encontraron con patrones específicos
                if (!resultado.cantidad) {
                    const cantMatch = texto.match(/(\d+)(?=\s*(?:unidades|piezas|pzas))/i);
                    resultado.cantidad = cantMatch ? cantMatch[1] : '';
                }

                this.addLog(`Datos extraídos: ${JSON.stringify(resultado)}`, 'info');
                resolve(resultado);
            }, 1000);
        });
    }

    llenarFormulario(data) {
        Object.keys(data).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                element.value = data[key] || '';
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
    }

    enableActionButtons(enabled) {
        this.elements.confirmBtn.disabled = !enabled;
        this.elements.correctBtn.disabled = !enabled;
    }

    showConfirmation() {
        if (!this.currentData) return;

        const confirmationHTML = `
            <div class="confirmation-data-item"><strong>Producto:</strong> ${this.currentData.nombre || 'No especificado'}</div>
            <div class="confirmation-data-item"><strong>Categoría:</strong> ${this.currentData.categoria || 'No especificado'}</div>
            <div class="confirmation-data-item"><strong>Cantidad:</strong> ${this.currentData.cantidad || 'No especificado'}</div>
            <div class="confirmation-data-item"><strong>Precio Compra:</strong> $${this.currentData.precio_compra || 'No especificado'}</div>
            <div class="confirmation-data-item"><strong>Precio Venta:</strong> $${this.currentData.precio_venta || 'No especificado'}</div>
        `;

        this.elements.confirmationData.innerHTML = confirmationHTML;
        this.elements.confirmationPanel.classList.remove('hidden');
        this.addLog('Panel de confirmación mostrado', 'info');
    }

    hideConfirmationPanel() {
        this.elements.confirmationPanel.classList.add('hidden');
    }

    confirmAndSave() {
        if (!this.currentData) return;

        // Validar nuevamente antes de guardar
        if (!this.validarDatos(this.currentData)) {
            this.addLog('Error: Datos inválidos no pueden ser guardados', 'error');
            alert('Por favor, corrige los errores antes de guardar.');
            return;
        }

        // Simular guardado en base de datos
        this.addLog('Guardando datos en la base de datos...', 'info');
        
        setTimeout(() => {
            this.addLog('✅ Producto guardado exitosamente', 'success');
            this.updateStatus('Producto guardado correctamente', 'success');
            this.hideConfirmationPanel();
            this.clearForm();
            
            // Aquí iría tu lógica real de guardado
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
        const fields = ['nombre', 'categoria', 'cantidad', 'precio_compra', 'precio_venta'];
        fields.forEach(field => {
            const element = document.getElementById(field);
            if (element) {
                element.disabled = false;
                element.focus();
            }
        });

        this.addLog('Corrección manual habilitada', 'info');
        this.updateStatus('Modo corrección manual activado', 'processing');
    }

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
        
        // Rehabilitar botón de grabación para reintento
        this.elements.startBtn.disabled = false;
        this.elements.startBtn.innerHTML = '🎤 Reintentar';
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new AsistenteVozFormulario();
});