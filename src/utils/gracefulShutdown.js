// utils/gracefulShutdown.js
class GracefulShutdown {
    constructor(options = {}) {
        this.timeout = options.timeout || 30000;
        this.handlers = [];
        this.isShuttingDown = false;
        
        // Register signal handlers
        process.on('SIGTERM', () => this.shutdown('SIGTERM'));
        process.on('SIGINT', () => this.shutdown('SIGINT'));
        process.on('SIGUSR2', () => this.shutdown('SIGUSR2'));
    }

    onShutdown(handler) {
        this.handlers.push(handler);
    }

    async shutdown(signal) {
        if (this.isShuttingDown) {
            console.log('Shutdown already in progress');
            return;
        }

        this.isShuttingDown = true;
        console.log(`Received ${signal}, starting graceful shutdown...`);

        const shutdownPromise = this.executeShutdownHandlers(signal);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Shutdown timeout exceeded'));
            }, this.timeout);
        });

        try {
            await Promise.race([shutdownPromise, timeoutPromise]);
            console.log('Graceful shutdown completed');
            process.exit(0);
        } catch (error) {
            console.error('Shutdown error:', error);
            process.exit(1);
        }
    }

    async executeShutdownHandlers(signal) {
        for (const handler of this.handlers) {
            try {
                await handler(signal);
            } catch (error) {
                console.error('Shutdown handler error:', error);
            }
        }
    }
}

module.exports = GracefulShutdown;