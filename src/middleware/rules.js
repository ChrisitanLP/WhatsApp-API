// middleware/validation/rules.js
const { Validators } = require('./validation/validator')
const { Sanitizers } = require('./validation/sanitizers');
const { ValidationMiddleware } = require('./validation/middleware');

/**
 * Reglas de validación organizadas por dominio
 */
const ValidationRules = {
    // Cliente Management
    client: {
        add: [
            Validators.phoneNumber('number')
        ],
        remove: [
            Validators.phoneNumber('number')
        ],
        getQr: [
            Validators.paramPhoneNumber('number')
        ],
        getStatus: [
            Validators.paramPhoneNumber('number')
        ],
        getConnection: [
            Validators.paramPhoneNumber('number')
        ]
    },

    // Contact Management
    contacts: {
        list: Validators.pagination(),
        save: [
            Validators.phoneNumber('clientNumber'),
            Validators.phoneNumber('contactNumber'),
            Validators.contactName('contactName')
        ]
    },

    // Chat Management
    chats: {
        list: Validators.pagination(),
        unread: Validators.pagination(),
        markRead: [
            Validators.paramClientId(),
            Validators.paramPhoneNumber('tel'),
            Validators.paramBoolean('isGroup')
        ],
        markUnread: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.boolean('isGroup')
        ],
        pin: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.boolean('isGroup')
        ],
        unpin: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.boolean('isGroup')
        ],
        mute: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.boolean('isGroup'),
            Validators.isoDate('unmuteDate')
        ],
        getMessages: [
            Validators.clientId(),
            Validators.phoneNumber('tel')
        ],
        getGroupMessages: [
            Validators.paramPhoneNumber('number'),
            Validators.paramClientId('groupId')
        ]
    },

    // Messaging
    messaging: {
        send: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.message('mensaje'),
            Validators.boolean('isGroup')
        ],
        sendGroup: [
            Validators.clientId(),
            Validators.groupId(),
            Validators.message('mensaje')
        ],
        reply: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.messageId(),
            Validators.message('reply'),
            Validators.boolean('isGroup')
        ],
        forward: [
            Validators.clientId(),
            Validators.phoneNumber('fromTel'),
            Validators.phoneNumber('toTel'),
            Validators.messageId(),
            Validators.boolean('isGroup'),
            Validators.boolean('isGroupTo')
        ],
        delete: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.messageId(),
            Validators.boolean('isGroup')
        ],
        markImportant: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.messageId(),
            Validators.boolean('isGroup')
        ],
        unmarkImportant: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.messageId(),
            Validators.boolean('isGroup')
        ],
        edit: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.messageId(),
            Validators.string('newContent'),
            Validators.boolean('isGroup')
        ],
        getMessageInfo: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.messageId(),
            Validators.boolean('isGroup')
        ],
        sendWithMention: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.boolean('isGroup'),
            Validators.phoneNumber('mentionTel'),
            Validators.message('message')
        ]
    },

    // Media
    media: {
        sendImage: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.string('imagePath'),
            Validators.boolean('isGroup')
        ],
        sendSticker: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.string('stickerPath'),
            Validators.boolean('isGroup')
        ],
        sendFile: [
            Validators.clientId(),
            Validators.chatId(),
            Validators.optionalString('message'),
            Validators.filePath()
        ],
        sendFileWithContent: [
            Validators.clientId(),
            Validators.chatId(),
            Validators.optionalString('message'),
            Validators.fileName(),
            Validators.fileContent(),
            Validators.boolean('isGroup')
        ],
        sendProduct: [
            Validators.clientId(),
            Validators.phoneNumber('tel'),
            Validators.message('mensaje'),
            Validators.base64Media('imagen')
        ],
        sendProductGroup: [
            Validators.clientId(),
            Validators.groupId(),
            Validators.message('mensaje'),
            Validators.base64Media('imagen')
        ]
    }
};

module.exports = {
    Validators,
    Sanitizers,
    ValidationMiddleware,
    ValidationRules
};