/**
 * Mic & IEM Monitor Routes
 *
 * Verplaatst uit mic-iem-server/server.js.
 * Firestore-backed real-time mic/IEM toewijzing en X32 library map.
 *
 * Nieuw: WebSocket broadcast voor realtime roster updates.
 */

import { Router } from 'express';
import { getFirestore, admin } from '../lib/firebase.js';

const router = Router();

// ── Defaults ───────────────────────────────────────────────────────────
const DEFAULT_HARDWARE = [
    { mic_id: 1, iem_pack: 'IEM Pack 1', frequency: '495.200 MHz' },
    { mic_id: 2, iem_pack: 'IEM Pack 2', frequency: '492.700 MHz' },
    { mic_id: 3, iem_pack: 'IEM Pack 3', frequency: '500.000 MHz' },
    { mic_id: 4, iem_pack: 'IEM Pack 4', frequency: '505.100 MHz' },
];

const DEFAULT_X32_LIBRARY = {};
const MAX_X32_NAME_LENGTH = 64;

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

async function getHardwareConfig() {
    const firestore = getFirestore();
    if (!firestore) return DEFAULT_HARDWARE;
    try {
        const doc = await firestore.collection('mic_monitor').doc('config').get();
        if (doc.exists && doc.data().hardware && Array.isArray(doc.data().hardware)) {
            return doc.data().hardware;
        }
    } catch (err) {
        console.warn('  [FIREBASE] Kon config niet ophalen:', err.message);
    }
    return DEFAULT_HARDWARE;
}

async function loadX32LibraryFromFirestore() {
    const firestore = getFirestore();
    if (!firestore) return null;
    try {
        const doc = await firestore.collection('mic_monitor').doc('x32_library').get();
        if (!doc.exists) return null;
        const data = doc.data();
        if (data && data.map && typeof data.map === 'object' && !Array.isArray(data.map) && Object.keys(data.map).length > 0) {
            return { lastUpdated: data.lastUpdated || null, map: data.map };
        }
    } catch (err) {
        console.warn('  [X32_LIB] Firestore read mislukt:', err.message);
    }
    return null;
}

async function saveX32LibraryToFirestore(map, lastUpdated) {
    const firestore = getFirestore();
    if (!firestore) {
        throw new Error('Firestore niet geïnitialiseerd. Voeg serviceAccountKey.json toe en herstart de server.');
    }
    await firestore.collection('mic_monitor').doc('x32_library').set({ map, lastUpdated });
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

export async function seedInitialConfig() {
    const firestore = getFirestore();
    if (!firestore) return;
    try {
        const docRef = firestore.collection('mic_monitor').doc('config');
        const doc = await docRef.get();
        if (!doc.exists) {
            await docRef.set({ hardware: DEFAULT_HARDWARE, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            console.log('  [FIREBASE] Initiële hardware config aangemaakt');
        }
        const statusRef = firestore.collection('mic_monitor').doc('live_status');
        const statusDoc = await statusRef.get();
        if (!statusDoc.exists) {
            const initialState = DEFAULT_HARDWARE.map((hw) => ({
                mic_id: hw.mic_id, iem_pack: hw.iem_pack, frequency: hw.frequency,
                name: 'Unassigned / Standby', avatar_url: null, active: false,
            }));
            await statusRef.set({ channels: initialState, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            console.log('  [FIREBASE] Initiële live_status aangemaakt');
        }
    } catch (err) {
        console.warn('  [FIREBASE] Seed mislukt:', err.message);
    }
}

// ── Routes ─────────────────────────────────────────────────────────────

router.post('/update-roster', async (req, res) => {
    const { roster } = req.body;
    if (!roster || !Array.isArray(roster)) {
        return res.status(400).json({ error: 'Ongeldig roster payload. Verwacht array.' });
    }

    try {
        const hardwareConfig = await getHardwareConfig();
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

        const firestore = getFirestore();
        if (firestore) {
            await firestore.collection('mic_monitor').doc('live_status').set({
                channels: finalState,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        console.log('  [ROSTER] Toewijzing berekend:', finalState.map((c) => `${c.name} (mic ${c.mic_id})`).join(', '));
        bcast('iem:roster', { channels: finalState });
        res.json({ success: true, live_status: finalState });
    } catch (error) {
        console.error('  [ROSTER] Fout:', error.message);
        res.status(500).json({ error: error.message });
    }
});

router.post('/save-hardware-config', async (req, res) => {
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
        const firestore = getFirestore();
        if (firestore) {
            await firestore.collection('mic_monitor').doc('config').set({
                hardware: newConfig,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const statusDoc = await firestore.collection('mic_monitor').doc('live_status').get();
            if (statusDoc.exists) {
                const current = statusDoc.data().channels || [];
                const updated = current.map((ch) => {
                    const hw = newConfig.find((h) => h.mic_id === ch.mic_id);
                    return hw ? { ...ch, iem_pack: hw.iem_pack, frequency: hw.frequency } : ch;
                });
                await firestore.collection('mic_monitor').doc('live_status').update({
                    channels: updated,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                const initial = newConfig.map((hw) => ({
                    mic_id: hw.mic_id, iem_pack: hw.iem_pack, frequency: hw.frequency,
                    name: 'Unassigned / Standby', avatar_url: null, active: false,
                }));
                await firestore.collection('mic_monitor').doc('live_status').set({
                    channels: initial,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
        }

        console.log('  [CONFIG] Hardware opgeslagen:', newConfig.map((c) => `Mic ${c.mic_id}: ${c.iem_pack} @ ${c.frequency}`).join(', '));
        res.json({ success: true });
    } catch (error) {
        console.error('  [CONFIG] Fout:', error.message);
        res.status(500).json({ error: error.message });
    }
});

router.get('/x32-library', async (req, res) => {
    const fromFs = await loadX32LibraryFromFirestore();
    if (fromFs) return res.json(fromFs);
    res.json({ map: { ...DEFAULT_X32_LIBRARY }, lastUpdated: null });
});

router.post('/x32-library', async (req, res) => {
    const validation = validateX32LibraryMap(req.body?.map);
    if (!validation.ok) return res.status(400).json({ error: validation.reason });

    const payload = { map: validation.map, lastUpdated: new Date().toISOString() };
    try {
        await saveX32LibraryToFirestore(payload.map, payload.lastUpdated);
    } catch (err) {
        console.error('  [X32_LIB] Firestore write failed:', err.message);
        return res.status(500).json({ error: err.message });
    }
    console.log('  [X32_LIB] Map saved:', Object.entries(validation.map).map(([k, v]) => `${k}→lib ${v}`).join(', '));
    res.json({ ok: true, ...payload });
});

export default router;
