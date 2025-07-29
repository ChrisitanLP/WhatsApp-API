// utils/circuitBreaker.js
class CircuitBreaker {
    
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold || 5;
        this.recoveryTimeout = options.recoveryTimeout || 30000;
        this.monitoringPeriod = options.monitoringPeriod || 60000;
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;
        
        this.metrics = {
            requests: 0,
            successes: 0,
            failures: 0,
            rejections: 0
        };
        
        // Reset metrics periodically
        setInterval(() => this.resetMetrics(), this.monitoringPeriod);
    }

    async execute(operation) {
        this.metrics.requests++;
        
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                this.metrics.rejections++;
                throw new Error(`Circuit breaker ${this.name} is OPEN`);
            } else {
                this.state = 'HALF_OPEN';
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
        this.metrics.successes++;
    }

    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.metrics.failures++;

        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.recoveryTimeout;
        }
    }

    resetMetrics() {
        this.metrics = {
            requests: 0,
            successes: 0,
            failures: 0,
            rejections: 0
        };
    }

    getState() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            metrics: { ...this.metrics }
        };
    }
}

module.exports = CircuitBreaker;