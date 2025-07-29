const BaseWhatsAppService = require('./baseService');
const MediaService = require('./mediaService');
const { NotFoundError } = require('../../utils/asyncHandler');
const { logger } = require('../../config/logger');
const CircuitBreaker = require('../../utils/circuitBreaker');

/**
 * Chat Service - Handles chat operations and retrievals with resilience
 */
class ChatService extends BaseWhatsAppService {
    constructor() {
        super();
        this.mediaService = new MediaService();
        this.CHATS_PER_PAGE = 20;
        this.MAX_CONCURRENT_FETCHES = 3;

        // Circuit breaker específico para operaciones de chat
        this.chatsCircuitBreaker = new CircuitBreaker('chats-operations', {
            failureThreshold: 3,
            recoveryTimeout: 30000,
            monitoringPeriod: 60000
        });
        
        // Cache de chats con TTL (3 minutos)
        this.chatsCache = new Map();
        this.chatsCacheTimeout = 180000; // 3 minutos
        
        // Semáforo para controlar concurrencia
        this.fetchSemaphore = this.createSemaphore(this.MAX_CONCURRENT_FETCHES);
        
        // Métricas específicas de chats
        this.chatMetrics = {
            totalFetches: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageFetchTime: 0,
            lastFetchTime: null,
            messagesProcessed: 0
        };
    }

    /**
     * Crear semáforo simple para controlar concurrencia
     */
    createSemaphore(maxConcurrent) {
        let current = 0;
        const queue = [];
        
        return {
            acquire: () => {
                return new Promise((resolve) => {
                    if (current < maxConcurrent) {
                        current++;
                        resolve(() => {
                            current--;
                            if (queue.length > 0) {
                                const next = queue.shift();
                                current++;
                                next(() => {
                                    current--;
                                });
                            }
                        });
                    } else {
                        queue.push(resolve);
                    }
                });
            }
        };
    }

    async init() {
        await super.init();
        await this.mediaService.init();
    }

    /**
     * Fetch unread chats with pagination, caching and resilience
     * @param {number} page - Page number
     * @param {number} limit - Items per page
     * @returns {Promise<Object>} Paginated unread chats
     */
    async fetchUnreadChats(page, limit) {
        const startTime = Date.now();
        const cacheKey = `unread_chats_page_${page}_limit_${limit}`;
        
        try {
            // Verificar cache primero
            const cachedChats = this.getChatsFromCache(cacheKey);
            if (cachedChats) {
                this.chatMetrics.cacheHits++;
                logger.debug(`Cache hit for unread chats page ${page}`);
                return cachedChats;
            }
            
            this.chatMetrics.cacheMisses++;
            
            // Ejecutar con circuit breaker
            const result = await this.chatsCircuitBreaker.execute(async () => {
                return await this._fetchUnreadChatsWithFallback(page, limit);
            });
            
            // Cachear resultado exitoso
            this.setChatsCache(cacheKey, result);
            this.updateChatMetrics(startTime, true);
            
            logger.info(`Chats no leídos obtenidos - Página: ${page}, Total: ${result.totalUnreadChats}`);
            return result;
            
        } catch (error) {
            this.updateChatMetrics(startTime, false);
            logger.error(`Error al obtener chats no leídos - Página ${page}:`, error);
            
            // Intentar devolver datos desde cache aunque esté expirado
            const staleCache = this.getStaleChatsFromCache(cacheKey);
            if (staleCache) {
                logger.warn(`Returning stale cache for unread chats page ${page} due to error`);
                return staleCache;
            }
            
            // Como último recurso, devolver estructura vacía
            return {
                chats: [],
                totalUnreadChats: 0,
                totalPages: 0
            };
        }
    }

    /**
     * Fetch unread chats with fallback mechanisms
     * @private
     */
    async _fetchUnreadChatsWithFallback(page, limit) {
        await this.ensureServiceReady();

        const clients = Array.from(this.whatsAppClient.clients.values());

        if (!clients.length) {
            logger.warn('No hay clientes de WhatsApp disponibles para chats no leídos');
            return {
                chats: [],
                totalUnreadChats: 0,
                totalPages: 0
            };
        }

        try {
            // Obtener chats no leídos de todos los clientes con resiliencia
            const allUnreadChats = await this.getAllUnreadChatsResilient(clients);
            
            if (!allUnreadChats.length) {
                logger.info('No se encontraron chats no leídos');
                return {
                    chats: [],
                    totalUnreadChats: 0,
                    totalPages: 0
                };
            }
            
            allUnreadChats.sort((a, b) => b.recentMessageDate - a.recentMessageDate);

            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const totalUnreadChats = allUnreadChats.length;

            return {
                chats: allUnreadChats.slice(startIndex, endIndex),
                totalUnreadChats,
                totalPages: Math.ceil(totalUnreadChats / limit)
            };
            
        } catch (error) {
            logger.error('Error in _fetchUnreadChatsWithFallback:', error);
            throw error;
        }
    }

    /**
     * Fetch chats with pagination, caching and resilience
     * @param {number} page - Page number
     * @param {number} limit - Items per page
     * @returns {Promise<Object>} Paginated chats
     */
    async fetchChats(page, limit) {
        const startTime = Date.now();
        const cacheKey = `all_chats_page_${page}_limit_${limit}`;
        
        try {
            // Verificar cache primero
            const cachedChats = this.getChatsFromCache(cacheKey);
            if (cachedChats) {
                this.chatMetrics.cacheHits++;
                logger.debug(`Cache hit for all chats page ${page}`);
                return cachedChats;
            }
            
            this.chatMetrics.cacheMisses++;
            
            // Ejecutar con circuit breaker
            const result = await this.chatsCircuitBreaker.execute(async () => {
                return await this._fetchChatsWithFallback(page, limit);
            });
            
            // Cachear resultado exitoso
            this.setChatsCache(cacheKey, result);
            this.updateChatMetrics(startTime, true);
            
            logger.info(`Todos los chats obtenidos - Página: ${page}, Total no leídos: ${result.totalUnreadChats}`);
            return result;
            
        } catch (error) {
            this.updateChatMetrics(startTime, false);
            logger.error(`Error al obtener todos los chats - Página ${page}:`, error);
            
            // Intentar devolver datos desde cache aunque esté expirado
            const staleCache = this.getStaleChatsFromCache(cacheKey);
            if (staleCache) {
                logger.warn(`Returning stale cache for all chats page ${page} due to error`);
                return staleCache;
            }
            
            // Como último recurso, devolver estructura vacía
            return {
                chats: [],
                totalUnreadChats: 0,
                totalPages: 0
            };
        }
    }

    /**
     * Fetch all chats with fallback mechanisms
     * @private
     */
    async _fetchChatsWithFallback(page, limit) {
        await this.ensureServiceReady();

        const clients = Array.from(this.whatsAppClient.clients.values());

        if (!clients.length) {
            logger.warn('No hay clientes de WhatsApp disponibles para todos los chats');
            return {
                chats: [],
                totalUnreadChats: 0,
                totalPages: 0
            };
        }

        try {
            // Obtener todos los chats de todos los clientes con resiliencia
            const allChats = await this.getAllChatsResilient(clients);
            
            if (!allChats.length) {
                logger.info('No se encontraron chats');
                return {
                    chats: [],
                    totalUnreadChats: 0,
                    totalPages: 0
                };
            }
            
            allChats.sort((a, b) => b.timestamp - a.timestamp);

            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const totalUnreadChats = allChats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);

            return {
                chats: allChats.slice(startIndex, endIndex),
                totalUnreadChats,
                totalPages: Math.ceil(allChats.length / limit)
            };
            
        } catch (error) {
            logger.error('Error in _fetchChatsWithFallback:', error);
            throw error;
        }
    }

    /**
     * Get unread chats from all clients with resilience
     * @param {Array} clients - Array of WhatsApp clients
     * @returns {Promise<Array>} All unread chats
     */
    async getAllUnreadChatsResilient(clients) {
        const chatsPromises = clients.map(async (client) => {
            // Usar semáforo para limitar concurrencia
            const release = await this.fetchSemaphore.acquire();
            
            try {
                // Timeout por cliente individual
                return await Promise.race([
                    this._getUnreadChatsFromClient(client),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Client timeout')), 20000)
                    )
                ]);
            } catch (error) {
                logger.error(`Error obteniendo chats no leídos para cliente ${client.options?.authStrategy?.clientId}:`, error);
                return []; // Devolver array vacío en lugar de fallar
            } finally {
                release();
            }
        });

        const chatsResults = await Promise.allSettled(chatsPromises);
        
        // Filtrar solo resultados exitosos y combinar
        const successfulResults = chatsResults
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)
            .flat();
            
        // Log de estadísticas
        const failedCount = chatsResults.length - chatsResults.filter(r => r.status === 'fulfilled').length;
        if (failedCount > 0) {
            logger.warn(`Failed to get unread chats from ${failedCount}/${clients.length} clients`);
        }
        
        return successfulResults;
    }

    /**
     * Get all chats from all clients with resilience
     * @param {Array} clients - Array of WhatsApp clients
     * @returns {Promise<Array>} All chats
     */
    async getAllChatsResilient(clients) {
        const chatsPromises = clients.map(async (client) => {
            // Usar semáforo para limitar concurrencia
            const release = await this.fetchSemaphore.acquire();
            
            try {
                // Timeout por cliente individual
                return await Promise.race([
                    this._getAllChatsFromClient(client),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Client timeout')), 20000)
                    )
                ]);
            } catch (error) {
                logger.error(`Error obteniendo todos los chats para cliente ${client.options?.authStrategy?.clientId}:`, error);
                return []; // Devolver array vacío en lugar de fallar
            } finally {
                release();
            }
        });

        const chatsResults = await Promise.allSettled(chatsPromises);
        
        // Filtrar solo resultados exitosos y combinar
        const successfulResults = chatsResults
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)
            .flat();
            
        // Log de estadísticas
        const failedCount = chatsResults.length - chatsResults.filter(r => r.status === 'fulfilled').length;
        if (failedCount > 0) {
            logger.warn(`Failed to get all chats from ${failedCount}/${clients.length} clients`);
        }
        
        return successfulResults;
    }

    /**
     * Get unread chats from a single client
     * @private
     */
    async _getUnreadChatsFromClient(client) {
        const chats = await client.getChats();
        const unreadChats = chats.filter(chat => chat.unreadCount > 0);

        return Promise.all(unreadChats.map(chat => this.processChat(chat, client)));
    }

    /**
     * Get all chats from a single client
     * @private
     */
    async _getAllChatsFromClient(client) {
        const chats = await client.getChats();
        return Promise.all(chats.map(chat => this.processChat(chat, client)));
    }

    /**
     * Process chat to get additional details with resilience
     * @param {Object} chat - Chat object
     * @param {Object} client - WhatsApp client instance
     * @returns {Promise<Object>} Processed chat
     */
    async processChat(chat, client) {
        try {
            const BATCH_TIMEOUT = 10000; // 10 segundos timeout total
            
            const [contact, profilePicUrl, recentMessageDate, groupData] = await Promise.race([
                Promise.allSettled([
                    this._getContactSafely(chat),
                    this._getProfilePictureSafely(client, chat.id._serialized),
                    this._getRecentMessageDateSafely(chat),
                    chat.id.server === 'g.us' ? this._getGroupDataSafely(chat, client) : Promise.resolve([])
                ]),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Process chat timeout')), BATCH_TIMEOUT)
                )
            ]);

            return {
                ...chat,
                recentMessageDate: recentMessageDate.status === 'fulfilled' ? recentMessageDate.value : 0,
                profilePicUrl: profilePicUrl.status === 'fulfilled' ? profilePicUrl.value : this.getDefaultProfilePic(),
                groupData: groupData.status === 'fulfilled' ? groupData.value : [],
                client: client.options?.authStrategy?.clientId || 'unknown'
            };
        } catch (error) {
            logger.error(`Error processing chat: ${error.message}`);
            return this.getDefaultChatData(chat, client);
        }
    }

    /**
     * Get contact safely with error handling
     * @private
     */
    async _getContactSafely(chat) {
        try {
            return await Promise.race([
                chat.getContact(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Contact fetch timeout')), 5000)
                )
            ]);
        } catch (error) {
            logger.debug(`Error getting contact for chat ${chat.id._serialized}:`, error.message);
            return null;
        }
    }

    /**
     * Get profile picture safely with error handling
     * @private
     */
    async _getProfilePictureSafely(client, chatId) {
        try {
            return await Promise.race([
                this.getProfilePicture(client, chatId),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Profile pic timeout')), 5000)
                )
            ]);
        } catch (error) {
            logger.debug(`Error getting profile picture for ${chatId}:`, error.message);
            return this.getDefaultProfilePic();
        }
    }

    /**
     * Get recent message date safely with error handling
     * @private
     */
    async _getRecentMessageDateSafely(chat) {
        try {
            return await Promise.race([
                this.getRecentMessageDate(chat),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Recent message timeout')), 8000)
                )
            ]);
        } catch (error) {
            logger.debug(`Error getting recent message date for chat ${chat.id._serialized}:`, error.message);
            return 0;
        }
    }

    /**
     * Get group data safely with error handling
     * @private
     */
    async _getGroupDataSafely(chat, client) {
        try {
            return await Promise.race([
                this.getGroupData(chat, client),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Group data timeout')), 8000)
                )
            ]);
        } catch (error) {
            logger.debug(`Error getting group data for chat ${chat.id._serialized}:`, error.message);
            return [];
        }
    }

    /**
     * Get recent message date with improved error handling
     * @param {Object} chat - Chat object
     * @returns {Promise<number>} Recent message timestamp
     */
    async getRecentMessageDate(chat) {
        try {
            const messages = await chat.fetchMessages({ limit: 1 });
            return messages.length > 0 ? messages[0].timestamp : 0;
        } catch (error) {
            logger.debug('Error getting recent message date:', error.message);
            return 0;
        }
    }

    /**
     * Get group data with improved error handling
     * @param {Object} chat - Chat object
     * @param {Object} client - WhatsApp client instance
     * @returns {Promise<Array>} Group participants data
     */
    async getGroupData(chat, client) {
        if (!chat.participants) return [];

        try {
            const PARTICIPANT_BATCH_SIZE = 5;
            const results = [];
            
            for (let i = 0; i < chat.participants.length; i += PARTICIPANT_BATCH_SIZE) {
                const batch = chat.participants.slice(i, i + PARTICIPANT_BATCH_SIZE);
                
                const batchPromises = batch.map(async participant => {
                    try {
                        const contact = await Promise.race([
                            client.getContactById(participant.id._serialized),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Participant timeout')), 3000)
                            )
                        ]);
                        
                        return {
                            id: participant.id._serialized,
                            isAdmin: participant.isAdmin,
                            isSuperAdmin: participant.isSuperAdmin,
                            name: contact.name || contact.number || participant.id._serialized
                        };
                    } catch (error) {
                        logger.debug(`Error getting participant ${participant.id._serialized}:`, error.message);
                        return {
                            id: participant.id._serialized,
                            isAdmin: participant.isAdmin,
                            isSuperAdmin: participant.isSuperAdmin,
                            name: participant.id._serialized
                        };
                    }
                });

                const batchResults = await Promise.allSettled(batchPromises);
                results.push(...batchResults.map(r => r.value || r.reason));
                
                // Pequeña pausa entre lotes
                if (i + PARTICIPANT_BATCH_SIZE < chat.participants.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            return results;
        } catch (error) {
            logger.error('Error getting group data:', error);
            return [];
        }
    }

    /**
     * Mark chat as read with retry logic
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number
     * @param {boolean} isGroup - Is group chat
     */
    async markChatRead(clientId, tel, isGroup) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const operationId = `mark_read_${clientId}_${tel}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !tel) {
                throw new ValidationError('Client ID and telephone are required');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = this.whatsAppClient.getClient(clientId);
                if (!client) {
                    throw new NotFoundError(`Client ${clientId} not found`);
                }

                const chatId = this.formatChatId(tel, isGroup);
                const chat = await client.getChatById(chatId);
                
                if (!chat) {
                    throw new NotFoundError(`Chat ${chatId} not found`);
                }

                await chat.sendSeen();
            });
            
            // Invalidar cache relacionado
            this.invalidateChatsCache();
            logger.info(`Chat marcado como leído - Cliente: ${clientId}, Tel: ${tel}`);
        } catch (error) {
            logger.error(`Error marking chat as read ${clientId}/${tel}:`, error);
            throw error;
        }
    }

    /**
     * Mark chat as unread with retry logic
     * @param {string} clientId - Client ID
     * @param {string} tel - Phone number  
     * @param {boolean} isGroup - Is group chat
     */
    async markChatUnread(clientId, tel, isGroup) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const operationId = `mark_unread_${clientId}_${tel}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !tel) {
                throw new ValidationError('Client ID and telephone are required');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = this.whatsAppClient.getClient(clientId);
                if (!client) {
                    throw new NotFoundError(`Client ${clientId} not found`);
                }

                const chatId = this.formatChatId(tel, isGroup);
                const chat = await client.getChatById(chatId);
                
                if (!chat) {
                    throw new NotFoundError(`Chat ${chatId} not found`);
                }

                await chat.markUnread();
            });
            
            // Invalidar cache relacionado
            this.invalidateChatsCache();
            logger.info(`Chat marcado como no leído - Cliente: ${clientId}, Tel: ${tel}`);
        } catch (error) {
            logger.error(`Error marking chat as unread ${clientId}/${tel}:`, error);
            throw error;
        }
    }

    /**
     * Mute chat with retry logic
     * @param {Object} params - Mute chat parameters
     */
    async muteChat(params) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const { clientId, tel, isGroup, unmuteDate } = params;
        const operationId = `mute_chat_${clientId}_${tel}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !tel) {
                throw new ValidationError('Client ID and telephone are required');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = await this.getClientById(clientId);
                const chatId = this.formatChatId(tel, isGroup);

                await client.muteChat(chatId, unmuteDate ? new Date(unmuteDate) : null);
            });
            
            // Invalidar cache relacionado
            this.invalidateChatsCache();
            logger.info(`Chat silenciado - Cliente: ${clientId}, Tel: ${tel}`);
        } catch (error) {
            logger.error(`Error muting chat ${clientId}/${tel}:`, error);
            throw error;
        }
    }

    /**
     * Pin chat with retry logic
     * @param {Object} params - Pin chat parameters
     */
    async pinChat(params) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const { clientId, tel, isGroup } = params;
        const operationId = `pin_chat_${clientId}_${tel}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !tel) {
                throw new ValidationError('Client ID and telephone are required');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = await this.getClientById(clientId);
                const chatId = this.formatChatId(tel, isGroup);
                
                await client.pinChat(chatId);
            });
            
            // Invalidar cache relacionado
            this.invalidateChatsCache();
            logger.info(`Chat fijado - Cliente: ${clientId}, Tel: ${tel}`);
        } catch (error) {
            logger.error(`Error pinning chat ${clientId}/${tel}:`, error);
            throw error;
        }
    }

    /**
     * Unpin chat with retry logic
     * @param {Object} params - Unpin chat parameters
     */
    async unpinChat(params) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const { clientId, tel, isGroup } = params;
        const operationId = `unpin_chat_${clientId}_${tel}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !tel) {
                throw new ValidationError('Client ID and telephone are required');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = await this.getClientById(clientId);
                const chatId = this.formatChatId(tel, isGroup);

                await client.unpinChat(chatId);
            });
            
            // Invalidar cache relacionado
            this.invalidateChatsCache();
            logger.info(`Chat desfijado - Cliente: ${clientId}, Tel: ${tel}`);
        } catch (error) {
            logger.error(`Error unpinning chat ${clientId}/${tel}:`, error);
            throw error;
        }
    }

    /**
     * Get group chat messages with resilience
     * @param {string} number - Client number
     * @param {string} groupId - Group ID
     * @returns {Promise<Array>} Messages list
     */
    async getGroupChatMessages(number, groupId) {
        if (this.isShuttingDown) return [];
        
        const operationId = `get_group_messages_${number}_${groupId}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!number || !groupId) {
                throw new ValidationError('Client number and group ID are required');
            }
            
            return await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = await this.getClientById(number);
                const chatId = `${groupId}@g.us`;
                
                const chat = await client.getChatById(chatId);
                if (!chat) {
                    throw new NotFoundError(`Group chat ${groupId} not found`);
                }
                
                const messages = await chat.fetchMessages({ limit: 30 });
                
                // Procesar mensajes en lotes para mejor rendimiento
                const BATCH_SIZE = 10;
                const processedMessages = [];
                
                for (let i = 0; i < messages.length; i += BATCH_SIZE) {
                    const batch = messages.slice(i, i + BATCH_SIZE);
                    const batchPromises = batch.map(msg => this.formatMessage(msg));
                    const batchResults = await Promise.allSettled(batchPromises);
                    
                    processedMessages.push(...batchResults
                        .filter(result => result.status === 'fulfilled')
                        .map(result => result.value)
                    );
                }
                
                this.chatMetrics.messagesProcessed += processedMessages.length;
                return processedMessages;
            });
        } catch (error) {
            logger.error(`Error getting group messages ${number}/${groupId}:`, error);
            throw error;
        }
    }

    /**
     * Get group chat messages with resilience
     * @param {string} number - Client number
     * @param {string} groupId - Group ID
     * @returns {Promise<Array>} Messages list
     */
    async getGroupChatMessages(number, groupId) {
        if (this.isShuttingDown) return [];
        
        const operationId = `get_group_messages_${number}_${groupId}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!number || !groupId) {
                throw new ValidationError('Client number and group ID are required');
            }
            
            return await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = await this.getClientById(number);
                const chatId = `${groupId}@g.us`;
                
                const chat = await client.getChatById(chatId);
                if (!chat) {
                    throw new NotFoundError(`Group chat ${groupId} not found`);
                }
                
                const messages = await chat.fetchMessages({ limit: 30 });
                
                // Procesar mensajes en lotes para mejor rendimiento
                const BATCH_SIZE = 10;
                const processedMessages = [];
                
                for (let i = 0; i < messages.length; i += BATCH_SIZE) {
                    const batch = messages.slice(i, i + BATCH_SIZE);
                    const batchPromises = batch.map(msg => this.formatMessage(msg));
                    const batchResults = await Promise.allSettled(batchPromises);
                    
                    processedMessages.push(...batchResults
                        .filter(result => result.status === 'fulfilled')
                        .map(result => result.value)
                    );
                }
                
                this.chatMetrics.messagesProcessed += processedMessages.length;
                return processedMessages;
            });
        } catch (error) {
            logger.error(`Error getting chat messages ${clientId}/${tel}:`, error);
            throw error;
        }
    }

    /**
     * Format message with media and encryption - improved resilience
     * @param {Object} message - WhatsApp message
     * @returns {Promise<Object>} Formatted message
     * @private
     */
    async formatMessage(message) {
        try {
            const formattedMessage = {
                id: message.id._serialized,
                body: message.body || '-',
                timestamp: message.timestamp,
                from: message.from,
                to: message.to,
                fromMe: message.fromMe,
                hasMedia: message.hasMedia,
                mediaType: message.type,
                mediaMimeType: message._data?.mimetype || null,
                caption: message.caption || null,
                hasQuotedMsg: message.hasQuotedMsg,
                quotedParticipant: message._data?.quotedParticipant || null,
                quotedStanzaID: message._data?.quotedStanzaID || null,
                quotedMsg: message._data?.quotedMsg || null,
                isStarred: message.isStarred,
                isForwarded: message.isForwarded
            };

            // Procesar media con timeout y manejo de errores
            if (message.hasMedia) {
                try {
                    const mediaData = await Promise.race([
                        this.mediaService.processMessageMedia(message),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Media processing timeout')), 15000)
                        )
                    ]);
                    Object.assign(formattedMessage, mediaData);
                } catch (error) {
                    logger.warn(`Error processing media for message ${message.id._serialized}:`, error.message);
                    // Continuar sin media en caso de error
                }
            }

            // Procesar ubicación si existe
            if (message.location) {
                formattedMessage.location = {
                    latitude: message.location.latitude,
                    longitude: message.location.longitude,
                    description: message.location.description || null
                };
            }

            return formattedMessage;
        } catch (error) {
            logger.error(`Error formatting message ${message.id?._serialized}:`, error);
            // Devolver mensaje básico en caso de error
            return {
                id: message.id?._serialized || 'unknown',
                body: message.body || 'Error processing message',
                timestamp: message.timestamp || Date.now(),
                from: message.from || 'unknown',
                to: message.to || 'unknown',
                fromMe: message.fromMe || false,
                hasMedia: false,
                mediaType: 'error',
                error: 'Message processing failed'
            };
        }
    }

    /**
     * Cache management for chats
     */
    getChatsFromCache(key) {
        const item = this.chatsCache.get(key);
        if (item && Date.now() - item.timestamp < this.chatsCacheTimeout) {
            return item.value;
        }
        return null;
    }

    getStaleChatsFromCache(key) {
        const item = this.chatsCache.get(key);
        return item ? item.value : null;
    }

    setChatsCache(key, value) {
        this.chatsCache.set(key, {
            value,
            timestamp: Date.now()
        });
        
        // Limpiar cache antiguo si es muy grande
        if (this.chatsCache.size > 50) {
            this.cleanupOldChatsCache();
        }
    }

    invalidateChatsCache() {
        this.chatsCache.clear();
        logger.debug('Chats cache invalidated');
    }

    cleanupOldChatsCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, item] of this.chatsCache.entries()) {
            if (now - item.timestamp > this.chatsCacheTimeout) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.chatsCache.delete(key));
        
        if (keysToDelete.length > 0) {
            logger.debug(`Cleaned up ${keysToDelete.length} expired chat cache entries`);
        }
    }

    /**
     * Update chat-specific metrics
     */
    updateChatMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        this.chatMetrics.totalFetches++;
        
        // Calcular promedio móvil
        const currentAvg = this.chatMetrics.averageFetchTime;
        const count = this.chatMetrics.totalFetches;
        this.chatMetrics.averageFetchTime = 
            (currentAvg * (count - 1) + duration) / count;
        
        this.chatMetrics.lastFetchTime = Date.now();
    }

    /**
     * Get chats service metrics
     * @returns {Object} Service metrics
     */
    getChatsMetrics() {
        return {
            ...this.chatMetrics,
            cacheSize: this.chatsCache.size,
            circuitBreakerState: this.chatsCircuitBreaker.getState(),
            cacheHitRate: this.chatMetrics.totalFetches > 0 ? 
                (this.chatMetrics.cacheHits / this.chatMetrics.totalFetches * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Health check for chats service
     * @returns {Object} Health status
     */
    async getChatsHealthCheck() {
        const baseHealth = await this.healthCheck();
        const chatsHealth = {
            ...baseHealth,
            service: 'ChatService',
            chatsMetrics: this.getChatsMetrics(),
            specificIssues: []
        };

        // Verificar circuit breaker específico de chats
        const cbState = this.chatsCircuitBreaker.getState();
        if (cbState.state === 'OPEN') {
            chatsHealth.specificIssues.push('Chats circuit breaker is OPEN');
            chatsHealth.status = 'degraded';
        }

        // Verificar si hay muchos fallos en cache
        const cacheHitRate = this.chatMetrics.totalFetches > 0 ? 
            this.chatMetrics.cacheHits / this.chatMetrics.totalFetches : 0;
        
        if (cacheHitRate < 0.2 && this.chatMetrics.totalFetches > 10) {
            chatsHealth.specificIssues.push(`Low cache hit rate: ${(cacheHitRate * 100).toFixed(2)}%`);
            chatsHealth.status = chatsHealth.status === 'unhealthy' ? 'unhealthy' : 'degraded';
        }

        return chatsHealth;
    }
}

module.exports = ChatService;