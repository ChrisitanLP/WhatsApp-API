const BaseWhatsAppService = require('./baseService');
const { NotFoundError } = require('../../utils/asyncHandler');
const { logger } = require('../../config/logger');
const CircuitBreaker = require('../../utils/circuitBreaker');

/**
 * Contact Service - Handles contact operations with resilience and performance optimization
 */
class ContactService extends BaseWhatsAppService {
    constructor() {
        super();
        this.CONTACTS_PER_PAGE = 30;
        this.MAX_CONCURRENT_FETCHES = 15;
        this.MAX_CONCURRENT_PROFILE_PICS = 20;
        
        // Circuit breaker específico para operaciones de contactos
        this.contactsCircuitBreaker = new CircuitBreaker('contacts-operations', {
            failureThreshold: 3,
            recoveryTimeout: 20000,
            monitoringPeriod: 60000
        });
        
        // Cache de contactos con TTL más largo 
        this.contactsCache = new Map();
        this.contactsCacheTimeout = 180000; 
        this.proactiveContactsCache = new Map(); 
        this.lastProactiveContactsUpdate = 0;
        this.PROACTIVE_CONTACTS_INTERVAL = 120000;

        // ESTRUCTURA PREPROCESADA PARA EVITAR REORDENAR
        this.preprocessedContacts = {
            allContacts: [],
            lastUpdate: 0,
            isUpdating: false
        };
        
        // Semáforo para controlar concurrencia
        this.fetchSemaphore = this.createSemaphore(this.MAX_CONCURRENT_FETCHES);
        this.profilePicSemaphore = this.createSemaphore(this.MAX_CONCURRENT_PROFILE_PICS);
        
        // Métricas específicas de contactos
        this.contactMetrics = {
            totalFetches: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageFetchTime: 0,
            lastFetchTime: null,
            profilePicsProcessed: 0,
            staleDataReturned: 0,
            proactiveUpdates: 0,
            profilePicCacheHits: 0
        };

        this.profilePicCache = new Map();
        this.profilePicCacheTimeout = 6000000; 

        this.initProactiveContactsCache();
    }

    /**
     * Inicializar cache proactivo que se actualiza en segundo plano
     */
    initProactiveContactsCache() {
        // Primera actualización después de 8 segundos
        setTimeout(() => this.updateProactiveContactsCache(), 8000);
        
        // Actualizaciones periódicas cada 2 minutos
        setInterval(() => this.updateProactiveContactsCache(), this.PROACTIVE_CONTACTS_INTERVAL);
        
        logger.info('Proactive contacts cache initialized - updates every 2 minutes');
    }

    /**
     * Actualizar cache proactivo de contactos en segundo plano
     */
    async updateProactiveContactsCache() {
        if (this.preprocessedContacts.isUpdating || this.isShuttingDown) return;
        
        this.preprocessedContacts.isUpdating = true;
        const startTime = Date.now();
        
        try {
            logger.debug('Starting proactive contacts cache update...');
            
            const clients = Array.from(this.whatsAppClient.clients.values());
            if (!clients.length) {
                logger.warn('No clients available for proactive contacts cache update');
                return;
            }

            // OBTENER TODOS LOS CONTACTOS CON TIMEOUT OPTIMIZADO
            const allContacts = await this.getAllContactsResilient(clients, true); // Modo proactivo
            
            if (allContacts.length === 0) {
                logger.debug('No contacts found in proactive update');
                return;
            }

            // PREORDENAR UNA SOLA VEZ
            allContacts.sort((a, b) => a.name.localeCompare(b.name));

            // PROCESAR FOTOS DE PERFIL EN SEGUNDO PLANO (SIN BLOQUEAR)
            this.processProfilePicturesBackground(allContacts);

            // Actualizar estructura preprocesada
            this.preprocessedContacts = {
                allContacts,
                lastUpdate: Date.now(),
                isUpdating: false
            };

            // Cachear páginas comunes
            this.cacheCommonContactPages(allContacts);
            
            this.contactMetrics.proactiveUpdates++;
            const duration = Date.now() - startTime;
            logger.info(`Proactive contacts cache updated - ${allContacts.length} contacts, ${duration}ms`);
            
        } catch (error) {
            logger.error('Error updating proactive contacts cache:', error);
        } finally {
            this.preprocessedContacts.isUpdating = false;
        }
    }

    /**
    * Cachear páginas comunes para respuesta instantánea
    */
    cacheCommonContactPages(allContacts) {
        const commonPaginations = [1, 2, 3]; // Páginas más consultadas
        
        commonPaginations.forEach(page => {
            const start = (page - 1) * this.CONTACTS_PER_PAGE;
            const end = start + this.CONTACTS_PER_PAGE;
            
            const result = allContacts.slice(start, end);
            const cacheKey = `contacts_page_${page}`;
            this.setContactsCache(cacheKey, result);
        });
    }

    /**
     * Procesar fotos de perfil en segundo plano sin bloquear
     */
    async processProfilePicturesBackground(contacts) {
        try {
            const clients = Array.from(this.whatsAppClient.clients.values());
            
            // Procesar en lotes pequeños para no sobrecargar
            const BACKGROUND_BATCH_SIZE = 5;
            
            for (let i = 0; i < contacts.length; i += BACKGROUND_BATCH_SIZE) {
                const batch = contacts.slice(i, i + BACKGROUND_BATCH_SIZE);
                
                // Procesar lote sin esperar (fire and forget)
                setTimeout(async () => {
                    await this.addProfilePicturesUltraFast(batch, clients, true);
                }, i * 100); // Escalonado para evitar picos
            }
            
        } catch (error) {
            logger.debug('Error in background profile pic processing:', error);
        }
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

    /**
     * Fetch contacts with pagination, caching and resilience
     * @param {number} page - Page number
     * @returns {Promise<Array>} Contacts list
     */
    async fetchContacts(page) {
        const startTime = Date.now();
        const cacheKey = `contacts_page_${page}`;
        
        try {
            // ✅ PASO 1: INTENTAR CACHE CALIENTE (RESPUESTA INMEDIATA)
            const cachedContacts = this.getContactsFromCache(cacheKey);
            if (cachedContacts) {
                this.contactMetrics.cacheHits++;
                logger.debug(`⚡ Cache hit for contacts page ${page} (${Date.now() - startTime}ms)`);
                return cachedContacts;
            }

            // ✅ PASO 2: USAR ESTRUCTURA PREPROCESADA (MUY RÁPIDO)
            if (this.preprocessedContacts.allContacts.length > 0 && 
                Date.now() - this.preprocessedContacts.lastUpdate < this.contactsCacheTimeout * 2) {
                
                const { allContacts } = this.preprocessedContacts;
                const start = (page - 1) * this.CONTACTS_PER_PAGE;
                const end = start + this.CONTACTS_PER_PAGE;
                const paginatedContacts = allContacts.slice(start, end);
                
                // Agregar fotos de perfil rápidamente
                const contactsWithPics = await this.addProfilePicturesUltraFast(
                    paginatedContacts, 
                    Array.from(this.whatsAppClient.clients.values())
                );
                
                // Cachear para próximas consultas
                this.setContactsCache(cacheKey, contactsWithPics);
                
                logger.info(`📋 Preprocessed contacts served - Page: ${page}, ${Date.now() - startTime}ms`);
                return contactsWithPics;
            }

            // ✅ PASO 3: FALLBACK RÁPIDO CON TIMEOUT AGRESIVO (ÚLTIMO RECURSO)
            this.contactMetrics.cacheMisses++;
            
            const result = await Promise.race([
                this._fetchContactsUltraFast(page),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Ultra fast contacts fetch timeout')), 2000) // ✅ 2s MAX
                )
            ]);
            
            this.setContactsCache(cacheKey, result);
            this.updateContactMetrics(startTime, true);
            
            logger.info(`🚀 Ultra fast contacts - Page: ${page}, ${Date.now() - startTime}ms`);
            return result;
            
        } catch (error) {
            this.updateContactMetrics(startTime, false);
            logger.error(`❌ Error fetching contacts page ${page}:`, error);
            
            // ✅ PASO 4: INTENTAR CACHE EXPIRADO
            const staleCache = this.getStaleContactsFromCache(cacheKey);
            if (staleCache) {
                this.contactMetrics.staleDataReturned++;
                logger.warn(`📦 Returning stale cache for contacts page ${page}`);
                return staleCache;
            }
            
            // ✅ PASO 5: ARRAY VACÍO (ÚLTIMA LÍNEA DE DEFENSA)
            return [];
        }
    }

    /**
     * Fetch contacts with fallback mechanisms
     * @private
     */
    async _fetchContactsUltraFast(page) {
        await this.init();

        const clients = Array.from(this.whatsAppClient.clients.values());
        if (!clients.length) {
            return [];
        }

        // ✅ OBTENER CONTACTOS CON TIMEOUT REDUCIDO Y RESULTADOS PARCIALES
        const allContacts = await this.getAllContactsResilient(clients, false, 1500); // 1.5s timeout
        
        if (!allContacts.length) {
            return [];
        }
        
        // Ordenar solo una vez
        allContacts.sort((a, b) => a.name.localeCompare(b.name));
        
        const start = (page - 1) * this.CONTACTS_PER_PAGE;
        const end = start + this.CONTACTS_PER_PAGE;
        const paginatedContacts = allContacts.slice(start, end);

        // Agregar fotos de perfil con timeout muy agresivo
        return await this.addProfilePicturesUltraFast(paginatedContacts, clients);
    }

    /**
     * Create contact for specific client with retries
     * @param {string} clientNumber - Client number
     * @param {string} contactNumber - Contact number
     * @param {string} contactName - Contact name
     */
    async createContact(clientNumber, contactNumber, contactName) {
        const operationId = `create_contact_${clientNumber}_${Date.now()}`;
        
        try {
            await this.retryManager.execute(operationId, async () => {
                const client = await this.getClientById(clientNumber);
                
                if (!client) {
                    throw new NotFoundError(`Client ${clientNumber} not found`);
                }

                const formattedNumber = this.formatContactNumber(contactNumber);
                
                // Verificar si el contacto ya existe
                const existingContacts = await client.getContacts();
                const existingContact = existingContacts.find(c => 
                    c.id._serialized === formattedNumber
                );
                
                if (existingContact) {
                    logger.info(`Contact ${contactName} already exists for client ${clientNumber}`);
                    return;
                }
                
                const contact = await client.createContact(formattedNumber, contactName);
                
                if (!contact) {
                    throw new Error('Failed to create contact');
                }
                
                // Invalidar cache de contactos
                this.invalidateContactsCache();
                
                logger.info(`Contact ${contactName} created successfully for client ${clientNumber}`);
            });
            
        } catch (error) {
            logger.error(`Error creating contact ${contactName} for client ${clientNumber}:`, error);
            throw error;
        }
    }

    /**
     * ✅ OBTENER CONTACTOS CON MÁXIMA OPTIMIZACIÓN
     * @param {Array} clients - Array of WhatsApp clients
     * @param {boolean} isProactive - Si es actualización proactiva
     * @param {number} customTimeout - Timeout personalizado
     * @returns {Promise<Array>} All contacts
     */
    async getAllContactsResilient(clients, isProactive = false, customTimeout = null) {
        // ✅ TIMEOUT DINÁMICO SEGÚN CONTEXTO
        const timeout = customTimeout || (isProactive ? 3000 : 1500); // Proactivo: 3s, Demanda: 1.5s
        
        // ✅ PROCESAMIENTO CONCURRENTE SIN ESPERAR TODOS LOS CLIENTES
        const contactsPromises = clients.map(async (client) => {
            const release = await this.fetchSemaphore.acquire();
            
            try {
                return await Promise.race([
                    this._getContactsFromClientOptimized(client),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Client timeout ${timeout}ms`)), timeout)
                    )
                ]);
            } catch (error) {
                logger.warn(`⚠️ Contacts client ${client.options?.authStrategy?.clientId} failed: ${error.message}`);
                return []; // No fallar, devolver array vacío
            } finally {
                release();
            }
        });

        // ✅ PROCESAMIENTO EN LOTES PARA REDUCIR LATENCIA
        const BATCH_SIZE = 6; // Procesar 6 clientes a la vez (contactos son más estables)
        const allResults = [];
        
        for (let i = 0; i < contactsPromises.length; i += BATCH_SIZE) {
            const batch = contactsPromises.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(batch);
            
            // Agregar resultados exitosos inmediatamente
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                    allResults.push(...result.value);
                }
            });
            
            // Si no es proactivo, no esperar más lotes si ya tenemos datos suficientes
            if (!isProactive && allResults.length > 50 && i + BATCH_SIZE < contactsPromises.length) {
                logger.debug(`⚡ Early contacts return with ${allResults.length} contacts from ${i + BATCH_SIZE} clients`);
                break;
            }
        }
        
        // Log de estadísticas
        const processedClients = Math.min(clients.length, allResults.length > 0 ? clients.length : 0);
        logger.debug(`📊 Processed ${processedClients}/${clients.length} clients, got ${allResults.length} contacts`);
        
        return allResults;
    }

    /**
     * Get contacts from a single client
     * @private
     */
    async _getContactsFromClientOptimized(client) {
        try {
            // ✅ OBTENER CONTACTOS CON TIMEOUT AGRESIVO
            const contacts = await Promise.race([
                client.getContacts(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('getContacts timeout')), 1500)
                )
            ]);
            
            if (!contacts || contacts.length === 0) return [];
            
            // ✅ FILTRADO OPTIMIZADO EN UNA SOLA PASADA
            return contacts
                .filter(contact => 
                    !contact.isGroup && 
                    contact.isMyContact && 
                    !contact.id._serialized.endsWith('@lid')
                )
                .map(contact => ({
                    id: contact.id._serialized,
                    phone_number: contact.id.user,
                    name: contact.name || contact.pushname || contact.id._serialized,
                    clientNumber: client.options?.authStrategy?.clientId || 'unknown',
                    clientId: client.id,
                    profilePicUrl: this.getDefaultProfilePic(), // Inicializar con default
                    lastSeen: contact.lastSeen || null,
                    processingTime: Date.now()
                }));
            
        } catch (error) {
            logger.debug(`Error in _getContactsFromClientOptimized: ${error.message}`);
            return [];
        }
    }

    /**
     * Add profile pictures to contacts with resilience
     * @param {Array} contacts - Contact list
     * @param {Array} clients - WhatsApp clients
     * @returns {Promise<Array>} Contacts with profile pictures
     */
    async addProfilePicturesUltraFast(contacts, clients, isBackground = false) {
        const timeout = isBackground ? 3000 : 800; // Background más generoso
        const BATCH_SIZE = isBackground ? 8 : 12; // Batches más grandes si no es background
        
        for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
            const batch = contacts.slice(i, i + BATCH_SIZE);
            
            const batchPromises = batch.map(async (contact) => {
                const release = await this.profilePicSemaphore.acquire();
                
                try {
                    // ✅ VERIFICAR CACHE DE FOTOS PRIMERO
                    const cachedPic = this.getProfilePicFromCache(contact.id);
                    if (cachedPic) {
                        contact.profilePicUrl = cachedPic;
                        this.contactMetrics.profilePicCacheHits++;
                        return contact;
                    }
                    
                    const client = clients.find(c => c.id === contact.clientId);
                    
                    if (client) {
                        // ✅ TIMEOUT INDIVIDUAL ULTRA-AGRESIVO
                        const profilePicPromise = Promise.race([
                            client.getProfilePicUrl(contact.id),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Profile pic timeout')), timeout)
                            )
                        ]);
                        
                        const profilePicUrl = await profilePicPromise;
                        
                        if (profilePicUrl) {
                            contact.profilePicUrl = profilePicUrl;
                            this.setProfilePicCache(contact.id, profilePicUrl);
                        }
                    }
                    
                    this.contactMetrics.profilePicsProcessed++;
                    
                } catch (error) {
                    // Silencioso en background, debug en foreground
                    if (!isBackground) {
                        logger.debug(`Error getting profile pic for ${contact.name}: ${error.message}`);
                    }
                    // Ya tiene profilePicUrl por defecto
                } finally {
                    release();
                }
                
                return contact;
            });
            
            await Promise.allSettled(batchPromises);
            
            // Pausa mínima entre lotes solo en foreground
            if (!isBackground && i + BATCH_SIZE < contacts.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        return contacts;
    }

    /**
     * Cache management for contacts
     */
    getContactsFromCache(key) {
        const item = this.contactsCache.get(key);
        if (item && Date.now() - item.timestamp < this.contactsCacheTimeout) {
            return item.value;
        }
        return null;
    }

    getStaleContactsFromCache(key) {
        const item = this.contactsCache.get(key);
        return item ? item.value : null;
    }

    /**
     * Obtener foto de perfil desde cache
     */
    getProfilePicFromCache(contactId) {
        const item = this.profilePicCache.get(contactId);
        if (item && Date.now() - item.timestamp < this.profilePicCacheTimeout) {
            return item.value;
        }
        return null;
    }

    /**
     * Guardar foto de perfil en cache
     */
    setProfilePicCache(contactId, profilePicUrl) {
        this.profilePicCache.set(contactId, {
            value: profilePicUrl,
            timestamp: Date.now()
        });
        
        // Limpiar cache si es muy grande
        if (this.profilePicCache.size > 500) {
            this.cleanupProfilePicCache();
        }
    }

    setContactsCache(key, value) {
        this.contactsCache.set(key, {
            value,
            timestamp: Date.now()
        });
        
        // Limpiar cache antiguo si es muy grande
        if (this.contactsCache.size > 100) {
            this.cleanupOldCache();
        }
    }

    invalidateContactsCache() {
        this.contactsCache.clear();
        this.preprocessedContacts = {
            allContacts: [],
            lastUpdate: 0,
            isUpdating: false
        };
        // No limpiar profilePicCache ya que las fotos cambian raramente
        logger.debug('Contacts cache invalidated');
    }

    cleanupOldCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, item] of this.contactsCache.entries()) {
            if (now - item.timestamp > this.contactsCacheTimeout) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.contactsCache.delete(key));
        
        if (keysToDelete.length > 0) {
            logger.debug(`Cleaned up ${keysToDelete.length} expired cache entries`);
        }
    }

    /**
     * Limpiar cache de fotos de perfil
     */
    cleanupProfilePicCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, item] of this.profilePicCache.entries()) {
            if (now - item.timestamp > this.profilePicCacheTimeout) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.profilePicCache.delete(key));
        
        if (keysToDelete.length > 0) {
            logger.debug(`Cleaned up ${keysToDelete.length} expired profile pic cache entries`);
        }
    }

    /**
     * Update contact-specific metrics
     */
    updateContactMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        this.contactMetrics.totalFetches++;
        
        // Calcular promedio móvil
        const currentAvg = this.contactMetrics.averageFetchTime;
        const count = this.contactMetrics.totalFetches;
        this.contactMetrics.averageFetchTime = 
            (currentAvg * (count - 1) + duration) / count;
        
        this.contactMetrics.lastFetchTime = Date.now();
    }

    /**
     * Get contacts service metrics
     * @returns {Object} Service metrics
     */
    getContactsMetrics() {
        return {
            ...this.contactMetrics,
            cacheSize: this.contactsCache.size,
            profilePicCacheSize: this.profilePicCache.size,
            preprocessedContactsCount: this.preprocessedContacts.allContacts.length,
            lastProactiveUpdate: this.preprocessedContacts.lastUpdate,
            cacheAge: Date.now() - this.preprocessedContacts.lastUpdate,
            circuitBreakerState: this.contactsCircuitBreaker.getState(),
            cacheHitRate: this.contactMetrics.totalFetches > 0 ? 
                (this.contactMetrics.cacheHits / this.contactMetrics.totalFetches * 100).toFixed(2) + '%' : '0%',
            profilePicCacheHitRate: this.contactMetrics.profilePicsProcessed > 0 ?
                (this.contactMetrics.profilePicCacheHits / this.contactMetrics.profilePicsProcessed * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Health check for contacts service
     * @returns {Object} Health status
     */
    async getContactsHealthCheck() {
        const baseHealth = await this.healthCheck();
        const contactsHealth = {
            ...baseHealth,
            service: 'ContactService',
            contactsMetrics: this.getContactsMetrics(),
            specificIssues: []
        };

        // ✅ VERIFICAR ESTADO DEL CACHE PROACTIVO
        const cacheAge = Date.now() - this.preprocessedContacts.lastUpdate;
        if (cacheAge > this.contactsCacheTimeout * 2.5) { // 7.5 minutos
            contactsHealth.specificIssues.push(`Proactive contacts cache outdated: ${Math.round(cacheAge / 1000)}s`);
            contactsHealth.status = 'degraded';
        }

        // Verificar circuit breaker específico de contactos
        const cbState = this.contactsCircuitBreaker.getState();
        if (cbState.state === 'OPEN') {
            contactsHealth.specificIssues.push('Contacts circuit breaker is OPEN');
            contactsHealth.status = 'degraded';
        }

        // Verificar hit rate de cache de fotos de perfil
        const picCacheHitRate = this.contactMetrics.profilePicsProcessed > 0 ? 
            this.contactMetrics.profilePicCacheHits / this.contactMetrics.profilePicsProcessed : 0;
        
        if (picCacheHitRate < 0.4 && this.contactMetrics.profilePicsProcessed > 20) {
            contactsHealth.specificIssues.push(`Low profile pic cache hit rate: ${(picCacheHitRate * 100).toFixed(2)}%`);
            contactsHealth.status = contactsHealth.status === 'unhealthy' ? 'unhealthy' : 'degraded';
        }

        return contactsHealth;
    }
}

module.exports = ContactService;