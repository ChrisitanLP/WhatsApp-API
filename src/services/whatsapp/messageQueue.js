// services/whatsapp/MessageQueue.js
const logger = require('../../config/logger').logger;

/**
 * Gestión exclusiva de colas de mensajes y rate limiting
 */
class MessageQueue {
    constructor(options = {}) {
        // Configuración desde el constructor (usado en WhatsAppClient)
        this.concurrency = options.concurrency || 5;
        this.retryAttempts = options.retryAttempts || 3;
        this.retryDelay = options.retryDelay || 1000;
        
        // Maps para gestión de colas y rate limiting
        this.queues = new Map();
        this.rateLimiter = new Map();
        this.processing = new Map();
        this.messageStats = new Map();
        
        // Rate limiting configuración
        this.messageInterval = 1000; // 1 segundo entre mensajes
        this.burstLimit = 5; // Máximo 5 mensajes en ráfaga
        this.burstWindow = 10000; // Ventana de 10 segundos para ráfaga
        
        // Tracking de mensajes por ventana de tiempo
        this.messageTimes = new Map();
    }

    /**
     * Método principal usado por WhatsAppClient.sendMessage()
     * @param {string} number - Número del cliente
     * @param {string} to - Destinatario
     * @param {any} message - Mensaje a enviar
     * @param {Object} client - Cliente de WhatsApp
     * @param {Object} options - Opciones adicionales
     */
    async addMessage(number, to, message, client, options = {}) {
        if (!client) {
            throw new Error(`Client ${number} not available`);
        }

        // Verificar rate limiting
        if (await this.isRateLimited(number)) {
            logger.debug(`Rate limited for ${number}, queueing message`);
            await this.enqueueMessage(number, { to, message, options, retries: 0 });
            return { queued: true, status: 'queued' };
        }

        try {
            // Intentar envío directo
            const result = await this.sendMessageWithRetry(client, to, message, options);
            this.updateRateLimit(number);
            this.updateStats(number, 'sent');
            
            logger.debug(`Message sent directly from ${number} to ${to}`);
            return { 
                sent: true, 
                status: 'sent',
                messageId: result.id?.id || result.id,
                timestamp: result.timestamp || Date.now()
            };
            
        } catch (error) {
            logger.error(`Failed to send message from ${number}:`, error);
            
            // Si falla el envío directo, encolar para reintento
            await this.enqueueMessage(number, { 
                to, 
                message, 
                options, 
                retries: 0,
                error: error.message 
            });
            
            // Re-lanzar el error para que WhatsAppClient lo maneje
            throw error;
        }
    }

    /**
     * Enviar mensaje con reintentos
     */
    async sendMessageWithRetry(client, to, message, options, attempt = 1) {
        try {
            // Agregar timeout a la operación
            const sendPromise = client.sendMessage(to, message, options);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Send message timeout')), 30000)
            );
            
            return await Promise.race([sendPromise, timeoutPromise]);
            
        } catch (error) {
            if (attempt < this.retryAttempts) {
                logger.warn(`Send attempt ${attempt} failed, retrying in ${this.retryDelay}ms`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                return this.sendMessageWithRetry(client, to, message, options, attempt + 1);
            }
            throw error;
        }
    }

    /**
     * Verificar si está rate limited (mejorado)
     */
    async isRateLimited(number) {
        const now = Date.now();
        
        // Obtener historial de mensajes recientes
        if (!this.messageTimes.has(number)) {
            this.messageTimes.set(number, []);
        }
        
        const times = this.messageTimes.get(number);
        
        // Limpiar mensajes fuera de la ventana
        const validTimes = times.filter(time => now - time < this.burstWindow);
        this.messageTimes.set(number, validTimes);
        
        // Verificar límite de ráfaga
        if (validTimes.length >= this.burstLimit) {
            return true;
        }
        
        // Verificar intervalo mínimo entre mensajes
        const lastMessage = this.rateLimiter.get(number);
        if (lastMessage && (now - lastMessage) < this.messageInterval) {
            return true;
        }
        
        return false;
    }

    /**
     * Actualizar rate limiting
     */
    updateRateLimit(number) {
        const now = Date.now();
        this.rateLimiter.set(number, now);
        
        // Agregar al historial de tiempos
        if (!this.messageTimes.has(number)) {
            this.messageTimes.set(number, []);
        }
        this.messageTimes.get(number).push(now);
    }

    /**
     * Encolar mensaje para procesamiento posterior
     */
    async enqueueMessage(number, messageData) {
        if (!this.queues.has(number)) {
            this.queues.set(number, []);
        }
        
        const queue = this.queues.get(number);
        queue.push({
            ...messageData,
            enqueuedAt: Date.now(),
            id: this.generateMessageId()
        });
        
        this.updateStats(number, 'queued');
        logger.debug(`Message queued for ${number}, queue size: ${queue.length}`);
    }

    /**
     * Procesar cola de mensajes (llamado desde WhatsAppClient cuando cliente está listo)
     */
    async processQueue(number, client) {
        if (this.processing.get(number) || !client) {
            return;
        }

        this.processing.set(number, true);
        const queue = this.queues.get(number) || [];
        
        logger.debug(`Processing queue for ${number}, ${queue.length} messages`);

        try {
            while (queue.length > 0) {
                // Verificar rate limiting
                if (await this.isRateLimited(number)) {
                    await new Promise(resolve => setTimeout(resolve, this.messageInterval));
                    continue;
                }

                const messageData = queue.shift();
                
                try {
                    // Verificar si el mensaje no es muy antiguo (evitar spam de mensajes viejos)
                    const messageAge = Date.now() - messageData.enqueuedAt;
                    if (messageAge > 300000) { // 5 minutos
                        logger.warn(`Discarding old queued message for ${number}`);
                        this.updateStats(number, 'discarded');
                        continue;
                    }
                    
                    // Verificar reintentos
                    if (messageData.retries >= this.retryAttempts) {
                        logger.error(`Max retries reached for queued message ${messageData.id}`);
                        this.updateStats(number, 'failed');
                        continue;
                    }

                    // Intentar envío
                    const result = await this.sendMessageWithRetry(
                        client, 
                        messageData.to, 
                        messageData.message, 
                        messageData.options
                    );
                    
                    this.updateRateLimit(number);
                    this.updateStats(number, 'sent');
                    
                    logger.info(`Queued message sent from ${number} to ${messageData.to}`);
                    
                } catch (error) {
                    logger.error(`Error processing queued message ${messageData.id}:`, error);
                    
                    // Incrementar reintentos y reencolar si no se han agotado
                    messageData.retries = (messageData.retries || 0) + 1;
                    
                    if (messageData.retries < this.retryAttempts) {
                        // Reencolar con delay exponencial
                        setTimeout(() => {
                            if (this.queues.has(number)) {
                                this.queues.get(number).unshift(messageData);
                            }
                        }, this.retryDelay * Math.pow(2, messageData.retries));
                    } else {
                        this.updateStats(number, 'failed');
                    }
                    
                    break; // Parar procesamiento en caso de error
                }
                
                // Pequeña pausa entre mensajes
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            logger.error(`Queue processing error for ${number}:`, error);
        } finally {
            this.processing.set(number, false);
        }
    }

    /**
     * Obtener tamaño de cola (usado en WhatsAppClient.collectMetrics())
     */
    getQueueSize(number = null) {
        if (number) {
            const queue = this.queues.get(number);
            return queue ? queue.length : 0;
        }
        
        // Tamaño total de todas las colas
        let totalSize = 0;
        for (const queue of this.queues.values()) {
            totalSize += queue.length;
        }
        return totalSize;
    }

    /**
     * Obtener estadísticas de mensajes
     */
    getStats(number = null) {
        if (number) {
            return this.messageStats.get(number) || {
                sent: 0,
                queued: 0,
                failed: 0,
                discarded: 0
            };
        }
        
        // Estadísticas agregadas
        const aggregate = { sent: 0, queued: 0, failed: 0, discarded: 0 };
        for (const stats of this.messageStats.values()) {
            aggregate.sent += stats.sent || 0;
            aggregate.queued += stats.queued || 0;
            aggregate.failed += stats.failed || 0;
            aggregate.discarded += stats.discarded || 0;
        }
        return aggregate;
    }

    /**
     * Actualizar estadísticas internas
     */
    updateStats(number, action) {
        if (!this.messageStats.has(number)) {
            this.messageStats.set(number, {
                sent: 0,
                queued: 0,
                failed: 0,
                discarded: 0
            });
        }
        
        const stats = this.messageStats.get(number);
        stats[action] = (stats[action] || 0) + 1;
    }

    /**
     * Generar ID único para mensajes
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Limpiar cola de un cliente específico
     */
    clearQueue(number) {
        this.queues.delete(number);
        this.rateLimiter.delete(number);
        this.messageTimes.delete(number);
        this.processing.delete(number);
        this.messageStats.delete(number);
    }

    /**
     * Obtener información de estado de la cola
     */
    getQueueInfo(number) {
        const queue = this.queues.get(number) || [];
        const stats = this.getStats(number);
        const isProcessing = this.processing.get(number) || false;
        const lastMessage = this.rateLimiter.get(number);
        
        return {
            queueSize: queue.length,
            isProcessing,
            lastMessageTime: lastMessage,
            isRateLimited: this.isRateLimited(number),
            stats
        };
    }
}

module.exports = MessageQueue;