// utils/messageProcessor.js
const mime = require('mime-types');
const { logger } = require('../config/logger');

class MessageProcessor {
    async processMessage(number, message) {
        try {
            if (message.hasMedia) return await this.processMediaMessage(number, message);
            if (message.type === 'location') return this.processLocationMessage(number, message);
            return this.processTextMessage(number, message);
        } catch (error) {
            logger.error('Error processing message:', error);
            throw error;
        }
    }

    async processMediaMessage(number, message) {
        try {
            const media = await Promise.race([
                message.downloadMedia(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Media download timeout')), 10000))
            ]);

            if (!media) throw new Error('Failed to download media');

            const mimeType = mime.lookup(media.mimetype) || 'application/octet-stream';
            const extension = mime.extension(mimeType) || 'bin';

            return {
                number,
                media: {
                    media: {
                        filename: `media_${message.id._serialized}.${extension}`,
                        base64Data: media.data,
                        mimetype: media.mimetype
                    }
                },
                message
            };
        } catch (error) {
            logger.error(`Error processing media message from ${number}:`, error);
            throw error;
        }
    }

    processLocationMessage(number, message) {
        return {
            number,
            location: {
                location: {
                    latitude: message.location.latitude,
                    longitude: message.location.longitude,
                    description: message.location.description || 'Sin descripción',
                    address: message.location.address || 'Sin dirección',
                    name: message.location.name || 'Sin nombre'
                }
            },
            message
        };
    }

    processTextMessage(number, message) {
        return { number, message };
    }
}

const messageProcessor = new MessageProcessor();
module.exports = messageProcessor;