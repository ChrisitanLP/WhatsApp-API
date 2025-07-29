// routes/api/clients.js - Rutas de gestión de clientes
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/controllers');
const { ValidationMiddleware, ValidationRules } = require('../../middleware/rules');
const { statusRateLimit } = require('../../middleware/core/rateLimiting');
const { asyncHandler } = require('../../utils/asyncHandler');

// Rate limiting específico para clientes (operaciones más restrictivas)
router.use(statusRateLimit);

// Rutas de gestión de clientes
router.get(
    '/getListen', 
    ValidationMiddleware.validate(ValidationRules.status.listen),
    asyncHandler(controller.getClientStatus)
);

module.exports = router;