const fs = require('fs').promises;
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { NotFoundError, ValidationError } = require('../../utils/asyncHandler');
const { logger } = require('../../config/logger');
const { AES } = require('../../utils/encryption');

const WhatsAppClient = require('../whatsappClient');
const CircuitBreaker = require('../../utils/circuitBreaker');
const RetryManager = require('../../utils/retryManager');

// Obtener la clave del archivo .env
const encryptionKey = process.env.PASS_ENCRYPTED;
if (!encryptionKey) {
  throw new Error("No se encontró la clave de cifrado en .env");
}
const aesInstance = new AES(encryptionKey);

/**
 * Base WhatsApp Service - Handles core client operations with resilience
 */
class BaseWhatsAppService {
    constructor() {
        this.tempDir = path.join(__dirname, '../temp');
        this.whatsAppClient = new WhatsAppClient();
        this.isShuttingDown = false;
        this.initializationInProgress = false;
        this.initialized = false;
        
        // Circuit breakers por operación con configuración más conservadora
        this.circuitBreakers = {
            clientOperation: new CircuitBreaker('client-operations', {
                failureThreshold: 2, // Reducido de 3 a 2
                recoveryTimeout: 60000, // Aumentado a 60s
                monitoringPeriod: 120000 // Aumentado a 120s
            }),
            clientStatus: new CircuitBreaker('client-status', {
                failureThreshold: 3, // Reducido de 5 a 3
                recoveryTimeout: 30000,
                monitoringPeriod: 60000
            }),
            authentication: new CircuitBreaker('authentication', {
                failureThreshold: 2,
                recoveryTimeout: 120000, // Aumentado a 120s
                monitoringPeriod: 180000 // Aumentado a 180s
            })
        };
        
        // Retry manager más conservador
        this.retryManager = new RetryManager({
            maxRetries: 2, // Reducido de 3 a 2
            baseDelay: 2000, // Aumentado de 1000 a 2000
            maxDelay: 30000, // Aumentado de 10000 a 30000
            backoffFactor: 2.5 // Aumentado de 2 a 2.5
        });
        
        // Cache de estado de clientes con TTL
        this.clientStatusCache = new Map();
        this.cacheTimeout = 45000; // Aumentado de 30s a 45s
        
        // Métricas de operaciones
        this.operationMetrics = {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageResponseTime: 0,
            lastOperationTime: null
        };
        
        // Configurar manejo de señales para evitar memory leaks
        this.setupGracefulShutdown();
        
        // Inicializar temp directory de forma síncrona
        this.ensureTempDirSync();
    }

    /**
     * Configurar cierre graceful para evitar memory leaks
     */
    setupGracefulShutdown() {
        // Solo agregar listeners una vez
        if (!process.listenerCount('SIGINT')) {
            process.once('SIGINT', () => this.gracefulShutdown('SIGINT'));
        }
        if (!process.listenerCount('SIGTERM')) {
            process.once('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        }
        
        // Manejar errores no capturados
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            this.gracefulShutdown('uncaughtException');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
    }

    /**
     * Cierre graceful del servicio
     */
    async gracefulShutdown(signal) {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        logger.info(`Received ${signal}. Starting graceful shutdown...`);
        
        try {
            // Cerrar todos los clientes
            if (this.whatsAppClient) {
                await this.whatsAppClient.destroyAll();
            }
            
            // Limpiar cache
            this.clientStatusCache.clear();
            
            logger.info('Graceful shutdown completed');
        } catch (error) {
            logger.error('Error during graceful shutdown:', error);
        } finally {
            process.exit(0);
        }
    }

    /**
     * Inicializar servicio con control mejorado
     */
    async initializeService() {
        if (this.isShuttingDown || this.initializationInProgress) {
            return;
        }
        
        this.initializationInProgress = true;
        
        try {
            await this.retryManager.execute('service-init', async () => {
                await this.init();
            });
            
            this.initialized = true;
            logger.info('BaseWhatsAppService initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize BaseWhatsAppService:', error);
            
            // Solo reintentar si no estamos cerrando y no hay demasiados fallos
            if (!this.isShuttingDown && this.operationMetrics.failedOperations < 10) {
                logger.info('Scheduling retry initialization in 60 seconds...');
                setTimeout(() => {
                    if (!this.isShuttingDown) {
                        this.initializeService();
                    }
                }, 60000); // Aumentado de 30s a 60s
            } else {
                logger.error('Too many initialization failures or shutting down. Stopping retries.');
            }
        } finally {
            this.initializationInProgress = false;
        }
    }

    async init() {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        if (!this.whatsAppClient.initialized) {
            // Verificar disponibilidad del sistema antes de inicializar
            await this.checkSystemRequirements();
            await this.whatsAppClient.initialize();
        }
    }

    /**
     * Verificar requisitos del sistema antes de inicializar
     */
    async checkSystemRequirements() {
        try {
            // Verificar si tenemos suficiente memoria
            const memUsage = process.memoryUsage();
            const memoryLimitMB = 512; // 512MB mínimo
            
            if (memUsage.heapUsed / 1024 / 1024 > memoryLimitMB) {
                logger.warn('High memory usage detected:', memUsage);
            }
            
            // Verificar directorio temporal
            await this.ensureTempDir();
            
            // Verificar variables de entorno críticas
            if (!process.env.NODE_ENV) {
                logger.warn('NODE_ENV not set, defaulting to development');
            }
            
            logger.info('System requirements check passed');
        } catch (error) {
            logger.error('System requirements check failed:', error);
            throw new Error(`System requirements not met: ${error.message}`);
        }
    }

    /**
     * Check if client exists with circuit breaker and caching
     * @param {string} number - Phone number
     * @returns {Promise<boolean>} - Whether client exists
     */
    async checkClientExists(number) {
        if (this.isShuttingDown) return false;
        
        const startTime = Date.now();
        
        try {
            // Validar input
            if (!number || typeof number !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            
            // Verificar cache primero
            const cacheKey = `exists_${number}`;
            const cached = this.getFromCache(cacheKey);
            if (cached !== null) {
                return cached;
            }

            const result = await this.circuitBreakers.clientOperation.execute(async () => {
                if (!this.initialized) {
                    await this.init();
                }
                
                const client = this.whatsAppClient.getClient(number);
                return !!client;
            });
            
            // Cachear resultado por tiempo apropiado
            this.setCache(cacheKey, result, result ? this.cacheTimeout : 10000);
            this.updateMetrics(startTime, true);
            
            return result;
        } catch (error) {
            this.updateMetrics(startTime, false);
            logger.error(`Error checking client existence for ${number}:`, error);
            
            // Valor por defecto seguro
            return false;
        }
    }

    /**
     * Check client status with enhanced error handling and caching
     * @param {string} number - Phone number
     * @returns {Promise<Object>} - Client status
     */
    async checkClientStatus(number) {
        if (this.isShuttingDown) {
            return {
                authenticated: false,
                ready: false,
                error: 'Service shutting down',
                timestamp: Date.now()
            };
        }
        
        const startTime = Date.now();
        const cacheKey = `status_${number}`;
        
        try {
            // Validar input
            if (!number || typeof number !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            
            // Verificar cache
            const cached = this.getFromCache(cacheKey);
            if (cached !== null) {
                return cached;
            }

            const result = await this.circuitBreakers.clientStatus.execute(async () => {
                await this.ensureServiceReady();
                
                const isAuthenticated = this.whatsAppClient.isAuthenticated(number);
                const isReady = this.whatsAppClient.isReady(number);
                
                return {
                    authenticated: isAuthenticated,
                    ready: isReady,
                    timestamp: Date.now()
                };
            });
            
            // Cachear por menos tiempo si hay problemas
            const cacheTime = result.authenticated && result.ready ? this.cacheTimeout : 5000;
            this.setCache(cacheKey, result, cacheTime);
            
            this.updateMetrics(startTime, true);
            return result;
            
        } catch (error) {
            this.updateMetrics(startTime, false);
            logger.error(`Error checking client status for ${number}:`, error);
            
            // Devolver estado por defecto
            return {
                authenticated: false,
                ready: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Refresh client with enhanced retry logic
     * @param {string} number - Phone number
     */
    async refreshClient(number) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const operationId = `refresh_${number}_${Date.now()}`;
        
        try {
            // Validar input
            if (!number || typeof number !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.circuitBreakers.clientOperation.execute(async () => {
                    await this.ensureServiceReady();
                    
                    const client = this.whatsAppClient.getClient(number);
                    
                    if (client) {
                        if (!client.authStrategy?.isAuthenticated) {
                            logger.info(`Reiniciando cliente ${number} para generar nuevo QR`);
                            await this.whatsAppClient.restartClient(number);
                        }
                    } else {
                        logger.info(`Creando nuevo cliente para ${number}`);
                        await this.whatsAppClient.addClient(number);
                    }
                    
                    // Limpiar cache relacionado
                    this.invalidateClientCache(number);
                });
            });
            
            logger.info(`Client ${number} refreshed successfully`);
        } catch (error) {
            logger.error(`Failed to refresh client ${number}:`, error);
            throw error;
        }
    }

    /**
     * Get client QR code with timeout and fallback
     * @param {string} number - Client number
     * @returns {Promise<string>} QR code
     */
    async getClientQr(number) {
        if (this.isShuttingDown) return null;
        
        try {
            // Validar input
            if (!number || typeof number !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            
            // Timeout para evitar bloqueos
            const qrPromise = Promise.race([
                new Promise((resolve) => {
                    const qrCode = this.whatsAppClient.getQr(number);
                    resolve(qrCode);
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('QR fetch timeout')), 10000) // Aumentado a 10s
                )
            ]);
            
            const qrCode = await qrPromise;
            logger.debug(`QR obtenido para ${number}: ${qrCode ? 'disponible' : 'no disponible'}`);
            
            return qrCode;
        } catch (error) {
            logger.error(`Error getting QR for ${number}:`, error);
            return null;
        }
    }

    /**
     * Check client authentication with circuit breaker
     * @param {string} number - Client number
     * @returns {Promise<boolean>} Authentication status
     */
    async checkClientAuth(number) {
        if (this.isShuttingDown) return false;
        
        try {
            // Validar input
            if (!number || typeof number !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            
            return await this.circuitBreakers.authentication.execute(async () => {
                await this.ensureServiceReady();
                return this.whatsAppClient.isAuthenticated(number);
            });
        } catch (error) {
            logger.error(`Error checking authentication for ${number}:`, error);
            return false;
        }
    }

    /**
     * Create new WhatsApp client with enhanced error handling
     * @param {string} number - Client number
     */
    async createClient(number) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const operationId = `create_${number}_${Date.now()}`;
        
        try {
            // Validar input
            if (!number || typeof number !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                await this.whatsAppClient.addClient(number);
            });
            
            // Limpiar cache
            this.invalidateClientCache(number);
            logger.info(`Client ${number} created successfully`);
        } catch (error) {
            logger.error(`Error creating client ${number}:`, error);
            throw error;
        }
    }

    /**
     * Delete WhatsApp client with cleanup
     * @param {string} number - Client number
     */
    async deleteClient(number) {
        const operationId = `delete_${number}_${Date.now()}`;
        
        try {
            // Validar input
            if (!number || typeof number !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.whatsAppClient.removeClient(number);
            });
            
            // Limpiar todo el cache relacionado
            this.invalidateClientCache(number);
            logger.info(`Client ${number} deleted successfully`);
        } catch (error) {
            logger.error(`Error removing client ${number}:`, error);
            throw error;
        }
    }

    /**
     * Get authenticated accounts info with fallback
     * @returns {Promise<Array>} Authenticated accounts
     */
    async getAllAuthenticatedAccountsInfo() {
        if (this.isShuttingDown) return [];
        
        try {
            await this.ensureServiceReady();
            
            const authenticatedAccountsInfo = await this.retryManager.execute(
                'get-authenticated-accounts',
                async () => {
                    return await this.whatsAppClient.getAuthenticatedAccountsInfo();
                }
            );
            
            return authenticatedAccountsInfo || [];
        } catch (error) {
            logger.error('Error al obtener información de las cuentas autenticadas:', error);
            return [];
        }
    }

    /**
     * Get client by ID with validation
     * @param {string} clientId - Client ID
     * @returns {Promise<Object>} WhatsApp client
     * @throws {NotFoundError} If client not found
     */
    async getClientById(clientId) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        try {
            // Validar input
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            
            await this.ensureServiceReady();
            
            const client = this.whatsAppClient.getClient(clientId);
            
            if (!client) {
                throw new NotFoundError(`Client ${clientId} not found`);
            }

            return client;
        } catch (error) {
            if (error instanceof NotFoundError || error instanceof ValidationError) {
                throw error;
            }
            logger.error(`Error getting client ${clientId}:`, error);
            throw new Error(`Failed to get client ${clientId}: ${error.message}`);
        }
    }

    /**
     * Ensure service is ready
     * @private
     */
    async ensureServiceReady() {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        if (!this.initialized && !this.initializationInProgress) {
            await this.initializeService();
        }
        
        // Esperar a que la inicialización complete
        const timeout = 30000; // 30 segundos
        const startTime = Date.now();
        
        while (!this.initialized && Date.now() - startTime < timeout) {
            if (this.isShuttingDown) {
                throw new Error('Service is shutting down');
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (!this.initialized) {
            throw new Error('Service initialization timeout');
        }
    }

    /**
     * Cache management methods
     */
    getFromCache(key) {
        const item = this.clientStatusCache.get(key);
        if (item && Date.now() - item.timestamp < item.ttl) {
            return item.value;
        }
        this.clientStatusCache.delete(key);
        return null;
    }

    setCache(key, value, ttl = this.cacheTimeout) {
        // Limitar el tamaño del cache
        if (this.clientStatusCache.size > 1000) {
            const oldestKey = this.clientStatusCache.keys().next().value;
            this.clientStatusCache.delete(oldestKey);
        }
        
        this.clientStatusCache.set(key, {
            value,
            timestamp: Date.now(),
            ttl
        });
    }

    invalidateClientCache(number) {
        const keysToDelete = [];
        for (const key of this.clientStatusCache.keys()) {
            if (key.includes(number)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.clientStatusCache.delete(key));
    }

    /**
     * Update operation metrics
     */
    updateMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        this.operationMetrics.totalOperations++;
        
        if (success) {
            this.operationMetrics.successfulOperations++;
        } else {
            this.operationMetrics.failedOperations++;
        }
        
        // Calcular promedio móvil simple
        const currentAvg = this.operationMetrics.averageResponseTime;
        const count = this.operationMetrics.totalOperations;
        this.operationMetrics.averageResponseTime = 
            (currentAvg * (count - 1) + duration) / count;
        
        this.operationMetrics.lastOperationTime = Date.now();
    }

    /**
     * Get service metrics
     */
    getMetrics() {
        return {
            ...this.operationMetrics,
            cacheSize: this.clientStatusCache.size,
            initialized: this.initialized,
            isShuttingDown: this.isShuttingDown,
            circuitBreakers: Object.keys(this.circuitBreakers).reduce((acc, key) => {
                acc[key] = this.circuitBreakers[key].getState();
                return acc;
            }, {}),
            activeRetryOperations: this.retryManager.getActiveOperations()
        };
    }

    /**
     * Health check method
     */
    async healthCheck() {
        const health = {
            status: 'healthy',
            timestamp: Date.now(),
            metrics: this.getMetrics(),
            issues: []
        };
        
        // Verificar si el servicio está inicializado
        if (!this.initialized) {
            health.issues.push('Service not initialized');
            health.status = 'unhealthy';
        }
        
        // Verificar si estamos cerrando
        if (this.isShuttingDown) {
            health.issues.push('Service is shutting down');
            health.status = 'unhealthy';
        }
        
        // Verificar circuit breakers
        Object.entries(this.circuitBreakers).forEach(([name, cb]) => {
            const state = cb.getState();
            if (state.state === 'OPEN') {
                health.issues.push(`Circuit breaker ${name} is OPEN`);
                health.status = 'degraded';
            }
        });
        
        // Verificar si hay demasiadas operaciones fallidas
        const failureRate = this.operationMetrics.failedOperations / 
                           Math.max(this.operationMetrics.totalOperations, 1);
        
        if (failureRate > 0.3) { // Reducido de 0.5 a 0.3
            health.issues.push(`High failure rate: ${(failureRate * 100).toFixed(2)}%`);
            health.status = health.status === 'healthy' ? 'degraded' : health.status;
        }
        
        if (failureRate > 0.7) {
            health.status = 'unhealthy';
        }
        
        return health;
    }

    // Métodos auxiliares existentes (sin cambios)
    async getProfilePicture(client, id) {
        try {
            return await client.getProfilePicUrl(id);
        } catch (error) {
            return this.getDefaultProfilePic();
        }
    }

    getDefaultProfilePic() {
        return 'https://cdn.playbuzz.com/cdn/913253cd-5a02-4bf2-83e1-18ff2cc7340f/c56157d5-5d8e-4826-89f9-361412275c35.jpg';
    }

    formatContactNumber(number) {
        return number.includes('@c.us') ? number : `${number}@c.us`;
    }

    formatChatId(tel, isGroup) {
        return isGroup ? `${tel}@g.us` : `${tel}@c.us`;
    }

    getDefaultChatData(chat, client) {
        return {
            ...chat,
            recentMessageDate: 0,
            profilePicUrl: this.getDefaultProfilePic(),
            groupData: [],
            client: client.options.authStrategy.clientId
        };
    }

    /**
     * Crear directorio temporal de forma síncrona
     */
    ensureTempDirSync() {
        try {
            const fs = require('fs');
            if (!fs.existsSync(this.tempDir)) {
                fs.mkdirSync(this.tempDir, { recursive: true });
            }
        } catch (error) {
            logger.error('Error creating temp directory sync:', error);
        }
    }

    async ensureTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            logger.error('Error creating temp directory:', error);
            throw error;
        }
    }
}

module.exports = BaseWhatsAppService;