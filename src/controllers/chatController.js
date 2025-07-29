// src/controllers/ChatController.js
const ChatService = require('../services/api/chatService');
const { asyncHandler } = require('../utils/asyncHandler');
const ResponseHelper = require('../utils/responseHelper');
const { ChatValidators } = require('../utils/validators');
const { logger } = require('../config/logger');
const { MESSAGES } = require('../utils/constants');

class ChatController {
    constructor() {
        this.whatsappService = new ChatService();
    }

    /**
     * Get chats with pagination
     */
    getChats = asyncHandler(async (req, res) => {
        const { page, limit } = ChatValidators.pagination(req.query);
        const { chats, totalUnreadChats, totalPages } = await this.whatsappService.fetchChats(page, limit);
        logger.info(`Chats recuperados - Página: ${page}, Límite: ${limit}`);

        return ResponseHelper.paginated(
            res,
            { chats, totalUnreadChats },
            { currentPage: page, totalPages }
        );
    });

    /**
     * Get unread chats with pagination
     */
    getUnreadChats = asyncHandler(async (req, res) => {
        const { page, limit } = ChatValidators.pagination(req.query);
        const { chats, totalUnreadChats, totalPages } = await this.whatsappService.fetchUnreadChats(page, limit);
        logger.info(`Chats no leídos recuperados - Página: ${page}, Total: ${totalUnreadChats}`);

        return ResponseHelper.paginated(
            res,
            { unreadChats: chats, totalUnreadChats },
            { currentPage: page, totalPages }
        );
    });

    /**
     * Mark chat as read
     */
    markChatAsRead = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat(req.params);
        await this.whatsappService.markChatRead(clientId, tel, isGroup);
        logger.info(`Chat marcado como leído - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.CHAT_MARKED_READ);
    });

    /**
     * Mark chat as unread
     */
    markChatAsUnread = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat({}, req.body);
        await this.whatsappService.markChatUnread(clientId, tel, isGroup);
        logger.info(`Chat marcado como no leído - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.CHAT_MARKED_UNREAD);
    });

    /**
     * Mute chat
     */
    muteChat = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup, unmuteDate } = req.body;
        const validatedData = ChatValidators.markChat({}, req.body);
        await this.whatsappService.muteChat({
            clientId: validatedData.clientId,
            tel: validatedData.tel,
            isGroup: validatedData.isGroup,
            unmuteDate
        });
        logger.info(`Chat silenciado - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.CHAT_MUTED);
    });

    /**
     * Pin chat
    */
    pinChat = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat({}, req.body);
        await this.whatsappService.pinChat({ clientId, tel, isGroup });
    
        logger.info(`Chat fijado - Cliente: ${clientId}, Tel: ${tel}`);
        return ResponseHelper.success(res, { pinned: true });
    });

    /**
     * Unpin chat
     */
    unpinChat = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat({}, req.body);
        await this.whatsappService.unpinChat({ clientId, tel, isGroup });
    
        logger.info(`Chat desfijado - Cliente: ${clientId}, Tel: ${tel}`);
        return ResponseHelper.success(res, { unpinned: true });
    });

    /**
     * Get chat messages
     */
    getChatMessages = asyncHandler(async (req, res) => {
        const { clientId, tel } = ChatValidators.getChatMessages(req.params);
        const messages = await this.whatsappService.getChatMessages(clientId, tel);
        logger.info(`Mensajes del chat recuperados - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, { messages });
    });

    /**
     * Get group chat messages
     */
    getGroupChatMessages = asyncHandler(async (req, res) => {
        const { number, groupId } = req.params;
        // Usar validación básica para este endpoint específico
        if (!number || !groupId) {
            return ResponseHelper.badRequest(res, 'Number and Group ID are required');
        }
        const messages = await this.whatsappService.getGroupChatMessages(number, groupId);
        logger.info(`Mensajes del grupo recuperados - Número: ${number}, Grupo: ${groupId}`);

        return ResponseHelper.success(res, { messages });
    });
}

module.exports = new ChatController();