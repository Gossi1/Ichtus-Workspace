# Ichtus Workspace

Church service management desktop applicatie voor het coördineren van kerkdiensten, X32 mixer, microfoons, en WorshipTools diensten.

---

## 🛠️ Installatie op Windows

Er is **geen Node.js, Git of Windows Service (WinSW/NSSM)** meer nodig om de app te draaien.

### ⚡ Download & Installeren *(Aanbevolen)*

1. Ga naar [Releases op GitHub](https://github.com/Gossi1/Ichtus-Workspace/releases/latest).
2. Download het nieuwste installatiebestand: `Ichtus Workspace_<versie>_x64-setup.exe`.
3. Voer het installatiebestand uit (geen administratorrechten vereist).
   > *Opmerking*: Omdat er geen betaald certificaat wordt gebruikt, kan Windows SmartScreen éénmalig vragen: klik op **Meer informatie** → **Toch uitvoeren**.
4. Kies bij de eerste start de rol van de computer:
   - **🖥️ Beamer PC (Host)**: Start de centrale server voor X32 mixer en microfoons.
   - **🔗 Tweede PC (Client)**: Verbindt direct over het lokale netwerk met de Beamer PC.
5. De app start automatisch op met Windows en werkt zichzelf via de ingebouwde updater automatisch bij!

---

## 💻 Lokale ontwikkeling (voor developers)

Wil je de app zelf ontwikkelen op je laptop:

### Vereisten
- **Node.js 24+**
- **Rust toolchain** (`rustup default stable`)
- C++ Build Tools (via Visual Studio Installer)

### Starten in dev-modus
```bash
# Dependencies installeren
npm install

# Tauri desktop app starten met hot-reload
npm run tauri:dev
```
De server start in dev-modus automatisch op poort `8090` (als poort `8080` al bezet is) en herlaadt bij wijzigingen.

### Installer lokaal bouwen
```bash
npm run tauri:build
```
Het `.exe` installatiebestand wordt aangemaakt in `src-tauri/target/release/bundle/nsis/`.

---

🎉 You're done. The server now starts with Windows and restarts automatically if it ever crashes.

---

### Verifying the install

In a Command Prompt:

```cmd
nssm status IchtusServer
curl http://localhost:8080/api/health
```

Expected outputs:

- `SERVICE_RUNNING` (or `SERVICE_START_PENDING` for a second or two after boot).
- `{"status":"ok",...}`

### Updating later

```cmd
git pull                  :: only if you cloned with Git
npm install               :: only if package.json changed
nssm restart IchtusServer :: picks up new code without rebooting Windows
```

Or check updates in the in-app **Instellingen (Settings)** tab under Systeem / Debug.

### Uninstalling

```cmd
uninstall-service.bat
```

Removes the Windows service cleanly. Your project files stay intact — delete the folder manually if you want a full uninstall.

### NSSM command reference

| Action | Command |
|--------|---------|
| Check status | `nssm status IchtusServer` |
| View logs | open `stdoutLog` / `stderrLog` from `nssm-service.json` |
| Restart | `nssm restart IchtusServer` |
| Stop | `nssm stop IchtusServer` |
| Open config GUI | `nssm edit IchtusServer` |
| Remove | `uninstall-service.bat` |

### Service URLs

| Service | URL |
|---------|-----|
| **SPA** (Ichtus Workspace) | `http://localhost:8080/Ichtus_SPA/` |
| **Health check** | `http://localhost:8080/api/health` |
| **Status + logs** | `http://localhost:8080/api/status` |
| **WebSocket** | `ws://localhost:8080/ws` |

---

## 🩹 Troubleshooting (Windows)

### "fatal: detected dubious ownership in repository"

Modern Git for Windows refuses to operate in a repo owned by a different
Windows user (often after restoring a backup from another PC, switching
accounts, or copying the workspace as admin). Every git command then
fails with:

```text
fatal: detected dubious ownership in repository at 'C:/Ichtus_apps'
```

Run **once** to whitelist this workspace (and any nested repos) in your
own git config – idempotent, no admin needed:

```cmd
scripts\windows-setup.bat
```

You can inspect or remove all entries this workspace owns at once:

```cmd
git config --global --get-all safe.directory
scripts\windows-cleanup.bat
```

To remove a single entry manually:

```cmd
git config --global --unset safe.directory C:/Ichtus_apps
```

---

## 💻 Manual Start

```bash
start-server.bat
```

Or directly with Node.js:
```bash
node src/server.js
```

All services run in one process on port 8080:
- SPA HTTP server
- X32 OSC bridge (UDP :10023)
- Mic/IEM monitor (server state + WebSocket)
- WebSocket realtime hub
- Git update checking

---

## 🛡️ Architecture (v3.0)

Single Node.js server (`src/server.js`) on port 8080 replaces the previous
4-process architecture (Python SPA server + Node X32 bridge + Node Mic/IEM server + Python supervisor).

| Concern | Endpoint | Behaviour |
|---------|----------|-----------|
| Health check | `GET /api/health` | Always fast (< 50ms) |
| Status + logs | `GET /api/status` | PID, uptime, request count, last 50 log lines |
| NDI discovery | `GET /api/ndi/sources` | UDP broadcast + optional zeroconf |
| X32 OSC bridge | `POST /api/x32/load-channel-preset` | HTTP → OSC/UDP to Behringer X32 |
| X32 presets | `GET /api/x32/presets` | Library polling via persistent OSC session |
| Mic/IEM roster | `POST /api/iem/update-roster` | WorshipTools → server + WebSocket live sync |
| Command Center | `GET/POST /api/commandcenter/state` | Local-first state; Firestore backup (debounced) |
| Command Center archive | `POST /api/commandcenter/archive` | Archive to Firestore on reset |
| Patchbay cloud | `GET/POST /api/patchbay/state` | Server + debounced Firestore backup |
| Dashboard cloud | `GET/POST /api/dashboard/state` | Server + debounced Firestore backup |
| Git update check | `GET /api/check-update` | Compares HEAD with origin |
| WebSocket | `ws://localhost:8080/ws` | Realtime X32 + IEM + Command Center push |

### Frontend endpoints (all relative)

All frontend fetch calls use relative URLs (`/api/...`). No hardcoded `localhost` ports.

# Stop everything: Ctrl-C in the supervisor console, or:
#   taskkill /PID <pid from supervisor.pid>
```

If you only need the SPA without the bridges, you can still run it
standalone as before — `server.py` now ships the same `/api/health` +
`/api/status` endpoints, so a status tab in the SPA works in single-
shot mode too.

## ⚙️ Settings (Instellingen)

Access via the **Instellingen** (gear icon) in the sidebar.

| Setting | Description |
|---------|-------------|
| Offline Mode | Work without internet |
| NDI Auto-Discovery | Automatic NDI device scanning |
| NDI Preview Quality | Low / Medium / High |
| Time Format | 12-hour or 24-hour |
| Date Format | DD-MM-YYYY or MM-DD-YYYY |
| Debug Panel | Show debug logs & sync status |

---

## ✨ Features

| Module | Description |
|--------|-------------|
| **Dashboard** | Customizable widgets, timer, notes |
| **Agenda Maker** | Visual agenda editor with Tockify calendar integration |
| **Command Center** | Task management with role-based assignments |
| **Patchbay** | Digital signal routing canvas for A/V setup |
| **Analytics** | Service sequencing and tracking |
| **Setlist** | ProPresenter integration with WorshipTools sync |
| **Settings** | App configuration |
| **NDI Sources** | Network device discovery and selection |

---

## 📁 Project Structure

```
Ichtus_apps/
├── README.md                    # This file
├── install.bat                  # Auto-installer (Windows)
├── setup.py                     # Setup check & auto-install script
├── server.py                    # Local HTTP server (now ThreadingHTTPServer + /api/status)
├── supervisor.py                # Local dev watchdog (auto-restarts on crash; stdlib only)
├── start-server.bat             # Windows launcher (now launches the supervisor)
├── logs/                        # Per-service rotating logs (NOT committed, 5 MB x 3)
├── serviceAccountKey.json       # Firebase Admin credentials (NOT committed to git!) — server-side backup only
├── Ichtus_SPA/
├── requirements.txt             # Python dependencies
│
├── .gitignore                   # Excludes: .venv/, serviceAccountKey.json
│
├── assets/               # Shared branding & components
│   ├── css/branding.css
│   ├── fonts/
│   └── js/
│
├── Ichtus_SPA/                  # Main SPA application
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js               # Main app entry
│   │   ├── router.js            # SPA routing
│   │   ├── state.js             # App state management
│   │   ├── ws-client.js         # WebSocket realtime client
│   │   └── modules/
│   │       ├── settings.js      # Settings page (Instellingen)
│   │       ├── ndi.js           # NDI source discovery
│   │       ├── dashboard.js     # Dashboard widgets
│   │       ├── checklist.js     # Command Center tasks
│   │       ├── agenda.js        # Agenda maker
│   │       ├── patchbay.js      # Signal routing canvas
│   │       ├── setlist.js       # ProPresenter integration
│   │       └── analytics.js     # Service sequencing
│   └── data/
│
└── extensions/                  # Browser extensions
    └── worshiptools-sync/       # Chrome extension for setlist import
```

---

## 📦 Requirements

- **Python 3.8+** (for local dev server)
- **Chrome** browser (recommended)
- **Firebase Admin SDK** (optional, for server-side cloud backup)
- **zeroconf** Python package (installed automatically by setup.py)

---

## 🔧 Server Options

```bash
# Default (localhost:8080)
python server.py

# Custom port
python server.py --port 3000

# Network accessible (for mobile testing)
python server.py --host 0.0.0.0

# Auto-open browser
python server.py --open
```

---

## 🔐 Firebase (server-side backup only)

Firebase is **optioneel** (local-first + cloud-backup): de app draait volledig zonder config. De **browser** praat nooit direct met Firebase — alle state gaat via de lokale server (REST + WebSocket) en de server schrijft pas na een debounce een backup weg via de Firebase **Admin SDK**.

> Zie [`FIREBASE_BACKUP.md`](docs/FIREBASE_BACKUP.md) voor de volledige architectuur (topic-store, debounce, deny-all rules).

**Setup:**

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Firebase Console → Project Settings → Service accounts → **Generate new private key**.
3. Save the downloaded JSON as `serviceAccountKey.json` in the project root (gitignored).

Zonder het bestand draait alles lokaal gewoon door; zodra de server het bestand vindt, start de cloud-backup automatisch.

> **Oude mic-monitor data (Firestore → `iem-state.json`):** de mic/IEM monitor gebruikt Firestore niet meer; state staat in `iem-state.json` (project root). De oude `mic_monitor/{config, live_status, x32_library}` docs worden niet meer gelezen of geschreven. Wil je ze bij een *nieuwe* installatie eenmalig overnemen, run dan:
>
> ```bat
> set IEM_MIGRATE_FROM_FIRESTORE=1
> node src/server.js
> ```
>
> De migratie draait alleen als er nog geen `iem-state.json` bestaat en is read-only: de oude docs blijven in Firestore staan. Verwijder ze eventueel handmatig via de Firebase Console.

---

## 🌐 Browser Extension (Optional)

The WorshipTools Sync extension imports setlists from WorshipTools Planning.

**Installation:**
1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `extensions/worshiptools-sync/`

---

## 📚 Documentation

- [Feature Overview](Ichtus_SPA/FEATURES.md)
- [WorshipTools API — recreation reference](docs/worshiptools-api-reference.md)
- [WorshipTools integration & Chrome extension](docs/worshiptools-api.md)
- Chrome Extension: See `extensions/worshiptools-sync/README.md`

---

*For questions or issues, check the Features document or contact the developer.*