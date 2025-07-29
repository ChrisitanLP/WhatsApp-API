// utils/healthCheck.js
class HealthCheck {
    constructor() {
        this.checks = new Map();
    }

    addCheck(name, checkFunction) {
        this.checks.set(name, checkFunction);
    }

    removeCheck(name) {
        this.checks.delete(name);
    }

    async check() {
        const results = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            checks: {}
        };

        let hasErrors = false;
        let hasWarnings = false;

        for (const [name, checkFn] of this.checks.entries()) {
            try {
                const result = await checkFn();
                results.checks[name] = result;

                if (result.status === 'error') {
                    hasErrors = true;
                } else if (result.status === 'warning') {
                    hasWarnings = true;
                }
            } catch (error) {
                results.checks[name] = {
                    status: 'error',
                    message: error.message
                };
                hasErrors = true;
            }
        }

        if (hasErrors) {
            results.status = 'error';
        } else if (hasWarnings) {
            results.status = 'warning';
        }

        return results;
    }
}

module.exports = HealthCheck;