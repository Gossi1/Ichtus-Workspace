/**
 * Ichtus MIC & IEM Monitor Backend
 *
 * Express server that:
 * 1. Receives roster data from WorshipTools (via Tampermonkey)
 * 2. Calculates mic/iem allocation based on AV Stage Business Rules
 * 3. Writes live_status to Firestore (real-time sync to all dashboards)
 * 4. Accepts hardware config edits from the dashboard Edit Mode
 *
 * Setup:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" → save as serviceAccountKey.json
 *      in this directory (mic-iem-server/)
 *   3. npm install
 *   4. node server.js
 */

import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Firebase Admin Initialisatie ──────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = join(__dirname, 'serviceAccountKey.json');

let firestore = null;

function initFirebaseAdmin() {
    if (!existsSync(SERVICE_ACCOUNT_PATH)) {
        console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║  FIREBASE SERVICE ACCOUNT NIET GEVONDEN              ║
  ╠═══════════════════════════════════════════════════════╣
  ║  1. Ga naar Firebase Console → Project Settings      ║
  ║  2. Service Accounts → "Generate new private key"    ║
  ║  3. Sla het JSON-bestand op als:                     ║
  ║     mic-iem-server/serviceAccountKey.json            ║
  ╚═══════════════════════════════════════════════════════╝
        `);
        return false;
    }

    try {
        const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        firestore = admin.firestore();
        console.log('  [FIREBASE] Admin SDK geïnitialiseerd ✓');
        return true;
    } catch (err) {
        console.error('  [FIREBASE] Initialisatie mislukt:', err.message);
        return false;
    }
}

// ── Default Hardware Config ───────────────────────────────────────────────

const DEFAULT_HARDWARE = [
    { mic_id: 1, iem_pack: 'IEM Pack 1', frequency: '495.200 MHz' },
    { mic_id: 2, iem_pack: 'IEM Pack 2', frequency: '492.700 MHz' },
    { mic_id: 3, iem_pack: 'IEM Pack 3', frequency: '500.000 MHz' },
    { mic_id: 4, iem_pack: 'IEM Pack 4', frequency: '505.100 MHz' }
];

// ── Default X32 Library Map ──────────────────────────────────────────────
//
// One operator-chosen name per row (max 64 chars, e.g. "WL Mic",
// "WL Keys (piano)", "Vox 2 (Sara)"), each mapped to the X32 channel-
// library slot ID the operator has uploaded into the console
// (Setup → Library → save). The names are free-form — there is no
// closed role enum anymore — so the same operator can define one name
// per channel-DSP they reuse on stage (his vocal mic, his piano, etc.).
// Multiple operators on different laptops see the same values via the
// Settings UI → they all write through this Express bridge to Firestore
// at `mic_monitor/x32_library` (collection `mic_monitor`, doc id
// `x32_library`). Sync is on-request only — the SPA exposes explicit
// Load/Save buttons that hit /api/x32-library; nothing fetches on init
// and nothing auto-pushes on every local save.
//
// NOTE: The Settings UI persists this map; consumers that actually
// translate it into OSC recall (`/ch/<N>/lib/load ,i <slot>`) still
// need to be wired in a future change. Today Firestore is the source of
// truth for the UI cross-laptop sync only.

const DEFAULT_X32_LIBRARY = {};

// ── Express App ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());

// ── Helpers ───────────────────────────────────────────────────────────────

async function getHardwareConfig() {
    if (!firestore) return DEFAULT_HARDWARE;
    try {
        const doc = await firestore.collection('mic_monitor').doc('config').get();
        if (doc.exists && doc.data().hardware && Array.isArray(doc.data().hardware)) {
            return doc.data().hardware;
        }
    } catch (err) {
        console.warn('  [FIREBASE] Kon config niet ophalen, gebruik default:', err.message);
    }
    return DEFAULT_HARDWARE;
}

// Load the operator's X32 library map from Firestore. Returns null
// when the doc is missing (first install), the schema is wrong, or the
// bridge is offline — in all cases the caller falls back to in-memory
// defaults. The map must contain at least one entry; an empty map doc
// is treated as "no saved values" so the operator doesn't stare at a
// settings panel that says "saved" while showing zero rows. A missing
// serviceAccountKey.json makes `firestore` null and falls through to
// defaults silently.
async function loadX32LibraryFromFirestore() {
    if (!firestore) return null;
    try {
        const doc = await firestore.collection('mic_monitor').doc('x32_library').get();
        if (!doc.exists) return null;
        const data = doc.data();
        if (
            data &&
            data.map &&
            typeof data.map === 'object' &&
            !Array.isArray(data.map) &&
            Object.keys(data.map).length > 0
        ) {
            return {
                lastUpdated: data.lastUpdated || null,
                map: data.map
            };
        }
        console.warn('  [X32_LIB] Firestore doc schema unexpected of leeg — falling back to defaults');
    } catch (err) {
        console.warn('  [X32_LIB] Firestore read mislukt:', err.message);
    }
    return null;
}

// Persist the operator's map payload to Firestore. Throws so the
// POST route can return 500 — silent failure here would leave the
// operator confused about whether their click actually saved. Last-
// writer-wins via `set()` (full doc replace). The companion read
// helper enforces the same shape so any future field additions stay
// in lockstep on both ends.
async function saveX32LibraryToFirestore(map, lastUpdated) {
    if (!firestore) {
        throw new Error('Firestore niet geïnitialiseerd. Voeg serviceAccountKey.json toe en herstart de server.');
    }
    await firestore.collection('mic_monitor').doc('x32_library').set({
        map,
        lastUpdated
    });
}

// Validate the operator-supplied map shape. Each entry must be a string
// key (operator-chosen name, max 64 chars after trim) mapped to a
// non-negative integer ≤ 99. The key alphabet is open-allow-list so
// operators can introduce any name they want — Stage Builder's
// commitLayout() will resolve the slot via display_name later.
// Duplicate names would silently merge into a single object key so the
// shape itself enforces uniqueness.
const MAX_X32_NAME_LENGTH = 64;
function validateX32LibraryMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'Ongeldig lichaam. Verwacht { map: { naam: libSlot, ... }}.' };
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof k !== 'string') {
            return { ok: false, reason: `Sleutel is geen string: ${String(k)}` };
        }
        const trimmed = k.trim();
        if (!trimmed) {
            return { ok: false, reason: 'Lege naam gevonden.' };
        }
        if (trimmed.length > MAX_X32_NAME_LENGTH) {
            return { ok: false, reason: `Naam \u201c${trimmed}\u201d is te lang (max ${MAX_X32_NAME_LENGTH} tekens).` };
        }
        if (v === null || v === undefined) {
            return { ok: false, reason: 'Waarde voor ' + trimmed + ' ontbreekt.' };
        }
        if (typeof v !== 'number' && typeof v !== 'string') {
            return { ok: false, reason: 'Waarde voor ' + trimmed + ' moet number of numerieke string zijn (kreeg ' + typeof v + ').' };
        }
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 99) {
            return { ok: false, reason: `Waarde voor \u201c${trimmed}\u201d moet geheel getal 0..99 zijn (kreeg ${JSON.stringify(v)}).` };
        }
        cleaned[trimmed] = n;
    }
    // An empty map would round-trip into a valid POST but leave the
    // on-disk file with `{ map: {} }` which is worse than the first-time
    // defaults state. Refuse explicitly so the UI shows a 400 instead
    // of silently saving "nothing".
    if (Object.keys(cleaned).length === 0) {
        return { ok: false, reason: 'Map is leeg. Voeg minstens één naam met een library-slot toe.' };
    }
    return { ok: true, map: cleaned };
}

async function seedInitialConfig() {
    if (!firestore) return;
    try {
        const docRef = firestore.collection('mic_monitor').doc('config');
        const doc = await docRef.get();
        if (!doc.exists) {
            await docRef.set({ hardware: DEFAULT_HARDWARE, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            console.log('  [FIREBASE] Initiële hardware config aangemaakt in Firestore');
        }
        // Also ensure live_status exists
        const statusRef = firestore.collection('mic_monitor').doc('live_status');
        const statusDoc = await statusRef.get();
        if (!statusDoc.exists) {
            const initialState = DEFAULT_HARDWARE.map(hw => ({
                mic_id: hw.mic_id,
                iem_pack: hw.iem_pack,
                frequency: hw.frequency,
                name: 'Unassigned / Standby',
                avatar_url: null,
                active: false
            }));
            await statusRef.set({ channels: initialState, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            console.log('  [FIREBASE] Initiële live_status aangemaakt in Firestore');
        }
    } catch (err) {
        console.warn('  [FIREBASE] Seed mislukt:', err.message);
    }
}

// ── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/update-roster
 *
 * Ontvangt de scraped roster van de WorshipTools Tampermonkey extensie
 * en berekent de mic/iem toewijzing op basis van de AV Stage Business Rules.
 *
 * Request body: { roster: [{ role_name, display_name, image_url }, ...] }
 *
 * Regels:
 * 1. Worship Leader krijgt Mic 1 (behalve als hij/zij op piano staat)
 * 2. Vocalisten worden toegevoegd aan de overige mic kanalen
 * 3. Als WL op piano staat, schuift iedereen 1 plek op (geen vrije mic voor WL)
 */
app.post('/api/update-roster', async (req, res) => {
    const { roster } = req.body;

    if (!roster || !Array.isArray(roster)) {
        return res.status(400).json({ error: 'Ongeldig roster payload. Verwacht array.' });
    }

    try {
        // Stap 1: Haal actuele hardware config op uit Firestore
        const hardwareConfig = await getHardwareConfig();

        // Stap 2: Pas de AV Stage Business Rules toe
        const worshipLeader = roster.find(p =>
            p.role_name && p.role_name.toLowerCase() === 'worship leader'
        );
        const pianoPlayer = roster.find(p =>
            p.role_name && p.role_name.toLowerCase() === 'piano'
        );

        // Regel: Staat de Worship Leader ingepland op piano?
        const leaderIsOnPiano = worshipLeader && pianoPlayer &&
            worshipLeader.display_name === pianoPlayer.display_name;

        let wirelessUsers = [];

        // Indien WL front-stage staat (niet op piano), krijgt deze Mic 1
        if (worshipLeader && !leaderIsOnPiano) {
            wirelessUsers.push(worshipLeader);
        }

        // Filter alle vocalisten eruit en voeg ze lineair toe
        const vocalists = roster.filter(p =>
            p.role_name && (p.role_name.toLowerCase().includes('vocalist') ||
                p.role_name.toLowerCase() === 'vocal')
        );
        wirelessUsers = wirelessUsers.concat(vocalists);

        // Stap 3: Map de gebruikers op de fysieke mic kanalen
        const finalCalculatedState = hardwareConfig.map((hardware, index) => {
            const assignedPerson = wirelessUsers[index] || null;
            return {
                mic_id: hardware.mic_id,
                iem_pack: hardware.iem_pack,
                frequency: hardware.frequency,
                name: assignedPerson ? assignedPerson.display_name : 'Unassigned / Standby',
                avatar_url: assignedPerson ? (assignedPerson.image_url || null) : null,
                active: assignedPerson ? true : false
            };
        });

        // Stap 4: Schrijf naar Firestore (alle dashboards worden realtime geüpdatet)
        if (firestore) {
            await firestore.collection('mic_monitor').doc('live_status').set({
                channels: finalCalculatedState,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        console.log('  [ROSTER] Toewijzing berekend en opgeslagen:', finalCalculatedState.map(c => `${c.name} (mic ${c.mic_id})`).join(', '));
        res.json({ success: true, live_status: finalCalculatedState });

    } catch (error) {
        console.error('  [ROSTER] Fout:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/save-hardware-config
 *
 * Slaat aangepaste hardware parameters (IEM pack, frequentie) op in Firestore.
 * Dit wordt aangeroepen vanuit de Edit Mode in het dashboard.
 *
 * Request body: [{ mic_id, iem_pack, frequency }, ...]
 */
app.post('/api/save-hardware-config', async (req, res) => {
    const newConfig = req.body;

    if (!newConfig || !Array.isArray(newConfig)) {
        return res.status(400).json({ error: 'Ongeldige data. Verwacht array van mic configuraties.' });
    }

    // Validatie
    for (const item of newConfig) {
        if (!item.mic_id || !item.iem_pack || !item.frequency) {
            return res.status(400).json({ error: `Ongeldig item: mic_id, iem_pack en frequency zijn verplicht.` });
        }
    }

    try {
        if (firestore) {
            await firestore.collection('mic_monitor').doc('config').set({
                hardware: newConfig,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Haal de huidige live_status op en werk de hardware velden bij
            const statusDoc = await firestore.collection('mic_monitor').doc('live_status').get();
            if (statusDoc.exists) {
                const currentStatus = statusDoc.data().channels || [];
                const updatedStatus = currentStatus.map(ch => {
                    const hwUpdate = newConfig.find(hw => hw.mic_id === ch.mic_id);
                    if (hwUpdate) {
                        return { ...ch, iem_pack: hwUpdate.iem_pack, frequency: hwUpdate.frequency };
                    }
                    return ch;
                });
                await firestore.collection('mic_monitor').doc('live_status').update({
                    channels: updatedStatus,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Als er nog geen live_status is, maak hem aan met de nieuwe config
                const initialStatus = newConfig.map(hw => ({
                    mic_id: hw.mic_id,
                    iem_pack: hw.iem_pack,
                    frequency: hw.frequency,
                    name: 'Unassigned / Standby',
                    avatar_url: null,
                    active: false
                }));
                await firestore.collection('mic_monitor').doc('live_status').set({
                    channels: initialStatus,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        console.log('  [CONFIG] Hardware configuratie opgeslagen:', newConfig.map(c => `Mic ${c.mic_id}: ${c.iem_pack} @ ${c.frequency}`).join(', '));
        res.json({ success: true });

    } catch (error) {
        console.error('  [CONFIG] Fout:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/health
 * Simpele health check
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        firebase: firestore !== null,
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/x32-library
 *
 * Returns the operator's X32 channel-library map from Firestore so the
 * SPA Settings view can render the saved names and their integer
 * library-slot IDs. Source of truth is the document at
 * `mic_monitor/x32_library`; falls back to the in-memory default
 * (empty object) when the doc is missing (first install), the bridge
 * has no service account, or the bridge is offline.
 *
 * Response shape: `{ map: { 'WL Mic': 12, 'WL Keys': 8, ... }, lastUpdated: ISO | null }`
 */
app.get('/api/x32-library', async (req, res) => {
    const fromFs = await loadX32LibraryFromFirestore();
    if (fromFs) {
        return res.json(fromFs);
    }
    res.json({ map: { ...DEFAULT_X32_LIBRARY }, lastUpdated: null });
});

/**
 * POST /api/x32-library
 *
 * Operator save from the Settings UI (the Save to Firebase button).
 * Body: `{ map: { 'WL Mic': 12, 'Vox 2 (Sara)': 12, ... } }`.
 * Each key must be a non-empty string ≤ 64 chars; each value must be
 * an integer 0..99; the cleaned map is written to Firestore at
 * `mic_monitor/x32_library` so any operator who clicks Load from
 * Firebase next sees the change. Last-writer-wins (full doc
 * replace) — operators who want to share values overwrite the whole
 * map; partial merge is not provided to keep the mental model simple.
 */
app.post('/api/x32-library', async (req, res) => {
    const validation = validateX32LibraryMap(req.body?.map);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.reason });
    }
    const payload = {
        map: validation.map,
        lastUpdated: new Date().toISOString()
    };
    try {
        await saveX32LibraryToFirestore(payload.map, payload.lastUpdated);
    } catch (err) {
        console.error('  [X32_LIB] Firestore write failed:', err.message);
        return res.status(500).json({ error: err.message });
    }
    console.log('  [X32_LIB] Map saved to Firestore mic_monitor/x32_library:', Object.entries(validation.map).map(([k, v]) => `${k}=\u2192lib ${v}`).join(', '));
    res.json({ ok: true, ...payload });
});

// ── Server Start ──────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

async function startServer() {
    const firebaseOk = initFirebaseAdmin();
    if (firebaseOk) {
        await seedInitialConfig();
    }

    app.listen(PORT, HOST, () => {
        console.log(`
  ╔══════════════════════════════════════════════╗
  ║   ICHTUS MIC & IEM MONITOR SERVER           ║
  ╠══════════════════════════════════════════════╣
  ║  API:    http://${HOST}:${PORT}/api          ║
  ║  Routes:                                     ║
  ║    POST /api/update-roster    (roster sync)  ║
  ║    POST /api/save-hardware-config (edit)     ║
  ║    GET  /api/health           (status)       ║
  ║    GET  /api/x32-library      (preset map)   ║
  ║    POST /api/x32-library      (preset map)   ║
  ╠══════════════════════════════════════════════╣
  ║  Firebase: ${firebaseOk ? 'Verbonden ✓' : 'NIET VERBONDEN ✗'}           ║
  ╚══════════════════════════════════════════════╝
        `);
    });
}

startServer().catch(err => {
    console.error('  [SERVER] Fatal error:', err);
    process.exit(1);
});
