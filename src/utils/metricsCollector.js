// utils/metricsCollector.js
class MetricsCollector {
    constructor() {
        this.metrics = {
            http: {
                requests: 0,
                responses: {},
                totalDuration: 0,
                averageResponseTime: 0
            },
            whatsapp: {
                totalClients: 0,
                activeClients: 0,
                messagesSent: 0,
                messagesReceived: 0,
                errors: 0
            },
            websocket: {
                connections: 0,
                messagesSent: 0,
                messagesReceived: 0,
                broadcasts: 0
            },
            system: {
                memory: {},
                cpu: {},
                uptime: 0
            },
            events: {}
        };
        
        this.startTime = Date.now();
    }

    recordHttpRequest(method, path, statusCode, duration) {
        this.metrics.http.requests++;
        
        if (!this.metrics.http.responses[statusCode]) {
            this.metrics.http.responses[statusCode] = 0;
        }
        this.metrics.http.responses[statusCode]++;
        
        this.metrics.http.totalDuration += duration;
        this.metrics.http.averageResponseTime = 
            this.metrics.http.totalDuration / this.metrics.http.requests;
    }

    recordWhatsAppMetrics(whatsappClient) {
        if (!whatsappClient) return;
        
        this.metrics.whatsapp.totalClients = whatsappClient.clients?.size || 0;
        this.metrics.whatsapp.activeClients = Array.from(whatsappClient.clients || [])
            .filter(([number]) => whatsappClient.isReady?.(number)).length;
    }

    recordWebSocketMetrics(wss) {
        if (!wss) return;
        
        this.metrics.websocket.connections = wss.clients?.size || 0;
    }

    recordSystemMetrics() {
        const memUsage = process.memoryUsage();
        
        this.metrics.system = {
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024)
            },
            uptime: process.uptime(),
            pid: process.pid
        };
    }

    recordEvent(eventType, data = {}) {
        if (!this.metrics.events[eventType]) {
            this.metrics.events[eventType] = 0;
        }
        this.metrics.events[eventType]++;
    }

    getMetrics() {
        return {
            ...this.metrics,
            runtime: {
                uptime: Date.now() - this.startTime,
                startTime: this.startTime,
                timestamp: Date.now()
            }
        };
    }

    // Prometheus-style output
    getPrometheusMetrics() {
        const metrics = this.getMetrics();
        let output = '';
        
        output += `# HELP http_requests_total Total HTTP requests\n`;
        output += `# TYPE http_requests_total counter\n`;
        output += `http_requests_total ${metrics.http.requests}\n\n`;
        
        output += `# HELP whatsapp_clients_total Total WhatsApp clients\n`;
        output += `# TYPE whatsapp_clients_total gauge\n`;
        output += `whatsapp_clients_total ${metrics.whatsapp.totalClients}\n\n`;
        
        output += `# HELP whatsapp_clients_active Active WhatsApp clients\n`;
        output += `# TYPE whatsapp_clients_active gauge\n`;
        output += `whatsapp_clients_active ${metrics.whatsapp.activeClients}\n\n`;
        
        output += `# HELP websocket_connections WebSocket connections\n`;
        output += `# TYPE websocket_connections gauge\n`;
        output += `websocket_connections ${metrics.websocket.connections}\n\n`;
        
        output += `# HELP memory_heap_used_bytes Memory heap used in bytes\n`;
        output += `# TYPE memory_heap_used_bytes gauge\n`;
        output += `memory_heap_used_bytes ${metrics.system.memory.heapUsed * 1024 * 1024}\n\n`;
        
        return output;
    }

    reset() {
        this.metrics = {
            http: { requests: 0, responses: {}, totalDuration: 0, averageResponseTime: 0 },
            whatsapp: { totalClients: 0, activeClients: 0, messagesSent: 0, messagesReceived: 0, errors: 0 },
            websocket: { connections: 0, messagesSent: 0, messagesReceived: 0, broadcasts: 0 },
            system: { memory: {}, cpu: {}, uptime: 0 },
            events: {}
        };
        this.startTime = Date.now();
    }
}

module.exports = MetricsCollector;