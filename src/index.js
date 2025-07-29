// index.js
const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const whatsapp = require('./lib/whatsapp');
const WebSocketHandler = require('./handlers/websocket');
const logger = require('./config/logger');
const MessageProcessor = require('./utils/messageProcessor');
const http = require('http');

class WhatsAppServer {
    constructor(config = {}) {
        this.port = config.port || process.env.PORT || 5000;
        this.app = express();
        this.server = null;
        this.wss = null;
        this.heartbeatInterval = config.heartbeatInterval || 30000;
        this.staticPaths = {
            '/temp': path.join(__dirname, '/controllers/temp'),
            '/media': path.join(__dirname, 'media'),
            '/': path.join(__dirname, '../static')
        };
        this.pages = {
            '/': '../static/client.html',
            '/login': '../static/inicioSesion.html',
            '/home': '../static/chat.html'
        };
    }

    initialize() {
        try {
            this.setupMiddleware();
            this.setupStaticFiles();
            this.setupRoutes();
            this.setupWebSocket();
            this.setupWhatsAppEvents();
            return true;
        } catch (error) {
            logger.error('Failed to initialize server:', error);
            return false;
        }
    }

    setupMiddleware() {
        const requestSizeLimit = '50mb';
        this.app.use(express.json({ limit: requestSizeLimit }));
        this.app.use(express.urlencoded({ 
            limit: requestSizeLimit, 
            extended: true 
        }));
    }

    setupStaticFiles() {
        Object.entries(this.staticPaths).forEach(([route, dir]) => {
            this.app.use(route, express.static(dir));
        });
    }

    setupRoutes() {
        Object.entries(this.pages).forEach(([route, page]) => {
            this.app.get(route, (req, res) => {
                res.sendFile(path.join(__dirname, page));
            });
        });
        
        // API routes with error handling
        const apiRoutes = require('./routes/links');
        this.app.use('/api', apiRoutes);
        
        // Error handling middleware
        this.app.use((err, req, res, next) => {
            logger.error('Express error:', err);
            res.status(500).json({ 
                error: 'Internal server error', 
                message: err.message 
            });
        });
    }

    setupWebSocket() {
        this.wss = new WebSocket.Server({ noServer: true });
        const webSocketHandler = new WebSocketHandler(this.wss);

        this.wss.on('connection', this.handleWebSocketConnection.bind(this));
        this.startHeartbeat();
    }

    handleWebSocketConnection(ws, req) {
        ws.isAlive = true;
        ws.ip = req.socket.remoteAddress;
        
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('error', (error) => {
            logger.error(`WebSocket error from ${ws.ip}:`, error);
        });

        logger.info(`New WebSocket connection from ${ws.ip}`);
    }

    startHeartbeat() {
        setInterval(() => {
            this.wss.clients.forEach(client => {
                if (!client.isAlive) {
                    logger.info(`Terminating inactive client: ${client.ip}`);
                    return client.terminate();
                }
                client.isAlive = false;
                client.ping();
            });
        }, this.heartbeatInterval);
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
            whatsapp.on(event, handler);
        });
    }

    broadcastToWebSocketClients(eventType, data) {
        const payload = JSON.stringify({ eventType, data });
        
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(payload);
                } catch (error) {
                    logger.error(`Error broadcasting to client ${client.ip}:`, error);
                    client.terminate();
                }
            }
        });
    }

    async handleQrUpdate(number, qr) {
        try {
            if (!number) {
                logger.warn('handleQrUpdate llamado sin número');
                return;
            }

            if (!qr) {
                logger.warn(`Código QR vacío recibido para cliente ${number}`);
                return;
            }
            
            logger.info(`Código QR actualizado para cliente ${number}`);

            if (this.webSocketHandler && typeof this.webSocketHandler.broadcastToSubscribers === 'function') {
                this.webSocketHandler.broadcastToSubscribers('qrCode', { number, qr }, number);
                logger.info(`QR enviado a suscriptores del número ${number}`);
            } else {
                this.broadcastToWebSocketClients('qrCode', { number, qr });
                logger.info(`QR enviado en broadcast general`);
            }
        } catch (error) {
            logger.error(`Error manejando actualización de QR para ${number}:`, error);
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
            const processedMessage = await MessageProcessor.processMessage(number, message);
            if (processedMessage.error) {
                logger.warn(`Message processing error for ${number}:`, processedMessage.error);
                return;
            }
            this.broadcastToWebSocketClients('message', processedMessage);
        } catch (error) {
            logger.error(`Error processing message from ${number}:`, error);
        }
    }

    handleDisconnected(data) {
        logger.info(`Client disconnected: ${data.number}, Reason: ${data.reason}`);
        this.broadcastToWebSocketClients('disconnected', data);
    }

    async start() {
        try {
            if (!this.initialize()) {
                throw new Error('Server initialization failed');
            }

            this.server = this.app.listen(this.port, () => {
                logger.info(`Server running on port: ${this.port}`);
            });

            this.server.on('upgrade', (request, socket, head) => {
                this.wss.handleUpgrade(request, socket, head, ws => {
                    this.wss.emit('connection', ws, request);
                });
            });

            this.server.on('error', (error) => {
                logger.error('Server error:', error);
                this.cleanup();
            });

            process.on('SIGTERM', this.cleanup.bind(this));
            process.on('SIGINT', this.cleanup.bind(this));

        } catch (error) {
            logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }

    cleanup() {
        logger.info('Server shutting down...');
        
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
                process.exit(0);
            });
        }
    }
}

module.exports = WhatsAppServer;

// Create and start server instance
if (require.main === module) {
    const server = new WhatsAppServer();
    server.start();
}