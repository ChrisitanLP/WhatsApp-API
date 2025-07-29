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
        const data = MessageValidators.replyToMessage(req.body);
        await this.whatsappService.replyToMessage(
            data.clientId,
            data.tel,
            data.messageId,
            data.reply,
            data.isGroup
        );
        logger.info(`Respuesta enviada a ${data.tel} - Cliente: ${data.clientId}`);

        return ResponseHelper.success(res, null, 'Reply sent successfully');
    });

    deleteMessage = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, forEveryone, isGroup } = MessageValidators.messageAction(req.body); // Agregar validación
        await this.whatsappService.deleteMessage(clientId, tel, messageId, forEveryone, isGroup);
        logger.info(`Mensaje ${messageId} eliminado para ${tel} - Cliente: ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_DELETED); // Usar constante
    });

    forwardMessage = asyncHandler(async (req, res) => {
        // Agregar validador específico si es necesario, o validar campos críticos
        const { clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo } = req.body;
        MessageValidators.required(clientId, 'Client ID');
        MessageValidators.phoneNumber(fromTel, 'From telephone number');
        MessageValidators.phoneNumber(toTel, 'To telephone number');
        MessageValidators.required(messageId, 'Message ID');
        
        await this.whatsappService.forwardMessage(
            clientId,
            fromTel,
            toTel,
            messageId,
            isGroupFrom,
            isGroupTo
        );
        logger.info(`Mensaje reenviado de ${fromTel} a ${toTel} - Cliente: ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.MESSAGE_FORWARDED); // Usar constante
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
        // Validación personalizada para editMessage
        const { clientId, tel, messageId, newContent, isGroup } = req.body;
        MessageValidators.required(clientId, 'Client ID');
        MessageValidators.phoneNumber(tel, 'Telephone number');
        MessageValidators.required(messageId, 'Message ID');
        MessageValidators.required(newContent, 'New content');
        
        const result = await this.whatsappService.editMessage(clientId, tel, messageId, newContent, isGroup);
        logger.info(`Mensaje editado - ID: ${messageId} - Cliente: ${clientId}, Tel: ${tel}`);

        return ResponseHelper.success(res, { result }, MESSAGES.SUCCESS.MESSAGE_EDITED); // Usar constante
    });

    sendMessageWithMention = asyncHandler(async (req, res) => {
        // Validación personalizada para mentions
        const { clientId, tel, isGroup, mentionTel, message } = req.body;
        MessageValidators.required(clientId, 'Client ID');
        MessageValidators.phoneNumber(tel, 'Telephone number');
        MessageValidators.phoneNumber(mentionTel, 'Mention telephone number');
        MessageValidators.required(message, 'Message');
        
        await this.whatsappService.sendMessageWithMention(clientId, tel, isGroup, mentionTel, message);
        logger.info('Mensaje con mención enviado correctamente');

        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.MESSAGE_WITH_MENTION); // Usar constante
    });

    getMessageInfo = asyncHandler(async (req, res) => {
        const { clientId, tel, messageId, isGroup } = MessageValidators.messageAction(req.body); // Usar validador existente
        const messageInfo = await this.whatsappService.getMessageInfo(clientId, tel, messageId, isGroup); // Capturar resultado
        logger.info('Información del mensaje obtenida correctamente');

        return ResponseHelper.success(res, { messageInfo }, MESSAGES.SUCCESS.MESSAGE_INFO_RETRIEVED); // Usar constante y retornar datos
    });
}

module.exports = new MessageController();