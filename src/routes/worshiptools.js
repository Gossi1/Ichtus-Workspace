/**
 * WorshipTools Data Routes
 *
 * Ontvangt data van de Chrome extension (setlist, roster, library)
 * en served het via REST API aan de SPA en andere clients.
 *
 * Flow: Extension → POST /api/worshiptools/* → Server cache → GET → SPA
 */

import { Router } from 'express';
import { getFirestore, admin } from '../lib/firebase.js';

const router = Router();

// ── In-memory cache (snel pad) ────────────────────────────────────────
// Overleeft server restarts niet, maar is instant beschikbaar.
// Firestore is de persistent backup.
let cachedSetlist = null;
let cachedRoster = null;
let cachedLibrary = null;
let lastSetlistUpdate = null;
let lastRosterUpdate = null;
let lastLibraryUpdate = null;

// ── Firestore helpers ─────────────────────────────────────────────────
const COLLECTION = 'worshiptools_sync';
const DOC_SETLIST = 'latest_setlist';
const DOC_ROSTER = 'latest_roster';
const DOC_LIBRARY = 'latest_library';

async function saveToFirestore(docId, data) {
    const firestore = getFirestore();
    if (!firestore) return false;
    try {
        await firestore.collection(COLLECTION).doc(docId).set({
            ...data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
    } catch (err) {
        console.warn('  [WT] Firestore write mislukt:', err.message);
        return false;
    }
}

async function loadFromFirestore(docId) {
    const firestore = getFirestore();
    if (!firestore) return null;
    try {
        const doc = await firestore.collection(COLLECTION).doc(docId).get();
        if (doc.exists) {
            const data = doc.data();
            // Converteer Firestore timestamp naar ISO string
            if (data.updatedAt && data.updatedAt.toDate) {
                data.updatedAt = data.updatedAt.toDate().toISOString();
            }
            return data;
        }
    } catch (err) {
        console.warn('  [WT] Firestore read mislukt:', err.message);
    }
    return null;
}

// ── WebSocket broadcast ───────────────────────────────────────────────
let _broadcast = null;
function bcast(event, data) {
    if (!_broadcast) {
        try {
            import('../ws.js').then((ws) => {
                _broadcast = ws.broadcast;
                _broadcast(event, data);
            }).catch(() => {});
        } catch (_) {}
    } else {
        _broadcast(event, data);
    }
}

// ── POST /api/worshiptools/setlist ────────────────────────────────────
// Ontvangt setlist data van de Chrome extension
router.post('/setlist', async (req, res) => {
    const { items, structured, date, songCount } = req.body;

    if (!items && !structured) {
        return res.status(400).json({ error: 'Ongeldig payload. Verwacht items of structured.' });
    }

    const payload = {
        items: items || [],
        structured: structured || [],
        date: date || null,
        songCount: songCount || 0,
        source: 'chrome-extension',
    };

    // Update cache
    cachedSetlist = payload;
    lastSetlistUpdate = new Date().toISOString();

    // Persist to Firestore
    await saveToFirestore(DOC_SETLIST, payload);

    // Broadcast via WebSocket
    bcast('wt:setlist', payload);

    console.log(`  [WT] Setlist ontvangen: ${payload.structured.length} items, datum: ${payload.date}`);
    res.json({ success: true, received: payload.structured.length });
});

// ── GET /api/worshiptools/setlist ─────────────────────────────────────
// Haal de laatste setlist op (uit cache of Firestore)
router.get('/setlist', async (req, res) => {
    // Eerst uit cache
    if (cachedSetlist) {
        return res.json({
            success: true,
            data: cachedSetlist,
            updatedAt: lastSetlistUpdate,
            source: 'cache',
        });
    }

    // Dan uit Firestore
    const fromFs = await loadFromFirestore(DOC_SETLIST);
    if (fromFs) {
        cachedSetlist = fromFs;
        lastSetlistUpdate = fromFs.updatedAt;
        return res.json({
            success: true,
            data: fromFs,
            updatedAt: fromFs.updatedAt,
            source: 'firestore',
        });
    }

    // Niets beschikbaar
    res.json({
        success: false,
        data: null,
        message: 'Geen setlist data beschikbaar. Open WorshipTools en sync via de extension.',
    });
});

// ── POST /api/worshiptools/roster ─────────────────────────────────────
// Ontvangt roster data van de Chrome extension
router.post('/roster', async (req, res) => {
    const { roster, teams_scanned } = req.body;

    if (!roster || !Array.isArray(roster)) {
        return res.status(400).json({ error: 'Ongeldig payload. Verwacht roster array.' });
    }

    const payload = {
        roster,
        teams_scanned: teams_scanned || 0,
        source: 'chrome-extension',
    };

    // Update cache
    cachedRoster = payload;
    lastRosterUpdate = new Date().toISOString();

    // Persist to Firestore
    await saveToFirestore(DOC_ROSTER, payload);

    // Broadcast via WebSocket
    bcast('wt:roster', payload);

    console.log(`  [WT] Roster ontvangen: ${roster.length} assignments, ${teams_scanned} teams`);
    res.json({ success: true, received: roster.length });
});

// ── GET /api/worshiptools/roster ──────────────────────────────────────
// Haal het laatste roster op
router.get('/roster', async (req, res) => {
    if (cachedRoster) {
        return res.json({
            success: true,
            data: cachedRoster,
            updatedAt: lastRosterUpdate,
            source: 'cache',
        });
    }

    const fromFs = await loadFromFirestore(DOC_ROSTER);
    if (fromFs) {
        cachedRoster = fromFs;
        lastRosterUpdate = fromFs.updatedAt;
        return res.json({
            success: true,
            data: fromFs,
            updatedAt: fromFs.updatedAt,
            source: 'firestore',
        });
    }

    res.json({
        success: false,
        data: null,
        message: 'Geen roster data beschikbaar.',
    });
});

// ── POST /api/worshiptools/library ────────────────────────────────────
// Ontvangt song library data van de Chrome extension
router.post('/library', async (req, res) => {
    const { songs, count } = req.body;

    if (!songs || !Array.isArray(songs)) {
        return res.status(400).json({ error: 'Ongeldig payload. Verwacht songs array.' });
    }

    const payload = {
        songs,
        count: count || songs.length,
        source: 'chrome-extension',
    };

    // Update cache
    cachedLibrary = payload;
    lastLibraryUpdate = new Date().toISOString();

    // Persist to Firestore
    await saveToFirestore(DOC_LIBRARY, payload);

    // Broadcast via WebSocket
    bcast('wt:library', payload);

    console.log(`  [WT] Library ontvangen: ${songs.length} songs`);
    res.json({ success: true, received: songs.length });
});

// ── GET /api/worshiptools/library ─────────────────────────────────────
// Haal de laatste song library op
router.get('/library', async (req, res) => {
    if (cachedLibrary) {
        return res.json({
            success: true,
            data: cachedLibrary,
            updatedAt: lastLibraryUpdate,
            source: 'cache',
        });
    }

    const fromFs = await loadFromFirestore(DOC_LIBRARY);
    if (fromFs) {
        cachedLibrary = fromFs;
        lastLibraryUpdate = fromFs.updatedAt;
        return res.json({
            success: true,
            data: fromFs,
            updatedAt: fromFs.updatedAt,
            source: 'firestore',
        });
    }

    res.json({
        success: false,
        data: null,
        message: 'Geen library data beschikbaar.',
    });
});

// ── GET /api/worshiptools/status ──────────────────────────────────────
// Status van alle WorshipTools data
router.get('/status', async (req, res) => {
    res.json({
        setlist: {
            available: !!cachedSetlist,
            itemCount: cachedSetlist?.structured?.length || 0,
            date: cachedSetlist?.date || null,
            updatedAt: lastSetlistUpdate,
        },
        roster: {
            available: !!cachedRoster,
            assignmentCount: cachedRoster?.roster?.length || 0,
            teamsScanned: cachedRoster?.teams_scanned || 0,
            updatedAt: lastRosterUpdate,
        },
        library: {
            available: !!cachedLibrary,
            songCount: cachedLibrary?.songs?.length || 0,
            updatedAt: lastLibraryUpdate,
        },
    });
});

export default router;
