const ContactService = require('../services/api/contactService');
const { asyncHandler } = require('../utils/asyncHandler');
const ResponseHelper = require('../utils/responseHelper');
const { ContactValidators } = require('../utils/validators');
const { logger } = require('../config/logger');
const { MESSAGES } = require('../utils/constants');

class ContactController {
    constructor() {
        this.whatsappService = new ContactService();
        
        // Métricas del controlador
        this.controllerMetrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            lastRequestTime: null
        };
        
        // Rate limiting simple por IP
        this.requestTracker = new Map();
        this.RATE_LIMIT_WINDOW = 60000; // 1 minuto
        this.MAX_REQUESTS_PER_WINDOW = 30;
    }

    /**
     * Simple rate limiting middleware
     * @private
     */
    checkRateLimit(req) {
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        
        if (!this.requestTracker.has(clientIP)) {
            this.requestTracker.set(clientIP, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW });
            return true;
        }
        
        const tracker = this.requestTracker.get(clientIP);
        
        if (now > tracker.resetTime) {
            // Reset window
            tracker.count = 1;
            tracker.resetTime = now + this.RATE_LIMIT_WINDOW;
            return true;
        }
        
        if (tracker.count >= this.MAX_REQUESTS_PER_WINDOW) {
            return false;
        }
        
        tracker.count++;
        return true;
    }

    /**
     * Update controller metrics
     * @private
     */
    updateMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        this.controllerMetrics.totalRequests++;
        
        if (success) {
            this.controllerMetrics.successfulRequests++;
        } else {
            this.controllerMetrics.failedRequests++;
        }
        
        // Calcular promedio móvil
        const currentAvg = this.controllerMetrics.averageResponseTime;
        const count = this.controllerMetrics.totalRequests;
        this.controllerMetrics.averageResponseTime = 
            (currentAvg * (count - 1) + duration) / count;
        
        this.controllerMetrics.lastRequestTime = Date.now();
    }

    /**
     * Get contacts with pagination and enhanced error handling
     */
    getContacts = asyncHandler(async (req, res) => {
        const startTime = Date.now();
        const requestId = `contacts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            // Rate limiting check
            if (!this.checkRateLimit(req)) {
                logger.warn(`Rate limit exceeded for IP: ${req.ip}`, { requestId });
                return ResponseHelper.error(res, 'Rate limit exceeded', 429, {
                    retryAfter: Math.ceil(this.RATE_LIMIT_WINDOW / 1000)
                });
            }

            // Validación con manejo de errores mejorado
            let validatedData;
            try {
                validatedData = ContactValidators.pagination(req.query);
            } catch (validationError) {
                logger.warn(`Validation error in getContacts:`, { 
                    error: validationError.message, 
                    query: req.query,
                    requestId 
                });
                return ResponseHelper.error(res, `Validation error: ${validationError.message}`, 400);
            }

            const { page } = validatedData;
            
            logger.info(`Getting contacts - Page: ${page}`, { requestId });

            // Timeout para la operación completa
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), 30000); // 30 segundos
            });

            const contactsPromise = this.whatsappService.fetchContacts(page);
            
            const contacts = await Promise.race([contactsPromise, timeoutPromise]);
            
            // Validar que la respuesta sea un array
            if (!Array.isArray(contacts)) {
                throw new Error('Invalid response format from service');
            }

            this.updateMetrics(startTime, true);
            
            logger.info(`Contacts retrieved successfully - Page: ${page}, Count: ${contacts.length}`, { 
                requestId,
                duration: Date.now() - startTime 
            });

            return ResponseHelper.success(res, { 
                contacts,
                page,
                count: contacts.length,
                requestId 
            }, 'Contacts retrieved successfully');

        } catch (error) {
            this.updateMetrics(startTime, false);
            
            logger.error(`Error in getContacts:`, { 
                error: error.message,
                stack: error.stack,
                query: req.query,
                requestId,
                duration: Date.now() - startTime
            });

            // Respuestas diferenciadas según el tipo de error
            if (error.message === 'Request timeout') {
                return ResponseHelper.error(res, 'Request timeout - please try again', 408, { requestId });
            }
            
            if (error.message.includes('Rate limit')) {
                return ResponseHelper.error(res, 'Service temporarily unavailable', 503, { requestId });
            }

            return ResponseHelper.error(res, 'Failed to retrieve contacts', 500, { 
                requestId,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });

    /**
     * Save contact for specific client with enhanced validation and error handling
     */
    saveContact = asyncHandler(async (req, res) => {
        const startTime = Date.now();
        const requestId = `save_contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            // Rate limiting check
            if (!this.checkRateLimit(req)) {
                logger.warn(`Rate limit exceeded for IP: ${req.ip} on saveContact`, { requestId });
                return ResponseHelper.error(res, 'Rate limit exceeded', 429, {
                    retryAfter: Math.ceil(this.RATE_LIMIT_WINDOW / 1000)
                });
            }

            // Validación con logging detallado
            let validatedData;
            try {
                validatedData = ContactValidators.saveContact(req.body);
            } catch (validationError) {
                logger.warn(`Validation error in saveContact:`, { 
                    error: validationError.message, 
                    body: req.body,
                    requestId 
                });
                return ResponseHelper.error(res, `Validation error: ${validationError.message}`, 400);
            }

            const { clientNumber, contactNumber, contactName } = validatedData;
            
            logger.info(`Saving contact: ${contactName} for client ${clientNumber}`, { 
                requestId,
                contactNumber: contactNumber.replace(/\d/g, '*') // Ofuscar número en logs
            });

            // Timeout para la operación
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Save contact timeout')), 20000); // 20 segundos
            });

            const savePromise = this.whatsappService.createContact(clientNumber, contactNumber, contactName);
            
            await Promise.race([savePromise, timeoutPromise]);
            
            this.updateMetrics(startTime, true);
            
            logger.info(`Contact ${contactName} saved successfully for client ${clientNumber}`, { 
                requestId,
                duration: Date.now() - startTime 
            });

            return ResponseHelper.success(res, { 
                clientNumber,
                contactName,
                requestId 
            }, MESSAGES.SUCCESS.CONTACT_SAVED);

        } catch (error) {
            this.updateMetrics(startTime, false);
            
            logger.error(`Error in saveContact:`, { 
                error: error.message,
                stack: error.stack,
                body: req.body,
                requestId,
                duration: Date.now() - startTime
            });

            // Respuestas específicas según el tipo de error
            if (error.message === 'Save contact timeout') {
                return ResponseHelper.error(res, 'Save operation timeout - contact may still be created', 408, { requestId });
            }
            
            if (error.message.includes('not found')) {
                return ResponseHelper.error(res, 'WhatsApp client not found or not ready', 404, { requestId });
            }
            
            if (error.message.includes('already exists')) {
                return ResponseHelper.success(res, { 
                    message: 'Contact already exists',
                    requestId 
                }, 'Contact already exists');
            }

            return ResponseHelper.error(res, 'Failed to save contact', 500, { 
                requestId,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });

    /**
     * Get controller metrics endpoint
     */
    getMetrics = asyncHandler(async (req, res) => {
        try {
            const serviceMetrics = await this.whatsappService.getContactsMetrics();
            
            return ResponseHelper.success(res, {
                controller: this.controllerMetrics,
                service: serviceMetrics,
                timestamp: Date.now()
            }, 'Metrics retrieved successfully');
            
        } catch (error) {
            logger.error('Error getting metrics:', error);
            return ResponseHelper.error(res, 'Failed to retrieve metrics', 500);
        }
    });

    /**
     * Health check endpoint
     */
    healthCheck = asyncHandler(async (req, res) => {
        try {
            const healthStatus = await this.whatsappService.getContactsHealthCheck();
            
            const httpStatus = healthStatus.status === 'healthy' ? 200 : 
                              healthStatus.status === 'degraded' ? 206 : 503;
            
            return res.status(httpStatus).json({
                success: healthStatus.status !== 'unhealthy',
                data: healthStatus,
                message: `Service is ${healthStatus.status}`
            });
            
        } catch (error) {
            logger.error('Error in health check:', error);
            return res.status(503).json({
                success: false,
                data: {
                    status: 'unhealthy',
                    error: error.message,
                    timestamp: Date.now()
                },
                message: 'Health check failed'
            });
        }
    });

    /**
     * Cleanup method to be called on server shutdown
     */
    cleanup() {
        // Limpiar el tracker de rate limiting
        this.requestTracker.clear();
        
        logger.info('ContactController cleanup completed');
    }
}

module.exports = new ContactController();