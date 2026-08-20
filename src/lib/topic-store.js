/**
 * Topic State Store — Local-First + Cloud-Backup
 *
 * Per "topic" (commandCenter, patchbay, dashboard) houdt de server de
 * actuele state in het geheugen. Browsers communiceren uitsluitend via
 * REST (opt-in save/load) en de WebSocket hub (live sync). Firestore is
 * een asynchrone, gedebounced backup die via de Admin SDK wordt geschreven.
 *
 * - `createTopic()` registreert een topic met load/persist-callbacks.
 * - `initTopic()` haalt bij opstarten eenmalig de initiële state op
 *   (bijv. uit Firestore). Zonder Firestore blijft de state gewoon leeg
 *   en draait alles lokaal verder.
 * - Updates worden gemerged in het geheugen, direct gebroadcast naar alle
 *   clients en pas na een rustpauze (debounce) naar Firestore geschreven.
 */

import { broadcast, onClientConnect } from '../ws.js';

const topics = new Map();

export function createTopic(name, opts = {}) {
    const topic = {
        name,
        state: null,
        event: opts.event || `${name}:state`,
        debounceMs: opts.debounceMs ?? 3000,
        load: opts.load || null,        // async () => state  (initiële state uit backup)
        persist: opts.persist || null,  // async (state) => void (Firestore backup)
        pushOnConnect: opts.pushOnConnect || false,
        timer: null,
    };
    topics.set(name, topic);
    return topic;
}

export function getTopic(name) {
    return topics.get(name) || null;
}

export function getTopicState(name) {
    return topics.get(name)?.state ?? null;
}

/** Vervang de hele topic-state (bv. patchbay/dashboard cloud save). */
export function setTopicState(name, value) {
    const topic = topics.get(name);
    if (!topic) return null;
    topic.state = value;
    schedulePersist(topic);
    return topic.state;
}

/** Merge een patch in de topic-state (bv. checklist activeState). */
export function updateTopicState(name, patch) {
    const topic = topics.get(name);
    if (!topic) return null;
    topic.state = { ...(topic.state || {}), ...patch };
    schedulePersist(topic);
    return topic.state;
}

/** Broadcast de huidige topic-state naar alle verbonden clients. */
export function broadcastTopic(name) {
    const topic = topics.get(name);
    if (!topic) return;
    broadcast(topic.event, topic.state);
}

/** Laad de initiële state (uit Firestore) bij het opstarten. */
export async function initTopic(name) {
    const topic = topics.get(name);
    if (!topic) return;
    if (!topic.load) return;
    try {
        const loaded = await topic.load();
        if (loaded && typeof loaded === 'object') {
            topic.state = loaded;
            console.log(`  [TOPIC:${name}] initiële state geladen (backup)`);
        }
    } catch (err) {
        console.warn(`  [TOPIC:${name}] init load mislukt, lokale state blijft:`, err.message);
    }
}

function schedulePersist(topic) {
    if (!topic.persist) return;
    if (topic.timer) clearTimeout(topic.timer);
    topic.timer = setTimeout(() => {
        topic.timer = null;
        const state = topic.state;
        if (!state || (typeof state === 'object' && Object.keys(state).length === 0)) return;
        topic.persist(state).catch((err) => {
            console.warn(`  [TOPIC:${topic.name}] backup mislukt (lokaal draait door):`, err.message);
        });
    }, topic.debounceMs);
}

// Push de snapshot van pushOnConnect-topics naar elke nieuw verbonden client
onClientConnect(({ send }) => {
    topics.forEach((topic) => {
        if (!topic.pushOnConnect || !topic.state) return;
        try {
            send(topic.event, topic.state);
        } catch (_) {}
    });
});
