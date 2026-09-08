/**
 * WorshipTools Services API — Node.js port van test_api.py
 *
 * Haalt de cuelists rechtstreeks op uit de WorshipTools Firestore datastore
 * (zelfde flow als het Python-script):
 *
 *   1. Firebase refresh token → korte-lived access token (securetoken API)
 *   2. Firestore REST: /accounts/{ACCOUNT_ID}/cuelists (gepagineerd)
 *   3. Parsen → 10 komende + 4 afgelopen diensten
 *   4. Per dienst: volledige setlist (nummers + toonsoort) uit de cues
 *
 * Endpoints:
 *   GET /api/worshiptools-services/services            → lijst (5 min cache)
 *   GET /api/worshiptools-services/services?refresh=1  → forceer verversen
 *   GET /api/worshiptools-services/services/:id/setlist → setlist van één dienst
 *
 * Credentials: env (WT_API_KEY / WT_ACCOUNT_ID / WT_REFRESH_TOKEN) →
 * server-config.json ("worshiptools" sectie) → defaults hieronder (gelijk
 * aan test_api.py).
 */

import { Router } from 'express';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');

// ── Config ────────────────────────────────────────────────────────────
// Credentials worden NIET hardcoded. Ze komen uit (in volgorde):
//   1. Omgevingsvariabelen  WT_API_KEY / WT_ACCOUNT_ID / WT_REFRESH_TOKEN
//   2. server-config.json  →  { "worshiptools": { apiKey, accountId, refreshToken } }
//      (server-config.json staat in .gitignore — NOOIT committen)
// Als beide ontbreken, gooit getConfig() een fout zodat credentials nooit
// per ongeluk in de repository terechtkomen.
const DEFAULT_CONFIG = {
    apiKey: '',
    accountId: '',
    refreshToken: '',
};

let cachedConfig = null;

function getConfig() {
    if (cachedConfig) return cachedConfig;
    let fromFile = {};
    try {
        const configPath = resolve(ROOT_DIR, 'server-config.json');
        if (existsSync(configPath)) {
            const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
            if (parsed && typeof parsed.worshiptools === 'object') fromFile = parsed.worshiptools;
        }
    } catch (_) { /* config bestand onleesbaar — defaults gebruiken */ }

    cachedConfig = {
        apiKey: process.env.WT_API_KEY || fromFile.apiKey || DEFAULT_CONFIG.apiKey,
        accountId: process.env.WT_ACCOUNT_ID || fromFile.accountId || DEFAULT_CONFIG.accountId,
        refreshToken: process.env.WT_REFRESH_TOKEN || fromFile.refreshToken || DEFAULT_CONFIG.refreshToken,
    };
    if (!cachedConfig.apiKey || !cachedConfig.accountId || !cachedConfig.refreshToken) {
        throw new Error(
            'WorshipTools credentials ontbreken. Zet ze in server-config.json ' +
            '(sectie "worshiptools") of als env-vars WT_API_KEY/WT_ACCOUNT_ID/WT_REFRESH_TOKEN. ' +
            'Credentials worden nooit hardcoded in de code gezet.'
        );
    }
    return cachedConfig;
}

// ── Constants (gelijk aan test_api.py) ────────────────────────────────
const EXCLUDED_TYPE_IDS = new Set([
    'f30f3f88-1e83-4e1a-bc60-ef3974a071fb', // Ichtus Kids Blauw
]);

const DAGNAMEN = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const MAX_PAGES = 5;          // 5 × 100 documenten, zoals het Python-script
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Datum helpers ─────────────────────────────────────────────────────
// Zelfde semantiek als parse_iso() in Python: lokale tijd, zonder Z/millis.
function parseIso(val) {
    if (!val) return null;
    let clean = String(val).replace('Z', '');
    if (clean.includes('.')) clean = clean.split('.')[0];
    const dt = new Date(clean);
    return isNaN(dt.getTime()) ? null : dt;
}

const pad2 = (n) => String(n).padStart(2, '0');

function formatDutch(dt) {
    if (!dt) return 'Geen datum';
    const dag = DAGNAMEN[dt.getDay() === 0 ? 6 : dt.getDay() - 1];
    const maand = MAANDEN[dt.getMonth()];
    return `${dag} ${pad2(dt.getDate())} ${maand} ${dt.getFullYear()} - ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function formatRehearsal(dt) {
    const dag = DAGNAMEN[dt.getDay() === 0 ? 6 : dt.getDay() - 1];
    return `${dag} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

// ── Firestore Value helpers ───────────────────────────────────────────
const vStr = (obj, key, dflt = '') => (obj && obj[key] && obj[key].stringValue !== undefined) ? obj[key].stringValue : dflt;
const vMapFields = (obj, key) => (obj && obj[key] && obj[key].mapValue && obj[key].mapValue.fields) || {};
const vArrValues = (obj, key) => (obj && obj[key] && obj[key].arrayValue && obj[key].arrayValue.values) || [];

// ── Document parsing (parse_event uit test_api.py) ────────────────────
function parseEvent(doc) {
    const fields = doc.fields || {};
    const docId = (doc.name || '').split('/').pop();

    const serviceObj = vMapFields(fields, 'service');
    const dataObj = vMapFields(fields, 'data');

    // 1. Filter direct op service type ID
    const serviceTypeId = vStr(serviceObj, 'type');
    if (EXCLUDED_TYPE_IDS.has(serviceTypeId)) return null;

    // 2. Naam bepalen
    const eventName = vStr(serviceObj, 'name')
        || vStr(fields, 'name')
        || vStr(dataObj, 'cuelist_title')
        || 'Kerkdienst';

    // 3. Tijden verwerken
    const timesArray = vArrValues(serviceObj, 'times');
    const parsedSlots = [];

    for (const item of timesArray) {
        // Array items in Firestore REST are { mapValue: { fields: {...} } }
        // — one level less than top-level doc fields.
        const f = (item && item.mapValue && item.mapValue.fields) || {};
        const dt = parseIso(vStr(f, 'time'));
        if (dt) {
            const slotType = vStr(f, 'type');
            parsedSlots.push({ dt, isRehearsal: slotType.toLowerCase() === 'rehearsal' });
        }
    }

    let mainDt = null;
    let rehearsals = [];

    if (parsedSlots.length > 0) {
        // Diensten zonder 'rehearsal' markering zijn de hoofdsamenkomst
        const mainEvent = [...parsedSlots].reverse().find((s) => !s.isRehearsal) || parsedSlots[parsedSlots.length - 1];
        mainDt = mainEvent.dt;
        rehearsals = parsedSlots.filter((s) => s !== mainEvent).map((s) => s.dt);
    } else {
        // Fallback voor losse cuelists (zoals jeugd- of speciale diensten)
        const altDateStr = vStr(vMapFields(dataObj, 'cuelist_options'), 'date')
            || vStr(fields, 'post')
            || doc.createTime;
        mainDt = parseIso(altDateStr);
    }

    if (!mainDt) return null;

    const cues = vArrValues(dataObj, 'cues');

    return {
        id: docId,
        name: eventName,
        mainDt,
        rehearsals,
        cuesCount: cues.length,
        doc,
    };
}

// ── Auth (token cache) ────────────────────────────────────────────────
let tokenCache = { token: null, expiresAt: 0 };

class AuthError extends Error {
    constructor(msg) { super(msg); this.name = 'AuthError'; }
}

async function getAccessToken(force = false) {
    if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
        return tokenCache.token;
    }
    const cfg = getConfig();
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }).toString(),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Authenticatie mislukt (HTTP ${res.status}). Refresh token verlopen? ${text.slice(0, 160)}`);
    }
    const data = await res.json();
    if (!data.id_token) throw new Error('Auth-response zonder id_token');
    const expiresIn = parseInt(data.expires_in, 10) || 3600;
    tokenCache = { token: data.id_token, expiresAt: Date.now() + expiresIn * 1000 };
    return tokenCache.token;
}

// ── Firestore ophalen ─────────────────────────────────────────────────
function cuelistsBaseUrl() {
    const cfg = getConfig();
    return `https://firestore.googleapis.com/v1/projects/worship-extreme-datastore/databases/(default)/documents/accounts/${cfg.accountId}/cuelists`;
}

async function fetchCuelistDocuments(accessToken) {
    const docs = [];
    let pageToken = null;

    for (let page = 0; page < MAX_PAGES; page++) {
        let url = cuelistsBaseUrl() + '?pageSize=100';
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 401 || res.status === 403) throw new AuthError(`Firestore geweigerd (HTTP ${res.status})`);
        if (!res.ok) throw new Error(`Firestore HTTP ${res.status}`);
        const data = await res.json();

        docs.push(...(data.documents || []));
        pageToken = data.nextPageToken;
        if (!pageToken) break;
    }
    return docs;
}

async function fetchSingleCuelist(accessToken, id) {
    const url = `${cuelistsBaseUrl()}/${encodeURIComponent(id)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401 || res.status === 403) throw new AuthError(`Firestore geweigerd (HTTP ${res.status})`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore HTTP ${res.status}`);
    return res.json();
}

// ── Cache ─────────────────────────────────────────────────────────────
let servicesCache = null;        // { upcoming, past, fetchedAt }
let servicesFetchPromise = null;
const fullDocCache = new Map();  // id → raw Firestore document (voor setlists)

function toClientService(s, now) {
    return {
        id: s.id,
        name: s.name,
        datetime: s.mainDt.toISOString(),
        displayDate: formatDutch(s.mainDt),
        time: `${pad2(s.mainDt.getHours())}:${pad2(s.mainDt.getMinutes())}`,
        isToday: s.mainDt.toDateString() === now.toDateString(),
        isPast: s.mainDt < now,
        cuesCount: s.cuesCount,
        rehearsals: s.rehearsals.map(formatRehearsal),
    };
}

async function refreshServices(force = false) {
    if (!force && servicesCache && Date.now() - servicesCache.fetchedAt < CACHE_TTL_MS) {
        return servicesCache;
    }
    // Ontdubbelen van gelijktijdige requests
    if (!force && servicesFetchPromise) return servicesFetchPromise;

    servicesFetchPromise = (async () => {
        let token = await getAccessToken();
        let docs;
        try {
            docs = await fetchCuelistDocuments(token);
        } catch (err) {
            if (err instanceof AuthError) {
                token = await getAccessToken(true);
                docs = await fetchCuelistDocuments(token);
            } else {
                throw err;
            }
        }

        const now = new Date();
        const parsed = docs.map(parseEvent).filter(Boolean);

        const upcoming = parsed
            .filter((s) => s.mainDt >= now)
            .sort((a, b) => a.mainDt - b.mainDt)
            .slice(0, 10);
        const past = parsed
            .filter((s) => s.mainDt < now)
            .sort((a, b) => b.mainDt - a.mainDt)
            .slice(0, 4);

        // Volledige documenten cachen voor snelle setlist-opvraag
        fullDocCache.clear();
        for (const s of parsed) fullDocCache.set(s.id, s.doc);

        servicesCache = {
            upcoming: upcoming.map((s) => toClientService(s, now)),
            past: past.map((s) => toClientService(s, now)),
            fetchedAt: Date.now(),
        };

        console.log(`  [WT-SVC] ${docs.length} cuelists opgehaald — ${upcoming.length} komend, ${past.length} afgelopen`);
        return servicesCache;
    })().finally(() => { servicesFetchPromise = null; });

    return servicesFetchPromise;
}

// ── Setlist extractie ─────────────────────────────────────────────────
function extractSongs(doc) {
    const dataObj = vMapFields(doc.fields || {}, 'data');
    const cues = vArrValues(dataObj, 'cues');
    const songMeta = vMapFields(dataObj, 'songMeta');

    return cues.map((cue, i) => {
        // Array items: { mapValue: { fields: {...} } }
        const f = (cue && cue.mapValue && cue.mapValue.fields) || {};
        const cueId = vStr(f, 'cue_id');
        const title = vStr(f, 'displayName') || 'Naamloos';
        // songMeta entries: { cueId: { mapValue: { fields: { key: { stringValue } } } } }
        const meta = (songMeta[cueId] && songMeta[cueId].mapValue && songMeta[cueId].mapValue.fields) || {};
        const key = vStr(meta, 'key', '—');
        return { position: i + 1, cueId, title, key };
    });
}

// ── Routes ────────────────────────────────────────────────────────────
const router = Router();

// Lijst: 10 komende + 4 afgelopen diensten
router.get('/services', async (req, res) => {
    try {
        const force = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await refreshServices(force);
        res.json({
            success: true,
            ...data,
            count: data.upcoming.length + data.past.length,
        });
    } catch (err) {
        console.error('  [WT-SVC] Fout bij ophalen diensten:', err.message);
        res.status(502).json({ success: false, error: err.message });
    }
});

// Volledige setlist van één dienst
router.get('/services/:id/setlist', async (req, res) => {
    try {
        const id = req.params.id;
        const live = req.query.live === '1' || req.query.live === 'true';
        let doc = fullDocCache.get(id);
        let source = 'cache';

        if (live || !doc) {
            // Live: altijd vers ophalen (één Firestore doc — goedkoop).
            // !doc: niet in cache (bijv. na server-restart): los ophalen.
            let token = await getAccessToken();
            try {
                doc = await fetchSingleCuelist(token, id);
            } catch (err) {
                if (err instanceof AuthError) {
                    token = await getAccessToken(true);
                    doc = await fetchSingleCuelist(token, id);
                } else {
                    throw err;
                }
            }
            if (!doc) return res.status(404).json({ success: false, error: 'Dienst niet gevonden' });
            source = 'live';
            // Cache bijwerken zodat niet-live requests ook vers zijn
            fullDocCache.set(id, doc);
        }

        const parsed = parseEvent(doc);
        const songs = extractSongs(doc);
        const now = new Date();

        res.json({
            success: true,
            source,
            service: parsed
                ? toClientService(parsed, now)
                : { id, name: 'Onbekende dienst', displayDate: 'Geen datum' },
            songs,
            count: songs.length,
        });
    } catch (err) {
        console.error('  [WT-SVC] Fout bij ophalen setlist:', err.message);
        res.status(502).json({ success: false, error: err.message });
    }
});

export default router;
