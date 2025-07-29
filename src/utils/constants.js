// src/utils/constants.js
module.exports = {
    // HTTP Status Codes
    HTTP_STATUS: {
        OK: 200,
        ACCEPTED: 202,
        BAD_REQUEST: 400,
        NOT_FOUND: 404,
        INTERNAL_SERVER_ERROR: 500
    },

    // Default Pagination
    PAGINATION: {
        DEFAULT_PAGE: 1,
        DEFAULT_LIMIT: 10,
        MIN_PAGE: 1
    },

    // Response Messages
    MESSAGES: {
        SUCCESS: {
            CLIENT_ADDED: 'Client added successfully',
            CLIENT_REMOVED: 'Client removed successfully',
            CONTACT_SAVED: 'Contact saved successfully',
            CHAT_MARKED_READ: 'Chat marked as read',
            CHAT_MARKED_UNREAD: 'Chat marked as unread',
            MESSAGE_SENT: 'Message sent successfully',
            GROUP_MESSAGE_SENT: 'Group message sent successfully',
            FILE_SENT: 'File sent successfully',
            STICKER_SENT: 'Sticker sent successfully',
            IMAGE_SENT: 'Image sent successfully',
            PRODUCT_MESSAGE_SENT: 'Product message sent successfully',
            REPLY_SENT: 'Respuesta enviada correctamente.',
            MESSAGE_DELETED: 'Mensaje eliminado correctamente.',
            MESSAGE_FORWARDED: 'Mensaje reenviado correctamente.',
            MESSAGE_STARRED: 'Mensaje destacado.',
            MESSAGE_UNSTARRED: 'Mensaje No destacado.',
            MESSAGE_EDITED: 'Mensaje editado exitosamente.',
            CHAT_MUTED: 'Chat silenciado correctamente.',
            MESSAGE_WITH_MENTION: 'Mensaje enviado correctamente con mención.',
            MESSAGE_INFO_RETRIEVED: 'Información del mensaje obtenido.'
        },
        ERROR: {
            QR_NOT_AVAILABLE: 'QR code not available',
            QR_GENERATION_IN_PROGRESS: 'QR code generation in progress, please try again shortly',
            INVALID_PAGE_NUMBER: 'Número de página inválido',
            INTERNAL_SERVER_ERROR: 'Error interno del servidor.'
        },
        VALIDATION: {
            NUMBER_REQUIRED: 'Number is required',
            CLIENT_NUMBER_REQUIRED: 'Client number is required',
            CONTACT_DATA_REQUIRED: 'Client number, contact number, and contact name are required',
            CLIENT_ID_TEL_REQUIRED: 'Client ID and telephone number are required'
        }
    }
};