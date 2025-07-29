const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

/**
 * Configura middleware de seguridad para las rutas
 * @param {Express.Router} router - Router de Express
 */
const setupSecurity = (router) => {
    // Configuración de seguridad con Helmet
    router.use(helmet({
        contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
        crossOriginEmbedderPolicy: false
    }));

    // Configuración de CORS
    const corsOptions = {
        origin: process.env.NODE_ENV === 'production' 
            ? process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
            : true,
        methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'ngrok-skip-browser-warning',
            'User-Agent',
            'X-Requested-With'
        ],
        credentials: true,
        maxAge: 86400 // 24 horas
    };

    router.use(cors(corsOptions));

    // Rate limiter global
    const globalLimiter = rateLimit({
        windowMs: 30 * 60 * 1000, // 30 minutos
        max: 500, // límite por IP
        message: {
            status: 'error',
            message: 'Too many requests from this IP, please try again later.',
            retryAfter: Math.ceil(30 * 60 * 1000 / 1000) // en segundos
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({
                status: 'error',
                message: 'Too many requests from this IP, please try again later.',
                retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
            });
        }
    });

    router.use(globalLimiter);
};

/**
 * Crea un rate limiter específico para una ruta
 * @param {Object} options - Opciones del rate limiter
 * @returns {Function} Middleware del rate limiter
 */
const createRouteLimiter = (options = {}) => {
    const defaultOptions = {
        windowMs: 60000, // 1 minuto
        max: 10,
        message: {
            status: 'error',
            message: 'Too many requests for this endpoint, please try again later.'
        },
        standardHeaders: true,
        legacyHeaders: false
    };

    return rateLimit({ ...defaultOptions, ...options });
};

module.exports = {
    setupSecurity,
    createRouteLimiter
};