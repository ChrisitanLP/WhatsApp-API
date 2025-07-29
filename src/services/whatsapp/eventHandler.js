// services/whatsapp/EventHandler.js
const { EventEmitter } = require('events');
const qrcode = require('qrcode-terminal');
const logger = require('../../config/logger').logger;

/**
 * Manejo exclusivo de eventos de WhatsApp
 */
class EventHandler extends EventEmitter {
    setupClientEvents(client, number) {
        const events = {
            qr: (qr) => this.handleQr(number, qr),
            ready: () => this.handleReady(number),
            authenticated: () => this.handleAuthenticated(number),
            auth_failure: (msg) => this.handleAuthFailure(number, msg),
            message: (message) => this.handleMessage(number, message),
            disconnected: (reason) => this.handleDisconnected(number, reason),
            // Eventos adicionales del código original que faltan
            contact_changed: (msg, oldId, newId, isContact) => 
                this.handleContactChanged(number, oldId, newId, isContact),
            group_admin_changed: (notification) => 
                this.handleGroupAdminChanged(number, notification),
            group_join: (notification) => 
                this.handleGroupJoin(number, notification),
            group_leave: (notification) => 
                this.handleGroupLeave(number, notification),
            message_reaction: (reaction) => 
                this.handleMessageReaction(number, reaction)
        };

        Object.entries(events).forEach(([event, handler]) => {
            client.on(event, handler);
        });
    }

    handleQr(number, qr) {
        console.log(`QR para ${number}:`);
        qrcode.generate(qr, { small: true });
        this.emit('qrUpdated', number, qr);
    }

    handleReady(number) {
        logger.info(`Client ${number} is ready`);
        this.emit('clientReady', number);
    }

    handleAuthenticated(number) {
        logger.info(`Client ${number} authenticated`);
        this.emit('clientAuthenticated', number);
    }

    handleAuthFailure(number, message) {
        logger.error(`Auth failure for ${number}:`, message);
        this.emit('clientAuthFailure', number, message);
    }

    handleMessage(number, message) {
        try {
            if (message.from === 'status@broadcast') {
                this.emit('statusMessage', number, message);
                return;
            }
            this.emit('messageReceived', number, message);
        } catch (error) {
            logger.error(`Error processing message for ${number}:`, error);
        }
    }

    handleDisconnected(number, reason) {
        logger.warn(`Client ${number} disconnected:`, reason);
        this.emit('clientDisconnected', number, reason);
    }

    // Eventos de grupo que faltaban
    handleContactChanged(number, oldId, newId, isContact) {
        this.emit('contactChanged', { number, oldId, newId, isContact });
    }

    handleGroupAdminChanged(number, notification) {
        this.emit('groupAdminChanged', { number, notification });
    }

    handleGroupJoin(number, notification) {
        this.emit('groupJoin', { number, notification });
    }

    handleGroupLeave(number, notification) {
        this.emit('groupLeave', { number, notification });
    }

    handleMessageReaction(number, reaction) {
        this.emit('messageReaction', { number, reaction });
    }
}

module.exports = EventHandler;