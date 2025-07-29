const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// Import modularized controllers
const clientController = require('../controllers/clientController');
const chatController = require('../controllers/chatController');
const contactController = require('../controllers/contactController');
const mediaController = require('../controllers/mediaController');
const messageController = require('../controllers/messageController');

const { ValidationMiddleware } = require('../middleware/rules');
const { asyncHandler } = require('../utils/asyncHandler');
const { setupSecurity } = require('../middleware/core/security');
const { registerRoutes } = require('../middleware/core/routeRegistration');
const { errorHandler } = require('../middleware/core/errorHandler');
const { logger } = require('../config/logger');

// Middleware personalizado para logging de requests
const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    req.requestId = requestId;
    req.startTime = startTime;
    
    logger.info(`Incoming request: ${req.method} ${req.path}`, {
        requestId,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        query: req.query,
        body: req.method === 'POST' ? 'POST_DATA' : undefined
    });
    
    // Log response
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - startTime;
        logger.info(`Request completed: ${req.method} ${req.path}`, {
            requestId,
            statusCode: res.statusCode,
            duration: `${duration}ms`
        });
        originalSend.call(this, data);
    };
    
    next();
};

// Middleware para validar disponibilidad del servicio
const serviceAvailabilityCheck = async (req, res, next) => {
    try {
        // Verificar que al menos un controlador esté disponible
        if (!contactController) {
            return res.status(503).json({
                success: false,
                message: 'Service temporarily unavailable',
                error: 'Controllers not initialized'
            });
        }
        next();
    } catch (error) {
        logger.error('Service availability check failed:', error);
        res.status(503).json({
            success: false,
            message: 'Service health check failed',
            error: error.message
        });
    }
};

// Apply security middleware
setupSecurity(router);

// Apply general middleware
router.use(requestLogger);
router.use(serviceAvailabilityCheck);

// Rate limiting configurations
const createRateLimit = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message: {
        success: false,
        message: message || 'Too many requests',
        retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded: ${req.ip} on ${req.path}`, {
            requestId: req.requestId
        });
        res.status(429).json({
            success: false,
            message: 'Rate limit exceeded',
            retryAfter: Math.ceil(windowMs / 1000)
        });
    }
});

// Slow down middleware for gradual throttling
const createSlowDown = (windowMs, delayAfter, delayMs) => slowDown({
    windowMs,
    delayAfter,
    delayMs,
    maxDelayMs: delayMs * 10
});

// Route definitions with their respective controllers
const routeGroups = {
    clients: {
        controller: clientController,
        middleware: [
            createRateLimit(60000, 10, 'Too many client operations'),
            createSlowDown(60000, 5, 500)
        ],
        routes: [
            { 
                path: '/qr/:number', 
                method: 'get', 
                handler: 'getQrCode',
                rateLimit: createRateLimit(60000, 5, 'Too many QR requests'),
                timeout: 30000
            },
            { 
                path: '/status_connection/:number', 
                method: 'get', 
                handler: 'getConnectionStatus',
                rateLimit: createRateLimit(60000, 15, 'Too many status checks'),
                timeout: 10000
            },
            { 
                path: '/addClient', 
                method: 'post', 
                handler: 'addClient',
                rateLimit: createRateLimit(300000, 3, 'Too many client creation attempts'),
                timeout: 60000
            },
            { 
                path: '/status/:number', 
                method: 'get', 
                handler: 'getClientStatus',
                rateLimit: createRateLimit(60000, 10, 'Too many status requests'),
                timeout: 10000
            },
            { 
                path: '/removeClient', 
                method: 'post', 
                handler: 'removeClient',
                rateLimit: createRateLimit(300000, 3, 'Too many client removal attempts'),
                timeout: 30000
            },
            { 
                path: '/authenticated-accounts', 
                method: 'get', 
                handler: 'getAllAuthenticatedAccountsInfo',
                rateLimit: createRateLimit(60000, 20, 'Too many account info requests'),
                timeout: 15000
            }
        ]
    },
    messaging: {
        controller: messageController,
        middleware: [
            createRateLimit(60000, 50, 'Too many message operations'),
            createSlowDown(60000, 20, 200)
        ],
        routes: [
            { 
                path: '/sendMessage', 
                method: 'post', 
                handler: 'sendMessage',
                rateLimit: createRateLimit(60000, 30, 'Too many messages sent'),
                timeout: 20000
            },
            { 
                path: '/sendGroupMessage', 
                method: 'post', 
                handler: 'sendGroupMessage',
                rateLimit: createRateLimit(60000, 20, 'Too many group messages'),
                timeout: 25000
            },
            { 
                path: '/sendMention', 
                method: 'post', 
                handler: 'sendMessageWithMention',
                timeout: 20000
            },
            { 
                path: '/forwardMessage', 
                method: 'post', 
                handler: 'forwardMessage',
                timeout: 15000
            },
            { 
                path: '/replyMessage', 
                method: 'post', 
                handler: 'replyToMessage',
                timeout: 15000
            },
            { 
                path: '/getMessageInfo', 
                method: 'get', 
                handler: 'getMessageInfo',
                timeout: 10000
            },
            { 
                path: '/deleteMessage', 
                method: 'delete', 
                handler: 'deleteMessage',
                timeout: 10000
            },
            { 
                path: '/editMessage', 
                method: 'post', 
                handler: 'editMessage',
                timeout: 15000
            },
            { 
                path: '/markMessageImportant', 
                method: 'post', 
                handler: 'markMessageAsImportant',
                timeout: 10000
            },
            { 
                path: '/unmarkMessageImportant', 
                method: 'post', 
                handler: 'unmarkMessageAsImportant',
                timeout: 10000
            }
        ]
    },
    media: {
        controller: mediaController,
        middleware: [
            createRateLimit(60000, 20, 'Too many media operations'),
            createSlowDown(60000, 10, 1000)
        ],
        routes: [
            { 
                path: '/sendMessageorFile', 
                method: 'post', 
                handler: 'sendMessageOrFile',
                timeout: 60000 // Archivos pueden tomar más tiempo
            },
            { 
                path: '/sendSticker', 
                method: 'post', 
                handler: 'sendSticker',
                timeout: 30000
            },
            { 
                path: '/sendImage', 
                method: 'post', 
                handler: 'sendImage',
                timeout: 45000
            },
            { 
                path: '/sendMessageProducts', 
                method: 'post', 
                handler: 'sendMessageProduct',
                timeout: 25000
            },
            { 
                path: '/sendGroupProducts', 
                method: 'post', 
                handler: 'sendMessageProductGroup',
                timeout: 30000
            }
        ]
    },
    chats: {
        controller: chatController,
        middleware: [
            createRateLimit(60000, 40, 'Too many chat operations'),
            createSlowDown(60000, 20, 300)
        ],
        routes: [
            { 
                path: '/chats', 
                method: 'get', 
                handler: 'getChats',
                timeout: 30000
            },
            { 
                path: '/unreadChats', 
                method: 'get', 
                handler: 'getUnreadChats',
                timeout: 20000
            },
            { 
                path: '/chatMessages/:clientId/:tel', 
                method: 'get', 
                handler: 'getChatMessages',
                timeout: 25000
            },
            { 
                path: '/chatGroupMessages/:number/:groupId', 
                method: 'get', 
                handler: 'getGroupChatMessages',
                timeout: 25000
            },
            { 
                path: '/markChatRead/:clientId/:tel/:isGroup', 
                method: 'post', 
                handler: 'markChatAsRead',
                timeout: 10000
            },
            { 
                path: '/markChatAsUnread', 
                method: 'post', 
                handler: 'markChatAsUnread',
                timeout: 10000
            },
            { 
                path: '/pinChat', 
                method: 'post', 
                handler: 'pinChat',
                timeout: 10000
            },
            { 
                path: '/unpinChat', 
                method: 'post', 
                handler: 'unpinChat',
                timeout: 10000
            },
            { 
                path: '/muteChat', 
                method: 'post', 
                handler: 'muteChat',
                timeout: 10000
            }
        ]
    },
    contacts: {
        controller: contactController,
        middleware: [
            createRateLimit(60000, 30, 'Too many contact operations'),
            createSlowDown(60000, 15, 200)
        ],
        routes: [
            { 
                path: '/getContacts', 
                method: 'get', 
                handler: 'getContacts',
                timeout: 30000
            },
            { 
                path: '/saveContact', 
                method: 'post', 
                handler: 'saveContact',
                timeout: 20000
            }
        ]
    }
};

// Enhanced route registration with timeout handling
const registerRoutesWithEnhancements = (router, routeGroups, options) => {
    const { ValidationMiddleware, asyncHandler } = options;
    
    Object.entries(routeGroups).forEach(([groupName, group]) => {
        const { controller, routes, middleware: groupMiddleware = [] } = group;
        
        // Apply group-level middleware
        if (groupMiddleware.length > 0) {
            routes.forEach(route => {
                const fullPath = route.path;
                groupMiddleware.forEach(mw => {
                    router.use(fullPath, mw);
                });
            });
        }
        
        routes.forEach(route => {
            const { path, method, handler, rateLimit: routeRateLimit, timeout } = route;
            const middlewares = [];
            
            // Add route-specific rate limiting
            if (routeRateLimit) {
                middlewares.push(routeRateLimit);
            }
            
            // Add timeout middleware if specified
            if (timeout) {
                middlewares.push((req, res, next) => {
                    req.setTimeout(timeout, () => {
                        if (!res.headersSent) {
                            logger.error(`Request timeout: ${req.method} ${req.path}`, {
                                requestId: req.requestId,
                                timeout
                            });
                            res.status(408).json({
                                success: false,
                                message: 'Request timeout',
                                requestId: req.requestId
                            });
                        }
                    });
                    next();
                });
            }
            
            // Add validation if exists
            if (ValidationMiddleware && ValidationMiddleware[handler]) {
                middlewares.push(ValidationMiddleware[handler]);
            }
            
            // Add the actual handler
            middlewares.push(asyncHandler(controller[handler]));
            
            // Register the route
            router[method](path, ...middlewares);
            
            logger.debug(`Registered route: ${method.toUpperCase()} ${path} -> ${handler}`, {
                group: groupName,
                timeout,
                hasRateLimit: !!routeRateLimit
            });
        });
    });
};

// Register all routes with enhancements
registerRoutesWithEnhancements(router, routeGroups, { ValidationMiddleware, asyncHandler });

// Metrics endpoint
router.get('/metrics', asyncHandler(async (req, res) => {
    try {
        const metrics = {
            contacts: await contactController.getMetrics(req, res),
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            environment: process.env.NODE_ENV
        };
        
        // Return raw metrics for monitoring systems
        res.json(metrics);
    } catch (error) {
        logger.error('Error getting system metrics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve metrics',
            error: error.message
        });
    }
}));

// Apply error handling middleware
router.use(errorHandler);

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: process.env.API_VERSION || '1.0.0'
    });
});

module.exports = router;