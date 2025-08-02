/**
 * @swagger
 * components:
 *   schemas:
 *     MessageActionRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - tel
 *         - messageId
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat
 *         messageId:
 *           type: string
 *           description: ID del mensaje
 *         isGroup:
 *           type: boolean
 *           default: false
 *           description: Indica si es un chat de grupo
 *     DeleteMessageRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/MessageActionRequest'
 *         - type: object
 *           properties:
 *             forEveryone:
 *               type: boolean
 *               default: false
 *               description: Eliminar para todos
 *     ForwardMessageRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - fromTel
 *         - toTel
 *         - messageId
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         fromTel:
 *           type: string
 *           description: Número de origen del mensaje
 *         toTel:
 *           type: string
 *           description: Número de destino del mensaje
 *         messageId:
 *           type: string
 *           description: ID del mensaje a reenviar
 *         isGroupFrom:
 *           type: boolean
 *           default: false
 *           description: Si el origen es un grupo
 *         isGroupTo:
 *           type: boolean
 *           default: false
 *           description: Si el destino es un grupo
 *     EditMessageRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/MessageActionRequest'
 *         - type: object
 *           required:
 *             - newContent
 *           properties:
 *             newContent:
 *               type: string
 *               description: Nuevo contenido del mensaje
 *     SendMessageWithMentionRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - tel
 *         - mentionTel
 *         - message
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat
 *         mentionTel:
 *           type: string
 *           description: Número de teléfono a mencionar
 *         message:
 *           type: string
 *           description: Contenido del mensaje
 *         isGroup:
 *           type: boolean
 *           default: false
 *           description: Indica si es un chat de grupo
 *     MessageInfoResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Operation completed successfully"
 *         data:
 *           type: object
 *           properties:
 *             messageInfo:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: ID del mensaje
 *                 body:
 *                   type: string
 *                   description: Contenido del mensaje
 *                 type:
 *                   type: string
 *                   description: Tipo de mensaje
 *                 timestamp:
 *                   type: integer
 *                   description: Timestamp del mensaje
 *                 from:
 *                   type: string
 *                   description: Remitente del mensaje
 *                 to:
 *                   type: string
 *                   description: Destinatario del mensaje
 *                 hasMedia:
 *                   type: boolean
 *                   description: Si el mensaje tiene media
 *                 isStarred:
 *                   type: boolean
 *                   description: Si el mensaje está marcado como importante
 *                 isForwarded:
 *                   type: boolean
 *                   description: Si el mensaje es reenviado
 *     MessageRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - tel
 *         - mensaje
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat
 *         mensaje:
 *           type: string
 *           description: Contenido del mensaje
 *     GroupMessageRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - groupId
 *         - mensaje
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         groupId:
 *           type: string
 *           description: ID del grupo
 *         mensaje:
 *           type: string
 *           description: Contenido del mensaje
 *     ReplyMessageRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - tel
 *         - messageId
 *         - reply
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat
 *         messageId:
 *           type: string
 *           description: ID del mensaje a responder
 *         reply:
 *           type: string
 *           description: Contenido de la respuesta
 *         isGroup:
 *           type: boolean
 *           default: false
 *           description: Indica si es un chat de grupo
 */

const MessageService = require('../services/api/messageService');
const { asyncHandler } = require('../utils/asyncHandler');
const ResponseHelper = require('../utils/responseHelper');
const { MessageValidators } = require('../utils/validators');
const { logger } = require('../config/logger');
const { MESSAGES } = require('../utils/constants');

class MessageController {
  constructor() {
    this.whatsappService = new MessageService();
  }

    /**
     * @swagger
     * /api/sendMessage:
     *   post:
     *     tags: [Messages]
     *     summary: Enviar mensaje de texto
     *     operationId: sendMessage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/MessageRequest'
     *     responses:
     *       200:
     *         $ref: '#/components/responses/Success'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     */
    sendMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, mensaje } = MessageValidators.sendMessage(req.body);
        await this.whatsappService.sendMessage(clientId, tel, mensaje);
        logger.info(`Mensaje enviado a ${tel} desde cliente ${clientId}`);

        return ResponseHelper.success(res, null, 'Message sent successfully');
    });

    /**
     * @swagger
     * /api/sendGroupMessage:
     *   post:
     *     tags: [Messages]
     *     summary: Enviar mensaje a grupo
     *     operationId: sendGroupMessage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/GroupMessageRequest'
     *     responses:
     *       200:
     *         $ref: '#/components/responses/Success'
     */
    sendGroupMessage = asyncHandler(async (req, res) => {
        const { clientId, groupId, mensaje } = MessageValidators.sendGroupMessage(req.body);
        await this.whatsappService.sendGroupMessage(clientId, groupId, mensaje);
        logger.info(`Mensaje enviado al grupo ${groupId} desde cliente ${clientId}`);

        return ResponseHelper.success(res, null, 'Group message sent successfully');
    });

    /**
     * @swagger
     * /api/replyMessage:
     *   post:
     *     tags: [Messages]
     *     summary: Responder a un mensaje
     *     operationId: replyToMessage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ReplyMessageRequest'
     *     responses:
     *       200:
     *         $ref: '#/components/responses/Success'
     */
    replyToMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, reply, isGroup } = MessageValidators.replyToMessage(req.body);
        await this.whatsappService.replyToMessage(clientId, tel, messageId, reply, isGroup);
        logger.info(`Respuesta enviada a ${tel} - Cliente: ${clientId}`);
        
        return ResponseHelper.success(res, null, 'Reply sent successfully');
    });

    /**
     * @swagger
     * /api/deleteMessage:
     *   delete:
     *     tags: [Messages]
     *     summary: Eliminar mensaje
     *     operationId: deleteMessage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/DeleteMessageRequest'
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
    deleteMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, forEveryone, isGroup } = MessageValidators.messageAction(req.body); // Agregar validación
        await this.whatsappService.deleteMessage(clientId, tel, messageId, forEveryone, isGroup);
        logger.info(`Mensaje ${messageId} eliminado para ${tel} - Cliente: ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_DELETED); // Usar constante
    });

    /**
     * @swagger
     * /api/forwardMessage:
     *   post:
     *     tags: [Messages]
     *     summary: Reenviar mensaje
     *     operationId: forwardMessage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ForwardMessageRequest'
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
    forwardMessage = asyncHandler(async (req, res) => {
        const { clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo } = MessageValidators.forwardMessage(req.body);
        await this.whatsappService.forwardMessage(clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo);
        logger.info(`Mensaje reenviado de ${fromTel} a ${toTel} - Cliente: ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_FORWARDED);
    });

    /**
     * @swagger
     * /api/markMessageAsImportant:
     *   put:
     *     tags: [Messages]
     *     summary: Marcar mensaje como importante
     *     operationId: markMessageAsImportant
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/MessageActionRequest'
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
    markMessageAsImportant = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, isGroup } = MessageValidators.messageAction(req.body); // Usar validador existente
        await this.whatsappService.markMessageAsImportant(clientId, tel, messageId, isGroup);
        logger.info(`Mensaje marcado como importante - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_STARRED); // Usar constante
    });

    /**
     * @swagger
     * /api/unmarkMessageAsImportant:
     *   put:
     *     tags: [Messages]
     *     summary: Desmarcar mensaje como importante
     *     operationId: unmarkMessageAsImportant
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/MessageActionRequest'
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
    unmarkMessageAsImportant = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, isGroup } = MessageValidators.messageAction(req.body); // Usar validador existente
        await this.whatsappService.unmarkMessageAsImportant(clientId, tel, messageId, isGroup);
        logger.info(`Mensaje desmarcado como importante - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_UNSTARRED); // Usar constante
    });

    /**
     * @swagger
     * /api/editMessage:
     *   put:
     *     tags: [Messages]
     *     summary: Editar mensaje
     *     operationId: editMessage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/EditMessageRequest'
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
    editMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, newContent, isGroup } = MessageValidators.editMessage(req.body);
        await this.whatsappService.editMessage(clientId, tel, messageId, newContent, isGroup);
        logger.info(`Mensaje editado - ID: ${messageId} - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_EDITED);
    });

    /**
     * @swagger
     * /api/sendMessageWithMention:
     *   post:
     *     tags: [Messages]
     *     summary: Enviar mensaje con mención
     *     operationId: sendMessageWithMention
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/SendMessageWithMentionRequest'
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
    sendMessageWithMention = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup, mentionTel, message } = MessageValidators.sendMessageWithMention(req.body);
        await this.whatsappService.sendMessageWithMention(clientId, tel, isGroup, mentionTel, message);
        logger.info('Mensaje con mención enviado correctamente');

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.MESSAGE_WITH_MENTION);
    });

    /**
     * @swagger
     * /api/getMessageInfo/{clientId}/{tel}/{messageId}:
     *   get:
     *     tags: [Messages]
     *     summary: Obtener información del mensaje
     *     operationId: getMessageInfo
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
     *       - name: messageId
     *         in: path
     *         required: true
     *         schema:
     *           type: string
     *         description: ID del mensaje
     *       - name: isGroup
     *         in: query
     *         schema:
     *           type: boolean
     *           default: false
     *         description: Indica si es un chat de grupo
     *     responses:
     *       200:
     *         description: Información del mensaje obtenida exitosamente
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/MessageInfoResponse'
     *       400:
     *         $ref: '#/components/responses/BadRequest'
     *       404:
     *         $ref: '#/components/responses/NotFound'
     *       429:
     *         $ref: '#/components/responses/TooManyRequests'
     */
    getMessageInfo = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, isGroup } = MessageValidators.messageAction(req.body); // Usar validador existente
        const messageInfo = await this.whatsappService.getMessageInfo(clientId, tel, messageId, isGroup); // Capturar resultado
        logger.info('Información del mensaje obtenida correctamente');

        return ResponseHelper.success(res, { messageInfo }, MESSAGES.SUCCESS.MESSAGE_INFO_RETRIEVED); // Usar constante y retornar datos
    });
}

module.exports = new MessageController();