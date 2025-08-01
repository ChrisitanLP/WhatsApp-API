/**
 * @swagger
 * components:
 *   schemas:
 *     ChatMessage:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: ID único del mensaje
 *         from:
 *           type: string
 *           description: Remitente del mensaje
 *         content:
 *           type: string
 *           description: Contenido del mensaje
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Marca de tiempo del mensaje
 *     Chat:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: ID único del chat
 *         name:
 *           type: string
 *           description: Nombre del chat o contacto
 *         unreadCount:
 *           type: integer
 *           description: Número de mensajes no leídos
 *         timestamp:
 *           type: integer
 *           description: Timestamp del último mensaje
 *         recentMessageDate:
 *           type: integer
 *           description: Fecha del mensaje más reciente
 *         profilePicUrl:
 *           type: string
 *           description: URL de la foto de perfil
 *         groupData:
 *           type: array
 *           items:
 *             type: object
 *           description: Datos del grupo (si aplica)
 *         client:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *     PaginatedChatsResponse:
 *       type: object
 *       properties:
 *         chats:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Chat'
 *         totalUnreadChats:
 *           type: integer
 *           description: Total de chats no leídos
 *         currentPage:
 *           type: integer
 *           description: Página actual
 *         totalPages:
 *           type: integer
 *           description: Total de páginas
 *     PaginatedUnreadChatsResponse:
 *       type: object
 *       properties:
 *         unreadChats:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Chat'
 *         totalUnreadChats:
 *           type: integer
 *           description: Total de chats no leídos
 *         currentPage:
 *           type: integer
 *           description: Página actual
 *         totalPages:
 *           type: integer
 *           description: Total de páginas
 *     ChatActionRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - tel
 *         - isGroup
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat
 *         isGroup:
 *           type: boolean
 *           description: Indica si es un chat de grupo
 *     MuteChatRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/ChatActionRequest'
 *         - type: object
 *           properties:
 *             unmuteDate:
 *               type: string
 *               format: date-time
 *               description: Fecha para desactivar el silencio (opcional)
 */

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
     * @swagger
     * /api/chats:
     *   get:
     *     tags: [Chats]
     *     summary: Obtener chats con paginación
     *     operationId: getChats
     *     parameters:
     *       - name: page
     *         in: query
     *         schema:
     *           type: integer
     *           default: 1
     *         description: Número de página
     *       - name: limit
     *         in: query
     *         schema:
     *           type: integer
     *           default: 20
     *         description: Número de elementos por página
     *     responses:
     *       200:
     *         description: Lista paginada de chats obtenida exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedChatsResponse'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
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
     * @swagger
     * /api/unreadChats:
     *   get:
     *     tags: [Chats]
     *     summary: Obtener chats no leídos con paginación
     *     operationId: getUnreadChats
     *     parameters:
     *       - name: page
     *         in: query
     *         schema:
     *           type: integer
     *           default: 1
     *         description: Número de página
     *       - name: limit
     *         in: query
     *         schema:
     *           type: integer
     *           default: 20
     *         description: Número de elementos por página
     *     responses:
     *       200:
     *         description: Lista paginada de chats no leídos obtenida exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedUnreadChatsResponse'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
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
     * @swagger
     * /api/markChatRead/{clientId}/{tel}/{isGroup}:
     *   post:
     *     tags: [Chats]
     *     summary: Marcar chat como leído
     *     operationId: markChatAsRead
     *     parameters:
     *       - name: clientId
     *         in: path
     *         required: true
     *         schema:
     *           type: string
     *         description: ID del cliente de WhatsApp
     *       - name: tel
     *         in: path
     *         required: true
     *         schema:
     *           type: string
     *         description: Número de teléfono o ID del chat
     *       - name: isGroup
     *         in: path
     *         required: true
     *         schema:
     *           type: boolean
     *         description: Indica si es un chat de grupo
     *     responses:
     *       200:
     *         $ref: '#/components/responses/Success'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     */
    markChatAsRead = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat(req.params);
        await this.whatsappService.markChatRead(clientId, tel, isGroup);
        logger.info(`Chat marcado como leído - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.CHAT_MARKED_READ);
    });

    /**
     * @swagger
     * /api/markChatAsUnread:
     *   post:
     *     tags: [Chats]
     *     summary: Marcar chat como no leído
     *     operationId: markChatAsUnread
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ChatActionRequest'
     *     responses:
     *       200:
     *         $ref: '#/components/responses/Success'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     */
    markChatAsUnread = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat({}, req.body);
        await this.whatsappService.markChatUnread(clientId, tel, isGroup);
        logger.info(`Chat marcado como no leído - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.CHAT_MARKED_UNREAD);
    });

    /**
     * @swagger
     * /api/muteChat:
     *   post:
     *     tags: [Chats]
     *     summary: Silenciar chat
     *     operationId: muteChat
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/MuteChatRequest'
     *     responses:
     *       200:
     *         $ref: '#/components/responses/Success'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
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
     * @swagger
     * /api/pinChat:
     *   post:
     *     tags: [Chats]
     *     summary: Fijar chat
     *     operationId: pinChat
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ChatActionRequest'
     *     responses:
     *       200:
     *         description: Chat fijado exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 pinned:
     *                   type: boolean
     *                   example: true
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     */
    pinChat = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat({}, req.body);
        await this.whatsappService.pinChat({ clientId, tel, isGroup });
    
        logger.info(`Chat fijado - Cliente: ${clientId}, Tel: ${tel}`);
        return ResponseHelper.success(res, { pinned: true });
    });

    /**
     * @swagger
     * /api/unpinChat:
     *   post:
     *     tags: [Chats]
     *     summary: Desfijar chat
     *     operationId: unpinChat
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ChatActionRequest'
     *     responses:
     *       200:
     *         description: Chat desfijado exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 unpinned:
     *                   type: boolean
     *                   example: true
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     */
    unpinChat = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup } = ChatValidators.markChat({}, req.body);
        await this.whatsappService.unpinChat({ clientId, tel, isGroup });
    
        logger.info(`Chat desfijado - Cliente: ${clientId}, Tel: ${tel}`);
        return ResponseHelper.success(res, { unpinned: true });
    });

    /**
     * @swagger
     * /api/chatMessages/{clientId}/{tel}:
     *   get:
     *     tags: [Chats]
     *     summary: Obtener mensajes de un chat
     *     operationId: getChatMessages
     *     parameters:
     *       - name: clientId
     *         in: path
     *         required: true
     *         schema:
     *           type: string
     *         description: ID del cliente de WhatsApp
     *       - name: tel
     *         in: path
     *         required: true
     *         schema:
     *           type: string
     *         description: Número de teléfono o ID del chat
     *     responses:
     *       200:
     *         description: Mensajes del chat obtenidos exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 messages:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/ChatMessage'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     */
    getChatMessages = asyncHandler(async (req, res) => {
        const { clientId, tel } = ChatValidators.getChatMessages(req.params);
        const messages = await this.whatsappService.getChatMessages(clientId, tel);
        logger.info(`Mensajes del chat recuperados - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, { messages });
    });

    /**
     * @swagger
     * /api/chatGroupMessages/{number}/{groupId}:
     *   get:
     *     tags: [Chats]
     *     summary: Obtener mensajes de un grupo
     *     operationId: getGroupChatMessages
     *     parameters:
     *       - name: number
     *         in: path
     *         required: true
     *         schema:
     *           type: string
     *         description: Número del cliente de WhatsApp
     *       - name: groupId
     *         in: path
     *         required: true
     *         schema:
     *           type: string
     *         description: ID del grupo
     *     responses:
     *       200:
     *         description: Mensajes del grupo obtenidos exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 messages:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/ChatMessage'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
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