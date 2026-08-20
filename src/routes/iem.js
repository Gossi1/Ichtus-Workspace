/**
 * Mic & IEM Monitor Routes
 *
 * Verplaatst uit mic-iem-server/server.js.
 * Server-owned real-time mic/IEM toewijzing en X32 library map.
 *
 * State wordt in het geheugen bewaard, gepersisteerd naar iem-state.json
 * (project root, gitignored) en gepusht naar alle clients via de
 * WebSocket hub (`iem:status`). Geen Firebase/Firestore meer voor dit
 * onderdeel.
 */

import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');
const STATE_FILE = resolve(ROOT_DIR, 'iem-state.json');

const router = Router();

// ── Defaults ───────────────────────────────────────────────────────────
const DEFAULT_HARDWARE = [
    { mic_id: 1, iem_pack: 'IEM Pack 1', frequency: '495.200 MHz' },
    { mic_id: 2, iem_pack: 'IEM Pack 2', frequency: '492.700 MHz' },
    { mic_id: 3, iem_pack: 'IEM Pack 3', frequency: '500.000 MHz' },
    { mic_id: 4, iem_pack: 'IEM Pack 4', frequency: '505.100 MHz' },
];

const MAX_X32_NAME_LENGTH = 64;

// ── In-memory state (single source of truth) ──────────────────────────
const state = {
    hardware: null,       // [{ mic_id, iem_pack, frequency }]
    channels: null,       // [{ mic_id, iem_pack, frequency, name, avatar_url, active }]
    x32Library: null,     // { naam: libSlot }
    x32LastUpdated: null, // ISO string
    lastUpdated: null,    // ISO string — laatste wijziging van live_status
};

function buildDefaultChannels(hardware) {
    return hardware.map((hw) => ({
        mic_id: hw.mic_id, iem_pack: hw.iem_pack, frequency: hw.frequency,
        name: 'Unassigned / Standby', avatar_url: null, active: false,
    }));
}

/**
 * Laad state van schijf, of gebruik een seed (opt-in Firestore-migratie uit
 * server.js, alleen met env IEM_MIGRATE_FROM_FIRESTORE=1), of defaults.
 * Een bestaand state-bestand heeft altijd voorrang op de seed.
 */
export function initIemState(seed = null) {
    let loaded = null;
    try {
        if (existsSync(STATE_FILE)) {
            loaded = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
        }
    } catch (err) {
        console.warn('  [IEM] State laden mislukt, gebruik defaults:', err.message);
    }

    const src = loaded || seed || {};
    state.hardware = Array.isArray(src.hardware) ? src.hardware : DEFAULT_HARDWARE;
    state.channels = Array.isArray(src.channels) ? src.channels : buildDefaultChannels(state.hardware);
    state.x32Library = (src.x32Library && typeof src.x32Library === 'object' && !Array.isArray(src.x32Library))
        ? src.x32Library : {};
    state.x32LastUpdated = src.x32LastUpdated || null;
    state.lastUpdated = src.lastUpdated || null;

    if (loaded) {
        console.log('  [IEM] Status geladen van iem-state.json');
    } else if (seed) {
        console.log('  [IEM] Status gemigreerd vanuit Firestore → iem-state.json');
    } else {
        console.log('  [IEM] Initiële status aangemaakt (defaults)');
    }
    persistState();
    return state;
}

export function iemStateFileExists() {
    return existsSync(STATE_FILE);
}

function persistState() {
    try {
        writeFileSync(STATE_FILE, JSON.stringify({
            hardware: state.hardware,
            channels: state.channels,
            x32Library: state.x32Library,
            x32LastUpdated: state.x32LastUpdated,
            lastUpdated: state.lastUpdated,
        }, null, 2), 'utf-8');
    } catch (err) {
        console.warn('  [IEM] State opslaan mislukt:', err.message);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

let _broadcast = null;
function bcast(event, data) {
    if (!_broadcast) {
        try {
            // Dynamic import voorkomt circular dep met server.js
            import('../ws.js').then((ws) => { _broadcast = ws.broadcast; _broadcast(event, data); }).catch(() => {});
        } catch (_) {}
    } else {
        _broadcast(event, data);
    }
}

function getHardwareConfig() {
    return state.hardware || DEFAULT_HARDWARE;
}

function loadX32Library() {
    if (state.x32Library && Object.keys(state.x32Library).length > 0) {
        return { lastUpdated: state.x32LastUpdated || null, map: state.x32Library };
    }
    return null;
}

function saveX32Library(map, lastUpdated) {
    state.x32Library = map;
    state.x32LastUpdated = lastUpdated;
    persistState();
}

function validateX32LibraryMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'Ongeldig lichaam. Verwacht { map: { naam: libSlot, ... }}.' };
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof k !== 'string') return { ok: false, reason: `Sleutel is geen string: ${String(k)}` };
        const trimmed = k.trim();
        if (!trimmed) return { ok: false, reason: 'Lege naam gevonden.' };
        if (trimmed.length > MAX_X32_NAME_LENGTH) return { ok: false, reason: `Naam "${trimmed}" is te lang (max ${MAX_X32_NAME_LENGTH} tekens).` };
        if (v === null || v === undefined) return { ok: false, reason: `Waarde voor ${trimmed} ontbreekt.` };
        if (typeof v !== 'number' && typeof v !== 'string') return { ok: false, reason: `Waarde voor ${trimmed} moet number of numerieke string zijn.` };
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 99) return { ok: false, reason: `Waarde voor "${trimmed}" moet geheel getal 0..99 zijn.` };
        cleaned[trimmed] = n;
    }
    if (Object.keys(cleaned).length === 0) {
        return { ok: false, reason: 'Map is leeg. Voeg minstens één naam met een library-slot toe.' };
    }
    return { ok: true, map: cleaned };
}

// ── Routes ─────────────────────────────────────────────────────────────

// Huidige status (hydratatie voor clients bij het laden van de widget)
router.get('/status', (req, res) => {
    res.json({
        hardware: getHardwareConfig(),
        channels: state.channels || buildDefaultChannels(getHardwareConfig()),
        x32Library: state.x32Library || {},
        lastUpdated: state.lastUpdated || null,
    });
});

// Directe toewijzing van kanalen (vervangt de oude browser-side Firestore write)
router.post('/assign', (req, res) => {
    const { channels } = req.body;
    if (!channels || !Array.isArray(channels)) {
        return res.status(400).json({ error: 'Ongeldig payload. Verwacht channels array.' });
    }
    for (const ch of channels) {
        if (!ch || typeof ch.mic_id !== 'number') {
            return res.status(400).json({ error: 'Ongeldig kanaal: mic_id (number) is verplicht.' });
        }
    }

    state.channels = channels;
    state.lastUpdated = new Date().toISOString();
    persistState();
    bcast('iem:status', { channels: state.channels, lastUpdated: state.lastUpdated });
    console.log('  [IEM] Toewijzing opgeslagen:', state.channels.map((c) => `mic ${c.mic_id} → ${c.name || 'standby'}`).join(', '));
    res.json({ success: true, channels: state.channels });
});

router.post('/update-roster', (req, res) => {
    const { roster } = req.body;
    if (!roster || !Array.isArray(roster)) {
        return res.status(400).json({ error: 'Ongeldig roster payload. Verwacht array.' });
    }

    try {
        const hardwareConfig = getHardwareConfig();
        const worshipLeader = roster.find((p) => p.role_name && p.role_name.toLowerCase() === 'worship leader');
        const pianoPlayer = roster.find((p) => p.role_name && p.role_name.toLowerCase() === 'piano');
        const leaderIsOnPiano = worshipLeader && pianoPlayer && worshipLeader.display_name === pianoPlayer.display_name;

        let wirelessUsers = [];
        if (worshipLeader && !leaderIsOnPiano) wirelessUsers.push(worshipLeader);

        const vocalists = roster.filter((p) =>
            p.role_name && (p.role_name.toLowerCase().includes('vocalist') || p.role_name.toLowerCase() === 'vocal')
        );
        wirelessUsers = wirelessUsers.concat(vocalists);

        const finalState = hardwareConfig.map((hw, idx) => {
            const person = wirelessUsers[idx] || null;
            return {
                mic_id: hw.mic_id, iem_pack: hw.iem_pack, frequency: hw.frequency,
                name: person ? person.display_name : 'Unassigned / Standby',
                avatar_url: person ? (person.image_url || null) : null,
                active: !!person,
            };
        });

        state.channels = finalState;
        state.lastUpdated = new Date().toISOString();
        persistState();

        console.log('  [ROSTER] Toewijzing berekend:', finalState.map((c) => `${c.name} (mic ${c.mic_id})`).join(', '));
        bcast('iem:status', { channels: finalState, lastUpdated: state.lastUpdated });
        res.json({ success: true, live_status: finalState });
    } catch (error) {
        console.error('  [ROSTER] Fout:', error.message);
        res.status(500).json({ error: error.message });
    }
});

router.post('/save-hardware-config', (req, res) => {
    const newConfig = req.body;
    if (!newConfig || !Array.isArray(newConfig)) {
        return res.status(400).json({ error: 'Ongeldige data. Verwacht array van mic configuraties.' });
    }
    for (const item of newConfig) {
        if (!item.mic_id || !item.iem_pack || !item.frequency) {
            return res.status(400).json({ error: 'Ongeldig item: mic_id, iem_pack en frequency zijn verplicht.' });
        }
    }

    try {
        state.hardware = newConfig;
        state.lastUpdated = new Date().toISOString();

        if (Array.isArray(state.channels) && state.channels.length) {
            state.channels = state.channels.map((ch) => {
                const hw = newConfig.find((h) => h.mic_id === ch.mic_id);
                return hw ? { ...ch, iem_pack: hw.iem_pack, frequency: hw.frequency } : ch;
            });
        } else {
            state.channels = buildDefaultChannels(newConfig);
        }
        persistState();

        console.log('  [CONFIG] Hardware opgeslagen:', newConfig.map((c) => `Mic ${c.mic_id}: ${c.iem_pack} @ ${c.frequency}`).join(', '));
        bcast('iem:status', { channels: state.channels, lastUpdated: state.lastUpdated });
        res.json({ success: true });
    } catch (error) {
        console.error('  [CONFIG] Fout:', error.message);
        res.status(500).json({ error: error.message });
    }
});

router.get('/x32-library', (req, res) => {
    const fromState = loadX32Library();
    if (fromState) return res.json(fromState);
    res.json({ map: {}, lastUpdated: null });
});

router.post('/x32-library', (req, res) => {
    const validation = validateX32LibraryMap(req.body?.map);
    if (!validation.ok) return res.status(400).json({ error: validation.reason });

    const payload = { map: validation.map, lastUpdated: new Date().toISOString() };
    try {
        saveX32Library(payload.map, payload.lastUpdated);
    } catch (err) {
        console.error('  [X32_LIB] State write failed:', err.message);
        return res.status(500).json({ error: err.message });
    }
    console.log('  [X32_LIB] Map saved:', Object.entries(validation.map).map(([k, v]) => `${k}→lib ${v}`).join(', '));
    res.json({ ok: true, ...payload });
});

export default router;
