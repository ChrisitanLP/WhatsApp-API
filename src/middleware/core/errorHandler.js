const { logger } = require('../../config/logger');

/**
 * Middleware para manejar errores específicos de las rutas
 * @param {Error} err - Error capturado
 * @param {Request} req - Objeto request de Express
 * @param {Response} res - Objeto response de Express
 * @param {Function} next - Función next de Express
 */
const errorHandler = (err, req, res, next) => {
    // Log del error con contexto
    logger.error('API Error:', {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });

    // Error de validación
    if (err.type === 'validation' || err.name === 'ValidationError') {
        return res.status(400).json({
            status: 'error',
            message: 'Validation failed',
            errors: err.errors || [{ message: err.message }],
            timestamp: new Date().toISOString()
        });
    }

    // Error de autenticación
    if (err.type === 'auth' || err.name === 'UnauthorizedError') {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication failed',
            timestamp: new Date().toISOString()
        });
    }

    // Error de autorización
    if (err.type === 'forbidden' || err.status === 403) {
        return res.status(403).json({
            status: 'error',
            message: 'Access forbidden',
            timestamp: new Date().toISOString()
        });
    }

    // Error de recurso no encontrado
    if (err.type === 'not_found' || err.status === 404) {
        return res.status(404).json({
            status: 'error',
            message: 'Resource not found',
            timestamp: new Date().toISOString()
        });
    }

    // Error de rate limit (aunque normalmente es manejado por express-rate-limit)
    if (err.type === 'rate_limit' || err.status === 429) {
        return res.status(429).json({
            status: 'error',
            message: 'Too many requests',
            retryAfter: err.retryAfter || 60,
            timestamp: new Date().toISOString()
        });
    }

    // Error de timeout
    if (err.type === 'timeout' || err.code === 'TIMEOUT') {
        return res.status(408).json({
            status: 'error',
            message: 'Request timeout',
            timestamp: new Date().toISOString()
        });
    }

    // Error de cliente (WhatsApp client no disponible, etc.)
    if (err.type === 'client_error') {
        return res.status(503).json({
            status: 'error',
            message: err.message || 'Service temporarily unavailable',
            code: err.code,
            timestamp: new Date().toISOString()
        });
    }

    // Error de sintaxis JSON
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid JSON format',
            timestamp: new Date().toISOString()
        });
    }

    // Error genérico del servidor
    const statusCode = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message;

    res.status(statusCode).json({
        status: 'error',
        message,
        ...(process.env.NODE_ENV !== 'production' && { 
            stack: err.stack,
            details: err.details 
        }),
        timestamp: new Date().toISOString()
    });
};

/**
 * Middleware para manejar rutas no encontradas (404)
 */
const notFoundHandler = (req, res) => {
    logger.warn(`Route not found: ${req.method} ${req.originalUrl}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    res.status(404).json({
        status: 'error',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
    });
};

/**
 * Crea un wrapper para capturar errores asíncronos
 * @param {Function} fn - Función asíncrona a envolver
 * @returns {Function} Función envuelta que captura errores
 */
const asyncErrorHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncErrorHandler
};