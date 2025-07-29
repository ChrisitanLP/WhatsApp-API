// src/utils/responseHelper.js
const { HTTP_STATUS } = require('./constants');

class ResponseHelper {
    /**
     * Respuesta exitosa estándar
     */
    static success(res, data = {}, message = null, statusCode = HTTP_STATUS.OK) {
        const response = { success: true };
        
        if (message) response.message = message;
        
        // Merge data into response
        Object.assign(response, data);
        
        return res.status(statusCode).json(response);
    }

    /**
     * Respuesta de error estándar
     */
    static error(res, message, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, details = null) {
        const response = {
            success: false,
            error: message
        };
        
        if (details) response.details = details;
        
        return res.status(statusCode).json(response);
    }

    /**
     * Respuesta con datos paginados
     */
    static paginated(res, data, pagination, message = null) {
        const response = {
            success: true,
            currentPage: pagination.currentPage,
            totalPages: pagination.totalPages,
            ...data
        };
        
        if (message) response.message = message;
        
        return res.status(HTTP_STATUS.OK).json(response);
    }

    /**
     * Respuesta para recursos creados
     */
    static created(res, message, data = {}) {
        return this.success(res, data, message, 201);
    }

    /**
     * Respuesta para recursos no encontrados
     */
    static notFound(res, message = 'Resource not found') {
        return this.error(res, message, HTTP_STATUS.NOT_FOUND);
    }

    /**
     * Respuesta para errores de validación
     */
    static badRequest(res, message = 'Invalid request data') {
        return this.error(res, message, HTTP_STATUS.BAD_REQUEST);
    }
}

module.exports = ResponseHelper;