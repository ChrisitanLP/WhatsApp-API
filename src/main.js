// src/index.js
const cluster = require('cluster');
const os = require('os');

const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const WhatsAppClient = require('./services/whatsappClient');
const WebSocketHandler = require('./handlers/websocket');
const loggerModule = require('./config/logger');
const logger = loggerModule.logger;
const MessageProcessor = require('./utils/messageProcessor');
const { createApiRouter } = require('./routes/index');

const CircuitBreaker = require('./utils/circuitBreaker');
const HealthCheck = require('./utils/healtCheck');
const MetricsCollector = require('./utils/metricsCollector');
const GracefulShutdown = require('./utils/gracefulShutdown');

const rateLimit = require('express-rate-limit');

class WhatsAppServer {
    constructor(config = {}) {
        this.port = config.port || process.env.PORT || 5000;
        this.app = express();
        this.server = null;
        this.wss = null;
        this.webSocketHandler = null;
        this.whatsappClient = null;
        this.heartbeatInterval = config.heartbeatInterval || 30000;
        this.isShuttingDown = false;

        // Circuit breakers para servicios críticos
        this.circuitBreakers = {
            whatsapp: new CircuitBreaker('whatsapp', {
                failureThreshold: 5,
                recoveryTimeout: 30000,
                monitoringPeriod: 60000
            }),
            websocket: new CircuitBreaker('websocket', {
                failureThreshold: 3,
                recoveryTimeout: 15000
            })
        };

        // Métricas y monitoreo
        this.metrics = new MetricsCollector();
        this.healthCheck = new HealthCheck();
        this.gracefulShutdown = new GracefulShutdown();
        
        // Pool de conexiones WebSocket
        this.wsConnectionPool = new Map();
        this.maxWsConnections = config.maxWsConnections || 1000;
        
        this.staticPaths = {
            '/temp': path.join(__dirname, 'controllers/temp'),
            '/media': path.join(__dirname, 'media'),
            '/': path.join(__dirname, '../static')
        };
        
        this.pages = {
            '/': '../static/client.html',
            '/login': '../static/inicioSesion.html',
            '/home': '../static/chat.html'
        };

        // Nuevas propiedades para reconexión avanzada
        this.reconnectionConfig = {
            enableAutoReconnection: config.enableAutoReconnection !== false,
            maxConcurrentReconnections: config.maxConcurrentReconnections || 3,
            reconnectionMetricsInterval: 60000, // 1 minuto
            alertThresholds: {
                failureRate: 0.5, // 50% de fallos
                reconnectionTime: 300000, // 5 minutos
                queueSize: 10
            }
        };
        
        // Alertas y notificaciones
        this.alertManager = {
            lastAlert: new Map(),
            cooldownPeriod: 300000, // 5 minutos entre alertas del mismo tipo
            activeAlerts: new Set()
        };

        this.listenersSetup = false;
        this.shutdownInProgress = false;
    }

    async initialize() {
        try {
            this.setupMiddleware();
            this.setupStaticFiles();
            this.setupRoutes();
            this.setupWebSocket();
            this.setupWebSocketEvents()
            await this.initializeWhatsApp();
            this.setupWhatsAppEvents();

            this.setupHealthChecks();
            this.setupGracefulShutdown();

            logger.info('Server initialized successfully');

            return true;
        } catch (error) {
            logger.error('Failed to initialize server:', error);
            return false;
        }
    }

    setupMiddleware() {
        const requestSizeLimit = '50mb';
        
        // Rate limiting con Memory Store (sin Redis)
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutos
            max: 100, // límite por IP
            message: {
                error: 'Too many requests, please try again later',
                retryAfter: 900
            },
            standardHeaders: true,
            legacyHeaders: false,
            // Rate limit personalizado por cliente WhatsApp o IP
            keyGenerator: (req) => {
                return req.body?.number || req.ip;
            },
            // Configuración adicional para el memory store
            skipSuccessfulRequests: false,
            skipFailedRequests: false,
        });

        // Rate limiter específico para endpoints de WhatsApp
        const whatsappLimiter = rateLimit({
            windowMs: 1 * 60 * 1000, // 1 minuto
            max: 10, // máximo 10 mensajes por minuto por número
            message: {
                error: 'Too many messages sent, please wait before sending more',
                retryAfter: 60
            },
            keyGenerator: (req) => {
                return `whatsapp:${req.body?.number || req.ip}`;
            }
        });

        // Aplicar rate limiters
        this.app.use(limiter);
        
        // Rate limiter específico para rutas de WhatsApp
        this.app.use('/api/whatsapp', whatsappLimiter);

        logger.info('Rate limiting configured with Memory Store (no Redis required)');

        this.app.use(express.json({ limit: requestSizeLimit }));
        this.app.use(express.urlencoded({ 
            limit: requestSizeLimit, 
            extended: true 
        }));

        // Middleware de métricas
        this.app.use((req, res, next) => {
            const start = Date.now();
            
            res.on('finish', () => {
                const duration = Date.now() - start;
                this.metrics.recordHttpRequest(req.method, req.path, res.statusCode, duration);
            });
            
            next();
        });

        // Middleware de timeout
        this.app.use((req, res, next) => {
            res.setTimeout(30000, () => {
                if (!res.headersSent) {
                    res.status(408).json({ error: 'Request timeout' });
                }
            });
            next();
        });

        // Middleware de cors básico
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
            
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });
    }

    setupHealthChecks() {
        this.healthCheck.addCheck('whatsapp', async () => {
            const clientCount = this.whatsappClient?.clients?.size || 0;
            const readyClients = Array.from(this.whatsappClient?.clients || [])
                .filter(([_, client]) => this.whatsappClient.isReady(client)).length;
            
            return {
                status: clientCount > 0 ? 'healthy' : 'degraded',
                details: {
                    totalClients: clientCount,
                    readyClients: readyClients,
                    connectionRatio: clientCount > 0 ? readyClients / clientCount : 0
                }
            };
        });

        this.healthCheck.addCheck('websocket', () => {
            const wsConnections = this.wss?.clients?.size || 0;
            return {
                status: wsConnections < this.maxWsConnections ? 'healthy' : 'warning',
                details: {
                    activeConnections: wsConnections,
                    maxConnections: this.maxWsConnections,
                    utilization: wsConnections / this.maxWsConnections
                }
            };
        });

        this.healthCheck.addCheck('memory', () => {
            const memUsage = process.memoryUsage();
            const memLimit = 1024 * 1024 * 1024; // 1GB límite
            
            return {
                status: memUsage.heapUsed < memLimit ? 'healthy' : 'warning',
                details: {
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                    external: Math.round(memUsage.external / 1024 / 1024)
                }
            };
        });

        // Health check endpoint
        this.app.get('/health', async (req, res) => {
            try {
                const health = await this.getHealthStatus();
                const statusCode = health.status === 'healthy' ? 200 : 503;
                res.status(statusCode).json(health);
            } catch (error) {
                res.status(503).json({
                    status: 'error',
                    message: 'Health check failed',
                    error: error.message
                });
            }
        });
    }

    setupStaticFiles() {
        Object.entries(this.staticPaths).forEach(([route, dir]) => {
            this.app.use(route, express.static(dir, {
                maxAge: '6h', // Cache estático por 1 hora
                etag: true
            }));
        });
    }

    setupRoutes() {
        Object.entries(this.pages).forEach(([route, page]) => {
            this.app.get(route, (req, res) => {
                try {
                    res.sendFile(path.join(__dirname, page));
                } catch (error) {
                    logger.error(`Error serving page ${route}:`, error);
                    res.status(500).send('Internal Server Error');
                }
            });
        });
        
        // API routes with error handling
        try {
            const apiRouter = createApiRouter();
            this.app.use('/api', apiRouter);
        } catch (error) {
            logger.error('Failed to setup API routes:', error);
        }

        try {
            const docsRouter = require('./routes/docs');
            this.app.use('/docs', docsRouter);
            
            // REDIRECCIÓN única para mantener compatibilidad
            this.app.get('/api-docs', (req, res) => res.redirect('/docs'));   
        } catch (error) {
            logger.warn('Documentation routes not available:', error.message);
        }
        
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.originalUrl} not found`
            });
        });
        
        // Error handling middleware
        this.app.use((err, req, res, next) => {
            logger.error('Express error:', err);
            
            if (res.headersSent) {
                return next(err);
            }
            
            res.status(err.status || 500).json({ 
                error: 'Internal server error', 
                message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
            });
        });
    }

    setupWebSocket() {
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ 
            noServer: true,
            perMessageDeflate: {
                zlibDeflateOptions: {
                    level: 3
                }
            }
        });
        
        this.webSocketHandler = new WebSocketHandler(this.wss, {
            maxConnections: this.maxWsConnections,
            heartbeatInterval: this.heartbeatInterval
        });

        this.server.on('upgrade', (request, socket, head) => {
            // Verificar límite de conexiones
            if (this.wss.clients.size >= this.maxWsConnections) {
                socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
                socket.destroy();
                return;
            }

            this.wss.handleUpgrade(request, socket, head, ws => {
                this.wss.emit('connection', ws, request);
            });
        });
    }

    setupWebSocketEvents() {
        if (!this.webSocketHandler) {
            logger.warn('WebSocket handler not available for event setup');
            return;
        }

        // Escuchar eventos del WebSocket handler
        this.webSocketHandler.on('client_message', (data) => {
            logger.debug(`WebSocket client message from ${data.connectionId}: ${data.data.action || 'unknown'}`);
        });

        // Escuchar métricas del WebSocket
        this.webSocketHandler.on('metrics', (metrics) => {
            if (this.isShuttingDown) return;
            
            // Log periódico de métricas (cada 5 minutos)
            if (!this.lastMetricsLog || (Date.now() - this.lastMetricsLog) > 300000) {
                logger.info(`WebSocket metrics - Connections: ${metrics.activeConnections}, Messages: ${metrics.messagesSent}/${metrics.messagesReceived}, Broadcasts: ${metrics.broadcastsSent}`);
                
                this.lastMetricsLog = Date.now();
            }
        });

        logger.info('WebSocket events configured');
    }

    async initializeWhatsApp() {
        try {
            this.whatsappClient = new WhatsAppClient();
            
            // Inicializar con circuit breaker
            await this.circuitBreakers.whatsapp.execute(async () => {
                await this.whatsappClient.initialize();
            });
            
            logger.info('WhatsApp client initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize WhatsApp client:', error);
            throw error;
        }
    }

    setupWhatsAppEvents() {
        const events = {
            'authenticated': this.handleAuthenticated.bind(this),
            'ready': this.handleReady.bind(this),
            'message': this.handleMessage.bind(this),
            'disconnected': this.handleDisconnected.bind(this),
            'qrUpdated': this.handleQrUpdate.bind(this),

            'reconnected': this.handleReconnected.bind(this),
            'reconnection_failed': this.handleReconnectionFailed.bind(this),
            'health_check': this.handleHealthCheck.bind(this)
        };

        Object.entries(events).forEach(([event, handler]) => {
            this.whatsappClient.on(event, handler);
        });
    }

    setupGracefulShutdown() {
        // Evitar configurar listeners múltiples veces
        if (this.listenersSetup) {
            logger.debug('Graceful shutdown already configured');
            return;
        }
        
        this.listenersSetup = true;
        
        // CORREGIDO: Usar once() para evitar múltiples listeners
        this.gracefulShutdown.onShutdown(async (signal) => {
            if (this.shutdownInProgress) {
                logger.warn(`Shutdown already in progress, ignoring ${signal}`);
                return;
            }
            
            this.shutdownInProgress = true;
            logger.info(`Received ${signal}, initiating graceful shutdown...`);
            await this.cleanup();
        });
        
        logger.info('Graceful shutdown handlers configured');
    }

    broadcastToWebSocketClients(eventType, data) {
        if (this.webSocketHandler && !this.isShuttingDown) {
            try {
                // Limitar el rate de broadcast
                if (this.lastBroadcast && (Date.now() - this.lastBroadcast) < 100) {
                    return; // Skip si fue hace menos de 100ms
                }
                
                this.webSocketHandler.broadcast(eventType, data);
                this.lastBroadcast = Date.now();
            } catch (error) {
                logger.error('Error broadcasting to WebSocket clients:', error);
            }
        }
    }

    async handleQrUpdate(number, qr) {
        try {
            if (!number || !qr) {
                logger.warn('QR update called without number or QR code');
                return;
            }
            
            logger.info(`QR code updated for client ${number}`);

            // Usar circuit breaker para WebSocket
            await this.circuitBreakers.websocket.execute(async () => {
                if (this.webSocketHandler?.broadcastToSubscribers) {
                    this.webSocketHandler.broadcastToSubscribers('qrCode', { number, qr }, number);
                } else {
                    this.broadcastToWebSocketClients('qrCode', { number, qr });
                }
            });

            this.metrics.recordEvent('qr_updated', { number });
        } catch (error) {
            logger.error(`Error handling QR update for ${number}:`, error);
        }
    }

    handleAuthenticated(data) {
        logger.info(`Client authenticated: ${data.number}`);
        this.broadcastToWebSocketClients('authenticated', data);
    }

    handleReady(data) {
        logger.info(`Client ready: ${data.number}`);
        this.broadcastToWebSocketClients('ready', data);
    }

    async handleMessage({ number, message }) {
        try {
            // Log conciso del mensaje entrante
            logger.debug(`Processing WhatsApp message - Account: ${number}, From: ${message.from || 'N/A'},  Message: ${message.body || 'Sin contenido'}, Type: ${message.type || 'unknown'}`);

            // Log detallado en WebSocket handler si existe
            if (this.webSocketHandler && this.webSocketHandler.logIncomingMessage) {
                this.webSocketHandler.logIncomingMessage(number, message);
            }

            // Procesar mensaje con timeout
            const processedMessage = await Promise.race([
                MessageProcessor.processMessage(number, message),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Message processing timeout')), 10000)
                )
            ]);

            if (processedMessage && processedMessage.error) {
                logger.warn(`Message processing error for ${number}:`, processedMessage.error);
                return;
            }

            // Broadcast a WebSocket con logging
            logger.debug(`Broadcasting message to WebSocket subscribers of ${number}`);
            
            // Usar broadcastToSubscribers si está disponible, sino usar el método genérico
            if (this.webSocketHandler && this.webSocketHandler.broadcastToSubscribers) {
                await this.webSocketHandler.broadcastToSubscribers('message', processedMessage || message, number);
            } else {
                this.broadcastToWebSocketClients('message', { 
                    number, 
                    message: processedMessage || message 
                });
            }

            this.metrics.recordEvent('message_processed', { number });
            logger.debug(`Message from ${number} processed successfully`);
            
        } catch (error) {
            logger.error(`Error processing message from ${number}:`, error);
            this.metrics.recordEvent('message_error', { number, error: error.message });
        }
    }

    handleDisconnected(data) {
        logger.info(`Client disconnected: ${data.number}, Reason: ${data.reason}`);
        this.broadcastToWebSocketClients('disconnected', data);
    }

    async start() {
        try {
            if (!await this.initialize()) {
                throw new Error('Server initialization failed');
            }

            // NUEVO: Verificar listeners antes de iniciar
            this.checkAndCleanupListeners();

            this.server.listen(this.port, '0.0.0.0', () => {
                logger.info(`Server running on port: ${this.port}`);
                logger.info(`Worker ${process.pid} started`);
                logger.info(`Server URL: http://localhost:${this.port}`);
                
                // Log información adicional en desarrollo
                if (process.env.NODE_ENV === 'development') {
                    this.checkAndCleanupListeners();
                }
            });

            this.server.on('error', (error) => {
                logger.error('Server error:', error);
                
                if (error.code === 'EADDRINUSE') {
                    logger.error(`Port ${this.port} is already in use`);
                } else if (error.code === 'EACCES') {
                    logger.error(`Permission denied to bind to port ${this.port}`);
                }
                
                if (!this.isShuttingDown && !this.shutdownInProgress) {
                    setTimeout(() => {
                        this.cleanup();
                    }, 1000);
                }
            });

        } catch (error) {
            logger.error('Failed to start server:', error);
            
            // Cleanup antes de salir
            try {
                await this.cleanup();
            } catch (cleanupError) {
                logger.error('Cleanup failed during startup error:', cleanupError);
            }
            
            process.exit(1);
        }
    }

    async cleanup() {
        if (this.shutdownInProgress) {
            logger.warn('Cleanup already in progress');
            return;
        }
        
        logger.info('Server shutting down with enhanced cleanup...');
        this.isShuttingDown = true;
        this.shutdownInProgress = true;
        
        try {
            // 1. Detener intervalos PRIMERO
            const intervals = [
                'metricsInterval',
                'reconnectionMetricsInterval',
                'lastMetricsLog',
                'lastHealthLog'
            ];
            
            intervals.forEach(intervalName => {
                if (this[intervalName]) {
                    clearInterval(this[intervalName]);
                    this[intervalName] = null;
                    logger.debug(`Cleared ${intervalName}`);
                }
            });

            // 2. Cerrar servidor HTTP con timeout
            if (this.server) {
                await new Promise((resolve) => {
                    const timeout = setTimeout(resolve, 5000);
                    
                    this.server.close(() => {
                        clearTimeout(timeout);
                        logger.info('HTTP server closed');
                        resolve();
                    });
                });
            }

            // 3. Cerrar conexiones WebSocket gradualmente
            if (this.wss && this.wss.clients) {
                logger.info(`Closing ${this.wss.clients.size} WebSocket connections`);
                
                const closePromises = Array.from(this.wss.clients).map(ws => {
                    return new Promise((resolve) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close(1001, 'Server shutting down');
                        }
                        resolve();
                    });
                });
                
                await Promise.race([
                    Promise.allSettled(closePromises),
                    new Promise(resolve => setTimeout(resolve, 8000))
                ]);
                
                // Cerrar servidor WebSocket
                await new Promise((resolve) => {
                    const timeout = setTimeout(resolve, 3000);
                    
                    this.wss.close(() => {
                        clearTimeout(timeout);
                        logger.info('WebSocket server closed');
                        resolve();
                    });
                });
            }

            // 4. CORREGIDO: Cleanup de WhatsApp clients con cancelación de reconexiones
            if (this.whatsappClient) {
                try {
                    // Cancelar reconexiones activas PRIMERO
                    if (typeof this.whatsappClient.cancelAllReconnections === 'function') {
                        await this.whatsappClient.cancelAllReconnections();
                        logger.info('All reconnections cancelled');
                    }
                    
                    // Destruir todos los clientes
                    await Promise.race([
                        this.whatsappClient.destroyAll(),
                        new Promise(resolve => setTimeout(resolve, 25000)) // 25 segundos timeout
                    ]);
                    
                    logger.info('WhatsApp clients cleanup completed');
                } catch (error) {
                    logger.error('Error during WhatsApp cleanup:', error);
                }
            }
            
            // 5. Limpiar estructuras de datos del servidor
            if (this.alertManager) {
                this.alertManager.activeAlerts.clear();
                this.alertManager.lastAlert.clear();
            }
            
            if (this.wsConnectionPool) {
                this.wsConnectionPool.clear();
            }
            
            logger.info('Enhanced server cleanup completed');
            
        } catch (error) {
            logger.error('Error during enhanced cleanup:', error);
        }

        // 6. Finalizar proceso con timeout
        if (process.env.NODE_ENV !== 'test') {
            setTimeout(() => {
                logger.info('Forcing process exit');
                process.exit(0);
            }, 2000);
        }
    }

    handleReconnected(data) {
        const { number, attempts, duration } = data;
        logger.info(`Client ${number} reconnected after ${attempts} attempts in ${duration}ms`);
        
        // Broadcast to WebSocket clients
        this.broadcastToWebSocketClients('reconnected', {
            number,
            attempts,
            duration,
            timestamp: Date.now()
        });
        
        // Clear any related alerts
        this.clearAlert(`reconnection_failed_${number}`);
        
        // Record success metric
        this.metrics.recordEvent('client_reconnected', { 
            number, 
            attempts, 
            duration,
            success: true 
        });
    }

    handleReconnectionFailed(data) {
        const { number, error } = data;
        logger.error(`Final reconnection failure for ${number}: ${error}`);
        
        // Broadcast to WebSocket clients
        this.broadcastToWebSocketClients('reconnection_failed', {
            number,
            error,
            timestamp: Date.now()
        });
        
        // Trigger alert if not in cooldown
        this.triggerAlert('reconnection_failed', {
            type: 'client_reconnection_failed',
            number,
            error,
            severity: 'high'
        });
        
        // Record failure metric
        this.metrics.recordEvent('client_reconnection_failed', { 
            number, 
            error,
            success: false 
        });
    }

    handleHealthCheck(data) {
        const { total, healthy, reconnecting, queued, timestamp } = data;
        
        // MODIFICADO: Log health solo si hay cambios significativos o cada 10 minutos
        const shouldLog = !this.lastHealthLog || 
                         (timestamp - this.lastHealthLog) > 600000 || // 10 minutos
                         Math.abs((this.lastHealthRatio || 1) - (healthy / Math.max(total, 1))) > 0.2; // Cambio >20%
        
        if (shouldLog) {
            logger.info(`Health Check - Total: ${total}, Healthy: ${healthy}, Reconnecting: ${reconnecting}, Queued: ${queued}`);
            this.lastHealthLog = timestamp;
            this.lastHealthRatio = healthy / Math.max(total, 1);
        }
        
        // MODIFICADO: Umbrales más conservadores para alertas
        const healthRatio = total > 0 ? healthy / total : 1;
        
        // Solo alertar si hay problemas significativos y múltiples clientes
        if (healthRatio < 0.5 && total > 3) { // Menos del 50% saludable con 4+ clientes
            this.triggerAlert('poor_health', {
                type: 'poor_client_health',
                healthRatio: Math.round(healthRatio * 100),
                total,
                healthy,
                severity: 'medium'
            });
        }
        
        // MODIFICADO: Umbral más alto para cola de reconexión
        if (queued > this.reconnectionConfig.alertThresholds.queueSize * 2) {
            this.triggerAlert('high_queue', {
                type: 'high_reconnection_queue',
                queueSize: queued,
                severity: 'medium'
            });
        }
    }

    triggerAlert(alertKey, alertData) {
        if (this.isShuttingDown) return;
        
        const now = Date.now();
        const lastAlert = this.alertManager.lastAlert.get(alertKey);
        
        // MODIFICADO: Cooldown más largo para evitar spam
        const cooldownPeriod = 600000; // 10 minutos
        
        if (lastAlert && (now - lastAlert) < cooldownPeriod) {
            logger.debug(`Alert ${alertKey} in cooldown, skipping`);
            return;
        }
        
        this.alertManager.lastAlert.set(alertKey, now);
        this.alertManager.activeAlerts.add(alertKey);
        
        logger.warn(`ALERT [${alertData.severity.toUpperCase()}]: ${alertData.type}`, {
            ...alertData,
            alertKey,
            timestamp: now
        });
        
        // Broadcast solo alertas de alta severidad para evitar spam en WebSocket
        if (alertData.severity === 'high') {
            this.broadcastToWebSocketClients('system_alert', {
                ...alertData,
                alertKey,
                timestamp: now
            });
        }
    }

    clearAlert(alertKey) {
        if (this.alertManager.activeAlerts.has(alertKey)) {
            this.alertManager.activeAlerts.delete(alertKey);
            logger.info(`Alert cleared: ${alertKey}`);
        }
    }

    checkAndCleanupListeners() {
        const events = ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException', 'unhandledRejection'];
        
        events.forEach(event => {
            const listenerCount = process.listenerCount(event);
            if (listenerCount > 2) { // Más de 2 listeners es sospechoso
                logger.warn(`Too many listeners for ${event}: ${listenerCount}`);
                
                // En desarrollo, mostrar información adicional
                if (process.env.NODE_ENV === 'development') {
                    console.log(`${event} listeners:`, process.listeners(event).length);
                }
            }
        });
    }

    analyzeReconnectionTrends() {
        try {
            const metrics = this.whatsappClient?.getReconnectionMetrics?.();
            
            if (!metrics || !metrics.totalAttempts) {
                return; // No hay datos suficientes
            }
            
            // MODIFICADO: Solo alertar si hay suficiente actividad
            if (metrics.totalAttempts < 5) {
                return; // Muy pocos intentos para análisis
            }
            
            // MODIFICADO: Umbrales más permisivos
            const failureRateThreshold = 70; // 70% en lugar de 50%
            const reconnectionTimeThreshold = 600000; // 10 minutos en lugar de 5
            
            // Check failure rate solo si hay suficientes intentos
            if (metrics.totalAttempts >= 10 && 
                metrics.successRate < (100 - failureRateThreshold)) {
                
                this.triggerAlert('high_failure_rate', {
                    type: 'high_reconnection_failure_rate',
                    successRate: metrics.successRate.toFixed(2),
                    totalAttempts: metrics.totalAttempts,
                    severity: 'high'
                });
            }
            
            // Check average reconnection time
            if (metrics.averageReconnectionTime > reconnectionTimeThreshold) {
                this.triggerAlert('slow_reconnections', {
                    type: 'slow_reconnection_times',
                    averageTime: Math.round(metrics.averageReconnectionTime / 1000),
                    severity: 'medium'
                });
            }
            
            logger.debug('Reconnection trend analysis completed', {
                totalAttempts: metrics.totalAttempts,
                successRate: metrics.successRate.toFixed(2),
                averageTime: Math.round(metrics.averageReconnectionTime),
                activeReconnections: metrics.activeReconnections,
                queuedReconnections: metrics.queuedReconnections
            });
            
        } catch (error) {
            logger.error('Error analyzing reconnection trends:', error);
        }
    }

    recordReconnectionMetrics() {
        if (!this.whatsappClient) return;
        
        try {
            const metrics = this.whatsappClient.getReconnectionMetrics();
            
            this.metrics.recordEvent('reconnection_active_count', { 
                value: metrics.activeReconnections 
            });
            
            this.metrics.recordEvent('reconnection_queued_count', { 
                value: metrics.queuedReconnections 
            });
            
            this.metrics.recordEvent('reconnection_success_rate', { 
                value: metrics.successRate 
            });
            
            this.metrics.recordEvent('reconnection_average_time', { 
                value: metrics.averageReconnectionTime 
            });
            
            // Para contadores, usar recordEvent también
            this.metrics.recordEvent('reconnection_metrics_update', {
                totalAttempts: metrics.totalAttempts,
                successful: metrics.successfulReconnections,
                failed: metrics.failedReconnections,
                timestamp: Date.now()
            });
            
        } catch (error) {
            logger.error('Error recording reconnection metrics:', error);
        }
    }

    // Métodos de acceso para compatibilidad con rutas API
    getWhatsAppClient() {
        return this.whatsappClient;
    }

    getWebSocketHandler() {
        return this.webSocketHandler;
    }

    getMetrics() {
        return this.metrics.getMetrics();
    }

    async getHealthStatus() {
        return await this.healthCheck.check();
    }
}

// Check if running in cluster mode
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
    const numCPUs = os.cpus().length;
    const workers = Math.min(numCPUs, parseInt(process.env.MAX_WORKERS) || Math.max(2, numCPUs));
    
    logger.info(`Master ${process.pid} starting ${workers} workers`);

    // NUEVO: Rastrear workers para mejor gestión
    const workerInfo = new Map();

    // Fork workers con información de seguimiento
    for (let i = 0; i < workers; i++) {
        const worker = cluster.fork();
        workerInfo.set(worker.id, {
            worker,
            startTime: Date.now(),
            restarts: 0
        });
    }

    cluster.on('exit', (worker, code, signal) => {
        const info = workerInfo.get(worker.id);
        
        if (!worker.exitedAfterDisconnect) {
            logger.warn(`Worker ${worker.process.pid} died (${signal || code}).`);
            
            // MODIFICADO: Prevenir restart loops
            if (info) {
                info.restarts++;
                const timeSinceStart = Date.now() - info.startTime;
                
                // Si el worker muere muy rápido, esperar antes de reiniciar
                if (timeSinceStart < 10000) { // Menos de 10 segundos
                    logger.warn(`Worker died quickly, waiting before restart (restarts: ${info.restarts})`);
                    
                    if (info.restarts > 5) {
                        logger.error(`Worker ${worker.id} restarted too many times, not restarting`);
                        workerInfo.delete(worker.id);
                        return;
                    }
                    
                    setTimeout(() => {
                        const newWorker = cluster.fork();
                        workerInfo.set(newWorker.id, {
                            worker: newWorker,
                            startTime: Date.now(),
                            restarts: info.restarts
                        });
                    }, 5000 * info.restarts); // Backoff exponencial
                } else {
                    // Restart normal
                    const newWorker = cluster.fork();
                    workerInfo.set(newWorker.id, {
                        worker: newWorker,
                        startTime: Date.now(),
                        restarts: 0
                    });
                }
            }
        } else {
            logger.info(`Worker ${worker.process.pid} exited cleanly`);
            workerInfo.delete(worker.id);
        }
    });

    // MODIFICADO: Graceful restart mejorado
    process.on('SIGUSR2', () => {
        logger.info('Graceful restart initiated');
        
        // Disconnect workers gradualmente
        const workers = Array.from(workerInfo.values());
        workers.forEach((info, index) => {
            setTimeout(() => {
                info.worker.send('shutdown');
                
                setTimeout(() => {
                    if (!info.worker.isDead()) {
                        info.worker.kill('SIGTERM');
                    }
                }, 15000); // Aumentado a 15 segundos
            }, index * 2000); // Escalonar por 2 segundos
        });
    });

    // Handle master process shutdown
    const masterShutdown = (signal) => {
        logger.info(`Master received ${signal}, shutting down workers`);
        
        const workers = Array.from(workerInfo.values());
        workers.forEach(info => {
            info.worker.disconnect();
        });
        
        // Force exit after timeout
        setTimeout(() => {
            logger.warn('Force exiting master process');
            process.exit(0);
        }, 30000);
    };

    process.once('SIGTERM', () => masterShutdown('SIGTERM'));
    process.once('SIGINT', () => masterShutdown('SIGINT'));

} else {
    // Worker process - MODIFICADO: Mejor configuración por worker
    const server = new WhatsAppServer({
        port: process.env.PORT || 5000,
        heartbeatInterval: 30000,
        maxWsConnections: cluster.isMaster ? 1000 : 250, // Por worker en cluster
        enableAutoReconnection: true,
        maxConcurrentReconnections: cluster.isMaster ? 5 : 3 // Menos por worker
    });
    
    // MODIFICADO: Handle worker shutdown message con timeout
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            logger.info(`Worker ${process.pid} received shutdown message`);
            
            // Shutdown graceful con timeout
            Promise.race([
                server.cleanup(),
                new Promise(resolve => setTimeout(resolve, 12000))
            ]).then(() => {
                process.exit(0);
            }).catch(error => {
                logger.error('Worker shutdown error:', error);
                process.exit(1);
            });
        }
    });

    // Handle worker process signals - usar once() para evitar duplicados
    process.once('SIGTERM', () => {
        logger.info(`Worker ${process.pid} received SIGTERM`);
        server.cleanup();
    });

    process.once('SIGINT', () => {
        logger.info(`Worker ${process.pid} received SIGINT`);
        server.cleanup();
    });
    
    server.start();
}

module.exports = WhatsAppServer;