const fs = require('fs').promises;
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const BaseWhatsAppService = require('./baseService');
const { NotFoundError, ValidationError } = require('../../utils/asyncHandler');

/**
 * Message Service - Handles message operations
 */
class MessageService extends BaseWhatsAppService {
    constructor() {
        super();
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

        const groupChat = await client.getChatById(chatId);
        if (!groupChat) {
        throw new NotFoundError('Group not found');
        }

        await client.sendMessage(chatId, message);
    }

    /**
     * Send message with mention
     * @param {Object} params - Message with mention parameters
     */
    async sendMessageWithMention(params) {
        const { clientId, tel, isGroup, mentionTel, message } = params;
        const client = await this.getClientById(clientId);
        const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;
        const mentionId = `${mentionTel}@c.us`;

        const chat = await client.getChatById(chatId);
        await chat.sendMessage(message, { mentions: [{ id: mentionId }] });
    }

    /**
     * Reply to message
     * @param {Object} params - Reply parameters
     */
    async replyToMessage(params) {
        const { clientId, tel, messageId, reply, isGroup } = params;
        const client = await this.getClientById(clientId);
        const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

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
        const { clientId, fromTel, toTel, messageId, isGroupFrom, isGroupTo } = params;
        const client = await this.getClientById(clientId);
        const fromChatId = isGroupFrom ? `${fromTel}@g.us` : `${fromTel}@c.us`;
        const toChatId = isGroupTo ? `${toTel}@g.us` : `${toTel}@c.us`;

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
    async markMessageAsImportant(params) {
        const { clientId, tel, messageId, isGroup } = params;
        const client = await this.getClientById(clientId);
        const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 1000 });
        const message = messages.find(msg => msg.id._serialized === messageId);

        if (!message) throw new Error('Mensaje no encontrado');

        await message.start();
    }

    /**
     * Unmark message as important
     * @param {Object} params - Unmark message parameters
     */
    async unmarkMessageAsImportant(params) {
        const {clientId, tel, messageId, isGroup} = params;
        const client = this.whatsAppClient.getClient(clientId);
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
    async editMessage(params) {
        const {clientId, tel, messageId, newContent, isGroup} = params;
        const client = this.whatsAppClient.getClient(clientId);
        const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

        if (!client) throw new Error('Cliente no encontrado.');

        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 1000 });
        const message = messages.find(msg => msg.id._serialized === messageId);

        if (!message) throw new Error('Mensaje no encontrado.');

        await message.edit(newContent);
    }

    /**
     * Get message info
     * @param {Object} params - Message info parameters
     * @returns {Promise<Object>} Message information
     */
    async getMessageInfo(params) {
        const {clientId, tel, messageId, isGroup} = params;
        const client = this.whatsAppClient.getClient(clientId);
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
    }
}

module.exports = MessageService;