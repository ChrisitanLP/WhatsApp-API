// src/config/swagger.js
const swaggerJSDoc = require('swagger-jsdoc');
const path = require('path');

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'WhatsApp API',
        version: '1.2.1',
        description: `
            API RESTful desarrollada para la integración entre WhatsApp Web y el sistema ERP Odoo. 
            Permite la gestión centralizada de sesiones de WhatsApp, envío y recepción de mensajes, administración de contactos, archivos multimedia y operaciones relacionadas con clientes, todo desde un único entorno de backend.

            Esta API ha sido diseñada con un enfoque modular, escalable y orientado a la trazabilidad de las comunicaciones digitales empresariales. Provee endpoints bien documentados que facilitan la automatización de tareas de mensajería, soporte al cliente, seguimiento comercial y sincronización con módulos internos de Odoo.

            Entre sus funcionalidades clave se incluyen:

            - Registro y control de sesiones de WhatsApp usando 'whatsapp-web.js'.
            - Envío de mensajes de texto, imágenes, archivos y stickers.
            - Gestión de chats activos, contactos y conversaciones.
            - Integración con catálogos de productos y respuestas automáticas.
            - Control de reconexión de sesiones y estado en tiempo real.
            - Métricas para supervisión del comportamiento de uso.

            Todos los endpoints están documentados utilizando el estándar OpenAPI 3.0, lo que permite su exploración y prueba directa desde esta interfaz. Esta documentación está pensada tanto para desarrolladores como para equipos técnicos que deseen extender o integrar nuevas funcionalidades de mensajería en su infraestructura.

            Uso recomendado: familiarizarse con los esquemas ('schemas') definidos en la parte inferior, ya que representan las estructuras de datos comunes en los distintos endpoints.
            `
    },
    servers: [
        {
            url: process.env.API_BASE_URL || 'http://localhost:5000',
            description: 'Servidor de desarrollo'
        }
    ],
    components: {
        schemas: {
        // Esquemas comunes
            ApiResponse: {
                type: 'object',
                properties: {
                    success: {
                        type: 'boolean',
                        description: 'Indica si la operación fue exitosa',
                        example: true
                    },
                    message: {
                        type: 'string',
                        description: 'Mensaje descriptivo de la respuesta',
                        example: 'Operación completada exitosamente'
                    },
                    data: {
                        type: 'object',
                        description: 'Datos de respuesta (opcional)',
                        example: {}
                    },
                    error: {
                        type: 'string',
                        description: 'Mensaje de error (si aplica)',
                        example: null
                    },
                    requestId: {
                        type: 'string',
                        description: 'ID único de la petición para seguimiento',
                        example: '1640995200000_abc123def'
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Marca temporal de la respuesta',
                        example: '2024-01-01T12:00:00.000Z'
                    }
                },
                required: ['success', 'message']
            },
            ErrorResponse: {
                type: 'object',
                properties: {
                    success: {
                        type: 'boolean',
                        example: false
                    },
                    message: {
                        type: 'string',
                        description: 'Mensaje de error'
                    },
                    error: {
                        type: 'string',
                        description: 'Detalles del error'
                    }
                }
            },
            // Esquemas específicos de WhatsApp
            ClientInfo: {
                type: 'object',
                description: 'Información completa del cliente WhatsApp',
                properties: {
                    number: {
                        type: 'string',
                        description: 'Número de teléfono del cliente WhatsApp',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '1234567890'
                    },
                    isAuthenticated: {
                        type: 'boolean',
                        description: 'Estado de autenticación del cliente',
                        example: true
                    },
                    isReady: {
                        type: 'boolean',
                        description: 'Estado de disponibilidad para envío de mensajes',
                        example: true
                    },
                    lastActivity: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Última actividad registrada',
                        example: '2024-01-01T12:00:00.000Z'
                    },
                    profileName: {
                        type: 'string',
                        description: 'Nombre del perfil de WhatsApp',
                        example: 'Mi Empresa'
                    }
                },
                required: ['number', 'isAuthenticated', 'isReady']
            },
            MessageData: {
                type: 'object',
                description: 'Estructura para envío de mensajes de texto',
                properties: {
                    clientId: {
                        type: 'string',
                        description: 'Número del cliente WhatsApp que enviará el mensaje',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '1234567890'
                    },
                    tel: {
                        type: 'string',
                        description: 'Número de teléfono destinatario (con código de país)',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '521234567890'
                    },
                    mensaje: {
                        type: 'string',
                        description: 'Contenido del mensaje de texto',
                        minLength: 1,
                        maxLength: 65536,
                        example: 'Hola, este es un mensaje de prueba desde la API'
                    },
                    isGroup: {
                        type: 'boolean',
                        description: 'Indica si el destinatario es un grupo',
                        default: false,
                        example: false
                    }
                },
                required: ['clientId', 'tel', 'mensaje']
            },
            ContactData: {
                type: 'object',
                description: 'Información para guardar un contacto',
                properties: {
                    clientNumber: {
                        type: 'string',
                        description: 'Número del cliente WhatsApp',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '1234567890'
                    },
                    contactNumber: {
                        type: 'string',
                        description: 'Número del contacto a guardar',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '521234567890'
                    },
                    contactName: {
                        type: 'string',
                        description: 'Nombre del contacto',
                        minLength: 1,
                        maxLength: 100,
                        example: 'Juan Pérez'
                    }
                },
                required: ['clientNumber', 'contactNumber', 'contactName']
            },
            MediaData: {
                type: 'object',
                description: 'Estructura para envío de archivos multimedia',
                properties: {
                    clientId: {
                        type: 'string',
                        description: 'ID del cliente WhatsApp',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '1234567890'
                    },
                    tel: {
                        type: 'string',
                        description: 'Número destinatario',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '521234567890'
                    },
                    filePath: {
                        type: 'string',
                        description: 'Ruta del archivo multimedia o URL',
                        example: '/media/imagen.jpg'
                    },
                    caption: {
                        type: 'string',
                        description: 'Texto descriptivo del archivo (opcional)',
                        maxLength: 1024,
                        example: 'Esta es una imagen de ejemplo'
                    },
                    isGroup: {
                        type: 'boolean',
                        description: 'Si es para un grupo',
                        default: false,
                        example: false
                    }
                },
                required: ['clientId', 'tel', 'filePath']
            }
        },
        responses: {
            Success: {
                description: 'Operación exitosa',
                content: {
                    'application/json': {
                        schema: {
                        $ref: '#/components/schemas/ApiResponse'
                        }
                    }
                }
            },
            BadRequest: {
                description: 'Petición inválida',
                content: {
                    'application/json': {
                        schema: {
                        $ref: '#/components/schemas/ErrorResponse'
                        }
                    }
                }
            },
            NotFound: {
                description: 'Recurso no encontrado',
                content: {
                    'application/json': {
                        schema: {
                        $ref: '#/components/schemas/ErrorResponse'
                        }
                    }
                }
            },
            ServerError: {
                description: 'Error interno del servidor',
                content: {
                    'application/json': {
                        schema: {
                        $ref: '#/components/schemas/ErrorResponse'
                        }
                    }
                }
            },
            TooManyRequests: {
                description: 'Demasiadas peticiones',
                content: {
                    'application/json': {
                        schema: {
                            allOf: [
                                { $ref: '#/components/schemas/ErrorResponse' },
                                {
                                    type: 'object',
                                    properties: {
                                        retryAfter: {
                                            type: 'integer',
                                            description: 'Segundos antes de reintentar'
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        },
        parameters: {
            ClientNumber: {
                name: 'number',
                in: 'path',
                required: true,
                description: 'Número del cliente WhatsApp',
                schema: {
                    type: 'string',
                    pattern: '^[1-9][0-9]{7,14}$'
                }
            },
            Page: {
                name: 'page',
                in: 'query',
                description: 'Número de página para paginación',
                schema: {
                    type: 'integer',
                    minimum: 1,
                    default: 1
                }
            },
            Limit: {
                name: 'limit',
                in: 'query',
                description: 'Cantidad de elementos por página',
                schema: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 100,
                    default: 20
                }
            }
        }
    },
    tags: [
        {
            name: 'Clients',
            description: '**Gestión de Clientes WhatsApp**\n\nOperaciones para administrar clientes WhatsApp, incluyendo autenticación, estados de conexión y gestión del ciclo de vida de los clientes.\n\n**Flujo típico:**\n1. Registrar cliente con `addClient`\n2. Obtener código QR con `getQrCode`\n3. Verificar autenticación con `getConnectionStatus`\n4. Usar cliente para operaciones de mensajería'
        },
        {
            name: 'Messages', 
            description: '**Envío y Gestión de Mensajes**\n\nFuncionalidades completas para el envío, reenvío, respuesta y gestión de mensajes de texto.\n\n**Capacidades:**\n- Mensajes individuales y grupales\n- Mensajes con menciones\n- Reenvío de mensajes existentes\n- Respuestas contextuales\n- Edición y eliminación de mensajes'
        },
        {
            name: 'Chats',
            description: '**Gestión de Conversaciones**\n\nAdministración completa de conversaciones, incluyendo historial de mensajes, estados de lectura y organización de chats.\n\n**Funcionalidades:**\n- Listado de conversaciones activas\n- Historial de mensajes por conversación\n- Gestión de estados de lectura\n- Organización y filtrado de chats'
        },
        {
            name: 'Contacts',
            description: '**Administración de Contactos**\n\nGestión de la libreta de contactos sincronizada con WhatsApp.\n\n**Operaciones disponibles:**\n- Sincronización de contactos existentes\n- Adición de nuevos contactos\n- Búsqueda y filtrado de contactos\n- Gestión de información de contacto'
        },
        {
            name: 'Media',
            description: '**Archivos Multimedia**\n\nEnvío y gestión de archivos multimedia incluyendo imágenes, videos, documentos y stickers.\n\n**Formatos soportados:**\n- Imágenes: JPG, PNG, GIF, WebP\n- Videos: MP4, 3GP, MOV\n- Audio: MP3, AAC, OGG, OPUS\n- Documentos: PDF, DOC, XLS, PPT\n- Stickers: WebP animados'
        },
        {
            name: 'Health',
            description: '**Monitoreo y Métricas**\n\nEndpoints para monitoreo del sistema, métricas de rendimiento y diagnóstico de problemas.\n\n**Información disponible:**\n- Estado de salud de servicios\n- Métricas de rendimiento en tiempo real\n- Diagnóstico de conectividad\n- Estadísticas de uso de la API'
        }
    ]
};

const options = {
    definition: swaggerDefinition,
    apis: [
        path.join(__dirname, '../routes/*.js'),
        path.join(__dirname, '../routes/api/*.js'),
        path.join(__dirname, '../controllers/*.js'),
        path.join(__dirname, '../utils/swagger-annotations.js') // Para anotaciones adicionales
    ]
};

const swaggerSpec = swaggerJSDoc(options);

// Función para generar documentación automática desde routeGroups
const generateSwaggerFromRouteGroups = (routeGroups) => {
    const paths = {};
    
    Object.entries(routeGroups).forEach(([groupName, group]) => {
        const { routes } = group;
        
        routes.forEach(route => {
            const { path: routePath, method, handler } = route;
            const fullPath = routePath.replace(/:([^/]+)/g, '{$1}'); // Convertir :param a {param}
            
            if (!paths[fullPath]) {
                paths[fullPath] = {};
            }
            
            // Mapear handlers a tags
            const tagMap = {
                client: 'Clients',
                message: 'Messages',
                chat: 'Chats',
                contact: 'Contacts',
                media: 'Media'
            };
            
            const tag = Object.keys(tagMap).find(key => handler.toLowerCase().includes(key)) || 'General';
            
            paths[fullPath][method] = {
                tags: [tagMap[tag] || 'General'],
                summary: generateSummary(handler),
                description: generateDescription(handler, routePath),
                operationId: handler,
                parameters: extractParameters(routePath),
                responses: {
                    '200': { $ref: '#/components/responses/Success' },
                    '400': { $ref: '#/components/responses/BadRequest' },
                    '404': { $ref: '#/components/responses/NotFound' },
                    '429': { $ref: '#/components/responses/TooManyRequests' },
                    '500': { $ref: '#/components/responses/ServerError' }
                }
            };
            
            // Agregar requestBody si es POST/PUT/PATCH
            if (['post', 'put', 'patch'].includes(method)) {
                paths[fullPath][method].requestBody = generateRequestBody(handler);
            }
        });
    });
    
    return paths;
};

// Funciones auxiliares para generación automática
const generateSummary = (handler) => {
    const summaries = {
        // Clientes
        'getQrCode': 'Obtener código QR para autenticación de cliente',
        'getConnectionStatus': 'Verificar estado de conexión del cliente',
        'addClient': 'Registrar nuevo cliente WhatsApp',
        'removeClient': 'Eliminar cliente WhatsApp existente',
        'getClientStatus': 'Consultar estado detallado del cliente',
        'getAllAuthenticatedAccountsInfo': 'Listar todos los clientes autenticados',
        
        // Mensajería
        'sendMessage': 'Enviar mensaje de texto a contacto individual',
        'sendGroupMessage': 'Enviar mensaje de texto a grupo',
        'sendMessageWithMention': 'Enviar mensaje con mención a usuarios específicos',
        'forwardMessage': 'Reenviar mensaje existente',
        'replyToMessage': 'Responder a mensaje específico',
        'deleteMessage': 'Eliminar mensaje enviado',
        'editMessage': 'Editar mensaje enviado (si es compatible)',
        
        // Contactos
        'getContacts': 'Obtener lista de contactos del cliente',
        'saveContact': 'Guardar nuevo contacto en WhatsApp',
        
        // Media
        'sendImage': 'Enviar imagen con descripción opcional',
        'sendSticker': 'Enviar sticker o emoji animado',
        'sendMessageOrFile': 'Enviar archivo multimedia (imagen, video, audio, documento)',
        
        // Chats
        'getChats': 'Obtener lista de conversaciones activas',
        'getUnreadChats': 'Obtener conversaciones con mensajes no leídos',
        'getChatMessages': 'Obtener historial de mensajes de una conversación',
        'markChatAsRead': 'Marcar conversación como leída'
    };
    
    return summaries[handler] || `Operación: ${handler}`;
};

const generateDescription = (handler, path) => {
    const descriptions = {
        'getQrCode': 'Genera y retorna el código QR necesario para autenticar un cliente WhatsApp. El cliente debe escanear este código desde su aplicación móvil.',
        'getConnectionStatus': 'Verifica el estado actual de conexión de un cliente específico, incluyendo si está autenticado y listo para enviar mensajes.',
        'addClient': 'Registra un nuevo cliente WhatsApp en el sistema. Este proceso inicia la generación del código QR para autenticación.',
        'sendMessage': 'Envía un mensaje de texto a un contacto individual. Requiere que el cliente esté autenticado y el número de destino sea válido.',
        'getContacts': 'Recupera la lista completa de contactos sincronizados del cliente WhatsApp especificado.'
    };
    
    return descriptions[handler] || `Endpoint para realizar la operación ${handler} en la ruta ${path}`;
};

const extractParameters = (routePath) => {
    const params = [];
    const pathParams = routePath.match(/:([^/]+)/g);
    
    if (pathParams) {
        pathParams.forEach(param => {
            const paramName = param.slice(1);
            params.push({
                name: paramName,
                in: 'path',
                required: true,
                schema: { type: 'string' },
                description: `Parámetro ${paramName}`
            });
        });
    }
    
    return params;
};

const generateRequestBody = (handler) => {
    const bodySchemas = {
        'addClient': {
        type: 'object',
        required: ['number'],
        properties: {
            number: { type: 'string', description: 'Número de teléfono' }
        }
        },
        'sendMessage': {
            $ref: '#/components/schemas/MessageData'
        },
        'saveContact': {
            $ref: '#/components/schemas/ContactData'
        },
        'sendImage': {
            $ref: '#/components/schemas/MediaData'
        }
    };
    
    return {
        required: true,
        content: {
        'application/json': {
            schema: bodySchemas[handler] || {
                type: 'object',
                description: 'Datos de la petición'
            }
        }
        }
    };
};

// Middleware para servir documentación
const setupSwaggerMiddleware = (app) => {
    const swaggerUi = require('swagger-ui-express');
    
    // Configuración personalizada de Swagger UI - Diseño sobrio y profesional
    const swaggerUiOptions = {
        explorer: true,
        swaggerOptions: {
            docExpansion: 'list', // Expandir solo las operaciones, no los modelos
            filter: true,
            showRequestDuration: true,
            tryItOutEnabled: true,
            requestSnippetsEnabled: true,
            defaultModelsExpandDepth: 1,
            defaultModelExpandDepth: 1,
            displayOperationId: false, // Ocultar IDs técnicos
            displayRequestDuration: true,
            showExtensions: false,
            showCommonExtensions: false,
            deepLinking: true,
            tagsSorter: 'alpha',
            operationsSorter: 'alpha'
        },
        customCss: `
            /* Reset y base styles */
            .swagger-ui {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
            }

            /* Header personalizado */
            .swagger-ui .topbar {
                background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
                border-bottom: 2px solid #1abc9c;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .swagger-ui .topbar .download-url-wrapper { 
                display: none; 
            }

            /* Información de la API */
            .swagger-ui .info {
                margin: 30px 0;
                padding: 25px;
                background: #f8f9fa;
                border-left: 4px solid #1abc9c;
                border-radius: 6px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }
            
            .swagger-ui .info .title {
                color: #2c3e50;
                font-size: 2.2em;
                font-weight: 600;
                margin-bottom: 10px;
            }
            
            .swagger-ui .info .description {
                color: #5a6c7d;
                font-size: 1.1em;
                line-height: 1.7;
            }

            /* Configuración de servidores */
            .swagger-ui .scheme-container {
                background: linear-gradient(135deg, #ecf0f1 0%, #bdc3c7 100%);
                border: 1px solid #95a5a6;
                color: #2c3e50;
                padding: 20px;
                border-radius: 8px;
                margin: 25px 0;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }

            /* Tags de operaciones */
            .swagger-ui .opblock-tag {
                background: #d4d9db;
                color: #000000;
                border-radius: 6px;
                padding: 12px 20px;
                margin: 15px 0;
                font-size: 1.2em;
                font-weight: 600;
                border-left: 4px solid #1abc9c;
            }

            /* Operaciones HTTP */
            .swagger-ui .opblock {
                border-radius: 6px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                margin-bottom: 15px;
                border: 1px solid #e0e0e0;
            }

            .swagger-ui .opblock.opblock-post {
                border-left: 4px solid #27ae60;
            }
            
            .swagger-ui .opblock.opblock-get {
                border-left: 4px solid #3498db;
            }
            
            .swagger-ui .opblock.opblock-put {
                border-left: 4px solid #f39c12;
            }
            
            .swagger-ui .opblock.opblock-delete {
                border-left: 4px solid #e74c3c;
            }

            /* Botones de acción */
            .swagger-ui .btn {
                border-radius: 4px;
                font-weight: 500;
                transition: all 0.2s ease;
            }

            .swagger-ui .btn.authorize {
                background-color: #1abc9c;
                border-color: #1abc9c;
                color: white;
            }
            
            .swagger-ui .btn.authorize:hover {
                background-color: #16a085;
                border-color: #16a085;
            }
            
            .swagger-ui .btn.execute {
                background-color: #3498db;
                border-color: #3498db;
                color: white;
            }
            
            .swagger-ui .btn.execute:hover {
                background-color: #2980b9;
                border-color: #2980b9;
            }

            /* Respuestas y schemas */
            .swagger-ui .responses-inner {
                background: #f8f9fa;
                border-radius: 6px;
                padding: 15px;
            }

            .swagger-ui .model-box {
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 6px;
                padding: 15px;
            }

            /* Parámetros */
            .swagger-ui .parameters-col_description {
                color: #5a6c7d;
                font-size: 0.95em;
            }

            /* Tablas */
            .swagger-ui table {
                border-collapse: collapse;
            }

            .swagger-ui table thead tr th {
                background: #ecf0f1;
                color: #2c3e50;
                font-weight: 600;
                border-bottom: 2px solid #bdc3c7;
            }

            /* Mejoras de legibilidad */
            .swagger-ui .parameter__name {
                font-weight: 600;
                color: #2c3e50;
            }

            .swagger-ui .parameter__type {
                color: #7f8c8d;
                font-family: 'Courier New', monospace;
            }

            /* Ocultar elementos innecesarios */
            .swagger-ui .info .base-url,
            .swagger-ui .download-url-wrapper {
                display: none;
            }

            /* Responsive adjustments */
            @media (max-width: 768px) {
                .swagger-ui .info {
                    margin: 15px 0;
                    padding: 20px 15px;
                }
                
                .swagger-ui .info .title {
                    font-size: 1.8em;
                }
            }
        `,
        customSiteTitle: "WhatsApp API - Documentación Técnica",
        customfavIcon: "/favicon.ico"
    };
    
    // Endpoint para JSON spec
    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
    
    // Swagger UI principal
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
    
    // Endpoint alternativo
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
};

module.exports = {
    swaggerSpec,
    setupSwaggerMiddleware,
    generateSwaggerFromRouteGroups
};