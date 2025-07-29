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
        this.MAX_CONCURRENT_FETCHES = 5; // Limitar concurrencia
        
        // Circuit breaker específico para operaciones de contactos
        this.contactsCircuitBreaker = new CircuitBreaker('contacts-operations', {
            failureThreshold: 3,
            recoveryTimeout: 20000,
            monitoringPeriod: 60000
        });
        
        // Cache de contactos con TTL más largo (5 minutos)
        this.contactsCache = new Map();
        this.contactsCacheTimeout = 300000; // 5 minutos
        
        // Semáforo para controlar concurrencia
        this.fetchSemaphore = this.createSemaphore(this.MAX_CONCURRENT_FETCHES);
        
        // Métricas específicas de contactos
        this.contactMetrics = {
            totalFetches: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageFetchTime: 0,
            lastFetchTime: null
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

    /**
     * Fetch contacts with pagination, caching and resilience
     * @param {number} page - Page number
     * @returns {Promise<Array>} Contacts list
     */
    async fetchContacts(page) {
        const startTime = Date.now();
        const cacheKey = `contacts_page_${page}`;
        
        try {
            // Verificar cache primero
            const cachedContacts = this.getContactsFromCache(cacheKey);
            if (cachedContacts) {
                this.contactMetrics.cacheHits++;
                logger.debug(`Cache hit for contacts page ${page}`);
                return cachedContacts;
            }
            
            this.contactMetrics.cacheMisses++;
            
            // Ejecutar con circuit breaker
            const contacts = await this.contactsCircuitBreaker.execute(async () => {
                return await this._fetchContactsWithFallback(page);
            });
            
            // Cachear resultado exitoso
            this.setContactsCache(cacheKey, contacts);
            this.updateContactMetrics(startTime, true);
            
            logger.info(`Contactos obtenidos - Página: ${page}, Total: ${contacts.length}`);
            return contacts;
            
        } catch (error) {
            this.updateContactMetrics(startTime, false);
            logger.error(`Error al obtener contactos - Página ${page}:`, error);
            
            // Intentar devolver datos desde cache aunque esté expirado
            const staleCache = this.getStaleContactsFromCache(cacheKey);
            if (staleCache) {
                logger.warn(`Returning stale cache for page ${page} due to error`);
                return staleCache;
            }
            
            // Como último recurso, devolver array vacío
            return [];
        }
    }

    /**
     * Fetch contacts with fallback mechanisms
     * @private
     */
    async _fetchContactsWithFallback(page) {
        await this.init();

        const clients = Array.from(this.whatsAppClient.clients.values());

        if (!clients.length) {
            logger.warn('No hay clientes de WhatsApp disponibles');
            return [];
        }

        try {
            // Intentar obtener contactos de todos los clientes
            const allContacts = await this.getAllContactsResilient(clients);
            
            if (!allContacts.length) {
                logger.warn('No se pudieron obtener contactos de ningún cliente');
                return [];
            }
            
            // Ordenar y paginar
            allContacts.sort((a, b) => a.name.localeCompare(b.name));
            
            const start = (page - 1) * this.CONTACTS_PER_PAGE;
            const end = start + this.CONTACTS_PER_PAGE;
            const paginatedContacts = allContacts.slice(start, end);

            // Agregar fotos de perfil con timeout
            return await this.addProfilePicturesResilient(paginatedContacts, clients);
            
        } catch (error) {
            logger.error('Error in _fetchContactsWithFallback:', error);
            throw error;
        }
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
     * Get all contacts from all clients with resilience
     * @param {Array} clients - Array of WhatsApp clients
     * @returns {Promise<Array>} All contacts
     */
    async getAllContactsResilient(clients) {
        const contactsPromises = clients.map(async (client) => {
            // Usar semáforo para limitar concurrencia
            const release = await this.fetchSemaphore.acquire();
            
            try {
                // Timeout por cliente individual
                return await Promise.race([
                    this._getContactsFromClient(client),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Client timeout')), 15000)
                    )
                ]);
            } catch (error) {
                logger.error(`Error obteniendo contactos para cliente ${client.options?.authStrategy?.clientId}:`, error);
                return []; // Devolver array vacío en lugar de fallar
            } finally {
                release();
            }
        });

        const contactsResults = await Promise.allSettled(contactsPromises);
        
        // Filtrar solo resultados exitosos y combinar
        const successfulResults = contactsResults
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value)
            .flat();
            
        // Log de estadísticas
        const failedCount = contactsResults.length - contactsResults.filter(r => r.status === 'fulfilled').length;
        if (failedCount > 0) {
            logger.warn(`Failed to get contacts from ${failedCount}/${clients.length} clients`);
        }
        
        return successfulResults;
    }

    /**
     * Get contacts from a single client
     * @private
     */
    async _getContactsFromClient(client) {
        const contacts = await client.getContacts();
        
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
                clientId: client.id
            }));
    }

    /**
     * Add profile pictures to contacts with resilience
     * @param {Array} contacts - Contact list
     * @param {Array} clients - WhatsApp clients
     * @returns {Promise<Array>} Contacts with profile pictures
     */
    async addProfilePicturesResilient(contacts, clients) {
        const BATCH_SIZE = 10; // Procesar en lotes
        const results = [];
        
        for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
            const batch = contacts.slice(i, i + BATCH_SIZE);
            
            const batchPromises = batch.map(async (contact) => {
                try {
                    const client = clients.find(c => c.id === contact.clientId);
                    
                    if (client) {
                        // Timeout individual para cada foto
                        const profilePicPromise = Promise.race([
                            client.getProfilePicUrl(contact.id),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Profile pic timeout')), 5000)
                            )
                        ]);
                        
                        contact.profilePicUrl = await profilePicPromise || this.getDefaultProfilePic();
                    } else {
                        contact.profilePicUrl = this.getDefaultProfilePic();
                    }
                } catch (error) {
                    logger.debug(`Error getting profile pic for ${contact.name}:`, error.message);
                    contact.profilePicUrl = this.getDefaultProfilePic();
                }
                
                return contact;
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults.map(r => r.value || r.reason));
            
            // Pequeña pausa entre lotes para no sobrecargar
            if (i + BATCH_SIZE < contacts.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return results;
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
            circuitBreakerState: this.contactsCircuitBreaker.getState(),
            cacheHitRate: this.contactMetrics.totalFetches > 0 ? 
                (this.contactMetrics.cacheHits / this.contactMetrics.totalFetches * 100).toFixed(2) + '%' : '0%'
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

        // Verificar circuit breaker específico de contactos
        const cbState = this.contactsCircuitBreaker.getState();
        if (cbState.state === 'OPEN') {
            contactsHealth.specificIssues.push('Contacts circuit breaker is OPEN');
            contactsHealth.status = 'degraded';
        }

        // Verificar si hay muchos fallos en cache
        const cacheHitRate = this.contactMetrics.totalFetches > 0 ? 
            this.contactMetrics.cacheHits / this.contactMetrics.totalFetches : 0;
        
        if (cacheHitRate < 0.3 && this.contactMetrics.totalFetches > 10) {
            contactsHealth.specificIssues.push(`Low cache hit rate: ${(cacheHitRate * 100).toFixed(2)}%`);
            contactsHealth.status = contactsHealth.status === 'unhealthy' ? 'unhealthy' : 'degraded';
        }

        return contactsHealth;
    }
}

module.exports = ContactService;