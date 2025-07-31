// services/whatsapp/WhatsAppClient.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const { EventEmitter } = require('events');
const logger = require('../config/logger').logger;
const config = require('../config/app');
const SessionManager = require('./whatsapp/sessionmanager');
const MessageQueue = require('./whatsapp/messageQueue');
const EventHandler = require('./whatsapp/eventHandler');

const ConnectionPool = require('../utils/connectionPool');
const RetryManager = require('../utils/retryManager');
const HealthMonitor = require('../utils/healtMonitor');
const Semaphore = require('../utils/semaphore');

/**
 * Cliente principal de WhatsApp - Responsabilidad única: gestión de conexiones
 */
class WhatsAppClient extends EventEmitter {
    constructor() {
        if (WhatsAppClient.instance) {
            return WhatsAppClient.instance;
        }

        super();
        this.clients = new Map();
        this.clientStates = new Map();
        this.qrCodes = new Map();
        this.retryAttempts = new Map();
        this.initialized = false;

        // Pool de conexiones mejorado
        this.connectionPool = new ConnectionPool({
            maxConnections: 50,
            idleTimeout: 300000, // 5 minutos
            acquireTimeout: 30000
        });

        this.isShuttingDown = false;
        this.cleanupInProgress = new Set();
        
        // Gestor de reintentos
        this.retryManager = new RetryManager({
            maxRetries: 5,
            baseDelay: 2000,
            maxDelay: 30000,
            backoffFactor: 2
        });
        
        // Monitor de salud
        this.healthMonitor = new HealthMonitor();
        
        // Constantes del código original
        this.RECONNECT_DELAY = config.connection?.reconnectDelay || 5000;
        this.MAX_RETRIES = config.connection?.maxRetries || 3;
        this.MAX_CONCURRENT_OPERATIONS = 10;

        // Semáforo para operaciones concurrentes
        this.operationSemaphore = new Semaphore(this.MAX_CONCURRENT_OPERATIONS);
        
        // Cache de operaciones recientes
        this.operationCache = new Map();
        this.cacheTimeout = 60000; // 1 minuto
        
        // Delegación de responsabilidades
        this.sessionManager = new SessionManager(config.paths.auth);
        this.messageQueue = new MessageQueue({
            concurrency: 5,
            retryAttempts: 3,
            retryDelay: 1000
        });
        this.eventHandler = new EventHandler();

        this.reconnectionQueue = new Map(); // Cola de reconexiones pendientes
        this.reconnectionTimers = new Map(); // Timers activos de reconexión
        this.clientHealthStatus = new Map(); // Estado de salud por cliente
        this.maxConcurrentReconnections = 3; // Límite de reconexiones simultáneas
        this.activeReconnections = new Set(); // Reconexiones activas
        
        // Configuración de reconexión escalonada
        this.reconnectionConfig = {
            initialDelay: 5000,
            maxDelay: 300000, // 5 minutos
            backoffMultiplier: 2,
            maxRetries: 10,
            healthCheckInterval: 30000
        };
        
        // Métricas de reconexión
        this.reconnectionMetrics = {
            totalAttempts: 0,
            successfulReconnections: 0,
            failedReconnections: 0,
            averageReconnectionTime: 0
        };
        
        WhatsAppClient.instance = this;

        setInterval(() => {
            if (!this.isShuttingDown) {
                this.performMaintenance();
            }
        }, 600000); 
    }

    async initialize() {
        try {
            await this.sessionManager.ensureAuthDirectory();
            await this.loadExistingClients();
            this.setupEventHandlers();
            this.startHealthMonitoring();
            this.initialized = true;
            
            logger.info('WhatsApp client initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize WhatsApp client:', error);
            throw error;
        }
    }

    startHealthMonitoring() {
        // Monitorear salud de clientes cada 60 segundos
        setInterval(async () => {
            await this.checkClientsHealth();
        }, 60000);
        
        // Métricas cada 30 segundos
        setInterval(() => {
            this.collectMetrics();
        }, 30000);
    }

    collectMetrics() {
        const metrics = {
            totalClients: this.clients.size,
            readyClients: Array.from(this.clients.entries())
                .filter(([number]) => this.isReady(number)).length,
            queueSize: this.messageQueue.getQueueSize(),
            cacheSize: this.operationCache.size,
            memoryUsage: process.memoryUsage(),
            connectionPoolStats: this.connectionPool.getStats()
        };
        
        this.emit('metrics', metrics);
        return metrics;
    }

    async checkClientsHealth() {
        if (this.isShuttingDown) return;
        
        const healthPromises = Array.from(this.clients.entries()).map(async ([number, client]) => {
            try {
                const isHealthy = await this.isClientHealthy(client);
                const currentHealth = this.clientHealthStatus.get(number);
                
                if (!isHealthy) {
                    // Si el cliente no está sano y no está en reconexión
                    if (!this.activeReconnections.has(number) && 
                        (!currentHealth || currentHealth.status !== 'reconnecting')) {
                        
                        logger.warn(`Client ${number} is unhealthy, triggering reconnection`);
                        
                        // Simular evento de desconexión para activar reconexión
                        setImmediate(() => {
                            this.handleReconnection(number, 'health_check_failed');
                        });
                    }
                } else {
                    // Cliente sano
                    this.clientHealthStatus.set(number, { 
                        status: 'healthy', 
                        lastCheck: Date.now() 
                    });
                }
                
                return { number, healthy: isHealthy };
            } catch (error) {
                logger.error(`Health check error for ${number}:`, error);
                return { number, healthy: false, error: error.message };
            }
        });

        const results = await Promise.allSettled(healthPromises);
        const healthyCount = results
            .filter(r => r.status === 'fulfilled' && r.value.healthy)
            .length;
        
        this.healthMonitor.recordHealthCheck(healthyCount, this.clients.size);
        
        // Emit health metrics
        this.emit('health_check', {
            total: this.clients.size,
            healthy: healthyCount,
            reconnecting: this.activeReconnections.size,
            queued: this.reconnectionQueue.size,
            timestamp: Date.now()
        });
    }

    async isClientHealthy(client) {
        try {
            if (!client || typeof client !== 'object') {
                return false;
            }

            // CORREGIDO: Verificar estado con timeout muy corto para health check
            const healthCheck = Promise.race([
                client.getState(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Health check timeout')), 3000) // Reducido a 3s
                )
            ]);
            
            const state = await healthCheck;
            
            // MODIFICADO: Aceptar más estados como "saludables"
            const healthyStates = ['CONNECTED', 'OPENING', 'PAIRING'];
            const isHealthy = healthyStates.includes(state);
            
            if (!isHealthy) {
                logger.debug(`Client state ${state} not considered healthy`);
            }
            
            return isHealthy;
            
        } catch (error) {
            logger.debug(`Health check failed: ${error.message}`);
            return false;
        }
    }

    async recoverClient(number) {
        try {
            logger.info(`Attempting to recover client ${number}`);
            
            // Usar el retry manager
            await this.retryManager.execute(`recover_${number}`, async () => {
                await this.restartClient(number);
            });
            
        } catch (error) {
            logger.error(`Failed to recover client ${number}:`, error);
        }
    }

    setupEventHandlers() {
        // Delegar manejo de eventos al EventHandler
        this.eventHandler.on('qrUpdated', (number, qr) => {
            this.qrCodes.set(number, qr);
            this.emit('qrUpdated', number, qr);
        });

        this.eventHandler.on('clientReady', (number) => {
            this.clientStates.set(number, 'ready');
            this.messageQueue.processQueue(number, this.getClient(number));
            this.emit('ready', { number });
        });

        this.eventHandler.on('clientAuthenticated', (number) => {
            this.emit('authenticated', { number });
        });

        this.eventHandler.on('clientAuthFailure', (number, message) => {
            this.emit('auth_failure', { number, message });
            this.handleAuthFailure(number);
        });

        this.eventHandler.on('messageReceived', (number, message) => {
            this.emit('message', { number, message });
        });

        this.eventHandler.on('statusMessage', (number, message) => {
            this.emit('status', { number, message });
        });

        this.eventHandler.on('clientDisconnected', (number, reason) => {
            this.clientStates.set(number, 'disconnected');
            this.handleReconnection(number, reason);
            this.emit('disconnected', { number, reason });
        });

        // Eventos de grupo
        this.eventHandler.on('contactChanged', (data) => {
            this.emit('contactChanged', data);
        });

        this.eventHandler.on('groupAdminChanged', (data) => {
            this.emit('groupAdminChanged', data);
        });

        this.eventHandler.on('groupJoin', (data) => {
            this.emit('groupJoin', data);
        });

        this.eventHandler.on('groupLeave', (data) => {
            this.emit('groupLeave', data);
        });

        this.eventHandler.on('messageReaction', (data) => {
            this.emit('messageReaction', data);
        });
    }

    async createClient(number) {
        // Usar semáforo para limitar operaciones concurrentes
        const release = await this.operationSemaphore.acquire();
        
        try {
            const retryCount = this.retryAttempts.get(number) || 0;
            
            if (retryCount >= this.MAX_RETRIES) {
                logger.error(`Max retry attempts reached for client ${number}`);
                this.retryAttempts.delete(number);
                throw new Error('Max retry attempts reached');
            }

            const sessionPath = this.sessionManager.getSessionPath(number);
            const clientConfig = this.buildClientConfig(number, sessionPath);
            
            const client = new Client(clientConfig);
            
            // Configurar límites y timeouts
            client.pupPage?.setDefaultTimeout(30000);
            client.pupPage?.setDefaultNavigationTimeout(60000);
            
            this.clients.set(number, client);
            this.clientStates.set(number, 'initializing');
            
            // Configurar eventos con error handling mejorado
            this.eventHandler.setupClientEvents(client, number);
            
            // Inicializar con timeout
            await Promise.race([
                client.initialize(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Client initialization timeout')), 120000)
                )
            ]);
            
            // Reset retry count on successful connection
            this.retryAttempts.delete(number);
            logger.info(`Client ${number} initialized successfully`);
            
            return client;
        } catch (error) {
            this.retryAttempts.set(number, (this.retryAttempts.get(number) || 0) + 1);
            logger.error(`Error creating client ${number}:`, error);
            throw error;
        } finally {
            release();
        }
    }

     buildClientConfig(number, sessionPath) {
        return {
            authStrategy: new LocalAuth({
                clientId: number,
                dataPath: sessionPath
            }),
            puppeteer: {
                headless: false,
                executablePath: config.paths.chrome,
                args: [
                    ...config.whatsapp.puppeteerArgs
                ]
            },
            // Configuración adicional para estabilidad
            qrMaxRetries: 5,
            authTimeoutMs: 60000,
            takeoverOnConflict: false,
            restartOnAuthFail: true
        };
    }

    async loadExistingClients() {
        const existingSessions = await this.sessionManager.getExistingSessions();
        
        await Promise.all(
            existingSessions.map(number => this.addClient(number))
        );
    }

    async addClient(number) {
        try {
            await this.sessionManager.createSession(number);
            await this.createClient(number);
        } catch (error) {
            logger.error(`Failed to add client ${number}:`, error);
            throw error;
        }
    }

    async restartClient(number) {
        logger.info(`Restarting client ${number}`);
        
        try {
            await this.removeClient(number);
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.addClient(number);
            
            logger.info(`Client ${number} restarted successfully`);
        } catch (error) {
            logger.error(`Failed to restart client ${number}:`, error);
            throw error;
        }
    }

    async removeClient(number) {
        const client = this.clients.get(number);
        if (!client) {
            throw new Error(`Client ${number} not found`);
        }

        try {
            await this.cleanupClient(client);
            await client.logout();
            this.clients.delete(number);
            this.clientStates.delete(number);
            this.qrCodes.delete(number);
            this.retryAttempts.delete(number);
            
            await this.sessionManager.removeSession(number);
            logger.info(`Client ${number} removed successfully`);
        } catch (error) {
            logger.error(`Failed to remove client ${number}:`, error);
            throw error;
        }
    }

    async cleanupClient(client) {
        try {
            if (client.pupBrowser?.process()) {
                client.pupBrowser.process().kill('SIGINT');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            await client.destroy();
        } catch (error) {
            logger.error('Error cleaning up client:', error);
        }
    }

    handleAuthFailure(number) {
        logger.error(`Authentication failed for client ${number}`);
    }

    async handleReconnection(number, reason) {
        if (this.isShuttingDown) {
            logger.info(`Skipping reconnection for ${number} - service shutting down`);
            return;
        }
        
        // MODIFICADO: Verificar si ya hay reconexión en progreso con más detalle
        if (this.activeReconnections.has(number)) {
            logger.warn(`Reconnection already in progress for ${number}, ignoring new request`);
            return;
        }
        
        // NUEVO: Verificar tiempo desde última reconexión para evitar spam
        const healthStatus = this.clientHealthStatus.get(number);
        if (healthStatus && healthStatus.lastAttempt) {
            const timeSinceLastAttempt = Date.now() - healthStatus.lastAttempt;
            const minInterval = 120000; // 2 minutos mínimo entre reconexiones
            
            if (timeSinceLastAttempt < minInterval) {
                logger.warn(`Reconnection for ${number} too soon (${timeSinceLastAttempt}ms < ${minInterval}ms), skipping`);
                return;
            }
        }
        
        logger.info(`Client ${number} disconnected: ${reason}`);
        
        // Verificar límite de reconexiones concurrentes
        if (this.activeReconnections.size >= this.maxConcurrentReconnections) {
            logger.warn(`Max concurrent reconnections reached, queuing ${number}`);
            this.queueReconnection(number, reason);
            return;
        }
        
        this.activeReconnections.add(number);
        this.clientStates.set(number, 'reconnecting');
        
        try {
            await this.performReconnectionWithBackoff(number, reason);
        } catch (error) {
            logger.error(`Final reconnection failure for ${number}:`, error);
            this.emit('reconnection_failed', { number, error: error.message });
        } finally {
            this.activeReconnections.delete(number);
            this.processReconnectionQueue();
        }
    }

    async performReconnectionWithBackoff(number, reason) {
        const startTime = Date.now();
        let attempt = 0;
        let delay = this.reconnectionConfig.initialDelay;
        
        while (attempt < this.reconnectionConfig.maxRetries && !this.isShuttingDown) {
            attempt++;
            this.reconnectionMetrics.totalAttempts++;
            
            try {
                logger.info(`Reconnection attempt ${attempt}/${this.reconnectionConfig.maxRetries} for ${number}`);
                
                // CORREGIDO: Cleanup más completo del cliente existente
                const existingClient = this.clients.get(number);
                if (existingClient) {
                    await this.safeClientCleanup(existingClient, number);
                }
                
                // Esperar antes de la reconexión (excepto primer intento)
                if (attempt > 1) {
                    await this.sleep(delay);
                }
                
                // MODIFICADO: Intentar reconexión con mejor manejo de errores
                try {
                    await this.createClientWithValidation(number);
                } catch (createError) {
                    // Si falla la creación, limpiar estado y reintentar
                    logger.warn(`Client creation failed for ${number}: ${createError.message}`);
                    await this.forceCleanupClient(number);
                    throw createError;
                }
                
                // NUEVO: Verificar que la conexión es estable antes de continuar
                await this.verifyClientConnection(number, 30000);
                
                // Success!
                const reconnectionTime = Date.now() - startTime;
                this.updateReconnectionMetrics(reconnectionTime, true);
                this.clientHealthStatus.set(number, { 
                    status: 'healthy', 
                    lastCheck: Date.now(),
                    lastSuccessfulReconnection: Date.now()
                });
                
                logger.info(`Client ${number} reconnected successfully after ${attempt} attempts (${reconnectionTime}ms)`);
                this.emit('reconnected', { number, attempts: attempt, duration: reconnectionTime });
                return;
                
            } catch (error) {
                logger.error(`Reconnection attempt ${attempt} failed for ${number}:`, error.message);
                
                // NUEVO: Exponential backoff con jitter y límite
                const jitter = Math.random() * 1000;
                delay = Math.min(
                    this.reconnectionConfig.maxDelay,
                    delay * this.reconnectionConfig.backoffMultiplier + jitter
                );
                
                // Update health status con información del error
                this.clientHealthStatus.set(number, { 
                    status: 'reconnecting', 
                    lastAttempt: Date.now(), 
                    attempt,
                    error: error.message,
                    nextRetryIn: attempt < this.reconnectionConfig.maxRetries ? delay : null
                });
            }
        }
        
        // Todos los intentos fallaron
        this.updateReconnectionMetrics(Date.now() - startTime, false);
        this.clientHealthStatus.set(number, { 
            status: 'failed', 
            lastAttempt: Date.now(),
            totalAttempts: attempt,
            reason: 'max_retries_exceeded'
        });
        
        throw new Error(`Failed to reconnect ${number} after ${attempt} attempts`);
    }

    async createClientWithValidation(number) {
        // Verificar que no existe un cliente previo
        if (this.clients.has(number)) {
            logger.warn(`Client ${number} still exists during recreation, forcing cleanup`);
            await this.forceCleanupClient(number);
        }
        
        // Crear el cliente normalmente
        const client = await this.createClient(number);
        
        // Validación adicional
        if (!client) {
            throw new Error(`Client creation returned null for ${number}`);
        }
        
        return client;
    }

    async forceCleanupClient(number) {
        try {
            const client = this.clients.get(number);
            if (client) {
                // Remover todos los listeners para evitar eventos fantasma
                if (typeof client.removeAllListeners === 'function') {
                    client.removeAllListeners();
                }
                
                // Destruir el cliente con timeout
                const destroyPromise = Promise.race([
                    client.destroy(),
                    new Promise((resolve) => setTimeout(resolve, 5000))
                ]);
                
                await destroyPromise;
            }
            
            // Limpiar de todas las estructuras
            this.clients.delete(number);
            this.clientStates.delete(number);
            this.qrCodes.delete(number);
            this.retryAttempts.delete(number);
            
            logger.debug(`Forced cleanup completed for ${number}`);
            
        } catch (error) {
            logger.error(`Error in force cleanup for ${number}:`, error);
            // Forzar limpieza incluso si hay errores
            this.clients.delete(number);
            this.clientStates.delete(number);
            this.qrCodes.delete(number);
            this.retryAttempts.delete(number);
        }
    }

    // Métodos de consulta
    getClient(number) {
        const client = this.clients.get(number);
        if (!client) {
            throw new Error(`Client ${number} not found`);
        }
        
        // Actualizar última actividad
        client.lastActivity = Date.now();
        return client;
    }

    getQrCode(number) {
        return this.qrCodes.get(number);
    }

    // Alias para compatibilidad con código original
    getQr(number) {
        return this.getQrCode(number);
    }

    isReady(number) {
        return this.clientStates.get(number) === 'ready';
    }

    isAuthenticated(number) {
        const client = this.clients.get(number);
        return Boolean(client?.info?.pushname);
    }

    getAuthenticatedAccounts() {
        if (this.clients.size === 0) {
            logger.warn('No WhatsApp clients available');
            return [];
        }

        return Array.from(this.clients.entries())
            .filter(([number]) => this.isAuthenticated(number))
            .map(([number, client]) => ({
                number,
                displayName: client.info?.pushname || 'Not available',
                phoneNumber: client.info?.me?.user || 'Not available',
                status: this.clientStates.get(number) || 'unknown',
                lastActivity: client.lastActivity || null
            }));
    }

    // Alias para compatibilidad con código original
    getAuthenticatedAccountsInfo() {
        if (this.clients.size === 0) {
            logger.warn('No WhatsApp clients available');
            return [];
        }

        return Array.from(this.clients.entries())
            .filter(([number]) => this.isAuthenticated(number))
            .map(([number, client]) => ({
                number,
                display_name: client.info?.pushname || 'Not available',
                phone_number: client.info?.me?.user || 'Not available',
                serialized: client.info?.wid?._serialized,
                server: client.info?.server || 'c.us',
                status: client.getState ? client.getState() : this.clientStates.get(number),
                last_seen: client.info?.lastSeen || null,
                last_activity: client.lastActivity || null
            }));
    }

    // Delegación de envío de mensajes
    async sendMessage(number, to, message, options = {}) {
        const cacheKey = `msg_${number}_${to}_${JSON.stringify(message)}`;
        
        // Verificar cache para evitar duplicados
        if (this.operationCache.has(cacheKey)) {
            const cachedResult = this.operationCache.get(cacheKey);
            if (Date.now() - cachedResult.timestamp < this.cacheTimeout) {
                logger.debug(`Returning cached result for message ${cacheKey}`);
                return cachedResult.result;
            }
        }
        
        try {
            const result = await this.messageQueue.addMessage(number, to, message, this.getClient(number), options);
            
            // Cachear resultado exitoso
            this.operationCache.set(cacheKey, {
                result,
                timestamp: Date.now()
            });
            
            // Limpiar cache después del timeout
            setTimeout(() => {
                this.operationCache.delete(cacheKey);
            }, this.cacheTimeout);
            
            return result;
        } catch (error) {
            logger.error('Error during cleanup:', error);
            throw error;
        }
    }

    async sendBulkMessages(number, messages, options = {}) {
        const batchSize = options.batchSize || 10;
        const delay = options.delay || 1000;
        const results = [];
        
        logger.info(`Starting bulk message send: ${messages.length} messages from ${number}`);
        
        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (msg, index) => {
                try {
                    // Añadir delay aleatorio para evitar rate limiting
                    await new Promise(resolve => 
                        setTimeout(resolve, Math.random() * delay)
                    );
                    
                    const result = await this.sendMessage(number, msg.to, msg.message, msg.options);
                    return { success: true, result, originalIndex: i + index };
                } catch (error) {
                    logger.error(`Bulk message failed at index ${i + index}:`, error);
                    return { success: false, error: error.message, originalIndex: i + index };
                }
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults.map(r => r.value));
            
            // Pausa entre batches
            if (i + batchSize < messages.length) {
                await new Promise(resolve => setTimeout(resolve, delay * 2));
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        logger.info(`Bulk message completed: ${successCount}/${messages.length} successful`);
        
        return {
            total: messages.length,
            successful: successCount,
            failed: messages.length - successCount,
            results
        };
    }

    // Nuevo: Limpieza y mantenimiento periódico
    async performMaintenance() {
        if (this.isShuttingDown) return;
        
        logger.debug('Performing maintenance tasks');
        
        try {
            // 1. Limpiar cache de operaciones
            const now = Date.now();
            let cleanedCacheEntries = 0;
            
            for (const [key, value] of this.operationCache.entries()) {
                if (now - value.timestamp > this.cacheTimeout) {
                    this.operationCache.delete(key);
                    cleanedCacheEntries++;
                }
            }
            
            if (cleanedCacheEntries > 0) {
                logger.debug(`Cleaned ${cleanedCacheEntries} cache entries`);
            }
            
            // 2. Limpiar entradas de reconexión antiguas
            let cleanedReconnectionEntries = 0;
            for (const [number, data] of this.reconnectionQueue.entries()) {
                if (now - data.queuedAt > 600000) { // 10 minutos
                    this.reconnectionQueue.delete(number);
                    cleanedReconnectionEntries++;
                }
            }
            
            if (cleanedReconnectionEntries > 0) {
                logger.debug(`Cleaned ${cleanedReconnectionEntries} stale reconnection queue entries`);
            }
            
            // 3. Limpiar estado de salud antiguo
            let cleanedHealthEntries = 0;
            for (const [number, status] of this.clientHealthStatus.entries()) {
                if (!this.clients.has(number)) {
                    const lastActivity = status.lastCheck || status.lastAttempt || 0;
                    if (now - lastActivity > 300000) { // 5 minutos
                        this.clientHealthStatus.delete(number);
                        cleanedHealthEntries++;
                    }
                }
            }
            
            if (cleanedHealthEntries > 0) {
                logger.debug(`Cleaned ${cleanedHealthEntries} stale health status entries`);
            }
            
            // 4. MODIFICADO: Memory check menos agresivo
            const memUsage = process.memoryUsage();
            const memLimitMB = 1000; // Aumentado a 1GB
            const currentMemMB = memUsage.heapUsed / 1024 / 1024;
            
            if (currentMemMB > memLimitMB) {
                logger.warn(`High memory usage detected: ${Math.round(currentMemMB)}MB > ${memLimitMB}MB`);
                
                // Solo forzar GC si está disponible y la memoria es crítica
                if (global.gc && currentMemMB > memLimitMB * 1.2) {
                    logger.info('Forcing garbage collection due to critical memory usage');
                    global.gc();
                }
            }
            
            // 5. NUEVO: Limpiar clientes inactivos solo si hay muchos
            if (this.clients.size > 10) {
                await this.cleanupInactiveClients();
            }
            
        } catch (error) {
            logger.error('Maintenance task failed:', error);
        }
    }

    async cleanupInactiveClients() {
        const inactiveThreshold = 60 * 60 * 1000; // Aumentado a 1 hora
        const now = Date.now();
        const clientsToCheck = [];
        
        for (const [number, client] of this.clients.entries()) {
            try {
                const lastActivity = client.lastActivity || client.initTimestamp || now;
                
                // Solo verificar clientes que han estado inactivos por mucho tiempo
                if (now - lastActivity > inactiveThreshold) {
                    clientsToCheck.push(number);
                }
            } catch (error) {
                logger.error(`Error checking client ${number} activity:`, error);
            }
        }
        
        // Verificar health de clientes inactivos (máximo 3 a la vez)
        const maxChecks = Math.min(clientsToCheck.length, 3);
        
        for (let i = 0; i < maxChecks; i++) {
            const number = clientsToCheck[i];
            const client = this.clients.get(number);
            
            if (!client) continue;
            
            try {
                const isHealthy = await this.isClientHealthy(client);
                
                if (!isHealthy) {
                    logger.info(`Cleaning up inactive unhealthy client ${number}`);
                    await this.removeClient(number);
                }
            } catch (error) {
                logger.error(`Error checking inactive client ${number}:`, error);
            }
        }
    }

    async verifyClientConnection(number, timeout = 30000) {
        const client = this.clients.get(number);
        if (!client) {
            throw new Error(`Client ${number} not found after creation`);
        }
        
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Connection verification timeout'));
            }, timeout);
            
            let attempts = 0;
            const maxAttempts = Math.floor(timeout / 2000); // Un intento cada 2 segundos
            
            const checkConnection = async () => {
                attempts++;
                
                try {
                    const state = await client.getState();
                    
                    // MODIFICADO: Aceptar más estados como válidos
                    if (state === 'CONNECTED') {
                        clearTimeout(timeoutId);
                        resolve(true);
                        return;
                    }
                    
                    // Si el estado no es final y aún tenemos intentos
                    if (attempts < maxAttempts && !['CONFLICT', 'UNLAUNCHED'].includes(state)) {
                        setTimeout(checkConnection, 2000);
                    } else {
                        clearTimeout(timeoutId);
                        reject(new Error(`Client verification failed - final state: ${state}`));
                    }
                    
                } catch (error) {
                    if (attempts < maxAttempts) {
                        setTimeout(checkConnection, 2000);
                    } else {
                        clearTimeout(timeoutId);
                        reject(error);
                    }
                }
            };
            
            // Comenzar verificación inmediatamente
            checkConnection();
        });
    }

    // 5. Nuevo método: Cleanup seguro del cliente
    async safeClientCleanup(client, number) {
        if (this.cleanupInProgress.has(number)) {
            logger.warn(`Cleanup already in progress for ${number}`);
            return;
        }
        
        this.cleanupInProgress.add(number);
        
        try {
            // 1. Remover todos los event listeners PRIMERO
            if (client && typeof client.removeAllListeners === 'function') {
                client.removeAllListeners();
            }
            
            // 2. Cleanup con timeout más corto
            const cleanupPromise = Promise.race([
                this.cleanupClient(client),
                new Promise((resolve) => setTimeout(resolve, 10000)) // Reducido a 10s
            ]);
            
            await cleanupPromise;
            
            // 3. Remover de collections
            this.clients.delete(number);
            this.clientStates.delete(number);
            this.qrCodes.delete(number);
            
            logger.debug(`Safe cleanup completed for ${number}`);
            
        } catch (error) {
            logger.error(`Error during safe cleanup for ${number}:`, error);
            // Force removal incluso si el cleanup falla
            this.clients.delete(number);
            this.clientStates.delete(number);
            this.qrCodes.delete(number);
        } finally {
            this.cleanupInProgress.delete(number);
        }
    }

    // 6. Nuevo método: Cola de reconexiones
    queueReconnection(number, reason) {
        this.reconnectionQueue.set(number, { reason, queuedAt: Date.now() });
        logger.info(`Reconnection queued for ${number}`);
    }

    processReconnectionQueue() {
        if (this.reconnectionQueue.size === 0) return;
        if (this.activeReconnections.size >= this.maxConcurrentReconnections) return;
        
        // Process oldest queued reconnection
        const [number, data] = this.reconnectionQueue.entries().next().value;
        this.reconnectionQueue.delete(number);
        
        logger.info(`Processing queued reconnection for ${number}`);
        this.handleReconnection(number, data.reason);
    }

    sleep(ms) {
        return new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            
            // Allow early resolution if shutting down
            const checkShutdown = () => {
                if (this.isShuttingDown) {
                    clearTimeout(timer);
                    resolve();
                } else {
                    setTimeout(checkShutdown, 100);
                }
            };
            checkShutdown();
        });
    }

    updateReconnectionMetrics(duration, success) {
        if (success) {
            this.reconnectionMetrics.successfulReconnections++;
            
            // Update average reconnection time
            const totalSuccessful = this.reconnectionMetrics.successfulReconnections;
            const currentAvg = this.reconnectionMetrics.averageReconnectionTime;
            this.reconnectionMetrics.averageReconnectionTime = 
                (currentAvg * (totalSuccessful - 1) + duration) / totalSuccessful;
        } else {
            this.reconnectionMetrics.failedReconnections++;
        }
    }

    getReconnectionMetrics() {
        return {
            ...this.reconnectionMetrics,
            activeReconnections: this.activeReconnections.size,
            queuedReconnections: this.reconnectionQueue.size,
            healthStatus: Object.fromEntries(this.clientHealthStatus),
            successRate: this.reconnectionMetrics.totalAttempts > 0 ? 
                (this.reconnectionMetrics.successfulReconnections / this.reconnectionMetrics.totalAttempts) * 100 : 0
        };
    }

    async cancelAllReconnections() {
        logger.info('Cancelling all pending reconnections...');
        
        try {
            // Cancelar reconexiones activas
            for (const number of this.activeReconnections) {
                logger.info(`Cancelling active reconnection for ${number}`);
                this.activeReconnections.delete(number);
                this.clientStates.set(number, 'cancelled');
            }
            
            // Limpiar cola de reconexiones
            this.reconnectionQueue.clear();
            
            // Limpiar timers de reconexión
            for (const [number, timerId] of this.reconnectionTimers.entries()) {
                clearTimeout(timerId);
                this.reconnectionTimers.delete(number);
            }
            
            // Limpiar estado de salud
            this.clientHealthStatus.clear();
            
            logger.info(`Cancelled ${this.activeReconnections.size} active reconnections and cleared queue`);
            
        } catch (error) {
            logger.error('Error cancelling reconnections:', error);
        }
    }

    cancelReconnection(number) {
        try {
            // Remover de reconexiones activas
            if (this.activeReconnections.has(number)) {
                this.activeReconnections.delete(number);
                this.clientStates.set(number, 'cancelled');
                logger.info(`Cancelled active reconnection for ${number}`);
            }
            
            // Remover de cola
            if (this.reconnectionQueue.has(number)) {
                this.reconnectionQueue.delete(number);
                logger.info(`Removed ${number} from reconnection queue`);
            }
            
            // Cancelar timer si existe
            const timerId = this.reconnectionTimers.get(number);
            if (timerId) {
                clearTimeout(timerId);
                this.reconnectionTimers.delete(number);
            }
            
            // Limpiar estado de salud
            this.clientHealthStatus.delete(number);
            
            return true;
            
        } catch (error) {
            logger.error(`Error cancelling reconnection for ${number}:`, error);
            return false;
        }
    }

    async destroyAll() {
        logger.info('Destroying all WhatsApp clients...');
        this.isShuttingDown = true;
        
        try {
            // 1. Cancelar todas las reconexiones PRIMERO
            await this.cancelAllReconnections();
            
            // 2. Obtener lista de clientes de forma segura
            const clientEntries = Array.from(this.clients.entries());
            
            if (clientEntries.length === 0) {
                logger.info('No clients to destroy');
                return;
            }
            
            logger.info(`Destroying ${clientEntries.length} clients...`);
            
            // 3. Procesar en lotes para evitar sobrecarga
            const batchSize = 3;
            
            for (let i = 0; i < clientEntries.length; i += batchSize) {
                const batch = clientEntries.slice(i, i + batchSize);
                
                const cleanupPromises = batch.map(async ([number, client]) => {
                    try {
                        logger.info(`Destroying client ${number}`);
                        
                        // Cleanup con timeout por cliente
                        const cleanupPromise = this.safeClientCleanup(client, number);
                        const timeoutPromise = new Promise((resolve) => 
                            setTimeout(resolve, 8000) // 8 segundos por cliente
                        );
                        
                        await Promise.race([cleanupPromise, timeoutPromise]);
                        
                        logger.info(`Client ${number} destroyed successfully`);
                        
                    } catch (error) {
                        logger.error(`Error destroying client ${number}:`, error);
                        // Force cleanup incluso si falla
                        this.clients.delete(number);
                        this.clientStates.delete(number);
                        this.qrCodes.delete(number);
                        this.retryAttempts.delete(number);
                    }
                });
                
                // Esperar el lote con timeout global
                const batchPromise = Promise.allSettled(cleanupPromises);
                const batchTimeout = new Promise(resolve => setTimeout(resolve, 15000));
                
                await Promise.race([batchPromise, batchTimeout]);
                
                // Pausa pequeña entre lotes
                if (i + batchSize < clientEntries.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            // 4. Limpieza final forzada
            this.clients.clear();
            this.clientStates.clear();
            this.qrCodes.clear();
            this.retryAttempts.clear();
            this.operationCache.clear();
            this.cleanupInProgress.clear();
            
            logger.info('All WhatsApp clients destroyed');
            
        } catch (error) {
            logger.error('Error during destroyAll:', error);
            
            // Force clear all collections
            this.clients.clear();
            this.clientStates.clear();
            this.qrCodes.clear();
            this.retryAttempts.clear();
            this.operationCache.clear();
            this.cleanupInProgress.clear();
        }
    }
}

module.exports = WhatsAppClient;