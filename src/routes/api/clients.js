// routes/api/clients.js - Rutas de gestión de clientes
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/clientController');
const { ValidationMiddleware, ValidationRules } = require('../../middleware/rules');
const { strictRateLimit } = require('../../middleware/core/rateLimiting');
const { validateClientId } = require('../../middleware/core/security');
const { asyncHandler } = require('../../utils/asyncHandler');

// Rate limiting específico para clientes (operaciones más restrictivas)
router.use(strictRateLimit);

// Rutas de gestión de clientes
router.get(
    '/qr/:number', 
    ValidationMiddleware.validate(ValidationRules.client.getQr),
    asyncHandler(controller.getQrCode)
);

router.get(
    '/status/:number', 
    ValidationMiddleware.validate(ValidationRules.client.getStatus),
    asyncHandler(controller.getClientStatus)
);

router.get(
    '/status_connection/:number', 
    ValidationMiddleware.validate(ValidationRules.client.getStatus),
    asyncHandler(controller.getConnectionStatus)
);

router.post(
    '/addClient', 
    ValidationMiddleware.validate(ValidationRules.client.add),
    asyncHandler(controller.addClient)
);

router.post(
    '/removeClient', 
    ValidationMiddleware.validate(ValidationRules.client.remove),
    validateClientId,
    asyncHandler(controller.removeClient)
);

router.get(
    '/authenticated-accounts', 
    ValidationMiddleware.validate(ValidationRules.clients?.authenticatedAccounts || {}),
    asyncHandler(controller.getAllAuthenticatedAccountsInfo)
);

module.exports = router;