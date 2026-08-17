/**
 * X32 OSC Bridge Routes
 *
 * Verplaatst uit x32/server.js en gemigreerd naar Express Router.
 * Behoudt de volledige OSC communicatie met de Behringer X32 mixer
 * via UDP poort 10023. Session manager voor persistent connection
 * en preset polling is intact gelaten.
 *
 * Nieuw: WebSocket broadcast voor realtime status updates.
 */

import { Router } from 'express';
import oscPkg from 'osc';
const { UDPPort: OscPort } = oscPkg;

// ── Defaults ───────────────────────────────────────────────────────────
// Fallback IP — in de praktijk stuurt de SPA het IP altijd mee.
// Alleen relevant als /api/x32/presets/connect zonder IP wordt aangeroepen.
const DEFAULT_X32_IP = '192.168.1.50';
const X32_OSC_PORT = 10023;
const FULL_STRIP_SCOPE_MASK = 63;

// ── WebSocket broadcast (lazy import om circular dep te voorkomen) ─────
let _broadcast = null;
async function loadBroadcast() {
    if (!_broadcast) {
        const ws = await import('../ws.js');
        _broadcast = ws.broadcast;
    }
    return _broadcast;
}
function broadcast(event, data) {
    loadBroadcast().then((fn) => fn?.(event, data)).catch(() => {});
}

// ── OSC send (per-request, fresh UDPPort) ──────────────────────────────
async function sendOscToX32(x32Ip, messages) {
    const port = new OscPort({
        remoteAddress: x32Ip,
        remotePort: X32_OSC_PORT,
        localAddress: '0.0.0.0',
        localPort: 0,
        metadata: true,
    });

    port.on('error', (err) => {
        console.error(`  [X32] ${x32Ip}:${X32_OSC_PORT} error: ${err.message}`);
    });

    try {
        await port.open();
        for (const msg of messages) {
            port.send(msg);
        }
    } finally {
        await new Promise((r) => setTimeout(r, 50));
        try { await port.close(); } catch (_) {}
    }
}

function isValidChannel(c) {
    const n = Number(c);
    return Number.isInteger(n) && n >= 1 && n <= 32;
}

// ── Session Manager ────────────────────────────────────────────────────

class X32Session {
    constructor(ip) {
        this.ip = ip;
        this.port = null;
        this.connected = false;
        this.presets = {};
        this.lastPolled = null;
        this.pollInProgress = false;
        this.connectionError = null;
        this._pending = {};
        this._heartbeatTimer = null;
    }

    async connect() {
        if (this.connected) return;

        this.port = new OscPort({
            remoteAddress: this.ip,
            remotePort: X32_OSC_PORT,
            localAddress: '0.0.0.0',
            localPort: 0,
            metadata: true,
        });

        this.port.on('message', (message) => this._onMessage(message));
        this.port.on('error', (err) => {
            console.error(`  [X32 SESSION] ${this.ip} error: ${err.message}`);
            this.connectionError = err.message;
        });

        await this.port.open();
        this.connected = true;
        this.connectionError = null;
        console.log(`  [X32 SESSION] Connected to ${this.ip}:${X32_OSC_PORT}`);

        this.port.send({ address: '/xinfo', args: [] });

        this._heartbeatTimer = setInterval(() => {
            if (this.port && this.connected) {
                this.port.send({ address: '/xremote', args: [] });
            }
        }, 1500);

        try { broadcast('x32:status', this.getStatus()); } catch (_) {}
    }

    async disconnect() {
        this.connected = false;
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        for (const [addr, h] of Object.entries(this._pending)) {
            clearTimeout(h.timer);
            h.reject(new Error('Session disconnected'));
        }
        this._pending = {};
        this.presets = {};
        this.lastPolled = null;
        this.pollInProgress = false;

        if (this.port) {
            try { await this.port.close(); } catch (_) {}
            this.port = null;
        }
        console.log(`  [X32 SESSION] Disconnected from ${this.ip}`);
        try { broadcast('x32:status', this.getStatus()); } catch (_) {}
    }

    _onMessage(message) {
        const addr = message.address;
        const args = message.args || [];

        if (this._pending[addr]) {
            clearTimeout(this._pending[addr].timer);
            this._pending[addr].resolve(args);
            delete this._pending[addr];
        }

        const libMatch = addr.match(/^\/-libs\/(ch|fx|r|mon)\/(\d{3})\/(hasdata|name)$/);
        if (libMatch) {
            const lib = libMatch[1];
            const slot = libMatch[2];
            const field = libMatch[3];
            if (lib === 'ch') {
                if (!this.presets[slot]) this.presets[slot] = {};
                if (field === 'hasdata') {
                    this.presets[slot].hasdata = args[0]?.value === 1;
                } else if (field === 'name') {
                    this.presets[slot].name = args[0]?.value || '';
                }
            }
        }
    }

    _queryOsc(address, timeout = 1000) {
        return new Promise((resolve, reject) => {
            if (this._pending[address]) {
                clearTimeout(this._pending[address].timer);
                this._pending[address].reject(new Error('Superseded'));
            }

            const timer = setTimeout(() => {
                if (this._pending[address]) {
                    delete this._pending[address];
                    reject(new Error(`Timeout for "${address}"`));
                }
            }, timeout);

            this._pending[address] = { resolve, reject, timer };

            try {
                this.port.send({ address, args: [] });
            } catch (err) {
                clearTimeout(timer);
                delete this._pending[address];
                reject(err);
            }
        });
    }

    async pollLibrary(library = 'ch') {
        if (this.pollInProgress) {
            throw new Error('A poll is already in progress');
        }
        this.pollInProgress = true;

        const slots = Array.from({ length: 100 }, (_, i) =>
            String(i + 1).padStart(3, '0')
        );
        const results = {};
        const CONCURRENCY = 20;
        const TIMEOUT = 1000;

        for (let i = 0; i < slots.length; i += CONCURRENCY) {
            const batch = slots.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (slot) => {
                try {
                    const hasdataResp = await this._queryOsc(`/-libs/${library}/${slot}/hasdata`, TIMEOUT);
                    const hasDataVal = Array.isArray(hasdataResp) &&
                        hasdataResp[0]?.type === 'i' && hasdataResp[0]?.value === 1;

                    let name = '';
                    if (hasDataVal) {
                        try {
                            const nameResp = await this._queryOsc(`/-libs/${library}/${slot}/name`, TIMEOUT);
                            if (Array.isArray(nameResp) && nameResp[0]?.type === 's') {
                                name = nameResp[0].value || '';
                            }
                        } catch (_) {}
                    }
                    results[slot] = { hasdata: hasDataVal, name };
                } catch (err) {
                    results[slot] = { hasdata: false, name: '', error: err.message };
                }
            }));
        }

        this.presets = results;
        this.lastPolled = new Date().toISOString();
        this.pollInProgress = false;

        const occupied = Object.values(results).filter((r) => r.hasdata).length;
        console.log(`  [X32 SESSION] Polled ${library} library: ${occupied}/100 slots occupied`);
        try { broadcast('x32:presets', this.getPresets()); } catch (_) {}

        return { presets: results, occupied, total: 100, lastPolled: this.lastPolled };
    }

    getStatus() {
        const occupied = Object.values(this.presets).filter((r) => r.hasdata).length;
        return {
            connected: this.connected,
            ip: this.ip,
            connectionError: this.connectionError,
            lastPolled: this.lastPolled,
            pollInProgress: this.pollInProgress,
            occupiedSlots: occupied,
            totalSlots: 100,
        };
    }

    getPresets() {
        const occupied = Object.values(this.presets).filter((r) => r.hasdata).length;
        return {
            presets: { ...this.presets },
            occupied,
            total: 100,
            lastPolled: this.lastPolled,
        };
    }
}

let activeSession = null;

async function getOrCreateSession(ip) {
    const targetIp = (typeof ip === 'string' && ip.trim()) ? ip.trim() : DEFAULT_X32_IP;
    if (activeSession && activeSession.connected && activeSession.ip === targetIp) {
        return activeSession;
    }
    if (activeSession) {
        await activeSession.disconnect();
        activeSession = null;
    }
    activeSession = new X32Session(targetIp);
    await activeSession.connect();
    return activeSession;
}

// ── Express Router ─────────────────────────────────────────────────────

const router = Router();

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        oscTarget: { host: DEFAULT_X32_IP, port: X32_OSC_PORT },
        timestamp: new Date().toISOString(),
    });
});

router.post('/load-channel-preset', async (req, res) => {
    const { ip, channel, slot } = req.body || {};

    const targetIp = (typeof ip === 'string' && ip.trim()) ? ip.trim() : DEFAULT_X32_IP;
    if (!isValidChannel(channel)) {
        return res.status(400).json({ error: 'Ongeldig kanaal. Verwacht 1..32.' });
    }
    const presetSlot = Number(slot);
    if (!Number.isInteger(presetSlot) || presetSlot < 0 || presetSlot > 99) {
        return res.status(400).json({ error: 'Ongeldig preset-slot. Verwacht geheel getal 0..99.' });
    }

    const oscTargetChannel = Number(channel) - 1;
    const messages = [{
        address: '/load',
        args: [
            { type: 's', value: 'libchan' },
            { type: 'i', value: presetSlot },
            { type: 'i', value: oscTargetChannel },
            { type: 'i', value: FULL_STRIP_SCOPE_MASK },
        ],
    }];

    try {
        await sendOscToX32(targetIp, messages);
        res.json({ ok: true, x32: `${targetIp}:${X32_OSC_PORT}`, fired: messages });
    } catch (err) {
        console.error('  [X32] OSC send failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/send', async (req, res) => {
    const { ip, address, args } = req.body || {};

    const targetIp = (typeof ip === 'string' && ip.trim()) ? ip.trim() : DEFAULT_X32_IP;
    if (typeof address !== 'string' || !address.startsWith('/')) {
        return res.status(400).json({ error: 'Ongeldig OSC-adres. Moet beginnen met "/".' });
    }
    if (args !== undefined && !Array.isArray(args)) {
        return res.status(400).json({ error: 'args moet een array zijn, of weggelaten.' });
    }

    const safeArgs = (Array.isArray(args) ? args : []).map((a) => {
        if (!a || typeof a !== 'object') return null;
        const t = String(a.type || '').toLowerCase();
        if (!['i', 'f', 's', 'b'].includes(t)) return null;
        return { type: t, value: a.value };
    });

    try {
        await sendOscToX32(targetIp, [{ address, args: safeArgs }]);
        res.json({ ok: true, x32: `${targetIp}:${X32_OSC_PORT}`, fired: { address, args: safeArgs } });
    } catch (err) {
        console.error('  [X32] OSC send failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Batch send through the active session — uses the persistent
// connection that already has /xremote active, so the X32
// accepts commands on the subscribed port.
router.post('/session/send', async (req, res) => {
    if (!activeSession || !activeSession.connected || !activeSession.port) {
        return res.status(400).json({ error: 'Geen actieve X32 sessie — klik eerst Connect.' });
    }
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages moet een niet-lege array zijn.' });
    }
    const safe = [];
    for (const m of messages) {
        if (!m || typeof m !== 'object' || typeof m.address !== 'string') continue;
        const safeArgs = Array.isArray(m.args) ? m.args.map((a) => {
            if (!a || typeof a !== 'object') return null;
            const t = String(a.type || '').toLowerCase();
            if (!['i', 'f', 's', 'b'].includes(t)) return null;
            return { type: t, value: a.value };
        }).filter(Boolean) : [];
        safe.push({ address: m.address, args: safeArgs });
    }
    try {
        for (const m of safe) {
            activeSession.port.send(m);
        }
        res.json({ ok: true, count: safe.length, ip: activeSession.ip });
    } catch (err) {
        console.error('  [X32 SESSION] send failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/osc-info', (req, res) => {
    res.json({
        address: '/load',
        typeTags: 'siii',
        argSchema: [
            { index: 0, type: 's', role: 'type_tag', values: ['libchan'] },
            { index: 1, type: 'i', role: 'library_slot', min: 0, max: 99 },
            { index: 2, type: 'i', role: 'channel_input', min: 0, max: 31 },
            { index: 3, type: 'i', role: 'scope_mask', value: FULL_STRIP_SCOPE_MASK },
        ],
        oscPort: X32_OSC_PORT,
        defaultIp: DEFAULT_X32_IP,
    });
});

// ── Preset Discovery Endpoints ─────────────────────────────────────────

router.post('/presets/connect', async (req, res) => {
    const ip = (req.body && req.body.ip) || DEFAULT_X32_IP;
    try {
        const session = await getOrCreateSession(ip);
        res.json({ ok: true, ...session.getStatus() });
    } catch (err) {
        console.error('  [X32 PRESETS] Connect failed:', err.message);
        res.status(502).json({ error: err.message });
    }
});

router.post('/presets/disconnect', async (req, res) => {
    if (activeSession) {
        await activeSession.disconnect();
        activeSession = null;
    }
    res.json({ ok: true });
});

router.post('/presets/poll', async (req, res) => {
    if (!activeSession || !activeSession.connected) {
        return res.status(400).json({ error: 'Niet verbonden. Roep eerst /api/x32/presets/connect aan.' });
    }
    try {
        const result = await activeSession.pollLibrary('ch');
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/presets', (req, res) => {
    if (!activeSession || !activeSession.connected) {
        return res.json({ connected: false, presets: {}, occupied: 0, total: 100, lastPolled: null, ip: null });
    }
    const data = activeSession.getPresets();
    res.json({ connected: true, ...data, ip: activeSession.ip });
});

router.get('/presets/status', (req, res) => {
    if (!activeSession || !activeSession.connected) {
        return res.json({ connected: false });
    }
    res.json(activeSession.getStatus());
});

// ── Cleanup op shutdown ────────────────────────────────────────────────

export async function shutdownX32() {
    if (activeSession) {
        await activeSession.disconnect();
        activeSession = null;
    }
}

export default router;
