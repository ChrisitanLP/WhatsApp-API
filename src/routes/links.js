const express = require('express');
const router = express.Router();
const controller = require('../controllers/controllers');
const { validateRequest } = require('../middleware/validation');
const { asyncHandler } = require('../utils/asyncHandler');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { logger } = require('../config/logger');

// Configuración de seguridad
router.use(helmet());

// Limiter configurations
const apiLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30 minutos
    max: 500, // límite por IP
    message: 'Too many requests from this IP, please try again later.'
});

// CORS configuration
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.ALLOWED_ORIGINS?.split(',') || '*'
        : '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'ngrok-skip-browser-warning',
        'User-Agent'
    ],
    credentials: true,
    maxAge: 86400 // 24 horas
};

router.use(cors(corsOptions));
router.use(apiLimiter);

// Route groups for better organization
const routes = {
    clients: [
        { 
            path: '/qr/:number', 
            method: 'get', 
            handler: 'getQrCode',
            rateLimit: { 
                windowMs: 60000, 
                max: 5 
            } 
        },
        { 
            path: '/status_connection/:number', 
            method: 'get', 
            handler: 'getConnectionStatus',
            rateLimit: { 
                windowMs: 60000, 
                max: 10 
            } 
        },
        { 
            path: '/addClient', 
            method: 'post', 
            handler: 'addClient',
            rateLimit: { 
                windowMs: 60000, 
                max: 5 
            } 
        },
        { 
            path: '/status/:number', 
            method: 'get', 
            handler: 'getClientStatus',
            rateLimit: { 
                windowMs: 60000, 
                max: 5 
            } 
        },
        { 
            path: '/removeClient', 
            method: 'post', 
            handler: 'removeClient',
            rateLimit: { 
                windowMs: 60000, 
                max: 5 
            }  
        }
    ],
    messaging: [
        { 
            path: '/sendMessage', 
            method: 'post', 
            handler: 'sendMessage',
            rateLimit: { 
                windowMs: 60000, 
                max: 30 
            }
        },
        { 
            path: '/sendGroupMessage', 
            method: 'post', 
            handler: 'sendGroupMessage',
            rateLimit: { 
                windowMs: 60000, 
                max: 30 
            } 
        },
        { 
            path: '/sendMention', 
            method: 'post', 
            handler: 'sendMessageWithMention' 
        }
    ],
    mediaMessages: [
        { 
            path: '/sendMessageorFile', 
            method: 'post', 
            handler: 'sendMessageOrFile' 
        },
        { 
            path: '/sendSticker', 
            method: 'post', 
            handler: 'sendSticker' 
        },
        { 
            path: '/sendImage', 
            method: 'post', 
            handler: 'sendImage' 
        },
        { 
            path: '/sendMessageProducts', 
            method: 'post', 
            handler: 'sendMessageProduct' 
        },
        { 
            path: '/sendGroupProducts', 
            method: 'post', 
            handler: 'sendMessageProductGroup' 
        }
    ],
    chats: [
        { 
            path: '/chats', 
            method: 'get', 
            handler: 'getChats' 
        },
        { 
            path: '/unreadChats', 
            method: 'get', 
            handler: 'getUnreadChats' 
        },
        { 
            path: '/markChatRead/:clientId/:tel/:isGroup', 
            method: 'post', 
            handler: 'markChatAsRead' 
        },
        { 
            path: '/markChatAsUnread', 
            method: 'post', 
            handler: 'markChatAsUnread' 
        },
        { 
            path: '/pinChat', 
            method: 'post', 
            handler: 'pinChat' 
        },
        { 
            path: '/unpinChat', 
            method: 'post', 
            handler: 'unpinChat' 
        },
        { 
            path: '/muteChat', 
            method: 'post', 
            handler: 'muteChat' 
        }
    ],
    contacts: [
        { 
            path: '/getContacts', 
            method: 'get', 
            handler: 'getContacts' 
        },
        { 
            path: '/saveContact', 
            method: 'post', 
            handler: 'saveContact' 
        }
    ],
    messages: [
        { 
            path: '/chatMessages/:clientId/:tel', 
            method: 'get', 
            handler: 'getChatMessages' 
        },
        { 
            path: '/chatGroupMessages/:number/:groupId', 
            method: 'get', 
            handler: 'getGroupChatMessages' 
        },
        { 
            path: '/forwardMessage', 
            method: 'post', 
            handler: 'forwardMessage' 
        },
        { 
            path: '/replyMessage', 
            method: 'post', 
            handler: 'replyToMessage' 
        },
        { 
            path: '/getMessageInfo', 
            method: 'get', 
            handler: 'getMessageInfo' 
        },
        { 
            path: '/deleteMessage', 
            method: 'delete', 
            handler: 'deleteMessage' 
        },
        { 
            path: '/editMessage', 
            method: 'post', 
            handler: 'editMessage' 
        },
        { 
            path: '/markMessageImportant', 
            method: 'post', 
            handler: 'markMessageAsImportant' 
        },
        { 
            path: '/unmarkMessageImportant', 
            method: 'post', 
            handler: 'unmarkMessageAsImportant' 
        }
    ],
    account: [
        { 
            path: '/authenticated-accounts', 
            method: 'get', 
            handler: 'getAllAuthenticatedAccountsInfo' 
        }
    ]
};


// Middleware para manejar errores específicos
const errorHandler = (err, req, res, next) => {
    logger.error('API Error:', err);
    
    if (err.type === 'validation') {
        return res.status(400).json({
            status: 'error',
            message: 'Validation failed',
            errors: err.errors
        });
    }

    if (err.type === 'auth') {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication failed'
        });
    }

    res.status(500).json({
        status: 'error',
        message: 'Internal server error'
    });
};

// Register routes dynamically
Object.entries(routes).forEach(([group, routeConfigs]) => {
    routeConfigs.forEach(({ path, method, handler, rateLimit: routeLimit }) => {
        if (typeof controller[handler] !== "function") {
            logger.error(`Handler '${handler}' not found in controller`);
            return;
        }

        const middlewares = [validateRequest(handler)];

        // Add route-specific rate limiter if configured
        if (routeLimit) {
            middlewares.push(rateLimit(routeLimit));
        }

        router[method](
            path,
            ...middlewares,
            asyncHandler(controller[handler])
        );
    });
});

router.use(errorHandler);

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;