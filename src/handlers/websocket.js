// ===============================
// 5. MEJORAS EN handlers/websocket.js
// ===============================

const WebSocket = require('ws');
const { wsLogger: logger } = require('../config/logger');
const EventEmitter = require('events');
const CircuitBreaker = require('../utils/circuitBreaker');

class WebSocketHandler extends EventEmitter {
    constructor(wss, options = {}) {
        super();
        this.wss = wss;
        this.subscribers = new Map();
        this.connectionStats = new Map();
        this.messageQueue = [];
        this.isProcessingQueue = false;
        
        // Configuración
        this.maxConnections = options.maxConnections || 1000;
        this.heartbeatInterval = options.heartbeatInterval || 30000;
        this.maxMessageRate = options.maxMessageRate || 100; // mensajes por segundo
        this.queueMaxSize = options.queueMaxSize || 10000;
        
        // Rate limiting por conexión
        this.rateLimiter = new Map();
        this.rateLimitWindow = 60000; // 1 minuto
        this.rateLimitMax = 60; // máximo de mensajes por minuto por conexión
        
        // Circuit breaker para broadcast
        this.broadcastCircuitBreaker = new CircuitBreaker('websocket_broadcast', {
            failureThreshold: 5,
            recoveryTimeout: 10000,
            monitoringPeriod: 30000
        });
        
        // Métricas
        this.metrics = {
            totalConnections: 0,
            activeConnections: 0,
            messagesReceived: 0,
            messagesSent: 0,
            broadcastsSent: 0,
            errors: 0,
            lastActivity: Date.now()
        };
        
        this.setupHeartbeat();
        this.startMetricsCollection();
        this.startQueueProcessor();
        
        // Cleanup automático cada 5 minutos
        setInterval(() => this.cleanup(), 300000);
    }

    setupHeartbeat() {
        this.wss.on('connection', (ws, request) => {
            this.handleNewConnection(ws, request);
        });

        // Heartbeat mejorado con detección de conexiones muertas
        setInterval(() => {
            this.performHeartbeat();
        }, this.heartbeatInterval);
    }

    handleNewConnection(ws, request) {
        // Verificar límite de conexiones
        if (this.wss.clients.size >= this.maxConnections) {
            logger.warn(`Connection limit reached, rejecting new connection from ${this.getClientIP(request)}`);
            ws.close(1013, 'Server overloaded');
            return;
        }

        // Configurar propiedades de la conexión
        ws.id = this.generateConnectionId();
        ws.ip = this.getClientIP(request);
        ws.isAlive = true;
        ws.connectedAt = Date.now();
        ws.lastActivity = Date.now();
        ws.messageCount = 0;
        
        // Rate limiting setup
        this.rateLimiter.set(ws.id, {
            messages: [],
            blocked: false,
            blockUntil: 0
        });
        
        // Estadísticas de conexión
        this.connectionStats.set(ws.id, {
            connectedAt: Date.now(),
            messagesReceived: 0,
            messagesSent: 0,
            errors: 0
        });

        logger.info(`Nueva conexión WebSocket: ID=${ws.id}, IP=${ws.ip}`);
        
        // Event handlers
        ws.on('pong', () => {
            ws.isAlive = true;
            ws.lastActivity = Date.now();
        });
        
        ws.on('message', (message) => {
            this.handleMessage(ws, message);
        });
        
        ws.on('close', (code, reason) => {
            this.handleClose(ws, code, reason);
        });
        
        ws.on('error', (error) => {
            this.handleError(ws, error);
        });

        // Actualizar métricas
        this.metrics.totalConnections++;
        this.metrics.activeConnections = this.wss.clients.size;
        
        // Enviar mensaje de bienvenida
        this.sendToClient(ws, {
            type: 'connection_established',
            data: {
                connectionId: ws.id,
                serverTime: new Date().toISOString()
            }
        });
    }

    handleMessage(ws, message) {
        try {
            // Rate limiting check
            if (!this.checkRateLimit(ws)) {
                logger.warn(`Rate limit exceeded for connection ${ws.id}`);
                ws.close(1008, 'Rate limit exceeded');
                return;
            }

            ws.lastActivity = Date.now();
            ws.messageCount++;
            this.metrics.messagesReceived++;
            
            const stats = this.connectionStats.get(ws.id);
            if (stats) {
                stats.messagesReceived++;
            }

            const data = JSON.parse(message);
            logger.debug(`WebSocket mensaje recibido de ${ws.id}: ${data.action || 'unknown'}`);

            // Procesar diferentes tipos de mensajes
            switch (data.action) {
                case 'subscribe':
                    this.handleSubscription(ws, data);
                    break;
                    
                case 'unsubscribe':
                    this.handleUnsubscription(ws, data);
                    break;
                    
                case 'ping':
                    this.handlePing(ws, data);
                    break;
                    
                case 'get_stats':
                    this.handleStatsRequest(ws);
                    break;
                    
                default:
                    this.handleGenericMessage(ws, data);
            }

        } catch (error) {
            logger.error(`Error procesando mensaje WebSocket de ${ws.id}:`, error);
            this.handleError(ws, error);
        }
    }

    checkRateLimit(ws) {
        const now = Date.now();
        const limiter = this.rateLimiter.get(ws.id);
        
        if (!limiter) return true;
        
        // Si está bloqueado, verificar si ya puede enviar mensajes
        if (limiter.blocked && now < limiter.blockUntil) {
            return false;
        }
        
        // Limpiar mensajes antiguos
        limiter.messages = limiter.messages.filter(
            timestamp => now - timestamp < this.rateLimitWindow
        );
        
        // Verificar límite
        if (limiter.messages.length >= this.rateLimitMax) {
            limiter.blocked = true;
            limiter.blockUntil = now + this.rateLimitWindow;
            return false;
        }
        
        // Registrar mensaje
        limiter.messages.push(now);
        limiter.blocked = false;
        
        return true;
    }

    handleSubscription(ws, data) {
        if (!data.number) {
            this.sendError(ws, 'Missing number for subscription');
            return;
        }

        ws.subscribedNumber = data.number;
        
        if (!this.subscribers.has(data.number)) {
            this.subscribers.set(data.number, new Set());
        }
        
        this.subscribers.get(data.number).add(ws);
        
        logger.info(`Cliente ${ws.id} suscrito al número: ${data.number}`);
        
        this.sendToClient(ws, {
            type: 'subscription_confirmed',
            data: { number: data.number }
        });
    }

    handleUnsubscription(ws, data) {
        const number = data.number || ws.subscribedNumber;
        
        if (number && this.subscribers.has(number)) {
            this.subscribers.get(number).delete(ws);
            
            if (this.subscribers.get(number).size === 0) {
                this.subscribers.delete(number);
            }
        }
        
        ws.subscribedNumber = null;
        logger.info(`Cliente ${ws.id} desuscrito del número: ${number}`);
        
        this.sendToClient(ws, {
            type: 'unsubscription_confirmed',
            data: { number }
        });
    }

    handlePing(ws, data) {
        ws.isAlive = true;
        ws.lastActivity = Date.now();
        
        this.sendToClient(ws, {
            type: 'pong',
            data: {
                timestamp: new Date().toISOString(),
                serverUptime: process.uptime()
            }
        });
    }

    handleStatsRequest(ws) {
        const connectionStats = this.connectionStats.get(ws.id) || {};
        
        this.sendToClient(ws, {
            type: 'stats',
            data: {
                server: this.getServerStats(),
                connection: {
                    id: ws.id,
                    connectedAt: new Date(connectionStats.connectedAt).toISOString(),
                    uptime: Date.now() - connectionStats.connectedAt,
                    messagesReceived: connectionStats.messagesReceived,
                    messagesSent: connectionStats.messagesSent
                }
            }
        });
    }

    handleGenericMessage(ws, data) {
        // Broadcast del mensaje a otros clientes si es necesario
        this.emit('client_message', {
            connectionId: ws.id,
            ip: ws.ip,
            data
        });
    }

    handleClose(ws, code, reason) {
        logger.info(`Conexión WebSocket cerrada: ID=${ws.id}, Code=${code}, Reason=${reason}`);
        
        // Cleanup de suscripciones
        this.unsubscribeClientFromAll(ws);
        
        // Cleanup de rate limiting
        this.rateLimiter.delete(ws.id);
        
        // Cleanup de estadísticas
        this.connectionStats.delete(ws.id);
        
        // Actualizar métricas
        this.metrics.activeConnections = this.wss.clients.size;
    }

    handleError(ws, error) {
        logger.error(`WebSocket error para conexión ${ws.id}:`, error);
        
        const stats = this.connectionStats.get(ws.id);
        if (stats) {
            stats.errors++;
        }
        
        this.metrics.errors++;
        
        // Enviar error al cliente si la conexión sigue abierta
        if (ws.readyState === WebSocket.OPEN) {
            this.sendError(ws, 'Internal server error');
        }
    }

    performHeartbeat() {
        const deadConnections = [];
        
        this.wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                logger.info(`Terminando conexión inactiva: ${ws.id}`);
                deadConnections.push(ws);
                return;
            }
            
            ws.isAlive = false;
            
            try {
                ws.ping();
            } catch (error) {
                logger.error(`Error enviando ping a ${ws.id}:`, error);
                deadConnections.push(ws);
            }
        });
        
        // Terminar conexiones muertas
        deadConnections.forEach(ws => {
            try {
                ws.terminate();
            } catch (error) {
                logger.error(`Error terminando conexión ${ws.id}:`, error);
            }
        });
    }

    // Broadcast mejorado con circuit breaker y queue
    async broadcast(eventType, data, options = {}) {
        try {
            await this.broadcastCircuitBreaker.execute(async () => {
                const message = {
                    type: 'broadcast',
                    eventType,
                    data,
                    timestamp: new Date().toISOString()
                };
                
                await this.sendToAllClients(message, options);
                this.metrics.broadcastsSent++;
            });
        } catch (error) {
            logger.error('Broadcast failed:', error);
            throw error;
        }
    }

    async broadcastToSubscribers(eventType, data, number, options = {}) {
        if (!number) {
            logger.warn('Intento de broadcast sin especificar número');
            return;
        }
        
        const subscribers = this.subscribers.get(number);
        
        if (!subscribers || subscribers.size === 0) {
            logger.debug(`No hay suscriptores para el número ${number}`);
            return;
        }
        
        const message = {
            type: 'subscription_message',
            eventType,
            data,
            number,
            timestamp: new Date().toISOString()
        };
        
        logger.info(`Enviando ${eventType} a ${subscribers.size} suscriptores del número ${number}`);
        
        await this.sendToClients(Array.from(subscribers), message, options);
    }

    // Envío optimizado con queue para manejar alta concurrencia
    async sendToAllClients(message, options = {}) {
        const clients = Array.from(this.wss.clients);
        await this.sendToClients(clients, message, options);
    }

    async sendToClients(clients, message, options = {}) {
        const { 
            timeout = 5000, 
            concurrent = 50,
            retries = 1 
        } = options;
        
        const payload = JSON.stringify(message);
        const chunks = this.chunkArray(clients, concurrent);
        
        for (const chunk of chunks) {
            const sendPromises = chunk.map(client => 
                this.sendToClientWithRetry(client, payload, timeout, retries)
            );
            
            await Promise.allSettled(sendPromises);
        }
    }

    async sendToClientWithRetry(client, payload, timeout, retries) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                if (client.readyState === WebSocket.OPEN) {
                    await Promise.race([
                        new Promise((resolve, reject) => {
                            client.send(payload, (error) => {
                                if (error) reject(error);
                                else resolve();
                            });
                        }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Send timeout')), timeout)
                        )
                    ]);
                    
                    // Actualizar estadísticas
                    const stats = this.connectionStats.get(client.id);
                    if (stats) {
                        stats.messagesSent++;
                    }
                    
                    this.metrics.messagesSent++;
                    return;
                }
            } catch (error) {
                if (attempt === retries) {
                    logger.error(`Failed to send message to client ${client.id} after ${retries + 1} attempts:`, error);
                    this.handleError(client, error);
                }
            }
        }
    }

    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
                
                const stats = this.connectionStats.get(ws.id);
                if (stats) {
                    stats.messagesSent++;
                }
                
                this.metrics.messagesSent++;
            } catch (error) {
                this.handleError(ws, error);
            }
        }
    }

    sendError(ws, errorMessage) {
        this.sendToClient(ws, {
            type: 'error',
            data: {
                message: errorMessage,
                timestamp: new Date().toISOString()
            }
        });
    }

    // Queue processor para manejar mensajes en cola
    startQueueProcessor() {
        setInterval(() => {
            if (!this.isProcessingQueue && this.messageQueue.length > 0) {
                this.processMessageQueue();
            }
        }, 100); // Procesar cada 100ms
    }

    async processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        
        try {
            const batchSize = Math.min(this.maxMessageRate, this.messageQueue.length);
            const batch = this.messageQueue.splice(0, batchSize);
            
            const processPromises = batch.map(async (item) => {
                try {
                    if (item.type === 'broadcast') {
                        await this.sendToAllClients(item.message, item.options);
                    } else if (item.type === 'subscribers') {
                        await this.broadcastToSubscribers(
                            item.eventType, 
                            item.data, 
                            item.number, 
                            item.options
                        );
                    }
                } catch (error) {
                    logger.error('Error processing queued message:', error);
                }
            });
            
            await Promise.allSettled(processPromises);
        } finally {
            this.isProcessingQueue = false;
        }
    }

    // Utilidades
    unsubscribeClientFromAll(ws) {
        if (ws.subscribedNumber) {
            const subscriberSet = this.subscribers.get(ws.subscribedNumber);
            if (subscriberSet) {
                subscriberSet.delete(ws);
                if (subscriberSet.size === 0) {
                    this.subscribers.delete(ws.subscribedNumber);
                }
            }
            ws.subscribedNumber = null;
        }
    }

    generateConnectionId() {
        return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    getClientIP(request) {
        return request.headers['x-forwarded-for'] || 
               request.headers['x-real-ip'] || 
               request.connection?.remoteAddress || 
               request.socket?.remoteAddress ||
               'unknown';
    }

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    startMetricsCollection() {
        setInterval(() => {
            this.collectDetailedMetrics();
        }, 30000); // Cada 30 segundos
    }

    collectDetailedMetrics() {
        this.metrics.activeConnections = this.wss.clients.size;
        this.metrics.lastActivity = Date.now();
        
        // Métricas por número de suscriptores
        const subscriberMetrics = {};
        for (const [number, subscribers] of this.subscribers.entries()) {
            subscriberMetrics[number] = subscribers.size;
        }
        
        this.emit('metrics', {
            ...this.metrics,
            subscribers: subscriberMetrics,
            queueSize: this.messageQueue.length,
            memoryUsage: process.memoryUsage()
        });
    }

    getServerStats() {
        return {
            ...this.metrics,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            subscribers: Object.fromEntries(
                Array.from(this.subscribers.entries()).map(([number, subs]) => [number, subs.size])
            ),
            queueSize: this.messageQueue.length
        };
    }

    cleanup() {
        logger.debug('Performing WebSocket cleanup');
        
        // Limpiar rate limiters expirados
        const now = Date.now();
        for (const [connectionId, limiter] of this.rateLimiter.entries()) {
            if (limiter.blocked && now > limiter.blockUntil) {
                limiter.blocked = false;
                limiter.messages = [];
            }
        }
        
        // Limpiar estadísticas de conexiones cerradas
        for (const [connectionId] of this.connectionStats.entries()) {
            const hasConnection = Array.from(this.wss.clients).some(ws => ws.id === connectionId);
            if (!hasConnection) {
                this.connectionStats.delete(connectionId);
                this.rateLimiter.delete(connectionId);
            }
        }
    }

    // Método para cerrar el handler
    async close() {
        logger.info('Closing WebSocket handler');
        
        // Cerrar todas las conexiones
        this.wss.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1001, 'Server shutting down');
            }
        });
        
        // Limpiar recursos
        this.subscribers.clear();
        this.connectionStats.clear();
        this.rateLimiter.clear();
        this.messageQueue.length = 0;
        
        // Cerrar el servidor WebSocket
        return new Promise((resolve) => {
            this.wss.close(resolve);
        });
    }
}

module.exports = WebSocketHandler;