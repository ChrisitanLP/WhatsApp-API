// config/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Configurador centralizado de logging
 * Maneja diferentes niveles, formatos y transportes
 */
class LoggerConfig {
    constructor() {
        this.logsDir = path.join(__dirname, 'logs');
        this.ensureLogsDirectory();
    }

    /**
     * Crear directorio de logs si no existe
     */
    ensureLogsDirectory() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    /**
     * Formato personalizado para logs
     */
    getLogFormat() {
        return winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            winston.format.errors({ stack: true }),
            winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
                
                // Agregar stack trace si existe
                if (stack) {
                    logMessage += `\nStack: ${stack}`;
                }
                
                // Agregar metadata adicional si existe
                if (Object.keys(meta).length > 0) {
                    logMessage += `\nMeta: ${JSON.stringify(meta, null, 2)}`;
                }
                
                return logMessage;
            })
        );
    }

    /**
     * Configuración de transportes para archivos
     */
    getFileTransports() {
        return [
            // Log de errores únicamente
            new winston.transports.File({
                filename: path.join(this.logsDir, 'error.log'),
                level: 'error',
                maxsize: 5242880, // 5MB
                maxFiles: 5,
                tailable: true
            }),
            
            // Log combinado de todo
            new winston.transports.File({
                filename: path.join(this.logsDir, 'combined.log'),
                maxsize: 5242880, // 5MB
                maxFiles: 10,
                tailable: true
            }),
            
            // Log específico para WebSockets
            new winston.transports.File({
                filename: path.join(this.logsDir, 'websocket.log'),
                level: 'info',
                maxsize: 2097152, // 2MB
                maxFiles: 3,
                tailable: true
            })
        ];
    }

    /**
     * Configuración de transporte para consola (desarrollo)
     */
    getConsoleTransport() {
        return new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${level}]: ${message}`;
                })
            )
        });
    }

    /**
     * Crear logger principal
     */
    createLogger() {
        const transports = this.getFileTransports();
        
        // Agregar consola solo en desarrollo
        if (process.env.NODE_ENV !== 'production') {
            transports.push(this.getConsoleTransport());
        }

        return winston.createLogger({
            level: this.getLogLevel(),
            format: this.getLogFormat(),
            transports,
            // Evitar que winston termine el proceso en errores
            exitOnError: false,
            // Configuraciones adicionales
            defaultMeta: {
                service: 'whatsapp-odoo-api',
                environment: process.env.NODE_ENV || 'development'
            }
        });
    }

    /**
     * Crear logger específico para WebSockets
     */
    createWebSocketLogger() {
        return winston.createLogger({
            level: 'info',
            format: this.getLogFormat(),
            transports: [
                new winston.transports.File({
                    filename: path.join(this.logsDir, 'websocket.log'),
                    maxsize: 2097152, // 2MB
                    maxFiles: 3
                })
            ],
            defaultMeta: {
                service: 'websocket-handler',
                component: 'websocket'
            }
        });
    }

    /**
     * Determinar nivel de log según entorno
     */
    getLogLevel() {
        const env = process.env.NODE_ENV || 'development';
        const levels = {
            development: 'debug',
            test: 'warn',
            production: 'info'
        };
        
        return levels[env] || 'info';
    }
}

// Crear instancia y exportar loggers
const loggerConfig = new LoggerConfig();

module.exports = {
    logger: loggerConfig.createLogger(),
    wsLogger: loggerConfig.createWebSocketLogger(),
    
    // Factory method para crear loggers personalizados
    createCustomLogger: (component) => {
        return winston.createLogger({
            level: loggerConfig.getLogLevel(),
            format: loggerConfig.getLogFormat(),
            transports: loggerConfig.getFileTransports(),
            defaultMeta: {
                service: 'whatsapp-odoo-api',
                component
            }
        });
    }
};