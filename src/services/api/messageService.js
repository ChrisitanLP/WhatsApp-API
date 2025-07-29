const fs = require('fs').promises;
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const BaseWhatsAppService = require('./baseService');
const { NotFoundError, ValidationError } = require('../../utils/asyncHandler');
const { logger } = require('../../config/logger');
const CircuitBreaker = require('../../utils/circuitBreaker');

/**
 * Message Service - Handles message operations with resilience and performance optimization
 */
class MessageService extends BaseWhatsAppService {
    constructor() {
        super();

        // Circuit breakers específicos para mensajes
        this.messageCircuitBreaker = new CircuitBreaker('message-operations', {
            failureThreshold: 3,
            recoveryTimeout: 30000,
            monitoringPeriod: 60000
        });
        
        this.messageSearchCircuitBreaker = new CircuitBreaker('message-search', {
            failureThreshold: 5,
            recoveryTimeout: 20000,
            monitoringPeriod: 60000
        });
        
        // Cache para mensajes encontrados (TTL corto por privacidad)
        this.messageCache = new Map();
        this.messageCacheTimeout = 60000; // 1 minuto
        
        // Métricas específicas de mensajes
        this.messageMetrics = {
            totalMessagesSent: 0,
            messagesSearched: 0,
            averageSearchTime: 0,
            lastMessageTime: null,
            cacheHits: 0,
            cacheMisses: 0
        };
        
        // Pool de clientes activos para optimizar búsquedas
        this.activeClientsPool = new Map();
        this.updateActiveClientsInterval = setInterval(() => {
            this.updateActiveClientsPool();
        }, 30000); // Actualizar cada 30 segundos
    }

    /**
     * Actualizar pool de clientes activos
     */
    async updateActiveClientsPool() {
        if (this.isShuttingDown) return;
        
        try {
            const clients = Array.from(this.whatsAppClient.clients.values());
            this.activeClientsPool.clear();
            
            for (const client of clients) {
                if (client && this.whatsAppClient.isReady(client.options?.authStrategy?.clientId)) {
                    this.activeClientsPool.set(client.options.authStrategy.clientId, client);
                }
            }
            
            logger.debug(`Active clients pool updated: ${this.activeClientsPool.size} clients`);
        } catch (error) {
            logger.error('Error updating active clients pool:', error);
        }
    }


    /**
     * Send message to individual chat
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number
     * @param {string} message - Message content
     */
    async sendMessage(clientId, tel, message) {
        const operationId = `send_message_${clientId}_${Date.now()}`;
        const startTime = Date.now();
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            if (!message || typeof message !== 'string') {
                throw new ValidationError('Invalid message content provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(tel, false);
                    
                    // Verificar que el cliente esté listo
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    await client.sendMessage(chatId, message);
                });
            });
            
            this.messageMetrics.totalMessagesSent++;
            this.messageMetrics.lastMessageTime = Date.now();
            
            logger.info(`Message sent successfully to ${tel} from client ${clientId}`);
            
        } catch (error) {
            logger.error(`Error sending message to ${tel} from client ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Send message to group chat with resilience
     * @param {string} clientId - Client ID
     * @param {string} groupId - Group ID
     * @param {string} message - Message content
     */
    async sendGroupMessage(clientId, groupId, message) {
        const operationId = `send_group_message_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!groupId || typeof groupId !== 'string') {
                throw new ValidationError('Invalid group ID provided');
            }
            if (!message || typeof message !== 'string') {
                throw new ValidationError('Invalid message content provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(groupId, true);
                    
                    // Verificar que el grupo existe
                    const groupChat = await client.getChatById(chatId);
                    if (!groupChat) {
                        throw new NotFoundError('Group not found');
                    }
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    await client.sendMessage(chatId, message);
                });
            });
            
            this.messageMetrics.totalMessagesSent++;
            this.messageMetrics.lastMessageTime = Date.now();
            
            logger.info(`Group message sent successfully to ${groupId} from client ${clientId}`);
            
        } catch (error) {
            logger.error(`Error sending group message to ${groupId} from client ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Send message with mention with enhanced error handling
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone/Group number  
     * @param {boolean} isGroup - Is group chat
     * @param {string} mentionTel - Phone to mention
     * @param {string} message - Message content
     */
    async sendMessageWithMention(clientId, tel, isGroup, mentionTel, message) {
        const operationId = `send_mention_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone/group number provided');
            }
            if (!mentionTel || typeof mentionTel !== 'string') {
                throw new ValidationError('Invalid mention phone number provided');
            }
            if (!message || typeof message !== 'string') {
                throw new ValidationError('Invalid message content provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(tel, isGroup);
                    const mentionId = this.formatContactNumber(mentionTel);
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    const chat = await client.getChatById(chatId);
                    if (!chat) {
                        throw new NotFoundError(`Chat ${tel} not found`);
                    }
                    
                    await chat.sendMessage(message, { mentions: [{ id: mentionId }] });
                });
            });
            
            this.messageMetrics.totalMessagesSent++;
            logger.info(`Message with mention sent successfully`);
            
        } catch (error) {
            logger.error(`Error sending message with mention:`, error);
            throw error;
        }
    }

    /**
     * Reply to message with enhanced message search
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number
     * @param {string} messageId - Message ID to reply to
     * @param {string} reply - Reply content
     * @param {boolean} isGroup - Is group chat
     */
    async replyToMessage(clientId, tel, messageId, reply, isGroup) {
        const operationId = `reply_message_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            if (!messageId || typeof messageId !== 'string') {
                throw new ValidationError('Invalid message ID provided');
            }
            if (!reply || typeof reply !== 'string') {
                throw new ValidationError('Invalid reply content provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(tel, isGroup);
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    const chat = await client.getChatById(chatId);
                    if (!chat) {
                        throw new NotFoundError(`Chat ${tel} not found`);
                    }
                    
                    const message = await this.findMessageWithCache(chat, messageId, clientId);
                    if (!message) {
                        throw new NotFoundError('Message not found');
                    }
                    
                    await chat.sendMessage(reply, { quotedMessageId: message.id._serialized });
                });
            });
            
            this.messageMetrics.totalMessagesSent++;
            logger.info(`Reply sent successfully to ${tel} from client ${clientId}`);
            
        } catch (error) {
            logger.error(`Error replying to message:`, error);
            throw error;
        }
    }

    /**
     * Delete message with enhanced error handling
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number
     * @param {string} messageId - Message ID
     * @param {boolean} forEveryone - Delete for everyone
     * @param {boolean} isGroup - Is group chat
     */
    async deleteMessage(clientId, tel, messageId, forEveryone, isGroup) {
        const operationId = `delete_message_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            if (!messageId || typeof messageId !== 'string') {
                throw new ValidationError('Invalid message ID provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(tel, isGroup);
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    const chat = await client.getChatById(chatId);
                    if (!chat) {
                        throw new NotFoundError(`Chat ${tel} not found`);
                    }
                    
                    const message = await this.findMessageWithCache(chat, messageId, clientId);
                    if (!message) {
                        throw new NotFoundError('Message not found');
                    }
                    
                    await message.delete(forEveryone);
                    
                    // Limpiar del cache
                    this.invalidateMessageCache(messageId);
                });
            });
            
            logger.info(`Message ${messageId} deleted successfully`);
            
        } catch (error) {
            logger.error(`Error deleting message:`, error);
            throw error;
        }
    }

    /**
     * Forward message with enhanced error handling
     * @param {string} clientId - Client ID
     * @param {string} fromTel - Source phone/group
     * @param {string} toTel - Destination phone/group
     * @param {string} messageId - Message ID
     * @param {boolean} isGroupFrom - Is source group
     * @param {boolean} isGroupTo - Is destination group
     */
    async forwardMessage(clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo) {
        const operationId = `forward_message_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!fromTel || typeof fromTel !== 'string') {
                throw new ValidationError('Invalid source phone number provided');
            }
            if (!toTel || typeof toTel !== 'string') {
                throw new ValidationError('Invalid destination phone number provided');
            }
            if (!messageId || typeof messageId !== 'string') {
                throw new ValidationError('Invalid message ID provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const fromChatId = this.formatChatId(fromTel, isGroupFrom);
                    const toChatId = this.formatChatId(toTel, isGroupTo);
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    const fromChat = await client.getChatById(fromChatId);
                    if (!fromChat) {
                        throw new NotFoundError(`Source chat ${fromTel} not found`);
                    }
                    
                    // Verificar que el chat destino existe
                    const toChat = await client.getChatById(toChatId);
                    if (!toChat) {
                        throw new NotFoundError(`Destination chat ${toTel} not found`);
                    }
                    
                    const message = await this.findMessageWithCache(fromChat, messageId, clientId);
                    if (!message) {
                        throw new NotFoundError('Message not found');
                    }
                    
                    await message.forward(toChatId);
                });
            });
            
            this.messageMetrics.totalMessagesSent++;
            logger.info(`Message forwarded from ${fromTel} to ${toTel}`);
            
        } catch (error) {
            logger.error(`Error forwarding message:`, error);
            throw error;
        }
    }

    /**
     * Mark message as important with enhanced error handling
     * @param {string} clientId - Client ID 
     * @param {string} tel - Phone number
     * @param {string} messageId - Message ID
     * @param {boolean} isGroup - Is group chat
     */
    async markMessageAsImportant(clientId, tel, messageId, isGroup) {
        const operationId = `star_message_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            if (!messageId || typeof messageId !== 'string') {
                throw new ValidationError('Invalid message ID provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(tel, isGroup);
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    const chat = await client.getChatById(chatId);
                    if (!chat) {
                        throw new NotFoundError(`Chat ${tel} not found`);
                    }
                    
                    const message = await this.findMessageWithCache(chat, messageId, clientId);
                    if (!message) {
                        throw new NotFoundError('Message not found');
                    }
                    
                    await message.star();
                });
            });
            
            logger.info(`Message ${messageId} marked as important`);
            
        } catch (error) {
            logger.error(`Error marking message as important:`, error);
            throw error;
        }
    }

    /**
     * Unmark message as important with enhanced error handling
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number  
     * @param {string} messageId - Message ID
     * @param {boolean} isGroup - Is group chat
     */
    async unmarkMessageAsImportant(clientId, tel, messageId, isGroup) {
        const operationId = `unstar_message_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            if (!messageId || typeof messageId !== 'string') {
                throw new ValidationError('Invalid message ID provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(tel, isGroup);
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    const chat = await client.getChatById(chatId);
                    if (!chat) {
                        throw new NotFoundError(`Chat ${tel} not found`);
                    }
                    
                    const message = await this.findMessageWithCache(chat, messageId, clientId);
                    if (!message) {
                        throw new NotFoundError('Message not found');
                    }
                    
                    await message.unstar();
                });
            });
            
            logger.info(`Message ${messageId} unmarked as important`);
            
        } catch (error) {
            logger.error(`Error unmarking message as important:`, error);
            throw error;
        }
    }

    /**
     * Edit message with enhanced error handling
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number
     * @param {string} messageId - Message ID
     * @param {string} newContent - New content
     * @param {boolean} isGroup - Is group chat
     */
    async editMessage(clientId, tel, messageId, newContent, isGroup) {
        const operationId = `edit_message_${clientId}_${Date.now()}`;
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            if (!messageId || typeof messageId !== 'string') {
                throw new ValidationError('Invalid message ID provided');
            }
            if (!newContent || typeof newContent !== 'string') {
                throw new ValidationError('Invalid new content provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                return await this.messageCircuitBreaker.execute(async () => {
                    const client = await this.getClientById(clientId);
                    const chatId = this.formatChatId(tel, isGroup);
                    
                    if (!this.whatsAppClient.isReady(clientId)) {
                        throw new Error(`Client ${clientId} is not ready`);
                    }
                    
                    const chat = await client.getChatById(chatId);
                    if (!chat) {
                        throw new NotFoundError(`Chat ${tel} not found`);
                    }
                    
                    const message = await this.findMessageWithCache(chat, messageId, clientId);
                    if (!message) {
                        throw new NotFoundError('Message not found');
                    }
                    
                    await message.edit(newContent);
                    
                    // Invalidar cache del mensaje editado
                    this.invalidateMessageCache(messageId);
                });
            });
            
            logger.info(`Message ${messageId} edited successfully`);
            
        } catch (error) {
            logger.error(`Error editing message:`, error);
            throw error;
        }
    }

    /**
     * Get message info with enhanced error handling
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number
     * @param {string} messageId - Message ID
     * @param {boolean} isGroup - Is group chat
     * @returns {Promise<Object>} Message information
     */
    async getMessageInfo(clientId, tel, messageId, isGroup) {
        const startTime = Date.now();
        
        try {
            // Validaciones
            if (!clientId || typeof clientId !== 'string') {
                throw new ValidationError('Invalid client ID provided');
            }
            if (!tel || typeof tel !== 'string') {
                throw new ValidationError('Invalid phone number provided');
            }
            if (!messageId || typeof messageId !== 'string') {
                throw new ValidationError('Invalid message ID provided');
            }
            
            return await this.messageSearchCircuitBreaker.execute(async () => {
                const client = await this.getClientById(clientId);
                const chatId = this.formatChatId(tel, isGroup);
                
                if (!this.whatsAppClient.isReady(clientId)) {
                    throw new Error(`Client ${clientId} is not ready`);
                }
                
                const chat = await client.getChatById(chatId);
                if (!chat) {
                    throw new NotFoundError(`Chat ${tel} not found`);
                }
                
                const message = await this.findMessageWithCache(chat, messageId, clientId);
                if (!message) {
                    throw new NotFoundError('Message not found');
                }
                
                return {
                    id: message.id._serialized,
                    body: message.body,
                    type: message.type,
                    timestamp: message.timestamp,
                    from: message.from,
                    to: message.to,
                    hasMedia: message.hasMedia,
                    isStarred: message.isStarred,
                    isForwarded: message.isForwarded
                };
            });
            
        } catch (error) {
            logger.error(`Error getting message info:`, error);
            throw error;
        } finally {
            this.updateMessageSearchMetrics(startTime);
        }
    }

    /**
     * Find message with caching and optimized search
     * @private
     */
    async findMessageWithCache(chat, messageId, clientId) {
        const cacheKey = `message_${clientId}_${messageId}`;
        
        // Verificar cache primero
        const cachedMessage = this.getMessageFromCache(cacheKey);
        if (cachedMessage) {
            this.messageMetrics.cacheHits++;
            return cachedMessage;
        }
        
        this.messageMetrics.cacheMisses++;
        
        // Buscar mensaje con límite progresivo
        const limits = [50, 200, 1000, 5000]; // Límites progresivos
        
        for (const limit of limits) {
            try {
                const messages = await Promise.race([
                    chat.fetchMessages({ limit }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Search timeout')), 10000)
                    )
                ]);
                
                const message = messages.find(msg => msg.id._serialized === messageId);
                
                if (message) {
                    // Cachear solo por corto tiempo por privacidad
                    this.setMessageCache(cacheKey, message);
                    return message;
                }
                
                // Si no encontramos el mensaje, continuar con el siguiente límite
                logger.debug(`Message ${messageId} not found in ${limit} messages, trying higher limit`);
                
            } catch (error) {
                logger.warn(`Error searching messages with limit ${limit}:`, error.message);
                continue;
            }
        }
        
        return null;
    }

    /**
     * Cache management for messages
     */
    getMessageFromCache(key) {
        const item = this.messageCache.get(key);
        if (item && Date.now() - item.timestamp < this.messageCacheTimeout) {
            return item.value;
        }
        this.messageCache.delete(key);
        return null;
    }

    setMessageCache(key, value) {
        // Limitar tamaño del cache
        if (this.messageCache.size > 500) {
            const oldestKey = this.messageCache.keys().next().value;
            this.messageCache.delete(oldestKey);
        }
        
        this.messageCache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    invalidateMessageCache(messageId) {
        const keysToDelete = [];
        for (const key of this.messageCache.keys()) {
            if (key.includes(messageId)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.messageCache.delete(key));
    }

    /**
     * Update message search metrics
     */
    updateMessageSearchMetrics(startTime) {
        const duration = Date.now() - startTime;
        this.messageMetrics.messagesSearched++;
        
        const currentAvg = this.messageMetrics.averageSearchTime;
        const count = this.messageMetrics.messagesSearched;
        this.messageMetrics.averageSearchTime = 
            (currentAvg * (count - 1) + duration) / count;
    }

    /**
     * Get message service metrics
     */
    getMessageMetrics() {
        return {
            ...this.messageMetrics,
            messageCacheSize: this.messageCache.size,
            activeClientsPoolSize: this.activeClientsPool.size,
            circuitBreakers: {
                messageOperations: this.messageCircuitBreaker.getState(),
                messageSearch: this.messageSearchCircuitBreaker.getState()
            },
            cacheHitRate: this.messageMetrics.messagesSearched > 0 ? 
                (this.messageMetrics.cacheHits / (this.messageMetrics.cacheHits + this.messageMetrics.cacheMisses) * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Health check for message service
     */
    async getMessageHealthCheck() {
        const baseHealth = await this.healthCheck();
        const messageHealth = {
            ...baseHealth,
            service: 'MessageService',
            messageMetrics: this.getMessageMetrics(),
            specificIssues: []
        };

        // Verificar circuit breakers específicos
        const cbStates = {
            messageOps: this.messageCircuitBreaker.getState(),
            messageSearch: this.messageSearchCircuitBreaker.getState()
        };
        
        Object.entries(cbStates).forEach(([name, state]) => {
            if (state.state === 'OPEN') {
                messageHealth.specificIssues.push(`${name} circuit breaker is OPEN`);
                messageHealth.status = 'degraded';
            }
        });

        // Verificar cache hit rate
        const cacheHitRate = this.messageMetrics.messagesSearched > 0 ? 
            this.messageMetrics.cacheHits / (this.messageMetrics.cacheHits + this.messageMetrics.cacheMisses) : 0;
        
        if (cacheHitRate < 0.2 && this.messageMetrics.messagesSearched > 20) {
            messageHealth.specificIssues.push(`Low message cache hit rate: ${(cacheHitRate * 100).toFixed(2)}%`);
            messageHealth.status = messageHealth.status === 'unhealthy' ? 'unhealthy' : 'degraded';
        }

        return messageHealth;
    }

    /**
     * Cleanup method
     */
    async cleanup() {
        if (this.updateActiveClientsInterval) {
            clearInterval(this.updateActiveClientsInterval);
        }
        
        this.messageCache.clear();
        this.activeClientsPool.clear();
        
        await super.gracefulShutdown('cleanup');
    }
}

module.exports = MessageService;