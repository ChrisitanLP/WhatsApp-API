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
    }

    async initialize() {
        try {
            this.setupMiddleware();
            this.setupStaticFiles();
            this.setupRoutes();
            this.setupWebSocket();
            await this.initializeWhatsApp();
            this.setupWhatsAppEvents();

            this.setupHealthChecks();
            this.setupMetrics();
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

    setupMetrics() {
        // Métricas de sistema cada 30 segundos
        this.metricsInterval = setInterval(() => {
            try {
                this.metrics.recordSystemMetrics();
                this.metrics.recordWhatsAppMetrics(this.whatsappClient);
                this.metrics.recordWebSocketMetrics(this.wss);
            } catch (error) {
                logger.error('Error recording metrics:', error);
            }
        }, 30000);

        // Endpoint para métricas
        this.app.get('/metrics', (req, res) => {
            try {
                const metrics = this.getMetrics();
                res.json(metrics);
            } catch (error) {
                res.status(500).json({
                    error: 'Failed to get metrics',
                    message: error.message
                });
            }
        });
    }

    setupStaticFiles() {
        Object.entries(this.staticPaths).forEach(([route, dir]) => {
            this.app.use(route, express.static(dir, {
                maxAge: '1h', // Cache estático por 1 hora
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
            'qrUpdated': this.handleQrUpdate.bind(this)
        };

        Object.entries(events).forEach(([event, handler]) => {
            this.whatsappClient.on(event, handler);
        });
    }

    setupGracefulShutdown() {
        this.gracefulShutdown.onShutdown(async (signal) => {
            logger.info(`Received ${signal}, initiating graceful shutdown...`);
            this.isShuttingDown = true;

            // Limpiar intervalos
            if (this.metricsInterval) {
                clearInterval(this.metricsInterval);
            }

            // Dejar de aceptar nuevas conexiones
            if (this.server) {
                this.server.close(() => {
                    logger.info('HTTP server closed');
                });
            }

            // Cerrar conexiones WebSocket gradualmente
            if (this.wss) {
                this.wss.clients.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.close(1001, 'Server shutting down');
                    }
                });
                
                this.wss.close(() => {
                    logger.info('WebSocket server closed');
                });
            }

            // Cleanup WhatsApp clients
            if (this.whatsappClient) {
                try {
                    await this.whatsappClient.cleanup();
                } catch (error) {
                    logger.error('Error during WhatsApp cleanup:', error);
                }
            }

            logger.info('Graceful shutdown completed');
            setTimeout(() => {
                process.exit(0);
            }, 1000);
        });
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

            this.broadcastToWebSocketClients('message', processedMessage);
            this.metrics.recordEvent('message_processed', { number });
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

            this.server.listen(this.port, '0.0.0.0', () => {
                logger.info(`Server running on port: ${this.port}`);
                logger.info(`Worker ${process.pid} started`);
                logger.info(`Server URL: http://localhost:${this.port}`);
            });

            this.server.on('error', (error) => {
                logger.error('Server error:', error);
                if (error.code === 'EADDRINUSE') {
                    logger.error(`Port ${this.port} is already in use`);
                }
                if (!this.isShuttingDown) {
                    this.gracefulShutdown.shutdown('SIGTERM');
                }
            });

        } catch (error) {
            logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }

    async cleanup() {
        logger.info('Server shutting down...');
        this.isShuttingDown = true;
        
        try {
            // Limpiar intervalos
            if (this.metricsInterval) {
                clearInterval(this.metricsInterval);
            }

            // Close WebSocket server
            if (this.wss) {
                this.wss.close(() => {
                    logger.info('WebSocket server closed');
                });
            }

            // Close HTTP server
            if (this.server) {
                this.server.close(() => {
                    logger.info('HTTP server closed');
                });
            }

            // Cleanup WhatsApp client
            if (this.whatsappClient) {
                await this.whatsappClient.cleanup();
            }
        } catch (error) {
            logger.error('Error during cleanup:', error);
        }

        setTimeout(() => {
            process.exit(0);
        }, 2000);
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
    const workers = Math.min(numCPUs, parseInt(process.env.MAX_WORKERS) || numCPUs);
    
    logger.info(`Master ${process.pid} starting ${workers} workers`);

    // Fork workers
    for (let i = 0; i < workers; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        if (!worker.exitedAfterDisconnect) {
            logger.warn(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
            cluster.fork();
        }
    });

    // Graceful restart
    process.on('SIGUSR2', () => {
        logger.info('Graceful restart initiated');
        
        Object.values(cluster.workers).forEach(worker => {
            worker.send('shutdown');
            
            setTimeout(() => {
                worker.kill('SIGTERM');
            }, 10000);
        });
    });

    // Handle process shutdown
    process.on('SIGTERM', () => {
        logger.info('Master received SIGTERM, shutting down workers');
        Object.values(cluster.workers).forEach(worker => {
            worker.disconnect();
        });
    });

} else {
    // Worker process
    const server = new WhatsAppServer({
        port: process.env.PORT || 5000,
        heartbeatInterval: 30000,
        maxWsConnections: 250 // Por worker
    });
    
    // Handle worker shutdown message
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            server.cleanup();
        }
    });

    // Handle worker process signals
    process.on('SIGTERM', () => {
        server.cleanup();
    });

    process.on('SIGINT', () => {
        server.cleanup();
    });
    
    server.start();
}

module.exports = WhatsAppServer;