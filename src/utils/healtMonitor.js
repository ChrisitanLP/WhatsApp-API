// utils/healthMonitor.js
class HealthMonitor {
    constructor(options = {}) {
        this.checkInterval = options.checkInterval || 30000;
        this.healthHistory = [];
        this.maxHistorySize = options.maxHistorySize || 100;
        this.thresholds = {
            cpu: options.cpuThreshold || 80,
            memory: options.memoryThreshold || 80,
            ...options.thresholds
        };
        
        this.isRunning = false;
        this.checks = new Map();
    }

    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.intervalId = setInterval(() => {
            this.performHealthCheck();
        }, this.checkInterval);
    }

    stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }

    addCheck(name, checkFunction) {
        this.checks.set(name, checkFunction);
    }

    removeCheck(name) {
        this.checks.delete(name);
    }

    async performHealthCheck() {
        const timestamp = Date.now();
        const results = {
            timestamp,
            overall: 'healthy',
            checks: {},
            system: this.getSystemHealth()
        };

        // Execute custom checks
        for (const [name, checkFn] of this.checks.entries()) {
            try {
                results.checks[name] = await checkFn();
            } catch (error) {
                results.checks[name] = {
                    status: 'error',
                    error: error.message
                };
            }
        }

        // Determine overall health
        const hasErrors = Object.values(results.checks).some(
            check => check.status === 'error'
        );
        
        const hasWarnings = Object.values(results.checks).some(
            check => check.status === 'warning'
        );

        if (hasErrors) {
            results.overall = 'unhealthy';
        } else if (hasWarnings || results.system.status !== 'healthy') {
            results.overall = 'degraded';
        }

        // Store in history
        this.healthHistory.push(results);
        if (this.healthHistory.length > this.maxHistorySize) {
            this.healthHistory.shift();
        }

        return results;
    }

    getSystemHealth() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        // Convert to percentages (simplified)
        const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        
        return {
            status: memPercent > this.thresholds.memory ? 'warning' : 'healthy',
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                percentage: Math.round(memPercent)
            },
            uptime: process.uptime(),
            pid: process.pid
        };
    }

    recordHealthCheck(healthyCount, totalCount) {
        const ratio = totalCount > 0 ? healthyCount / totalCount : 0;
        
        // You can emit events or store metrics here
        console.log(`Health check: ${healthyCount}/${totalCount} (${Math.round(ratio * 100)}%) healthy`);
    }

    getHealthHistory(limit = 10) {
        return this.healthHistory.slice(-limit);
    }

    getCurrentHealth() {
        return this.healthHistory[this.healthHistory.length - 1] || null;
    }

    destroy() {
        this.stop();
        this.healthHistory = [];
        this.checks.clear();
    }
}

module.exports = HealthMonitor;