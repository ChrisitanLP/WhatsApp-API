const { createRouteLimiter } = require('../../middleware/core/security');
const { logger } = require('../../config/logger');

/**
 * Registra rutas dinámicamente basado en la configuración
 * @param {Express.Router} router - Router de Express
 * @param {Object} routeGroups - Grupos de rutas organizadas
 * @param {Object} middleware - Middleware disponible
 */
const registerRoutes = (router, routeGroups, middleware) => {
    const { ValidationMiddleware, asyncHandler } = middleware;

    Object.entries(routeGroups).forEach(([groupName, { controller, routes }]) => {
        logger.info(`Registering route group: ${groupName}`);

        routes.forEach(({ path, method, handler, rateLimit: routeLimit, validation }) => {
            try {
                // Verificar que el handler existe en el controlador
                if (typeof controller[handler] !== "function") {
                    logger.error(`Handler '${handler}' not found in ${groupName} controller`);
                    return;
                }

                // Construir middlewares
                const middlewares = [];

                // Agregar validación si está configurada
                if (validation !== false) {
                    const validationRules = getValidationRules(groupName, handler);
                    if (validationRules) {
                        middlewares.push(ValidationMiddleware.validate(validationRules));
                    }
                }

                // Agregar rate limiter específico si está configurado
                if (routeLimit) {
                    middlewares.push(createRouteLimiter(routeLimit));
                }

                // Registrar la ruta
                router[method.toLowerCase()](
                    path,
                    ...middlewares,
                    asyncHandler(controller[handler])
                );

                logger.debug(`Route registered: ${method.toUpperCase()} ${path} -> ${groupName}.${handler}`);

            } catch (error) {
                logger.error(`Error registering route ${method} ${path}:`, error);
            }
        });
    });
};

/**
 * Obtiene las reglas de validación para un handler específico
 * @param {string} groupName - Nombre del grupo
 * @param {string} handler - Nombre del handler
 * @returns {Array|null} Reglas de validación o null
 */
const getValidationRules = (groupName, handler) => {
    try {
        const { ValidationRules } = require('../rules');
        return ValidationRules[groupName]?.[handler] || null;
    } catch (error) {
        logger.warn(`No validation rules found for ${groupName}.${handler}`);
        return null;
    }
};

/**
 * Registra un grupo específico de rutas
 * @param {Express.Router} router - Router de Express
 * @param {string} groupName - Nombre del grupo
 * @param {Object} routeConfig - Configuración del grupo de rutas
 * @param {Object} middleware - Middleware disponible
 */
const registerRouteGroup = (router, groupName, routeConfig, middleware) => {
    const routeGroups = { [groupName]: routeConfig };
    registerRoutes(router, routeGroups, middleware);
};

/**
 * Crea un middleware de validación condicional
 * @param {Function} ValidationMiddleware - Clase de validación
 * @param {string} handler - Nombre del handler
 * @param {boolean} skipValidation - Si omitir la validación
 * @returns {Function|null} Middleware de validación o null
 */
const createValidationMiddleware = (ValidationMiddleware, handler, skipValidation = false) => {
    if (skipValidation) {
        return null;
    }
    // Aquí deberías obtener las reglas específicas para el handler
    return ValidationMiddleware.validate([]);
};

/**
 * Registra rutas de salud y estado del sistema
 * @param {Express.Router} router - Router de Express
 */
const registerHealthRoutes = (router) => {
    // Health check básico
    router.get('/health', (req, res) => {
        res.status(200).json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: process.env.API_VERSION || '1.0.0'
        });
    });

    // Health check detallado
    router.get('/health/detailed', (req, res) => {
        const healthInfo = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: process.env.API_VERSION || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            memory: process.memoryUsage(),
            pid: process.pid
        };

        res.status(200).json(healthInfo);
    });

    logger.info('Health check routes registered');
};

module.exports = {
    registerRoutes,
    registerRouteGroup,
    createValidationMiddleware,
    registerHealthRoutes
};