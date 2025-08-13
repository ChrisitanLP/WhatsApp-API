/**
* @swagger
* components:
*   schemas:
*     ApiResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           description: Indica si la operación fue exitosa
*         message:
*           type: string
*           description: Mensaje descriptivo de la operación
*     
*     ErrorResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: false
*         error:
*           type: string
*           description: Descripción del error
*         details:
*           type: object
*           description: Detalles adicionales del error (opcional)
*           properties:
*             requestId:
*               type: string
*               description: ID único de la petición
*             retryAfter:
*               type: integer
*               description: Segundos para reintentar (solo para rate limit)
*             details:
*               type: string
*               description: Detalles técnicos (solo en development)
*/

/**
* @swagger
* components:
*   schemas:
*     ChatMessage:
*       type: object
*       properties:
*         id:
*           type: string
*           description: ID único del mensaje
*         body:
*           type: string
*           description: Contenido del mensaje
*         timestamp:
*           type: integer
*           description: Timestamp del mensaje
*         from:
*           type: string
*           description: Remitente del mensaje
*         to:
*           type: string
*           description: Destinatario del mensaje
*         fromMe:
*           type: boolean
*           description: Si el mensaje es enviado por mí
*         hasMedia:
*           type: boolean
*           description: Si el mensaje tiene media
*         mediaType:
*           type: string
*           description: Tipo de media
*         mediaMimeType:
*           type: string
*           description: Tipo MIME de la media
*         caption:
*           type: string
*           description: Leyenda del mensaje
*         hasQuotedMsg:
*           type: boolean
*           description: Si el mensaje cita otro mensaje
*         isStarred:
*           type: boolean
*           description: Si el mensaje está marcado como importante
*         isForwarded:
*           type: boolean
*           description: Si el mensaje es reenviado
*     Chat:
*       type: object
*       properties:
*         id:
*           type: object
*           description: Objeto ID del chat
*         name:
*           type: string
*           description: Nombre del chat o contacto
*         unreadCount:
*           type: integer
*           description: Número de mensajes no leídos
*         timestamp:
*           type: integer
*           description: Timestamp del último mensaje
*         recentMessageDate:
*           type: integer
*           description: Fecha del mensaje más reciente
*         profilePicUrl:
*           type: string
*           description: URL de la foto de perfil
*         groupData:
*           type: array
*           items:
*             type: object
*             properties:
*               id:
*                 type: string
*               name:
*                 type: string
*               isAdmin:
*                 type: boolean
*               isSuperAdmin:
*                 type: boolean
*           description: Datos de participantes del grupo (si aplica)
*         client:
*           type: string
*           description: ID del cliente de WhatsApp
*         participants:
*           type: array
*           description: Participantes del chat (para grupos)
*     PaginatedChatsResponse:
*       type: object
*       properties:
*         chats:
*           type: array
*           items:
*             $ref: '#/components/schemas/Chat'
*         totalUnreadChats:
*           type: integer
*           description: Total de chats no leídos
*         currentPage:
*           type: integer
*           description: Página actual
*         totalPages:
*           type: integer
*           description: Total de páginas
*     PaginatedUnreadChatsResponse:
*       type: object
*       properties:
*         unreadChats:
*           type: array
*           items:
*             $ref: '#/components/schemas/Chat'
*         totalUnreadChats:
*           type: integer
*           description: Total de chats no leídos
*         currentPage:
*           type: integer
*           description: Página actual
*         totalPages:
*           type: integer
*           description: Total de páginas
*     ChatActionRequest:
*       type: object
*       required:
*         - clientId
*         - tel
*         - isGroup
*       properties:
*         clientId:
*           type: string
*           description: ID del cliente de WhatsApp
*         tel:
*           type: string
*           description: Número de teléfono o ID del chat
*         isGroup:
*           type: boolean
*           description: Indica si es un chat de grupo
*     MuteChatRequest:
*       allOf:
*         - $ref: '#/components/schemas/ChatActionRequest'
*         - type: object
*           properties:
*             unmuteDate:
*               type: string
*               format: date-time
*               description: Fecha para desactivar el silencio (opcional)
*     ChatsResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         currentPage:
*           type: integer
*           description: Página actual
*         totalPages:
*           type: integer
*           description: Total de páginas
*         chats:
*           type: array
*           items:
*             $ref: '#/components/schemas/Chat'
*         totalUnreadChats:
*           type: integer
*           description: Total de chats no leídos
*
*     UnreadChatsResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         currentPage:
*           type: integer
*           description: Página actual
*         totalPages:
*           type: integer
*           description: Total de páginas
*         unreadChats:
*           type: array
*           items:
*             $ref: '#/components/schemas/Chat'
*         totalUnreadChats:
*           type: integer
*           description: Total de chats no leídos
*
*     ChatActionResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         message:
*           type: string
*           description: Mensaje de confirmación
*
*     PinChatResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         pinned:
*           type: boolean
*           example: true
*
*     UnpinChatResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         unpinned:
*           type: boolean
*           example: true
*     MessagesResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         messages:
*           type: array
*           items:
*             $ref: '#/components/schemas/ChatMessage'
*
*     MessageActionResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         message:
*           type: string
*           description: Mensaje de confirmación de la acción
*
*     MessageInfoResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         id:
*           type: string
*           description: ID del mensaje
*         body:
*           type: string
*           description: Contenido del mensaje
*         type:
*           type: string
*           description: Tipo de mensaje
*         timestamp:
*           type: integer
*           description: Timestamp del mensaje
*         from:
*           type: string
*           description: Remitente del mensaje
*         to:
*           type: string
*           description: Destinatario del mensaje
*         hasMedia:
*           type: boolean
*           description: Si el mensaje tiene media
*         isStarred:
*           type: boolean
*           description: Si el mensaje está marcado como importante
*         isForwarded:
*           type: boolean
*           description: Si el mensaje es reenviado
* 
* @swagger
* /api/chats:
*   get:
*     tags: [Chats]
*     summary: Obtener chats con paginación
*     operationId: getChats
*     parameters:
*       - name: page
*         in: query
*         schema:
*           type: integer
*           default: 1
*         description: Número de página
*       - name: limit
*         in: query
*         schema:
*           type: integer
*           default: 20
*         description: Número de elementos por página
*     responses:
*       200:
*         description: Lista paginada de chats obtenida exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/PaginatedChatsResponse'
* @swagger
* /api/unreadChats:
*   get:
*     tags: [Chats]
*     summary: Obtener chats no leídos con paginación
*     operationId: getUnreadChats
*     parameters:
*       - name: page
*         in: query
*         schema:
*           type: integer
*           default: 1
*         description: Número de página
*       - name: limit
*         in: query
*         schema:
*           type: integer
*           default: 20
*         description: Número de elementos por página
*     responses:
*       200:
*         description: Lista paginada de chats no leídos obtenida exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/PaginatedUnreadChatsResponse'
* @swagger
* /api/markChatRead/{clientId}/{tel}/{isGroup}:
*   put:
*     tags: [Chats]
*     summary: Marcar chat como leído
*     operationId: markChatAsRead
*     parameters:
*       - name: clientId
*         in: path
*         required: true
*         schema:
*           type: string
*         description: ID del cliente de WhatsApp
*       - name: tel
*         in: path
*         required: true
*         schema:
*           type: string
*         description: Número de teléfono o ID del chat
*       - name: isGroup
*         in: path
*         required: true
*         schema:
*           type: string
*           enum: ['true', 'false']
*         description: Indica si es un chat de grupo
*     responses:
*       200:
*         $ref: '#/components/responses/Success'
* @swagger
* /api/markChatAsUnread:
*   put:
*     tags: [Chats]
*     summary: Marcar chat como no leído
*     operationId: markChatAsUnread
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ChatActionRequest'
*     responses:
*       200:
*         description: Chat marcado como no leído exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ChatActionResponse'
*             example:
*               success: true
*               message: "Chat marcado como no leído"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al marcar el chat como no leído"
* @swagger
* /api/muteChat:
*   put:
*     tags: [Chats]
*     summary: Silenciar chat
*     operationId: muteChat
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/MuteChatRequest'
*     responses:
*       200:
*         description: Chat silenciado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ChatActionResponse'
*             example:
*               success: true
*               message: "Chat silenciado"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al silenciar el chat"
* @swagger
* /api/pinChat:
*   put:
*     tags: [Chats]
*     summary: Fijar chat
*     operationId: pinChat
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ChatActionRequest'
*     responses:
*       200:
*         description: Chat fijado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/PinChatResponse'
*             example:
*               success: true
*               pinned: true
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al fijar el chat"
* @swagger
* /api/unpinChat:
*   put:
*     tags: [Chats]
*     summary: Desfijar chat
*     operationId: unpinChat
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ChatActionRequest'
*     responses:
*       200:
*         description: Chat desfijado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/UnpinChatResponse'
*             example:
*               success: true
*               unpinned: true
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al desfijar el chat"
* @swagger
* /api/chatMessages/{clientId}/{tel}:
*   get:
*     tags: [Chats]
*     summary: Obtener mensajes de un chat
*     operationId: getChatMessages
*     parameters:
*       - name: clientId
*         in: path
*         required: true
*         schema:
*           type: string
*         description: ID del cliente de WhatsApp
*       - name: tel
*         in: path
*         required: true
*         schema:
*           type: string
*         description: Número de teléfono o ID del chat
*       - name: isGroup
*         in: query
*         schema:
*           type: boolean
*           default: false
*         description: Indica si es un chat de grupo
*     responses:
*       200:
*         description: Mensajes del chat obtenidos exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessagesResponse'
*             example:
*               success: true
*               messages:
*                 - id: "msg_123"
*                   body: "Hola, ¿cómo estás?"
*                   timestamp: 1640995200
*                   from: "593987654321@c.us"
*                   to: "5931234567890@c.us"
*                   fromMe: false
*                   hasMedia: false
*                   mediaType: null
*                   mediaMimeType: null
*                   caption: null
*                   hasQuotedMsg: false
*                   isStarred: false
*                   isForwarded: false
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al obtener los mensajes"
* @swagger
* /api/chatGroupMessages/{number}/{groupId}:
*   get:
*     tags: [Chats]
*     summary: Obtener mensajes de un grupo
*     operationId: getGroupChatMessages
*     parameters:
*       - name: number
*         in: path
*         required: true
*         schema:
*           type: string
*         description: Número del cliente de WhatsApp
*       - name: groupId
*         in: path
*         required: true
*         schema:
*           type: string
*         description: ID del grupo
*     responses:
*       200:
*         description: Mensajes del grupo obtenidos exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessagesResponse'
*             example:
*               success: true
*               messages:
*                 - id: "group_msg_123"
*                   body: "Mensaje del grupo"
*                   timestamp: 1640995200
*                   from: "593987654321@c.us"
*                   to: "group_id@g.us"
*                   fromMe: false
*                   hasMedia: false
*                   mediaType: null
*                   mediaMimeType: null
*                   caption: null
*                   hasQuotedMsg: false
*                   isStarred: false
*                   isForwarded: false
*       400:
*         description: Parámetros requeridos faltantes
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Number and Group ID are required"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al obtener los mensajes del grupo"
* @swagger
* components:
*   schemas:
*     QrCodeResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         qr:
*           type: string
*           description: Código QR en formato base64
*           example: "2@abc123def456..."
*     ClientStatusResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         isAuthenticated:
*           type: boolean
*           description: Estado de autenticación del cliente
*           example: true
*     ClientStatus:
*       type: object
*       properties:
*         isAuthenticated:
*           type: boolean
*           description: Indica si el cliente está autenticado
*           example: true
*         isReady:
*           type: boolean
*           description: Indica si el cliente está listo para usar
*           example: true
*         number:
*           type: string
*           description: Número del cliente
*           example: "5931234567890"
*     AuthenticatedAccount:
*       type: object
*       properties:
*         number:
*           type: string
*           description: Número de la cuenta autenticada
*           example: "5931234567890"
*         display_name:
*           type: string
*           description: Nombre mostrado de la cuenta
*           example: "Mi WhatsApp Business"
*         displayName:
*           type: string
*           description: Nombre alternativo mostrado
*           example: "Mi WhatsApp Business"
*         status:
*           type: string
*           description: Estado de la cuenta
*           example: "authenticated"
*         last_activity:
*           type: integer
*           format: int64
*           description: Timestamp de última actividad
*           example: 1640995200000
*         lastActivity:
*           type: integer
*           format: int64
*           description: Timestamp alternativo de última actividad
*           example: 1640995200000
*     ReconnectionMetrics:
*       type: object
*       properties:
*         activeReconnections:
*           type: integer
*           description: Reconexiones activas
*           example: 2
*         queuedReconnections:
*           type: integer
*           description: Reconexiones en cola
*           example: 1
*         successRate:
*           type: number
*           description: Tasa de éxito de reconexión
*           example: 0.85
*         totalAttempts:
*           type: integer
*           description: Total de intentos de reconexión
*           example: 23
*     ServiceMetrics:
*       type: object
*       properties:
*         totalOperations:
*           type: integer
*           description: Total de operaciones realizadas
*           example: 1250
*         successfulOperations:
*           type: integer
*           description: Operaciones exitosas
*           example: 1180
*         failedOperations:
*           type: integer
*           description: Operaciones fallidas
*           example: 70
*         averageResponseTime:
*           type: number
*           description: Tiempo promedio de respuesta en ms
*           example: 185.3
*         lastOperationTime:
*           type: integer
*           nullable: true
*           format: int64
*           description: Timestamp de la última operación
*           example: 1640995200000
*         cacheSize:
*           type: integer
*           description: Tamaño del caché
*           example: 45
*         initialized:
*           type: boolean
*           description: Si el servicio está inicializado
*           example: true
*         isShuttingDown:
*           type: boolean
*           description: Si el servicio se está cerrando
*           example: false
*     MonitoringMetrics:
*       type: object
*       properties:
*         totalClients:
*           type: integer
*           description: Total de clientes monitoreados
*           example: 8
*         healthyClients:
*           type: integer
*           description: Clientes saludables
*           example: 7
*         unhealthyClients:
*           type: integer
*           description: Clientes no saludables
*           example: 1
*         averageUptime:
*           type: integer
*           description: Tiempo promedio de actividad en ms
*           example: 3600000
*     AuthenticatedAccountsResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         accounts:
*           type: array
*           items:
*             $ref: '#/components/schemas/AuthenticatedAccount'
*     ClientMonitoring:
*       type: object
*       properties:
*         lastSeen:
*           type: integer
*           format: int64
*           description: Timestamp última vez visto
*           example: 1640995200000
*         consecutiveFailures:
*           type: integer
*           description: Fallos consecutivos
*           example: 0
*         lastHealthCheck:
*           type: integer
*           format: int64
*           description: Timestamp último health check
*           example: 1640995200000
*         createdAt:
*           type: integer
*           format: int64
*           description: Timestamp de creación
*           example: 1640990000000
*     ClientMonitoringStatus:
*       type: object
*       properties:
*         number:
*           type: string
*           description: Número del cliente
*           example: "5931234567890"
*         lastSeen:
*           type: integer
*           format: int64
*           example: 1640995200000
*         consecutiveFailures:
*           type: integer
*           example: 0
*         lastHealthCheck:
*           type: integer
*           format: int64
*           example: 1640995200000
*     ClientActionResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         message:
*           type: string
*           description: Mensaje descriptivo de la operación
*         requestData:
*           type: object
*           description: Datos de la petición (objeto vacío)
*           example: {}
*     ConnectionStatusResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         isAuthenticated:
*           type: boolean
*           description: Si el cliente está autenticado
*           example: true
*         isReady:
*           type: boolean
*           description: Si el cliente está listo para usar
*           example: true
*         number:
*           type: string
*           description: Número del cliente
*           example: "5931234567890"
* @swagger
* /api/addClient:
*   post:
*     tags: [Clients]
*     summary: Agregar nuevo cliente WhatsApp
*     description: Crea un nuevo cliente WhatsApp. Verifica si ya existe antes de crear uno nuevo.
*     operationId: addClient
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - number
*             properties:
*               number:
*                 type: string
*                 pattern: '^[1-9][0-9]{7,14}$'
*                 description: Número de teléfono del cliente (solo dígitos, sin símbolos)
*                 example: "5931234567890"
*           example:
*             number: "5931234567890"
*     responses:
*       200:
*         description: Cliente agregado exitosamente o ya existía
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ClientActionResponse'
*             examples:
*               clientAdded:
*                 summary: Cliente agregado exitosamente
*                 value:
*                   success: true
*                   message: "Client added successfully"
*                   requestData: {}
*               clientExists:
*                 summary: Cliente ya existe
*                 value:
*                   success: true
*                   message: "Client 5931234567890 already exists"
*                   requestData: {}
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al agregar el cliente"
* @swagger
* /api/removeClient:
*   post:
*     tags: [Clients]
*     summary: Eliminar cliente WhatsApp
*     description: Elimina un cliente WhatsApp existente. Verifica que el cliente exista antes de eliminarlo.
*     operationId: removeClient
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - number
*             properties:
*               number:
*                 type: string
*                 pattern: '^[1-9][0-9]{7,14}$'
*                 description: Número de teléfono del cliente a eliminar
*                 example: "5931234567890"
*           example:
*             number: "5931234567890"
*     responses:
*       200:
*         description: Cliente eliminado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ClientActionResponse'
*             example:
*               success: true
*               message: "Client 5931234567890 removed successfully"
*               requestData: {}
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al eliminar el cliente"
* @swagger
* /api/qr/{number}:
*   get:
*     tags: [Clients]
*     summary: Obtener código QR para autenticación
*     description: Obtiene el código QR para autenticar un cliente WhatsApp. Si no está disponible, puede refrescar automáticamente el cliente.
*     operationId: getQrCode
*     parameters:
*       - in: path
*         name: number
*         required: true
*         schema:
*           type: string
*           pattern: '^[1-9][0-9]{7,14}$'
*         description: Número del cliente WhatsApp (sin símbolos, solo dígitos)
*         example: "5931234567890"
*     responses:
*       200:
*         description: QR code generado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/QrCodeResponse'
*             example:
*               success: true
*               qr: "2@abc123def456ghi789..."
*       202:
*         description: Cliente en proceso de inicialización o reconexión
*         content:
*           application/json:
*             schema:
*               allOf:
*                 - $ref: '#/components/schemas/ApiResponse'
*                 - type: object
*                   properties:
*                     data:
*                       type: object
*                       properties:
*                         refreshed:
*                           type: boolean
*                           description: Indica si se refrescó el cliente
*                           example: true
*                         reconnecting:
*                           type: boolean
*                           description: Indica si está en proceso de reconexión
*                           example: false
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Failed to get QR code: descripción del error"
* @swagger
* /api/status/{number}:
*   get:
*     tags: [Clients]
*     summary: Verificar estado de autenticación del cliente
*     description: Verifica únicamente si el cliente está autenticado con WhatsApp
*     operationId: getClientStatus
*     parameters:
*       - in: path
*         name: number
*         required: true
*         schema:
*           type: string
*           pattern: '^[1-9][0-9]{7,14}$'
*         description: Número del cliente WhatsApp
*         example: "5931234567890"
*     responses:
*       200:
*         description: Estado de autenticación obtenido exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ClientStatusResponse'
*             example:
*               success: true
*               isAuthenticated: true
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al obtener el estado del cliente"
* @swagger
* /api/status_connection/{number}:
*   get:
*     tags: [Clients]
*     summary: Verificar estado de conexión detallado
*     description: Obtiene estado completo de autenticación y disponibilidad del cliente
*     operationId: getConnectionStatus
*     parameters:
*       - in: path
*         name: number
*         required: true
*         schema:
*           type: string
*           pattern: '^[1-9][0-9]{7,14}$'
*         description: Número del cliente WhatsApp
*         example: "5931234567890"
*     responses:
*       200:
*         description: Estado de conexión obtenido exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ConnectionStatusResponse'
*             example:
*               success: true
*               isAuthenticated: true
*               isReady: true
*               number: "5931234567890"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al obtener el estado de conexión"
* @swagger
* /api/authenticated-accounts:
*   get:
*     tags: [Clients]
*     summary: Obtener todas las cuentas autenticadas
*     description: Retorna información de todas las cuentas WhatsApp autenticadas y activas
*     operationId: getAllAuthenticatedAccountsInfo
*     responses:
*       200:
*         description: Cuentas autenticadas obtenidas exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/AuthenticatedAccountsResponse'
*             example:
*               success: true
*               accounts:
*                 - number: "5931234567890"
*                   name: "Mi WhatsApp Business"
*                   status: "authenticated"
*                 - number: "5939876543210"
*                   name: "Cuenta Personal"
*                   status: "authenticated"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al obtener las cuentas autenticadas"
* @swagger
* /api/metrics/reconnection:
*   get:
*     tags: [Clients]
*     summary: Obtener métricas detalladas de reconexión
*     description: Proporciona métricas completas del sistema incluyendo reconexiones, servicio y monitoreo
*     operationId: getReconnectionMetrics
*     responses:
*       200:
*         description: Métricas obtenidas exitosamente
*         content:
*           application/json:
*             schema:
*               allOf:
*                 - $ref: '#/components/schemas/ApiResponse'
*                 - type: object
*                   properties:
*                     data:
*                       type: object
*                       properties:
*                         reconnection:
*                           $ref: '#/components/schemas/ReconnectionMetrics'
*                         service:
*                           $ref: '#/components/schemas/ServiceMetrics'
*                         monitoring:
*                           $ref: '#/components/schemas/MonitoringMetrics'
*                         timestamp:
*                           type: integer
*                           format: int64
*                           example: 1640995200000
* @swagger
*   /api/health/{number}:
*   post:
*     tags: [Clients]
*     summary: Forzar verificación de salud para cliente(s)
*     description: Ejecuta health check para un cliente específico o todos los clientes. Incluye validación de intervalos mínimos para evitar spam.
*     operationId: forceHealthCheck
*     parameters:
*       - in: path
*         name: number
*         required: true
*         schema:
*           type: string
*           pattern: '^[1-9][0-9]{7,14}$|^all$'
*         description: Número del cliente WhatsApp o 'all' para todos los clientes
*         example: "5931234567890"
*     responses:
*       200:
*         description: Verificación de salud completada exitosamente
*         content:
*           application/json:
*             schema:
*               allOf:
*                 - $ref: '#/components/schemas/ApiResponse'
*                 - type: object
*                   properties:
*                     data:
*                       type: object
*                       properties:
*                         client:
*                           type: string
*                           description: Número del cliente verificado (para cliente específico)
*                           example: "5931234567890"
*                         clients:
*                           type: integer
*                           description: Número de clientes verificados (para 'all')
*                           example: 5
*                         monitoring:
*                           oneOf:
*                             - $ref: '#/components/schemas/ClientMonitoring'
*                             - type: array
*                               items:
*                                 $ref: '#/components/schemas/ClientMonitoringStatus'
*                           description: Información de monitoreo resultante
*                         message:
*                           type: string
*                           example: "Health check completed for client 5931234567890"
*                         timestamp:
*                           type: integer
*                           format: int64
*                           example: 1640995200000
* @swagger
* components:
*   schemas:
*     Contact:
*       type: object
*       properties:
*         id:
*           type: string
*           description: ID serializado del contacto
*           example: "1234567890@c.us"
*         phone_number:
*           type: string
*           description: Número de teléfono del contacto
*           example: "1234567890"
*         name:
*           type: string
*           description: Nombre del contacto
*           example: "Juan Pérez"
*         profilePicUrl:
*           type: string
*           nullable: true
*           description: URL de la foto de perfil del contacto
*           example: "https://example.com/profile.jpg"
*         clientNumber:
*           type: string
*           description: Número del cliente WhatsApp al que pertenece
*           example: "5931234567890"
*         clientId:
*           type: string
*           description: ID interno del cliente
*           example: "client_123"
*     SaveContactResponse:
*       allOf:
*         - $ref: '#/components/schemas/ApiResponse'
*         - type: object
*           properties:
*             clientNumber:
*               type: string
*               description: Número del cliente WhatsApp
*             contactName:
*               type: string
*               description: Nombre del contacto guardado
*             requestId:
*               type: string
*               description: ID único de la petición
*     ControllerMetrics:
*       type: object
*       properties:
*         totalRequests:
*           type: integer
*           description: Total de peticiones procesadas
*           example: 150
*         successfulRequests:
*           type: integer
*           description: Peticiones exitosas
*           example: 142
*         failedRequests:
*           type: integer
*           description: Peticiones fallidas
*           example: 8
*         averageResponseTime:
*           type: number
*           description: Tiempo promedio de respuesta en ms
*           example: 250.5
*         lastRequestTime:
*           type: integer
*           nullable: true
*           format: int64
*           description: Timestamp de la última petición
*           example: 1640995200000
*     ContactServiceMetrics:
*       type: object
*       properties:
*         totalFetches:
*           type: integer
*           description: Total de consultas de contactos
*           example: 45
*         cacheHits:
*           type: integer
*           description: Aciertos de caché
*           example: 32
*         cacheMisses:
*           type: integer
*           description: Fallos de caché
*           example: 13
*         averageFetchTime:
*           type: number
*           description: Tiempo promedio de consulta en ms
*           example: 180.7
*         lastFetchTime:
*           type: integer
*           nullable: true
*           format: int64
*           description: Timestamp de la última consulta
*           example: 1640995200000
*         cacheSize:
*           type: integer
*           description: Tamaño actual del caché
*           example: 15
*         circuitBreakerState:
*           type: object
*           description: Estado del circuit breaker
*         cacheHitRate:
*           type: string
*           description: Tasa de aciertos del caché
*           example: "71.11%"
*     HealthStatus:
*       type: object
*       properties:
*         status:
*           type: string
*           enum: [healthy, degraded, unhealthy]
*           description: Estado de salud del servicio
*           example: "healthy"
*         timestamp:
*           type: integer
*           format: int64
*           description: Timestamp de la verificación
*           example: 1640995200000
*         metrics:
*           $ref: '#/components/schemas/ContactServiceMetrics'
*         issues:
*           type: array
*           items:
*             type: string
*           description: Lista de problemas detectados
*           example: []
*     ContactsResponse:
*       allOf:
*         - $ref: '#/components/schemas/ApiResponse'
*         - type: object
*           properties:
*             contacts:
*               type: array
*               items:
*                 $ref: '#/components/schemas/Contact'
*             page:
*               type: integer
*               description: Página actual
*             count:
*               type: integer
*               description: Número de contactos en la página
*             requestId:
*               type: string
*               description: ID único de la petición
* @swagger
* /api/getContacts:
*   get:
*     tags: [Contacts]
*     summary: Obtener lista de contactos con paginación
*     description: Obtiene contactos de todos los clientes autenticados, filtrando solo contactos individuales (no grupos) que estén guardados
*     operationId: getContacts
*     parameters:
*       - in: query
*         name: page
*         schema:
*           type: integer
*           minimum: 1
*           default: 1
*         description: Número de página para la paginación (30 contactos por página)
*         example: 1
*     responses:
*       200:
*         description: Contactos obtenidos exitosamente
*         content:
*           application/json:
*             schema:
*               allOf:
*                 - $ref: '#/components/schemas/ApiResponse'
*                 - type: object
*                   properties:
*                     data:
*                       type: object
*                       properties:
*                         contacts:
*                           type: array
*                           items:
*                             $ref: '#/components/schemas/Contact'
*                           description: Lista de contactos paginados y ordenados alfabéticamente
*                         count:
*                           type: integer
*                           description: Número de contactos en la página actual
*                           example: 25
*                         page:
*                           type: integer
*                           description: Página actual solicitada
*                           example: 1
*                         requestId:
*                           type: string
*                           description: ID único de la petición para tracking
*                           example: "contacts_1640995200000_abc123def"
*             examples:
*               success:
*                 summary: Respuesta exitosa
*                 value:
*                   success: true
*                   message: "Contacts retrieved successfully"
*                   contacts:
*                     - id: "593987654321@c.us"
*                       phone_number: "593987654321"
*                       name: "Juan Pérez"
*                       clientNumber: "5931234567890"
*                       clientId: "client_123"
*                   page: 1
*                   count: 1
*                   requestId: "contacts_1640995200000_abc123def"
*       400:
*         description: Error de validación
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Validation error: descripción_del_error"
*       408:
*         description: Timeout de la petición
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Request timeout - please try again"
*               details:
*                 requestId: "contacts_timeout_123"
*       429:
*         description: Límite de peticiones excedido
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Rate limit exceeded"
*               details:
*                 retryAfter: 30
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Failed to retrieve contacts"
*               details:
*                 requestId: "contacts_error_456"
*       503:
*         description: Servicio no disponible por rate limit
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Service temporarily unavailable"
*               details:
*                 requestId: "contacts_unavailable_789"
* @swagger
* /api/saveContact:
*   post:
*     tags: [Contacts]
*     summary: Guardar nuevo contacto en WhatsApp
*     description: Crea un contacto en el cliente WhatsApp especificado. Verifica si el contacto ya existe antes de crearlo.
*     operationId: saveContact
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/SaveContactRequest'
*           example:
*             clientNumber: "5931234567890"
*             contactNumber: "593987654321"
*             contactName: "Juan Pérez"
*     responses:
*       200:
*         description: Contacto guardado exitosamente o ya existía
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/SaveContactResponse'
*             examples:
*               contactSaved:
*                 summary: Contacto guardado exitosamente
*                 value:
*                   success: true
*                   message: "CONTACT_SAVED"
*                   clientNumber: "5931234567890"
*                   contactName: "Juan Pérez"
*                   requestId: "save_contact_1640995200000_xyz789"
*               contactExists:
*                 summary: Contacto ya existe
*                 value:
*                   success: true
*                   message: "Contact already exists"
*                   requestId: "save_contact_exists_123"
*       400:
*         description: Error de validación
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Validation error: descripción_del_error"
*       404:
*         description: Cliente no encontrado
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "WhatsApp client not found or not ready"
*               details:
*                 requestId: "save_contact_notfound_456"
*       408:
*         description: Timeout de la operación
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Save operation timeout - contact may still be created"
*               details:
*                 requestId: "save_contact_timeout_789"
*       429:
*         description: Límite de peticiones excedido
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Rate limit exceeded"
*               details:
*                 retryAfter: 30
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Failed to save contact"
*               details:
*                 requestId: "save_contact_error_123"
* @swagger
* components:
*   schemas:
*     MediaRequest:
*       type: object
*       required:
*         - clientId
*         - tel
*       properties:
*         clientId:
*           type: string
*           description: Número del cliente de WhatsApp (no solo ID)
*           example: "5931234567890"
*         tel:
*           type: string
*           description: Número de teléfono o ID del chat (sin @c.us)
*           example: "593987654321"
*         isGroup:
*           type: boolean
*           default: false
*           description: Indica si es un chat de grupo
*     ImageRequest:
*       allOf:
*         - $ref: '#/components/schemas/MediaRequest'
*         - type: object
*           required:
*             - imagePath
*           properties:
*             imagePath:
*               type: string
*               description: Ruta absoluta de la imagen en el servidor
*               example: "/path/to/images/photo.jpg"
*     StickerRequest:
*       allOf:
*         - $ref: '#/components/schemas/MediaRequest'
*         - type: object
*           required:
*             - stickerPath
*           properties:
*             stickerPath:
*               type: string
*               description: Ruta absoluta del sticker en el servidor
*               example: "/path/to/stickers/sticker.webp"
*     MessageOrFileRequest:
*       type: object
*       required:
*         - clientId
*         - chatId
*       properties:
*         clientId:
*           type: string
*           description: Número del cliente de WhatsApp
*           example: "5931234567890"
*         chatId:
*           type: string
*           description: ID del chat de destino (con formato @c.us o @g.us)
*           example: "593987654321@c.us"
*         message:
*           type: string
*           description: Mensaje de texto (requerido si no se envía archivo)
*           example: "Hola, ¿cómo estás?"
*         filePath:
*           type: string
*           description: Ruta absoluta del archivo (requerido si no se envía mensaje)
*           example: "/path/to/files/document.pdf"
*     ProductMessageRequest:
*       type: object
*       required:
*         - clientId
*         - tel
*         - mensaje  
*         - imagen
*       properties:
*         clientId:
*           type: string
*           description: Número del cliente de WhatsApp
*           example: "5931234567890"
*         tel:
*           type: string
*           description: Número de teléfono (sin @c.us)
*           example: "593987654321"
*         mensaje:
*           type: string
*           description: Descripción del producto
*           example: "Producto disponible - $25.99"
*         imagen:
*           type: string
*           description: Imagen del producto en formato base64 (con o sin data:image/ prefix)
*           example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
*     ProductMessageGroupRequest:
*       type: object
*       required:
*         - clientId
*         - groupId
*         - mensaje
*         - imagen
*       properties:
*         clientId:
*           type: string
*           description: Número del cliente de WhatsApp
*           example: "5931234567890"
*         groupId:
*           type: string
*           description: ID del grupo (sin @g.us)
*           example: "120363025015063966"
*         mensaje:
*           type: string
*           description: Descripción del producto
*           example: "¡Oferta especial para el grupo!"
*         imagen:
*           type: string
*           description: Imagen del producto en formato base64
*           example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
*     MediaActionResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         message:
*           type: string
*           description: Mensaje descriptivo del resultado de la operación
* @swagger
* /api/sendImage:
*   post:
*     tags: [Media]
*     summary: Enviar imagen
*     description: Envía una imagen desde una ruta del servidor a un contacto o grupo de WhatsApp. Valida existencia y tamaño del archivo (máx 64MB).
*     operationId: sendImage
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ImageRequest'
*           example:
*             clientId: "5931234567890"
*             tel: "593987654321"
*             imagePath: "/path/to/images/photo.jpg"
*             isGroup: false
*     responses:
*       200:
*         description: Imagen enviada exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MediaActionResponse'
*             example:
*               success: true
*               message: "Imagen enviada exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar la imagen"
* @swagger
* /api/sendMessageorFile:
*   post:
*     tags: [Media]  
*     summary: Enviar mensaje o archivo
*     description: Envía un mensaje de texto o un archivo a un chat específico. Requiere chatId con formato completo (@c.us o @g.us).
*     operationId: sendMessageOrFile
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/MessageOrFileRequest'
*           examples:
*             messageOnly:
*               summary: Enviar solo mensaje
*               value:
*                 clientId: "5931234567890"
*                 chatId: "593987654321@c.us"
*                 message: "Hola, ¿cómo estás?"
*             fileOnly:
*               summary: Enviar solo archivo
*               value:
*                 clientId: "5931234567890"
*                 chatId: "593987654321@c.us"
*                 filePath: "/path/to/files/document.pdf"
*     responses:
*       200:
*         description: Mensaje o archivo enviado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MediaActionResponse'
*             examples:
*               messageResponse:
*                 summary: Respuesta para mensaje
*                 value:
*                   success: true
*                   message: "Mensaje enviado exitosamente"
*               fileResponse:
*                 summary: Respuesta para archivo
*                 value:
*                   success: true
*                   message: "Archivo enviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar el mensaje o archivo"
* @swagger
* /api/sendSticker:
*   post:
*     tags: [Media]
*     summary: Enviar sticker
*     description: Envía un sticker desde una ruta del servidor. El archivo se envía con la opción sendMediaAsSticker=true.
*     operationId: sendSticker  
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/StickerRequest'
*           example:
*             clientId: "5931234567890"
*             tel: "593987654321"
*             stickerPath: "/path/to/stickers/funny.webp"
*             isGroup: false
*     responses:
*       200:
*         description: Sticker enviado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MediaActionResponse'
*             example:
*               success: true
*               message: "Sticker enviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar el sticker"
* @swagger
* /api/sendMessageProducts:
*   post:
*     tags: [Media]
*     summary: Enviar mensaje de producto
*     description: Envía un mensaje con imagen de producto usando base64. La imagen se procesa y almacena temporalmente.
*     operationId: sendMessageProduct
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ProductMessageRequest'
*           example:
*             clientId: "5931234567890"
*             tel: "593987654321"
*             mensaje: "¡Nuevo producto disponible por $29.99!"
*             imagen: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
*     responses:
*       200:
*         description: Mensaje de producto enviado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MediaActionResponse'
*             example:
*               success: true
*               message: "Mensaje de producto enviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar el mensaje de producto"
* @swagger
* /api/sendGroupProducts:
*   post:
*     tags: [Media]
*     summary: Enviar mensaje de producto a grupo
*     description: Envía un mensaje con imagen de producto a un grupo específico usando base64.
*     operationId: sendMessageProductGroup
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ProductMessageGroupRequest'
*           example:
*             clientId: "5931234567890"
*             groupId: "120363025015063966"
*             mensaje: "¡Oferta especial para el grupo - 20% descuento!"
*             imagen: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
*     responses:
*       200:
*         description: Mensaje de producto enviado exitosamente al grupo
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MediaActionResponse'
*             example:
*               success: true
*               message: "Mensaje de producto enviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar el mensaje de producto al grupo"
* @swagger
* components:
*   schemas:
*     MessageActionRequest:
*       type: object
*       required:
*         - clientId
*         - tel
*         - messageId
*       properties:
*         clientId:
*           type: string
*           description: ID del cliente de WhatsApp
*         tel:
*           type: string
*           description: Número de teléfono o ID del chat
*         messageId:
*           type: string
*           description: ID del mensaje
*         isGroup:
*           type: boolean
*           default: false
*           description: Indica si es un chat de grupo
*     DeleteMessageRequest:
*       allOf:
*         - $ref: '#/components/schemas/MessageActionRequest'
*         - type: object
*           properties:
*             forEveryone:
*               type: boolean
*               default: false
*               description: Eliminar para todos
*     ForwardMessageRequest:
*       type: object
*       required:
*         - clientId
*         - fromTel
*         - toTel
*         - messageId
*       properties:
*         clientId:
*           type: string
*           description: ID del cliente de WhatsApp
*         fromTel:
*           type: string
*           description: Número de origen del mensaje
*         toTel:
*           type: string
*           description: Número de destino del mensaje
*         messageId:
*           type: string
*           description: ID del mensaje a reenviar
*         isGroupFrom:
*           type: boolean
*           default: false
*           description: Si el origen es un grupo
*         isGroupTo:
*           type: boolean
*           default: false
*           description: Si el destino es un grupo
*     EditMessageRequest:
*       allOf:
*         - $ref: '#/components/schemas/MessageActionRequest'
*         - type: object
*           required:
*             - newContent
*           properties:
*             newContent:
*               type: string
*               description: Nuevo contenido del mensaje
*     SendMessageWithMentionRequest:
*       type: object
*       required:
*         - clientId
*         - tel
*         - mentionTel
*         - message
*       properties:
*         clientId:
*           type: string
*           description: ID del cliente de WhatsApp
*         tel:
*           type: string
*           description: Número de teléfono o ID del chat
*         mentionTel:
*           type: string
*           description: Número de teléfono a mencionar
*         message:
*           type: string
*           description: Contenido del mensaje
*         isGroup:
*           type: boolean
*           default: false
*           description: Indica si es un chat de grupo
*     MessageInfoResponse:
*       type: object
*       properties:
*         success:
*           type: boolean
*           example: true
*         message:
*           type: string
*           example: "Operation completed successfully"
*         data:
*           type: object
*           properties:
*             messageInfo:
*               type: object
*               properties:
*                 id:
*                   type: string
*                   description: ID del mensaje
*                 body:
*                   type: string
*                   description: Contenido del mensaje
*                 type:
*                   type: string
*                   description: Tipo de mensaje
*                 timestamp:
*                   type: integer
*                   description: Timestamp del mensaje
*                 from:
*                   type: string
*                   description: Remitente del mensaje
*                 to:
*                   type: string
*                   description: Destinatario del mensaje
*                 hasMedia:
*                   type: boolean
*                   description: Si el mensaje tiene media
*                 isStarred:
*                   type: boolean
*                   description: Si el mensaje está marcado como importante
*                 isForwarded:
*                   type: boolean
*                   description: Si el mensaje es reenviado
*     MessageRequest:
*       type: object
*       required:
*         - clientId
*         - tel
*         - mensaje
*       properties:
*         clientId:
*           type: string
*           description: ID del cliente de WhatsApp
*         tel:
*           type: string
*           description: Número de teléfono o ID del chat
*         mensaje:
*           type: string
*           description: Contenido del mensaje
*     GroupMessageRequest:
*       type: object
*       required:
*         - clientId
*         - groupId
*         - mensaje
*       properties:
*         clientId:
*           type: string
*           description: ID del cliente de WhatsApp
*         groupId:
*           type: string
*           description: ID del grupo
*         mensaje:
*           type: string
*           description: Contenido del mensaje
*     ReplyMessageRequest:
*       type: object
*       required:
*         - clientId
*         - tel
*         - messageId
*         - reply
*       properties:
*         clientId:
*           type: string
*           description: ID del cliente de WhatsApp
*         tel:
*           type: string
*           description: Número de teléfono o ID del chat
*         messageId:
*           type: string
*           description: ID del mensaje a responder
*         reply:
*           type: string
*           description: Contenido de la respuesta
*         isGroup:
*           type: boolean
*           default: false
*           description: Indica si es un chat de grupo
* @swagger
* /api/sendMessage:
*   post:
*     tags: [Messages]
*     summary: Enviar mensaje de texto
*     operationId: sendMessage
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/MessageRequest'
*     responses:
*       200:
*         description: Mensaje enviado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Mensaje enviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar el mensaje"
* @swagger
* /api/sendGroupMessage:
*   post:
*     tags: [Messages]
*     summary: Enviar mensaje a grupo
*     operationId: sendGroupMessage
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/GroupMessageRequest'
*     responses:
*       200:
*         description: Mensaje grupal enviado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Mensaje grupal enviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar el mensaje grupal"
* @swagger
* /api/replyMessage:
*   post:
*     tags: [Messages]
*     summary: Responder a un mensaje
*     operationId: replyToMessage
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ReplyMessageRequest'
*     responses:
*       200:
*         description: Respuesta enviada exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Respuesta enviada exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar la respuesta"
* @swagger
* /api/deleteMessage:
*   delete:
*     tags: [Messages]
*     summary: Eliminar mensaje
*     operationId: deleteMessage
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/DeleteMessageRequest'
*     responses:
*       200:
*         description: Mensaje eliminado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Mensaje eliminado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al eliminar el mensaje"
* @swagger
* /api/forwardMessage:
*   post:
*     tags: [Messages]
*     summary: Reenviar mensaje
*     operationId: forwardMessage
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ForwardMessageRequest'
*     responses:
*       200:
*         description: Mensaje reenviado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Mensaje reenviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al reenviar el mensaje"
* @swagger
* /api/markMessageAsImportant:
*   put:
*     tags: [Messages]
*     summary: Marcar mensaje como importante
*     operationId: markMessageAsImportant
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/MessageActionRequest'
*     responses:
*       200:
*         description: Mensaje marcado como importante
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Mensaje marcado como importante"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al marcar el mensaje como importante"
* @swagger
* /api/unmarkMessageAsImportant:
*   put:
*     tags: [Messages]
*     summary: Desmarcar mensaje como importante
*     operationId: unmarkMessageAsImportant
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/MessageActionRequest'
*     responses:
*       200:
*         description: Marcado de importancia eliminado
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Marcado de importancia eliminado"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al desmarcar el mensaje como importante"
* @swagger
* /api/editMessage:
*   put:
*     tags: [Messages]
*     summary: Editar mensaje
*     operationId: editMessage
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/EditMessageRequest'
*     responses:
*       200:
*         description: Mensaje editado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Mensaje editado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al editar el mensaje"
* @swagger
* /api/sendMessageWithMention:
*   post:
*     tags: [Messages]
*     summary: Enviar mensaje con mención
*     operationId: sendMessageWithMention
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/SendMessageWithMentionRequest'
*     responses:
*       200:
*         description: Mensaje con mención enviado exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageActionResponse'
*             example:
*               success: true
*               message: "Mensaje con mención enviado exitosamente"
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al enviar el mensaje con mención"
* @swagger
* /api/getMessageInfo/{clientId}/{tel}/{messageId}:
*   get:
*     tags: [Messages]
*     summary: Obtener información del mensaje
*     operationId: getMessageInfo
*     parameters:
*       - name: clientId
*         in: path
*         required: true
*         schema:
*           type: string
*         description: ID del cliente de WhatsApp
*       - name: tel
*         in: path
*         required: true
*         schema:
*           type: string
*         description: Número de teléfono o ID del chat
*       - name: messageId
*         in: path
*         required: true
*         schema:
*           type: string
*         description: ID del mensaje
*       - name: isGroup
*         in: query
*         schema:
*           type: boolean
*           default: false
*         description: Indica si es un chat de grupo
*     responses:
*       200:
*         description: Información del mensaje obtenida exitosamente
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/MessageInfoResponse'
*             example:
*               success: true
*               id: "msg_123"
*               body: "Contenido del mensaje"
*               type: "chat"
*               timestamp: 1640995200
*               from: "593987654321@c.us"
*               to: "5931234567890@c.us"
*               hasMedia: false
*               isStarred: false
*               isForwarded: false
*       500:
*         description: Error interno del servidor
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*             example:
*               success: false
*               error: "Error al obtener la información del mensaje"
*/