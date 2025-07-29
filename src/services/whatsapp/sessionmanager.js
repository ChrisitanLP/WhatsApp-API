// services/whatsapp/SessionManager.js
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../config/logger').logger;

/**
 * Gestión exclusiva de sesiones y autenticación
 */
class SessionManager {
    constructor(authPath) {
        this.authPath = authPath;
    }

    async ensureAuthDirectory() {
        try {
            await fs.access(this.authPath);
        } catch {
            await fs.mkdir(this.authPath, { recursive: true });
            logger.info(`Auth directory created at ${this.authPath}`);
        }
    }

    getSessionPath(number) {
        return path.join(this.authPath, `session-${number}`);
    }

    async createSession(number) {
        const sessionPath = this.getSessionPath(number);
        await fs.mkdir(sessionPath, { recursive: true });
    }

    async removeSession(number) {
        const sessionPath = this.getSessionPath(number);
        await this.removeDirectory(sessionPath);
    }

    async getExistingSessions() {
        try {
            const directories = await fs.readdir(this.authPath);
            const sessions = [];

            for (const dir of directories) {
                const dirPath = path.join(this.authPath, dir);
                const stats = await fs.stat(dirPath);
                
                if (stats.isDirectory() && dir.startsWith('session-')) {
                    sessions.push(dir.replace('session-', ''));
                }
            }

            return sessions;
        } catch (error) {
            logger.error('Error loading existing sessions:', error);
            return [];
        }
    }

    async removeDirectory(dirPath) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            await Promise.all(entries.map(entry => {
                const fullPath = path.join(dirPath, entry.name);
                return entry.isDirectory() ? 
                    this.removeDirectory(fullPath) : 
                    fs.unlink(fullPath);
            }));
            
            await fs.rmdir(dirPath);
        } catch (error) {
            logger.error(`Failed to remove directory ${dirPath}:`, error);
            throw error;
        }
    }
}

module.exports = SessionManager;