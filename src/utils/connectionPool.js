// utils/connectionPool.js
class ConnectionPool {
    constructor(options = {}) {
        this.maxConnections = options.maxConnections || 10;
        this.idleTimeout = options.idleTimeout || 300000;
        this.acquireTimeout = options.acquireTimeout || 30000;
        
        this.pool = [];
        this.active = new Set();
        this.waiting = [];
        
        // Cleanup idle connections
        setInterval(() => this.cleanupIdleConnections(), 60000);
    }

    async acquire() {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const index = this.waiting.findIndex(w => w.resolve === resolve);
                if (index > -1) {
                    this.waiting.splice(index, 1);
                }
                reject(new Error('Connection acquire timeout'));
            }, this.acquireTimeout);

            const tryAcquire = () => {
                // Try to get from pool
                if (this.pool.length > 0) {
                    const connection = this.pool.pop();
                    this.active.add(connection);
                    clearTimeout(timeoutId);
                    resolve(connection);
                    return;
                }

                // Create new connection if under limit
                if (this.active.size < this.maxConnections) {
                    const connection = this.createConnection();
                    this.active.add(connection);
                    clearTimeout(timeoutId);
                    resolve(connection);
                    return;
                }

                // Add to waiting queue
                this.waiting.push({ resolve, reject, timeoutId });
            };

            tryAcquire();
        });
    }

    release(connection) {
        if (!this.active.has(connection)) {
            return;
        }

        this.active.delete(connection);
        
        if (this.waiting.length > 0) {
            const waiter = this.waiting.shift();
            clearTimeout(waiter.timeoutId);
            this.active.add(connection);
            waiter.resolve(connection);
        } else {
            connection.lastUsed = Date.now();
            this.pool.push(connection);
        }
    }

    createConnection() {
        return {
            id: Math.random().toString(36).substr(2, 9),
            createdAt: Date.now(),
            lastUsed: Date.now(),
            // Add your connection logic here
        };
    }

    cleanupIdleConnections() {
        const now = Date.now();
        this.pool = this.pool.filter(conn => {
            if (now - conn.lastUsed > this.idleTimeout) {
                this.destroyConnection(conn);
                return false;
            }
            return true;
        });
    }

    destroyConnection(connection) {
        // Add cleanup logic here
        console.log(`Destroying idle connection ${connection.id}`);
    }

    getStats() {
        return {
            pool: this.pool.length,
            active: this.active.size,
            waiting: this.waiting.length,
            total: this.pool.length + this.active.size
        };
    }

    destroy() {
        // Cleanup all connections
        this.pool.forEach(conn => this.destroyConnection(conn));
        this.active.forEach(conn => this.destroyConnection(conn));
        
        this.pool = [];
        this.active.clear();
        
        // Reject all waiting promises
        this.waiting.forEach(waiter => {
            clearTimeout(waiter.timeoutId);
            waiter.reject(new Error('Connection pool destroyed'));
        });
        this.waiting = [];
    }
}

module.exports = ConnectionPool;