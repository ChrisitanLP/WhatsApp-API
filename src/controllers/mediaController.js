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
 *           description: Número del cliente de WhatsApp (no solo ID)
 *           example: "5931234567890"
 *         tel:
 *           type: string
 *           description: Número de teléfono o ID del chat (sin @c.us)
 *           example: "593987654321"
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
 *               description: Ruta absoluta de la imagen en el servidor
 *               example: "/path/to/images/photo.jpg"
 *     StickerRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/MediaRequest'
 *         - type: object
 *           required:
 *             - stickerPath
 *           properties:
 *             stickerPath:
 *               type: string
 *               description: Ruta absoluta del sticker en el servidor
 *               example: "/path/to/stickers/sticker.webp"
 *     MessageOrFileRequest:
 *       type: object
 *       required:
 *         - clientId
 *         - chatId
 *       properties:
 *         clientId:
 *           type: string
 *           description: Número del cliente de WhatsApp
 *           example: "5931234567890"
 *         chatId:
 *           type: string
 *           description: ID del chat de destino (con formato @c.us o @g.us)
 *           example: "593987654321@c.us"
 *         message:
 *           type: string
 *           description: Mensaje de texto (requerido si no se envía archivo)
 *           example: "Hola, ¿cómo estás?"
 *         filePath:
 *           type: string
 *           description: Ruta absoluta del archivo (requerido si no se envía mensaje)
 *           example: "/path/to/files/document.pdf"
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
 *           description: Número del cliente de WhatsApp
 *           example: "5931234567890"
 *         tel:
 *           type: string
 *           description: Número de teléfono (sin @c.us)
 *           example: "593987654321"
 *         mensaje:
 *           type: string
 *           description: Descripción del producto
 *           example: "Producto disponible - $25.99"
 *         imagen:
 *           type: string
 *           description: Imagen del producto en formato base64 (con o sin data:image/ prefix)
 *           example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
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
 *           description: Número del cliente de WhatsApp
 *           example: "5931234567890"
 *         groupId:
 *           type: string
 *           description: ID del grupo (sin @g.us)
 *           example: "120363025015063966"
 *         mensaje:
 *           type: string
 *           description: Descripción del producto
 *           example: "¡Oferta especial para el grupo!"
 *         imagen:
 *           type: string
 *           description: Imagen del producto en formato base64
 *           example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
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
     *     description: Envía una imagen desde una ruta del servidor a un contacto o grupo de WhatsApp. Valida existencia y tamaño del archivo (máx 64MB).
     *     operationId: sendImage
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ImageRequest'
     *           example:
     *             clientId: "5931234567890"
     *             tel: "593987654321"
     *             imagePath: "/path/to/images/photo.jpg"
     *             isGroup: false
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
     *     description: Envía un mensaje de texto o un archivo a un chat específico. Requiere chatId con formato completo (@c.us o @g.us).
     *     operationId: sendMessageOrFile
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/MessageOrFileRequest'
     *           example:
     *             clientId: "5931234567890"
     *             chatId: "593987654321@c.us"
     *             message: "Hola, ¿cómo estás?"
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
     *     description: Envía un sticker desde una ruta del servidor. El archivo se envía con la opción sendMediaAsSticker=true.
     *     operationId: sendSticker  
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/StickerRequest'
     *           example:
     *             clientId: "5931234567890"
     *             tel: "593987654321"
     *             stickerPath: "/path/to/stickers/funny.webp"
     *             isGroup: false
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
     *     description: Envía un mensaje con imagen de producto usando base64. La imagen se procesa y almacena temporalmente.
     *     operationId: sendMessageProduct
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ProductMessageRequest'
     *           example:
     *             clientId: "5931234567890"
     *             tel: "593987654321"
     *             mensaje: "¡Nuevo producto disponible por $29.99!"
     *             imagen: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
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
     *     description: Envía un mensaje con imagen de producto a un grupo específico usando base64.
     *     operationId: sendMessageProductGroup
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ProductMessageGroupRequest'
     *           example:
     *             clientId: "5931234567890"
     *             groupId: "120363025015063966"
     *             mensaje: "¡Oferta especial para el grupo - 20% descuento!"
     *             imagen: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
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