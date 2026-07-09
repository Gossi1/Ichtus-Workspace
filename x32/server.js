/**
 * Ichtus X32 Channel Preset Loader
 *
 * A tiny HTTP bridge: the browser sends fetch() requests, this server
 * turns them into OSC packets and blasts them over UDP port 10023 to
 * your Behringer X32. Browsers can't speak UDP directly, so the X32
 * mixer is reached through this local proxy.
 *
 * Why this exists: the X32 listens for OSC commands on UDP port 10023
 * but has no HTTP interface. The sound engineer saves channel-strip
 * presets into the X32's onboard library (Setup → Library → CHANNEL),
 * then later wants to recall a chosen slot onto a chosen input channel
 * without scrolling through the console menu. The browser-side flow
 * (Stage Builder, or the standalone x32/index.html form on :3002) hits
 * /api/load-channel-preset below; this bridge hands the X32 a single
 * OSC packet that does the recall.
 *
 * The canonical X32 channel-library recall opcode is:
 *
 *   /load ,siii <type_tag> <slot> <channel_0idx> <scope_mask>
 *
 *     type_tag      = "libchan" (identifies a channel-library preset;
 *                                 vs "libeq", "libgate" for sub-blocks)
 *     slot          = 0..99 (the X32's library slot index — slot
 *                     index 0 corresponds to console "001")
 *     channel_0idx  = 0 (input 1) .. 71 (the X32's internal channel
 *                     encoding; 0-31 = inputs 1-32, 32-39 = aux 1-8,
 *                     40-47 = fx 1-8, 48-63 = mix 1-16, 64-69 = matrix
 *                     1-6, 70 = main LR, 71 = main mono). The bridge
 *                     only deals with input channels (1-32 → 0-31).
 *     scope_mask    = 63 recalls the entire strip (HAmP + Gate + Dyn
 *                     + EQ + Sends + Fader/Mute); sub-bitmasks 1..62
 *                     pick partial recalls and are not exposed here.
 *
 * Earlier revisions of this file also fired `/ch/<NN>/lib/load ,i <slot>`
 * and `/presets/load ,siss <name> <category> <slot> <destination>` as
 * fallbacks, but X32 firmware silently drops both of those — there is
 * no `/ch/<NN>/lib/load` opcode and `/presets/load`'s argument layout
 * does not match what `,siss` produces. `/load ,siii "libchan"` is the
 * one path the firmware actually recognizes, so we send only that.
 *
 * Setup:
 *   1. cd x32/
 *   2. npm install
 *   3. node server.js
 *   4. Open http://localhost:3002 in your browser (or use the Stage
 *      Builder's Push Coordinates to X32 button in the main SPA).
 *   5. Type the X32's IP (Settings → Network on the console), pick a
 *      channel + preset slot, hit "Load preset".
 */

import express from 'express';
import cors from 'cors';
// `osc` v2 is published as CommonJS, so named imports under ESM throw
// `SyntaxError: Named export 'Client' not found`. We import the
// default-export object (the module's `module.exports` in the
// underlying CJS) and pull `UDPPort` off it. Older tutorials that
// reference `Client` / `Server` are out of date -- those classes
// were removed in v2 in favour of UDPPort / TCPSocketPort /
// UnixSocketPort constructors.
import oscPkg from 'osc';
const { UDPPort: OscPort } = oscPkg;
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Defaults ────────────────────────────────────────────────────────────

// X32 ships from the factory on 192.168.1.50 with OSC port 10023. If
// the operator changed it through Setup → Network, just edit the
// field in the browser — these are only the boot-time fallbacks.
const DEFAULT_X32_IP = '192.168.1.50';
const X32_OSC_PORT = 10023;

// HTTP port. 3000 was taken by the main SPA, 3001 by the mic-iem
// bridge, so this lives at 3002. All three coexist because they all
// listen on localhost-only.
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '127.0.0.1';

// X32 channel-library recall uses a single integer scope bitmask; 63
// (= 0b00111111) is "recall everything". Anything lower does a partial
// recall (1 = HAmP only, 2 = Config, etc.). The operator UI always
// wants the full strip, so we hardcode 63 here; if a future UI needs
// partial recall, expose this as a request body field.
const FULL_STRIP_SCOPE_MASK = 63;

// ── X32 Session Manager (persistent OSC connection for polling) ─────────
//
// The fire-and-forget endpoints (load-channel-preset, send) use ephemeral
// UDPPorts per request. The session manager below maintains a persistent
// connection for metadata discovery: it sends /xremote every 1500ms as a
// heartbeat, queries all 100 library slots for hasdata + name, caches the
// results, and exposes them via REST. Only one active session at a time;
// switching to a new IP tears down the old session.

class X32Session {
    constructor(ip) {
        this.ip = ip;
        this.port = null;
        this.connected = false;
        this.presets = {};       // { '001': { hasdata: true, name: 'Lead Vocal' }, ... }
        this.lastPolled = null;
        this.pollInProgress = false;
        this.connectionError = null;

        // Map of pending OSC queries: address -> { resolve, reject, timer }
        this._pending = {};
        this._heartbeatTimer = null;
        this._xinfoTimer = null;
    }

    /**
     * Open a persistent UDPPort, send /xinfo to sync, start heartbeat.
     * Resolves once the port is open (not waiting for /xinfo response).
     */
    async connect() {
        if (this.connected) return;

        this.port = new OscPort({
            remoteAddress: this.ip,
            remotePort: X32_OSC_PORT,
            // Bind explicitly to 0.0.0.0 (any interface) — osc-js v2's
            // default localAddress is '127.0.0.1', which Windows refuses
            // to route to non-loopback destinations and surfaces as
            // WSAENETUNREACH on every send. PowerShell '.NET UdpClient'
            // defaults to IPAddress.Any (0.0.0.0) and works fine, which
            // is the asymmetry we observed in the diagnostic probe.
            localAddress: '0.0.0.0',
            localPort: 0,
            // metadata: true so incoming OSC responses carry typed args
            // ({ type: 'i', value: 1 }) instead of raw JS values
            metadata: true
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

        // Send /xinfo to sync with the mixer — the response tells us the
        // console is alive and starts streaming state changes.
        this.port.send({ address: '/xinfo', args: [] });

        // Start heartbeat: send /xremote every 1500ms to keep the mixer
        // streaming state changes. Without this the X32 stops responding
        // after ~10 seconds.
        this._heartbeatTimer = setInterval(() => {
            if (this.port && this.connected) {
                this.port.send({ address: '/xremote', args: [] });
            }
        }, 1500);

        // No auto-poll scheduled here. The SPA's `connectToX32()`
        // always fires `pollX32Presets()` immediately after the
        // connect resolves, so a 2-second-delayed auto-poll would
        // race against that manual poll and the loser would hit
        // `pollInProgress = true` and throw
        // "A poll is already in progress" (HTTP 500). The
        // standalone x32/index.html UI does not use the
        // /api/x32-presets/* endpoints at all (only
        // /api/load-channel-preset and /api/health), so removing the
        // auto-poll does not regress it.
    }

    /**
     * Tear down the persistent connection, stop heartbeat, clear cache.
     */
    async disconnect() {
        this.connected = false;
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        if (this._xinfoTimer) {
            clearTimeout(this._xinfoTimer);
            this._xinfoTimer = null;
        }
        // Reject any in-flight OSC queries so they don't hang forever
        for (const [addr, h] of Object.entries(this._pending)) {
            clearTimeout(h.timer);
            h.reject(new Error('Session disconnected'));
        }
        this._pending = {};
        this.presets = {};
        this.lastPolled = null;
        this.pollInProgress = false;

        if (this.port) {
            try { await this.port.close(); } catch (_) { /* ok */ }
            this.port = null;
        }
        console.log(`  [X32 SESSION] Disconnected from ${this.ip}`);
    }

    /**
     * Handle an incoming OSC message from the mixer.
     * If there's a pending resolver for this address, resolve it.
     * Otherwise it's an unsolicited state update (cache if useful).
     */
    _onMessage(message) {
        const addr = message.address;
        const args = message.args || [];

        // Check for a pending query resolver first
        if (this._pending[addr]) {
            clearTimeout(this._pending[addr].timer);
            this._pending[addr].resolve(args);
            delete this._pending[addr];
        }

        // Also cache library data if it arrives (e.g. via state subscription)
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

    /**
     * Send a query OSC message and wait for a response.
     * Uses a pending-resolver pattern: registers this address in _pending,
     * fires the query, and resolves/rejects when the mixer responds or
     * the timeout fires.
     */
    _queryOsc(address, timeout = 1000) {
        return new Promise((resolve, reject) => {
            // If there's already a pending query for this exact address,
            // reject it first (shouldn't happen in our polling pattern)
            if (this._pending[address]) {
                clearTimeout(this._pending[address].timer);
                this._pending[address].reject(new Error('Superseded by new query'));
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

    /**
     * Poll all 100 library slots for the 'ch' (channel) library.
     * Queries /-libs/ch/{001..100}/hasdata and /-libs/ch/{001..100}/name.
     * Uses concurrency-limited batches so we don't flood the X32.
     *
     * Per the X32 protocol:
     * - 100 slots × 2 paths = 200 queries total
     * - Up to 20 concurrent queries
     * - 500ms timeout per query recommended (we use 1000ms for safety)
     * - Empty slots return hasdata=0 and skip the name query
     */
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

        // Process in batches of CONCURRENCY
        for (let i = 0; i < slots.length; i += CONCURRENCY) {
            const batch = slots.slice(i, i + CONCURRENCY);
            const batchPromises = batch.map(async (slot) => {
                try {
                    const hasdataResp = await this._queryOsc(
                        `/-libs/${library}/${slot}/hasdata`,
                        TIMEOUT
                    );
                    const hasDataVal = Array.isArray(hasdataResp) &&
                        hasdataResp[0]?.type === 'i' &&
                        hasdataResp[0]?.value === 1;

                    let name = '';
                    if (hasDataVal) {
                        try {
                            const nameResp = await this._queryOsc(
                                `/-libs/${library}/${slot}/name`,
                                TIMEOUT
                            );
                            if (Array.isArray(nameResp) && nameResp[0]?.type === 's') {
                                name = nameResp[0].value || '';
                            }
                        } catch (_) {
                            // Name query failed — slot has data but we couldn't
                            // get the name. Leave it empty.
                        }
                    }

                    results[slot] = { hasdata: hasDataVal, name };
                } catch (err) {
                    // Query timeout or connection error
                    results[slot] = {
                        hasdata: false,
                        name: '',
                        error: err.message
                    };
                }
            });
            await Promise.all(batchPromises);
        }

        this.presets = results;
        this.lastPolled = new Date().toISOString();
        this.pollInProgress = false;

        const occupied = Object.values(results).filter(r => r.hasdata).length;
        console.log(`  [X32 SESSION] Polled ${library} library: ${occupied}/100 slots occupied`);

        return { presets: results, occupied, total: 100, lastPolled: this.lastPolled };
    }

    /**
     * Return a summary of the session state and cached presets.
     */
    getStatus() {
        const occupied = Object.values(this.presets).filter(r => r.hasdata).length;
        return {
            connected: this.connected,
            ip: this.ip,
            connectionError: this.connectionError,
            lastPolled: this.lastPolled,
            pollInProgress: this.pollInProgress,
            occupiedSlots: occupied,
            totalSlots: 100
        };
    }

    /**
     * Get the cached presets as a clean array.
     */
    getPresets() {
        const occupied = Object.values(this.presets).filter(r => r.hasdata).length;
        return {
            presets: { ...this.presets },
            occupied,
            total: 100,
            lastPolled: this.lastPolled
        };
    }
}

// Singleton: only one active X32 session at a time.
let activeSession = null;

async function getOrCreateSession(ip) {
    const targetIp = (typeof ip === 'string' && ip.trim()) ? ip.trim() : DEFAULT_X32_IP;
    if (activeSession && activeSession.connected && activeSession.ip === targetIp) {
        return activeSession;
    }
    // Tear down old session if IP changed
    if (activeSession) {
        await activeSession.disconnect();
        activeSession = null;
    }
    activeSession = new X32Session(targetIp);
    await activeSession.connect();
    return activeSession;
}

// ── OSC send (stateless, fresh UDPPort per request) ─────────────────────
//
// We deliberately do NOT cache a UDPPort across requests. osc-js v2's
// UDPPort has no `reuseAddr` knob, and on the second `port.send()` of
// a cached port the previous local bind (something like
// 127.0.0.1:57121) collides with a lingering TIME_WAIT or rebind
// attempt — `EADDRINUSE` — and the rejection cascades through the rest
// of the route as "Cannot read properties of undefined (reading
// 'then')" because the cached handshake entry gets evicted mid-flight.
// Open a fresh socket per request, set `localPort: 0` so the OS picks
// an ephemeral local port every time (no reuse, no collision), send
// the messages, and close in `finally` so the descriptor is reclaimed
// even on partial failure. The per-request handshake is cheap (a
// single UDP bind) and removes the whole EADDRINUSE failure class.
//
// With the canonical /load ,siii "libchan" opcode we only fire ONE
// message per recall, so the for-loop is just ammunition in case a
// future revision adds a fallback opcode.
async function sendOscToX32(x32Ip, messages) {
    const port = new OscPort({
        remoteAddress: x32Ip,
        remotePort: X32_OSC_PORT,
        // Bind explicitly to 0.0.0.0 (any interface) so the socket can
        // route to non-loopback destinations. osc-js v2's default
        // localAddress is '127.0.0.1', which Windows rejects with
        // WSAENETUNREACH. Mirrors the persistent-session fix.
        localAddress: '0.0.0.0',
        // OS picks an unused local port per socket — sidesteps
        // EADDRINUSE on the second-and-later push without keeping
        // any long-lived state in this process.
        localPort: 0,
        // metadata: true (not false) — osc-js v2 with metadata:false
        // expects raw JS primitives and serialises wrapped {type,value}
        // objects as "[object Object]" strings, which the X32 silently
        // rejects. We always pass wrapped args in /api/load-channel-preset
        // and /api/send, so we need the typed-args serializer. Mirrors
        // the persistent-session X32Session.connect() setting.
        metadata: true
    });

    // Forward low-level socket errors to the bridge log so an
    // operator sees "X32 offline" instead of silent dead-socket.
    port.on('error', err => {
        console.error(`  [X32] ${x32Ip}:${X32_OSC_PORT} error: ${err.message}`);
    });

    try {
        await port.open();
        for (const msg of messages) {
            port.send(msg);
        }
    } finally {
        // Free the local port descriptor no matter how we exit —
        // success or error — so a long run of pushes doesn't leak
        // sockets. `close()` resolves once dgram has torn down; on a
        // never-bound socket (`port.open()` rejected before bind) the
        // rare EBADF is harmless, so we just swallow it.
        //
        // Give dgram 50ms to flush the send queue before close().
        // Node's dgram.send() is fire-and-forget — the packet is
        // queued in the kernel, but if we tear down the socket before
        // the kernel transmits, the datagram is silently dropped and
        // the X32 never sees it (even though the bridge returns
        // ok:true, because ok:true only means "OSC packet accepted
        // into the local dgram queue"). 50ms is well below operator
        // perception and far shorter than the X32's OSC receive
        // window, so it's free.
        await new Promise(resolve => setTimeout(resolve, 50));
        try { await port.close(); } catch (_) { /* never-bound or already-closing */ }
    }
}

// Channel-number validation: the X32 has 32 mono input channels, 16
// bus returns, 8 aux, 8 fx returns, 16 mixbus, 6 matrix, DCA, main.
// We accept the input-channel range (1–32) for the main flow; the
// raw-OSC box below accepts any valid /<path>/<N>/... the operator
// types.
function isValidChannel(c) {
    const n = Number(c);
    return Number.isInteger(n) && n >= 1 && n <= 32;
}

// ── Express app ─────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cors());

// Serve the SPA from the same folder as this script.
app.use(express.static(__dirname));

/**
 * GET /api/health
 * Returns {status, defaults} so the bootstrap page can show the
 * default X32 IP and let the operator confirm the bridge is live.
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        oscTarget: { host: DEFAULT_X32_IP, port: X32_OSC_PORT },
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/load-channel-preset
 * Body: { ip, channel, slot }
 *   ip        — X32 IP, default 192.168.1.50
 *   channel   — 1–32 (input strip; the bridge 0-indexes for `/load`)
 *   slot      — 0–99 (library slot)
 *
 * Response: { ok, fired:[{address, args}, ...], x32:<ip>:<port> }
 *
 * Fires `/load ,siii "libchan" <slot> <channel-1> 63` per the X32 OSC
 * reference. The console is "best effort": there is no acknowledgement
 * from the X32 over OSC unless an operator has an OSC listener on port
 * 10024, so "ok:true" means "OSC packet left this machine", not
 * "preset actually loaded on the console" — the operator confirms via
 * the X32's tactile buttons / the Channel Library screen.
 */
app.post('/api/load-channel-preset', async (req, res) => {
    const { ip, channel, slot } = req.body || {};

    const targetIp = (typeof ip === 'string' && ip.trim()) ? ip.trim() : DEFAULT_X32_IP;
    if (!isValidChannel(channel)) {
        return res.status(400).json({
            error: 'Ongeldig kanaal. Verwacht 1..32.'
        });
    }
    const presetSlot = Number(slot);
    if (!Number.isInteger(presetSlot) || presetSlot < 0 || presetSlot > 99) {
        return res.status(400).json({
            error: 'Ongeldig preset-slot. Verwacht geheel getal 0..99.'
        });
    }

    // 1-indexed input channel → 0-indexed X32 internal channel index.
    // The /load opcode encodes the target channel as 0..31 for inputs,
    // not the "ch05"-shaped string some other paths use.
    const oscTargetChannel = Number(channel) - 1;

    const messages = [
        {
            address: '/load',
            args: [
                { type: 's', value: 'libchan' },
                { type: 'i', value: presetSlot },
                { type: 'i', value: oscTargetChannel },
                { type: 'i', value: FULL_STRIP_SCOPE_MASK }
            ]
        }
    ];

    try {
        await sendOscToX32(targetIp, messages);
        res.json({
            ok: true,
            x32: `${targetIp}:${X32_OSC_PORT}`,
            fired: messages
        });
    } catch (err) {
        console.error('  [X32] OSC send failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/send
 * Body: { ip, address, args }
 *   address — full OSC path, e.g. "/ch/03/mix/fader"
 *   args    — [{type:"f",value:0.75}, …]
 *
 * Power-user escape hatch: lets an operator fire any single OSC
 * message through the same bridge. Useful for clearing stuck states
 * (e.g. /ch/NN/mute ,i 0) or probing the console during setup.
 */
app.post('/api/send', async (req, res) => {
    const { ip, address, args } = req.body || {};

    const targetIp = (typeof ip === 'string' && ip.trim()) ? ip.trim() : DEFAULT_X32_IP;
    if (typeof address !== 'string' || !address.startsWith('/')) {
        return res.status(400).json({
            error: 'Ongeldig OSC-adres. Moet beginnen met "/".'
        });
    }
    if (args !== undefined && !Array.isArray(args)) {
        return res.status(400).json({
            error: 'args moet een array zijn, of weggelaten.'
        });
    }

    // Arg-type whitelist: only OSC primitives the X32 accepts, with
    // the type tag forced from the payload (never inferred from JS
    // type — a JS number could be float or int depending on firmware).
    const safeArgs = (Array.isArray(args) ? args : []).map(a => {
        if (!a || typeof a !== 'object') return null;
        const t = String(a.type || '').toLowerCase();
        const allowed = ['i', 'f', 's', 'b'];
        if (!allowed.includes(t)) return null;
        return { type: t, value: a.value };
    });

    try {
        await sendOscToX32(targetIp, [{ address, args: safeArgs }]);
        res.json({
            ok: true,
            x32: `${targetIp}:${X32_OSC_PORT}`,
            fired: { address, args: safeArgs }
        });
    } catch (err) {
        console.error('  [X32] OSC send failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/x32-osc-info
 * Returns metadata about the bridge's recall pattern — useful for the
 * SPA or the standalone form to display "(siii libchan slot ch idx 63)"
 * next to the IP field so the operator knows what opcode is being
 * fired. Also serves as a smoke test: this is what /api/load-channel-preset
 * POSTs, only readable.
 */
app.get('/api/x32-osc-info', (req, res) => {
    res.json({
        address: '/load',
        typeTags: 'siii',
        argSchema: [
            { index: 0, type: 's', role: 'type_tag',        values: ['libchan'] },
            { index: 1, type: 'i', role: 'library_slot',    min: 0, max: 99 },
            { index: 2, type: 'i', role: 'channel_input',   min: 0, max: 31,
              note: '0-indexed input channel — bridge subtracts 1 from the SPA 1-indexed value' },
            { index: 3, type: 'i', role: 'scope_mask',      value: FULL_STRIP_SCOPE_MASK,
              note: '63 = recall entire strip' }
        ],
        oscPort: X32_OSC_PORT,
        defaultIp: DEFAULT_X32_IP
    });
});

// ── X32 PRESET DISCOVERY ENDPOINTS ────────────────────────────────────
//
// These endpoints manage the persistent X32 session and its cached
// library metadata. See X32_PRESET_LIBRARY_PROTOCOL.md for the full
// OSC protocol reference.

/**
 * POST /api/x32-presets/connect
 * Body: { ip }
 *   ip — X32 IP address (optional, defaults to DEFAULT_X32_IP)
 *
 * Opens a persistent OSC connection to the X32, starts the /xremote
 * heartbeat, and auto-polls the channel library after 2s.
 */
app.post('/api/x32-presets/connect', async (req, res) => {
    const ip = (req.body && req.body.ip) || DEFAULT_X32_IP;
    try {
        const session = await getOrCreateSession(ip);
        res.json({ ok: true, ...session.getStatus() });
    } catch (err) {
        console.error('  [X32 PRESETS] Connect failed:', err.message);
        res.status(502).json({ error: err.message });
    }
});

/**
 * POST /api/x32-presets/disconnect
 * Tears down the active session.
 */
app.post('/api/x32-presets/disconnect', async (req, res) => {
    if (activeSession) {
        await activeSession.disconnect();
        activeSession = null;
    }
    res.json({ ok: true });
});

/**
 * POST /api/x32-presets/poll
 * Triggers a fresh poll of all 100 channel-library slots.
 */
app.post('/api/x32-presets/poll', async (req, res) => {
    if (!activeSession || !activeSession.connected) {
        return res.status(400).json({ error: 'Niet verbonden. Roep eerst /api/x32-presets/connect aan.' });
    }
    try {
        const result = await activeSession.pollLibrary('ch');
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/x32-presets
 * Returns the cached preset data and session status.
 */
app.get('/api/x32-presets', (req, res) => {
    if (!activeSession || !activeSession.connected) {
        return res.json({
            connected: false,
            presets: {},
            occupied: 0,
            total: 100,
            lastPolled: null,
            ip: null
        });
    }
    const data = activeSession.getPresets();
    res.json({
        connected: true,
        ...data,
        ip: activeSession.ip
    });
});

/**
 * GET /api/x32-presets/status
 * Returns just the session heartbeat status without the full preset list.
 */
app.get('/api/x32-presets/status', (req, res) => {
    if (!activeSession || !activeSession.connected) {
        return res.json({ connected: false });
    }
    res.json(activeSession.getStatus());
});

// ── Start ───────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
    console.log(`
  ╔══════════════════════════════════════════════╗
  ║   ICHTUS X32 PRESET LOADER                  ║
  ╠══════════════════════════════════════════════╣
  ║  UI:    http://${HOST}:${PORT}                 ║
  ║  OSC →  ${DEFAULT_X32_IP}:${X32_OSC_PORT}  (default)        ║
  ║                                              ║
  ║  Routes:                                     ║
  ║    POST /api/load-channel-preset             ║
  ║    POST /api/send (raw OSC)                  ║
  ║    GET  /api/x32-osc-info                    ║
  ║    GET  /api/health                          ║
  ║                                              ║
  ║  X32 Preset Discovery (new):                 ║
  ║    POST /api/x32-presets/connect   (connect) ║
  ║    POST /api/x32-presets/poll      (poll)    ║
  ║    GET  /api/x32-presets           (cached)  ║
  ║    GET  /api/x32-presets/status    (status)  ║
  ║    POST /api/x32-presets/disconnect(disconn) ║
  ╚══════════════════════════════════════════════╝
    `);
});

// ── Graceful shutdown ───────────────────────────────────────────────────
//
// sendOscToX32 opens and closes its UDPPort inside a try/finally for
// every request, so there are no long-lived descriptors to drain on
// re-run; this handler just makes sure Ctrl-C exits the process
// instead of leaving the Express listener hanging.
async function shutdown() {
    if (activeSession) {
        await activeSession.disconnect();
        activeSession = null;
    }
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
