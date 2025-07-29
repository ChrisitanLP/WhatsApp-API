// middleware/validation/sanitizers.js
/**
 * Sanitizadores para limpiar datos de entrada
 */
class Sanitizers {
    static sanitizeRequest(req, res, next) {
        // Sanitizar body
        if (req.body) {
            req.body = Sanitizers.sanitizeObject(req.body);
        }

        // Sanitizar query params
        if (req.query) {
            req.query = Sanitizers.sanitizeObject(req.query);
        }

        // Sanitizar params
        if (req.params) {
            req.params = Sanitizers.sanitizeObject(req.params);
        }

        next();
    }

    static sanitizeObject(obj) {
        const sanitized = {};
        
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                sanitized[key] = Sanitizers.sanitizeString(value);
            } else if (Array.isArray(value)) {
                sanitized[key] = value.map(item => 
                    typeof item === 'string' ? Sanitizers.sanitizeString(item) : item
                );
            } else if (value !== null && typeof value === 'object') {
                sanitized[key] = Sanitizers.sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }
        
        return sanitized;
    }

    static sanitizeString(str) {
        if (typeof str !== 'string') return str;
        
        return str
            .trim()
            .replace(/\s+/g, ' ') // Múltiples espacios a uno solo
            .substring(0, 10000); // Límite de seguridad
    }

    static sanitizePhoneNumber(phoneNumber) {
        return phoneNumber.replace(/[^\d]/g, '');
    }
}

module.exports = { Sanitizers };