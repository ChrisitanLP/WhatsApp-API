// config/app.js
const path = require('path');

// Cargar variables de entorno lo antes posible
require('dotenv').config();

/**
 * Configuración central de la aplicación
 * Todas las configuraciones deben venir de variables de entorno
 */
class AppConfig {
    constructor() {
        this.validateRequiredEnvVars();
    }

    // Configuración del servidor
    get server() {
        return {
            port: this.getEnvAsInt('PORT', 5000),
            nodeEnv: process.env.NODE_ENV || 'development',
            corsOrigins: this.getCorsOrigins(),
            uploadLimit: process.env.UPLOAD_LIMIT || '50mb'
        };
    }

    // Configuración de rutas y directorios
    get paths() {
        const baseDir = path.join(__dirname, '..');
        
        return {
            chrome: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            auth: process.env.AUTH_PATH || path.join(baseDir, '.wwebjs_auth'),
            media: process.env.MEDIA_PATH || path.join(baseDir, 'controllers', 'media'),
            temp: process.env.TEMP_PATH || path.join(baseDir, 'temp'),
            logs: process.env.LOGS_PATH || path.join(__dirname, 'logs')
        };
    }

    // Configuración de conexión y reintentos
    get connection() {
        return {
            reconnectDelay: this.getEnvAsInt('RECONNECT_DELAY', 5000),
            maxRetries: this.getEnvAsInt('MAX_RETRIES', 3),
            heartbeatInterval: this.getEnvAsInt('HEARTBEAT_INTERVAL', 120000)
        };
    }

    // Configuración de seguridad
    get security() {
        return {
            encryptionKey: process.env.ENCRYPTION_KEY,
            // NUNCA hardcodear passwords en config
            // Usar un servicio de secrets o variables de entorno
        };
    }

    // Configuración específica de WhatsApp
    get whatsapp() {
        return {
            sessionName: process.env.WA_SESSION_NAME || 'whatsapp-session',
            puppeteerArgs: this.getPuppeteerArgs()
        };
    }

    // Métodos auxiliares privados
    validateRequiredEnvVars() {
        // Removemos PORT como requerido ya que tiene valor por defecto
        const required = [];
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Variables de entorno requeridas faltantes: ${missing.join(', ')}`);
        }
    }

    getEnvAsInt(key, defaultValue) {
        const value = process.env[key];
        if (!value) return defaultValue;
        
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
            throw new Error(`Variable de entorno ${key} debe ser un número válido`);
        }
        return parsed;
    }

    getCorsOrigins() {
        const origins = process.env.CORS_ORIGINS;
        if (!origins) return ['*'];
        
        return origins.split(',').map(origin => origin.trim());
    }

    getDefaultChromePath() {
        const platform = process.platform;
        const paths = {
            win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            linux: '/usr/bin/google-chrome-stable' // Cambiado para mejor compatibilidad
        };
        
        return paths[platform] || paths.linux;
    }

    getPuppeteerArgs() {
        const baseArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ];

        // Agregar argumentos específicos según el entorno
        if (this.server.nodeEnv === 'production') {
            baseArgs.push('--single-process');
        }

        return baseArgs;
    }

    // Método para obtener toda la configuración
    getAll() {
        return {
            server: this.server,
            paths: this.paths,
            connection: this.connection,
            security: this.security,
            whatsapp: this.whatsapp
        };
    }
}

// Exportar instancia singleton
module.exports = new AppConfig();