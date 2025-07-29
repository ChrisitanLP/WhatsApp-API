// src/controllers/MessageController.js
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
   * Send text message
   */
    sendMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, mensaje } = MessageValidators.sendMessage(req.body);
        await this.whatsappService.sendMessage(clientId, tel, mensaje);
        logger.info(`Mensaje enviado a ${tel} desde cliente ${clientId}`);

        return ResponseHelper.success(res, null, 'Message sent successfully');
    });

    sendGroupMessage = asyncHandler(async (req, res) => {
        const { clientId, groupId, mensaje } = MessageValidators.sendGroupMessage(req.body);
        await this.whatsappService.sendGroupMessage(clientId, groupId, mensaje);
        logger.info(`Mensaje enviado al grupo ${groupId} desde cliente ${clientId}`);

        return ResponseHelper.success(res, null, 'Group message sent successfully');
    });

    replyToMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, reply, isGroup } = MessageValidators.replyToMessage(req.body);
        await this.whatsappService.replyToMessage(clientId, tel, messageId, reply, isGroup);
        logger.info(`Respuesta enviada a ${tel} - Cliente: ${clientId}`);
        
        return ResponseHelper.success(res, null, 'Reply sent successfully');
    });

    deleteMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, forEveryone, isGroup } = MessageValidators.messageAction(req.body); // Agregar validación
        await this.whatsappService.deleteMessage(clientId, tel, messageId, forEveryone, isGroup);
        logger.info(`Mensaje ${messageId} eliminado para ${tel} - Cliente: ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_DELETED); // Usar constante
    });

    forwardMessage = asyncHandler(async (req, res) => {
        const { clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo } = MessageValidators.forwardMessage(req.body);
        await this.whatsappService.forwardMessage(clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo);
        logger.info(`Mensaje reenviado de ${fromTel} a ${toTel} - Cliente: ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_FORWARDED);
    });

    markMessageAsImportant = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, isGroup } = MessageValidators.messageAction(req.body); // Usar validador existente
        await this.whatsappService.markMessageAsImportant(clientId, tel, messageId, isGroup);
        logger.info(`Mensaje marcado como importante - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_STARRED); // Usar constante
    });

    unmarkMessageAsImportant = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, isGroup } = MessageValidators.messageAction(req.body); // Usar validador existente
        await this.whatsappService.unmarkMessageAsImportant(clientId, tel, messageId, isGroup);
        logger.info(`Mensaje desmarcado como importante - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_UNSTARRED); // Usar constante
    });

    editMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, newContent, isGroup } = MessageValidators.editMessage(req.body);
        await this.whatsappService.editMessage(clientId, tel, messageId, newContent, isGroup);
        logger.info(`Mensaje editado - ID: ${messageId} - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_EDITED);
    });

    sendMessageWithMention = asyncHandler(async (req, res) => {
        const { clientId, tel, isGroup, mentionTel, message } = MessageValidators.sendMessageWithMention(req.body);
        await this.whatsappService.sendMessageWithMention(clientId, tel, isGroup, mentionTel, message);
        logger.info('Mensaje con mención enviado correctamente');

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.MESSAGE_WITH_MENTION);
    });

    getMessageInfo = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, isGroup } = MessageValidators.messageAction(req.body); // Usar validador existente
        const messageInfo = await this.whatsappService.getMessageInfo(clientId, tel, messageId, isGroup); // Capturar resultado
        logger.info('Información del mensaje obtenida correctamente');

        return ResponseHelper.success(res, { messageInfo }, MESSAGES.SUCCESS.MESSAGE_INFO_RETRIEVED); // Usar constante y retornar datos
    });
}

module.exports = new MessageController();