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
        
        WhatsAppClient.instance = this;

        setInterval(() => this.performMaintenance(), 300000);
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
        const healthChecks = Array.from(this.clients.entries()).map(async ([number, client]) => {
            try {
                const isHealthy = await this.isClientHealthy(client);
                
                if (!isHealthy) {
                    logger.warn(`Client ${number} is unhealthy, attempting recovery`);
                    await this.recoverClient(number);
                }
                
                return { number, healthy: isHealthy };
            } catch (error) {
                logger.error(`Health check failed for client ${number}:`, error);
                return { number, healthy: false, error: error.message };
            }
        });

        const results = await Promise.allSettled(healthChecks);
        const healthyCount = results.filter(r => r.status === 'fulfilled' && r.value.healthy).length;
        
        this.healthMonitor.recordHealthCheck(healthyCount, this.clients.size);
    }

    async isClientHealthy(client) {
        try {
            // Timeout rápido para health check
            const healthCheck = Promise.race([
                client.getState(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Health check timeout')), 5000)
                )
            ]);
            
            const state = await healthCheck;
            return state === 'CONNECTED';
        } catch (error) {
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
        logger.info(`Client ${number} disconnected: ${reason}`);
        
        const retryKey = `reconnect_${number}`;
        
        try {
            await this.retryManager.execute(retryKey, async () => {
                const client = this.clients.get(number);
                if (client) {
                    await this.cleanupClient(client);
                    this.clients.delete(number);
                }
                
                this.clientStates.set(number, 'reconnecting');
                
                logger.info(`Attempting reconnection for client ${number}`);
                await this.addClient(number);
                
                logger.info(`Client ${number} reconnected successfully`);
            });
            
        } catch (error) {
            logger.error(`Failed to reconnect client ${number}:`, error);
            this.emit('reconnection_failed', { number, error: error.message });
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
        logger.debug('Performing maintenance tasks');
        
        try {
            // Limpiar cache expirado
            const now = Date.now();
            for (const [key, value] of this.operationCache.entries()) {
                if (now - value.timestamp > this.cacheTimeout) {
                    this.operationCache.delete(key);
                }
            }
            
            // Recolectar métricas de memoria
            const memUsage = process.memoryUsage();
            if (memUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
                logger.warn('High memory usage detected, forcing garbage collection');
                if (global.gc) {
                    global.gc();
                }
            }
            
            // Verificar clientes inactivos
            await this.cleanupInactiveClients();
            
        } catch (error) {
            logger.error('Maintenance task failed:', error);
        }
    }

    async cleanupInactiveClients() {
        const inactiveThreshold = 30 * 60 * 1000; // 30 minutos
        const now = Date.now();
        
        for (const [number, client] of this.clients.entries()) {
            try {
                const lastActivity = client.lastActivity || client.initTimestamp || now;
                
                if (now - lastActivity > inactiveThreshold) {
                    const isHealthy = await this.isClientHealthy(client);
                    
                    if (!isHealthy) {
                        logger.info(`Cleaning up inactive client ${number}`);
                        await this.removeClient(number);
                    }
                }
            } catch (error) {
                logger.error(`Error checking client ${number} activity:`, error);
            }
        }
    }
}

module.exports = WhatsAppClient;