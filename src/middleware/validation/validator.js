// middleware/validation/validators.js
const { param, body, query } = require('express-validator');

/**
 * Validadores reutilizables y configurables
 */
class Validators {
    // Validadores básicos
    static required(field, message = 'Campo obligatorio') {
        return body(field).notEmpty().withMessage(message);
    }

    static string(field, options = {}) {
        const validator = body(field).isString().withMessage('Debe ser texto');
        
        if (options.min || options.max) {
            validator.isLength(options).withMessage(
                `Longitud debe estar entre ${options.min || 0} y ${options.max || 'infinito'} caracteres`
            );
        }
        
        return validator;
    }

    static phoneNumber(field = 'phoneNumber') {
        return body(field)
            .trim()
            .notEmpty().withMessage('Número de teléfono requerido')
            .isString().withMessage('Debe ser texto')
            .matches(/^\d{10,15}$/).withMessage('Formato de teléfono inválido');
    }

    static clientId(field = 'clientId') {
        return body(field)
            .trim()
            .notEmpty().withMessage('ID de cliente requerido')
            .isString().withMessage('Debe ser texto');
    }

    static boolean(field, defaultValue = false) {
        return body(field)
            .optional({ checkFalsy: true })
            .isBoolean().withMessage('Debe ser booleano')
            .customSanitizer(value => value !== undefined ? value : defaultValue);
    }

    static base64Media(field) {
        return body(field)
            .notEmpty().withMessage('Contenido requerido')
            .matches(/^data:([A-Za-z-+/]+);base64,(.+)$/)
            .withMessage('Formato Base64 inválido');
    }

    // Validadores específicos del dominio
    static message(field = 'message', maxLength = 4096) {
        return body(field)
            .trim()
            .notEmpty().withMessage('Mensaje requerido')
            .isLength({ max: maxLength }).withMessage(`Mensaje muy largo (máximo ${maxLength} caracteres)`);
    }

    static chatId(field = 'chatId') {
        return body(field)
            .trim()
            .notEmpty().withMessage('ID de chat requerido')
            .isString().withMessage('Debe ser texto');
    }

    static groupId(field = 'groupId') {
        return body(field)
            .trim()
            .notEmpty().withMessage('ID de grupo requerido')
            .isString().withMessage('Debe ser texto');
    }

    static messageId(field = 'messageId') {
        return body(field)
            .trim()
            .notEmpty().withMessage('ID de mensaje requerido')
            .isString().withMessage('Debe ser texto');
    }

    // Validadores para parámetros de URL
    static paramPhoneNumber(field = 'number') {
        return param(field)
            .trim()
            .notEmpty().withMessage('Número requerido')
            .matches(/^\d{10,15}$/).withMessage('Formato de número inválido');
    }

    static paramClientId(field = 'clientId') {
        return param(field)
            .trim()
            .notEmpty().withMessage('ID de cliente requerido');
    }

    static paramBoolean(field = 'isGroup') {
        return param(field)
            .isBoolean().withMessage('Debe ser booleano')
            .toBoolean();
    }

    // Validadores para query parameters
    static pagination() {
        return [
            query('page')
                .optional()
                .isInt({ min: 1 }).withMessage('Página debe ser >= 1')
                .toInt(),
            query('limit')
                .optional()
                .isInt({ min: 1, max: 100 }).withMessage('Límite entre 1 y 100')
                .toInt()
        ];
    }

    static dateRange() {
        return [
            query('startDate')
                .optional()
                .isISO8601().withMessage('Fecha de inicio inválida'),
            query('endDate')
                .optional()
                .isISO8601().withMessage('Fecha de fin inválida')
        ];
    }

    // Validadores adicionales del código original
    static optionalString(field) {
        return body(field)
            .optional()
            .isString().withMessage('Debe ser texto');
    }

    static isoDate(field) {
        return body(field)
            .optional()
            .isISO8601().withMessage('Debe ser una fecha válida');
    }

    static fileName(field = 'fileName') {
        return body(field)
            .optional()
            .isString().withMessage('Nombre de archivo debe ser texto');
    }

    static filePath(field = 'filePath') {
        return body(field)
            .optional()
            .isString().withMessage('Ruta de archivo debe ser texto');
    }

    static fileContent(field = 'fileContent') {
        return body(field)
            .optional()
            .matches(/^data:([A-Za-z-+/]+);base64,(.+)$/)
            .withMessage('Formato Base64 inválido');
    }

    static contactName(field = 'contactName') {
        return body(field)
            .trim()
            .notEmpty().withMessage('Nombre de contacto requerido')
            .isLength({ min: 2, max: 50 }).withMessage('Longitud debe estar entre 2 y 50 caracteres');
    }
}

module.exports = { Validators };