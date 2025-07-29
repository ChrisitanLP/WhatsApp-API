// utils/retryManager.js
class RetryManager {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.baseDelay = options.baseDelay || 1000;
        this.maxDelay = options.maxDelay || 30000;
        this.backoffFactor = options.backoffFactor || 2;
        this.jitter = options.jitter !== false;
        
        this.operations = new Map();
    }

    async execute(operationId, operation, customOptions = {}) {
        const options = { ...this, ...customOptions };
        
        // Verificar si la operación ya está en progreso
        if (this.operations.has(operationId)) {
            throw new Error(`Operation ${operationId} is already in progress`);
        }

        this.operations.set(operationId, { startTime: Date.now() });

        try {
            return await this._executeWithRetry(operation, options, 0);
        } finally {
            this.operations.delete(operationId);
        }
    }

    async _executeWithRetry(operation, options, attempt) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= options.maxRetries) {
                throw error;
            }

            const delay = this._calculateDelay(options, attempt);
            console.log(`Retry attempt ${attempt + 1}/${options.maxRetries} after ${delay}ms`);
            
            await this._sleep(delay);
            return this._executeWithRetry(operation, options, attempt + 1);
        }
    }

    _calculateDelay(options, attempt) {
        let delay = options.baseDelay * Math.pow(options.backoffFactor, attempt);
        delay = Math.min(delay, options.maxDelay);
        
        if (options.jitter) {
            delay = delay * (0.5 + Math.random() * 0.5);
        }
        
        return Math.floor(delay);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getActiveOperations() {
        return Array.from(this.operations.entries()).map(([id, data]) => ({
            id,
            duration: Date.now() - data.startTime
        }));
    }
}

module.exports = RetryManager;