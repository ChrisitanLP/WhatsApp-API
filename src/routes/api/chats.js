// routes/api/messaging.js - Rutas de mensajería
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/chatController');
const { ValidationMiddleware, ValidationRules } = require('../../middleware/rules');
const { chatRateLimit } = require('../../middleware/core/rateLimiting');
const { asyncHandler } = require('../../utils/asyncHandler');

// Rate limiting para mensajería
router.use(chatRateLimit);

// Envío de mensajes
router.post(
    '/chats', 
    ValidationMiddleware.validate(ValidationRules.chats.list),
    asyncHandler(controller.getChats)
);

router.post(
    '/unreadChats', 
    ValidationMiddleware.validate(ValidationRules.chats.unread),
    asyncHandler(controller.getUnreadChats)
);

router.post(
    '/markChatRead/:clientId/:tel/:isGroup', 
    ValidationMiddleware.validate(ValidationRules.chats.markRead),
    asyncHandler(controller.markChatAsRead)
);

router.post(
    '/markChatAsUnread', 
    ValidationMiddleware.validate(ValidationRules.chats.markUnread),
    asyncHandler(controller.markChatAsUnread)
);

router.post(
    '/pinChat', 
    ValidationMiddleware.validate(ValidationRules.chats.pin),
    asyncHandler(controller.pinChat)
);

router.post(
    '/unpinChat', 
    ValidationMiddleware.validate(ValidationRules.chats.unpin),
    asyncHandler(controller.unpinChat)
);

router.post(
    '/muteChat', 
    ValidationMiddleware.validate(ValidationRules.chats.mute),
    asyncHandler(controller.muteChat)
);

router.post(
    '/chatMessages/:clientId/:tel', 
    ValidationMiddleware.validate(ValidationRules.chats.getMessages),
    asyncHandler(controller.getChatMessages)
);

router.post(
    '/chatGroupMessages/:number/:groupId', 
    ValidationMiddleware.validate(ValidationRules.chats.getGroupMessages),
    asyncHandler(controller.getGroupChatMessages)
);

module.exports = router;