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
