const express = require('express');
const linksRouter = require('./link');
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
        logger.info(`${req.method} ${req.originalUrl}`, {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        });
        next();
    });

    // Registrar rutas principales
    apiRouter.use('/', linksRouter);

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