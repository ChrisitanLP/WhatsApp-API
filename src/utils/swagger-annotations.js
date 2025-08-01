// src/utils/swagger-annotations.js
// Anotaciones JSDoc adicionales para Swagger
/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check del sistema
 *     description: Verifica el estado de salud del sistema
 *     responses:
 *       200:
 *         description: Sistema saludable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok, warning, error]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 version:
 *                   type: string
 *       503:
 *         description: Sistema con problemas
 */

/**
 * @swagger
 * /metrics:
 *   get:
 *     tags: [Health]
 *     summary: Métricas del sistema
 *     description: Obtiene métricas detalladas del sistema
 *     responses:
 *       200:
 *         description: Métricas obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contacts:
 *                   type: object
 *                 timestamp:
 *                   type: integer
 *                 uptime:
 *                   type: number
 *                 memory:
 *                   type: object
 *                 environment:
 *                   type: string
 */