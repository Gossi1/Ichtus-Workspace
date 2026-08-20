# Firestore Backup — Architecture

> **Model:** Local-first, cloud-backup. Browsers only ever talk to the local
> server (REST + WebSocket). Firestore is an *asynchronous, debounced backup*
> written exclusively by the server-side Firebase **Admin SDK**.

```
                       ┌──────────────────────────────────────────────┐
                       │              LOCAL SERVER (Node)             │
                       │                                              │
  [ Browser A ] ──REST──▶  /api/* routes                              │
  [ Browser B ] ──WS────▶  in-memory topic state  ── broadcast ──▶ clients
  [ Browser C ] ──WS────▶  (single source of truth)                  │
                       │         │                                   │
                       │         └─ debounce (3s) ──▶ Admin SDK ──▶ Firestore
                       └──────────────────────────────────────────────┘
```

The Admin SDK authenticates with `serviceAccountKey.json` and **bypasses
security rules**, which is why `firestore.rules` can deny all client access.
The browser never sends or receives data to/from Firebase directly.

---

## Components

| File | Role |
|---|---|
| `src/lib/firebase.js` | Initializes the Firebase Admin SDK from `serviceAccountKey.json` (project root, gitignored). Exposes `getFirestore()`, which returns `null` when the key is missing/invalid — every caller treats `null` as "skip backup, keep working". |
| `src/lib/topic-store.js` | Generic in-memory state store. Each topic has `state`, a debounce timer, a `load` callback (initial state from Firestore at startup) and a `persist` callback (debounced backup write). Registers a connect-handler that pushes the current snapshot to every new WebSocket client. |
| `src/routes/commandcenter.js` | Topic `commandCenter` — the checklist's live state. Merge-on-POST + broadcast + debounced `set({merge:true})` to `commandCenter/activeState`. Archive (`POST /api/commandcenter/archive`) writes **directly** (no debounce) to `commandCenterHistory`. |
| `src/routes/patchbay-state.js` | Topic `patchbay` — the ☁️ cloud save of patchbay projects. Full-replace POST + debounced backup to `patchbay/projects`. |
| `src/routes/dashboard-state.js` | Topic `dashboard` — ☁️ cloud save of dashboard layout. Full-replace POST + debounced backup to `dashboard/state`. |
| `src/routes/worshiptools.js` | **Not a topic.** Cache-first REST endpoints fed by the Chrome extension; each POST writes *immediately* (no debounce) to `worshiptools_sync/latest_{setlist,roster,library}`. The in-memory cache is the fast path, Firestore is the restart-proof copy. |
| `src/ws.js` | WebSocket hub on `/ws`. `broadcast(event, data)` pushes to all clients; `onClientConnect(handler)` lets modules push a state snapshot to each new connection. |
| `src/server.js` | Wires it together: `initFirebaseAdmin()` → optional IEM migration → `initIemState()` → `initCommandCenterTopic/initPatchbayTopic/initDashboardTopic()` (each loads its initial state from Firestore). |
| `firestore.rules` | `allow read, write: if false` for everything. The Admin SDK ignores rules; this is a safety net so a future client SDK is denied by default. |

---

## Lifecycle

**Startup (server boot):**
1. `initFirebaseAdmin()` — reads `serviceAccountKey.json`; no key → `getFirestore()` stays `null`.
2. Each topic's `initTopic()` calls its `load` callback → reads the Firestore backup into memory. No Firestore → topic starts empty/defaults, everything still works.
3. Server listens; browsers hydrate via `GET /api/<topic>/state` **and** receive a live snapshot on WebSocket connect (`pushOnConnect`).

**Runtime change (e.g. checklist task toggle):**
1. Browser → `POST /api/commandcenter/state` with a patch.
2. Server merges the patch into the in-memory state (single source of truth).
3. Server **immediately** broadcasts `commandCenter:state` to all connected clients (< 5 ms LAN latency).
4. A 3-second debounce timer starts (resets on every change). When it fires, the full state is written to `commandCenter/activeState` via the Admin SDK.
5. If the write fails (Firestore down / no key), a warning is logged — **local operation is unaffected**.

**Read path for a browser:** either `GET /api/<topic>/state` (REST hydration) or the WS snapshot at connect time; live updates come over `ws:<topic>:state` events.

---

## Collections map

| Collection / doc | Written by | When | Debounced? |
|---|---|---|---|
| `commandCenter/activeState` | server (`topic-store` persist) | every state change | yes (3s) |
| `commandCenterHistory/*` | server (`/archive` route) | Reset & Archiveer | no (rare action) |
| `patchbay/projects` | server (persist) | ☁️ cloud save | yes (3s) |
| `dashboard/state` | server (persist) | ☁️ cloud save | yes (3s) |
| `worshiptools_sync/latest_setlist` | server (`worshiptools.js`) | Chrome-extension POST | no |
| `worshiptools_sync/latest_roster` | server | Chrome-extension POST | no |
| `worshiptools_sync/latest_library` | server | Chrome-extension POST | no |
| `mic_monitor/*` | *(nothing)* | legacy — read-only, only with `IEM_MIGRATE_FROM_FIRESTORE=1` at startup; never written anymore | — |

---

## Degradation matrix

| Condition | Result |
|---|---|
| No `serviceAccountKey.json` | Backup skipped silently; local-first operation 100% functional |
| Firestore unreachable / quota exceeded | Backup writes fail + warn; live sync unaffected |
| Internet down during a service | Full local operation (this is the point of local-first) |
| Server down | App isn't served at all — no degradation scenario to design for |

---

## Notes for contributors

- **Never commit `serviceAccountKey.json`** — it grants full read/write on the Firestore project.
- Adding a new syncable module? `createTopic(name, { load, persist, pushOnConnect })` in a new route file, then call its `init*Topic()` from `start()` in `src/server.js`. The topic-store handles debounce, snapshot-on-connect and broadcasting for you.
- `updateTopicState` **merges** a patch (commandCenter); `setTopicState` **replaces** the whole value (patchbay/dashboard cloud save). Pick deliberately.
- Debounced persists skip empty/`{}` states and reset their timer on every update — bursty edits collapse into a single Firestore write.
- `firestore.rules` deliberately denies everything. If a browser SDK is ever re-enabled, write explicit per-collection rules first; the current deny-all would block it.
- Legacy `mic_monitor/*` docs still exist in Firestore but are dead — the migration that reads them is opt-in and read-only. They can be deleted manually via the Firebase Console.
