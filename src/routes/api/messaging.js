// routes/api/messaging.js - Rutas de mensajería
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/messageController');
const { ValidationMiddleware, ValidationRules } = require('../../middleware/rules');
const { messagingRateLimit } = require('../../middleware/core/rateLimiting');
const { validateClientId } = require('../../middleware/core/security');
const { asyncHandler } = require('../../utils/asyncHandler');

// Rate limiting para mensajería
router.use(messagingRateLimit);

// Envío de mensajes
router.post(
    '/sendMessage', 
    ValidationMiddleware.validate(ValidationRules.messaging.send),
    validateClientId,
    asyncHandler(controller.sendMessage)
);

router.post(
    '/sendGroupMessage', 
    ValidationMiddleware.validate(ValidationRules.messaging.sendGroup),
    validateClientId,
    asyncHandler(controller.sendGroupMessage)
);

router.post(
    '/replyMessage', 
    ValidationMiddleware.validate(ValidationRules.messaging.reply),
    validateClientId,
    asyncHandler(controller.replyToMessage)
);

router.post(
    '/forwardMessage', 
    ValidationMiddleware.validate(ValidationRules.messaging.forward),
    validateClientId,
    asyncHandler(controller.forwardMessage)
);

router.post(
    '/deleteMessage', 
    ValidationMiddleware.validate(ValidationRules.messaging.delete),
    validateClientId,
    asyncHandler(controller.deleteMessage)
);

router.post(
    '/markMessageImportant', 
    ValidationMiddleware.validate(ValidationRules.messaging.markImportant),
    validateClientId,
    asyncHandler(controller.markMessageAsImportant)
);

router.post(
    '/unmarkMessageImportant', 
    ValidationMiddleware.validate(ValidationRules.messaging.unmarkImportant),
    validateClientId,
    asyncHandler(controller.unmarkMessageAsImportant)
);

router.post(
    '/editMessage', 
    ValidationMiddleware.validate(ValidationRules.messaging.edit),
    validateClientId,
    asyncHandler(controller.editMessage)
);

router.post(
    '/getMessageInfo',
    ValidationMiddleware.validate(ValidationRules.messaging.getMessageInfo),
    asyncHandler(controller.getMessageInfo)
);

router.post(
    '/sendMention', 
    ValidationMiddleware.validate(ValidationRules.messaging.sendWithMention),
    asyncHandler(controller.sendMessageWithMention)
);

module.exports = router;