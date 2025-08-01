// src/routes/docs.js
const express = require('express');
const router = express.Router();
const swaggerUi = require('swagger-ui-express');
const { swaggerSpec } = require('../config/swagger');

// Configuración personalizada para esta ruta
const swaggerUiOptions = {
    explorer: true,
    swaggerOptions: {
        docExpansion: 'list', // Solo expandir operaciones principales
        filter: true,
        showRequestDuration: true,
        tryItOutEnabled: true,
        requestSnippetsEnabled: true,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        displayOperationId: false, // Ocultar IDs técnicos para simplicidad
        displayRequestDuration: true,
        showExtensions: false,
        showCommonExtensions: false,
        deepLinking: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        requestSnippets: {
            generators: {
                curl_bash: {
                    title: "cURL (Bash)",
                    syntax: "bash"
                },
                curl_powershell: {
                    title: "cURL (PowerShell)", 
                    syntax: "powershell"
                },
                javascript_fetch: {
                    title: "JavaScript (Fetch)",
                    syntax: "javascript"
                }
            }
        }
    },
    customCss: `
        /* Base profesional y sobrio */
        .swagger-ui {
            font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
            line-height: 1.5;
            color: #1f2937;
        }

        /* Header minimalista */
        .swagger-ui .topbar {
            background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
            border-bottom: 1px solid #d1d5db;
            padding: 12px 0;
        }
        
        .swagger-ui .topbar .download-url-wrapper { 
            display: none; 
        }

        /* Información de la API - diseño educativo */
        .swagger-ui .info {
            margin: 24px 0;
            padding: 24px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-left: 4px solid #059669;
            border-radius: 8px;
        }
        
        .swagger-ui .info .title {
            color: #111827;
            font-size: 1.875rem;
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: -0.025em;
        }
        
        .swagger-ui .info .description {
            color: #4b5563;
            font-size: 1rem;
            line-height: 1.625;
            margin-bottom: 16px;
        }

        /* Servidor y configuración */
        .swagger-ui .scheme-container {
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            color: #374151;
            padding: 16px;
            border-radius: 6px;
            margin: 20px 0;
        }

        .swagger-ui .scheme-container label {
            color: #1f2937;
            font-weight: 500;
        }

        /* Tags organizados por dominio */
        .swagger-ui .opblock-tag {
            background: #1f2937;
            color: white;
            border-radius: 6px;
            padding: 12px 16px;
            margin: 20px 0 16px 0;
            font-size: 1.125rem;
            font-weight: 600;
            letter-spacing: 0.025em;
        }

        .swagger-ui .opblock-tag:hover {
            background: #374151;
        }

        /* Operaciones HTTP con colores educativos */
        .swagger-ui .opblock {
            border-radius: 6px;
            border: 1px solid #e5e7eb;
            margin-bottom: 16px;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        }

        .swagger-ui .opblock.opblock-post {
            border-left: 4px solid #059669;
        }
        
        .swagger-ui .opblock.opblock-get {
            border-left: 4px solid #2563eb;
        }
        
        .swagger-ui .opblock.opblock-put {
            border-left: 4px solid #d97706;
        }
        
        .swagger-ui .opblock.opblock-delete {
            border-left: 4px solid #dc2626;
        }

        .swagger-ui .opblock .opblock-summary {
            padding: 12px 16px;
        }

        .swagger-ui .opblock .opblock-summary-description {
            color: #6b7280;
            font-size: 0.875rem;
            margin-top: 4px;
        }

        /* Botones con diseño consistente */
        .swagger-ui .btn {
            border-radius: 6px;
            font-weight: 500;
            font-size: 0.875rem;
            padding: 8px 16px;
            transition: all 0.15s ease;
            border: 1px solid transparent;
        }

        .swagger-ui .btn.authorize {
            background-color: #059669;
            border-color: #059669;
            color: white;
        }
        
        .swagger-ui .btn.authorize:hover {
            background-color: #047857;
            border-color: #047857;
        }
        
        .swagger-ui .btn.execute {
            background-color: #2563eb;
            border-color: #2563eb;
            color: white;
        }
        
        .swagger-ui .btn.execute:hover {
            background-color: #1d4ed8;
            border-color: #1d4ed8;
        }

        .swagger-ui .btn.try-out__btn {
            background-color: #6b7280;
            border-color: #6b7280;
            color: white;
        }

        .swagger-ui .btn.try-out__btn:hover {
            background-color: #4b5563;
            border-color: #4b5563;
        }

        /* Respuestas y ejemplos más legibles */
        .swagger-ui .responses-inner {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 16px;
        }

        .swagger-ui .response-col_description {
            color: #374151;
        }

        .swagger-ui .model-box {
            background: #ffffff;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 16px;
        }

        /* Parámetros con mejor estructura visual */
        .swagger-ui .parameters-col_description {
            color: #4b5563;
            font-size: 0.875rem;
        }

        .swagger-ui .parameter__name {
            font-weight: 600;
            color: #111827;
        }

        .swagger-ui .parameter__type {
            color: #6b7280;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 0.8125rem;
        }

        /* Tablas estructuradas */
        .swagger-ui table {
            border-collapse: collapse;
            width: 100%;
        }

        .swagger-ui table thead tr th {
            background: #f3f4f6;
            color: #1f2937;
            font-weight: 600;
            border-bottom: 1px solid #d1d5db;
            padding: 12px 8px;
            text-align: left;
        }

        .swagger-ui table tbody tr td {
            padding: 12px 8px;
            border-bottom: 1px solid #f3f4f6;
        }

        /* Códigos de ejemplo más legibles */
        .swagger-ui .highlight-code {
            background: #1f2937;
            color: #f9fafb;
            border-radius: 6px;
            padding: 16px;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 0.8125rem;
            line-height: 1.5;
        }

        /* Ocultar elementos innecesarios para diseño limpio */
        .swagger-ui .info .base-url,
        .swagger-ui .download-url-wrapper,
        .swagger-ui .scheme-container .schemes-title {
            display: none;
        }

        /* Responsive design */
        @media (max-width: 768px) {
            .swagger-ui .info {
                margin: 16px 0;
                padding: 16px;
            }
            
            .swagger-ui .info .title {
                font-size: 1.5rem;
            }
            
            .swagger-ui .opblock-tag {
                font-size: 1rem;
                padding: 10px 12px;
            }
        }

        /* Estados de carga y éxito */
        .swagger-ui .loading-container {
            padding: 40px;
            text-align: center;
            color: #6b7280;
        }

        .swagger-ui .response.success {
            border-left: 4px solid #059669;
        }

        .swagger-ui .response.error {
            border-left: 4px solid #dc2626;
        }
    `,
    customSiteTitle: "WhatsApp API - Documentación Técnica",
    customfavIcon: "/favicon.ico"
};


// Ruta principal para documentación
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Endpoint para obtener el JSON spec
router.get('/json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache por 1 hora
    res.send(swaggerSpec);
});

// Endpoint para descargar el spec en formato YAML
router.get('/yaml', (req, res) => {
    try {
        const yaml = require('js-yaml');
        const yamlString = yaml.dump(swaggerSpec, {
            noRefs: true,
            indent: 2,
            lineWidth: 120,
            noCompatMode: true
        });
       
        res.setHeader('Content-Type', 'application/x-yaml');
        res.setHeader('Content-Disposition', 'attachment; filename="whatsapp-api-spec.yaml"');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(yamlString);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to generate YAML specification',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint de información sobre la documentación
router.get('/info', (req, res) => {
    res.json({
        title: 'WhatsApp API - Documentación Técnica',
        description: 'Documentación interactiva completa para la integración con WhatsApp Business API',
        version: swaggerSpec.info?.version || '1.0.0',
        documentation: {
            interactive: '/docs',
            json: '/docs/json',
            yaml: '/docs/yaml'
        },
        capabilities: [
            'Documentación interactiva con ejemplos en vivo',
            'Pruebas de endpoints directamente desde la interfaz',
            'Esquemas de datos detallados y validaciones',
            'Ejemplos de peticiones y respuestas reales',
            'Generación automática de código para múltiples lenguajes',
            'Descarga de especificaciones en formato OpenAPI'
        ],
        domains: [
            'Gestión de Clientes WhatsApp',
            'Envío de Mensajes y Multimedia',
            'Administración de Contactos',
            'Gestión de Conversaciones y Chats',
            'Monitoreo y Métricas del Sistema'
        ],
        usage: {
            gettingStarted: 'Comience registrando un cliente con /addClient, luego obtenga el código QR con /qr/:number',
            authentication: 'Todos los endpoints requieren un cliente autenticado y conectado',
            rateLimit: 'Límites de velocidad aplicados por seguridad y estabilidad',
            support: 'Consulte los ejemplos en cada endpoint para implementación correcta'
        },
        generated: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    });
});

// Endpoint para validar el estado de la documentación
router.get('/health', (req, res) => {
    try {
        const isSpecValid = swaggerSpec && swaggerSpec.info && swaggerSpec.paths;
        const pathCount = Object.keys(swaggerSpec.paths || {}).length;
        const schemaCount = Object.keys(swaggerSpec.components?.schemas || {}).length;
        
        res.json({
            status: isSpecValid ? 'healthy' : 'unhealthy',
            documentation: {
                specVersion: swaggerSpec.openapi || 'unknown',
                apiVersion: swaggerSpec.info?.version || 'unknown',
                pathsCount: pathCount,
                schemasCount: schemaCount,
                hasInfo: !!swaggerSpec.info,
                hasServers: !!(swaggerSpec.servers?.length > 0)
            },
            endpoints: {
                interactive: '/docs',
                json: '/docs/json',
                yaml: '/docs/yaml',
                info: '/docs/info'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Documentation health check failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Middleware para manejar errores en las rutas de documentación
router.use((error, req, res, next) => {
    console.error('Error in documentation route:', error);
    
    // Log detallado para debugging
    const errorDetails = {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        url: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    };
    
    res.status(500).json({
        success: false,
        error: 'Documentation service error',
        message: 'Failed to load API documentation',
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
        supportInfo: {
            recommendation: 'Verifique que el archivo swagger.js esté correctamente configurado',
            fallback: 'Puede acceder al JSON spec en /docs/json para debugging'
        }
    });
});

module.exports = router;