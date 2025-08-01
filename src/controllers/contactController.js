/**
 * @swagger
 * components:
 *   schemas:
 *     Contact:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         number:
 *           type: string
 *         profilePicUrl:
 *           type: string
 *           nullable: true
 *     SaveContactRequest:
 *       type: object
 *       required:
 *         - clientNumber
 *         - contactNumber
 *         - contactName
 *       properties:
 *         clientNumber:
 *           type: string
 *           description: Número del cliente WhatsApp
 *         contactNumber:
 *           type: string
 *           description: Número del contacto a guardar
 *         contactName:
 *           type: string
 *           description: Nombre del contacto
 */

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
     * @swagger
     * /api/getContacts:
     *   get:
     *     tags: [Contacts]
     *     summary: Obtener lista de contactos con paginación
     *     operationId: getContacts
     *     parameters:
     *       - in: query
     *         name: page
     *         schema:
     *           type: integer
     *           minimum: 1
     *           default: 1
     *         description: Número de página para la paginación
     *         example: 1
     *     responses:
     *       200:
     *         description: Contactos obtenidos exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         contacts:
     *                           type: array
     *                           items:
     *                             $ref: '#/components/schemas/Contact'
     *                         count:
     *                           type: integer
     *                           description: Número de contactos en la página actual
     *                           example: 25
     *                         page:
     *                           type: integer
     *                           description: Página actual
     *                           example: 1
     *                         requestId:
     *                           type: string
     *                           description: ID único de la petición
     *                           example: "contacts_1234567890_abc123def"
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       408:
     *         description: Timeout de la petición
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         requestId:
     *                           type: string
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     *       500:
     *         description: Error interno del servidor
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         requestId:
     *                           type: string
     *                         details:
     *                           type: string
     *                           description: Detalles del error (solo en desarrollo)
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
     * @swagger
     * /api/saveContact:
     *   post:
     *     tags: [Contacts]
     *     summary: Guardar nuevo contacto en WhatsApp
     *     operationId: saveContact
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/SaveContactRequest'
     *           example:
     *             clientNumber: "1234567890"
     *             contactNumber: "0987654321"
     *             contactName: "Juan Pérez"
     *     responses:
     *       200:
     *         description: Contacto guardado exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         clientNumber:
     *                           type: string
     *                           description: Número del cliente WhatsApp
     *                           example: "1234567890"
     *                         contactName:
     *                           type: string
     *                           description: Nombre del contacto guardado
     *                           example: "Juan Pérez"
     *                         requestId:
     *                           type: string
     *                           description: ID único de la petición
     *                           example: "save_contact_1234567890_xyz789"
     *       400:
     *         $ref: '#/components/responses/BadRequest' 
     *       404:
     *         description: Cliente WhatsApp no encontrado o no está listo
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         requestId:
     *                           type: string
     *       408:
     *         description: Timeout al guardar contacto
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         requestId:
     *                           type: string
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     *       500:
     *         description: Error interno del servidor
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         requestId:
     *                           type: string
     *                         details:
     *                           type: string
     *                           description: Detalles del error (solo en desarrollo)
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
     * @swagger
     * /api/metrics:
     *   get:
     *     tags: [Contacts]
     *     summary: Obtener métricas del servicio de contactos
     *     operationId: getContactMetrics
     *     responses:
     *       200:
     *         description: Métricas obtenidas exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       type: object
     *                       properties:
     *                         controller:
     *                           $ref: '#/components/schemas/ControllerMetrics'
     *                         service:
     *                           $ref: '#/components/schemas/ContactServiceMetrics'
     *                         timestamp:
     *                           type: integer
     *                           format: int64
     *                           description: Timestamp de la consulta
     *                           example: 1640995200000
     *       500:
     *         description: Error al obtener métricas
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
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
     * @swagger
     * /api/health:
     *   get:
     *     tags: [Contacts]
     *     summary: Verificar estado de salud del servicio de contactos
     *     operationId: getContactsHealthCheck
     *     responses:
     *       200:
     *         description: Servicio saludable
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 data:
     *                   $ref: '#/components/schemas/HealthStatus'
     *                 message:
     *                   type: string
     *                   example: "Service is healthy"
     *       206:
     *         description: Servicio degradado
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 data:
     *                   $ref: '#/components/schemas/HealthStatus'
     *                 message:
     *                   type: string
     *                   example: "Service is degraded"
     *       503:
     *         description: Servicio no saludable
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: false
     *                 data:
     *                   $ref: '#/components/schemas/HealthStatus'
     *                 message:
     *                   type: string
     *                   example: "Service is unhealthy"
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