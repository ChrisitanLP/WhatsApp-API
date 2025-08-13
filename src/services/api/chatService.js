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
        this.MAX_CONCURRENT_FETCHES = 15;
        this.MAX_CONCURRENT_CHAT_PROCESSING = 12;
        this.MAX_CONCURRENT_MESSAGE_PROCESSING = 10;
        this.MAX_CONCURRENT_GROUP_PROCESSING = 10;

        // Circuit breaker específico para operaciones de chat
        this.chatsCircuitBreaker = new CircuitBreaker('chats-operations', {
            failureThreshold: 5,
            recoveryTimeout: 15000,
            monitoringPeriod: 60000
        });

        // Cache de mensajes con TTL 
        this.messagesCache = new Map();
        this.messagesCacheTimeout = 180000; 
        this.preprocessedMessages = new Map(); 
        this.MESSAGE_CACHE_UPDATE_INTERVAL = 120000;

         // Cache de mensajes de grupo con TTL 
        this.groupMessagesCache = new Map();
        this.groupMessagesCacheTimeout = 200000; 
        this.preprocessedGroupMessages = new Map();
        this.GROUP_MESSAGE_CACHE_UPDATE_INTERVAL = 120000;
        
        // Cache de chats con TTL 
        this.chatsCache = new Map();
        this.chatsCacheTimeout = 120000;
        this.proactiveCache = new Map();
        this.lastProactiveUpdate = 0;
        this.PROACTIVE_CACHE_INTERVAL = 45000;

        // ESTRUCTURA PREPROCESADA PARA EVITAR REORDENAR
        this.preprocessedChats = {
            allChats: [],
            totalUnreadChats: 0,
            lastUpdate: 0,
            isUpdating: false
        };

        this.preprocessedUnreadChats = {
            unreadChats: [],
            totalUnreadChats: 0,
            lastUpdate: 0,
            isUpdating: false
        };
        
        // Semáforo para controlar concurrencia
        this.fetchSemaphore = this.createSemaphore(this.MAX_CONCURRENT_FETCHES);
        this.chatProcessingSemaphore = this.createSemaphore(this.MAX_CONCURRENT_CHAT_PROCESSING);
        this.messageProcessingSemaphore = this.createSemaphore(this.MAX_CONCURRENT_MESSAGE_PROCESSING); 
        this.groupProcessingSemaphore = this.createSemaphore(this.MAX_CONCURRENT_GROUP_PROCESSING); // ✅ NUEVO
    
        // Métricas específicas de chats
        this.chatMetrics = {
            totalFetches: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageFetchTime: 0,
            lastFetchTime: null,
            messagesProcessed: 0,
            staleDataReturned: 0,
            proactiveUpdates: 0,
            unreadProactiveUpdates: 0,
            messagesCacheHits: 0,
            messagesCacheMisses: 0,
            messagesProactiveUpdates: 0,
            averageMessagesFetchTime: 0,
            groupMessagesCacheHits: 0,
            groupMessagesCacheMisses: 0,
            groupMessagesProactiveUpdates: 0,
            averageGroupMessagesFetchTime: 0,
            groupsProcessed: 0
        };

        this.initProactiveCache();
        this.initMessagesProactiveCache();
        this.initGroupMessagesProactiveCache();
    }

    /**
     * Inicializar cache proactivo que se actualiza en segundo plano
     */
    initProactiveCache() {
        // Primera actualización después de 5 segundos
        setTimeout(() => this.updateProactiveCache(), 5000);
        // Actualizaciones periódicas cada 45 segundos
        setInterval(() => this.updateProactiveCache(), this.PROACTIVE_CACHE_INTERVAL);
        logger.info('Proactive cache initialized - updates every 45 seconds');
    }

    /**
     * Inicializar cache proactivo de mensajes para grupos activos
     */
    initGroupMessagesProactiveCache() {
        // Primera actualización después de 20 segundos
        setTimeout(() => this.updateGroupMessagesProactiveCache(), 20000);
        // Actualizaciones periódicas cada 2.5 minutos
        setInterval(() => this.updateGroupMessagesProactiveCache(), this.GROUP_MESSAGE_CACHE_UPDATE_INTERVAL);
        logger.info('Group messages proactive cache initialized - updates every 2.5 minutes');
    }


    /**
     * Inicializar cache proactivo de mensajes para chats activos
     */
    initMessagesProactiveCache() {
        // Primera actualización después de 15 segundos
        setTimeout(() => this.updateMessagesProactiveCache(), 15000);
        // Actualizaciones periódicas cada 2 minutos
        setInterval(() => this.updateMessagesProactiveCache(), this.MESSAGE_CACHE_UPDATE_INTERVAL);
        logger.info('Messages proactive cache initialized - updates every 2 minutes');
    }

    /**
     * Actualizar cache proactivo en segundo plano
     */
    async updateProactiveCache() {
        if ((this.preprocessedChats.isUpdating || this.preprocessedUnreadChats.isUpdating) || this.isShuttingDown) return;
        
        // Marcar ambos como actualizándose
        this.preprocessedChats.isUpdating = true;
        this.preprocessedUnreadChats.isUpdating = true;
        const startTime = Date.now();
        
        try {
            logger.debug('Starting proactive cache update (all + unread chats)...');
            
            const clients = Array.from(this.whatsAppClient.clients.values());
            if (!clients.length) {
                logger.warn('No clients available for proactive cache update');
                return;
            }

            // ✅ OBTENER TODOS LOS CHATS Y FILTRAR UNREAD EN PARALELO
            const [allChats, unreadChats] = await Promise.all([
                this.getAllChatsResilient(clients, true), // Todos los chats
                this.getAllUnreadChatsResilient(clients) // Solo chats no leídos
            ]);
            
            // ✅ PROCESAR ALL CHATS
            if (allChats.length > 0) {
                allChats.sort((a, b) => b.timestamp - a.timestamp);
                const totalUnreadChats = allChats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);

                this.preprocessedChats = {
                    allChats,
                    totalUnreadChats,
                    lastUpdate: Date.now(),
                    isUpdating: false
                };

                // Cachear páginas comunes para ALL CHATS
                this.cacheCommonPages(allChats, totalUnreadChats);
                this.chatMetrics.proactiveUpdates++;
            }

            // ✅ PROCESAR UNREAD CHATS
            if (unreadChats.length > 0) {
                unreadChats.sort((a, b) => b.recentMessageDate - a.recentMessageDate);
                
                this.preprocessedUnreadChats = {
                    unreadChats,
                    totalUnreadChats: unreadChats.length,
                    lastUpdate: Date.now(),
                    isUpdating: false
                };

                // Cachear páginas comunes para UNREAD CHATS
                this.cacheCommonUnreadPages(unreadChats);
                this.chatMetrics.unreadProactiveUpdates++;
            } else {
                // Si no hay chats no leídos, resetear estructura
                this.preprocessedUnreadChats = {
                    unreadChats: [],
                    totalUnreadChats: 0,
                    lastUpdate: Date.now(),
                    isUpdating: false
                };
            }
            
            const duration = Date.now() - startTime;
            logger.info(`Proactive cache updated - All: ${allChats.length} chats, Unread: ${unreadChats.length} chats, ${duration}ms`);
            
        } catch (error) {
            logger.error('Error updating proactive cache:', error);
        } finally {
            this.preprocessedChats.isUpdating = false;
            this.preprocessedUnreadChats.isUpdating = false;
        }
    }

    /**
     * Actualizar cache proactivo de mensajes de grupos en segundo plano
     */
    async updateGroupMessagesProactiveCache() {
        if (this.isShuttingDown) return;
        
        try {
            logger.debug('Starting group messages proactive cache update...');
            
            // Obtener grupos más activos (de chats preprocesados)
            const activeGroups = this.getActiveGroupIds();
            if (activeGroups.length === 0) return;
            
            const clients = Array.from(this.whatsAppClient.clients.values());
            if (!clients.length) return;

            // ✅ PROCESAR EN LOTES PARA NO SOBRECARGAR
            const BATCH_SIZE = 2; // 2 grupos a la vez (más pesados que chats individuales)
            let processedCount = 0;
            
            for (let i = 0; i < activeGroups.length && i < 10; i += BATCH_SIZE) {
                const batch = activeGroups.slice(i, i + BATCH_SIZE);
                
                const batchPromises = batch.map(async ({ clientId, groupId }) => {
                    try {
                        await this.preloadGroupMessagesOptimized(clientId, groupId);
                        processedCount++;
                    } catch (error) {
                        logger.debug(`Error preloading group messages for ${clientId}/${groupId}:`, error.message);
                    }
                });
                
                await Promise.allSettled(batchPromises);
                
                // Pausa más larga entre lotes (grupos son más pesados)
                if (i + BATCH_SIZE < activeGroups.length) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }
            
            this.chatMetrics.groupMessagesProactiveUpdates++;
            logger.info(`Group messages proactive cache updated - ${processedCount} groups processed`);
            
        } catch (error) {
            logger.error('Error updating group messages proactive cache:', error);
        }
    }

    /**
     * Actualizar cache proactivo de mensajes en segundo plano
     */
    async updateMessagesProactiveCache() {
        if (this.isShuttingDown) return;
        
        try {
            logger.debug('Starting messages proactive cache update...');
            
            // Obtener chats más activos (top 15 por actividad reciente)
            const activeChats = this.getActiveChatIds();
            if (activeChats.length === 0) return;
            
            const clients = Array.from(this.whatsAppClient.clients.values());
            if (!clients.length) return;

            // ✅ PROCESAR EN LOTES PARA NO SOBRECARGAR
            const BATCH_SIZE = 3; // 3 chats a la vez
            let processedCount = 0;
            
            for (let i = 0; i < activeChats.length && i < 15; i += BATCH_SIZE) {
                const batch = activeChats.slice(i, i + BATCH_SIZE);
                
                const batchPromises = batch.map(async ({ clientId, tel }) => {
                    try {
                        await this.preloadChatMessagesOptimized(clientId, tel);
                        processedCount++;
                    } catch (error) {
                        logger.debug(`Error preloading messages for ${clientId}/${tel}:`, error.message);
                    }
                });
                
                await Promise.allSettled(batchPromises);
                
                // Pausa entre lotes
                if (i + BATCH_SIZE < activeChats.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            this.chatMetrics.messagesProactiveUpdates++;
            logger.info(`Messages proactive cache updated - ${processedCount} chats processed`);
            
        } catch (error) {
            logger.error('Error updating messages proactive cache:', error);
        }
    }

    /**
     * Obtener IDs de chats más activos basado en cache actual
     */
    getActiveChatIds() {
        const activeChats = [];
        
        // Obtener de chats preprocesados (más recientes primero)
        if (this.preprocessedChats.allChats.length > 0) {
            this.preprocessedChats.allChats.slice(0, 20).forEach(chat => {
                if (chat.client && chat.id?._serialized) {
                    const tel = chat.id._serialized.replace(/@[cg]\.us$/, '');
                    activeChats.push({
                        clientId: chat.client,
                        tel: tel,
                        lastActivity: chat.timestamp || 0
                    });
                }
            });
        }
        
        // Agregar chats no leídos
        if (this.preprocessedUnreadChats.unreadChats.length > 0) {
            this.preprocessedUnreadChats.unreadChats.slice(0, 10).forEach(chat => {
                if (chat.client && chat.id?._serialized) {
                    const tel = chat.id._serialized.replace(/@[cg]\.us$/, '');
                    const exists = activeChats.find(c => c.clientId === chat.client && c.tel === tel);
                    if (!exists) {
                        activeChats.push({
                            clientId: chat.client,
                            tel: tel,
                            lastActivity: chat.recentMessageDate || 0
                        });
                    }
                }
            });
        }
        
        return activeChats.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    /**
     * Obtener IDs de grupos más activos basado en cache actual
     */
    getActiveGroupIds() {
        const activeGroups = [];
        
        // Obtener grupos de chats preprocesados (filtrar solo grupos)
        if (this.preprocessedChats.allChats.length > 0) {
            this.preprocessedChats.allChats
                .filter(chat => chat.id?._serialized?.endsWith('@g.us')) // Solo grupos
                .slice(0, 15) // Top 15 grupos más activos
                .forEach(chat => {
                    if (chat.client && chat.id?._serialized) {
                        const groupId = chat.id._serialized.replace('@g.us', '');
                        activeGroups.push({
                            clientId: chat.client,
                            groupId: groupId,
                            lastActivity: chat.timestamp || 0
                        });
                    }
                });
        }
        
        // Agregar grupos no leídos
        if (this.preprocessedUnreadChats.unreadChats.length > 0) {
            this.preprocessedUnreadChats.unreadChats
                .filter(chat => chat.id?._serialized?.endsWith('@g.us'))
                .slice(0, 8) // Top 8 grupos no leídos
                .forEach(chat => {
                    if (chat.client && chat.id?._serialized) {
                        const groupId = chat.id._serialized.replace('@g.us', '');
                        const exists = activeGroups.find(g => g.clientId === chat.client && g.groupId === groupId);
                        if (!exists) {
                            activeGroups.push({
                                clientId: chat.client,
                                groupId: groupId,
                                lastActivity: chat.recentMessageDate || 0
                            });
                        }
                    }
                });
        }
        
        return activeGroups.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    /**
     * Cachear páginas comunes para respuesta instantánea
     */
    cacheCommonPages(allChats, totalUnreadChats) {
        const commonPaginations = [
            { page: 1, limit: 10 },
            { page: 1, limit: 20 },
            { page: 2, limit: 20 },
            { page: 1, limit: 50 }
        ];
        
        commonPaginations.forEach(({ page, limit }) => {
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const totalPages = Math.ceil(allChats.length / limit);
            
            const result = {
                chats: allChats.slice(startIndex, endIndex),
                totalUnreadChats,
                totalPages
            };
            
            const cacheKey = `all_chats_page_${page}_limit_${limit}`;
            this.setChatsCache(cacheKey, result);
        });
    }

    /**
     * Cachear páginas comunes de chats no leídos para respuesta instantánea
     */
    cacheCommonUnreadPages(unreadChats) {
        const commonPaginations = [
            { page: 1, limit: 10 },
            { page: 1, limit: 20 },
            { page: 2, limit: 20 },
            { page: 1, limit: 50 }
        ];
        
        commonPaginations.forEach(({ page, limit }) => {
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const totalPages = Math.ceil(unreadChats.length / limit);
            
            const result = {
                chats: unreadChats.slice(startIndex, endIndex),
                totalUnreadChats: unreadChats.length,
                totalPages
            };
            
            const cacheKey = `unread_chats_page_${page}_limit_${limit}`;
            this.setChatsCache(cacheKey, result);
        });
    }

    _validatePagination(page, limit) {
        const validatedPage = Math.max(1, parseInt(page) || 1);
        const validatedLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));
        return { page: validatedPage, limit: validatedLimit };
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
        const { page: validPage, limit: validLimit } = this._validatePagination(page, limit);
        const cacheKey = `unread_chats_page_${validPage}_limit_${validLimit}`;
        
        try {
            // ✅ PASO 1: INTENTAR CACHE CALIENTE (RESPUESTA INMEDIATA)
            const cachedChats = this.getChatsFromCache(cacheKey);
            if (cachedChats) {
                this.chatMetrics.cacheHits++;
                logger.debug(`⚡ Cache hit for unread chats page ${validPage} (${Date.now() - startTime}ms)`);
                return { ...cachedChats, stale: false };
            }

            // ✅ PASO 2: USAR ESTRUCTURA PREPROCESADA (MUY RÁPIDO)
            if (this.preprocessedUnreadChats.unreadChats.length > 0 && 
                Date.now() - this.preprocessedUnreadChats.lastUpdate < this.chatsCacheTimeout * 2) { // 4 minutos tolerancia
                
                const { unreadChats, totalUnreadChats } = this.preprocessedUnreadChats;
                const startIndex = (validPage - 1) * validLimit;
                const endIndex = validPage * validLimit;
                const totalPages = Math.ceil(unreadChats.length / validLimit);
                
                const result = {
                    chats: unreadChats.slice(startIndex, endIndex),
                    totalUnreadChats,
                    totalPages
                };
                
                // Cachear para próximas consultas
                this.setChatsCache(cacheKey, result);
                
                logger.info(`📋 Preprocessed unread chats served - Page: ${validPage}, ${Date.now() - startTime}ms`);
                return { ...result, stale: false };
            }

            // ✅ PASO 3: FALLBACK RÁPIDO CON TIMEOUT AGRESIVO (ÚLTIMO RECURSO)
            this.chatMetrics.cacheMisses++;
            
            const result = await Promise.race([
                this._fetchUnreadChatsUltraFast(validPage, validLimit),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Ultra fast unread fetch timeout')), 2500) // ✅ 2.5s MAX
                )
            ]);
            
            this.setChatsCache(cacheKey, result);
            this.updateChatMetrics(startTime, true);
            
            logger.info(`🚀 Ultra fast unread chats - Page: ${validPage}, Total: ${result.totalUnreadChats}, ${Date.now() - startTime}ms`);
            return { ...result, stale: false };
            
        } catch (error) {
            this.updateChatMetrics(startTime, false);
            logger.error(`❌ Error fetching unread chats page ${validPage}:`, error);
            
            // ✅ PASO 4: INTENTAR CACHE EXPIRADO
            const staleCache = this.getStaleChatsFromCache(cacheKey);
            if (staleCache) {
                this.chatMetrics.staleDataReturned++;
                logger.warn(`📦 Returning stale cache for unread chats page ${validPage}`);
                return { ...staleCache, stale: true };
            }
            
            // ✅ PASO 5: ESTRUCTURA VACÍA (ÚLTIMA LÍNEA DE DEFENSA)
            return {
                chats: [],
                totalUnreadChats: 0,
                totalPages: 0,
                stale: false
            };
        }
    }

    /**
     * Fetch unread chats with fallback mechanisms
     * @private
     */
    async _fetchUnreadChatsUltraFast(page, limit) {
        await this.ensureServiceReady();

        const clients = Array.from(this.whatsAppClient.clients.values());
        if (!clients.length) {
            return { chats: [], totalUnreadChats: 0, totalPages: 0 };
        }

        // ✅ OBTENER CHATS NO LEÍDOS CON TIMEOUT REDUCIDO Y RESULTADOS PARCIALES
        const allUnreadChats = await this.getAllUnreadChatsResilientOptimized(clients, 2000); // 2s timeout
        
        if (!allUnreadChats.length) {
            return { chats: [], totalUnreadChats: 0, totalPages: 0 };
        }
        
        // Ordenar solo una vez
        allUnreadChats.sort((a, b) => b.recentMessageDate - a.recentMessageDate);

        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const totalUnreadChats = allUnreadChats.length;

        return {
            chats: allUnreadChats.slice(startIndex, endIndex),
            totalUnreadChats,
            totalPages: Math.ceil(totalUnreadChats / limit)
        };
    }

    /**
     * Fetch chats with pagination, caching and resilience
     * @param {number} page - Page number
     * @param {number} limit - Items per page
     * @returns {Promise<Object>} Paginated chats
     */
    async fetchChats(page, limit) {
        const startTime = Date.now();
        const { page: validPage, limit: validLimit } = this._validatePagination(page, limit);
        const cacheKey = `all_chats_page_${validPage}_limit_${validLimit}`;
        
        try {
            // ✅ PASO 1: INTENTAR CACHE CALIENTE (RESPUESTA INMEDIATA)
            const cachedChats = this.getChatsFromCache(cacheKey);
            if (cachedChats) {
                this.chatMetrics.cacheHits++;
                logger.debug(`⚡ Cache hit for all chats page ${validPage} (${Date.now() - startTime}ms)`);
                return { ...cachedChats, stale: false };
            }

            // ✅ PASO 2: USAR ESTRUCTURA PREPROCESADA (MUY RÁPIDO)
            if (this.preprocessedChats.allChats.length > 0 && 
                Date.now() - this.preprocessedChats.lastUpdate < this.chatsCacheTimeout * 2) { // 4 minutos tolerancia
                
                const { allChats, totalUnreadChats } = this.preprocessedChats;
                const startIndex = (validPage - 1) * validLimit;
                const endIndex = validPage * validLimit;
                const totalPages = Math.ceil(allChats.length / validLimit);
                
                const result = {
                    chats: allChats.slice(startIndex, endIndex),
                    totalUnreadChats,
                    totalPages
                };
                
                // Cachear para próximas consultas
                this.setChatsCache(cacheKey, result);
                
                logger.info(`📋 Preprocessed chats served - Page: ${validPage}, ${Date.now() - startTime}ms`);
                return { ...result, stale: false };
            }

            // ✅ PASO 3: FALLBACK RÁPIDO CON TIMEOUT AGRESIVO (ÚLTIMO RECURSO)
            this.chatMetrics.cacheMisses++;
            
            const result = await Promise.race([
                this._fetchChatsUltraFast(validPage, validLimit),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Ultra fast fetch timeout')), 2500) // ✅ 2.5s MAX
                )
            ]);
            
            this.setChatsCache(cacheKey, result);
            this.updateChatMetrics(startTime, true);
            
            logger.info(`🚀 Ultra fast chats - Page: ${validPage}, ${Date.now() - startTime}ms`);
            return { ...result, stale: false };
            
        } catch (error) {
            this.updateChatMetrics(startTime, false);
            logger.error(`❌ Error fetching chats page ${validPage}:`, error);
            
            // ✅ PASO 4: INTENTAR CACHE EXPIRADO
            const staleCache = this.getStaleChatsFromCache(cacheKey);
            if (staleCache) {
                this.chatMetrics.staleDataReturned++;
                logger.warn(`📦 Returning stale cache for page ${validPage}`);
                return { ...staleCache, stale: true };
            }
            
            // ✅ PASO 5: ESTRUCTURA VACÍA (ÚLTIMA LÍNEA DE DEFENSA)
            return {
                chats: [],
                totalUnreadChats: 0,
                totalPages: 0,
                stale: false
            };
        }
    }

    /**
     * Fetch all chats with fallback mechanisms
     * @private
     */
    async _fetchChatsUltraFast(page, limit) {
        await this.ensureServiceReady();

        const clients = Array.from(this.whatsAppClient.clients.values());
        if (!clients.length) {
            return { chats: [], totalUnreadChats: 0, totalPages: 0 };
        }

        // ✅ OBTENER CHATS CON TIMEOUT REDUCIDO Y RESULTADOS PARCIALES
        const allChats = await this.getAllChatsResilient(clients, false, 2000); // 2s timeout
        
        if (!allChats.length) {
            return { chats: [], totalUnreadChats: 0, totalPages: 0 };
        }
        
        // Ordenar solo una vez
        allChats.sort((a, b) => b.timestamp - a.timestamp);

        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const totalUnreadChats = allChats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);

        return {
            chats: allChats.slice(startIndex, endIndex),
            totalUnreadChats,
            totalPages: Math.ceil(allChats.length / limit)
        };
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
                return await Promise.race([
                    this._getUnreadChatsFromClient(client),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Client timeout')), 8000) // Reducido de 20s a 8s
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
     * ✅ OBTENER CHATS NO LEÍDOS CON MÁXIMA OPTIMIZACIÓN
     * @param {Array} clients - Array of WhatsApp clients
     * @param {number} customTimeout - Timeout personalizado
     * @returns {Promise<Array>} All unread chats
     */
    async getAllUnreadChatsResilientOptimized(clients, customTimeout = 2500) {
        // ✅ PROCESAMIENTO CONCURRENTE SIN ESPERAR TODOS LOS CLIENTES
        const chatsPromises = clients.map(async (client) => {
            const release = await this.fetchSemaphore.acquire();
            
            try {
                return await Promise.race([
                    this._getUnreadChatsFromClientOptimized(client), // ✅ Método optimizado
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Unread client timeout ${customTimeout}ms`)), customTimeout)
                    )
                ]);
            } catch (error) {
                logger.warn(`⚠️ Unread Client ${client.options?.authStrategy?.clientId} failed: ${error.message}`);
                return []; // No fallar, devolver array vacío
            } finally {
                release();
            }
        });

        // ✅ PROCESAMIENTO EN LOTES PARA REDUCIR LATENCIA
        const BATCH_SIZE = 5; // Procesar 5 clientes a la vez
        const allResults = [];
        
        for (let i = 0; i < chatsPromises.length; i += BATCH_SIZE) {
            const batch = chatsPromises.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(batch);
            
            // Agregar resultados exitosos inmediatamente
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                    allResults.push(...result.value);
                }
            });
            
            // Si ya tenemos datos suficientes, no esperar más lotes
            if (allResults.length > 0 && i + BATCH_SIZE < chatsPromises.length) {
                logger.debug(`⚡ Early return unread with ${allResults.length} chats from ${i + BATCH_SIZE} clients`);
                break;
            }
        }
        
        // Log de estadísticas
        const processedClients = Math.min(clients.length, allResults.length > 0 ? clients.length : 0);
        logger.debug(`📊 Processed ${processedClients}/${clients.length} clients, got ${allResults.length} unread chats`);
        
        return allResults;
    }

    /**
     * ✅ OBTENER CHATS CON MÁXIMA OPTIMIZACIÓN
     * @param {Array} clients - Array of WhatsApp clients
     * @param {boolean} isProactive - Si es actualización proactiva (timeout más generoso)
     * @param {number} customTimeout - Timeout personalizado
     * @returns {Promise<Array>} All chats
     */
    async getAllChatsResilient(clients, isProactive = false, customTimeout = null) {
        // ✅ TIMEOUT DINÁMICO SEGÚN CONTEXTO
        const timeout = customTimeout || (isProactive ? 4000 : 2500); // Proactivo: 4s, Demanda: 2.5s
        
        // ✅ PROCESAMIENTO CONCURRENTE SIN ESPERAR TODOS LOS CLIENTES
        const chatsPromises = clients.map(async (client) => {
            const release = await this.fetchSemaphore.acquire();
            
            try {
                return await Promise.race([
                    this._getAllChatsFromClientOptimized(client), // ✅ Método optimizado
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Client timeout ${timeout}ms`)), timeout)
                    )
                ]);
            } catch (error) {
                logger.warn(`⚠️ Client ${client.options?.authStrategy?.clientId} failed: ${error.message}`);
                return []; // No fallar, devolver array vacío
            } finally {
                release();
            }
        });

        // ✅ PROCESAMIENTO EN LOTES PARA REDUCIR LATENCIA
        const BATCH_SIZE = 5; // Procesar 5 clientes a la vez
        const allResults = [];
        
        for (let i = 0; i < chatsPromises.length; i += BATCH_SIZE) {
            const batch = chatsPromises.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(batch);
            
            // Agregar resultados exitosos inmediatamente
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                    allResults.push(...result.value);
                }
            });
            
            // Si no es proactivo, no esperar más lotes si ya tenemos datos
            if (!isProactive && allResults.length > 0 && i + BATCH_SIZE < chatsPromises.length) {
                logger.debug(`⚡ Early return with ${allResults.length} chats from ${i + BATCH_SIZE} clients`);
                break;
            }
        }
        
        // Log de estadísticas
        const processedClients = Math.min(clients.length, allResults.length > 0 ? clients.length : 0);
        logger.debug(`📊 Processed ${processedClients}/${clients.length} clients, got ${allResults.length} chats`);
        
        return allResults;
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
     * Get unread chats from a single client
     * @private
     */
    async _getUnreadChatsFromClientOptimized(client) {
        try {
            // ✅ OBTENER CHATS CON LÍMITE PARA REDUCIR TRANSFERENCIA
            const chats = await Promise.race([
                client.getChats(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('getUnreadChats timeout')), 2000)
                )
            ]);
            
            if (!chats || chats.length === 0) return [];
            
            // ✅ FILTRAR SOLO NO LEÍDOS Y PROCESAMIENTO LIGERO
            const unreadChats = chats.filter(chat => chat.unreadCount > 0);
            
            if (unreadChats.length === 0) return [];
            
            return Promise.all(unreadChats.map(chat => this.processChatLightweight(chat, client)));
            
        } catch (error) {
            logger.debug(`Error in _getUnreadChatsFromClientOptimized: ${error.message}`);
            return [];
        }
    }

    /**
     * Get all chats from a single client
     * @private
     */
    async _getAllChatsFromClientOptimized(client) {
        try {
            // ✅ OBTENER CHATS CON LÍMITE PARA REDUCIR TRANSFERENCIA
            const chats = await Promise.race([
                client.getChats(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('getChats timeout')), 2000)
                )
            ]);
            
            if (!chats || chats.length === 0) return [];
            
            // ✅ PROCESAMIENTO LIGERO - SOLO DATOS ESENCIALES
            return Promise.all(chats.map(chat => this.processChatLightweight(chat, client)));
            
        } catch (error) {
            logger.debug(`Error in _getAllChatsFromClientOptimized: ${error.message}`);
            return [];
        }
    }

    /**
     *  Procesamiento ultraliviano de chat para máximo rendimiento
     */
    async processChatLightweight(chat, client) {
        try {
            // ✅ DATOS MÍNIMOS ESENCIALES - SIN MEDIA, SIN GRUPOS COMPLEJOS
            return {
                ...chat,
                recentMessageDate: chat.lastMessage?.timestamp || 0, // Usar dato existente
                profilePicUrl: this.getDefaultProfilePic(), // Evitar fetch costoso
                groupData: [], // Simplificado - se carga bajo demanda si es necesario
                client: client.options?.authStrategy?.clientId || 'unknown',
                timestamp: chat.lastMessage?.timestamp || Date.now(),
                processingTime: Date.now()
            };
        } catch (error) {
            return this.getDefaultChatData(chat, client);
        }
    }

    /**
     * Process chat to get additional details with resilience
     * @param {Object} chat - Chat object
     * @param {Object} client - WhatsApp client instance
     * @returns {Promise<Object>} Processed chat
     */
    async processChat(chat, client) {
        const release = await this.chatProcessingSemaphore.acquire();
        
        try {
            const BATCH_TIMEOUT = 3000; // Reducido de 10s a 3s
            
            // Operaciones esenciales con timeouts más agresivos
            const essentialDataPromise = Promise.allSettled([
                this._getRecentMessageDateSafely(chat, 2000), // Timeout reducido a 2s
                this._getBasicProfileDataSafely(client, chat.id._serialized, 2000) // Nuevo método combinado
            ]);
            
            // Operaciones opcionales (no críticas)
            const optionalDataPromise = chat.id.server === 'g.us' 
                ? this._getGroupDataSafely(chat, client, 3000)
                : Promise.resolve([]);
            
            const [essentialResults, groupData] = await Promise.race([
                Promise.all([essentialDataPromise, optionalDataPromise]),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Process chat timeout')), BATCH_TIMEOUT)
                )
            ]);

            const [recentMessageResult, profileResult] = essentialResults;

            return {
                ...chat,
                recentMessageDate: recentMessageResult.status === 'fulfilled' ? recentMessageResult.value : 0,
                profilePicUrl: profileResult.status === 'fulfilled' ? profileResult.value : this.getDefaultProfilePic(),
                groupData: Array.isArray(groupData) ? groupData : [],
                client: client.options?.authStrategy?.clientId || 'unknown',
                processingTime: Date.now() // Para métricas
            };
        } catch (error) {
            logger.error(`Error processing chat: ${error.message}`);
            return this.getDefaultChatData(chat, client);
        } finally {
            release();
        }
    }

    async _getBasicProfileDataSafely(client, chatId, timeout = 2000) {
        try {
            return await Promise.race([
                this.getProfilePicture(client, chatId),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Profile pic timeout')), timeout)
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
    async _getRecentMessageDateSafely(chat, timeout = 2000) {
        try {
            return await Promise.race([
                this.getRecentMessageDate(chat),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Recent message timeout')), timeout)
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
    async _getGroupDataSafely(chat, client, timeout = 3000) {
        try {
            return await Promise.race([
                this.getGroupDataOptimized(chat, client), 
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Group data timeout')), timeout)
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
     * ✅ Obtener mensajes de grupo con máxima velocidad y timeout agresivo
     * @private
     */
    async _getGroupChatMessagesUltraFast(number, groupId) {
        // Validar inputs
        if (!number || !groupId) {
            throw new ValidationError('Client number and group ID are required');
        }

        await this.ensureServiceReady();

        const client = await this.getClientById(number);
        const chatId = `${groupId}@g.us`;

        const chat = await Promise.race([
            client.getChatById(chatId),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Get group chat timeout')), 1000) // 1s para obtener chat
            )
        ]);
        
        if (!chat) {
            throw new NotFoundError(`Group chat ${groupId} not found`);
        }

        const messages = await Promise.race([
            chat.fetchMessages({ limit: 30 }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Fetch group messages timeout')), 1200) // 1.2s para mensajes de grupo
            )
        ]);

        // ✅ PROCESAMIENTO OPTIMIZADO DE MENSAJES DE GRUPO
        const processedMessages = await this.processGroupMessagesUltraOptimized(messages);
        this.chatMetrics.messagesProcessed += processedMessages.length;
        this.chatMetrics.groupsProcessed++;
        
        return processedMessages;
    }

    /**
     * Get group data with improved error handling
     * @param {Object} chat - Chat object
     * @param {Object} client - WhatsApp client instance
     * @returns {Promise<Array>} Group participants data
     */
    async getGroupDataOptimized(chat, client) {
        if (!chat.participants || chat.participants.length === 0) return [];

        try {
            const MAX_PARTICIPANTS = 20; // Limitar participantes procesados
            const PARTICIPANT_BATCH_SIZE = 6; // Aumentado de 5 a 6
            const limitedParticipants = chat.participants.slice(0, MAX_PARTICIPANTS);
            const results = [];
            
            for (let i = 0; i < limitedParticipants.length; i += PARTICIPANT_BATCH_SIZE) {
                const batch = limitedParticipants.slice(i, i + PARTICIPANT_BATCH_SIZE);
                
                const batchPromises = batch.map(async participant => {
                    try {
                        const contact = await Promise.race([
                            client.getContactById(participant.id._serialized),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Participant timeout')), 1500) // Reducido de 3s a 1.5s
                            )
                        ]);
                        
                        return {
                            id: participant.id._serialized,
                            isAdmin: participant.isAdmin,
                            isSuperAdmin: participant.isSuperAdmin,
                            name: contact.name || contact.number || participant.id._serialized
                        };
                    } catch (error) {
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
                
                // Pausa mínima entre lotes
                if (i + PARTICIPANT_BATCH_SIZE < limitedParticipants.length) {
                    await new Promise(resolve => setTimeout(resolve, 30)); // Reducido de 100ms a 30ms
                }
            }

            return results;
        } catch (error) {
            logger.error('Error getting optimized group data:', error);
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

        const startTime = Date.now();
        const cacheKey = `group_messages_${number}_${groupId}`;
        
        try {
            // ✅ PASO 1: CACHE CALIENTE (RESPUESTA INMEDIATA <50ms)
            const cachedMessages = this.getGroupMessagesFromCache(cacheKey);
            if (cachedMessages) {
                this.chatMetrics.groupMessagesCacheHits++;
                logger.debug(`⚡ Group messages cache hit ${number}/${groupId} (${Date.now() - startTime}ms)`);
                return cachedMessages;
            }

            // ✅ PASO 2: ESTRUCTURA PREPROCESADA
            const preprocessed = this.preprocessedGroupMessages.get(cacheKey);
            if (preprocessed && Date.now() - preprocessed.timestamp < this.groupMessagesCacheTimeout) {
                this.setGroupMessagesCache(cacheKey, preprocessed.messages);
                logger.debug(`📋 Preprocessed group messages served ${number}/${groupId} (${Date.now() - startTime}ms)`);
                return preprocessed.messages;
            }

            // ✅ PASO 3: FALLBACK ULTRA-RÁPIDO CON TIMEOUT AGRESIVO
            this.chatMetrics.groupMessagesCacheMisses++;
            
            const messages = await Promise.race([
                this._getGroupChatMessagesUltraFast(number, groupId),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Ultra fast group messages timeout')), 2000) // ✅ 2s MAX para grupos
                )
            ]);
            
            // Cachear resultado
            this.setGroupMessagesCache(cacheKey, messages);
            this.setPreprocessedGroupMessages(cacheKey, messages);
            
            this.updateGroupMessageMetrics(startTime, true);
            logger.info(`🚀 Ultra fast group messages ${number}/${groupId} - ${messages.length} msgs, ${Date.now() - startTime}ms`);
            return messages;
            
        } catch (error) {
            this.updateGroupMessageMetrics(startTime, false);
            logger.error(`❌ Error getting group messages ${number}/${groupId}:`, error.message);
            
            // ✅ PASO 4: CACHE EXPIRADO COMO FALLBACK
            const staleMessages = this.getStaleGroupMessagesFromCache(cacheKey);
            if (staleMessages) {
                logger.warn(`📦 Returning stale group messages cache for ${number}/${groupId}`);
                return staleMessages;
            }
            
            // ✅ PASO 5: ARRAY VACÍO (ÚLTIMA DEFENSA)
            return [];
        }
    }

    /**
     * Get individual chat messages
     * @param {string} clientId - Client identifier
     * @param {string} tel - Phone number (recipient)
     * @returns {Promise<Array>} Messages list
     */
    async getChatMessages(clientId, tel) {
        if (this.isShuttingDown) return [];

        const startTime = Date.now();
        const cacheKey = `messages_${clientId}_${tel}`;
        
        try {
            // ✅ PASO 1: CACHE CALIENTE (RESPUESTA INMEDIATA <50ms)
            const cachedMessages = this.getMessagesFromCache(cacheKey);
            if (cachedMessages) {
                this.chatMetrics.messagesCacheHits++;
                logger.debug(`⚡ Messages cache hit ${clientId}/${tel} (${Date.now() - startTime}ms)`);
                return cachedMessages;
            }

            // ✅ PASO 2: ESTRUCTURA PREPROCESADA
            const preprocessed = this.preprocessedMessages.get(cacheKey);
            if (preprocessed && Date.now() - preprocessed.timestamp < this.messagesCacheTimeout) {
                this.setMessagesCache(cacheKey, preprocessed.messages);
                logger.debug(`📋 Preprocessed messages served ${clientId}/${tel} (${Date.now() - startTime}ms)`);
                return preprocessed.messages;
            }

            // ✅ PASO 3: FALLBACK ULTRA-RÁPIDO CON TIMEOUT AGRESIVO
            this.chatMetrics.messagesCacheMisses++;
            
            const messages = await Promise.race([
                this._getChatMessagesUltraFast(clientId, tel),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Ultra fast messages timeout')), 1500) // ✅ 1.5s MAX
                )
            ]);
            
            // Cachear resultado
            this.setMessagesCache(cacheKey, messages);
            this.setPreprocessedMessages(cacheKey, messages);
            
            this.updateMessageMetrics(startTime, true);
            logger.info(`🚀 Ultra fast messages ${clientId}/${tel} - ${messages.length} msgs, ${Date.now() - startTime}ms`);
            return messages;
            
        } catch (error) {
            this.updateMessageMetrics(startTime, false);
            logger.error(`❌ Error getting messages ${clientId}/${tel}:`, error.message);
            
            // ✅ PASO 4: CACHE EXPIRADO COMO FALLBACK
            const staleMessages = this.getStaleMessagesFromCache(cacheKey);
            if (staleMessages) {
                logger.warn(`📦 Returning stale messages cache for ${clientId}/${tel}`);
                return staleMessages;
            }
            
            // ✅ PASO 5: ARRAY VACÍO (ÚLTIMA DEFENSA)
            return [];
        }
    }

    /**
     * ✅ Obtener mensajes con máxima velocidad y timeout agresivo
     * @private
     */
    async _getChatMessagesUltraFast(clientId, tel) {
        // Validar inputs
        if (!clientId || !tel) {
            throw new ValidationError('Client ID and phone number are required');
        }

        await this.ensureServiceReady();

        const client = await this.getClientById(clientId);
        const chatId = `${tel}@c.us`;

        const chat = await Promise.race([
            client.getChatById(chatId),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Get chat timeout')), 800) // 800ms para obtener chat
            )
        ]);
        
        if (!chat) {
            throw new NotFoundError(`Chat with ${tel} not found`);
        }

        const messages = await Promise.race([
            chat.fetchMessages({ limit: 30 }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Fetch messages timeout')), 1000) // 1s para mensajes
            )
        ]);

        // ✅ PROCESAMIENTO OPTIMIZADO DE MENSAJES
        const processedMessages = await this.processMessagesUltraOptimized(messages);
        this.chatMetrics.messagesProcessed += processedMessages.length;
        
        return processedMessages;
    }

    /**
     * ✅ Crear mensaje fallback en caso de error
     * @private
     */
    createFallbackMessage(message, errorMsg = 'Processing failed') {
        return {
            id: message.id?._serialized || `fallback_${Date.now()}_${Math.random()}`,
            body: message.body || 'Message processing failed',
            timestamp: message.timestamp || Date.now(),
            from: message.from || 'unknown',
            to: message.to || 'unknown',
            fromMe: message.fromMe || false,
            hasMedia: false,
            mediaType: 'error',
            error: errorMsg,
            processingFailed: true
        };
    }

    /**
     * ✅ Crear mensaje fallback para grupos en caso de error
     * @private
     */
    createFallbackGroupMessage(message, errorMsg = 'Group processing failed') {
        return {
            id: message.id?._serialized || `group_fallback_${Date.now()}_${Math.random()}`,
            body: message.body || 'Group message processing failed',
            timestamp: message.timestamp || Date.now(),
            from: message.from || 'unknown',
            to: message.to || 'unknown',
            fromMe: message.fromMe || false,
            hasMedia: false,
            mediaType: 'error',
            author: message.author || null,
            notifyName: message._data?.notifyName || null,
            error: errorMsg,
            processingFailed: true,
            isGroupMessage: true
        };
    }

    /**
     * ✅ Procesamiento ultra-optimizado de mensajes de grupo con media diferida
     * @param {Array} messages - Array of messages to process
     * @returns {Promise<Array>} Processed messages
     * @private
     */
    async processGroupMessagesUltraOptimized(messages) {
        if (!messages || messages.length === 0) return [];

        const BATCH_SIZE = 5; // Procesar 5 mensajes a la vez (grupos pueden tener más media)
        const processedMessages = [];
        
        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
            const batch = messages.slice(i, i + BATCH_SIZE);
            
            // Procesar lote con timeout optimizado para grupos
            const batchPromises = batch.map(msg => 
                Promise.race([
                    this.formatGroupMessageUltraOptimized(msg),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Group message format timeout')), 900) // 900ms por mensaje de grupo
                    )
                ])
            );
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    processedMessages.push(result.value);
                } else {
                    // Fallback para mensajes que fallan
                    const originalMsg = batch[index];
                    processedMessages.push(this.createFallbackGroupMessage(originalMsg));
                }
            });
            
            // Micro-pausa entre lotes
            if (i + BATCH_SIZE < messages.length) {
                await new Promise(resolve => setTimeout(resolve, 30));
            }
        }

        return processedMessages;
    }

    /**
     * ✅ Procesamiento ultra-optimizado de mensajes con media diferida
     * @param {Array} messages - Array of messages to process
     * @returns {Promise<Array>} Processed messages
     * @private
     */
    async processMessagesUltraOptimized(messages) {
        if (!messages || messages.length === 0) return [];

        const BATCH_SIZE = 6; // Procesar 6 mensajes a la vez
        const processedMessages = [];
        
        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
            const batch = messages.slice(i, i + BATCH_SIZE);
            
            // Procesar lote con timeout ultra-corto
            const batchPromises = batch.map(msg => 
                Promise.race([
                    this.formatMessageUltraOptimized(msg),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Message format timeout')), 800) // 800ms por mensaje
                    )
                ])
            );
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    processedMessages.push(result.value);
                } else {
                    // Fallback para mensajes que fallan
                    const originalMsg = batch[index];
                    processedMessages.push(this.createFallbackMessage(originalMsg));
                }
            });
            
            // Micro-pausa entre lotes
            if (i + BATCH_SIZE < messages.length) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }

        return processedMessages;
    }

    /**
     * ✅ Formateo ultra-optimizado con media diferida
     * @param {Object} message - WhatsApp message
     * @returns {Promise<Object>} Formatted message
     * @private
     */
    async formatMessageUltraOptimized(message) {
        try {
            // Validar mensaje básico
            if (!message || !message.id) {
                throw new Error('Invalid message object');
            }

            const formattedMessage = {
                id: message.id._serialized,
                body: message.body || '',
                timestamp: message.timestamp,
                from: message.from,
                to: message.to,
                fromMe: message.fromMe,
                hasMedia: message.hasMedia || false,
                mediaType: message.type || 'text',
                mediaMimeType: message._data?.mimetype || null,
                caption: message.caption || null,
                hasQuotedMsg: message.hasQuotedMsg || false,
                quotedParticipant: message._data?.quotedParticipant || null,
                quotedStanzaID: message._data?.quotedStanzaID || null,
                quotedMsg: message._data?.quotedMsg || null,
                isStarred: message.isStarred || false,
                isForwarded: message.isForwarded || false
            };

            // ✅ MEDIA DIFERIDA - Solo metadatos, no descarga
            if (message.hasMedia && message.type !== 'chat') {
                try {
                    // Solo procesar media ligera (stickers, imágenes pequeñas)
                    if (['sticker'].includes(message.type)) {
                        const mediaData = await Promise.race([
                            this.mediaService.processMessageMediaOptimized(message),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Media timeout')), 500) // 500ms para media ligera
                            )
                        ]);
                        
                        if (mediaData && Object.keys(mediaData).length > 0) {
                            Object.assign(formattedMessage, mediaData);
                        }
                    } else {
                        // Para media pesada, solo metadatos
                        formattedMessage.mediaDeferred = true;
                        formattedMessage.mediaSize = message._data?.size || 'unknown';
                        formattedMessage.mediaUrl = `/api/media/${message.id._serialized}`; // URL para descarga bajo demanda
                    }
                } catch (error) {
                    formattedMessage.mediaError = 'Processing deferred';
                    formattedMessage.mediaType = message.type;
                }
            }

            // Procesar ubicación (más rápido que media)
            if (message.location) {
                formattedMessage.location = {
                    latitude: message.location.latitude,
                    longitude: message.location.longitude,
                    description: message.location.description || null
                };
            }

            return formattedMessage;
        } catch (error) {
            return this.createFallbackMessage(message, error.message);
        }
    }

    /**
     * ✅ Formateo ultra-optimizado para mensajes de grupo con media diferida
     * @param {Object} message - WhatsApp message
     * @returns {Promise<Object>} Formatted message
     * @private
     */
    async formatGroupMessageUltraOptimized(message) {
        try {
            // Validar mensaje básico
            if (!message || !message.id) {
                throw new Error('Invalid group message object');
            }

            const formattedMessage = {
                id: message.id._serialized,
                body: message.body || '',
                timestamp: message.timestamp,
                from: message.from,
                to: message.to,
                fromMe: message.fromMe,
                hasMedia: message.hasMedia || false,
                mediaType: message.type || 'text',
                mediaMimeType: message._data?.mimetype || null,
                caption: message.caption || null,
                hasQuotedMsg: message.hasQuotedMsg || false,
                quotedParticipant: message._data?.quotedParticipant || null,
                quotedStanzaID: message._data?.quotedStanzaID || null,
                quotedMsg: message._data?.quotedMsg || null,
                isStarred: message.isStarred || false,
                isForwarded: message.isForwarded || false,
                // ✅ CAMPOS ESPECÍFICOS DE GRUPOS
                author: message.author || null, // Autor del mensaje en el grupo
                notifyName: message._data?.notifyName || null // Nombre que aparece en notificación
            };

            // ✅ MEDIA DIFERIDA - Solo metadatos, no descarga (optimizado para grupos)
            if (message.hasMedia && message.type !== 'chat') {
                try {
                    // Solo procesar media ultra-ligera para grupos
                    if (['sticker'].includes(message.type)) {
                        const mediaData = await Promise.race([
                            this.mediaService.processMessageMediaOptimized(message),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Group media timeout')), 400) // 400ms para media ligera en grupos
                            )
                        ]);
                        
                        if (mediaData && Object.keys(mediaData).length > 0) {
                            Object.assign(formattedMessage, mediaData);
                        }
                    } else {
                        // Para media pesada en grupos, solo metadatos
                        formattedMessage.mediaDeferred = true;
                        formattedMessage.mediaSize = message._data?.size || 'unknown';
                        formattedMessage.mediaUrl = `/api/group-media/${message.id._serialized}`; // URL específica para grupos
                    }
                } catch (error) {
                    formattedMessage.mediaError = 'Processing deferred';
                    formattedMessage.mediaType = message.type;
                }
            }

            // Procesar ubicación (más rápido que media)
            if (message.location) {
                formattedMessage.location = {
                    latitude: message.location.latitude,
                    longitude: message.location.longitude,
                    description: message.location.description || null
                };
            }

            return formattedMessage;
        } catch (error) {
            return this.createFallbackGroupMessage(message, error.message);
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

    /**
     * ✅ Gestión de cache específica para mensajes
     */
    getMessagesFromCache(key) {
        const item = this.messagesCache.get(key);
        if (item && Date.now() - item.timestamp < this.messagesCacheTimeout) {
            return item.value;
        }
        return null;
    }

    getStaleMessagesFromCache(key) {
        const item = this.messagesCache.get(key);
        return item ? item.value : null;
    }

    setMessagesCache(key, value) {
        this.messagesCache.set(key, {
            value,
            timestamp: Date.now()
        });
        
        // Limpiar cache si es muy grande
        if (this.messagesCache.size > 100) { // Más espacio para mensajes
            this.cleanupOldMessagesCache();
        }
    }

    setPreprocessedMessages(key, messages) {
        this.preprocessedMessages.set(key, {
            messages,
            timestamp: Date.now()
        });
        
        // Mantener solo mensajes recientes
        if (this.preprocessedMessages.size > 50) {
            const keys = Array.from(this.preprocessedMessages.keys());
            const oldKey = keys[0];
            this.preprocessedMessages.delete(oldKey);
        }
    }

    /**
     * ✅ Gestión de cache específica para mensajes de grupos
     */
    getGroupMessagesFromCache(key) {
        const item = this.groupMessagesCache.get(key);
        if (item && Date.now() - item.timestamp < this.groupMessagesCacheTimeout) {
            return item.value;
        }
        return null;
    }

    getStaleGroupMessagesFromCache(key) {
        const item = this.groupMessagesCache.get(key);
        return item ? item.value : null;
    }

    setGroupMessagesCache(key, value) {
        this.groupMessagesCache.set(key, {
            value,
            timestamp: Date.now()
        });
        
        // Limpiar cache si es muy grande
        if (this.groupMessagesCache.size > 80) { // Menos espacio que mensajes individuales
            this.cleanupOldGroupMessagesCache();
        }
    }

    setPreprocessedGroupMessages(key, messages) {
        this.preprocessedGroupMessages.set(key, {
            messages,
            timestamp: Date.now()
        });
        
        // Mantener solo mensajes recientes
        if (this.preprocessedGroupMessages.size > 40) {
            const keys = Array.from(this.preprocessedGroupMessages.keys());
            const oldKey = keys[0];
            this.preprocessedGroupMessages.delete(oldKey);
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

    cleanupOldMessagesCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, item] of this.messagesCache.entries()) {
            if (now - item.timestamp > this.messagesCacheTimeout) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.messagesCache.delete(key));
        
        if (keysToDelete.length > 0) {
            logger.debug(`Cleaned up ${keysToDelete.length} expired message cache entries`);
        }
    }

        cleanupOldGroupMessagesCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, item] of this.groupMessagesCache.entries()) {
            if (now - item.timestamp > this.groupMessagesCacheTimeout) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.groupMessagesCache.delete(key));
        
        if (keysToDelete.length > 0) {
            logger.debug(`Cleaned up ${keysToDelete.length} expired group message cache entries`);
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
     * ✅ Actualizar métricas de mensajes
     * @private
     */
    updateMessageMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        
        // Calcular promedio móvil para mensajes
        const currentCount = this.chatMetrics.messagesCacheHits + this.chatMetrics.messagesCacheMisses;
        if (currentCount > 0) {
            const currentAvg = this.chatMetrics.averageMessagesFetchTime;
            this.chatMetrics.averageMessagesFetchTime = 
                (currentAvg * (currentCount - 1) + duration) / currentCount;
        } else {
            this.chatMetrics.averageMessagesFetchTime = duration;
        }
    }

    /**
     * ✅ Actualizar métricas de mensajes de grupos
     * @private
     */
    updateGroupMessageMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        
        // Calcular promedio móvil para mensajes de grupos
        const currentCount = this.chatMetrics.groupMessagesCacheHits + this.chatMetrics.groupMessagesCacheMisses;
        if (currentCount > 0) {
            const currentAvg = this.chatMetrics.averageGroupMessagesFetchTime;
            this.chatMetrics.averageGroupMessagesFetchTime = 
                (currentAvg * (currentCount - 1) + duration) / currentCount;
        } else {
            this.chatMetrics.averageGroupMessagesFetchTime = duration;
        }
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
                (this.chatMetrics.cacheHits / this.chatMetrics.totalFetches * 100).toFixed(2) + '%' : '0%',
            staleDataRate: this.chatMetrics.totalFetches > 0 ?
                (this.chatMetrics.staleDataReturned / this.chatMetrics.totalFetches * 100).toFixed(2) + '%' : '0%'
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
            chatsMetrics: {
                ...this.getChatsMetrics(),
                // Métricas de mensajes individuales
                messagesCacheHits: this.chatMetrics.messagesCacheHits,
                messagesCacheMisses: this.chatMetrics.messagesCacheMisses,
                messagesProactiveUpdates: this.chatMetrics.messagesProactiveUpdates,
                averageMessagesFetchTime: this.chatMetrics.averageMessagesFetchTime,
                messagesCacheSize: this.messagesCache.size,
                preprocessedMessagesSize: this.preprocessedMessages.size,
                messagesCacheHitRate: this.chatMetrics.messagesCacheHits + this.chatMetrics.messagesCacheMisses > 0 ?
                    (this.chatMetrics.messagesCacheHits / (this.chatMetrics.messagesCacheHits + this.chatMetrics.messagesCacheMisses) * 100).toFixed(2) + '%' : '0%',
                // ✅ MÉTRICAS DE MENSAJES DE GRUPOS
                groupMessagesCacheHits: this.chatMetrics.groupMessagesCacheHits,
                groupMessagesCacheMisses: this.chatMetrics.groupMessagesCacheMisses,
                groupMessagesProactiveUpdates: this.chatMetrics.groupMessagesProactiveUpdates,
                averageGroupMessagesFetchTime: this.chatMetrics.averageGroupMessagesFetchTime,
                groupMessagesCacheSize: this.groupMessagesCache.size,
                preprocessedGroupMessagesSize: this.preprocessedGroupMessages.size,
                groupMessagesCacheHitRate: this.chatMetrics.groupMessagesCacheHits + this.chatMetrics.groupMessagesCacheMisses > 0 ?
                    (this.chatMetrics.groupMessagesCacheHits / (this.chatMetrics.groupMessagesCacheHits + this.chatMetrics.groupMessagesCacheMisses) * 100).toFixed(2) + '%' : '0%',
                groupsProcessed: this.chatMetrics.groupsProcessed,
                // Métricas existentes
                proactiveUpdates: this.chatMetrics.proactiveUpdates,
                unreadProactiveUpdates: this.chatMetrics.unreadProactiveUpdates,
                preprocessedChatsCount: this.preprocessedChats.allChats.length,
                preprocessedUnreadChatsCount: this.preprocessedUnreadChats.unreadChats.length,
                lastProactiveUpdate: this.preprocessedChats.lastUpdate,
                lastUnreadProactiveUpdate: this.preprocessedUnreadChats.lastUpdate,
                cacheAge: Date.now() - this.preprocessedChats.lastUpdate,
                unreadCacheAge: Date.now() - this.preprocessedUnreadChats.lastUpdate
            },
            specificIssues: []
        };

        // Verificaciones existentes...
        const cacheAge = Date.now() - this.preprocessedChats.lastUpdate;
        if (cacheAge > this.chatsCacheTimeout * 3) {
            chatsHealth.specificIssues.push(`Proactive cache outdated: ${Math.round(cacheAge / 1000)}s`);
            chatsHealth.status = 'degraded';
        }

        const unreadCacheAge = Date.now() - this.preprocessedUnreadChats.lastUpdate;
        if (unreadCacheAge > this.chatsCacheTimeout * 3) {
            chatsHealth.specificIssues.push(`Unread proactive cache outdated: ${Math.round(unreadCacheAge / 1000)}s`);
            chatsHealth.status = 'degraded';
        }

        // Verificar cache de mensajes individuales
        const messagesCacheHitRate = this.chatMetrics.messagesCacheHits + this.chatMetrics.messagesCacheMisses > 0 ?
            this.chatMetrics.messagesCacheHits / (this.chatMetrics.messagesCacheHits + this.chatMetrics.messagesCacheMisses) : 0;
        
        if (messagesCacheHitRate < 0.6 && this.chatMetrics.messagesCacheHits + this.chatMetrics.messagesCacheMisses > 10) {
            chatsHealth.specificIssues.push(`Low messages cache hit rate: ${(messagesCacheHitRate * 100).toFixed(2)}%`);
            chatsHealth.status = chatsHealth.status === 'unhealthy' ? 'unhealthy' : 'degraded';
        }

        // ✅ VERIFICAR CACHE DE MENSAJES DE GRUPOS
        const groupMessagesCacheHitRate = this.chatMetrics.groupMessagesCacheHits + this.chatMetrics.groupMessagesCacheMisses > 0 ?
            this.chatMetrics.groupMessagesCacheHits / (this.chatMetrics.groupMessagesCacheHits + this.chatMetrics.groupMessagesCacheMisses) : 0;
        
        if (groupMessagesCacheHitRate < 0.5 && this.chatMetrics.groupMessagesCacheHits + this.chatMetrics.groupMessagesCacheMisses > 5) {
            chatsHealth.specificIssues.push(`Low group messages cache hit rate: ${(groupMessagesCacheHitRate * 100).toFixed(2)}%`);
            chatsHealth.status = chatsHealth.status === 'unhealthy' ? 'unhealthy' : 'degraded';
        }

        return chatsHealth;
    }

    async preloadCacheForCommonPages() {
        try {
            logger.info('Starting periodic cache preload (all + unread chats)...');
            
            const commonPages = [
                { page: 1, limit: 20 },
                { page: 1, limit: 10 },
                { page: 2, limit: 20 }
            ];
            
            for (const { page, limit } of commonPages) {
                try {
                    // ✅ PRECARGAR CHATS NO LEÍDOS Y TODOS LOS CHATS EN PARALELO
                    await Promise.all([
                        this.fetchUnreadChats(page, limit),
                        this.fetchChats(page, limit)
                    ]);
                    
                    // Pequeña pausa entre precarga
                    await new Promise(resolve => setTimeout(resolve, 500)); // Reducido a 500ms
                } catch (error) {
                    logger.warn(`Error preloading cache for page ${page}, limit ${limit}:`, error.message);
                }
            }
            
            logger.info('Cache preload completed (all + unread chats)');
        } catch (error) {
            logger.error('Error in cache preload:', error);
        }
    }

    /**
     * ✅ Precargar mensajes de chat específico (para cache proactivo)
     * @private
     */
    async preloadChatMessagesOptimized(clientId, tel) {
        try {
            const cacheKey = `messages_${clientId}_${tel}`;
            
            // Evitar reprocesamiento si ya está actualizado
            const existing = this.preprocessedMessages.get(cacheKey);
            if (existing && Date.now() - existing.timestamp < 60000) { // 1 minuto
                return;
            }
            
            const messages = await this._getChatMessagesUltraFast(clientId, tel);
            this.setPreprocessedMessages(cacheKey, messages);
            
            logger.debug(`Preloaded ${messages.length} messages for ${clientId}/${tel}`);
        } catch (error) {
            logger.debug(`Error preloading messages for ${clientId}/${tel}:`, error.message);
        }
    }

    /**
     * ✅ Precargar mensajes de grupo específico (para cache proactivo)
     * @private
     */
    async preloadGroupMessagesOptimized(number, groupId) {
        try {
            const cacheKey = `group_messages_${number}_${groupId}`;
            
            // Evitar reprocesamiento si ya está actualizado
            const existing = this.preprocessedGroupMessages.get(cacheKey);
            if (existing && Date.now() - existing.timestamp < 90000) { // 1.5 minutos
                return;
            }
            
            const messages = await this._getGroupChatMessagesUltraFast(number, groupId);
            this.setPreprocessedGroupMessages(cacheKey, messages);
            
            logger.debug(`Preloaded ${messages.length} group messages for ${number}/${groupId}`);
        } catch (error) {
            logger.debug(`Error preloading group messages for ${number}/${groupId}:`, error.message);
        }
    }

    // 12. MÉTODO PARA INICIALIZAR PRECARGA PERIÓDICA
    async initPeriodicCachePreload(intervalMinutes = 5) {
        // Precarga inicial
        setTimeout(() => this.preloadCacheForCommonPages(), 10000); // Después de 10s
        
        // Precarga periódica
        setInterval(() => {
            this.preloadCacheForCommonPages();
        }, intervalMinutes * 60 * 1000);
        
        logger.info(`Periodic cache preload initialized - every ${intervalMinutes} minutes`);
    }
}

module.exports = ChatService;