// routes/api/clients.js - Rutas de gestión de clientes
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/mediaController');
const { ValidationMiddleware, ValidationRules } = require('../../middleware/rules');
const { mediaRateLimit } = require('../../middleware/core/rateLimiting');
const { asyncHandler } = require('../../utils/asyncHandler');

// Rate limiting específico para clientes (operaciones más restrictivas)
router.use(mediaRateLimit);

router.get(
    '/sendImage', 
    ValidationMiddleware.validate(ValidationRules.media.sendImage),
    asyncHandler(controller.sendImage)
);

router.get(
    '/sendSticker', 
    ValidationMiddleware.validate(ValidationRules.media.sendSticker),
    asyncHandler(controller.sendSticker)
);

router.get(
    '/sendFile', 
    ValidationMiddleware.validate(ValidationRules.media.sendFile),
    asyncHandler(controller.sendMessageOrFile)
);

router.get(
    '/sendMessageorFile', 
    ValidationMiddleware.validate(ValidationRules.media.sendFileWithContent),
    asyncHandler(controller.sendMessageOrFile)
);

router.get(
    '/sendMessageProducts', 
    ValidationMiddleware.validate(ValidationRules.media.sendProduct),
    asyncHandler(controller.sendMessageProduct)
);

router.get(
    '/sendGroupProducts', 
    ValidationMiddleware.validate(ValidationRules.media.sendProductGroup),
    asyncHandler(controller.sendMessageProductGroup)
);

module.exports = router;