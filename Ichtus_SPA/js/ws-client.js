/**
 * WebSocket Client — Ichtus Server Hub
 *
 * Verbindt met ws://<current-host>:8080/ws en ontvangt real-time
 * broadcasts van de server (wt:setlist, wt:roster, wt:library, etc.).
 * Dispatched CustomEvents in de DOM zodat bestaande modules
 * (setlistModule, stagebuilderModule) ze opvangen zonder wijzigingen.
 *
 * Herbindt automatisch bij disconnectie (exponential backoff).
 */
const WsClient = (() => {
    let ws = null;
    let reconnectDelay = 1000;
    const MAX_DELAY = 30000;
    let connected = false;

    function getWsUrl() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${location.hostname}:${location.port || 8080}/ws`;
    }

    function dispatch(event, data) {
        const detail = data || {};
        document.dispatchEvent(new CustomEvent(`ws:${event}`, {
            detail,
            bubbles: true,
            composed: true,
        }));
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const url = getWsUrl();
        console.log('[WS-Client] Verbinden met', url);

        try {
            ws = new WebSocket(url);
        } catch (err) {
            console.warn('[WS-Client] Kon niet verbinden:', err.message);
            scheduleReconnect();
            return;
        }

        ws.onopen = () => {
            connected = true;
            reconnectDelay = 1000;
            console.log('[WS-Client] Verbonden — wacht op broadcasts');
            document.documentElement.dataset.ichtusWs = 'connected';
        };

        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                const event = msg.event;
                const data = msg.data;

                if (event === 'pong') return; // heartbeat response, ignore

                console.log('[WS-Client] Broadcast ontvangen:', event);
                dispatch(event, data);
            } catch (_) { /* ignore malformed */ }
        };

        ws.onclose = () => {
            connected = false;
            document.documentElement.dataset.ichtusWs = 'disconnected';
            console.log('[WS-Client] Verbinding verbroken — herbinden over', reconnectDelay, 'ms');
            scheduleReconnect();
        };

        ws.onerror = (err) => {
            console.warn('[WS-Client] Fout:', err.message || 'onerror');
        };
    }

    function scheduleReconnect() {
        setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_DELAY);
            connect();
        }, reconnectDelay);
    }

    function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    return { connect, send, get connected() { return connected; } };
})();

// Auto-connect on load
WsClient.connect();
