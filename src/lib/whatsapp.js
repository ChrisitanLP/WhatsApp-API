// whatsapp.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs').promises; 
const path = require('path');
const { EventEmitter } = require('events');
const qrcode = require('qrcode-terminal');
const { logger } = require('../config/logger'); 
const config = require('../config/app');


class WhatsAppClient extends EventEmitter {
    static RECONNECT_DELAY = config.reconnectDelay || 5000;
    static MAX_RETRIES = config.maxRetries || 3;
    static CHROME_PATH = config.chromePath;
    static CLEANUP_TIMEOUT = 1000;

    constructor() {
        super();
        this.clients = new Map();
        this.clientReadyState = new Map();
        this.qrCodes = new Map();
        this.retryAttempts = new Map();
        this.authPath = config.authPath;
        this.messageQueue = new Map();
        this.rateLimiter = new Map();
        this.initialize().catch(error => 
            logger.error('Initialization failed:', error));
    }

    async initialize() {
        try {
            await this.ensureAuthDirectory();
            await this.loadExistingClients();
        } catch (error) {
            logger.error('Failed to initialize WhatsApp clients:', error);
            throw error; // Propagar el error para manejo superior
        }
    }

    async ensureAuthDirectory() {
        try {
            await fs.access(this.authPath);
        } catch {
            await fs.mkdir(this.authPath, { recursive: true });
            logger.info(`Created auth directory at ${this.authPath}`);
        }
    }

    async loadExistingClients() {
        const clientDirectories = await fs.readdir(this.authPath);

        const validDirectories = await Promise.all(
            clientDirectories.map(async dir => {
                const dirPath = path.join(this.authPath, dir);
                const stats = await fs.stat(dirPath);
                return stats.isDirectory() && dir.startsWith('session-') ? dir : null;
            })
        );

        await Promise.all(
            validDirectories
                .filter(Boolean)
                .map(dir => this.addClient(dir.replace('session-', '')))
        );
    }

    async createClient(number, sessionDir) {
        const retryCount = this.retryAttempts.get(number) || 0;
        
        if (retryCount >= WhatsAppClient.MAX_RETRIES) {
            logger.error(`Max retry attempts reached for client ${number}`);
            this.retryAttempts.delete(number);
            throw new Error('Max retry attempts reached');
        }

        try {
            const clientConfig = {
                authStrategy: new LocalAuth({
                    clientId: number,
                    dataPath: path.join(this.authPath, sessionDir)
                }),
                puppeteer: {
                    headless: false, 
                    executablePath: WhatsAppClient.CHROME_PATH,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu'
                    ]
                }
            };
    
            const client = new Client(clientConfig);
            this.clients.set(number, client);
            this.setupClientEvents(client, number);
            await client.initialize();
            
            // Reset retry count on successful connection
            this.retryAttempts.delete(number);
            logger.info(`Client ${number} successfully initialized`);

            return client;
        } catch (error) {
            this.retryAttempts.set(number, retryCount + 1);
            logger.error(`Error creating client for number ${number}:`, error);
            throw error;
        }
    }

    setupClientEvents(client, number) {
        this.clientReadyState.set(number, false);

        const events = {
            qr: (qr) => {
                console.log(`QR para ${number}:`, qr);
                this.qrCodes.set(number, qr);
                qrcode.generate(qr, { small: true });
                this.emit('qrUpdated', number, qr);
            },
            ready: () => {
                this.clientReadyState.set(number, true);
                this.emit('ready', { number });
                this.processMessageQueue(number);
            },
            authenticated: () => this.emit('authenticated', { number }),
            auth_failure: (msg) => {
                this.emit('auth_failure', { number, message: msg });
                this.handleAuthFailure(number);
            },
            message: (message) => this.handleMessage(number, message),
            disconnected: (reason) => this.handleDisconnection(number, reason)
        };

        Object.entries(events).forEach(([event, handler]) => {
            client.on(event, handler);
        });

        // Group-related events
        this.setupGroupEvents(client, number);
    }

    // Mejoras en el manejo de mensajes
    async sendMessage(number, to, message) {
        const client = this.getClient(number);
        if (!client) throw new Error('Client not found');

        if (this.isRateLimited(number)) {
            await this.addToMessageQueue(number, { to, message });
            return;
        }

        try {
            await client.sendMessage(to, message);
            this.updateRateLimit(number);
        } catch (error) {
            logger.error(`Error sending message from ${number} to ${to}:`, error);
            await this.addToMessageQueue(number, { to, message });
        }
    }

    isRateLimited(number) {
        const lastSent = this.rateLimiter.get(number);
        return lastSent && (Date.now() - lastSent) < 1000; // 1 mensaje por segundo
    }

    updateRateLimit(number) {
        this.rateLimiter.set(number, Date.now());
    }

    async addToMessageQueue(number, message) {
        if (!this.messageQueue.has(number)) {
            this.messageQueue.set(number, []);
        }
        this.messageQueue.get(number).push(message);
    }

    async processMessageQueue(number) {
        const queue = this.messageQueue.get(number) || [];
        if (queue.length === 0) return;

        const message = queue.shift();
        await this.sendMessage(number, message.to, message.content);
        
        if (queue.length > 0) {
            setTimeout(() => this.processMessageQueue(number), 1000);
        }
    }

    setupGroupEvents(client, number) {
        const groupEvents = {
            'contact_changed': (msg, oldId, newId, isContact) => 
                this.emit('contactChanged', { number, oldId, newId, isContact }),
            'group_admin_changed': (notification) => 
                this.emit('groupAdminChanged', { number, notification }),
            'group_join': (notification) => 
                this.emit('groupJoin', { number, notification }),
            'group_leave': (notification) => 
                this.emit('groupLeave', { number, notification }),
            'message_reaction': (reaction) => 
                this.emit('messageReaction', { number, reaction })
        };

        Object.entries(groupEvents).forEach(([event, handler]) => {
            client.on(event, handler);
        });
    }

    async handleMessage(number, message) {
        try {
            if (message.from === 'status@broadcast') {
                this.emit('status', { number, message });
                return;
            }
            this.emit('message', { number, message });
        } catch (error) {
            logger.error(`Error processing message for ${number}:`, error);
        }
    }

    async handleDisconnection(number, reason) {
        try {
            const client = this.clients.get(number);
            if (!client) return;

            logger.info(`Client ${number} disconnected: ${reason}`);
            await this.cleanupClient(client);
            this.emit('disconnected', { number, reason });

            // Implement exponential backoff for reconnection
            setTimeout(() => this.addClient(number), WhatsAppClient.RECONNECT_DELAY);
        } catch (error) {
            logger.error(`Error handling disconnection for ${number}:`, error);
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

    async addClient(number) {
        const sessionDir = `session-${number}`;
        const sessionPath = path.join(this.authPath, sessionDir);

        try {
            await fs.mkdir(sessionPath, { recursive: true });
            await this.createClient(number, sessionDir);
        } catch (error) {
            logger.error(`Failed to add client ${number}:`, error);
            throw error;
        }
    }

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
                status: client.getState(),
                last_seen: client.info?.lastSeen || null
            }));
    }

    async removeClient(number) {
        const client = this.clients.get(number);
        if (!client) {
            throw new Error('Client not found');
        }

        try {
            await client.logout();
            this.clients.delete(number);
            const sessionDir = path.join(this.authPath, `session-${number}`);
            await this.removeDirectory(sessionDir);
        } catch (error) {
            logger.error(`Failed to remove client ${number}:`, error);
            throw error;
        }
    }

    async removeDirectory(dirPath) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            await Promise.all(entries.map(entry => {
                const fullPath = path.join(dirPath, entry.name);
                return entry.isDirectory() ? 
                    this.removeDirectory(fullPath) : 
                    fs.unlink(fullPath);
            }));
            await fs.rmdir(dirPath);
        } catch (error) {
            logger.error(`Failed to remove directory ${dirPath}:`, error);
            throw error;
        }
    }

    getClient(number) {
        return this.clients.get(number);
    }

    updateQrCache(number, qr) {
        this.qrCodes.set(number, qr);
        logger.info(`QR almacenado en caché para ${number}`);
    }

    getQr(number) {
        const qr = this.qrCodes.get(number);
        logger.info(`QR ${qr ? 'encontrado' : 'no encontrado'} en caché para ${number}`);
        return qr;
    }

    isReady(number) {
        return this.clientReadyState.get(number) || false;
    }

    isAuthenticated(number) {
        const client = this.clients.get(number);
        return Boolean(client?.info?.pushname);
    }
}

module.exports = new WhatsAppClient();