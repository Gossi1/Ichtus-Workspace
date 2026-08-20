/**
 * Command Center Routes — Local-First + Cloud-Backup
 *
 * De checklist/command-center state (activeState) leeft op de server in
 * het geheugen. Browsers lezen/schrijven niet meer direct Firestore:
 *   - Live sync: WebSocket `commandCenter:state` (snapshot bij connect +
 *     broadcast bij elke wijziging).
 *   - Wijzigingen: `POST /api/commandcenter/state` (merge in geheugen).
 *   - Backup: gedebounced (3s) write naar Firestore via de Admin SDK.
 *   - Archief: `POST /api/commandcenter/archive` (directe Firestore add).
 */

import { Router } from 'express';
import { getFirestore } from '../lib/firebase.js';
import {
    createTopic, initTopic, getTopic, getTopicState,
    updateTopicState, broadcastTopic,
} from '../lib/topic-store.js';

const COLLECTION = 'commandCenter';
const DOC = 'activeState';

const topic = createTopic('commandCenter', {
    event: 'commandCenter:state',
    debounceMs: 3000,
    pushOnConnect: true, // nieuwe client krijgt direct de huidige stand
    load: async () => {
        const firestore = getFirestore();
        if (!firestore) return null;
        const doc = await firestore.collection(COLLECTION).doc(DOC).get();
        if (doc.exists) return doc.data();
        return null;
    },
    persist: async (state) => {
        const firestore = getFirestore();
        if (!firestore) return;
        await firestore.collection(COLLECTION).doc(DOC).set(state, { merge: true });
        console.log('  [CC] State gebackupt naar Firestore (commandCenter/activeState)');
    },
});

export async function initCommandCenterTopic() {
    await initTopic('commandCenter');
    if (!getTopicState('commandCenter')) {
        setInitialState({});
    }
}

function setInitialState(value) {
    const topic = getTopic('commandCenter');
    topic.state = value;
}

const router = Router();

// Huidige state (hydratatie + REST fallback voor de browser)
router.get('/state', (req, res) => {
    res.json(getTopicState('commandCenter') || {});
});

// Patch van een browser → merge in geheugen → broadcast → debounced backup
router.post('/state', (req, res) => {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return res.status(400).json({ error: 'Ongeldig payload. Verwacht object met velden.' });
    }
    const state = updateTopicState('commandCenter', patch);
    broadcastTopic('commandCenter');
    res.json({ success: true, state });
});

// Reset & Archiveer — zeldzame actie, direct naar Firestore (geen debounce)
router.post('/archive', async (req, res) => {
    const { preset, completed, total } = req.body || {};
    try {
        const firestore = getFirestore();
        if (firestore) {
            await firestore.collection('commandCenterHistory').add({
                date: new Date().toISOString(),
                preset: typeof preset === 'string' ? preset : null,
                completed: typeof completed === 'number' ? completed : 0,
                total: typeof total === 'number' ? total : 0,
            });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('  [CC] Archive mislukt:', error.message);
        res.status(500).json({ error: error.message });
    }
});

export default router;
