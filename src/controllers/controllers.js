const { MessageMedia } = require('whatsapp-web.js');
const WhatsAppService = require('../services/services');
const whatsappService = new WhatsAppService();
const { ValidationError, NotFoundError } = require('../utils/asyncHandler');
const { logger } = require('../config/logger');

class WhatsAppController {
  constructor() {
  }

  /**
   * Get QR code for client authentication
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async getQrCode(req, res) {
    try {
      const { number } = req.params;
      
      const qrCode = await whatsappService.getClientQr(number);

      if (!qrCode) {
        logger.warn(`QR no disponible para número: ${number}`);
        
        const clientExists = await whatsappService.checkClientExists(number);
        if (clientExists) {
          logger.info(`Cliente existe para ${number}, pero QR no disponible. Reintentando inicialización.`);
          try {
            // Opcionalmente, intentar reiniciar el cliente para generar nuevo QR
            await whatsappService.refreshClient(number);
            return res.status(202).json({ 
              success: false, 
              error: 'QR code generation in progress, please try again shortly' 
            });
          } catch (refreshError) {
            logger.error(`Error reiniciando cliente ${number}:`, refreshError);
          }
        }

        return res.status(404).json({ 
          success: false, 
          error: 'QR code not available' 
        });
      }
      
      res.json({ 
          success: true, 
          qr: qrCode 
      });
    } catch (error) {
      logger.error(`Error al obtener QR para ${req.params.number}: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Get client authentication status
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async getClientStatus(req, res) {
    try {
      const { number } = req.params;
      const isAuthenticated = await whatsappService.checkClientAuth(number);
      
      res.json({ 
          success: true, 
          isAuthenticated 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  async getConnectionStatus(req, res) {
    try {
        const { number } = req.params;
        const clientStatus = await whatsappService.checkClientStatus(number);
        
        res.json({
            success: true,
            isAuthenticated: clientStatus.authenticated,
            isReady: clientStatus.ready,
            number: number
        });
    } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
      });
    }
  }

  /**
   * Add new WhatsApp client
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async addClient(req, res) {
    try {
      const { number } = req.body;
      if (!number) {
        throw new ValidationError('Number is required');
      }

      await whatsappService.createClient(number);
      res.json({ 
          success: true, 
          message: 'Client added successfully' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Remove WhatsApp client
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async removeClient(req, res) {
    try {
      const { number } = req.body;
      
      if (!number) {
        throw new ValidationError('Client number is required');
      }

      await whatsappService.deleteClient(number);
      res.json({ 
          success: true, 
          message: `Client ${number} removed successfully` 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Save contact for specific client
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async saveContact(req, res) {
    try {
      const { clientNumber, contactNumber, contactName } = req.body;
      
      if (!clientNumber || !contactNumber || !contactName) {
        throw new ValidationError('Client number, contact number, and contact name are required');
      }

      await whatsappService.createContact(clientNumber, contactNumber, contactName);
      res.json({ 
          success: true, 
          message: 'Contact saved successfully' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Get chats with pagination
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */
  async getChats(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
  
      const { 
        chats, 
        totalUnreadChats, 
        totalPages 
      } = await whatsappService.fetchChats(page, limit);
  
      res.json({
        success: true,
        currentPage: page,
        totalPages,
        totalUnreadChats,
        chats
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Get unread chats with pagination
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async getUnreadChats(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;

      const {
        chats,
        totalUnreadChats,
        totalPages
      } = await whatsappService.fetchUnreadChats(page, limit);

      res.json({
        success: true,
        currentPage: page,
        totalPages: totalPages,
        totalUnreadChats: totalUnreadChats,
        unreadChats: chats
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Mark chat as read
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async markChatAsRead(req, res) {
    try {
      const { clientId, tel, isGroup } = req.params;
      
      if (!clientId || !tel) {
        throw new ValidationError('Client ID and telephone number are required');
      }

      await whatsappService.markChatRead(clientId, tel, isGroup === 'true');
      res.json({ 
          success: true, 
          message: 'Chat marked as read' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Mark chat as unread
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async markChatAsUnread(req, res) {
    try {
      const { clientId, tel, isGroup } = req.body;
      
      if (!clientId || !tel) {
        throw new ValidationError('Client ID and telephone number are required');
      }

      await whatsappService.markChatUnread(clientId, tel, isGroup);
      res.json({ 
          success: true, 
          message: 'Chat marked as unread' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Get contacts with pagination
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async getContacts(req, res) {
    try {
      const page = parseInt(req.query.page, 10) || 1;
  
      if (page < 1) {
        return res.status(400).json({ success: false, error: 'Número de página inválido' });
      }
  
      const contacts = await whatsappService.fetchContacts(page);
  
      res.json({
        success: true,
        contacts: contacts
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  
  /**
   * Get chat messages
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async getChatMessages(req, res) {
    try {
      const { clientId, tel } = req.params;
      const messages = await whatsappService.getChatMessages(clientId, tel);
      
      res.json({ 
          success: true, 
          messages: messages 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Get group chat messages
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async getGroupChatMessages(req, res) {
    try {
      const { number, groupId } = req.params;
      const messages = await whatsappService.getGroupChatMessages(number, groupId);
      
      res.json({ 
          success: true, 
          messages: messages 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Send messages
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async sendMessage (req, res) {
    try {
      const { clientId, tel, mensaje } = req.body;
      await whatsappService.sendMessage(clientId, tel, mensaje);
      
      res.json({
        success: true,
        message: 'Message sent successfully'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Send messages on groups
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async sendGroupMessage (req, res) {
    try {
      const { clientId, groupId, mensaje } = req.body;
      await whatsappService.sendGroupMessage(clientId, groupId, mensaje);
      
      res.json({
        success: true,
        message: 'Group message sent successfully'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Send messages or giles
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async sendMessageOrFile (req, res) {
    try {
      const { clientId, chatId, message, filePath } = req.body;
      await whatsappService.sendMessageOrFile({
        clientId,
        chatId,
        message,
        filePath
      });
      
      res.json({
        success: true,
        message: filePath ? 'File sent successfully' : 'Message sent successfully'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Send stickers
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async sendSticker (req, res) {
    try {
      const { clientId, tel, stickerPath, isGroup } = req.body;
      await whatsappService.sendMediaMessage({
        clientId,
        tel,
        mediaPath: stickerPath,
        isGroup,
        type: 'sticker'
      });
      
      res.json({
        success: true,
        message: 'Sticker sent successfully'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Send Images
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async sendImage (req, res) {
    try {
      const { clientId, tel, imagePath, isGroup } = req.body;
      await whatsappService.sendMediaMessage({
        clientId,
        tel,
        mediaPath: imagePath,
        isGroup,
        type: 'image'
      });
      
      res.json({
        success: true,
        message: 'Image sent successfully'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Send messages about products
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async sendMessageProduct (req, res) {
    try {
      const { clientId, tel, mensaje, imagen } = req.body;
      await whatsappService.sendProductMessage({
        clientId,
        tel,
        message: mensaje,
        image: imagen,
        isGroup: false
      });
      
      res.json({
        success: true,
        message: 'Product message sent successfully'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  /**
   * Get info about accounts
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   */

  async getAllAuthenticatedAccountsInfo(req, res) {
    try {
      const accounts = await whatsappService.getAllAuthenticatedAccountsInfo();

      res.json({ 
        success: true, 
        accounts 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  async replyToMessage(req, res) {
    try {
      const { clientId, tel, messageId, reply, isGroup } = req.body;
      await whatsappService.replyToMessage(
        clientId, 
        tel, 
        messageId, 
        reply, 
        isGroup
      );

      res.json({ 
        success: true, 
        message: 'Respuesta enviada correctamente.' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  async deleteMessage(req, res) {
    try {
      const { clientId, tel, messageId, forEveryone, isGroup } = req.body;
      await whatsappService.deleteMessage(
        clientId, 
        tel, 
        messageId, 
        forEveryone, 
        isGroup
      );

      res.json({ 
        success: true, 
        message: 'Mensaje eliminado correctamente.' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  async forwardMessage(req, res) {
    try {
      const { clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo } = req.body;
      await whatsappService.forwardMessage(
        clientId, 
        fromTel, 
        toTel, 
        messageId, 
        isGroupFrom, 
        isGroupTo
      );

      res.json({ 
        success: true, 
        message: 'Mensaje reenviado correctamente.' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  async sendMessageProductGroup(req, res) {
    try {
      const { clientId, groupId, mensaje, imagen } = req.body;
      await whatsappService.sendMessageProductGroup({
        clientId, 
        groupId, 
        mmesage: mensaje, 
        image: imagen,
        isGroup: true
      });

      res.json({ 
        success: true, 
        message: 'Producto y imagen enviados correctamente.' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }

  async markMessageAsImportant (req, res) {
    try {
        const { clientId, tel, messageId, isGroup } = req.body;
        await whatsappService.markMessageAsImportant(
          clientId, 
          tel, 
          messageId, 
          isGroup
        );

        res.json({ 
          success: true, 
          message: 'Mensaje destacado.' 
        });
    } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Error interno del servidor.', 
          error: error.message 
        });
    }
  }

  async unmarkMessageAsImportant (req, res) {
    try {
        const { clientId, tel, messageId, isGroup } = req.body;
        await whatsappService.unmarkMessageAsImportant(
          clientId, 
          tel, 
          messageId, 
          isGroup
        );

        res.json({ 
          success: true, 
          message: 'Mensaje No destacado.' 
        });
    } catch (error) {
        res.status(500).json({ 
          success: false, 
          message: 'Error interno del servidor.', 
          error: error.message 
        });
    }
  }

  async editMessage (req, res) {
    try {
      const { clientId, tel, messageId, newContent, isGroup } = req.body;
      await whatsappService.editMessage(
        clientId, 
        tel, 
        messageId, 
        newContent, 
        isGroup
      );

      res.json({ 
        success: true, 
        message: 'Mensaje editado exitosamente.', 
        data: result 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }
  
  async muteChat (req, res) {
    try {
      const { clientId, tel, isGroup, unmuteDate } = req.body;
      await whatsappService.muteChat(
        clientId, 
        tel, 
        isGroup, 
        unmuteDate
      );

      res.json({ 
        success: true, 
        message: 'Chat silenciado correctamente.' 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  async pinChat (req, res) {
    try {
      const { clientId, tel, isGroup } = req.body;
      await whatsappService.pinChat(
        clientId, 
        tel, 
        isGroup
      );

      res.json({ 
        success: true, 
        pinned: result 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }
  
  async unpinChat (req, res) {
    try {
      const { clientId, tel, isGroup } = req.body;
      await whatsappService.unpinChat(
        clientId, 
        tel, 
        isGroup
      );

      res.json({ 
        success: true, 
        unpinned: result 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  async sendMessageWithMention (req, res) {
    try {
      const { clientId, tel, isGroup, mentionTel, message } = req.body;
      await whatsappService.sendMessageWithMention(
        clientId, 
        tel, 
        isGroup, 
        mentionTel, 
        message
      );

      res.json({ 
        success: true, 
        message: 'Mensaje enviado correctamente con mención.'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  async getMessageInfo (req, res){
    try {
      const { clientId, tel, messageId, isGroup } = req.body;
      await whatsappService.getMessageInfo(
        clientId, 
        tel, 
        messageId, 
        isGroup
      );
  
      res.json({ 
        success: true, 
        message: 'Información del mensaje obtenido.'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }
}

const whatsAppController = new WhatsAppController();
module.exports = whatsAppController;