// src/controllers/ClientController.js
const BaseWhatsAppService = require('../services/api/baseService');
const { asyncHandler } = require('../utils/asyncHandler');
const ResponseHelper = require('../utils/responseHelper');
const { ClientValidators } = require('../utils/validators');
const { AuthValidators } = require('../utils/validators');
const { logger } = require('../config/logger');
const { HTTP_STATUS, MESSAGES } = require('../utils/constants');

class ClientController {
    constructor() {
        this.whatsappService = new BaseWhatsAppService();
    }

    /**
     * Add new WhatsApp client
     */
    addClient = asyncHandler(async (req, res) => {
        const { number } = ClientValidators.addClient(req.body);
        await this.whatsappService.createClient(number);
        logger.info(`Cliente ${number} agregado exitosamente`);
        
        return ResponseHelper.success(res, {}, MESSAGES.SUCCESS.CLIENT_ADDED);
    });

    /**
     * Remove WhatsApp client
     */
    removeClient = asyncHandler(async (req, res) => {
        const { number } = ClientValidators.removeClient(req.body);
        await this.whatsappService.deleteClient(number);
        logger.info(`Cliente ${number} eliminado exitosamente`);
        
        return ResponseHelper.success(
            res, 
            {}, 
            `${MESSAGES.SUCCESS.CLIENT_REMOVED.replace('Client', `Client ${number}`)}`
        );
    });


    /**
    * Get QR code for client authentication
    */
    getQrCode = asyncHandler(async (req, res) => {
        const { number } = AuthValidators.getQrCode(req.params);
        const qrCode = await this.whatsappService.getClientQr(number);
        if (!qrCode) {
        logger.warn(`QR no disponible para número: ${number}`);
        const clientExists = await this.whatsappService.checkClientExists(number);
        if (clientExists) {
            logger.info(`Cliente existe para ${number}, pero QR no disponible. Reintentando inicialización.`);
            
            try {
            await this.whatsappService.refreshClient(number);
            return ResponseHelper.success(
                res, 
                {}, 
                MESSAGES.ERROR.QR_GENERATION_IN_PROGRESS,
                HTTP_STATUS.ACCEPTED
            );
            } catch (refreshError) {
            logger.error(`Error reiniciando cliente ${number}:`, refreshError);
            }
        }

        return ResponseHelper.notFound(res, MESSAGES.ERROR.QR_NOT_AVAILABLE);
        }
        
        return ResponseHelper.success(res, { qr: qrCode });
    });

    /**
     * Get client authentication status
     */
    getClientStatus = asyncHandler(async (req, res) => {
        const { number } = AuthValidators.getClientStatus(req.params);
        const isAuthenticated = await this.whatsappService.checkClientAuth(number);
        
        return ResponseHelper.success(res, { isAuthenticated });
    });

    /**
     * Get detailed connection status
     */
    getConnectionStatus = asyncHandler(async (req, res) => {
        const { number } = AuthValidators.getClientStatus(req.params);
        const clientStatus = await this.whatsappService.checkClientStatus(number);
        
        return ResponseHelper.success(res, {
        isAuthenticated: clientStatus.authenticated,
        isReady: clientStatus.ready,
        number: number
        });
    });

    /**
     * Get all authenticated accounts info
     */
    getAllAuthenticatedAccountsInfo = asyncHandler(async (req, res) => {
        const accounts = await this.whatsappService.getAllAuthenticatedAccountsInfo();
        
        return ResponseHelper.success(res, { accounts });
    });
}

module.exports = new ClientController();