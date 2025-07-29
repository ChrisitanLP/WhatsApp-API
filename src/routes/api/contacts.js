// routes/api/messaging.js - Rutas de mensajería
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/contactController');
const { ValidationMiddleware, ValidationRules } = require('../../middleware/rules');
const { contactRateLimit } = require('../../middleware/core/rateLimiting');
const { asyncHandler } = require('../../utils/asyncHandler');

// Rate limiting para mensajería
router.use(contactRateLimit);

// Envío de mensajes
router.post(
    '/getContacts', 
    ValidationMiddleware.validate(ValidationRules.contacts.list),
    asyncHandler(controller.getContacts)
);

router.post(
    '/saveContact', 
    ValidationMiddleware.validate(ValidationRules.contacts.save),
    asyncHandler(controller.saveContact)
);

module.exports = router;