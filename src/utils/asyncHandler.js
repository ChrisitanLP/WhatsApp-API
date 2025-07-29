// src/utils/asyncHandler.js (Mejorado)
const { logger } = require('../config/logger');
const ResponseHelper = require('./responseHelper');

const asyncHandler = (fn) => async (req, res, next) => {
    try {
        await fn(req, res, next);
    } catch (error) {
        // Log detallado del error
        logger.error(`Error in ${req.method} ${req.originalUrl}`, {
            error: error.message,
            stack: error.stack,
            userId: req.user?.id,
            body: req.body,
            params: req.params,
            query: req.query
        });

        // Manejo específico de tipos de error
        if (error instanceof ValidationError) {
            return ResponseHelper.badRequest(res, error.message);
        }
        
        if (error instanceof NotFoundError) {
            return ResponseHelper.notFound(res, error.message);
        }

        // Error genérico del servidor
        return ResponseHelper.error(res, 'Internal server error');
    }
};

class AppError extends Error {
    constructor(name, message, statusCode) {
        super(message);
        this.name = name;
        this.statusCode = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message) {
        super('ValidationError', message, 400);
    }
}

class NotFoundError extends AppError {
    constructor(message) {
        super('NotFoundError', message, 404);
    }
}

class ConflictError extends AppError {
    constructor(message) {
        super('ConflictError', message, 409);
    }
}

module.exports = {
    asyncHandler,
    ValidationError,
    NotFoundError,
    ConflictError,
    AppError
};