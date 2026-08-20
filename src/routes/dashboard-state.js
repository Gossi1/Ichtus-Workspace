/**
 * Dashboard Cloud Sync — Local-First + Cloud-Backup
 *
 * De "☁️ Dashboard opgeslagen in Cloud" knop slaat niet meer direct naar
 * Firestore, maar naar de server (`POST /api/dashboard/state`). De server
 * houdt de state in het geheugen en schrijft gedebounced weg naar Firestore.
 */

import { Router } from 'express';
import { getFirestore } from '../lib/firebase.js';
import {
    createTopic, initTopic, getTopicState, setTopicState,
} from '../lib/topic-store.js';

const COLLECTION = 'dashboard';
const DOC = 'state';

createTopic('dashboard', {
    debounceMs: 3000,
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
        console.log('  [DB] Dashboard gebackupt naar Firestore (dashboard/state)');
    },
});

export async function initDashboardTopic() {
    await initTopic('dashboard');
}

const router = Router();

// Huidige cloud state (layouts, activeLayout, …)
router.get('/state', (req, res) => {
    res.json(getTopicState('dashboard') || {});
});

// Volledige cloud save — vervangt de topic-state in het geheugen
router.post('/state', (req, res) => {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Ongeldig payload. Verwacht object.' });
    }
    const state = setTopicState('dashboard', payload);
    res.json({ success: true, state });
});

export default router;
