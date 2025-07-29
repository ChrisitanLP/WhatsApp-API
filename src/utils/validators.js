// src/validators/index.js
const { ValidationError } = require('../utils/asyncHandler');

class BaseValidator {
    /**
     * Validar que un campo sea requerido
     */
    static required(value, fieldName) {
        if (!value || (typeof value === 'string' && value.trim() === '')) {
        throw new ValidationError(`${fieldName} is required`);
        }
    }

    /**
     * Validar número de teléfono básico
     */
    static phoneNumber(value, fieldName = 'Phone number') {
        this.required(value, fieldName);
        // Validación básica de formato de teléfono
        if (!/^\d{10,15}$/.test(value.replace(/\D/g, ''))) {
        throw new ValidationError(`${fieldName} must be a valid phone number`);
        }
    }

    /**
     * Validar página para paginación
     */
    static page(value) {
        const page = parseInt(value, 10);
        if (isNaN(page) || page < 1) {
        throw new ValidationError('Invalid page number');
        }
        return page;
    }

    /**
     * Validar límite para paginación
     */
    static limit(value, maxLimit = 100) {
        const limit = parseInt(value, 10);
        if (isNaN(limit) || limit < 1 || limit > maxLimit) {
        throw new ValidationError(`Limit must be between 1 and ${maxLimit}`);
        }
        return limit;
    }
}

// Validadores específicos para autenticación
class AuthValidators extends BaseValidator {
    static getQrCode(params) {
        const { number } = params;
        this.phoneNumber(number, 'Number');
        return { number };
    }

    static getClientStatus(params) {
        const { number } = params;
        this.phoneNumber(number, 'Number');
        return { number };
    }
}

// Validadores para clientes
class ClientValidators extends BaseValidator {
    static addClient(body) {
        const { number } = body;
        this.phoneNumber(number, 'Number');
        return { number };
    }

    static removeClient(body) {
        const { number } = body;
        this.phoneNumber(number, 'Client number');
        return { number };
    }
}

class ContactValidators extends BaseValidator {
    static pagination(query) {
        const page = query.page ? this.page(query.page) : 1;
        const limit = query.limit ? this.limit(query.limit) : 10;
        
        return { page, limit };
    }

    static saveContact(body) {
        const { clientNumber, contactNumber, contactName } = body;
        
        this.phoneNumber(clientNumber, 'Client number');
        this.phoneNumber(contactNumber, 'Contact number');
        this.required(contactName, 'Contact name');
        
        return { clientNumber, contactNumber, contactName };
    }
}

// Validadores para chats
class ChatValidators extends BaseValidator {
    static pagination(query) {
        const page = query.page ? this.page(query.page) : 1;
        const limit = query.limit ? this.limit(query.limit) : 10;
        
        return { page, limit };
    }

    static markChat(params, body = {}) {
        const { clientId, tel, isGroup } = params.clientId ? params : body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        
        return {
            clientId,
            tel,
            isGroup: isGroup === 'true' || isGroup === true
        };
    }

    static getChatMessages(params) {
        const { clientId, tel } = params;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        
        return { clientId, tel };
    }
}

class MediaValidators extends BaseValidator {
    static sendMedia(body) {
        const { clientId, tel, isGroup } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        
        return { clientId, tel, isGroup };
    }

    static sendImage(body) {
        const { clientId, tel, imagePath, isGroup } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        this.required(imagePath, 'Image path');
        
        return { clientId, tel, imagePath, isGroup };
    }

    static sendSticker(body) {
        const { clientId, tel, stickerPath, isGroup } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        this.required(stickerPath, 'Sticker path');
        
        return { clientId, tel, stickerPath, isGroup };
    }

    static sendMessageOrFile(body) {
        const { clientId, chatId, message, filePath } = body;
        
        this.required(clientId, 'Client ID');
        this.required(chatId, 'Chat ID');
        
        // Al menos uno de los dos debe estar presente
        if (!message && !filePath) {
            throw new ValidationError('Either message or filePath is required');
        }
        
        return { clientId, chatId, message, filePath };
    }

    static sendProductMessage(body) {
        const { clientId, tel, mensaje, imagen } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        this.required(mensaje, 'Message');
        this.required(imagen, 'Image');
        
        return { clientId, tel, mensaje, imagen };
    }

    static sendProductGroupMessage(body) {
        const { clientId, groupId, mensaje, imagen } = body;
        
        this.required(clientId, 'Client ID');
        this.required(groupId, 'Group ID');
        this.required(mensaje, 'Message');
        this.required(imagen, 'Image');
        
        return { clientId, groupId, mensaje, imagen };
    }
}

// Validadores para mensajes
class MessageValidators extends BaseValidator {
    static sendMessage(body) {
        const { clientId, tel, mensaje } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        this.required(mensaje, 'Message');
        
        return { clientId, tel, mensaje };
    }

    static sendGroupMessage(body) {
        const { clientId, groupId, mensaje } = body;
        
        this.required(clientId, 'Client ID');
        this.required(groupId, 'Group ID');
        this.required(mensaje, 'Message');
        
        return { clientId, groupId, mensaje };
    }

    static sendMedia(body) {
        const { clientId, tel, isGroup } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        
        return { clientId, tel, isGroup };
    }

    static replyToMessage(body) {
        const { clientId, tel, messageId, reply, isGroup } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        this.required(messageId, 'Message ID');
        this.required(reply, 'Reply message');
        
        return { clientId, tel, messageId, reply, isGroup };
    }

    static messageAction(body) {
        const { clientId, tel, messageId, isGroup } = body;
        
        this.required(clientId, 'Client ID');
        this.phoneNumber(tel, 'Telephone number');
        this.required(messageId, 'Message ID');
        
        return { clientId, tel, messageId, isGroup };
    }
}

module.exports = {
    BaseValidator,
    AuthValidators,
    ClientValidators,
    ChatValidators,
    MessageValidators,
    MediaValidators,
    ContactValidators
};