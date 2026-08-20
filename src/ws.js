/**
 * WebSocket Hub
 *
 * Draait op hetzelfde HTTP server als Express (poort 8080).
 * Exposeert een `broadcast(event, data)` functie die door routes
 * kan worden aangeroepen om real-time updates naar alle verbonden
 * browsers te sturen.
 *
 * Protocol (JSON):
 *   → { event: "x32:status",      data: {...} }
 *   → { event: "iem:status",      data: { channels } }
 *   → { event: "system:log",      data: { line } }
 *   → { event: "system:update",   data: {...} }
 *   → { event: "pong" }
 *
 * Client kan sturen:
 *   { type: "ping" }
 */

import { WebSocketServer } from 'ws';

let wss = null;

// Connect-handlers: modules registreren hier een functie die wordt
// aangeroepen zodra een nieuwe client verbindt, zodat ze die client
// direct een state-snapshot kunnen pushen (local-first hydratatie).
const connectHandlers = [];
export function onClientConnect(handler) {
    connectHandlers.push(handler);
}

export function initWebSocket(server) {
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        const addr = req.socket?.remoteAddress || 'unknown';
        console.log(`  [WS] Client verbonden: ${addr} (totaal: ${wss.clients.size})`);

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        // Push de huidige state naar de nieuw verbonden client
        connectHandlers.forEach((handler) => {
            try {
                handler({ send: (event, data) => ws.send(JSON.stringify({ event, data })) });
            } catch (_) { /* handler errors mogen de connectie niet breken */ }
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ event: 'pong' }));
                }
            } catch (_) { /* ignore malformed */ }
        });

        ws.on('close', () => {
            console.log(`  [WS] Client losgekoppeld: ${addr} (totaal: ${wss.clients.size})`);
        });

        ws.on('error', (err) => {
            console.error(`  [WS] Fout ${addr}:`, err.message);
        });
    });

    // Heartbeat: sluit dode clients elke 30s op
    const heartbeat = setInterval(() => {
        if (!wss) return;
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30_000);

    wss.on('close', () => clearInterval(heartbeat));

    console.log('  [WS] WebSocket hub geïnitialiseerd op /ws');
}

/**
 * Broadcast een event naar alle verbonden clients.
 * `event` = string naam, `data` = arbitrary payload.
 */
export function broadcast(event, data) {
    if (!wss) return;
    const msg = JSON.stringify({ event, data });
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) { // OPEN
            ws.send(msg);
        }
    });
}

export function getWss() {
    return wss;
}
