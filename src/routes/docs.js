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
            :root {
                --primary-color: #1abc9c;
                --primary-dark: #16a085;
                --secondary-color: #3498db;
                --accent-color: #2c3e50;
                --background-light: #f8f9fa;
                --background-dark: #2c3e50;
                --text-primary: #2c3e50;
                --text-secondary: #5a6c7d;
                --border-color: #e0e6ed;
                --success-color: #27ae60;
                --warning-color: #f39c12;
                --error-color: #e74c3c;
                --shadow-sm: 0 2px 4px rgba(0,0,0,0.1);
                --shadow-md: 0 4px 8px rgba(0,0,0,0.12);
                --shadow-lg: 0 8px 16px rgba(0,0,0,0.15);
                --radius-sm: 4px;
                --radius-md: 8px;
                --radius-lg: 12px;
            }

            /* Reset y base styles */
            .swagger-ui {
                font-family: 'Inter', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
                line-height: 1.6;
                color: var(--text-primary);
            }

            /* Header personalizado */
            .swagger-ui .topbar {
                background: linear-gradient(135deg, var(--background-dark) 0%, #34495e 50%, var(--primary-color) 100%);
                border-bottom: 3px solid var(--primary-color);
                box-shadow: var(--shadow-md);
                padding: 1rem 0;
            }
            
            .swagger-ui .topbar .download-url-wrapper { 
                display: none; 
            }

            .swagger-ui .topbar-wrapper .link {
                color: white;
                font-weight: 600;
                font-size: 1.2em;
            }

            /* Información de la API */
            .swagger-ui .info {
                margin: 2rem 0;
                padding: 2.5rem;
                background: linear-gradient(135deg, #ffffff 0%, var(--background-light) 100%);
                border: 1px solid var(--border-color);
                border-left: 6px solid var(--primary-color);
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-sm);
                position: relative;
            }

            .swagger-ui .info::before {
                content: '';
                position: absolute;
                top: 0;
                right: 0;
                width: 100px;
                height: 100px;
                background: linear-gradient(45deg, transparent 30%, var(--primary-color) 30%, var(--primary-color) 70%, transparent 70%);
                opacity: 0.1;
                border-radius: 0 var(--radius-lg) 0 50px;
            }
            
            .swagger-ui .info .title {
                color: var(--accent-color);
                font-size: 2.5em;
                font-weight: 700;
                margin-bottom: 1rem;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
            }
            
            .swagger-ui .info .description {
                color: var(--text-secondary);
                font-size: 1em;
                line-height: 1.8;
            }

            .swagger-ui .info .description h1 {
                color: var(--accent-color);
                font-size: 1.8em;
                margin: 1.5rem 0 1rem 0;
                border-bottom: 2px solid var(--primary-color);
                padding-bottom: 0.5rem;
            }

            .swagger-ui .info .description h2 {
                color: var(--secondary-color);
                font-size: 1.4em;
                margin: 1.2rem 0 0.8rem 0;
            }

            .swagger-ui .info .description h3 {
                color: var(--primary-dark);
                font-size: 1.2em;
                margin: 1rem 0 0.5rem 0;
            }

            /* ===== TABLAS MEJORADAS ===== */
            .swagger-ui .info .description table {
                width: 100%;
                border-collapse: collapse;
                margin: 1rem 0;
                background: white;
                border-radius: var(--radius-md);
                overflow: hidden;
                box-shadow: var(--shadow-sm);
            }

            .swagger-ui .info .description table thead {
                background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
                color: white;
            }

            .swagger-ui .info .description table th,
            .swagger-ui .info .description table td {
                padding: 1rem;
                text-align: left;
                border-bottom: 1px solid var(--border-color);
            }

            .swagger-ui .info .description table th {
                font-weight: 600;
                font-size: 0.9em;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .swagger-ui .info .description table tbody tr:hover {
                background-color: rgba(26, 188, 156, 0.05);
            }

            /* ===== BLOQUES DE CÓDIGO ===== */
            .swagger-ui .info .description pre {
                background: rgba(200, 206, 204, 0.1);
                padding: 0.1rem;
                border-radius: var(--radius-md);
                overflow-x: auto;
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
                font-size: 0.9em;
                box-shadow: var(--shadow-sm);
            }

            .swagger-ui .info .description code {
                background: rgba(200, 206, 204, 0.1);
                color: var(--accent-color);
                padding: 0.45rem 0.9rem;
                border-radius: var(--radius-sm);
                font-family: 'JetBrains Mono', monospace;
                font-size: 1em;
            }

            /* ===== SEPARADORES Y LÍNEAS ===== */
            .swagger-ui .info .description hr {
                border: none;
                height: 2px;
                background: linear-gradient(90deg, var(--primary-color) 0%, transparent 100%);
                margin: 2rem 0;
            }

            /* Configuración de servidores */
            .swagger-ui .scheme-container {
                background: linear-gradient(135deg, #ecf0f1 0%, #d5dbdb 100%);
                border: 1px solid var(--border-color);
                border-radius: var(--radius-md);
                padding: 1.5rem;
                margin: 2rem 0;
                box-shadow: var(--shadow-sm);
            }

            .swagger-ui .scheme-container .schemes-title {
                color: var(--accent-color);
                font-weight: 600;
                margin-bottom: 1rem;
            }

            /* Tags de operaciones */
            .swagger-ui .opblock-tag {
                background: linear-gradient(135deg, #f1f3f3ff 0%, #dfe3e6ff 100%);
                color: var(--accent-color);
                border-radius: var(--radius-md);
                padding: 1rem 1.5rem;
                margin: 1.5rem 0;
                font-size: 1.3em;
                font-weight: 700;
                border-left: 6px solid var(--primary-color);
                box-shadow: var(--shadow-sm);
                cursor: pointer;
                transition: all 0.3s ease;
            }

            .swagger-ui .opblock-tag:hover {
                transform: translateX(5px);
                box-shadow: var(--shadow-md);
            }

            /* Operaciones HTTP */
            .swagger-ui .opblock {
                border-radius: var(--radius-md);
                box-shadow: var(--shadow-sm);
                margin-bottom: 1rem;
                border: 1px solid var(--border-color);
                overflow: hidden;
                transition: all 0.2s ease;
            }

            .swagger-ui .opblock:hover {
                box-shadow: var(--shadow-md);
            }

            .swagger-ui .opblock.opblock-post {
                border-left: 6px solid var(--success-color);
            }

            .swagger-ui .opblock.opblock-post .opblock-summary {
                border-color: var(--success-color);
            }
            
            .swagger-ui .opblock.opblock-get {
                border-left: 6px solid var(--secondary-color);
            }

            .swagger-ui .opblock.opblock-get .opblock-summary {
                border-color: var(--secondary-color);
            }

            .swagger-ui .opblock.opblock-put {
                border-left: 6px solid var(--warning-color);
            }

            .swagger-ui .opblock.opblock-put .opblock-summary {
                border-color: var(--warning-color);
            }

            .swagger-ui .opblock.opblock-delete {
                border-left: 6px solid var(--error-color);
            }

            .swagger-ui .opblock.opblock-delete .opblock-summary {
                border-color: var(--error-color);
            }

            /* ===== BOTONES ===== */
            .swagger-ui .btn {
                border-radius: var(--radius-sm);
                font-weight: 600;
                padding: 0.75rem 1.5rem;
                transition: all 0.2s ease;
                font-size: 0.9em;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .swagger-ui .btn.authorize {
                background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
                border: none;
                color: white;
                box-shadow: var(--shadow-sm);
            }
            
            .swagger-ui .btn.authorize:hover {
                transform: translateY(-2px);
                box-shadow: var(--shadow-md);
            }
            
            .swagger-ui .btn.execute {
                background: linear-gradient(135deg, var(--secondary-color) 0%, #2980b9 100%);
                border: none;
                color: white;
                box-shadow: var(--shadow-sm);
            }
            
            .swagger-ui .btn.execute:hover {
                transform: translateY(-2px);
                box-shadow: var(--shadow-md);
            }

            /* ===== RESPUESTAS Y SCHEMAS ===== */
            .swagger-ui .responses-inner {
                background: var(--background-light);
                border-radius: var(--radius-md);
                padding: 1.5rem;
                border: 1px solid var(--border-color);
            }

            .swagger-ui .model-box {
                background: white;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-md);
                padding: 1.5rem;
            }

            /* ===== PARÁMETROS ===== */
            .swagger-ui .parameters-col_description {
                color: var(--text-secondary);
                font-size: 0.95em;
                line-height: 1.5;
            }

            .swagger-ui .parameter__name {
                font-weight: 700;
                color: var(--accent-color);
                font-family: 'JetBrains Mono', monospace;
            }

            .swagger-ui .parameter__type {
                color: var(--primary-dark);
                font-family: 'JetBrains Mono', monospace;
                background: rgba(26, 188, 156, 0.1);
                padding: 0.2rem 0.4rem;
                border-radius: var(--radius-sm);
                font-size: 0.8em;
            }

            /* ===== TABLAS GENERALES ===== */
            .swagger-ui table {
                border-collapse: collapse;
                width: 100%;
            }

            .swagger-ui table thead tr th {
                background: linear-gradient(135deg, var(--background-light) 0%, #e8f4f8 100%);
                color: var(--accent-color);
                font-weight: 700;
                border-bottom: 2px solid var(--primary-color);
                padding: 1rem;
                text-transform: uppercase;
                font-size: 0.85em;
                letter-spacing: 0.5px;
            }

            .swagger-ui table tbody tr td {
                padding: 0.75rem 1rem;
                border-bottom: 1px solid var(--border-color);
            }

            .swagger-ui table tbody tr:nth-child(even) {
                background-color: rgba(248, 249, 250, 0.5);
            }

            .swagger-ui table tbody tr:hover {
                background-color: rgba(26, 188, 156, 0.05);
            }

            /* ===== ELEMENTOS OCULTOS ===== */
            .swagger-ui .info .base-url,
            .swagger-ui .download-url-wrapper {
                display: none;
            }

            /* ===== RESPONSIVE ===== */
            @media (max-width: 768px) {
                .swagger-ui .info {
                    margin: 1rem 0;
                    padding: 1.5rem;
                }
                
                .swagger-ui .info .title {
                    font-size: 2em;
                }
                
                .swagger-ui .opblock-tag {
                    padding: 0.75rem 1rem;
                    font-size: 1.1em;
                }
            }

            /* ===== ANIMACIONES SUTILES ===== */
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .swagger-ui .opblock {
                animation: fadeIn 0.3s ease-out;
            }

            /* ===== MEJORAS DE ACCESIBILIDAD ===== */
            .swagger-ui button:focus,
            .swagger-ui input:focus,
            .swagger-ui select:focus {
                outline: 2px solid var(--primary-color);
                outline-offset: 2px;
            }

            /* ===== STATUS INDICATORS ===== */
            .swagger-ui .response-col_status {
                font-weight: 700;
            }

            .swagger-ui .response-col_status[data-code^="2"] {
                color: var(--success-color);
            }

            .swagger-ui .response-col_status[data-code^="4"],
            .swagger-ui .response-col_status[data-code^="5"] {
                color: var(--error-color);
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
                schemasCount: schemaCount
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