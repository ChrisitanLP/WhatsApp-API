require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { NotFoundError, ValidationError } = require('../utils/asyncHandler');
const { logger } = require('../config/logger');
const { AES } = require('../utils/encryption');
const WhatsAppClient = require('../lib/whatsapp');

// Obtener la clave del archivo .env
const encryptionKey = process.env.PASS_ENCRYPTED;
if (!encryptionKey) {
  throw new Error("No se encontró la clave de cifrado en .env");
}
const aesInstance = new AES(encryptionKey);

class WhatsAppService {
  constructor() {
    this.CONTACTS_PER_PAGE = 30;
    this.tempDir = path.join(__dirname, '../temp');
    this.ensureTempDir();
  }

  /**
   * Check if client exists
   * @param {string} number - Phone number
   * @returns {Promise<boolean>} - Whether client exists
   */
  async checkClientExists(number) {
    const client = WhatsAppClient.getClient(number);
    return !!client;
  }

  async checkClientStatus(number) {
    // You might already have methods to check this in your WhatsAppClient
    const isAuthenticated = WhatsAppClient.isAuthenticated(number);
    const isReady = WhatsAppClient.isReady(number);
    
    return {
        authenticated: isAuthenticated,
        ready: isReady
    };
}

  /**
 * Refresh client to generate new QR
 * @param {string} number - Phone number
 */
async refreshClient(number) {
  const client = WhatsAppClient.getClient(number);
  
  if (client) {
      // Si el cliente existe pero no está autenticado, podemos forzar un reinicio
      if (!client.authStrategy?.isAuthenticated) {
          logger.info(`Reiniciando cliente ${number} para generar nuevo QR`);
          
          // Puede que necesites implementar una forma específica de reiniciar el cliente
          // dependiendo de la implementación de WhatsAppClient
          await WhatsAppClient.restartClient(number);
      }
  } else {
      // Si el cliente no existe, crearlo
      logger.info(`Creando nuevo cliente para ${number}`);
      await WhatsAppClient.createClient(number, 'sessions');
  }
}

  // Part I ----------------------------------------------------------------------------------------------------------------

  /**
   * Get client QR code
   * @param {string} number - Client number
   * @returns {Promise<string>} QR code
   */

  async getClientQr(number) {
    const qrCode = WhatsAppClient.getQr(number);
    // Para debugging
    console.log(`Obteniendo QR para ${number}: ${qrCode ? 'disponible' : 'no disponible'}`);
    return qrCode;
  }

  /**
   * Check client authentication status
   * @param {string} number - Client number
   * @returns {Promise<boolean>} Authentication status
   */

  async checkClientAuth(number) {
    return WhatsAppClient.isAuthenticated(number);
  }

  /**
   * Create new WhatsApp client
   * @param {string} number - Client number
   * @param {Object} sessionData - Client session data
   */

  async createClient(number) {
    try {
      await WhatsAppClient.addClient(number);
    } catch (error) {
      logger.error(`Error creating client: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete WhatsApp client
   * @param {string} number - Client number
   */

  async deleteClient(number) {
    try {
      await WhatsAppClient.removeClient(number);
    } catch (error) {
      logger.error(`Error removing client: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create contact for specific client
   * @param {string} clientNumber - Client number
   * @param {string} contactNumber - Contact number
   * @param {string} contactName - Contact name
   */

  async createContact(clientNumber, contactNumber, contactName) {
    const client = WhatsAppClient.getClient(clientNumber);
    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const formattedNumber = this.formatContactNumber(contactNumber);
    const contact = await client.createContact(formattedNumber, contactName);
    
    if (!contact) {
      throw new Error('Failed to create contact');
    }
  }

  /**
   * Fetch unread chats with pagination
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Paginated unread chats
   */

  async fetchUnreadChats(page, limit) {
    const clients = Array.from(WhatsAppClient.clients.values());
    let unreadChats = [];

    for (const client of clients) {
      const clientChats = await this.getClientUnreadChats(client);
      unreadChats = unreadChats.concat(clientChats);
    }

    unreadChats.sort((a, b) => b.recentMessageDate - a.recentMessageDate);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const totalUnreadChats = unreadChats.length;

    return {
      chats: unreadChats.slice(startIndex, endIndex),
      totalUnreadChats,
      totalPages: Math.ceil(totalUnreadChats / limit)
    };
  }

  /**
   * Get unread chats for specific client
   * @param {Object} client - WhatsApp client instance
   * @returns {Promise<Array>} Unread chats
   */

  async getClientUnreadChats(client) {
    const chats = await client.getChats();
    const unreadChats = chats.filter(chat => chat.unreadCount > 0);

    return Promise.all(unreadChats.map(chat => this.processChat(chat, client)));
  }

   /**
   * Fetch chats with pagination
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Paginated unread chats
   */

  async fetchChats(page, limit) {
    const clients = Array.from(WhatsAppClient.clients.values());
    let allChats = [];
  
    for (const client of clients) {
      const clientChats = await this.getClientChats(client);
      allChats = allChats.concat(clientChats);
    }
  
    allChats.sort((a, b) => b.timestamp - a.timestamp);
  
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const totalUnreadChats = allChats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
  
    return {
      chats: allChats.slice(startIndex, endIndex),
      totalUnreadChats,
      totalPages: Math.ceil(allChats.length / limit)
    };
  }

  /**
   * Get chats for specific client
   * @param {Object} client - WhatsApp client instance
   * @returns {Promise<Array>} Unread chats
   */
  
  async getClientChats(client) {
    const chats = await client.getChats();
    return Promise.all(chats.map(chat => this.processChat(chat, client)));
  }
  
  /**
   * Process chat to get additional details
   * @param {Object} chat - Chat object
   * @param {Object} client - WhatsApp client instance
   * @returns {Promise<Object>} Processed chat
   */

  async processChat(chat, client) {
    try {
      const contact = await chat.getContact();
      const profilePicUrl = await this.getProfilePicture(client, contact.id._serialized);
      const recentMessageDate = await this.getRecentMessageDate(chat);
      const groupData = chat.id.server === 'g.us' ? await this.getGroupData(chat, client) : [];

      return {
        ...chat,
        recentMessageDate,
        profilePicUrl,
        groupData,
        client: client.options.authStrategy.clientId
      };
    } catch (error) {
      logger.error(`Error processing chat: ${error.message}`);
      return this.getDefaultChatData(chat, client);
    }
  }

  /**
   * Mark chat as read
   * @param {string} clientId - Client ID
   * @param {string} tel - Phone number
   * @param {boolean} isGroup - Is group chat
   */

  async markChatRead(clientId, tel, isGroup) {
    const client = WhatsAppClient.getClient(clientId);
    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const chatId = this.formatChatId(tel, isGroup);
    const chat = await client.getChatById(chatId);
    
    if (!chat) {
      throw new NotFoundError('Chat not found');
    }

    await chat.sendSeen();
  }

  /**
   * Mark chat as unread
   * @param {string} clientId - Client ID
   * @param {string} tel - Phone number
   * @param {boolean} isGroup - Is group chat
   */

  async markChatUnread(clientId, tel, isGroup) {
    const client = WhatsAppClient.getClient(clientId);
    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const chatId = this.formatChatId(tel, isGroup);
    const chat = await client.getChatById(chatId);
    
    if (!chat) {
      throw new NotFoundError('Chat not found');
    }

    await chat.markUnread();
  }

  /**
   * Fetch contacts with pagination
   * @param {number} page - Page number
   * @returns {Promise<Array>} Contacts list
   */
  
  async fetchContacts(page) {
    try {
      const clients = Array.from(WhatsAppClient.clients.values());

      if (!clients.length) {
        logger.error('No hay clientes de WhatsApp disponibles');
        return [];
      }

      const allContacts = await this.getAllContacts(clients);
      allContacts.sort((a, b) => a.name.localeCompare(b.name));
      
      const start = (page - 1) * this.CONTACTS_PER_PAGE;
      const end = start + this.CONTACTS_PER_PAGE;
      const paginatedContacts = allContacts.slice(start, end);

      return this.addProfilePictures(
        paginatedContacts, 
        clients
      );
    } catch (error) {
      logger.error('Error al obtener contactos:', error);
      return [];
    }
  }

  async getAllAuthenticatedAccountsInfo() {
    try {
      const authenticatedAccountsInfo = await WhatsAppClient.getAuthenticatedAccountsInfo();
      return authenticatedAccountsInfo;
    } catch (error) {
      logger.error('Error al obtener información de las cuentas autenticadas:', error);
      return [];
    }
  }
  

  async getAllContacts(clients) {
    const allContacts = await Promise.all(clients.map(async (client) => {
      try {
        const contacts = await client.getContacts();
        return contacts
          .filter(contact => !contact.isGroup && contact.isMyContact && !contact.id._serialized.endsWith('@lid'))
          .map(contact => ({
            id: contact.id._serialized,
            phone_number: contact.id.user,
            name: contact.name || contact.pushname || contact.id._serialized,
            clientNumber: client.options.authStrategy.clientId,
            clientId: client.id
          }));
      } catch (error) {
        logger.error(`Error obteniendo contactos para cliente ${client.id}:`, error);
        return [];
      }
    }));
  
    return allContacts.flat();
  }

  /**
 * Add profile pictures to contacts
 * @param {Array} contacts - Contact list
 * @param {Array} clients - WhatsApp clients
 * @returns {Promise<Array>} Contacts with profile pictures
 */
async addProfilePictures(contacts, clients) {
  return Promise.all(contacts.map(async (contact) => {
    try {
      const client = clients.find(c => c.id === contact.clientId);
      if (client) {
        contact.profilePicUrl = await client.getProfilePicUrl(contact.id) || this.getDefaultProfilePic();
      }
    } catch (error) {
      logger.error('Error al obtener la foto de perfil:', error);
      contact.profilePicUrl = this.getDefaultProfilePic();
    }
    return contact;
  }));
}

/**
 * Get default profile picture URL
 * @returns {string} Default profile picture URL
 */
getDefaultProfilePic() {
  return 'https://cdn.playbuzz.com/cdn/913253cd-5a02-4bf2-83e1-18ff2cc7340f/c56157d5-5d8e-4826-89f9-361412275c35.jpg';
}

  async getProfilePicture(client, id) {
    try {
      return await client.getProfilePicUrl(id);
    } catch (error) {
      return 'https://cdn.playbuzz.com/cdn/913253cd-5a02-4bf2-83e1-18ff2cc7340f/c56157d5-5d8e-4826-89f9-361412275c35.jpg';
    }
  }

  async getRecentMessageDate(chat) {
    const messages = await chat.fetchMessages({ limit: 1 });
    return messages.length > 0 ? messages[0].timestamp : 0;
  }

  async getGroupData(chat, client) {
    if (!chat.participants) return [];

    return Promise.all(chat.participants.map(async participant => {
      const contact = await client.getContactById(participant.id._serialized);
      return {
        id: participant.id._serialized,
        isAdmin: participant.isAdmin,
        isSuperAdmin: participant.isSuperAdmin,
        name: contact.name || contact.number
      };
    }));
  }

  // Part II ----------------------------------------------------------------------------------------------------------------

  /**
   * Ensure temp directory exists
   * @private
   */

  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error('Error creating temp directory:', error);
    }
  }

  /**
   * Get group chat messages
   * @param {string} number - Client number
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} Messages list
   */

  async getGroupChatMessages(number, groupId) {
    const client = WhatsAppClient.getClient(number);

    if (!client) throw new Error('Client not found');

    const chatId = `${groupId}@g.us`;
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 30 });

    return Promise.all(messages.map(msg => this.formatMessage(msg)));
  }

  
  async getChatMessages(clientId, tel) {
    const client = WhatsAppClient.getClient(clientId);

    if (!client) throw new Error('Client not found');

    const chatId = `${tel}@c.us`;
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 30 });

    return Promise.all(messages.map(msg => this.formatMessage(msg)));
  }

   /**
   * Send message to individual chat
   * @param {string} clientId - Client ID
   * @param {string} tel - Phone number
   * @param {string} message - Message content
   */

   async sendMessage(clientId, tel, message) {
    const client = await this.getClientById(clientId);
    const chatId = `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    await client.sendMessage(chatId, message);
  }

  /**
   * Send message to group chat
   * @param {string} clientId - Client ID
   * @param {string} groupId - Group ID
   * @param {string} message - Message content
   */

  async sendGroupMessage(clientId, groupId, message) {
    const client = await this.getClientById(clientId);
    const chatId = `${groupId}@g.us`;

    if (!client) throw new Error('Client not found');

    const groupChat = await client.getChatById(chatId);
    if (!groupChat) {
      throw new NotFoundError('Group not found');
    }

    await client.sendMessage(chatId, message);
  }

  /**
   * Send file or message
   * @param {Object} params - Message parameters
   */

  async sendMessageOrFile(params) {
    const { clientId, chatId, message, filePath } = params;
    const client = await this.getClientById(clientId);

    if (!client) throw new Error('Client not found');

    const isGroup = chatId.endsWith('@g.us');

    if (filePath) {
      await this.sendFile(client, chatId, filePath);
    } else if (message) {
      await client.sendMessage(chatId, message);
    } else {
      throw new ValidationError('Message or file path required');
    }
  }

  /**
   * Send media message (sticker/image)
   * @param {Object} params - Media message parameters
   */

  async sendMediaMessage(params) {
    const { clientId, tel, mediaPath, isGroup, type } = params;
    const client = await this.getClientById(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    if (!await fs.access(mediaPath).then(() => true).catch(() => false)) {
      throw new ValidationError('Media file not found');
    }

    const media = MessageMedia.fromFilePath(mediaPath);
    const options = type === 'sticker' ? { sendMediaAsSticker: true } : {};
    await client.sendMessage(chatId, media, options);
  }

  /**
   * Send product message with image
   * @param {Object} params - Product message parameters
   */

  async sendProductMessage(params) {
    const { clientId, tel, message, image, isGroup } = params;
    const client = await this.getClientById(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    const media = await this.processBase64Image(image);
    await client.sendMessage(chatId, message, { media });
  }

  async sendMessageProductGroup(params) {
    const { clientId, tel, message, image, isGroup } = params;
    const client = await this.getClientById(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    if (!isGroup) {
      const numberDetails = await client.getNumberId(chatId);
      if (!numberDetails) {
        throw new NotFoundError('Phone number not found');
      }
    }

    const media = await this.processBase64Image(image);
    await client.sendMessage(chatId, message, { media });
  }

  /**
   * Reply to message
   * @param {Object} params - Reply parameters
   */
  async replyToMessage(params) {
    const { clientId, tel, messageId, reply, isGroup } = params;
    const client = await this.getClientById(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 10000 });
    const message = messages.find(msg => msg.id._serialized === messageId);

    if (!message) throw new Error('Mensaje no encontrado');

    await chat.sendMessage(reply, { quotedMessageId: message.id._serialized });
  }

  /**
   * Delete message
   * @param {Object} params - Delete parameters
   */
  async deleteMessage(params) {
    const { clientId, tel, messageId, forEveryone, isGroup } = params;
    const client = await this.getClientById(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 10000 });
    const message = messages.find(msg => msg.id._serialized === messageId);

    if (!message) throw new Error('Mensaje no encontrado');

    await message.delete(forEveryone);
  }

  /**
   * Forward message
   * @param {Object} params - Forward parameters
   */
  async forwardMessage(params) {
    const {clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo} = params;
    const client = whatsapp.getClient(clientId);
    const fromChatId = isGroupFrom ? `${fromTel}@g.us` : `${fromTel}@c.us`;
    const toChatId = isGroupTo ? `${toTel}@g.us` : `${toTel}@c.us`;

    if (!client) throw new Error('Client not found');

    const fromChat = await client.getChatById(fromChatId);
    const messages = await fromChat.fetchMessages({ limit: 10000 });
    const message = messages.find(msg => msg.id._serialized === messageId);

    if (!message) throw new Error('Mensaje no encontrado');

    await message.forward(toChatId);
  }

  /**
   * Mark message as important
   * @param {Object} params - Mark message parameters
   */
  async markMessageAsImportant(params){
    const {clientId, tel, messageId, isGroup} = params;	
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 1000 });
    const message = messages.find(msg => msg.id._serialized === messageId);

    if (!message) throw new Error('Mensaje no encontrado');

    await message.star();
  }

  /**
   * Unmark message
   * @param {Object} params - Unmark message parameters
   */
  async unmarkMessageAsImportant(params){
    const {clientId, tel, messageId, isGroup} = params;
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Client not found');

    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 1000 });
    const message = messages.find(msg => msg.id._serialized === messageId);

    if (!message) throw new Error('Mensaje no encontrado');

    await message.unstar();
  }

  /**
   * Edit message
   * @param {Object} params - Edit parameters
   */
  async editMessage (params) {
    const {clientId, tel, messageId, newContent, isGroup} = params;
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Cliente no encontrado.');
  
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 1000 });
    const message = messages.find(msg => msg.id._serialized === messageId);
  
    if (!message) throw new Error('Mensaje no encontrado.');
  
    await message.edit(newContent);
  }
  
  /**
   * Mute chat
   * @param {Object} params - Mute chat parameters
   */
  async muteChat (params) {
    const {clientId, tel, isGroup, unmuteDate} = params;
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Cliente no encontrado.');

    await client.muteChat(chatId, unmuteDate ? new Date(unmuteDate) : null);
  }

  /**
   * Pin chat
   * @param {Object} params - Pin chat parameters
   */
  async pinChat (params) {
    const {clientId, tel, isGroup} = params;
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Cliente no encontrado.');
    
    await client.pinChat(chatId);
  }
  
  /**
   * Unpin chat
   * @param {Object} params - Unpin chat parameters
   */
  async unpinChat (params) {
    const {clientId, tel, isGroup} = params;
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

    if (!client) throw new Error('Cliente no encontrado.');
  
    await client.unpinChat(chatId);
  }

  async sendMessageWithMention (params) {
    const {clientId, tel, isGroup, mentionTel, message} = params;
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;
    const mentionId = `${mentionTel}@c.us`;

    if (!client) throw new Error('Cliente no encontrado.');

    const chat = await client.getChatById(chatId);
    await chat.sendMessage(message, { mentions: [{ id: mentionId }] });
  };

  async getMessageInfo (params){
    const {clientId, tel, messageId, isGroup} = params;
    const client = whatsapp.getClient(clientId);
    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;
    
    if (!client) throw new Error('Cliente no encontrado.');
  
    try {
      const chat = await client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit: 10000 });
      const message = messages.find(msg => msg.id._serialized === messageId);
  
      if (!message) {
        throw new Error('Mensaje no encontrado.');
      }
  
      return {
        id: message.id._serialized,
        body: message.body,
        type: message.type,
        timestamp: message.timestamp,
        from: message.from,
        to: message.to,
      };
    } catch (error) {
      throw new Error(`Error al obtener información del mensaje: ${error.message}`);
    }
  };
  
  // Helper methods (Metodos estaticos) ----------------------------------------------------------------------------------------------------------------
  formatContactNumber(number) {
    return number.includes('@c.us') ? number : `${number}@c.us`;
  }

  formatChatId(tel, isGroup) {
    return isGroup ? `${tel}@g.us` : `${tel}@c.us`;
  }

  getDefaultChatData(chat, client) {
    return {
      ...chat,
      recentMessageDate: 0,
      profilePicUrl: 'https://cdn.playbuzz.com/cdn/913253cd-5a02-4bf2-83e1-18ff2cc7340f/c56157d5-5d8e-4826-89f9-361412275c35.jpg',
      groupData: [],
      client: client.options.authStrategy.clientId
    };
  }

  // Private helper methods
  /**
   * Get client by ID
   * @private
   */
  async getClientById(clientId) {
    const client = WhatsAppClient.getClient(clientId);
  
    if (!client) {
      throw new NotFoundError('Client not found');
    }

    return client;
  }

  /**
   * Format message with media and encryption
   * @private
   */
  async formatMessage(message) {
    const formattedMessage = {
      id: message.id._serialized,
      body: message.body || '-',
      timestamp: message.timestamp,
      from: message.from,
      to: message.to,
      fromMe: message.fromMe,
      hasMedia: message.hasMedia,
      mediaType: message.type,
      mediaMimeType: message._data.mimetype,
      caption: message.caption || null,
      hasQuotedMsg: message.hasQuotedMsg,
      quotedParticipant: message._data.quotedParticipant || null,
      quotedStanzaID: message._data.quotedStanzaID || null,
      quotedMsg: message._data.quotedMsg || null,
      isStarred: message.isStarred,
      isForwarded: message.isForwarded
    };

    if (message.hasMedia) {
      const mediaData = await this.processMessageMedia(message);
      Object.assign(formattedMessage, mediaData);
    }

    if (message.location) {
      formattedMessage.location = {
        latitude: message.location.latitude,
        longitude: message.location.longitude,
        description: message.location.description || null
      };
    }

    return formattedMessage;
  }

  /**
   * Process message media
   * @private
   */
  async processMessageMedia(message) {
    const media = await this.attemptDownloadMedia(message);
    if (!media) return {};

    const mediaData = {
      mediaType: message.type,
      mediaMimeType: media.mimetype,
      caption: message.caption || null
    };

    if (['sticker', 'image', 'audio', 'ptt'].includes(message.type)) {
      mediaData.mediaBase64 = `data:${media.mimetype};base64,${media.data}`;
    } else if (['document', 'video'].includes(message.type)) {
      const extension = path.extname(media.filename) || `.${media.mimetype.split('/')[1]}`;
      const tempPath = await this.saveTempMedia(message.id._serialized, extension, media.data);
      mediaData.mediaTempUrl = `http://localhost:5000/temp/${path.basename(tempPath)}`;
    }

    return mediaData;
  }

  /**
   * Process base64 image
   * @private
   */
  async processBase64Image(imageData) {
    let base64Data = imageData;
    if (imageData.startsWith('data:image/')) {
      base64Data = imageData.split(',')[1];
    }

    if (!base64Data) {
      throw new ValidationError('Invalid base64 image data');
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    if (imageBuffer.length === 0) {
      throw new ValidationError('Empty image data');
    }

    const tempPath = path.join(this.tempDir, `temp_${Date.now()}.jpg`);
    await fs.writeFile(tempPath, imageBuffer);

    try {
      const media = MessageMedia.fromFilePath(tempPath);
      await fs.unlink(tempPath);
      return media;
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Attempt to download media with retries 
   * @private
   */
  async attemptDownloadMedia(message, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const media = await message.downloadMedia();
        if (media) return media;
      } catch (error) {
        logger.error(`Media download attempt ${i + 1} failed:`, error);
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    return null;
  }

  /**
   * Save temporary media file
   * @private
   */
  async saveTempMedia(id, extension, data) {
    const tempPath = path.join(this.tempDir, `media_${id}${extension}`);
    await fs.writeFile(tempPath, Buffer.from(data, 'base64'));
    return tempPath;
  }


}

module.exports = WhatsAppService;