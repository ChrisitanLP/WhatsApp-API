/**
 * @swagger
 * components:
 *   schemas:
 *     MediaRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - tel
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat
 *         isGroup:
 *           type: boolean
 *           default: false
 *           description: Indica si es un chat de grupo
 *     ImageRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/MediaRequest'
 *         - type: object
 *           required:
 *             - imagePath
 *           properties:
 *             imagePath:
 *               type: string
 *               description: Ruta de la imagen en el servidor
 *     StickerRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/MediaRequest'
 *         - type: object
 *           required:
 *             - stickerPath
 *           properties:
 *             stickerPath:
 *               type: string
 *               description: Ruta del sticker en el servidor
 *     MessageOrFileRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - chatId
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         chatId:
 *           type: string
 *           description: ID del chat de destino
 *         message:
 *           type: string
 *           description: Mensaje de texto (opcional si se envía archivo)
 *         filePath:
 *           type: string
 *           description: Ruta del archivo (opcional si se envía mensaje)
 *     ProductMessageRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - tel
 *         - mensaje
 *         - imagen
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat
 *         mensaje:
 *           type: string
 *           description: Descripción del producto
 *         imagen:
 *           type: string
 *           description: Imagen del producto en base64 o URL
 *     ProductMessageGroupRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - groupId
 *         - mensaje
 *         - imagen
 *       properties:
 *         clientId:
 *           type: string
 *           description: ID del cliente de WhatsApp
 *         groupId:
 *           type: string
 *           description: ID del grupo
 *         mensaje:
 *           type: string
 *           description: Descripción del producto
 *         imagen:
 *           type: string
 *           description: Imagen del producto en base64 o URL
 */

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

    /**
     * @swagger
     * /api/sendImage:
     *   post:
     *     tags: [Media]
     *     summary: Enviar imagen
     *     operationId: sendImage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ImageRequest'
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

    /**
     * @swagger
     * /api/sendMessageorFile:
     *   post:
     *     tags: [Media]  
     *     summary: Enviar mensaje o archivo
     *     operationId: sendMessageOrFile
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/MessageOrFileRequest'
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
    sendMessageOrFile = asyncHandler(async (req, res) => {
        const { clientId, chatId, message, filePath } = MediaValidators.sendMessageOrFile(req.body);
        await this.whatsappService.sendMessageOrFile({ clientId, chatId, message, filePath });
        logger.info(`Se envió ${filePath ? 'un archivo' : 'un mensaje'} a ${chatId}`);

        return ResponseHelper.success(res, null, filePath ? MESSAGES.SUCCESS.FILE_SENT : MESSAGES.SUCCESS.MESSAGE_SENT);
    });

    /**
     * @swagger
     * /api/sendSticker:
     *   post:
     *     tags: [Media]
     *     summary: Enviar sticker
     *     operationId: sendSticker  
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/StickerRequest'
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

    /**
     * @swagger
     * /api/sendMessageProducts:
     *   post:
     *     tags: [Media]
     *     summary: Enviar mensaje de producto
     *     operationId: sendMessageProduct
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ProductMessageRequest'
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

    /**
     * @swagger
     * /api/sendGroupProducts:
     *   post:
     *     tags: [Media]
     *     summary: Enviar mensaje de producto a grupo
     *     operationId: sendMessageProductGroup
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ProductMessageGroupRequest'
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