# WorshipTools API & Integration

Hoe de Ichtus Workspace SPA samenwerkt met WorshipTools (WT) voor setlists, rosters en liederenbibliotheken.

---

## Overzicht

Er zijn **twee integratiepaden** naar WorshipTools:

| Pad | Methode | Gebruikt voor |
|-----|---------|---------------|
| **Chrome Extension** | DOM-scraping van de WT-website | Setlist, Roster, Song Library (live vanuit de browser) |
| **Server API** | Firestore REST API (rechtstreeks) | Dienstenlijst + setlist per dienst (server-side) |

Beide paden leveren dezelfde soort data, maar komen via verschillende routes binnen.

---

## 1. Chrome Extension (DOM-scraping)

### Architectuur

```
WorshipTools Website
    │
    ▼
content.js (content script, draait op worshiptools.com)
    │  scrape DOM → parseSongNumber() / collectRosterEntries()
    │
    ▼
background.js (service worker)
    │  chrome.runtime.onMessage → forwardToSpaTabs()
    │  + POST naar server API (/api/worshiptools/*)
    │
    ├──▶ spa-bridge.js (content script op Ichtus SPA)
    │       │  CustomEvent 'worshiptools-setlist' etc.
    │       ▼
    │    Ichtus SPA (setlist.js / dashboard)
    │
    └──▶ Server API (/api/worshiptools/setlist, /roster, /library)
            │  In-memory cache + Firestore persist
            ▼
         Andere clients (REST API consumers)
```

### Extensie-bestanden

| Bestand | Rol |
|---------|-----|
| `manifest.json` | MV3 configuratie, content script matching, permissions |
| `content.js` | Draait op `*.worshiptools.com/*` — scrape setlist, roster, library |
| `background.js` | Service worker — message relay, server POST, session persistence |
| `spa-bridge.js` | Draait op Ichtus SPA — converteert Chrome messages naar CustomEvents |
| `popup.js` | Extension popup UI — detecteer WT-pagina, Sync-knop |
| `wt-scrape.js` | Dev-tool / snippet (NIET geladen door manifest) — handmatig debug-scrapen |

### URL-detectie

De extension herkent drie states:

| URL-patroon | Status | Actie |
|-------------|--------|-------|
| `/app/account/{uuid}/service/{uuid}` | Service-pagina | Sync-knop actief (groen) |
| `*.worshiptools.com/*` (anders) | WT-account pagina | Sync-knop zichtbaar maar uitgeschakeld (oranje) |
| Niet-WT URL | Niet van toepassing | Verborgen |

### Data-extractie

#### Setlist (`extractSetlist`)

1. **Elementen zoeken**: `.song-description h3`, `.item-name`, `.song-title`, etc.
2. **Tekst schoonmaken**: duur verwijderen (`7:28`), toonsoort badge uitsluiten
3. **Song-nummers parsen** via `parseSongNumber()`:

```
Patroon:  [Letters 1-4] [spatie optioneel] [Cijfers 1-4] [Letter optioneel]  [spatie]  [Naam]
Voorbeelden:  D179N Water,  O586 Ik wil juichen,  LvK 9 Lied,  Ps 150 Psalm
```

4. **D000-filtering**: `D000` is een service-structuur-item (niet een lied)
5. **Service-datum**: parsed uit `.typed-service-time`, `.planning-header__date`, etc. (Nederlandse datums ondersteund)
6. **Verzenden**: `chrome.runtime.sendMessage({ type: 'SETLIST_EXTRACTED', data, structured, date })`

#### Roster (`collectRosterEntries` / `runAllTeamsSync`)

1. **Rollen-sectie vinden**: zoekt `.card-section-title` met tekst "Rollen" / "Roles"
2. **Per team**: klik door de team-switcher, wacht op DOM-update
3. **Per rol**: `.list-group-item` → naam, avatar URL, status
4. **Declined filteren**: rode rand (`border-danger`) of `title="Declined"`
5. **Kids-teams overslaan**: regex `\b(kids|kinder|jeugd|children|youth)\b`
6. **Deduplicatie per UUID** (uit avatar URL: `/users/{UUID}/avatar/`)
7. **Verzenden**: `chrome.runtime.sendMessage({ type: 'ROSTER_EXTRACTED', data })`

#### Library (`extractLibrary`)

1. **Elementen**: `.song-description h3`, `.song-list .name`, `.name`, etc.
2. **`parseSongNumber()`** → `{ number, name, artist? }`
3. **Verzenden**: `chrome.runtime.sendMessage({ type: 'LIBRARY_EXTRACTED', data, songs, count })`

### Message Flow (Chrome API)

```
content.js                    background.js                   spa-bridge.js
    │                              │                               │
    ├── SETLIST_EXTRACTED ────────▶│                               │
    │   { data, structured, date } │── persistToSession()          │
    │                              │── postToServer('/setlist')    │
    │                              │── forwardToSpaTabs() ────────▶│
    │                              │   SETLIST_RECEIVED            │── CustomEvent
    │                              │                               │   'worshiptools-setlist'
    │                              │                               │
    ├── ROSTER_EXTRACTED ─────────▶│                               │
    │   { data }                   │── forwardToSpaTabs() ────────▶│
    │                              │   ROSTER_RECEIVED             │── CustomEvent
    │                              │                               │   'worshiptools-roster'
    │                              │                               │
    ├── LIBRARY_EXTRACTED ────────▶│                               │
    │   { data, songs, count }     │── forwardToSpaTabs() ────────▶│
    │                              │   LIBRARY_RECEIVED            │── CustomEvent
    │                              │                               │   'worshiptools-library'
```

### SPA-side verwerking

| CustomEvent | Handler | Functie |
|-------------|---------|---------|
| `worshiptools-setlist` | `setlistModule.receiveSetlist()` | Parse songs → render preview → sync naar ProPresenter |
| `worshiptools-roster` | `dashboardModule` | Toon mic-toewijzing per persoon |
| `worshiptools-library` | `songidassignerModule` | Import songs voor ID-toewijzing |

### Race condition preventing

De SPA dispatch `ichtus-setlist-ready` zodra de setlist-view geladen is. De spa-bridge wacht op dit event voordat hij data dispatched, zodat de listener al klaar staat.

---

## 2. Server API (Firestore REST)

### Architectuur

```
WorshipTools Firestore (Google Cloud)
    │
    ▼  REST API: /v1/projects/worship-extreme-datastore/databases/(default)/documents/accounts/{id}/cuelists
    │
src/routes/worshiptools-services.js
    │  Refresh token → access token → paginated fetch → parse events
    │
    ▼
GET /api/worshiptools-services/services
GET /api/worshiptools-services/services/:id/setlist
```

### Credentials

Configuration (in volgorde):
1. Environment variables: `WT_API_KEY`, `WT_ACCOUNT_ID`, `WT_REFRESH_TOKEN`
2. `server-config.json` → sectie `"worshiptools"`

⚠️ Credentials worden NOOIT hardcoded — ze staan in `.gitignore`.

### Authenticatie

```
Firebase Refresh Token  →  POST https://securetoken.googleapis.com/v1/token?key={apiKey}
                        →  id_token (korte levensduur, ~1 uur)
```

Het token wordt gecached en automatisch ververst bij 401/403.

### Endpoints

#### `GET /api/worshiptools-services/services`

Haalt de lijst van diensten op (10 komende + 4 afgelopen).

**Query params:**
- `refresh=1` — Forceer verversen (cache is 5 min)

**Response:**
```json
{
  "success": true,
  "upcoming": [
    {
      "id": "uuid",
      "name": "Kerkdienst",
      "datetime": "2026-09-13T10:00:00.000Z",
      "displayDate": "ZO 13 sep 2026 - 10:00",
      "time": "10:00",
      "isToday": false,
      "isPast": false,
      "cuesCount": 15,
      "rehearsals": ["DO 19:30"]
    }
  ],
  "past": [...],
  "count": 14
}
```

#### `GET /api/worshiptools-services/services/:id/setlist`

Haalt de volledige setlist van één dienst op.

**Query params:**
- `live=1` — Altijd vers ophalen (1 Firestore doc)

**Response:**
```json
{
  "success": true,
  "source": "cache|live",
  "service": { "id": "...", "name": "Kerkdienst", "displayDate": "..." },
  "songs": [
    { "position": 1, "cueId": "abc", "title": "Ik wil juichen voor U", "key": "G" },
    { "position": 2, "cueId": "def", "title": "Water", "key": "D" }
  ],
  "count": 10
}
```

### Firestore Data Model

```
accounts/{accountId}/cuelists/{cuelistId}
├── service
│   ├── name: "Kerkdienst"
│   ├── type: "uuid" (service type ID)
│   └── times: [{ time: "2026-09-13T10:00:00", type: "service|rehearsal" }]
├── data
│   ├── cuelist_title: "Kerkdienst 13-09"
│   ├── cuelist_options: { date: "2026-09-13T10:00:00" }
│   ├── cues: [{ cue_id, displayName, ... }]
│   └── songMeta: { cueId: { key: "G" } }
└── name, post, createTime, ...
```

### Uitgesloten types

- `Ichtus Kids Blauw` (type ID: `f30f3f88-1e83-4e1a-bc60-ef3974a071fb`)

---

## 3. Server Data Cache (Extension → Server)

### Endpoints (`/api/worshiptools/*`)

De extension POST-t data naar het千方百oud, de server cached het en served het via REST:

| Endpoint | Methode | Beschrijving |
|----------|---------|-------------|
| `/api/worshiptools/setlist` | POST | Ontvang setlist van extension |
| `/api/worshiptools/setlist` | GET | Haal laatste setlist op |
| `/api/worshiptools/roster` | POST | Ontvang roster van extension |
| `/api/worshiptools/roster` | GET | Haal laatste roster op |
| `/api/worshiptools/library` | POST | Ontvang song library van extension |
| `/api/worshiptools/library` | GET | Haal laatste library op |
| `/api/worshiptools/status` | GET | Status van alle WT-data |

### Opslag

1. **In-memory cache** — instant beschikbaar, verliest bij server restart
2. **Firestore** — persistente backup (`worshiptools_sync` collection)
3. **WebSocket broadcast** — `wt:setlist`, `wt:roster`, `wt:library` events

---

## 4. Song Numbering Systeem

### Formaat

Song-nummers volgen het patroon: **Prefix + Nummer + Optionele suffix**

| Voorbeeld | Prefix | Nummer | Suffix |
|-----------|--------|--------|--------|
| `D179N` | D | 179 | N |
| `O586` | O | 586 | — |
| `LvK 9` | LvK | 9 | — |
| `Ps 150` | Ps | 150 | — |
| `ELB 838` | ELB | 838 | — |
| `D000` | D | 000 | — (service-divider, niet een lied) |

### Bekende prefixes

- **D** — Dienst-liedboek
- **O** — Opwekking
- **OK** — Opwekking Kinderen
- **LvK** — Lied van de Kerk
- **Ps** — Psalmen
- **ELB** — Evangelisches Liederbuch
- **H** — Harp (mogelijk)

### Regex patronen (3 plekken in de codebase)

| Bestand | Functie | Regex |
|---------|---------|-------|
| `content.js` | `parseSongNumber()` | `/^([A-Za-z]{1,4}\s*\d{1,4}[A-Za-z]?)\s+(.+)/` |
| `setlist.js` | `stripSongNumberPrefix()` | `/^[A-Z]{1,3}\s*\d{1,4}[A-Za-z]?\s+/` |
| `wt-services.js` | numMatch | `/^([A-Z]{1,3}\s*\d{1,4}[A-Za-z]?)\s+(.+)/` |

⚠️ **Belangrijk**: De `[A-Za-z]?` achter de cijfers is essentieel voor suffixen zoals "N" in "D179N". Zonder deze groep wordt "D179N Water" verkeerd geparsed als nummer "D179" + naam "N Water".

---

## 5. Setup & Installatie

### Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Schakel "Developer mode" in (rechtsboven)
3. Klik "Load unpacked"
4. Selecteer de map `extensions/worshiptools-sync/`

### Server Credentials

Maak een `server-config.json` (staat in `.gitignore`):

```json
{
  "worshiptools": {
    "apiKey": "AIzaSy...",
    "accountId": "jouw-account-id",
    "refreshToken": "1//..."
  }
}
```

Of gebruik environment variables:
```bash
export WT_API_KEY="AIzaSy..."
export WT_ACCOUNT_ID="jouw-account-id"
export WT_REFRESH_TOKEN="1//..."
```

### Permissions

| Permission | Waarom |
|------------|--------|
| `activeTab` | Toegang tot de actieve WT-pagina |
| `clipboardWrite` | Kopiëren van setlist naar klembord |
| `tabs` | Detecteren van SPA-tabs voor forwarding |
| `storage` | `chrome.storage.session` voor data persistentie |
| `scripting` | Dynamisch injecteren van content script |
| `notifications` | (optioneel) push-notificaties |

---

## 6. Probleemoplossing

### Setlist wordt niet ontvangen

1. Controleer of de extension actief is (groene stip in popup)
2. Open een WT service-pagina: `/app/account/{uuid}/service/{uuid}`
3. Klik "Sync data" in de extension popup
4. Check de browser console (F12) voor `[WT→SPA]` logs

### Lied-nummers worden niet herkend (geen badge)

1. Het nummer moet voldoen aan het formaat: `Prefix + Nummer[+Suffix] + Spatie + Naam`
2. Voorbeelden die WERKEN: `D178N Water`, `O586 Ik wil juichen`
3. Voorbeelden die NIET werken: `D178NWater` (geen spatie), `178N Water` (geen prefix)

### Kids/Jeugd teams worden overgeslagen

Dit is bedoeld — de regex `\b(kids|kinder|jeugd|children|youth)\b` filtert deze teams automatisch.

### Service worker herstart (MV3)

Chrome stopt service workers na ~30s idle. Data overleeft dit via:
- `chrome.storage.session` (herstart-proof)
- In-memory cache (snelle pad)
- Firestore (persistente backup)
