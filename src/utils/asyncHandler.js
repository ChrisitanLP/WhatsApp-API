// utils/asyncHandler.js
const logger = require('../conf/logger');

const asyncHandler = (fn) => async (req, res, next) => {
    try {
        await fn(req, res, next);
    } catch (error) {
        logger.error(`Error in async handler: ${error.name} - ${error.message}`, { stack: error.stack });

        const errorResponses = {
            ValidationError: { status: 400, message: error.message },
            NotFoundError: { status: 404, message: error.message }
        };

        const { status, message } = errorResponses[error.name] || { status: 500, message: 'Internal server error' };
        res.status(status).json({ success: false, message });
    }
};

class AppError extends Error {
    constructor(name, message, statusCode) {
        super(message);
        this.name = name;
        this.statusCode = statusCode;
    }
}

module.exports = {
    asyncHandler,
    ValidationError: class extends AppError {
        constructor(message) {
            super('ValidationError', message, 400);
        }
    },
    NotFoundError: class extends AppError {
        constructor(message) {
            super('NotFoundError', message, 404);
        }
    }
};