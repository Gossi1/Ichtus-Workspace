/**
 * Patchbay Cloud Sync — Local-First + Cloud-Backup
 *
 * De "☁️ Save to Cloud" knop slaat niet meer direct naar Firestore, maar
 * naar de server (`POST /api/patchbay/state`). De server houdt de state
 * in het geheugen en schrijft gedebounced weg naar Firestore.
 */

import { Router } from 'express';
import { getFirestore } from '../lib/firebase.js';
import {
    createTopic, initTopic, getTopicState, setTopicState,
} from '../lib/topic-store.js';

const COLLECTION = 'patchbay';
const DOC = 'projects';

createTopic('patchbay', {
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
        console.log('  [PB] Patchbay gebackupt naar Firestore (patchbay/projects)');
    },
});

export async function initPatchbayTopic() {
    await initTopic('patchbay');
}

const router = Router();

// Huidige cloud state (projects + currentProjectId)
router.get('/state', (req, res) => {
    res.json(getTopicState('patchbay') || {});
});

// Volledige cloud save — vervangt de topic-state in het geheugen
router.post('/state', (req, res) => {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || !payload.projects) {
        return res.status(400).json({ error: 'Ongeldig payload. Verwacht { projects, currentProjectId }.' });
    }
    const state = setTopicState('patchbay', {
        projects: payload.projects,
        currentProjectId: payload.currentProjectId || Object.keys(payload.projects)[0] || 'default',
    });
    res.json({ success: true, state });
});

export default router;
