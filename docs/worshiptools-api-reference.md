# WorshipTools API — Recreation Reference

Everything needed to rebuild the WorshipTools (WT) integration from scratch: upstream
endpoints, auth flow, document parsing rules, the local HTTP/WS surface, caching, and
the exact response shapes the frontend depends on.

Source of truth: [`src-tauri/src/server/worshiptools.rs`](../src-tauri/src/server/worshiptools.rs)
(route registration in [`src-tauri/src/server/mod.rs`](../src-tauri/src/server/mod.rs)).
This file is the spec; if code and docs disagree, the code wins and the docs get fixed.

> The older doc [`docs/worshiptools-api.md`](worshiptools-api.md) describes the Chrome
> extension (DOM-scraping) path and still mentions the retired Node route
> `src/routes/worshiptools-services.js` — that route no longer exists; the service is
> native Rust/Axum now. The extension folder (`extensions/worshiptools-sync/`) is also
> not present in this checkout.

---

## 1. Big picture

Two **upstream** surfaces of WorshipTools are used, plus one **browser** path:

| Path | Upstream | Used for |
|------|----------|----------|
| A. Firestore REST (server-side) | `firestore.googleapis.com` (project `worship-extreme-datastore`) | services list, per-service setlist, per-service roster, song library |
| B. Official WT REST API (server-side) | `api.worship.tools` | people names for roster (`id → "First Last"`) |
| C. Chrome extension (browser-side) | DOM scraping of `*.worshiptools.com` | fallback setlist/roster/library push into the local API |

```
                       ┌──────────────────────────────────────────────┐
 Firebase Secure Token │  Tauri / Axum server (native Rust)           │
 securetoken.googleapis │  WorshipToolsManager                        │
   │ id_token (1 h)     │   ├─ GET /api/worshiptools-services/*        │
   ▼                    │   └─ GET|POST /api/worshiptools/* (legacy)   │
 Firestore REST ────────┤                                              │
 accounts/{id}/cuelists │        ▲ fetch          │ WS {event,data}     │
 accounts/{id}/songs    │        │                ▼                     │
                        │   Ichtus SPA         wt:setlist/roster/library│
 api.worship.tools ─────┤   (wt-services.js,                       │
 /v1/account/{id}/people│    stagebuilder.js,  ─────────────────────┘
                        │    songidassigner.js, setlist.js)
 Chrome extension ──────┤   POST /api/worshiptools/{setlist,roster,library}
 (DOM scrape)           └──────────────────────────────────────────────┘
```

---

## 2. Configuration & credentials

Read order per value: **environment variable first, then `server-config.json`**.

| Env var | JSON key (`server-config.json` → `worshiptools`) | Required | Purpose |
|---------|--------------------------------------------------|----------|---------|
| `WT_API_KEY` | `apiKey` | ✅ | Firebase Web API key, used for the token exchange |
| `WT_ACCOUNT_ID` | `accountId` | ✅ | WorshipTools account UUID (path segment in all Firestore URLs) |
| `WT_REFRESH_TOKEN` | `refreshToken` | ✅ | Firebase refresh token |
| `WT_API_TOKEN` | `apiToken` (alias `wtToken`) | ❌ | Bearer for `api.worship.tools` people sync only |

Config file path: `{data_dir}/server-config.json`, where `data_dir` is
`dirs::data_dir()/Ichtus` (e.g. `%APPDATA%\Ichtus` on Windows), falling back to `.` when
no OS data dir is available (in that fallback the `server-config.json` in the repo root is
the one that is read).

⚠️ On a normal desktop install the config is therefore **not** the repo-root
`server-config.json`, even though this checkout ships one (and a repo-root
`people_cache.json`) — those come from the `.` fallback / older versions. When
credentials seemingly "don't take", check `{data_dir}` first.

Missing required values ⇒ error (returned as HTTP 502 with this exact message):

```
WorshipTools credentials ontbreken. Zet ze in server-config.json (sectie "worshiptools")
of als env-vars WT_API_KEY/WT_ACCOUNT_ID/WT_REFRESH_TOKEN. Credentials worden nooit
hardcoded in de code gezet.
```

Rules:

- **Never hardcode credentials.** `server-config.json` is gitignored; commit only
  [`server-config.example.json`](../server-config.example.json).
- **Refresh-token rotation**: the token endpoint may return a new `refresh_token`. If it
  differs from the configured one it is written back into
  `{data_dir}/server-config.json` → `worshiptools.refreshToken` (pretty-printed). The file
  must therefore be read/writable at runtime.
- `apiToken` is optional: without it, roster names fall back to `Onbekend (<first 8 chars of userId>)`.

---

## 3. Upstream auth flow (Firebase Secure Token)

```
POST https://securetoken.googleapis.com/v1/token?key={apiKey}
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={urlencoded refresh token}
```

Response:

```json
{ "id_token": "eyJ...", "refresh_token": "1//...", "expires_in": "3600" }
```

Behaviour to reproduce:

1. Token is cached in memory as `{ token, expires_at: Instant }`.
2. A cached token is reused only while `expires_at > now + 60s` (renew 1 minute early).
   `force = true` bypasses the cache.
3. Up to **2 attempts**, sleeping `1s * attempt` between them; the last error string is
   returned to the caller.
4. `expires_in` may be a string or a number; default `3600`.
5. Every Firestore call that returns **401/403** triggers `get_access_token(force=true)`
   and exactly **one retry** with the fresh token.
6. Failed token responses produce messages like
   `Authenticatie mislukt (HTTP 400). Refresh token verlopen? {first 160 chars}`.

---

## 4. Upstream endpoints (Bearer `id_token`)

Base for documents:

```
https://firestore.googleapis.com/v1/projects/worship-extreme-datastore/databases/(default)/documents/accounts/{accountId}
```

| Purpose | Request | Notes |
|---------|---------|-------|
| Service list | `GET {base}/cuelists?pageSize=100[&pageToken=...]` | paginated, **max 5 pages** (`MAX_PAGES`), follows `nextPageToken` |
| Single service | `GET {base}/cuelists/{cuelistId}` | `404` → treated as "not found" |
| Roster people | `GET {base}/cuelists/{cuelistId}/people?pageSize=300` | `404` → empty list |
| Song library | `GET {base}/songs?pageSize=500[&pageToken=...]` | paginated, **max 20 pages** |
| Single song | `GET {base}/songs/{songId}` | 5 s timeout, 60 s cache, failure ⇒ `None` (song degrades gracefully) |

People names (Bearer `apiToken`, separate official API):

```
GET https://api.worship.tools/v1/account/{accountId}/people
Accept: application/json          (6 s timeout)
```

Response: array of `{ "id", "firstName", "lastName" }` → merged into a
`HashMap<userId, "firstName lastName">`, persisted to `{data_dir}/people_cache.json`
(pretty JSON, flat `{ "uuid": "Name" }` map). Sync is **best effort**: any network/HTTP/parse
failure keeps the existing cache and just logs. TTL 30 min (`PEOPLE_SYNC_TTL`); the
in-memory map is also loaded from disk at startup.

---

## 5. Firestore document shape & parsing rules

Firestore REST nodes are *typed*:

```
fields.<key>.stringValue        → v_str()
fields.<key>.mapValue.fields.*  → v_map_fields()
fields.<key>.arrayValue.values  → v_arr_values()
```

Every parser must use those three helpers; raw `as_str()` on a Firestore value is wrong.

### 5.1 Service (cuelist) document

```
name: accounts/{accountId}/cuelists/{cuelistId}   → id = last path segment
fields
├── service (mapValue)
│   ├── name: "Kerkdienst"
│   ├── type: "<service type uuid>"
│   └── times: array of { time: "2026-09-13T10:00:00", type: "service" | "rehearsal" }
├── data (mapValue)
│   ├── cuelist_title: "Kerkdienst 13-09"
│   ├── cuelist_options: { date: "2026-09-13T10:00:00" }
│   ├── cues: array of cue maps (see 5.3)
│   └── songMeta: { "<cueId>": { key: "G", meter?: "...", tempo?: n } }
├── name: "…" , post: "…"
└── createTime: "2026-09-01T09:12:33.123456Z"
```

**Rules (`parse_event`):**

1. **Excluded type**: if `service.type == "f30f3f88-1e83-4e1a-bc60-ef3974a071fb"`
   (labelled *Ichtus Kids Blauw* in the older docs) the whole document is dropped.
2. **Name chain**: `service.name` → `fields.name` → `data.cuelist_title` → literal `"Kerkdienst"`.
3. **Times**: iterate `service.times[]`; each entry with `type` equal (case-insensitive) to
   `rehearsal` is a rehearsal, the rest are service slots. **Main datetime = the last
   non-rehearsal slot** (fall back to the last slot if all are rehearsals). Every slot
   whose datetime differs from main — i.e. all rehearsal slots *and* any earlier service
   slots — is reported as a rehearsal entry.
4. **Fallback date chain** when `times` is empty: `data.cuelist_options.date` →
   `fields.post` → `doc.createTime`. If nothing parses, the event is dropped.
5. **Datetime parsing** (`parse_iso_local`): strip trailing `Z`, cut at the first `.`,
   then try, in order:
   `%Y-%m-%dT%H:%M:%S`, `%Y-%m-%dT%H:%M`, `%Y-%m-%d %H:%M:%S`, `%Y-%m-%d %H:%M`, `%Y-%m-%d`.
   The naive value is interpreted in the **machine's local timezone** (`.single()`, else
   `.earliest()`).
6. `cuesCount = data.cues.length`.

**Client service object** (what every endpoint returns as `service`):

```json
{
  "id": "uuid",
  "name": "Kerkdienst",
  "datetime": "2026-09-13T10:00:00.000Z",
  "displayDate": "Zo 13 sep 2026 - 10:00",
  "time": "10:00",
  "isToday": false,
  "isPast": false,
  "cuesCount": 15,
  "rehearsals": ["Do 19:30"]
}
```

Dutch formatting constants: weekdays `Ma Di Wo Do Vr Za Zo` (Monday = index 0), months
`jan feb mrt apr mei jun jul aug sep okt nov dec`; `displayDate` pattern
`"{dag} {dd} {maand} {yyyy} - {HH}:{MM}"` (e.g. `Zo 13 sep 2026 - 10:00`), rehearsal
pattern `"{dag} {HH}:{MM}"` (e.g. `Do 19:30`).

Lists: **10 upcoming** (ascending `main_dt >= now`) + **4 past** (descending `main_dt < now`).
Anything else is discarded from the list (but remains in the raw-doc cache).

### 5.2 song library document

`{base}/songs/{songId}` → `LibrarySong`:

| JSON field | Source |
|------------|--------|
| `songId` | last path segment of `doc.name` |
| `title` | `fields.name` |
| `key` | `fields.data.defaultKey`, else `"—"` |
| `bpm` | `fields.data.tempo` else `fields.data.bpm` (`integerValue` or numeric `stringValue`), else `null` |
| `meter` | `fields.data.timeSignature`, else `"4/4"` |

### 5.3 cues → songs (`extract_songs`)

Per cue (array element of `data.cues`):

```
cue.mapValue.fields
├── cue_id: "abc"
├── displayName: "Water"            (default "Naamloos")
└── cue_foreground.mapValue.fields.text.stringValue  → songId (master song doc id)
```

Then, per song:

| JSON field | Rule |
|------------|------|
| `position` | array index + 1 (1-based) |
| `cueId` | `fields.cue_id` |
| `songId` | `cue_foreground.text.stringValue`, omitted entirely when absent (`skip_serializing_if`) |
| `title` | `fields.displayName` (fallback `"Naamloos"`) |
| `key` | `songMeta[cueId].key` if non-empty **and** not `"—"`/`"-"` → else song doc `data.defaultKey` → else `songMeta[cueId].key` → else `"—"` |
| `bpm` | `songMeta[cueId].tempo` → song doc `data.tempo` → `data.bpm` → `null` |
| `meter` | `songMeta[cueId].meter` → song doc `data.timeSignature` → `"4/4"` |

Missing song docs (fetch failure / unknown id) must not fail the request — key/bpm/meter
just fall back to the chain above.

### 5.4 people docs → roster (`build_roster`)

Per people document: `fields.user` (userId), `fields.role` (role uuid), `fields.status`.

- **Status normalisation**: `accepted` / `declined` (case-insensitive) → same; anything
  else → `pending`.
- **Unknown role uuid ⇒ the row is silently skipped** (not rendered at all).
- Name lookup: `people_cache` by userId, else `Onbekend ({first 8 chars of userId})`
  (or `Onbekend ({id})` when shorter than 8).
- Grouped into teams, teams sorted by `teamOrder`, members sorted by `roleOrder` then
  case-insensitive name.

**Role map (hardcoded — these UUIDs are account-specific and MUST be preserved):**

| Role UUID | Role | Team | teamOrder | roleOrder |
|-----------|------|------|-----------|-----------|
| `cbb79b68-2e6f-46e4-9d32-917a71d8236e` | Tech Director | Tech Team | 1 | 1 |
| `bfd25f3f-ef53-4a7b-813a-fdede2b1f0b8` | Audio | Tech Team | 1 | 2 |
| `63354086-2a9d-451f-ab86-75d0f67f68ae` | Beamer | Tech Team | 1 | 3 |
| `412d2989-bd3a-4988-8d09-3f7fd4367843` | Stream | Tech Team | 1 | 4 |
| `7c7461bd-bfd0-4215-a180-e376ffb8d1b0` | Lighting | Tech Team | 1 | 5 |
| `d7b38845-2e13-4a56-86e6-69c49ff4c6f3` | In-Ear Mixer | Tech Team | 1 | 6 |
| `84a10f22-52ef-43cc-9025-f3a3ccc2ac85` | Backstage Assistant | Tech Team | 1 | 7 |
| `da8c7f47-c974-41ee-ab2a-3809f8f5d26e` | Worship Leader | Worship Team | 2 | 1 |
| `9ccf7768-505d-4612-b058-0c6b5a773b4e` | Vocalist | Worship Team | 2 | 2 |
| `18645fa3-d48a-4c48-b51a-afd3652f3927` | Piano | Worship Team | 2 | 3 |
| `dd360357-71f6-4892-8405-5d748080c6fd` | Keys | Worship Team | 2 | 4 |
| `5799674f-da38-4b6a-9825-32e41d2c8755` | Guitar | Worship Team | 2 | 5 |
| `ab4bc739-d984-45af-929a-53a2673876a7` | Electric Guitar | Worship Team | 2 | 6 |
| `ecf3052e-115b-40e0-a247-6b9772722296` | Bass Guitar | Worship Team | 2 | 7 |
| `5530795a-bd30-454e-99fe-a5073c93b620` | Drums | Worship Team | 2 | 8 |
| `36b4098b-096e-4e94-ad3e-f51b35a8e670` | Saxophone | Worship Team | 2 | 9 |

Excluded service type UUID: `f30f3f88-1e83-4e1a-bc60-ef3974a071fb`.

---

## 6. Local HTTP API (what the SPA calls)

All routes are registered in `src-tauri/src/server/mod.rs`. All responses are JSON with a
`success` boolean. Upstream/auth failures return **HTTP 502** carrying `{"success":false,"error":"…"}`;
unknown cuelist ids return **404**.

### 6.1 `/api/worshiptools-services/*` — server-side WT integration

#### `GET /api/worshiptools-services/services`

Query: `refresh=1|true` forces a refetch (default cache 5 min).

```json
{ "success": true, "upcoming": [ClientService], "past": [ClientService], "count": 14 }
```

#### `GET /api/worshiptools-services/services/{id}/setlist`

Query: `live=1|true` or `refresh=1|true` → bypass the raw-doc cache and fetch that one doc.

```json
{
  "success": true,
  "source": "cache" | "live",
  "service": { "id": "…", "name": "…", "displayDate": "…" },
  "songs": [ { "position": 1, "cueId": "abc", "songId": "uuid?", "title": "Water", "key": "G", "bpm": 72, "meter": "4/4" } ],
  "count": 10
}
```

Notes: the raw cuelist doc is always written back into the doc cache after a live fetch.
`404` when the cuelist does not exist (`{"error":"Dienst niet gevonden"}`).

#### `GET /api/worshiptools-services/services/{id}/roster`

Query: `sync=1|true` forces the people-name sync (default TTL 30 min).

```json
{
  "success": true,
  "service": { "id": "…", "name": "…", "displayDate": "…" },
  "teams": [
    { "name": "Tech Team", "order": 1, "accepted": 3, "declined": 0, "pending": 1,
      "members": [ { "role": "Audio", "roleOrder": 2, "name": "…", "status": "accepted", "userId": "…" } ] }
  ],
  "roster": [ { "name": "…", "role": "Audio", "status": "accepted", "team": "Tech Team", "userId": "…" } ],
  "counts": { "total": 8, "accepted": 7, "pending": 1, "declined": 0 }
}
```

Contract: `teams` keeps **everyone** (incl. declined/pending) for diagnostics; the flat
`roster` array **excludes declined** entries — that is what the Stage Builder renders.
`counts.declined` counts the excluded ones. Note: this route has **no live/refresh flag** —
the cuelist doc is served from `full_doc_cache` when warm (it is only refilled by
`GET …/services`, `?refresh=1` on that route, or a setlist fetch).

#### `GET /api/worshiptools-services/library`

Query: `refresh=1|true`. Cache 5 min.

```text
{ "success": true, "songs": [LibrarySong], "count": 123,
  "updatedAt": "2026-10-17T09:12:33.000Z", "source": "live" | "cache" | "cache-stale",
  "warning": "…"   // only present for source: "cache-stale" }
```

`source` is `"live"` only when the fetch finished < 5 s ago. On fetch error the **stale
cache is served with HTTP 200** (`source: "cache-stale"` + `warning`); only when there is
no cache at all does it return 502.

#### `ANY /api/worshiptools-services/people/reload`

Registered with `any()` (any HTTP method works).
Reloads `{data_dir}/people_cache.json` from disk into memory (force), returns
`{ "success": true, "count": n, "message": "People cache herladen (n personen ingeladen)" }`.

### 6.2 `/api/worshiptools/*` — legacy extension bridge (in-memory)

The Chrome extension POSTs scraped data; any client can GET it back. **In-memory only in
the Rust port** — data is lost on restart and there is no Firestore persistence.

| Route | Method | Payload / response |
|-------|--------|--------------------|
| `/api/worshiptools/setlist` | POST | body must contain `items` **or** `structured` (else **400** `"Ongeldig payload. Verwacht items of structured."`) → `{ "success": true, "received": n }` |
| `/api/worshiptools/setlist` | GET | `{ success, data, updatedAt, source:"cache" }` or `{ success:false, data:null, message }` |
| `/api/worshiptools/roster` | POST | body must contain `roster` array (else **400**) → `{ success, received }` |
| `/api/worshiptools/roster` | GET | same envelope as setlist |
| `/api/worshiptools/library` | POST | body must contain `songs` array (else **400**) → `{ success, received }` |
| `/api/worshiptools/library` | GET | same envelope as setlist |
| `/api/worshiptools/status` | GET | availability summary (below) |

Stored payload envelopes (always stamped `"source": "chrome-extension"`):

```text
// setlist:  { items, structured, date, songCount, source }
// roster:   { roster, teams_scanned, source }
// library:  { songs, count, source }
```

`updatedAt` is RFC3339 with milliseconds, UTC (`chrono::SecondsFormat::Millis`).

`GET /api/worshiptools/status`:

```json
{
  "setlist": { "available": true, "itemCount": 12, "date": "2026-09-13", "updatedAt": "…" },
  "roster":  { "available": true, "assignmentCount": 8, "teamsScanned": 4, "updatedAt": "…" },
  "library": { "available": true, "songCount": 420, "updatedAt": "…" }
}
```

### 6.3 Adjacent surface

`POST /api/iem/update-roster` (in `iem.rs`) is the sink for WorshipTools-derived mic/IEM
assignments pushed by the extension — same extension, different consumer. No SPA module
calls it today (the router registers it; see README), so treat it as a stable but
currently unused surface.

---

## 7. WebSocket broadcasting

Shared hub (`/ws`, axum + tokio broadcast). Frames are `{"event": "<topic>", "data": <json>}`.

| Topic | Fired when | SPA listener |
|-------|-----------|--------------|
| `wt:setlist` | legacy setlist POST accepted | `setlist.js` (`ws:wt:setlist`) |
| `wt:roster` | legacy roster POST accepted | `stagebuilder.js` (`ws:wt:roster`) |
| `wt:library` | legacy library POST accepted | `songidassigner.js` (`ws:wt:library`) |

The browser client ([`Ichtus_SPA/js/ws-client.js`](../Ichtus_SPA/js/ws-client.js)) re-dispatches
every topic as a DOM `CustomEvent` named `ws:{event}` and auto-reconnects with backoff.
The pushed `data` is the **stored payload envelope**, not the REST wrapper.

---

## 8. Caching & persistence matrix

| Cache | Location | TTL / policy |
|-------|----------|--------------|
| Access token | memory | valid until `expires_in`, renewed 60 s early; forced refresh on 401/403 |
| Services list (upcoming/past) | memory | 5 min (`CACHE_TTL`) |
| Raw cuelist docs (`full_doc_cache`) | memory, keyed by id | cleared on every services refresh; written on each live setlist/roster fetch; no TTL |
| Song doc | memory, keyed by songId | 60 s (`SONG_CACHE_TTL`), 5 s fetch timeout |
| Song library | memory | 5 min, stale copy kept for fallback |
| People name map | memory + `{data_dir}/people_cache.json` | 30 min (`PEOPLE_SYNC_TTL`), disk copy loaded at startup |
| Legacy setlist/roster/library | memory only | no TTL, wiped on restart |

Constants: `MAX_PAGES = 5`, song library pages = 20.

---

## 9. Frontend consumers (must keep working)

| Module | Calls | Listens |
|--------|-------|---------|
| `Ichtus_SPA/js/modules/wt-services.js` | `GET …/services` (`?refresh=1`), `GET …/services/{id}/setlist` (`?live=1`) | poll timer (stopped by `router.js` on navigation) |
| `Ichtus_SPA/js/modules/stagebuilder.js` | `GET …/services`, `GET …/services/{id}/roster` | `ws:wt:roster`, extension CustomEvent `worshiptools-roster` |
| `Ichtus_SPA/js/modules/songidassigner.js` | `GET …/library` (manual import + background diff-import) | `ws:wt:library`, CustomEvent `worshiptools-library` |
| `Ichtus_SPA/js/modules/setlist.js` | `GET /api/worshiptools/setlist` (legacy) | CustomEvent `worshiptools-setlist`, `ws:wt:setlist` |
| `Ichtus_SPA/js/modules/dashboard/widgets/mic-monitor.js` | `GET /api/iem/status`, `POST /api/iem/assign` | CustomEvent `worshiptools-roster` → mic auto-assignment |
| `Ichtus_SPA/js/modules/integration.js` | UI card `worshiptools-api` / `worshiptools-ext` | — |

Extension message types (browser side, for the fallback path):
`SETLIST_EXTRACTED` → `SETLIST_RECEIVED`, `ROSTER_EXTRACTED` → `ROSTER_RECEIVED`,
`LIBRARY_EXTRACTED` → `LIBRARY_RECEIVED`; `spa-bridge.js` converts the latter into DOM
CustomEvents `worshiptools-setlist` / `-roster` / `-library`.

---

## 10. Recreation checklist

1. **Config**: implement the env-var → `server-config.json` resolution, the exact
   missing-credentials error message, and refresh-token write-back.
2. **Auth**: Firebase refresh-token exchange, in-memory token cache with 60 s skew,
   2 attempts with linear backoff, force-refresh retry on 401/403.
3. **Firestore fetchers**: `cuelists` (5 pages × 100), `cuelists/{id}` (404-tolerant),
   `cuelists/{id}/people` (404 → empty), `songs` (20 pages × 500), `songs/{id}`
   (60 s cache, 5 s timeout). All with `Authorization: Bearer {id_token}`.
4. **Typed-value helpers**: `v_str` / `v_map_fields` / `v_arr_values` — everything else
   depends on them.
5. **Parsers**: `parse_event` (exclusion, name chain, times/fallback date chain, local-tz
   parsing, Dutch formatting), `to_library_song`, `extract_songs` (key/bpm/meter
   precedence), `build_roster` (role map table, status normalisation, name fallback).
6. **People sync**: official API + on-disk cache + 30 min TTL + best-effort failure mode.
7. **HTTP routes**: the 5 `/api/worshiptools-services/*` routes and the 7 legacy
   `/api/worshiptools/*` routes with the exact query flags, status codes and JSON shapes.
8. **WS**: broadcast `{event,data}` on legacy POSTs; verify `ws:wt:*` DOM CustomEvents fire.
9. **Verify** (server running, credentials present):

```bash
curl -s localhost:8080/api/worshiptools-services/services | head -c 400
curl -s "localhost:8080/api/worshiptools-services/services/$ID/setlist?live=1"
curl -s "localhost:8080/api/worshiptools-services/services/$ID/roster?sync=1"
curl -s localhost:8080/api/worshiptools-services/library?refresh=1 | head -c 400
curl -s -X POST localhost:8080/api/worshiptools/setlist \
  -H 'content-type: application/json' -d '{"structured":[],"date":"2026-10-18"}'
curl -s localhost:8080/api/worshiptools/status
```

Expected: 200s with `"success": true`, `upcoming` non-empty, `roster` without declined
entries, `service.displayDate` in Dutch format, and `ws:wt:setlist` observed in the SPA
console after the legacy POST.

10. **Non-negotiables**: no credentials in code or in git; missing creds must surface as
    502 + the Dutch error message; a failing song/person fetch must degrade, never 500.

---

## 11. Known gotchas

- **Timezone**: WT times are stored without timezone and are interpreted in the *server's*
  local timezone. Changing the machine's locale changes the rendered dates.
- **`expires_in` type** varies between string and number.
- **Duplicated token logic**: `refresh_song_library` does its own 401/403 retry inside the
  pagination loop — keep the same "one forced refresh, then give up" semantics.
- **`full_doc_cache` never expires**; long-running servers only pick up roster/roster-doc
  edits via `refresh_services` (cache clear) or `?live=1`.
- **Unknown role UUIDs vanish silently** from the roster — when WorshipTools adds a new
  role, the map in §5.4 must be extended.
- **Legacy payloads are memory-only**; do not promise persistence across restarts.
- Legacy GET before any POST returns HTTP **200** with `success: false` and a Dutch
  `message` — consumers branch on `success`, not on the status code.
- Older docs mention a Firestore `worshiptools_sync` collection and a Node route
  `src/routes/worshiptools-services.js`; neither exists in this codebase.
- Song numbers use `Prefix + Number + optional suffix + space + name`
  (`D179N Water`, `O586 Ik wil juichen`); `D000` is a service divider, not a song —
  see §4 of [`worshiptools-api.md`](worshiptools-api.md).