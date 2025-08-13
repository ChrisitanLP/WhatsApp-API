const BaseWhatsAppService = require('./baseService');
const { MessageMedia } = require('whatsapp-web.js');
const { ValidationError } = require('../../utils/asyncHandler');
const { logger } = require('../../config/logger');
const fs = require('fs').promises;
const path = require('path');
const CircuitBreaker = require('../../utils/circuitBreaker');

/**
 * Media Service - Handles media operations
 */
class MediaService extends BaseWhatsAppService {
    constructor() {
        super();

        this.tempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
        this.ensureTempDirExists();

        // Circuit breakers específicos para operaciones de media
        this.mediaCircuitBreakers = {
            sendMedia: new CircuitBreaker('send-media', {
                failureThreshold: 3,
                recoveryTimeout: 20000,
                monitoringPeriod: 60000
            }),
            processMedia: new CircuitBreaker('process-media', {
                failureThreshold: 5,
                recoveryTimeout: 15000,
                monitoringPeriod: 45000
            }),
            downloadMedia: new CircuitBreaker('download-media', {
                failureThreshold: 4,
                recoveryTimeout: 10000,
                monitoringPeriod: 30000
            })
        };
        
        // Cache para archivos temporales procesados
        this.mediaCache = new Map();
        this.mediaCacheTimeout = 300000; // 5 minutos
        
        // Métricas específicas de media
        this.mediaMetrics = {
            totalSent: 0,
            totalProcessed: 0,
            totalDownloaded: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageProcessingTime: 0,
            lastOperationTime: null,
            mediaTypes: {
                image: 0,
                video: 0,
                audio: 0,
                document: 0,
                sticker: 0
            }
        };
        
        // Configuración de límites
        this.MAX_FILE_SIZE = 200 * 1024 * 1024; // 64MB
        this.SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        this.SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
        this.SUPPORTED_AUDIO_TYPES = ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4'];
        
        // Limpieza automática de archivos temporales
        this.startTempFileCleanup();
    }

    // Método para asegurar que el directorio temporal existe
    async ensureTempDirExists() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            logger.error('Error creating temp directory:', error);
            // Fallback a directorio del sistema
            this.tempDir = require('os').tmpdir();
        }
    }

    /**
     * Send file or message with enhanced resilience
     * @param {Object} params - Message parameters
     */
    async sendMessageOrFile(params) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const startTime = Date.now();
        const { clientId, chatId, message, filePath } = params;
        const operationId = `send_message_file_${clientId}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !chatId) {
                throw new ValidationError('Client ID and chat ID are required');
            }
            
            if (!message && !filePath) {
                throw new ValidationError('Message or file path required');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.ensureServiceReady();
                
                const client = await this.getClientById(clientId);
                
                if (filePath) {
                    await this.sendFileResilient(client, chatId, filePath);
                    this.mediaMetrics.totalSent++;
                } else if (message) {
                    await client.sendMessage(chatId, message);
                }
            });
            
            this.updateMediaMetrics(startTime, true);
            logger.info(`${filePath ? 'Archivo' : 'Mensaje'} enviado exitosamente a ${chatId}`);
            
        } catch (error) {
            this.updateMediaMetrics(startTime, false);
            logger.error(`Error sending ${filePath ? 'file' : 'message'} to ${chatId}:`, error);
            throw error;
        }
    }

    /**
     * Send media message (sticker/image) with enhanced resilience
     * @param {Object} params - Media message parameters
     */
    async sendMediaMessage(params) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const startTime = Date.now();
        const { clientId, tel, mediaPath, isGroup, type } = params;
        const operationId = `send_media_${clientId}_${tel}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !tel || !mediaPath || !type) {
                throw new ValidationError('All required parameters must be provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.mediaCircuitBreakers.sendMedia.execute(async () => {
                    await this.ensureServiceReady();
                    
                    const client = await this.getClientById(clientId);
                    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

                    // Verificar que el archivo existe
                    const fileExists = await this.checkFileExists(mediaPath);
                    if (!fileExists) {
                        throw new ValidationError(`Media file not found: ${mediaPath}`);
                    }

                    // Validar tamaño del archivo
                    await this.validateFileSize(mediaPath);
                    
                    const media = MessageMedia.fromFilePath(mediaPath);
                    const options = type === 'sticker' ? { sendMediaAsSticker: true } : {};
                    
                    await client.sendMessage(chatId, media, options);
                    
                    // Actualizar métricas por tipo
                    if (this.mediaMetrics.mediaTypes[type] !== undefined) {
                        this.mediaMetrics.mediaTypes[type]++;
                    }
                    
                    this.mediaMetrics.totalSent++;
                });
            });
            
            this.updateMediaMetrics(startTime, true);
            logger.info(`${type} enviado exitosamente a ${tel} desde cliente ${clientId}`);
            
        } catch (error) {
            this.updateMediaMetrics(startTime, false);
            logger.error(`Error sending ${type} to ${tel}:`, error);
            throw error;
        }
    }

    /**
     * Send product message with image with enhanced resilience
     * @param {Object} params - Product message parameters
     */
    async sendProductMessage(params) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const startTime = Date.now();
        const { clientId, tel, message, image, isGroup } = params;
        const operationId = `send_product_${clientId}_${tel}_${Date.now()}`;
        
        try {
            // Validar inputs
            if (!clientId || !tel || !message || !image) {
                throw new ValidationError('All required parameters must be provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.mediaCircuitBreakers.sendMedia.execute(async () => {
                    await this.ensureServiceReady();
                    
                    const client = await this.getClientById(clientId);
                    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

                    const media = await this.processBase64ImageResilient(image);
                    await client.sendMessage(chatId, message, { media });
                    
                    this.mediaMetrics.totalSent++;
                    this.mediaMetrics.mediaTypes.image++;
                });
            });
            
            this.updateMediaMetrics(startTime, true);
            logger.info(`Mensaje de producto enviado exitosamente a ${tel}`);
            
        } catch (error) {
            this.updateMediaMetrics(startTime, false);
            logger.error(`Error sending product message to ${tel}:`, error);
            throw error;
        }
    }

    /**
     * Send product message to group with enhanced resilience
     * @param {Object} params - Product message parameters
     */
    async sendMessageProductGroup(params) {
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const startTime = Date.now();
        const { clientId, groupId, message, image, isGroup } = params;
        const operationId = `send_product_group_${clientId}_${groupId}_${Date.now()}`;
        
        try {
            // Validar inputs - usar groupId o tel según el parámetro
            const tel = groupId || params.tel;
            if (!clientId || !tel || !message || !image) {
                throw new ValidationError('All required parameters must be provided');
            }
            
            await this.retryManager.execute(operationId, async () => {
                await this.mediaCircuitBreakers.sendMedia.execute(async () => {
                    await this.ensureServiceReady();
                    
                    const client = await this.getClientById(clientId);
                    const chatId = isGroup ? `${tel}@g.us` : `${tel}@c.us`;

                    // Verificar número si no es grupo
                    if (!isGroup) {
                        const numberDetails = await client.getNumberId(chatId);
                        if (!numberDetails) {
                            throw new NotFoundError('Phone number not found');
                        }
                    }

                    const media = await this.processBase64ImageResilient(image);
                    await client.sendMessage(chatId, message, { media });
                    
                    this.mediaMetrics.totalSent++;
                    this.mediaMetrics.mediaTypes.image++;
                });
            });
            
            this.updateMediaMetrics(startTime, true);
            logger.info(`Mensaje de producto enviado exitosamente al ${isGroup ? 'grupo' : 'contacto'} ${tel}`);
            
        } catch (error) {
            this.updateMediaMetrics(startTime, false);
            logger.error(`Error sending product message to ${isGroup ? 'group' : 'contact'} ${tel}:`, error);
            throw error;
        }
    }

    /**
     * Send file to chat with resilience
     * @param {Object} client - WhatsApp client
     * @param {string} chatId - Chat ID
     * @param {string} filePath - File path
     * @private
     */
    async sendFileResilient(client, chatId, filePath) {
        try {
            // Verificar que el archivo existe
            const fileExists = await this.checkFileExists(filePath);
            if (!fileExists) {
                throw new ValidationError(`File not found: ${filePath}`);
            }

            // Validar tamaño del archivo
            await this.validateFileSize(filePath);
            
            // Verificar tipo de archivo si es necesario
            const fileExtension = path.extname(filePath).toLowerCase();
            const mimeType = this.getMimeTypeFromExtension(fileExtension);
            
            if (mimeType && !this.isFileTypeSupported(mimeType)) {
                logger.warn(`Potentially unsupported file type: ${mimeType}`);
            }

            const media = MessageMedia.fromFilePath(filePath);
            await client.sendMessage(chatId, media);
            
        } catch (error) {
            logger.error(`Error in sendFileResilient for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Process base64 image with enhanced resilience
     * @param {string} imageData - Base64 image data
     * @returns {Promise<MessageMedia>} Processed media
     * @private
     */
    async processBase64ImageResilient(imageData) {
        const startTime = Date.now();
        
        try {
            return await this.mediaCircuitBreakers.processMedia.execute(async () => {
                // Verificar cache primero
                const cacheKey = `b64_${this.generateHash(imageData)}`;
                const cached = this.getFromMediaCache(cacheKey);
                if (cached) {
                    logger.debug('Base64 image found in cache');
                    return cached;
                }

                let base64Data = imageData;
                if (imageData.startsWith('data:image/')) {
                    base64Data = imageData.split(',')[1];
                }

                if (!base64Data || base64Data.length === 0) {
                    throw new ValidationError('Invalid base64 image data');
                }

                const imageBuffer = Buffer.from(base64Data, 'base64');
                if (imageBuffer.length === 0) {
                    throw new ValidationError('Empty image data');
                }

                // Validar tamaño del buffer
                if (imageBuffer.length > this.MAX_FILE_SIZE) {
                    throw new ValidationError(`Image too large: ${imageBuffer.length} bytes`);
                }

                const tempPath = path.join(this.tempDir, `temp_img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);
                
                try {
                    await fs.writeFile(tempPath, imageBuffer);
                    const media = MessageMedia.fromFilePath(tempPath);
                    
                    // Cachear el resultado
                    this.setMediaCache(cacheKey, media);
                    
                    // Limpiar archivo temporal después de un tiempo
                    setTimeout(async () => {
                        try {
                            await fs.unlink(tempPath);
                        } catch (unlinkError) {
                            logger.debug(`Error cleaning temp file ${tempPath}:`, unlinkError.message);
                        }
                    }, 60000); // 1 minuto
                    
                    this.mediaMetrics.totalProcessed++;
                    return media;
                    
                } catch (fileError) {
                    // Limpiar archivo en caso de error
                    try {
                        await fs.unlink(tempPath);
                    } catch (unlinkError) {
                        logger.debug(`Error cleaning temp file after error:`, unlinkError.message);
                    }
                    throw fileError;
                }
            });
        } catch (error) {
            this.updateMediaMetrics(startTime, false);
            logger.error('Error processing base64 image:', error);
            throw error;
        }
    }

    /**
     * Process message media with enhanced resilience
     * @param {Object} message - WhatsApp message
     * @returns {Promise<Object>} Media data
     */
    async processMessageMedia(message) {
        if (this.isShuttingDown) return {};
        
        const startTime = Date.now();
        
        try {
            return await this.mediaCircuitBreakers.processMedia.execute(async () => {
                // Verificar que el mensaje tenga media antes de procesar
                if (!message.hasMedia) {
                    return {};
                }

                const media = await this.attemptDownloadMediaResilient(message);
                if (!media) {
                    logger.warn(`No media data available for message ${message.id._serialized}`);
                    return {};
                }

                const mediaData = {
                    mediaType: message.type,
                    mediaMimeType: media.mimetype,
                    caption: message.caption || null
                };

                // Procesar según tipo de media
                try {
                    if (['sticker', 'image', 'audio', 'ptt'].includes(message.type)) {
                        mediaData.mediaBase64 = `data:${media.mimetype};base64,${media.data}`;
                    } else if (['document', 'video'].includes(message.type)) {
                        try {
                            // Usar filename más seguro
                            const filename = media.filename || `media_${message.id._serialized}`;
                            const extension = path.extname(filename) || this.getExtensionFromMimeType(media.mimetype);
                            
                            const tempPath = await this.saveTempMediaResilient(message.id._serialized, extension, media.data);
                            mediaData.mediaTempUrl = `http://localhost:5000/temp/${path.basename(tempPath)}`;
                        } catch (error) {
                            logger.warn(`Error saving temp media for ${message.id._serialized}:`, error.message);
                        }
                    }
                } catch (mediaProcessError) {
                    logger.warn(`Error processing media content for ${message.id._serialized}:`, mediaProcessError.message);
                }

                this.mediaMetrics.totalProcessed++;
                this.updateMediaMetrics(startTime, true);
                return mediaData;
            });
        } catch (error) {
            this.updateMediaMetrics(startTime, false);
            logger.error(`Error processing message media for ${message.id?._serialized}:`, error);
            return {};
        }
    }

    /**
     * Process message media with enhanced performance and error handling
     * @param {Object} message - WhatsApp message
     * @returns {Promise<Object>} Media data
     */
    async processMessageMediaOptimized(message) {
        if (this.isShuttingDown) return {};
        
        const startTime = Date.now();
        
        try {
            // Validaciones tempranas más estrictas
            if (!message || !message.hasMedia || !message.id) {
                return {};
            }

            // Verificar que el tipo de mensaje es procesable
            if (!['sticker', 'image', 'audio', 'ptt', 'document', 'video'].includes(message.type)) {
                logger.debug(`Skipping unsupported media type: ${message.type}`);
                return {};
            }

            return await this.mediaCircuitBreakers.processMedia.execute(async () => {
                // Verificar cache primero con key más específico
                const cacheKey = `media_${message.id._serialized}_${message.timestamp}`;
                const cached = this.getFromMediaCache(cacheKey);
                if (cached) {
                    return cached;
                }

                const media = await this.attemptDownloadMediaOptimized(message);
                if (!media || !media.data) {
                    logger.debug(`No media data available for message ${message.id._serialized}`);
                    return {};
                }

                const mediaData = {
                    mediaType: message.type,
                    mediaMimeType: media.mimetype,
                    caption: message.caption || null
                };

                // OPTIMIZACIÓN: Procesar según tipo con límites de tamaño
                try {
                    // Verificar tamaño antes de procesar
                    const dataSize = Buffer.byteLength(media.data, 'base64');
                    const maxSizeForBase64 = 500 * 1024 * 1024; // 5MB máximo para base64
                    
                    if (['sticker', 'image'].includes(message.type) && dataSize <= maxSizeForBase64) {
                        mediaData.mediaBase64 = `data:${media.mimetype};base64,${media.data}`;
                    } else if (['audio', 'ptt'].includes(message.type) && dataSize <= maxSizeForBase64) {
                        mediaData.mediaBase64 = `data:${media.mimetype};base64,${media.data}`;
                    } else if (['document', 'video'].includes(message.type) || dataSize > maxSizeForBase64) {
                        // Para archivos grandes, crear URL temporal
                        try {
                            const filename = this.generateSafeFilename(media.filename || message.id._serialized, media.mimetype);
                            const tempPath = await this.saveTempMediaOptimized(message.id._serialized, filename, media.data);
                            mediaData.mediaTempUrl = `http://localhost:5000/temp/${path.basename(tempPath)}`;
                            mediaData.filename = filename;
                            mediaData.fileSize = dataSize;
                        } catch (error) {
                            logger.warn(`Error saving temp media for ${message.id._serialized}:`, error.message);
                            mediaData.mediaError = 'Failed to save temporary file';
                        }
                    }
                } catch (mediaProcessError) {
                    logger.warn(`Error processing media content for ${message.id._serialized}:`, mediaProcessError.message);
                    mediaData.mediaError = 'Content processing failed';
                }

                // Cachear resultado exitoso
                this.setMediaCache(cacheKey, mediaData);
                this.mediaMetrics.totalProcessed++;
                this.updateMediaMetrics(startTime, true);
                
                return mediaData;
            });
        } catch (error) {
            this.updateMediaMetrics(startTime, false);
            logger.debug(`Error processing message media for ${message.id?._serialized}:`, error.message);
            return {};
        }
    }

    /**
     * Generate safe filename from media info
     * @param {string} originalName - Original filename or message ID
     * @param {string} mimeType - MIME type
     * @returns {string} Safe filename
     * @private
     */
    generateSafeFilename(originalName, mimeType) {
        // Limpiar nombre original
        const safeName = originalName
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .substring(0, 100); // Limitar longitud
        
        // Agregar extensión basada en MIME type si no tiene
        const extension = this.getExtensionFromMimeType(mimeType) || '.bin';
        
        if (!safeName.includes('.') || !safeName.endsWith(extension)) {
            return `${safeName}${extension}`;
        }
        
        return safeName;
    }

    getExtensionFromMimeType(mimeType) {
        const extensions = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'video/ogg': '.ogg',
            'audio/mp3': '.mp3',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/ogg': '.ogg',
            'audio/mp4': '.m4a',
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
        };
        return extensions[mimeType] || '.bin';
    }

    /**
     * Attempt to download media with enhanced retries and circuit breaker
     * @param {Object} message - WhatsApp message
     * @param {number} maxRetries - Maximum number of retries
     * @returns {Promise<Object|null>} Media data or null
     * @private
     */
    async attemptDownloadMediaResilient(message, maxRetries = 3) {
        const operationId = `download_media_${message.id._serialized}_${Date.now()}`;
        
        try {
            return await this.retryManager.execute(operationId, async () => {
                return await this.mediaCircuitBreakers.downloadMedia.execute(async () => {
                    const media = await Promise.race([
                        message.downloadMedia(),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Download timeout')), 30000)
                        )
                    ]);
                    
                    if (!media) {
                        throw new Error('No media data received');
                    }
                    
                    this.mediaMetrics.totalDownloaded++;
                    return media;
                });
            });
        } catch (error) {
            logger.warn(`Failed to download media for message ${message.id._serialized} after retries:`, error.message);
            return null;
        }
    }

    /**
     * Optimized media download with shorter timeouts and better error handling
     * @param {Object} message - WhatsApp message
     * @returns {Promise<Object|null>} Media data or null
     * @private
     */
    async attemptDownloadMediaOptimized(message) {
        const operationId = `download_media_opt_${message.id._serialized}_${Date.now()}`;
        
        try {
            return await this.retryManager.execute(operationId, async () => {
                return await this.mediaCircuitBreakers.downloadMedia.execute(async () => {
                    // Timeout más corto para evitar bloqueos
                    const media = await Promise.race([
                        message.downloadMedia(),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Download timeout')), 15000) // Reducido de 30s a 15s
                        )
                    ]);
                    
                    // Validaciones adicionales
                    if (!media) {
                        throw new Error('No media data received');
                    }
                    
                    if (!media.data || media.data.length === 0) {
                        throw new Error('Empty media data');
                    }
                    
                    // Verificar tamaño máximo
                    const dataSize = Buffer.byteLength(media.data, 'base64');
                    if (dataSize > this.MAX_FILE_SIZE) {
                        throw new Error(`Media too large: ${dataSize} bytes`);
                    }
                    
                    this.mediaMetrics.totalDownloaded++;
                    return media;
                });
            });
        } catch (error) {
            logger.debug(`Failed to download media for message ${message.id._serialized}:`, error.message);
            return null;
        }
    }

    /**
     * Save temporary media file with resilience
     * @param {string} id - Message ID
     * @param {string} extension - File extension
     * @param {string} data - Base64 data
     * @returns {Promise<string>} Temp file path
     * @private
     */
    async saveTempMediaResilient(id, extension, data) {
        try {
            // Asegurar que tempDir existe
            await this.ensureTempDirExists();

            // Generar nombre único para evitar colisiones
            const uniqueId = `${id.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const tempPath = path.join(this.tempDir, `media_${uniqueId}${extension}`);
            
            // Validar que data existe y es válido
            if (!data || typeof data !== 'string') {
                throw new ValidationError('Invalid media data provided');
            }

            const buffer = Buffer.from(data, 'base64');
            
            // Validar tamaño
            if (buffer.length > this.MAX_FILE_SIZE) {
                throw new ValidationError(`Media file too large: ${buffer.length} bytes`);
            }
            
            await fs.writeFile(tempPath, buffer);
            
            // Programar limpieza del archivo temporal
            setTimeout(async () => {
                try {
                    await fs.unlink(tempPath);
                    logger.debug(`Temp media file cleaned: ${tempPath}`);
                } catch (error) {
                    logger.debug(`Error cleaning temp media file ${tempPath}:`, error.message);
                }
            }, this.mediaCacheTimeout); // Limpiar después del timeout del cache
            
            return tempPath;
        } catch (error) {
            logger.error(`Error saving temp media for ${id}:`, error);
            throw error;
        }
    }

    /**
     * Optimized temp media saving with better error handling
     * @param {string} id - Message ID
     * @param {string} filename - Safe filename
     * @param {string} data - Base64 data
     * @returns {Promise<string>} Temp file path
     * @private
     */
    async saveTempMediaOptimized(id, filename, data) {
        try {
            // Asegurar que tempDir existe
            await this.ensureTempDirExists();

            // Generar nombre único para evitar colisiones
            const uniqueId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const tempPath = path.join(this.tempDir, `${uniqueId}_${filename}`);
            
            // Validaciones mejoradas
            if (!data || typeof data !== 'string') {
                throw new ValidationError('Invalid media data provided');
            }

            // Procesar en chunks para archivos grandes
            const buffer = Buffer.from(data, 'base64');
            
            // Validar tamaño
            if (buffer.length > this.MAX_FILE_SIZE) {
                throw new ValidationError(`Media file too large: ${buffer.length} bytes`);
            }
            
            // Escribir archivo con opciones optimizadas
            await fs.writeFile(tempPath, buffer, { 
                flag: 'w',
                mode: 0o644 
            });
            
            // Programar limpieza del archivo temporal con tiempo reducido
            setTimeout(async () => {
                try {
                    await fs.unlink(tempPath);
                    logger.debug(`Temp media file cleaned: ${path.basename(tempPath)}`);
                } catch (error) {
                    logger.debug(`Error cleaning temp media file ${tempPath}:`, error.message);
                }
            }, 180000); // Reducido de 5 minutos a 3 minutos
            
            return tempPath;
        } catch (error) {
            logger.error(`Error saving temp media for ${id}:`, error.message);
            throw error;
        }
    }

    /**
     * Utility methods for file validation and management
     */
    
    async checkFileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    async validateFileSize(filePath) {
        try {
            const stats = await fs.stat(filePath);
            if (stats.size > this.MAX_FILE_SIZE) {
                throw new ValidationError(`File too large: ${stats.size} bytes (max: ${this.MAX_FILE_SIZE})`);
            }
            return true;
        } catch (error) {
            if (error instanceof ValidationError) throw error;
            throw new ValidationError(`Cannot validate file size: ${error.message}`);
        }
    }

    getMimeTypeFromExtension(extension) {
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mp3': 'audio/mp3',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        return mimeTypes[extension] || null;
    }

    isFileTypeSupported(mimeType) {
        return [...this.SUPPORTED_IMAGE_TYPES, ...this.SUPPORTED_VIDEO_TYPES, ...this.SUPPORTED_AUDIO_TYPES]
            .includes(mimeType);
    }

    generateHash(data) {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(data).digest('hex');
    }

    /**
     * Cache management for media
     */
    getFromMediaCache(key) {
        const item = this.mediaCache.get(key);
        if (item && Date.now() - item.timestamp < this.mediaCacheTimeout) {
            return item.value;
        }
        this.mediaCache.delete(key);
        return null;
    }

    setMediaCache(key, value) {
        // Limitar el tamaño del cache
        if (this.mediaCache.size > 100) {
            const oldestKey = this.mediaCache.keys().next().value;
            this.mediaCache.delete(oldestKey);
        }
        
        this.mediaCache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    /**
     * Start automatic cleanup of temporary files
     */
    startTempFileCleanup() {
        if (this.tempCleanupInterval) return;
        
        this.tempCleanupInterval = setInterval(async () => {
            try {
                await this.cleanupTempFiles();
            } catch (error) {
                logger.error('Error in temp file cleanup:', error);
            }
        }, 300000); // Cada 5 minutos
    }

    async cleanupTempFiles() {
        try {
            const files = await fs.readdir(this.tempDir);
            const now = Date.now();
            let cleanedCount = 0;

            for (const file of files) {
                try {
                    const filePath = path.join(this.tempDir, file);
                    const stats = await fs.stat(filePath);
                    
                    // Eliminar archivos más antiguos que el timeout del cache
                    if (now - stats.mtime.getTime() > this.mediaCacheTimeout) {
                        await fs.unlink(filePath);
                        cleanedCount++;
                    }
                } catch (error) {
                    logger.debug(`Error processing temp file ${file}:`, error.message);
                }
            }

            if (cleanedCount > 0) {
                logger.debug(`Cleaned up ${cleanedCount} temporary files`);
            }
        } catch (error) {
            logger.error('Error cleaning up temp files:', error);
        }
    }

    /**
     * Update media-specific metrics
     */
    updateMediaMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        
        if (success) {
            this.mediaMetrics.successfulOperations++;
        } else {
            this.mediaMetrics.failedOperations++;
        }
        
        // Calcular promedio móvil simple
        const totalOps = this.mediaMetrics.successfulOperations + this.mediaMetrics.failedOperations;
        const currentAvg = this.mediaMetrics.averageProcessingTime;
        this.mediaMetrics.averageProcessingTime = 
            (currentAvg * (totalOps - 1) + duration) / totalOps;
        
        this.mediaMetrics.lastOperationTime = Date.now();
    }

    /**
     * Get media service metrics
     * @returns {Object} Service metrics
     */
    getMediaMetrics() {
        const totalOperations = this.mediaMetrics.successfulOperations + this.mediaMetrics.failedOperations;
        const successRate = totalOperations > 0 ? 
            (this.mediaMetrics.successfulOperations / totalOperations * 100).toFixed(2) + '%' : '0%';

        return {
            ...this.mediaMetrics,
            totalOperations,
            successRate,
            cacheSize: this.mediaCache.size,
            circuitBreakers: Object.keys(this.mediaCircuitBreakers).reduce((acc, key) => {
                acc[key] = this.mediaCircuitBreakers[key].getState();
                return acc;
            }, {})
        };
    }

    /**
     * Health check for media service
     * @returns {Object} Health status
     */
    async getMediaHealthCheck() {
        const baseHealth = await this.healthCheck();
        const mediaHealth = {
            ...baseHealth,
            service: 'MediaService',
            mediaMetrics: this.getMediaMetrics(),
            specificIssues: []
        };

        // Verificar circuit breakers específicos de media
        Object.entries(this.mediaCircuitBreakers).forEach(([name, cb]) => {
            const state = cb.getState();
            if (state.state === 'OPEN') {
                mediaHealth.specificIssues.push(`Media circuit breaker ${name} is OPEN`);
                mediaHealth.status = 'degraded';
            }
        });

        // Verificar tasa de éxito
        const totalOps = this.mediaMetrics.successfulOperations + this.mediaMetrics.failedOperations;
        if (totalOps > 10) {
            const successRate = this.mediaMetrics.successfulOperations / totalOps;
            
            if (successRate < 0.7) {
                mediaHealth.specificIssues.push(`Low success rate: ${(successRate * 100).toFixed(2)}%`);
                mediaHealth.status = mediaHealth.status === 'unhealthy' ? 'unhealthy' : 'degraded';
            }
            
            if (successRate < 0.5) {
                mediaHealth.status = 'unhealthy';
            }
        }

        // Verificar si el directorio temporal es accesible
        try {
            await fs.access(this.tempDir);
        } catch (error) {
            mediaHealth.specificIssues.push('Temp directory not accessible');
            mediaHealth.status = 'unhealthy';
        }

        return mediaHealth;
    }

    /**
     * Cleanup resources on shutdown
     */
    async cleanup() {
        if (this.tempCleanupInterval) {
            clearInterval(this.tempCleanupInterval);
            this.tempCleanupInterval = null;
        }
        
        // Limpiar cache
        this.mediaCache.clear();
        
        // Realizar limpieza final de archivos temporales
        try {
            await this.cleanupTempFiles();
        } catch (error) {
            logger.error('Error in final temp file cleanup:', error);
        }
        
        logger.info('MediaService cleanup completed');
    }

    /**
     * Override graceful shutdown to include media cleanup
     */
    async gracefulShutdown(signal) {
        await this.cleanup();
        await super.gracefulShutdown(signal);
    }
}

module.exports = MediaService;