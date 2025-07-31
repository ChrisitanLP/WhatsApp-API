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

        this.gauges = new Map();
        this.counters = new Map();
        this.events = [];
        this.maxEvents = 1000;
    }

    // Método para métricas gauge (valores que pueden subir/bajar)
    recordGauge(name, value, labels = {}) {
        try {
            this.gauges.set(name, {
                value: parseFloat(value) || 0,
                labels,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Error recording gauge ${name}:`, error);
        }
    }

    recordCounter(name, value = 1, labels = {}) {
        try {
            const current = this.counters.get(name) || { value: 0, labels: {}, timestamp: Date.now() };
            this.counters.set(name, {
                value: current.value + (parseFloat(value) || 0),
                labels: { ...current.labels, ...labels },
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Error recording counter ${name}:`, error);
        }
    }

    // Métricas de HTTP requests
    recordHttpRequest(method, path, statusCode, duration) {
        try {
            this.recordCounter(`http.requests.${method.toLowerCase()}`, 1, {
                path: path.replace(/\/\d+/g, '/:id'), // Normalizar IDs
                status: Math.floor(statusCode / 100) * 100 // 2xx, 4xx, etc.
            });
            
            this.recordGauge(`http.request.duration.${method.toLowerCase()}`, duration, {
                path: path.replace(/\/\d+/g, '/:id')
            });
            
        } catch (error) {
            console.error('Error recording HTTP request metrics:', error);
        }
    }

    // Métricas específicas de WhatsApp
    recordWhatsAppMetrics(whatsappClient) {
        if (!whatsappClient) return;
        
        try {
            const clientCount = whatsappClient.clients?.size || 0;
            const readyClients = Array.from(whatsappClient.clients || [])
                .filter(([_, client]) => whatsappClient.isReady && whatsappClient.isReady(client))
                .length;
            
            this.recordGauge('whatsapp.clients.total', clientCount);
            this.recordGauge('whatsapp.clients.ready', readyClients);
            this.recordGauge('whatsapp.clients.ratio', 
                clientCount > 0 ? readyClients / clientCount : 0
            );
            
        } catch (error) {
            console.error('Error recording WhatsApp metrics:', error);
        }
    }

    // Métricas específicas de WebSocket
    recordWebSocketMetrics(wss) {
        if (!wss) return;
        
        try {
            const activeConnections = wss.clients?.size || 0;
            this.recordGauge('websocket.connections.active', activeConnections);
            
        } catch (error) {
            console.error('Error recording WebSocket metrics:', error);
        }
    }

    recordSystemMetrics() {
        try {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            this.recordGauge('system.memory.heap_used', memUsage.heapUsed);
            this.recordGauge('system.memory.heap_total', memUsage.heapTotal);
            this.recordGauge('system.memory.external', memUsage.external);
            this.recordGauge('system.memory.rss', memUsage.rss);
            
            this.recordGauge('system.cpu.user', cpuUsage.user);
            this.recordGauge('system.cpu.system', cpuUsage.system);
            this.recordGauge('system.uptime', process.uptime());
            
        } catch (error) {
            console.error('Error recording system metrics:', error);
        }
    }

    // Método existente mejorado para eventos
    recordEvent(type, data = {}) {
        try {
            const event = {
                type,
                data,
                timestamp: Date.now()
            };
            
            this.events.push(event);
            
            // Mantener solo los eventos más recientes
            if (this.events.length > this.maxEvents) {
                this.events = this.events.slice(-this.maxEvents);
            }
        } catch (error) {
            console.error(`Error recording event ${type}:`, error);
        }
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

    // Limpiar métricas antiguas
    cleanup() {
        const now = Date.now();
        const maxAge = 3600000; // 1 hora
        
        // Limpiar gauges antiguos
        for (const [name, metric] of this.gauges.entries()) {
            if (now - metric.timestamp > maxAge) {
                this.gauges.delete(name);
            }
        }
        
        // Mantener solo eventos recientes
        this.events = this.events.filter(event => 
            now - event.timestamp < maxAge
        );
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