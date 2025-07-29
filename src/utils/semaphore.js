// Semáforo para controlar concurrencia
class Semaphore {
    constructor(permits) {
        this.permits = permits;
        this.waiting = [];
    }

    async acquire() {
        return new Promise((resolve) => {
            if (this.permits > 0) {
                this.permits--;
                resolve(() => this.release());
            } else {
                this.waiting.push(() => {
                    this.permits--;
                    resolve(() => this.release());
                });
            }
        });
    }

    release() {
        this.permits++;
        if (this.waiting.length > 0) {
            const next = this.waiting.shift();
            next();
        }
    }
}

module.exports = Semaphore;