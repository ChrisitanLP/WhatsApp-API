const { asyncHandler } = require('../utils/asyncHandler');
const ResponseHelper = require('../utils/responseHelper');
const { logger } = require('../config/logger');
const { HTTP_STATUS } = require('../utils/constants');

// Import existing controllers to access their services
const clientController = require('./clientController');
const chatController = require('./chatController');
const contactController = require('./contactController');
const mediaController = require('./mediaController');
const messageController = require('./messageController');

/**
 * Controlador centralizado para métricas y health checks del sistema
 * Proporciona una interfaz unificada para monitoreo y diagnóstico
 */
class MetricsHealthController {
    constructor() {
        // Acceso a servicios a través de los controladores existentes
        this.clientController = clientController;
        this.chatController = chatController;
        this.contactController = contactController;
        this.mediaController = mediaController;
        this.messageController = messageController;
        
        // Métricas del propio controlador
        this.controllerMetrics = {
            requestsCount: 0,
            lastRequestTime: null,
            errors: 0,
            startTime: Date.now()
        };
    }

    /**
     * Incrementa las métricas del controlador
     */
    incrementMetrics(isError = false) {
        this.controllerMetrics.requestsCount++;
        this.controllerMetrics.lastRequestTime = Date.now();
        if (isError) this.controllerMetrics.errors++;
    }

    /**
     * Health check completo del sistema - Endpoint principal
     * GET /api/health/system
     */
    getSystemHealth = asyncHandler(async (req, res) => {
        this.incrementMetrics();
        
        try {
            const healthData = await this.collectSystemHealth();
            
            // Determinar estado general del sistema
            const overallStatus = this.determineOverallStatus(healthData);
            const statusCode = this.getStatusCode(overallStatus);
            
            return res.status(statusCode).json({
                success: overallStatus !== 'unhealthy',
                data: {
                    status: overallStatus,
                    timestamp: Date.now(),
                    system: healthData.system,
                    services: healthData.services,
                    summary: healthData.summary
                }
            });
            
        } catch (error) {
            this.incrementMetrics(true);
            logger.error('System health check failed:', error);
            return ResponseHelper.error(res, 
                'System health check failed', 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Métricas completas del sistema
     * GET /api/metrics/system
     */
    getSystemMetrics = asyncHandler(async (req, res) => {
        this.incrementMetrics();
        
        try {
            const metricsData = await this.collectSystemMetrics();
            
            return ResponseHelper.success(res, metricsData, 'System metrics retrieved successfully');
            
        } catch (error) {
            this.incrementMetrics(true);
            logger.error('Error getting system metrics:', error);
            return ResponseHelper.error(res, 
                `Failed to get system metrics: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Health check por servicio específico
     * GET /api/health/service/:serviceName
     */
    getServiceHealth = asyncHandler(async (req, res) => {
        this.incrementMetrics();
        
        const { serviceName } = req.params;
        
        try {
            const serviceHealth = await this.getHealthForService(serviceName);
            
            if (!serviceHealth) {
                return ResponseHelper.notFound(res, `Service '${serviceName}' not found`);
            }
            
            const statusCode = this.getStatusCode(serviceHealth.status);
            
            return res.status(statusCode).json({
                success: serviceHealth.status !== 'unhealthy',
                data: serviceHealth
            });
            
        } catch (error) {
            this.incrementMetrics(true);
            logger.error(`Error getting health for service ${serviceName}:`, error);
            return ResponseHelper.error(res, 
                `Health check failed for service: ${serviceName}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Métricas por servicio específico
     * GET /api/metrics/service/:serviceName
     */
    getServiceMetrics = asyncHandler(async (req, res) => {
        this.incrementMetrics();
        
        const { serviceName } = req.params;
        
        try {
            const serviceMetrics = await this.getMetricsForService(serviceName);
            
            if (!serviceMetrics) {
                return ResponseHelper.notFound(res, `Service '${serviceName}' not found`);
            }
            
            return ResponseHelper.success(res, {
                service: serviceName,
                metrics: serviceMetrics,
                timestamp: Date.now()
            });
            
        } catch (error) {
            this.incrementMetrics(true);
            logger.error(`Error getting metrics for service ${serviceName}:`, error);
            return ResponseHelper.error(res, 
                `Failed to get metrics for service: ${serviceName}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Health check rápido para load balancers/monitoring
     * GET /api/health
     */
    getQuickHealth = asyncHandler(async (req, res) => {
        this.incrementMetrics();
        
        try {
            // Solo verificar servicios críticos
            const criticalHealth = await this.getCriticalSystemHealth();
            
            if (criticalHealth.status === 'healthy') {
                return res.status(200).json({
                    status: 'ok',
                    timestamp: Date.now()
                });
            } else {
                return res.status(503).json({
                    status: 'error',
                    message: 'System unhealthy',
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            this.incrementMetrics(true);
            logger.error('Quick health check failed:', error);
            return res.status(503).json({
                status: 'error',
                message: 'Health check failed',
                timestamp: Date.now()
            });
        }
    });

    /**
     * Forzar health check en todos los servicios
     * POST /api/health/force-check
     */
    forceSystemHealthCheck = asyncHandler(async (req, res) => {
        this.incrementMetrics();
        
        try {
            const results = {};
            
            // Forzar health check en WhatsApp service si existe
            if (this.whatsappService?.forceHealthCheck) {
                results.whatsapp = await this.whatsappService.forceHealthCheck();
            }
            
            // Agregar más servicios según sea necesario
            
            return ResponseHelper.success(res, {
                forced: true,
                results,
                timestamp: Date.now()
            }, 'Forced health check completed');
            
        } catch (error) {
            this.incrementMetrics(true);
            logger.error('Forced health check failed:', error);
            return ResponseHelper.error(res, 
                `Forced health check failed: ${error.message}`, 
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });

    /**
     * Recolecta health de todos los servicios a través de los controladores
     */
    async collectSystemHealth() {
        const services = {};
        const issues = [];
        
        // WhatsApp Service (através do clientController)
        if (this.clientController?.whatsappService?.healthCheck) {
            try {
                services.whatsapp = await this.clientController.whatsappService.healthCheck();
            } catch (error) {
                services.whatsapp = { status: 'error', error: error.message };
                issues.push('WhatsApp service health check failed');
            }
        }
        
        // Chat Service (através do chatController)
        if (this.chatController?.whatsappService?.getChatsHealthCheck) {
            try {
                services.chat = await this.chatController.whatsappService.getChatsHealthCheck();
            } catch (error) {
                services.chat = { status: 'error', error: error.message };
                issues.push('Chat service health check failed');
            }
        }
        
        // Message Service (através do messageController)
        if (this.messageController?.whatsappService?.getMessageHealthCheck) {
            try {
                services.message = await this.messageController.whatsappService.getMessageHealthCheck();
            } catch (error) {
                services.message = { status: 'error', error: error.message };
                issues.push('Message service health check failed');
            }
        }
        
        // Media Service (através do mediaController)
        if (this.mediaController?.whatsappService?.getMediaHealthCheck) {
            try {
                services.media = await this.mediaController.whatsappService.getMediaHealthCheck();
            } catch (error) {
                services.media = { status: 'error', error: error.message };
                issues.push('Media service health check failed');
            }
        }
        
        // Contact Service (através do contactController)
        if (this.contactController?.whatsappService?.getContactsHealthCheck) {
            try {
                services.contact = await this.contactController.whatsappService.getContactsHealthCheck();
            } catch (error) {
                services.contact = { status: 'error', error: error.message };
                issues.push('Contact service health check failed');
            }
        }
        
        return {
            system: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                nodeVersion: process.version,
                platform: process.platform,
                processId: process.pid,
                environment: process.env.NODE_ENV || 'development'
            },
            services,
            summary: {
                totalServices: Object.keys(services).length,
                healthyServices: Object.values(services).filter(s => s.status === 'healthy').length,
                degradedServices: Object.values(services).filter(s => s.status === 'degraded').length,
                unhealthyServices: Object.values(services).filter(s => s.status === 'unhealthy' || s.status === 'error').length,
                issues
            }
        };
    }

    /**
     * Recolecta métricas de todos los servicios a través de los controladores
     */
    async collectSystemMetrics() {
        const metrics = {
            controller: this.controllerMetrics,
            services: {},
            system: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                nodeVersion: process.version,
                platform: process.platform,
                processId: process.pid
            },
            timestamp: Date.now()
        };
        
        // WhatsApp Service metrics (através do clientController)
        if (this.clientController?.whatsappService?.getServiceMetrics) {
            try {
                metrics.services.whatsapp = await this.clientController.whatsappService.getServiceMetrics();
            } catch (error) {
                logger.warn('Failed to get WhatsApp service metrics:', error);
                metrics.services.whatsapp = { error: error.message };
            }
        }
        
        // Chat Service metrics (através do chatController)
        if (this.chatController?.whatsappService?.getChatsMetrics) {
            try {
                metrics.services.chat = this.chatController.whatsappService.getChatsMetrics();
            } catch (error) {
                logger.warn('Failed to get Chat service metrics:', error);
                metrics.services.chat = { error: error.message };
            }
        }
        
        // Message Service metrics (através do messageController)
        if (this.messageController?.whatsappService?.getMessageMetrics) {
            try {
                metrics.services.message = this.messageController.whatsappService.getMessageMetrics();
            } catch (error) {
                logger.warn('Failed to get Message service metrics:', error);
                metrics.services.message = { error: error.message };
            }
        }
        
        // Media Service metrics (através do mediaController)
        if (this.mediaController?.whatsappService?.getMediaMetrics) {
            try {
                metrics.services.media = this.mediaController.whatsappService.getMediaMetrics();
            } catch (error) {
                logger.warn('Failed to get Media service metrics:', error);
                metrics.services.media = { error: error.message };
            }
        }
        
        // Contact Service metrics (através do contactController)
        if (this.contactController?.whatsappService?.getContactsMetrics) {
            try {
                metrics.services.contact = this.contactController.whatsappService.getContactsMetrics();
            } catch (error) {
                logger.warn('Failed to get Contact service metrics:', error);
                metrics.services.contact = { error: error.message };
            }
        }
        
        return metrics;
    }

    /**
     * Obtiene health de un servicio específico a través de controladores
     */
    async getHealthForService(serviceName) {
        switch (serviceName.toLowerCase()) {
            case 'whatsapp':
                return this.clientController?.whatsappService?.healthCheck ? 
                    await this.clientController.whatsappService.healthCheck() : null;
            case 'chat':
                return this.chatController?.whatsappService?.getChatsHealthCheck ? 
                    await this.chatController.whatsappService.getChatsHealthCheck() : null;
            case 'message':
                return this.messageController?.whatsappService?.getMessageHealthCheck ? 
                    await this.messageController.whatsappService.getMessageHealthCheck() : null;
            case 'media':
                return this.mediaController?.whatsappService?.getMediaHealthCheck ? 
                    await this.mediaController.whatsappService.getMediaHealthCheck() : null;
            case 'contact':
                return this.contactController?.whatsappService?.getContactsHealthCheck ? 
                    await this.contactController.whatsappService.getContactsHealthCheck() : null;
            default:
                return null;
        }
    }

    /**
     * Obtiene métricas de un servicio específico a través de controladores
     */
    async getMetricsForService(serviceName) {
        switch (serviceName.toLowerCase()) {
            case 'whatsapp':
                return this.clientController?.whatsappService?.getServiceMetrics ? 
                    await this.clientController.whatsappService.getServiceMetrics() : null;
            case 'chat':
                return this.chatController?.whatsappService?.getChatsMetrics ? 
                    this.chatController.whatsappService.getChatsMetrics() : null;
            case 'message':
                return this.messageController?.whatsappService?.getMessageMetrics ? 
                    this.messageController.whatsappService.getMessageMetrics() : null;
            case 'media':
                return this.mediaController?.whatsappService?.getMediaMetrics ? 
                    this.mediaController.whatsappService.getMediaMetrics() : null;
            case 'contact':
                return this.contactController?.whatsappService?.getContactsMetrics ? 
                    this.contactController.whatsappService.getContactsMetrics() : null;
            default:
                return null;
        }
    }

    /**
     * Health check crítico solo para servicios esenciales
     */
    async getCriticalSystemHealth() {
        let criticalIssues = 0;
        
        // Solo verificar WhatsApp service como crítico
        if (this.clientController?.whatsappService?.healthCheck) {
            try {
                const health = await this.clientController.whatsappService.healthCheck();
                if (health.status === 'unhealthy') criticalIssues++;
            } catch (error) {
                criticalIssues++;
            }
        }
        
        return {
            status: criticalIssues === 0 ? 'healthy' : 'unhealthy',
            criticalIssues
        };
    }

    /**
     * Determina el estado general del sistema
     */
    determineOverallStatus(healthData) {
        const { services } = healthData;
        const statuses = Object.values(services).map(s => s.status);
        
        if (statuses.some(s => s === 'unhealthy' || s === 'error')) {
            return 'unhealthy';
        }
        
        if (statuses.some(s => s === 'degraded')) {
            return 'degraded';
        }
        
        return 'healthy';
    }

    /**
     * Obtiene código HTTP según el estado
     */
    getStatusCode(status) {
        switch (status) {
            case 'healthy': return HTTP_STATUS.OK;
            case 'degraded': return HTTP_STATUS.DEGRADED; // 200 pero con advertencias
            case 'unhealthy': return HTTP_STATUS.UNAVAILABLE;
            default: return HTTP_STATUS.INTERNAL_SERVER_ERROR;
        }
    }
}

module.exports = new MetricsHealthController();