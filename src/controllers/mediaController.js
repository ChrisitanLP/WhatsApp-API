// src/controllers/mediaController.js
const MediaService = require('../services/api/mediaService');
const { asyncHandler } = require('../utils/asyncHandler');
const ResponseHelper = require('../utils/responseHelper');
const { MediaValidators } = require('../utils/validators');
const { logger } = require('../config/logger');
const { MESSAGES } = require('../utils/constants');

class MediaController {
    constructor() {
        this.whatsappService = new MediaService();
    }

    sendImage = asyncHandler(async (req, res) => {
        const { clientId, tel, imagePath, isGroup } = MediaValidators.sendImage(req.body);
        await this.whatsappService.sendMediaMessage({
            clientId,
            tel,
            mediaPath: imagePath,
            isGroup,
            type: 'image'
        });
        logger.info(`Imagen enviada a ${tel} desde cliente ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.IMAGE_SENT);
    });

    sendMessageOrFile = asyncHandler(async (req, res) => {
        const { clientId, chatId, message, filePath } = MediaValidators.sendMessageOrFile(req.body);
        await this.whatsappService.sendMessageOrFile({ clientId, chatId, message, filePath });
        logger.info(`Se envió ${filePath ? 'un archivo' : 'un mensaje'} a ${chatId}`);

        return ResponseHelper.success(res, null, filePath ? MESSAGES.SUCCESS.FILE_SENT : MESSAGES.SUCCESS.MESSAGE_SENT);
    });

    sendSticker = asyncHandler(async (req, res) => {
        const { clientId, tel, stickerPath, isGroup } = MediaValidators.sendSticker(req.body);
        await this.whatsappService.sendMediaMessage({
            clientId,
            tel,
            mediaPath: stickerPath,
            isGroup,
            type: 'sticker'
        });
        logger.info(`Sticker enviado a ${tel} desde cliente ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.STICKER_SENT);
    });

    sendMessageProduct = asyncHandler(async (req, res) => {
        const { clientId, tel, mensaje, imagen } = MediaValidators.sendProductMessage(req.body);
        await this.whatsappService.sendProductMessage({
            clientId,
            tel,
            message: mensaje,
            image: imagen,
            isGroup: false
        });
        logger.info(`Mensaje de producto enviado a ${tel} desde cliente ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.PRODUCT_MESSAGE_SENT);
    });

    sendMessageProductGroup = asyncHandler(async (req, res) => {
        const { clientId, groupId, mensaje, imagen } = MediaValidators.sendProductGroupMessage(req.body);
        await this.whatsappService.sendMessageProductGroup({
            clientId,
            groupId: groupId,
            tel: groupId, // Añadir esta línea para compatibilidad
            message: mensaje,
            image: imagen,
            isGroup: true
        });
        logger.info(`Mensaje de producto enviado al grupo ${groupId} - Cliente: ${clientId}`);

        return ResponseHelper.success(res, null, MESSAGES.SUCCESS.PRODUCT_MESSAGE_SENT);
    });
}

module.exports = new MediaController();