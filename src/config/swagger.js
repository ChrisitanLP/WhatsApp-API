// src/config/swagger.js
const swaggerJSDoc = require('swagger-jsdoc');
const path = require('path');

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'WhatsApp Business API Integration',
        version: '1.2.1',
        description: `
            Esta API RESTful proporciona una integración escalable entre WhatsApp Web y sistemas ERP empresariales, específicamente diseñada para Odoo.

            Características Principales:
                * Gestión de Sesiones
                    - Autenticación mediante códigos QR
                    - Manejo automático de reconexiones
                    - Monitoreo en tiempo real del estado de conexión
                    - Soporte para múltiples cuentas WhatsApp simultaneas

                * Mensajería Avanzada
                    - Envío de mensajes de texto, multimedia y documentos
                    - Soporte para mensajes grupales y menciones
                    - Reenvío, respuesta y edición de mensajes
                    - Gestión de estados de lectura y mensajes importantes

                * Administración de Contactos
                    - Sincronización automática de contactos
                    - Gestión de grupos y participantes
                    - Búsqueda y filtrado avanzado
                    - Integración con libreta de direcciones empresarial

                * Archivos Multimedia
                    - Envío de imágenes, videos, audio y documentos
                    - Soporte for stickers y emojis animados
                    - Gestión automática de formatos y compresión
                    - Validación de tamaños y tipos de archivo

            Seguridad y Cumplimiento:
                - Validación estricta de parámetros de entrada
                - Sanitización automática de datos
                - Logging de auditoría completo
                - Cumplimiento con políticas de WhatsApp Business

            Rate Limiting y Políticas:
                - Límite general: 1000 requests/hora por IP
                - Endpoints críticos: 100 requests/hora
                - Timeout: 30 segundos por operación
                - Retry Policy: 3 intentos con backoff exponencial
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
                description: 'Estructura estándar de respuesta de la API - Utilizada en todos los endpoints',
                properties: {
                    success: {
                        type: 'boolean',
                        description: 'Indica si la operación fue exitosa',
                        example: true
                    },
                    message: {
                        type: 'string',
                        description: 'Mensaje descriptivo del resultado de la operación',
                        example: 'Operación completada exitosamente'
                    },
                    data: {
                        type: 'object',
                        description: 'Datos específicos de la respuesta (estructura variable según endpoint)',
                        nullable: true,
                        example: {}
                    },
                    error: {
                        type: 'string',
                        description: 'Descripción detallada del error (solo presente cuando success=false)',
                        nullable: true,
                        example: null
                    },
                    requestId: {
                        type: 'string',
                        description: 'Identificador único de la petición para trazabilidad y debugging',
                        pattern: '^[a-zA-Z0-9_]+_[0-9]{13}_[a-zA-Z0-9]+$',
                        example: 'client_add_1640995200000_abc123def'
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Marca temporal ISO 8601 del momento de procesamiento',
                        example: '2024-01-15T10:30:45.123Z'
                    }
                },
                required: ['success', 'message', 'requestId', 'timestamp'],
                additionalProperties: false
            },
            ErrorResponse: {
                type: 'object',
                description: 'Estructura estándar para respuestas de error de la API',
                properties: {
                    success: {
                        type: 'boolean',
                        enum: [false],
                        description: 'Siempre false para errores',
                        example: false
                    },
                    message: {
                        type: 'string',
                        description: 'Mensaje de error legible para el usuario',
                        example: 'Cliente WhatsApp no encontrado o no autenticado'
                    },
                    error: {
                        type: 'string',
                        description: 'Descripción técnica detallada del error',
                        example: 'Client with number 5931234567890 is not authenticated or ready'
                    },
                    requestId: {
                        type: 'string',
                        description: 'ID único para rastrear el error en logs',
                        example: 'error_1640995200000_xyz789'
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Momento exacto en que ocurrió el error',
                        example: '2024-01-15T10:31:15.789Z'
                    },
                    details: {
                        type: 'object',
                        description: 'Información adicional del error (solo en modo desarrollo)',
                        nullable: true,
                        example: null
                    }
                },
                required: ['success', 'message', 'error', 'requestId', 'timestamp'],
                additionalProperties: false
            },
            // Esquemas específicos de WhatsApp
            ClientInfo: {
                type: 'object',
                description: 'Información completa del estado de un cliente WhatsApp autenticado',
                properties: {
                    number: {
                        type: 'string',
                        description: 'Número de teléfono del cliente WhatsApp (formato internacional sin símbolos)',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '5931234567890'
                    },
                    isAuthenticated: {
                        type: 'boolean',
                        description: 'Estado de autenticación con WhatsApp Web',
                        example: true
                    },
                    isReady: {
                        type: 'boolean',
                        description: 'Indica si el cliente está listo para enviar/recibir mensajes',
                        example: true
                    },
                    lastActivity: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Timestamp de la última actividad registrada del cliente',
                        example: '2024-01-15T10:25:30.456Z'
                    },
                    profileName: {
                        type: 'string',
                        description: 'Nombre del perfil de WhatsApp Business',
                        maxLength: 100,
                        example: 'Mi Empresa S.A.'
                    },
                    display_name: {
                        type: 'string',
                        description: 'Nombre mostrado alternativo (alias interno)',
                        maxLength: 100,
                        example: 'Empresa Principal'
                    },
                    status: {
                        type: 'string',
                        enum: ['authenticated', 'connecting', 'disconnected', 'initializing'],
                        description: 'Estado actual de la conexión',
                        example: 'authenticated'
                    }
                },
                required: ['number', 'isAuthenticated', 'isReady'],
                additionalProperties: false
            },
            MessageData: {
                type: 'object',
                description: 'Estructura requerida para envío de mensajes de texto a contactos individuales',
                properties: {
                    clientId: {
                        type: 'string',
                        description: 'Número del cliente WhatsApp emisor (debe estar autenticado)',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '5931234567890'
                    },
                    tel: {
                        type: 'string',
                        description: 'Número destinatario en formato internacional (sin @c.us)',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '593987654321'
                    },
                    mensaje: {
                        type: 'string',
                        description: 'Contenido del mensaje de texto (emojis soportados)',
                        minLength: 1,
                        maxLength: 65536,
                        example: 'Hola, este es un mensaje desde nuestra API empresarial 👋'
                    },
                    isGroup: {
                        type: 'boolean',
                        description: 'DEBE ser false para mensajes individuales (usar sendGroupMessage para grupos)',
                        default: false,
                        example: false
                    }
                },
                required: ['clientId', 'tel', 'mensaje'],
                additionalProperties: false
            },
            ContactData: {
                type: 'object',
                description: 'Información requerida para guardar un nuevo contacto en WhatsApp',
                properties: {
                    clientNumber: {
                        type: 'string',
                        description: 'Número del cliente WhatsApp donde se guardará el contacto',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '5931234567890'
                    },
                    contactNumber: {
                        type: 'string',
                        description: 'Número del contacto a guardar (formato internacional sin @c.us)',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '593987654321'
                    },
                    contactName: {
                        type: 'string',
                        description: 'Nombre descriptivo del contacto (será visible en WhatsApp)',
                        minLength: 1,
                        maxLength: 100,
                        example: 'Juan Pérez - Cliente VIP'
                    }
                },
                required: ['clientNumber', 'contactNumber', 'contactName'],
                additionalProperties: false
            },
            MediaData: {
                type: 'object',
                description: 'Configuración para envío de archivos multimedia (imágenes, videos, documentos)',
                properties: {
                    clientId: {
                        type: 'string',
                        description: 'Número del cliente WhatsApp emisor',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '5931234567890'
                    },
                    tel: {
                        type: 'string',
                        description: 'Número destinatario (sin @c.us para individuales)',
                        pattern: '^[1-9][0-9]{7,14}$',
                        example: '593987654321'
                    },
                    filePath: {
                        type: 'string',
                        description: 'Ruta absoluta del archivo en el servidor (debe ser accesible)',
                        pattern: '^[/\\\\].*\\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|mp4|mp3|wav)$',
                        example: '/var/media/uploads/documento_importante.pdf'
                    },
                    caption: {
                        type: 'string',
                        description: 'Texto descriptivo opcional para acompañar el archivo',
                        maxLength: 1024,
                        example: 'Documento adjunto solicitado - Confidencial'
                    },
                    isGroup: {
                        type: 'boolean',
                        description: 'true si el destinatario es un grupo',
                        default: false,
                        example: false
                    }
                },
                required: ['clientId', 'tel', 'filePath'],
                additionalProperties: false
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