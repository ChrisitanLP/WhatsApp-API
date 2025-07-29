// middleware/validation/middleware.js
const { validationResult } = require('express-validator');
const { logger } = require('../../config/logger');
const { Sanitizers } = require('./sanitizers');

/**
 * Middleware principal de validación
 */
class ValidationMiddleware {
    static validate(validationRules) {
        return async (req, res, next) => {
            try {
                // Aplicar sanitización primero
                Sanitizers.sanitizeRequest(req, res, () => {});

                // Ejecutar validaciones
                if (validationRules && validationRules.length > 0) {
                    await Promise.all(
                        validationRules.map(rule => rule.run(req))
                    );
                }

                // Verificar errores
                const errors = validationResult(req);
                if (!errors.isEmpty()) {
                    return ValidationMiddleware.handleValidationErrors(req, res, errors);
                }

                next();
            } catch (error) {
                logger.error('Validation middleware error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error interno en validación'
                });
            }
        };
    }

    static handleValidationErrors(req, res, errors) {
        const formattedErrors = errors.array().map(err => ({
            field: err.param,
            message: err.msg,
            value: err.value,
            location: err.location
        }));

        logger.warn('Validation failed:', {
            url: req.url,
            method: req.method,
            errors: formattedErrors,
            body: req.body
        });

        res.status(400).json({
            success: false,
            message: 'Datos de entrada inválidos',
            errors: formattedErrors
        });
    }

    // Factory para crear validaciones específicas
    static createValidator(routeName, rules) {
        return ValidationMiddleware.validate(rules);
    }
}

module.exports = { ValidationMiddleware };
