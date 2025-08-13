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

        // Configuración de reconexión por servicio
        this.serviceReconnectionConfig = {
            enableProactiveMonitoring: true,
            monitoringInterval: 15000, // 15 segundos
            clientTimeoutThreshold: 60000, // 1 minuto sin respuesta
            proactiveHealthChecks: true
        };
        
        // Monitoring de clientes individual
        this.clientMonitoring = new Map();
        this.monitoringInterval = null;
        
        // Métricas de servicio
        this.serviceMetrics = {
            clientsCreated: 0,
            clientsDestroyed: 0,
            reconnectionsTriggered: 0,
            healthChecksPerformed: 0,
            lastHealthCheck: null
        };
        
        // Iniciar monitoreo proactivo
        if (this.serviceReconnectionConfig.enableProactiveMonitoring) {
            this.startProactiveMonitoring();
        }

        this.listenersSetup = false;
        this.healthCheckInProgress = new Set();
        
        // Configurar manejo de señales para evitar memory leaks
        this.setupGracefulShutdown();
        
        // Inicializar temp directory de forma síncrona
        this.ensureTempDirSync();
    }

    startProactiveMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        this.monitoringInterval = setInterval(() => {
            if (!this.isShuttingDown) {
                this.performProactiveHealthCheck();
            }
        }, this.serviceReconnectionConfig.monitoringInterval);
        
        logger.info('Proactive client monitoring started');
    }

    /**
     * Configurar cierre graceful para evitar memory leaks
     */
    setupGracefulShutdown() {
        if (this.listenersSetup) return; // Evitar duplicados
        
        this.listenersSetup = true;
        
        // Usar once() en lugar de on() para evitar duplicados
        process.once('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.once('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.once('SIGHUP', () => this.gracefulShutdown('SIGHUP'));
        
        // Manejar errores no capturados SIN duplicar
        if (process.listenerCount('uncaughtException') === 0) {
            process.on('uncaughtException', (error) => {
                logger.error('Uncaught Exception:', error);
                this.gracefulShutdown('uncaughtException');
            });
        }
        
        if (process.listenerCount('unhandledRejection') === 0) {
            process.on('unhandledRejection', (reason, promise) => {
                logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            });
        }
    }

    /**
     * Cierre graceful del servicio
     */
    async gracefulShutdown(signal) {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        logger.info(`Received ${signal}. Starting graceful shutdown...`);
        
        try {
            // 1. Detener monitoreo proactivo PRIMERO
            this.stopProactiveMonitoring();
            
            // 2. Cancelar operaciones en progreso
            this.healthCheckInProgress.clear();
            
            // 3. Cerrar clientes con timeout
            if (this.whatsAppClient) {
                const shutdownPromise = this.whatsAppClient.destroyAll();
                const timeoutPromise = new Promise((resolve) => 
                    setTimeout(resolve, 30000)
                );
                
                await Promise.race([shutdownPromise, timeoutPromise]);
            }
            
            // 4. Limpiar estructuras de datos
            this.clientStatusCache.clear();
            this.clientMonitoring.clear();
            
            logger.info('Graceful shutdown completed');
            
        } catch (error) {
            logger.error('Error during graceful shutdown:', error);
        } finally {
            // Solo salir si no es un test
            if (process.env.NODE_ENV !== 'test') {
                setTimeout(() => process.exit(0), 1000);
            }
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
            
            // Inicializar monitoreo para el nuevo cliente
            this.clientMonitoring.set(number, {
                lastSeen: Date.now(),
                consecutiveFailures: 0,
                lastHealthCheck: Date.now(),
                createdAt: Date.now()
            });
            
            // Incrementar métricas
            this.serviceMetrics.clientsCreated++;
            
            // Limpiar cache
            this.invalidateClientCache(number);
            logger.info(`Client ${number} created successfully with monitoring enabled`);
            
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
            
            // Limpiar monitoreo
            this.clientMonitoring.delete(number);
            
            // Incrementar métricas
            this.serviceMetrics.clientsDestroyed++;
            
            // Limpiar todo el cache relacionado
            this.invalidateClientCache(number);
            logger.info(`Client ${number} deleted successfully with complete cleanup`);
            
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
            metrics: this.getServiceMetrics(),
            issues: []
        };
        
        // Verificaciones existentes...
        if (!this.initialized) {
            health.issues.push('Service not initialized');
            health.status = 'unhealthy';
        }
        
        if (this.isShuttingDown) {
            health.issues.push('Service is shutting down');
            health.status = 'unhealthy';
        }
        
        // Nuevas verificaciones de monitoreo
        const unhealthyCount = Array.from(this.clientMonitoring.values())
            .filter(m => m.consecutiveFailures > 0).length;
        
        const totalMonitored = this.clientMonitoring.size;
        
        if (totalMonitored > 0) {
            const unhealthyRatio = unhealthyCount / totalMonitored;
            
            if (unhealthyRatio > 0.5) { // Más del 50% no saludables
                health.issues.push(`High unhealthy client ratio: ${Math.round(unhealthyRatio * 100)}%`);
                health.status = 'degraded';
            }
            
            if (unhealthyRatio > 0.8) { // Más del 80% no saludables
                health.status = 'unhealthy';
            }
        }
        
        // Verificar si el monitoreo está funcionando
        const timeSinceLastHealthCheck = Date.now() - (this.serviceMetrics.lastHealthCheck || 0);
        const expectedInterval = this.serviceReconnectionConfig.monitoringInterval * 2; // Allow 2x interval
        
        if (this.serviceReconnectionConfig.enableProactiveMonitoring && 
            timeSinceLastHealthCheck > expectedInterval) {
            health.issues.push('Proactive monitoring appears stalled');
            health.status = health.status === 'healthy' ? 'degraded' : health.status;
        }
        
        // Verificar circuit breakers existentes...
        Object.entries(this.circuitBreakers).forEach(([name, cb]) => {
            const state = cb.getState();
            if (state.state === 'OPEN') {
                health.issues.push(`Circuit breaker ${name} is OPEN`);
                health.status = 'degraded';
            }
        });
        
        // Verificar tasa de fallos existente...
        const failureRate = this.operationMetrics.failedOperations / 
                        Math.max(this.operationMetrics.totalOperations, 1);
        
        if (failureRate > 0.3) {
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

    /**
     * Formatear número de contacto con validación
     */
    formatContactNumber(number) {
        if (!number || typeof number !== 'string') {
            throw new ValidationError('Invalid number parameter for formatContactNumber');
        }
        
        // Si ya tiene el formato correcto, devolverlo
        if (number.includes('@c.us')) {
            return number;
        }
        
        // Limpiar y formatear
        const cleanNumber = number.replace(/[^\d+]/g, '');
        return `${cleanNumber}@c.us`;
    }

    /**
     * Formatear chat ID con validación mejorada
     */
    formatChatId(tel, isGroup) {
        if (!tel || typeof tel !== 'string') {
            throw new ValidationError('Invalid tel parameter for formatChatId');
        }
        
        // Limpiar el número de caracteres especiales excepto + al inicio
        const cleanTel = tel.replace(/[^\d+]/g, '');
        
        if (isGroup) {
            // Para grupos, mantener el formato original si ya tiene @g.us
            return tel.includes('@g.us') ? tel : `${cleanTel}@g.us`;
        } else {
            // Para chats individuales, asegurar formato correcto
            return tel.includes('@c.us') ? tel : `${cleanTel}@c.us`;
        }
    }

    getDefaultChatData(chat, client) {
        return {
            id: chat?.id || { _serialized: `fallback_${Date.now()}` },
            name: chat?.name || 'Unknown Chat',
            unreadCount: chat?.unreadCount || 0,
            timestamp: chat?.lastMessage?.timestamp || Date.now(),
            recentMessageDate: chat?.lastMessage?.timestamp || 0,
            profilePicUrl: this.getDefaultProfilePic(),
            groupData: [],
            client: client?.options?.authStrategy?.clientId || 'unknown',
            isGroup: chat?.isGroup || false,
            error: true,
            processingTime: Date.now()
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

    async performProactiveHealthCheck() {
        if (this.isShuttingDown || !this.initialized) return;
        
        try {
            this.serviceMetrics.healthChecksPerformed++;
            this.serviceMetrics.lastHealthCheck = Date.now();
            
            // Obtener números de clientes de forma segura
            const clientNumbers = Array.from(this.whatsAppClient?.clients?.keys() || []);
            
            if (clientNumbers.length === 0) {
                logger.debug('No clients to health check');
                return;
            }
            
            logger.debug(`Performing health check on ${clientNumbers.length} clients`);
            
            // MODIFICADO: Procesar clientes en lotes para evitar sobrecarga
            const batchSize = 2;
            for (let i = 0; i < clientNumbers.length; i += batchSize) {
                const batch = clientNumbers.slice(i, i + batchSize);
                
                // Procesar lote en paralelo con timeout global
                const batchPromises = batch.map(number => 
                    Promise.race([
                        this.checkAndMaintainClient(number),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error(`Health check timeout for ${number}`)), 15000)
                        )
                    ]).catch(error => {
                        logger.error(`Health check error for ${number}:`, error.message);
                    })
                );
                
                await Promise.allSettled(batchPromises);
                
                // Pequeña pausa entre lotes
                if (i + batchSize < clientNumbers.length) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }
            
            // Limpiar entradas obsoletas
            this.cleanupStaleMonitoring();
            
        } catch (error) {
            logger.error('Proactive health check failed:', error);
        }
    }

    async checkAndMaintainClient(number) {
        // NUEVO: Prevenir health checks simultáneos del mismo cliente
        if (this.healthCheckInProgress.has(number)) {
            logger.debug(`Health check already in progress for ${number}`);
            return;
        }

        this.healthCheckInProgress.add(number);
        
        try {
            const client = this.whatsAppClient.getClient(number);
            if (!client) {
                logger.debug(`Client ${number} not found during health check`);
                return;
            }
            
            const monitoring = this.clientMonitoring.get(number) || {
                lastSeen: Date.now(),
                consecutiveFailures: 0,
                lastHealthCheck: 0,
                lastReconnectionAttempt: 0 // NUEVO: Prevenir reconexiones muy frecuentes
            };
            
            // NUEVO: Prevenir reconexiones muy frecuentes (mínimo 2 minutos)
            const timeSinceLastReconnection = Date.now() - (monitoring.lastReconnectionAttempt || 0);
            const minReconnectionInterval = 90000; // 2 minutos
            
            const isHealthy = await this.performClientHealthCheck(client);
            
            if (isHealthy) {
                // Cliente sano - resetear contadores
                monitoring.lastSeen = Date.now();
                monitoring.consecutiveFailures = 0;
                monitoring.lastHealthCheck = Date.now();
                
                logger.debug(`Client ${number} health check passed`);
            } else {
                // Cliente no está sano
                monitoring.consecutiveFailures++;
                monitoring.lastHealthCheck = Date.now();
                
                logger.warn(`Client ${number} failed health check (${monitoring.consecutiveFailures} consecutive failures)`);
                
                // MODIFICADO: Reconectar solo después de 3 fallos Y respetando intervalo mínimo
                if (monitoring.consecutiveFailures >= 2 && 
                    timeSinceLastReconnection > minReconnectionInterval &&
                    !this.whatsAppClient.activeReconnections?.has(number)) {
                    
                    logger.info(`Triggering proactive reconnection for ${number} after ${monitoring.consecutiveFailures} failures`);
                    monitoring.lastReconnectionAttempt = Date.now();
                    this.serviceMetrics.reconnectionsTriggered++;
                    
                    // Usar setTimeout para evitar bloquear el health check loop
                    setImmediate(() => {
                        this.whatsAppClient.handleReconnection(number, 'proactive_health_check');
                    });
                    
                    // Reset para evitar múltiples triggers
                    monitoring.consecutiveFailures = 0;
                }
            }
            
            this.clientMonitoring.set(number, monitoring);
            
        } catch (error) {
            logger.error(`Error in checkAndMaintainClient for ${number}:`, error);
            
            const monitoring = this.clientMonitoring.get(number) || { consecutiveFailures: 0 };
            monitoring.consecutiveFailures++;
            monitoring.lastHealthCheck = Date.now();
            this.clientMonitoring.set(number, monitoring);
            
        } finally {
            // IMPORTANTE: Siempre remover de la lista de progreso
            this.healthCheckInProgress.delete(number);
        }
    }

    async performClientHealthCheck(client) {
        try {
            // 1. Verificar que el cliente existe y tiene propiedades básicas
            if (!client || typeof client !== 'object') {
                return false;
            }

            // 2. Verificar estado básico con timeout corto
            const state = await Promise.race([
                client.getState(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('State check timeout')), 3000)
                )
            ]);
            
            if (state !== 'CONNECTED') {
                logger.debug(`Client state is ${state}, not CONNECTED`);
                return false;
            }

            // 3. CORREGIDO: Usar método existente en lugar de getWWebJSInfo
            try {
                const info = await Promise.race([
                    client.info || Promise.resolve(null),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Info check timeout')), 2000)
                    )
                ]);
                
                // Verificar que tenemos información básica del cliente
                if (!info || !info.wid) {
                    logger.debug('Client info not available or incomplete');
                    return false;
                }
            } catch (infoError) {
                logger.debug('Client info check failed, but continuing...');
                // No fallar por esto, continuar con otras verificaciones
            }

            // 4. CORREGIDO: Test de funcionalidad básica con timeout muy corto
            try {
                const chats = await Promise.race([
                    client.getChats().then(chats => chats.slice(0, 1)),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Chats check timeout')), 3000)
                    )
                ]);
                
                // Si llegamos aquí, el cliente está funcionando
                return true;
                
            } catch (chatsError) {
                logger.debug(`Chats check failed: ${chatsError.message}`);
                return false;
            }
            
        } catch (error) {
            logger.debug(`Health check failed: ${error.message}`);
            return false;
        }
    }

    cleanupStaleMonitoring() {
        const now = Date.now();
        const staleThreshold = 600000; // 10 minutos
        
        for (const [number, monitoring] of this.clientMonitoring.entries()) {
            // Remover si el cliente ya no existe Y ha pasado suficiente tiempo
            if (!this.whatsAppClient?.clients?.has(number)) {
                const timeSinceLastSeen = now - (monitoring.lastSeen || monitoring.lastHealthCheck || 0);
                
                if (timeSinceLastSeen > staleThreshold) {
                    this.clientMonitoring.delete(number);
                    logger.debug(`Cleaned up stale monitoring for ${number}`);
                }
            }
        }
        
        // NUEVO: Limpiar health checks en progreso huérfanos
        for (const number of this.healthCheckInProgress) {
            if (!this.whatsAppClient?.clients?.has(number)) {
                this.healthCheckInProgress.delete(number);
                logger.debug(`Cleaned up orphaned health check progress for ${number}`);
            }
        }
    }

    stopProactiveMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            logger.info('Proactive monitoring stopped');
        }
        
        // Limpiar health checks en progreso
        this.healthCheckInProgress.clear();
    }

    getServiceMetrics() {
        const baseMetrics = this.getMetrics();
        
        return {
            ...baseMetrics,
            service: {
                ...this.serviceMetrics,
                monitoredClients: this.clientMonitoring.size,
                proactiveMonitoringEnabled: this.serviceReconnectionConfig.enableProactiveMonitoring,
                monitoringInterval: this.serviceReconnectionConfig.monitoringInterval
            },
            monitoring: {
                totalClients: this.clientMonitoring.size,
                healthyClients: Array.from(this.clientMonitoring.values())
                    .filter(m => m.consecutiveFailures === 0).length,
                unhealthyClients: Array.from(this.clientMonitoring.values())
                    .filter(m => m.consecutiveFailures > 0).length,
                averageUptime: this.calculateAverageUptime()
            }
        };
    }

    calculateAverageUptime() {
        if (this.clientMonitoring.size === 0) return 0;
        
        const now = Date.now();
        let totalUptime = 0;
        
        for (const monitoring of this.clientMonitoring.values()) {
            if (monitoring.createdAt) {
                totalUptime += now - monitoring.createdAt;
            }
        }
        
        return Math.round(totalUptime / this.clientMonitoring.size);
    }

    async forceHealthCheck(number = null) {
        if (number) {
            // Health check para un cliente específico
            if (this.whatsAppClient.clients.has(number)) {
                await this.checkAndMaintainClient(number);
                return this.clientMonitoring.get(number);
            } else {
                throw new Error(`Client ${number} not found`);
            }
        } else {
            // Health check para todos los clientes
            await this.performProactiveHealthCheck();
            return Array.from(this.clientMonitoring.entries()).map(([num, monitoring]) => ({
                number: num,
                ...monitoring
            }));
        }
    }
}

module.exports = BaseWhatsAppService;