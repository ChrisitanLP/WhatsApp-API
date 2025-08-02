/**
 * @swagger
 * components:
 *   schemas:
 *     ClientStatus:
 *       type: object
 *       properties:
 *         isAuthenticated:
 *           type: boolean
 *           description: Indica si el cliente está autenticado
 *           example: true
 *         isReady:
 *           type: boolean
 *           description: Indica si el cliente está listo para usar
 *           example: true
 *         number:
 *           type: string
 *           description: Número del cliente
 *           example: "5931234567890"
 *     AuthenticatedAccount:
 *       type: object
 *       properties:
 *         number:
 *           type: string
 *           description: Número de la cuenta autenticada
 *           example: "5931234567890"
 *         display_name:
 *           type: string
 *           description: Nombre mostrado de la cuenta
 *           example: "Mi WhatsApp Business"
 *         displayName:
 *           type: string
 *           description: Nombre alternativo mostrado
 *           example: "Mi WhatsApp Business"
 *         status:
 *           type: string
 *           description: Estado de la cuenta
 *           example: "authenticated"
 *         last_activity:
 *           type: integer
 *           format: int64
 *           description: Timestamp de última actividad
 *           example: 1640995200000
 *         lastActivity:
 *           type: integer
 *           format: int64
 *           description: Timestamp alternativo de última actividad
 *           example: 1640995200000
 *     ReconnectionMetrics:
 *       type: object
 *       properties:
 *         activeReconnections:
 *           type: integer
 *           description: Reconexiones activas
 *           example: 2
 *         queuedReconnections:
 *           type: integer
 *           description: Reconexiones en cola
 *           example: 1
 *         successRate:
 *           type: number
 *           description: Tasa de éxito de reconexión
 *           example: 0.85
 *         totalAttempts:
 *           type: integer
 *           description: Total de intentos de reconexión
 *           example: 23
 *     ServiceMetrics:
 *       type: object
 *       properties:
 *         totalOperations:
 *           type: integer
 *           description: Total de operaciones realizadas
 *           example: 1250
 *         successfulOperations:
 *           type: integer
 *           description: Operaciones exitosas
 *           example: 1180
 *         failedOperations:
 *           type: integer
 *           description: Operaciones fallidas
 *           example: 70
 *         averageResponseTime:
 *           type: number
 *           description: Tiempo promedio de respuesta en ms
 *           example: 185.3
 *         lastOperationTime:
 *           type: integer
 *           nullable: true
 *           format: int64
 *           description: Timestamp de la última operación
 *           example: 1640995200000
 *         cacheSize:
 *           type: integer
 *           description: Tamaño del caché
 *           example: 45
 *         initialized:
 *           type: boolean
 *           description: Si el servicio está inicializado
 *           example: true
 *         isShuttingDown:
 *           type: boolean
 *           description: Si el servicio se está cerrando
 *           example: false
 *     MonitoringMetrics:
 *       type: object
 *       properties:
 *         totalClients:
 *           type: integer
 *           description: Total de clientes monitoreados
 *           example: 8
 *         healthyClients:
 *           type: integer
 *           description: Clientes saludables
 *           example: 7
 *         unhealthyClients:
 *           type: integer
 *           description: Clientes no saludables
 *           example: 1
 *         averageUptime:
 *           type: integer
 *           description: Tiempo promedio de actividad en ms
 *           example: 3600000
 *     ClientMonitoring:
 *       type: object
 *       properties:
 *         lastSeen:
 *           type: integer
 *           format: int64
 *           description: Timestamp última vez visto
 *           example: 1640995200000
 *         consecutiveFailures:
 *           type: integer
 *           description: Fallos consecutivos
 *           example: 0
 *         lastHealthCheck:
 *           type: integer
 *           format: int64
 *           description: Timestamp último health check
 *           example: 1640995200000
 *         createdAt:
 *           type: integer
 *           format: int64
 *           description: Timestamp de creación
 *           example: 1640990000000
 *     ClientMonitoringStatus:
 *       type: object
 *       properties:
 *         number:
 *           type: string
 *           description: Número del cliente
 *           example: "5931234567890"
 *         lastSeen:
 *           type: integer
 *           format: int64
 *           example: 1640995200000
 *         consecutiveFailures:
 *           type: integer
 *           example: 0
 *         lastHealthCheck:
 *           type: integer
 *           format: int64
 *           example: 1640995200000
 */

const BaseWhatsAppService = require('../services/api/baseService');
const { asyncHandler } = require('../utils/asyncHandler');
const ResponseHelper = require('../utils/responseHelper');
const { ClientValidators } = require('../utils/validators');
const { AuthValidators } = require('../utils/validators');
const { logger } = require('../config/logger');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

class ClientController {
    constructor() {
        this.whatsappService = new BaseWhatsAppService();

        this.serviceInitialized = false;
        this.initializationPromise = null;
    }

    /**
     * Asegurar que el servicio esté inicializado antes de usarlo
     */
    async ensureServiceInitialized() {
        if (this.serviceInitialized) {
            return;
        }

        if (this.initializationPromise) {
            await this.initializationPromise;
            return;
        }

        this.initializationPromise = this.whatsappService.initializeService();
        
        try {
            await this.initializationPromise;
            this.serviceInitialized = true;
            logger.debug('WhatsApp service initialized in controller');
        } catch (error) {
            logger.error('Failed to initialize WhatsApp service in controller:', error);
            this.initializationPromise = null;
            throw error;
        }
    }

    /**
     * @swagger
     * /api/addClient:
     *   post:
     *     tags: [Clients]
     *     summary: Agregar nuevo cliente WhatsApp
     *     description: Crea un nuevo cliente WhatsApp. Verifica si ya existe antes de crear uno nuevo.
     *     operationId: addClient
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - number
     *             properties:
     *               number:
     *                 type: string
     *                 pattern: '^[1-9][0-9]{7,14}$'
     *                 description: Número de teléfono del cliente (solo dígitos, sin símbolos)
     *                 example: "5931234567890"
     *           example:
     *             number: "5931234567890"
     *     responses:
     *       200:
     *         description: Cliente agregado exitosamente o ya existía
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     *       500:
     *         description: Error interno del servidor
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    addClient = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { number } = ClientValidators.addClient(req.body);
        
        // Verificar si el cliente ya existe
        const exists = await this.whatsappService.checkClientExists(number);
        if (exists) {
            logger.warn(`Client ${number} already exists`);
            return ResponseHelper.success(res, {}, `Client ${number} already exists`);
        }
        
        await this.whatsappService.createClient(number);
        logger.info(`Cliente ${number} agregado exitosamente`);
        
        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.CLIENT_ADDED);
    });

    /**
     * @swagger
     * /api/removeClient:
     *   post:
     *     tags: [Clients]
     *     summary: Eliminar cliente WhatsApp
     *     description: Elimina un cliente WhatsApp existente. Verifica que el cliente exista antes de eliminarlo.
     *     operationId: removeClient
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - number
     *             properties:
     *               number:
     *                 type: string
     *                 pattern: '^[1-9][0-9]{7,14}$'
     *                 description: Número de teléfono del cliente a eliminar
     *                 example: "5931234567890"
     *           example:
     *             number: "5931234567890"
     *     responses:
     *       200:
     *         description: Cliente eliminado exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       500:
     *         description: Error interno del servidor
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    removeClient = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { number } = ClientValidators.removeClient(req.body);
        
        // Verificar si el cliente existe antes de intentar eliminarlo
        const exists = await this.whatsappService.checkClientExists(number);
        if (!exists) {
            return ResponseHelper.notFound(res, `Client ${number} not found`);
        }
        
        await this.whatsappService.deleteClient(number);
        logger.info(`Cliente ${number} eliminado exitosamente`);
        
        return ResponseHelper.success(
            res, 
            {}, 
            `${MESSAGES.SUCCESS.CLIENT_REMOVED.replace('Client', `Client ${number}`)}`
        );
    });

    /**
     * @swagger
     * /api/qr/{number}:
     *   get:
     *     tags: [Clients]
     *     summary: Obtener código QR para autenticación
     *     description: Obtiene el código QR para autenticar un cliente WhatsApp. Si no está disponible, puede refrescar automáticamente el cliente.
     *     operationId: getQrCode
     *     parameters:
     *       - in: path
     *         name: number
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^[1-9][0-9]{7,14}$'
     *         description: Número del cliente WhatsApp (sin símbolos, solo dígitos)
     *         example: "5931234567890"
     *     responses:
     *       200:
     *         description: QR code generado exitosamente
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
     *                         qr:
     *                           type: string
     *                           description: Código QR listo para mostrar al usuario
     *                           example: "2@abc123def456..."
     *       202:
     *         description: Cliente en proceso de inicialización o reconexión
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
     *                         refreshed:
     *                           type: boolean
     *                           description: Indica si se refrescó el cliente
     *                           example: true
     *                         reconnecting:
     *                           type: boolean
     *                           description: Indica si está en proceso de reconexión
     *                           example: false
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       500:
     *         description: Error interno del servidor
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    getQrCode = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { number } = AuthValidators.getQrCode(req.params);
        
        try {
            const qrCode = await this.whatsappService.getClientQr(number);
            
            if (!qrCode) {
                logger.warn(`QR no disponible para número: ${number}`);
                
                const clientExists = await this.whatsappService.checkClientExists(number);
                
                if (clientExists) {
                    // MODIFICADO: Verificar si el cliente está en proceso de inicialización
                    const clientStatus = await this.whatsappService.checkClientStatus(number);
                    
                    if (!clientStatus.authenticated && !clientStatus.ready) {
                        logger.info(`Cliente existe para ${number}, pero QR no disponible. Estado: autenticado=${clientStatus.authenticated}, listo=${clientStatus.ready}`);
                        
                        // Solo refrescar si no está en proceso de reconexión
                        const whatsappClient = this.whatsappService.whatsAppClient;
                        const isReconnecting = whatsappClient?.activeReconnections?.has(number);
                        
                        if (!isReconnecting) {
                            try {
                                await this.whatsappService.refreshClient(number);
                                return ResponseHelper.success(
                                    res, 
                                    { refreshed: true }, 
                                    MESSAGES.ERROR.QR_GENERATION_IN_PROGRESS,
                                    HTTP_STATUS.ACCEPTED
                                );
                            } catch (refreshError) {
                                logger.error(`Error reiniciando cliente ${number}:`, refreshError);
                                return ResponseHelper.error(res, 
                                    `Failed to refresh client: ${refreshError.message}`, 
                                    HTTP_STATUS.INTERNAL_SERVER_ERROR
                                );
                            }
                        } else {
                            return ResponseHelper.success(
                                res, 
                                { reconnecting: true }, 
                                'Client is reconnecting, please wait',
                                HTTP_STATUS.ACCEPTED
                            );
                        }
                    }
                }

                return ResponseHelper.notFound(res, MESSAGES.ERROR.QR_NOT_AVAILABLE);
            }
            
            return ResponseHelper.success(res, { qr: qrCode });
            
        } catch (error) {
            logger.error(`Error getting QR for ${number}:`, error);
            return ResponseHelper.error(res, 
                `Failed to get QR code: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * @swagger
     * /api/status/{number}:
     *   get:
     *     tags: [Clients]
     *     summary: Verificar estado de autenticación del cliente
     *     description: Verifica únicamente si el cliente está autenticado con WhatsApp
     *     operationId: getClientStatus
     *     parameters:
     *       - in: path
     *         name: number
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^[1-9][0-9]{7,14}$'
     *         description: Número del cliente WhatsApp
     *         example: "5931234567890"
     *     responses:
     *       200:
     *         description: Estado de autenticación obtenido exitosamente
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
     *                         isAuthenticated:
     *                           type: boolean
     *                           description: Indica si el cliente está autenticado
     *                           example: true
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       500:
     *         description: Error interno del servidor (devuelve false por defecto)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    getClientStatus = asyncHandler(async (req, res) => {
        const { number } = AuthValidators.getClientStatus(req.params);
        const isAuthenticated = await this.whatsappService.checkClientAuth(number);
        
        return ResponseHelper.success(res, { isAuthenticated });
    });

    /**
     * @swagger
     * /api/status_connection/{number}:
     *   get:
     *     tags: [Clients]
     *     summary: Verificar estado de conexión detallado
     *     description: Obtiene estado completo de autenticación y disponibilidad del cliente
     *     operationId: getConnectionStatus
     *     parameters:
     *       - in: path
     *         name: number
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^[1-9][0-9]{7,14}$'
     *         description: Número del cliente WhatsApp
     *         example: "5931234567890"
     *     responses:
     *       200:
     *         description: Estado de conexión obtenido exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               allOf:
     *                 - $ref: '#/components/schemas/ApiResponse'
     *                 - type: object
     *                   properties:
     *                     data:
     *                       $ref: '#/components/schemas/ClientStatus'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       500:
     *         description: Error interno del servidor (devuelve estados por defecto)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    getConnectionStatus = asyncHandler(async (req, res) => {
        const { number } = AuthValidators.getClientStatus(req.params);
        const clientStatus = await this.whatsappService.checkClientStatus(number);
        
        return ResponseHelper.success(res, {
        isAuthenticated: clientStatus.authenticated,
        isReady: clientStatus.ready,
        number: number
        });
    });

    /**
     * @swagger
     * /api/authenticated-accounts:
     *   get:
     *     tags: [Clients]
     *     summary: Obtener todas las cuentas autenticadas
     *     description: Retorna información de todas las cuentas WhatsApp autenticadas y activas
     *     operationId: getAllAuthenticatedAccountsInfo
     *     responses:
     *       200:
     *         description: Cuentas autenticadas obtenidas exitosamente
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
     *                         accounts:
     *                           type: array
     *                           items:
     *                             $ref: '#/components/schemas/AuthenticatedAccount'
     *       500:
     *         description: Error interno del servidor (devuelve array vacío)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    getAllAuthenticatedAccountsInfo = asyncHandler(async (req, res) => {
        const accounts = await this.whatsappService.getAllAuthenticatedAccountsInfo();
        
        return ResponseHelper.success(res, { accounts });
    });

    /**
     * @swagger
     * /api/metrics/reconnection:
     *   get:
     *     tags: [Clients]
     *     summary: Obtener métricas detalladas de reconexión
     *     description: Proporciona métricas completas del sistema incluyendo reconexiones, servicio y monitoreo
     *     operationId: getReconnectionMetrics
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
     *                         reconnection:
     *                           $ref: '#/components/schemas/ReconnectionMetrics'
     *                         service:
     *                           $ref: '#/components/schemas/ServiceMetrics'
     *                         monitoring:
     *                           $ref: '#/components/schemas/MonitoringMetrics'
     *                         timestamp:
     *                           type: integer
     *                           format: int64
     *                           example: 1640995200000
     *       500:
     *         description: Error interno del servidor
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    getReconnectionMetrics = asyncHandler(async (req, res) => {
        const metrics = await this.whatsappService.getServiceMetrics();
        
        return ResponseHelper.success(res, {
            reconnection: metrics.reconnection || {},
            service: metrics.service || {},
            monitoring: metrics.monitoring || {},
            timestamp: Date.now()
        });
    });

    /**
     * @swagger
     *   /api/health/{number}:
     *   post:
     *     tags: [Clients]
     *     summary: Forzar verificación de salud para cliente(s)
     *     description: Ejecuta health check para un cliente específico o todos los clientes. Incluye validación de intervalos mínimos para evitar spam.
     *     operationId: forceHealthCheck
     *     parameters:
     *       - in: path
     *         name: number
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^[1-9][0-9]{7,14}$|^all$'
     *         description: Número del cliente WhatsApp o 'all' para todos los clientes
     *         example: "5931234567890"
     *     responses:
     *       200:
     *         description: Verificación de salud completada exitosamente
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
     *                         client:
     *                           type: string
     *                           description: Número del cliente verificado (para cliente específico)
     *                           example: "5931234567890"
     *                         clients:
     *                           type: integer
     *                           description: Número de clientes verificados (para 'all')
     *                           example: 5
     *                         monitoring:
     *                           oneOf:
     *                             - $ref: '#/components/schemas/ClientMonitoring'
     *                             - type: array
     *                               items:
     *                                 $ref: '#/components/schemas/ClientMonitoringStatus'
     *                           description: Información de monitoreo resultante
     *                         message:
     *                           type: string
     *                           example: "Health check completed for client 5931234567890"
     *                         timestamp:
     *                           type: integer
     *                           format: int64
     *                           example: 1640995200000
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       500:
     *         description: Error interno del servidor
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiResponse'
     */
    forceHealthCheck = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { number } = req.params;
        
        try {
            let result;
            
            if (number && number !== 'all') {
                // Health check para cliente específico
                const { number: clientNumber } = AuthValidators.getClientStatus({ number });
                
                // Verificar que el cliente existe
                const clientExists = await this.whatsappService.checkClientExists(clientNumber);
                if (!clientExists) {
                    return ResponseHelper.notFound(res, `Client ${clientNumber} not found`);
                }
                
                result = await this.whatsappService.forceHealthCheck(clientNumber);
                
                return ResponseHelper.success(res, {
                    client: clientNumber,
                    monitoring: result,
                    message: `Health check completed for client ${clientNumber}`,
                    timestamp: Date.now()
                });
            } else {
                // Health check para todos los clientes
                result = await this.whatsappService.forceHealthCheck();
                
                return ResponseHelper.success(res, {
                    clients: Array.isArray(result) ? result.length : 0,
                    monitoring: result,
                    message: `Health check completed for ${Array.isArray(result) ? result.length : 0} clients`,
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            logger.error(`Error performing health check:`, error);
            return ResponseHelper.error(res, 
                `Health check failed: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Get detailed client monitoring status
     */
    getClientMonitoring = asyncHandler(async (req, res) => {
        const { number } = AuthValidators.getClientStatus(req.params);
        
        // Verificar que el cliente existe
        const clientExists = await this.whatsappService.checkClientExists(number);
        if (!clientExists) {
            return ResponseHelper.notFound(res, `Client ${number} not found`);
        }
        
        // Obtener estado detallado
        const clientStatus = await this.whatsappService.checkClientStatus(number);
        const serviceMetrics = await this.whatsappService.getServiceMetrics();
        
        // Buscar información específica del cliente en el monitoreo
        const clientMonitoring = serviceMetrics.monitoring?.clients?.find(
            c => c.number === number
        ) || null;
        
        return ResponseHelper.success(res, {
            number,
            status: clientStatus,
            monitoring: clientMonitoring,
            lastCheck: Date.now()
        });
    });

    /**
     * Force reconnection for specific client
     */
    forceReconnection = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { number } = AuthValidators.getClientStatus(req.params);
        const { reason } = req.body;
        
        // Verificar que el cliente existe
        const clientExists = await this.whatsappService.checkClientExists(number);
        if (!clientExists) {
            return ResponseHelper.notFound(res, `Client ${number} not found`);
        }
        
        try {
            // Acceder al cliente WhatsApp directamente para forzar reconexión
            const whatsappClient = this.whatsappService.whatsAppClient;
            
            if (!whatsappClient) {
                return ResponseHelper.error(res, 
                    'WhatsApp client not available', 
                    HTTP_STATUS.SERVICE_UNAVAILABLE
                );
            }
            
            // Verificar que no hay reconexión en progreso
            if (whatsappClient.activeReconnections?.has(number)) {
                return ResponseHelper.error(res, 
                    `Reconnection already in progress for client ${number}`, 
                    HTTP_STATUS.CONFLICT
                );
            }
            
            // NUEVO: Verificar la última reconexión para evitar spam
            const healthStatus = whatsappClient.clientHealthStatus?.get(number);
            if (healthStatus && healthStatus.lastAttempt) {
                const timeSinceLastAttempt = Date.now() - healthStatus.lastAttempt;
                const minInterval = 60000; // 1 minuto mínimo
                
                if (timeSinceLastAttempt < minInterval) {
                    return ResponseHelper.error(res, 
                        `Please wait ${Math.ceil((minInterval - timeSinceLastAttempt) / 1000)} seconds before forcing reconnection again`, 
                        HTTP_STATUS.TOO_MANY_REQUESTS
                    );
                }
            }
            
            // Forzar reconexión
            const reconnectionReason = reason || 'manual_force_reconnection';
            setImmediate(() => {
                whatsappClient.handleReconnection(number, reconnectionReason);
            });
            
            logger.info(`Manual reconnection triggered for client ${number} with reason: ${reconnectionReason}`);
            
            return ResponseHelper.success(res, {
                number,
                reason: reconnectionReason,
                message: `Reconnection triggered for client ${number}`,
                timestamp: Date.now()
            }, HTTP_STATUS.ACCEPTED);
            
        } catch (error) {
            logger.error(`Error forcing reconnection for ${number}:`, error);
            return ResponseHelper.error(res, 
                `Failed to trigger reconnection: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Cancel pending reconnection for specific client
     */
    cancelReconnection = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { number } = AuthValidators.getClientStatus(req.params);
        
        try {
            // Acceder al cliente WhatsApp directamente
            const whatsappClient = this.whatsappService.whatsAppClient;
            
            if (!whatsappClient) {
                return ResponseHelper.error(res, 
                    'WhatsApp client not available', 
                    HTTP_STATUS.SERVICE_UNAVAILABLE
                );
            }
            
            // Verificar si hay reconexión activa o en cola
            const hasActiveReconnection = whatsappClient.activeReconnections?.has(number);
            const hasQueuedReconnection = whatsappClient.reconnectionQueue?.has(number);
            
            if (!hasActiveReconnection && !hasQueuedReconnection) {
                return ResponseHelper.notFound(res, 
                    `No pending reconnection found for client ${number}`
                );
            }
            
            // Intentar cancelar reconexión
            const cancelled = whatsappClient.cancelReconnection(number);
            
            if (cancelled) {
                logger.info(`Reconnection cancelled for client ${number}`);
                return ResponseHelper.success(res, {
                    number,
                    message: `Reconnection cancelled for client ${number}`,
                    cancelled: {
                        active: hasActiveReconnection,
                        queued: hasQueuedReconnection
                    },
                    timestamp: Date.now()
                });
            } else {
                return ResponseHelper.error(res, 
                    `Failed to cancel reconnection for client ${number}`, 
                    HTTP_STATUS.INTERNAL_SERVER_ERROR
                );
            }
            
        } catch (error) {
            logger.error(`Error cancelling reconnection for ${number}:`, error);
            return ResponseHelper.error(res, 
                `Failed to cancel reconnection: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Get system health status
     */
    getSystemHealth = asyncHandler(async (req, res) => {
        try {
            const health = await this.whatsappService.healthCheck();
            const statusCode = health.status === 'healthy' ? HTTP_STATUS.OK : 
                            health.status === 'degraded' ? HTTP_STATUS.OK : 
                            HTTP_STATUS.SERVICE_UNAVAILABLE;
            
            return res.status(statusCode).json({
                success: health.status !== 'unhealthy',
                data: health,
                timestamp: Date.now()
            });
            
        } catch (error) {
            logger.error('System health check failed:', error);
            return ResponseHelper.error(res, 
                'Health check failed', 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Get comprehensive service statistics
     */
    getServiceStats = asyncHandler(async (req, res) => {
        try {
            await this.ensureServiceInitialized();
            
            const metrics = await this.whatsappService.getServiceMetrics();
            const accounts = await this.whatsappService.getAllAuthenticatedAccountsInfo();
            
            // NUEVO: Obtener información adicional del cliente WhatsApp
            const whatsappClient = this.whatsappService.whatsAppClient;
            const reconnectionInfo = whatsappClient?.getReconnectionMetrics?.() || {};
            
            // Calcular estadísticas adicionales
            const stats = {
                service: metrics.service || {},
                clients: {
                    total: metrics.totalClients || 0,
                    authenticated: accounts.length,
                    monitoring: metrics.monitoring || {},
                    reconnection: {
                        active: reconnectionInfo.activeReconnections || 0,
                        queued: reconnectionInfo.queuedReconnections || 0,
                        successRate: reconnectionInfo.successRate || 0,
                        totalAttempts: reconnectionInfo.totalAttempts || 0
                    },
                    distribution: accounts.map(acc => ({
                        number: acc.number,
                        displayName: acc.display_name || acc.displayName,
                        status: acc.status,
                        lastActivity: acc.last_activity || acc.lastActivity
                    }))
                },
                system: {
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    nodeVersion: process.version,
                    platform: process.platform,
                    processId: process.pid
                },
                health: await this.whatsappService.healthCheck(),
                timestamp: Date.now()
            };
            
            return ResponseHelper.success(res, stats);
            
        } catch (error) {
            logger.error('Error getting service stats:', error);
            return ResponseHelper.error(res, 
                `Failed to get service statistics: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Restart specific client (remove and recreate)
     */
    restartClient = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { number } = ClientValidators.removeClient(req.body);
        
        try {
            // Verificar que el cliente existe
            const clientExists = await this.whatsappService.checkClientExists(number);
            if (!clientExists) {
                return ResponseHelper.notFound(res, `Client ${number} not found`);
            }
            
            // NUEVO: Verificar si hay operaciones en progreso
            const whatsappClient = this.whatsappService.whatsAppClient;
            if (whatsappClient?.activeReconnections?.has(number)) {
                return ResponseHelper.error(res, 
                    `Cannot restart client ${number} - reconnection in progress`, 
                    HTTP_STATUS.CONFLICT
                );
            }
            
            logger.info(`Restarting client ${number}...`);
            
            // Primero cancelar cualquier reconexión pendiente
            if (whatsappClient?.cancelReconnection) {
                whatsappClient.cancelReconnection(number);
            }
            
            // Remover el cliente
            await this.whatsappService.deleteClient(number);
            
            // MODIFICADO: Esperar más tiempo para asegurar cleanup completo
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Recrear el cliente
            await this.whatsappService.createClient(number);
            
            logger.info(`Client ${number} restarted successfully`);
            
            return ResponseHelper.success(res, {
                number,
                message: `Client ${number} restarted successfully`,
                timestamp: Date.now()
            }, HTTP_STATUS.ACCEPTED);
            
        } catch (error) {
            logger.error(`Error restarting client ${number}:`, error);
            return ResponseHelper.error(res, 
                `Failed to restart client: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Bulk operations for multiple clients
     */
    bulkClientOperation = asyncHandler(async (req, res) => {
        await this.ensureServiceInitialized();
        
        const { operation, numbers, options = {} } = req.body;
        
        // Validar input
        if (!operation || !Array.isArray(numbers) || numbers.length === 0) {
            return ResponseHelper.error(res, 
                'Invalid input: operation and numbers array required', 
                HTTP_STATUS.BAD_REQUEST
            );
        }
        
        if (numbers.length > 20) {
            return ResponseHelper.error(res, 
                'Too many clients for bulk operation (max 20)', 
                HTTP_STATUS.BAD_REQUEST
            );
        }
        
        const validOperations = ['restart', 'healthCheck', 'forceReconnection', 'remove'];
        if (!validOperations.includes(operation)) {
            return ResponseHelper.error(res, 
                `Invalid operation. Must be one of: ${validOperations.join(', ')}`, 
                HTTP_STATUS.BAD_REQUEST
            );
        }
        
        const results = [];
        const batchSize = Math.min(options.batchSize || 3, 5); // Máximo 5 por lote
        const delay = Math.max(options.delay || 2000, 1000); // Mínimo 1 segundo
        
        logger.info(`Starting bulk ${operation} for ${numbers.length} clients (batch size: ${batchSize})`);
        
        // MODIFICADO: Verificar estado de clientes antes de operaciones masivas
        if (['restart', 'forceReconnection'].includes(operation)) {
            const whatsappClient = this.whatsappService.whatsAppClient;
            const activeReconnections = whatsappClient?.activeReconnections?.size || 0;
            
            if (activeReconnections > 2) {
                return ResponseHelper.error(res, 
                    `Cannot perform bulk ${operation} - too many active reconnections (${activeReconnections})`, 
                    HTTP_STATUS.CONFLICT
                );
            }
        }
        
        // Procesar en lotes con mejor control de errores
        for (let i = 0; i < numbers.length; i += batchSize) {
            const batch = numbers.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (number, batchIndex) => {
                const globalIndex = i + batchIndex;
                
                try {
                    // Delay escalonado dentro del lote
                    if (batchIndex > 0) {
                        await new Promise(resolve => setTimeout(resolve, 500 * batchIndex));
                    }
                    
                    let result = { number, success: true, index: globalIndex };
                    
                    switch (operation) {
                        case 'restart':
                            // Verificar existencia primero
                            const exists = await this.whatsappService.checkClientExists(number);
                            if (!exists) {
                                result.success = false;
                                result.error = 'Client not found';
                                break;
                            }
                            
                            await this.whatsappService.deleteClient(number);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            await this.whatsappService.createClient(number);
                            result.message = 'Restarted successfully';
                            break;
                            
                        case 'healthCheck':
                            const monitoring = await this.whatsappService.forceHealthCheck(number);
                            result.monitoring = monitoring;
                            result.message = 'Health check completed';
                            break;
                            
                        case 'forceReconnection':
                            const whatsappClient = this.whatsappService.whatsAppClient;
                            
                            // Verificar si ya está en reconexión
                            if (whatsappClient?.activeReconnections?.has(number)) {
                                result.success = false;
                                result.error = 'Reconnection already in progress';
                                break;
                            }
                            
                            setImmediate(() => {
                                whatsappClient.handleReconnection(number, 'bulk_operation');
                            });
                            result.message = 'Reconnection triggered';
                            break;
                            
                        case 'remove':
                            const clientExists = await this.whatsappService.checkClientExists(number);
                            if (!clientExists) {
                                result.success = false;
                                result.error = 'Client not found';
                                break;
                            }
                            
                            await this.whatsappService.deleteClient(number);
                            result.message = 'Removed successfully';
                            break;
                    }
                    
                    return result;
                    
                } catch (error) {
                    logger.error(`Bulk ${operation} failed for ${number}:`, error);
                    return {
                        number,
                        success: false,
                        error: error.message,
                        index: globalIndex
                    };
                }
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults.map(r => r.value || { 
                success: false, 
                error: r.reason?.message || 'Unknown error',
                number: batch[results.length % batch.length] || 'unknown'
            }));
            
            // Pausa entre lotes si no es el último
            if (i + batchSize < numbers.length) {
                logger.debug(`Completed batch ${Math.floor(i/batchSize) + 1}, waiting ${delay}ms before next batch`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failedResults = results.filter(r => !r.success);
        
        logger.info(`Bulk ${operation} completed: ${successCount}/${numbers.length} successful`);
        
        if (failedResults.length > 0) {
            logger.warn(`Bulk ${operation} failures:`, failedResults.map(r => `${r.number}: ${r.error}`));
        }
        
        return ResponseHelper.success(res, {
            operation,
            total: numbers.length,
            successful: successCount,
            failed: numbers.length - successCount,
            results,
            summary: {
                batchSize,
                totalBatches: Math.ceil(numbers.length / batchSize),
                duration: Date.now(),
                failedClients: failedResults.map(r => r.number)
            }
        });
    });
}

module.exports = new ClientController(); 