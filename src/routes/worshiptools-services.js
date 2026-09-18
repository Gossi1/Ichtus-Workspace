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
 *   GET /api/worshiptools-services/services/:id/roster  → roster van één dienst
 *
 * Credentials: env (WT_API_KEY / WT_ACCOUNT_ID / WT_REFRESH_TOKEN /
 * WT_API_TOKEN) → server-config.json ("worshiptools" sectie) → defaults
 * hieronder (gelijk aan test_api.py / show_roster.py).
 */

import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');
const PEOPLE_CACHE_FILE = resolve(ROOT_DIR, 'people_cache.json');

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
    // API-token van api.worship.tools (alleen nodig voor de people-sync,
    // niet voor Firestore). Zie show_roster.py — WT_TOKEN.
    apiToken: '',
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
        apiToken: process.env.WT_API_TOKEN || fromFile.apiToken || fromFile.wtToken || DEFAULT_CONFIG.apiToken,
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

// ── Constants (gelijk aan test_api.py / show_roster.py) ───────────────
const EXCLUDED_TYPE_IDS = new Set([
    'f30f3f88-1e83-4e1a-bc60-ef3974a071fb', // Ichtus Kids Blauw
]);

// Team- en rol-mapping (gelijk aan show_roster.py). Vertaalt een
// Firestore role-ID naar { role, team, teamOrder, roleOrder } zodat het
// roster per team gegroepeerd én gesorteerd kan worden.
const TEAMS_DATA = [
    { name: 'Tech Team', order: 1, roles: [
        { id: 'cbb79b68-2e6f-46e4-9d32-917a71d8236e', name: 'Tech Director', order: 1 },
        { id: 'bfd25f3f-ef53-4a7b-813a-fdede2b1f0b8', name: 'Audio', order: 2 },
        { id: '63354086-2a9d-451f-ab86-75d0f67f68ae', name: 'Beamer', order: 3 },
        { id: '412d2989-bd3a-4988-8d09-3f7fd4367843', name: 'Stream', order: 4 },
        { id: '7c7461bd-bfd0-4215-a180-e376ffb8d1b0', name: 'Lighting', order: 5 },
        { id: 'd7b38845-2e13-4a56-86e6-69c49ff4c6f3', name: 'In-Ear Mixer', order: 6 },
        { id: '84a10f22-52ef-43cc-9025-f3a3ccc2ac85', name: 'Backstage Assistant', order: 7 },
    ] },
    { name: 'Worship Team', order: 2, roles: [
        { id: 'da8c7f47-c974-41ee-ab2a-3809f8f5d26e', name: 'Worship Leader', order: 1 },
        { id: '9ccf7768-505d-4612-b058-0c6b5a773b4e', name: 'Vocalist', order: 2 },
        { id: '18645fa3-d48a-4c48-b51a-afd3652f3927', name: 'Piano', order: 3 },
        { id: 'dd360357-71f6-4892-8405-5d748080c6fd', name: 'Keys', order: 4 },
        { id: '5799674f-da38-4b6a-9825-32e41d2c8755', name: 'Guitar', order: 5 },
        { id: 'ab4bc739-d984-45af-929a-53a2673876a7', name: 'Electric Guitar', order: 6 },
        { id: 'ecf3052e-115b-40e0-a247-6b9772722296', name: 'Bass Guitar', order: 7 },
        { id: '5530795a-bd30-454e-99fe-a5073c93b620', name: 'Drums', order: 8 },
        { id: '36b4098b-096e-4e94-ad3e-f51b35a8e670', name: 'Saxophone', order: 9 },
    ] },
];

const ROLE_MAP = new Map();
for (const t of TEAMS_DATA) {
    for (const r of t.roles) {
        ROLE_MAP.set(r.id, {
            role: r.name,
            team: t.name,
            teamOrder: t.order,
            roleOrder: r.order || 99,
        });
    }
}

// ── People cache (user-ID → volledige naam) ───────────────────────────
// Wordt gevuld uit api.worship.tools (als WT_API_TOKEN aanwezig is) en
// bewaard in people_cache.json — zelfde bestand als show_roster.py.
const PEOPLE_SYNC_TTL_MS = 30 * 60 * 1000; // 30 min tussen API-syncs
let peopleCache = new Map();
let peopleCacheLoaded = false;
let lastPeopleSync = 0;

function loadPeopleCache(force = false) {
    if (!force && peopleCacheLoaded && peopleCache.size > 0) return;
    try {
        if (existsSync(PEOPLE_CACHE_FILE)) {
            const raw = JSON.parse(readFileSync(PEOPLE_CACHE_FILE, 'utf-8'));
            peopleCache = new Map(Object.entries(raw || {}));
            peopleCacheLoaded = true;
            console.log(`  [WT-SVC] people_cache.json geladen: ${peopleCache.size} personen`);
        }
    } catch (err) {
        console.warn('  [WT-SVC] people_cache.json onleesbaar:', err.message);
        peopleCache = new Map();
    }
}

async function syncPeopleCache(force = false) {
    loadPeopleCache(force);
    const cfg = getConfig();
    if (!cfg.apiToken) {
        // Zonder API-token alleen de lokale cache gebruiken (kan stale zijn).
        if (!peopleCache.size) {
            console.warn('  [WT-SVC] Geen WT_API_TOKEN — people-sync overgeslagen, namen vallen terug op user-ID.');
        }
        return peopleCache;
    }
    if (!force && peopleCache.size > 0 && Date.now() - lastPeopleSync < PEOPLE_SYNC_TTL_MS) {
        return peopleCache;
    }

    try {
        const res = await fetch(`https://api.worship.tools/v1/account/${cfg.accountId}/people`, {
            headers: { Authorization: `Bearer ${cfg.apiToken}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
            console.warn(`  [WT-SVC] People API HTTP ${res.status} — cache behouden`);
            return peopleCache;
        }
        const newPeople = await res.json();
        let updated = 0;
        for (const p of newPeople) {
            const pid = p && p.id;
            const fullName = `${(p.firstName || '').trim()} ${(p.lastName || '').trim()}`.trim();
            if (pid && fullName && peopleCache.get(pid) !== fullName) {
                peopleCache.set(pid, fullName);
                updated++;
            }
        }
        lastPeopleSync = Date.now();
        try {
            writeFileSync(PEOPLE_CACHE_FILE, JSON.stringify(Object.fromEntries(peopleCache), null, 2), 'utf-8');
        } catch (err) {
            console.warn('  [WT-SVC] people_cache.json schrijven mislukt:', err.message);
        }
        console.log(`  [WT-SVC] People gesynchroniseerd: ${peopleCache.size} personen (${updated} nieuw/bijgewerkt)`);
    } catch (err) {
        console.warn('  [WT-SVC] People-sync mislukt (cache behouden):', err.message);
    }
    return peopleCache;
}

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

    // Retry (max 2 pogingen) — Firebase kan transient 400/503 geven
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            console.log(`  [WT-SVC] Auth retry (${attempt + 1}/2)…`);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
        try {
            const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }).toString(),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                lastErr = new Error(`Authenticatie mislukt (HTTP ${res.status}). Refresh token verlopen? ${text.slice(0, 160)}`);
                continue; // retry
            }
            const data = await res.json();
            if (!data.id_token) {
                lastErr = new Error('Auth-response zonder id_token');
                continue;
            }
            const expiresIn = parseInt(data.expires_in, 10) || 3600;
            tokenCache = { token: data.id_token, expiresAt: Date.now() + expiresIn * 1000 };

            // Firebase rotate-refresh-token: als een nieuw refresh_token wordt meegegeven,
            // bewaar het zodat de volgende refresh niet faalt.
            if (data.refresh_token && data.refresh_token !== cfg.refreshToken) {
                try {
                    const configPath = resolve(ROOT_DIR, 'server-config.json');
                    if (existsSync(configPath)) {
                        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
                        if (raw.worshiptools) {
                            raw.worshiptools.refreshToken = data.refresh_token;
                            writeFileSync(configPath, JSON.stringify(raw, null, 4), 'utf-8');
                            // In-memory cache bijwerken zodat huidige process ook het nieuwe token gebruikt
                            cachedConfig.refreshToken = data.refresh_token;
                            console.log('  [WT-SVC] Refresh token geroteerd — bijgewerkt in server-config.json');
                        }
                    }
                } catch (err) {
                    console.warn('  [WT-SVC] Kon refresh token niet opslaan:', err.message);
                }
            }
            return tokenCache.token;
        } catch (err) {
            lastErr = err;
            continue; // retry op network errors
        }
    }
    throw lastErr;
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

// ── Roster extractie (port van show_roster.py) ───────────────────────
function normalizeStatus(raw) {
    const s = String(raw || 'pending').toLowerCase();
    if (s === 'accepted') return 'accepted';
    if (s === 'declined') return 'declined';
    return 'pending';
}

async function fetchRosterPeople(accessToken, cuelistId) {
    const url = `${cuelistsBaseUrl()}/${encodeURIComponent(cuelistId)}/people?pageSize=300`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401 || res.status === 403) throw new AuthError(`Firestore geweigerd (HTTP ${res.status})`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Firestore HTTP ${res.status}`);
    const data = await res.json();
    return data.documents || [];
}

function buildRoster(peopleDocs, people) {
    // people: Map(userId → naam). Elke toewijzing wordt een entry die de
    // Stage Builder direct kan renderen: { name, role, status, team }.
    const teams = new Map(); // teamName → { order, accepted, declined, pending, members[] }

    for (const doc of peopleDocs) {
        const f = doc.fields || {};
        const userId = vStr(f, 'user');
        const roleId = vStr(f, 'role');
        const status = normalizeStatus(vStr(f, 'status'));

        const rInfo = ROLE_MAP.get(roleId);
        if (!rInfo) continue;

        const name = people.get(userId) || `Onbekend (${userId.slice(0, 8)}...)`;

        let team = teams.get(rInfo.team);
        if (!team) {
            team = { order: rInfo.teamOrder, accepted: 0, declined: 0, pending: 0, members: [] };
            teams.set(rInfo.team, team);
        }
        team[status]++;
        team.members.push({
            role: rInfo.role,
            roleOrder: rInfo.roleOrder,
            name,
            status,
            userId,
        });
    }

    const teamList = [...teams.entries()]
        .sort((a, b) => a[1].order - b[1].order)
        .map(([name, t]) => ({
            name,
            ...t,
            members: t.members.sort((a, b) => (a.roleOrder - b.roleOrder) || a.name.localeCompare(b.name, 'nl')),
        }));

    return teamList;
}

// ── Routes ────────────────────────────────────────────────────────────
const router = Router();

// Cache expliciet herladen van schijf (people_cache.json)
router.all('/people/reload', (req, res) => {
    loadPeopleCache(true);
    res.json({
        success: true,
        count: peopleCache.size,
        message: `People cache herladen (${peopleCache.size} personen ingeladen)`,
    });
});

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

// Roster (people) van één dienst — port van show_roster.py
router.get('/services/:id/roster', async (req, res) => {
    try {
        const id = req.params.id;
        const forcePeople = req.query.sync === '1' || req.query.sync === 'true';

        // 1. People-namen ophalen/synchroniseren (best-effort)
        const people = await syncPeopleCache(forcePeople);

        // 2. Dienst-document voor de naam/datum (uit cache of live)
        let doc = fullDocCache.get(id);
        if (!doc) {
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
            fullDocCache.set(id, doc);
        }
        const parsed = parseEvent(doc);

        // 3. People-subcollection ophalen
        let token = await getAccessToken();
        let peopleDocs;
        try {
            peopleDocs = await fetchRosterPeople(token, id);
        } catch (err) {
            if (err instanceof AuthError) {
                token = await getAccessToken(true);
                peopleDocs = await fetchRosterPeople(token, id);
            } else {
                throw err;
            }
        }

        // 4. Groeperen per team + platte lijst voor de Stage Builder
        const teams = buildRoster(peopleDocs, people);
        const roster = [];
        let declinedCount = 0;
        for (const team of teams) {
            for (const m of team.members) {
                if (m.status === 'declined') {
                    declinedCount++;
                    continue; // declined nooit meenemen naar de Stage Builder
                }
                roster.push({
                    name: m.name,
                    role: m.role,
                    status: m.status,
                    team: team.name,
                    userId: m.userId,
                });
            }
        }

        res.json({
            success: true,
            service: parsed
                ? toClientService(parsed, new Date())
                : { id, name: 'Onbekende dienst', displayDate: 'Geen datum' },
            teams,
            roster,
            counts: {
                total: roster.length,
                accepted: roster.filter((r) => r.status === 'accepted').length,
                pending: roster.filter((r) => r.status === 'pending').length,
                declined: declinedCount,
            },
        });
    } catch (err) {
        console.error('  [WT-SVC] Fout bij ophalen roster:', err.message);
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
