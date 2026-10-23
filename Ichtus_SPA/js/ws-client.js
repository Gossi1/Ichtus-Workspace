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

                if (event === 'dev:reload') {
                    if (data && data.type === 'css') {
                        hotReloadCss(data.files);
                    } else {
                        window.ichtusDevReload();
                    }
                    return;
                }

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

// ── Dev Mode Reload & Hot-CSS Utilities ──────────────────────────────────
window.ichtusDevReload = async function() {
    try {
        sessionStorage.setItem('splashShown', '1');
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
    } catch (_) {}
    window.location.reload();
};

function hotReloadCss(files) {
    const ts = Date.now();
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        const base = href.split('?')[0];
        link.setAttribute('href', `${base}?_dev=${ts}`);
    });
    showDevToast(`⚡ CSS bijgewerkt (${files && files.length ? files[0].split('/').pop() : 'stijl'})`);
}

function showDevToast(text) {
    let toast = document.getElementById('ichtus-dev-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ichtus-dev-toast';
        toast.style.cssText = 'position:fixed;bottom:56px;right:16px;z-index:99998;background:rgba(20,24,30,0.92);color:#ff9900;border:1px solid rgba(255,153,0,0.4);padding:6px 12px;border-radius:8px;font:600 12px "Segoe UI",system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,0.45);pointer-events:none;transition:opacity 0.2s ease;';
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 1800);
}

function mountDevToolbar() {
    if (document.getElementById('ichtus-dev-pill')) return;
    const pill = document.createElement('button');
    pill.id = 'ichtus-dev-pill';
    pill.type = 'button';
    pill.title = 'Herlaad app en wis cache (F5 / Ctrl+R)';
    pill.innerHTML = '🔄 <span>Reload</span> <kbd style="opacity:0.7;font-size:10px;background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:4px;margin-left:2px;">F5</kbd>';
    pill.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99997;display:flex;align-items:center;gap:5px;padding:6px 11px;border-radius:999px;border:1px solid rgba(244,121,32,0.45);background:rgba(24,26,32,0.88);backdrop-filter:blur(8px);color:#f9f9f7;font:600 12px "Segoe UI",system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.45);transition:transform 0.12s ease,border-color 0.15s ease;';
    pill.onmouseenter = () => { pill.style.borderColor = '#f47920'; pill.style.transform = 'translateY(-1px)'; };
    pill.onmouseleave = () => { pill.style.borderColor = 'rgba(244,121,32,0.45)'; pill.style.transform = 'none'; };
    pill.onclick = () => window.ichtusDevReload();
    document.body.appendChild(pill);
}

// Keyboard shortcuts: F5, Ctrl+R, Cmd+R -> clean dev reload
window.addEventListener('keydown', (e) => {
    const isF5 = e.key === 'F5';
    const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R');
    if (isF5 || isCtrlR) {
        e.preventDefault();
        window.ichtusDevReload();
    }
});

// Detect dev mode via Tauri init flag or /api/health
if (window.__ICHTUS_DEV__) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountDevToolbar);
    } else {
        mountDevToolbar();
    }
} else {
    fetch('/api/health').then(r => r.json()).then(info => {
        if (info && info.dev_mode) {
            window.__ICHTUS_DEV__ = true;
            mountDevToolbar();
        }
    }).catch(() => {});
}

// Auto-connect on load
WsClient.connect();
