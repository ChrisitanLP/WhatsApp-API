const express = require('express');
const linksRouter = require('./link');
const docsRouter = require('./docs');
const { notFoundHandler } = require('../middleware/core/errorHandler');
const { logger } = require('../config/logger');

/**
 * Configura y retorna el router principal de la API
 * @returns {Express.Router} Router configurado
 */
const createApiRouter = () => {
    const apiRouter = express.Router();

    // Middleware de logging para todas las rutas
    apiRouter.use((req, res, next) => {
        const startTime = Date.now();
        req.startTime = startTime;
        
        logger.info(`${req.method} ${req.originalUrl}`, {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString(),
            requestId: `${startTime}_${Math.random().toString(36).substr(2, 9)}`
        });
        
        // Log de finalización de request
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            logger.info(`Request completed: ${req.method} ${req.originalUrl}`, {
                statusCode: res.statusCode,
                duration: `${duration}ms`,
                success: res.statusCode < 400
            });
        });
        
        next();
    });

    apiRouter.use('/docs', docsRouter);

    // Registrar rutas principales
    apiRouter.use('/', linksRouter);
    
    // API info endpoint
    // API info endpoint mejorado con información de documentación
    apiRouter.get('/info', (req, res) => {
        res.json({
            name: 'WhatsApp API',
            version: process.env.API_VERSION || '1.0.0',
            description: 'API completa para gestión integral de WhatsApp Business',
            documentation: {
                interactive: '/api/docs',           // Documentación interactiva principal
                swagger: '/api-docs',               // Alias de documentación
                json: '/api/docs/json',             // Especificación JSON
                yaml: '/api/docs/yaml',             // Especificación YAML
                health: '/api/docs/health',         // Estado de documentación
                info: '/api/docs/info'              // Información detallada
            },
            endpoints: {
                clients: {
                    path: '/api',
                    description: 'Gestión de clientes WhatsApp',
                    operations: ['qr', 'status', 'add', 'remove', 'list']
                },
                messaging: {
                    path: '/api',
                    description: 'Envío de mensajes y comunicación',
                    operations: ['send', 'group', 'reply', 'forward', 'delete']
                },
                contacts: {
                    path: '/api',
                    description: 'Administración de contactos',
                    operations: ['list', 'save', 'search']
                },
                media: {
                    path: '/api',
                    description: 'Gestión de archivos multimedia',
                    operations: ['image', 'file', 'sticker', 'document']
                },
                chats: {
                    path: '/api',
                    description: 'Gestión de conversaciones',
                    operations: ['list', 'messages', 'read', 'unread']
                }
            },
            system: {
                health: '/health',
                metrics: '/metrics',
                status: 'operational',
                environment: process.env.NODE_ENV || 'development'
            },
            support: {
                documentation: 'Visite /api/docs para documentación interactiva completa',
                examples: 'Cada endpoint incluye ejemplos de uso en la documentación',
                troubleshooting: 'Consulte /api/docs/health para diagnóstico de problemas'
            },
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });

    // Manejar rutas no encontradas
    apiRouter.use('*', notFoundHandler);

    return apiRouter;
};

/**
 * Inicializa las rutas en una aplicación Express
 * @param {Express.Application} app - Aplicación Express
 * @param {string} basePath - Ruta base para la API (por defecto: '/api')
 */
const initializeRoutes = (app, basePath = '/api') => {
    const apiRouter = createApiRouter();
    app.use(basePath, apiRouter);
    
    logger.info(`API routes initialized on ${basePath}`);
    return app;
};

// Para compatibilidad con el código existente
const router = createApiRouter();

module.exports = {
    router,
    createApiRouter,
    initializeRoutes,
    // Exportar el router por defecto para mantener compatibilidad
    default: router
};