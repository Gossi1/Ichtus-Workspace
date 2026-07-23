# Ichtus Workspace

Church service management Single Page Application (SPA) for coordinating worship services.

---

## 🚀 Quick Start (New Installation)

### On a NEW PC:

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd Ichtus_apps
   ```

2. **Copy your Firebase config** (optional - enables data sync)
   - Either copy an existing `firebase-config.txt` (or `firebase-api-key.txt`) from another installation into this project
   - Or paste your Firebase web-app config straight into `Ichtus_SPA/firebase-config.txt` — the browser fetches it on page boot, so the setup screen is skipped entirely
   - Or enter values during `install.bat` setup
   - Both files are excluded from git (.gitignore) for security

3. **Run the installer**
   ```bash
   install.bat
   ```
   This will automatically:
   - Create a Python virtual environment (.venv)
   - Install required packages (zeroconf)
   - Prompt for Firebase configuration if needed
   - Check all dependencies

4. **Start the server**
   ```bash
   start-server.bat
   ```

5. **Open in browser**
   ```
   http://localhost:8080/Ichtus_SPA/
   ```

---

## 🪟 Windows Service (Auto-start met Windows)

Wil je dat de server **automatisch start wanneer je je laptop aanzet**?
(Dus zonder dat je `start-server.bat` hoeft te draaien.)

### Installatie (aanbevolen)

Deze stappen moet je **als Administrator** uitvoeren:

```cmd
cd C:\Users\shami\Documents\Ichtus_apps
install-service.bat
```

**NB:** `install-service.bat` installeert de **SPA-only service** (`IchtusServer`).
Voor de volledige **supervisor** (SPA + X32 bridge + mic/IEM) volg je de handmatige stappen hieronder.

### Supervisor als Windows service (handmatig — aanbevolen)

Als je ook de **X32 bridge** en **mic/IEM monitor** automatisch wilt laten starten:

**1. Installeer de service**
```cmd
nssm install IchtusSupervisor "C:\Users\shami\AppData\Local\Programs\Python\Python311\python.exe" "C:\Users\shami\Documents\Ichtus_apps\supervisor.py"
```

**2. Configureer de service**
```cmd
nssm set IchtusSupervisor AppDirectory "C:\Users\shami\Documents\Ichtus_apps"
nssm set IchtusSupervisor AppStdout "C:\Users\shami\Documents\Ichtus_apps\logs\supervisor-output.log"
nssm set IchtusSupervisor AppStderr "C:\Users\shami\Documents\Ichtus_apps\logs\supervisor-error.log"
nssm set IchtusSupervisor AppRotateFiles 1
nssm set IchtusSupervisor AppRotateOnline 1
nssm set IchtusSupervisor AppRotateBytes 5000000
nssm set IchtusSupervisor AppNoConsole 1
nssm set IchtusSupervisor Start SERVICE_AUTO_START
nssm set IchtusSupervisor DisplayName "Ichtus Workspace Supervisor"
nssm set IchtusSupervisor AppThrottle 3000
nssm set IchtusSupervisor AppExit Default Exit
```

**3. Start de service**
```cmd
nssm start IchtusSupervisor
```

### Beheer

| Actie | Commando |
|-------|----------|
| Status checken | `nssm status IchtusSupervisor` |
| Stoppen | `nssm stop IchtusSupervisor` |
| Starten | `nssm start IchtusSupervisor` |
| Herstarten | `nssm restart IchtusSupervisor` |
| Configuratie wijzigen | `nssm edit IchtusSupervisor` |
| Logs bekijken | `type logs\supervisor-error.log` |
| Service verwijderen | `nssm remove IchtusSupervisor confirm` |

### Waar vind je alles?

| Onderdeel | URL |
|-----------|-----|
| **SPA** (Ichtus Workspace) | `http://localhost:8080/Ichtus_SPA/` |
| **Supervisor dashboard** | `http://localhost:9090/` |
| **X32 bridge** | `http://localhost:3002/` |
| **Mic/IEM monitor** | `http://localhost:3001/` |

De supervisor herstart gecrashte services automatisch met oplopende vertraging (2s → 30s).

---

## 💻 Handmatig starten (zonder service)

```bash
start-server.bat
```

Dit start de **supervisor** (Python, `:9090`) die de SPA server (`:8080`),
de X32 OSC bridge (`:3002`) en de Mic/IEM monitor (`:3001`) bewaakt.
Bij een crash herstart de supervisor automatisch.

Of start alleen de SPA:
```bash
python server.py --open
```

---

## 🛡️ Robustness / Supervisor

The dev stack now has a single supervisor (Python, no new deps) that
watches every other service. Open `http://localhost:9090/` after launch
for the unified status dashboard.

| Concern | Where it lives | Behaviour |
|--------|----------------|-----------|
| All services crash-resistant | `supervisor.py` | Capped backoff (2s / 4s / 8s / 16s / 30s) on non-zero exit; never gives up but logs loudly |
| One-click service restart | `POST http://localhost:9090/api/restart/<key>` | Hard terminate + relaunch of `spa`, `x32`, or `mic_iem` |
| Live crash tail | `GET http://localhost:9090/api/logs/<key>` | Last 50 lines of `logs/<name>.log` formatted as JSON |
| "Why is the SPA slow" | `GET http://localhost:8080/api/status` | PID, uptime, request count, last 50 in-process log lines |
| Liveness probe | `GET http://localhost:8080/api/health` / `:9090/api/health` | Always-fast (no NDI discovery dependency) |
| Single-instance guard | `supervisor.pid` + heartbeat file | A second `start-server.bat` launch refuses to start a duplicate |
| Clean Ctrl-C | `SIGINT` in ICHTUS — Supervisor window | 5s drain then `terminate()` stragglers |

Logs land in `logs/<service>.log` (5 MB × 3 rotating via `RotatingFileHandler`).

Manual control:

```bash
# Start the supervisor directly (no .bat launcher)
python supervisor.py --open

# Change the status UI port
python supervisor.py --port 9100

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
| Offline Modus | Work without internet |
| NDI Auto-Discovery | Automatic NDI device scanning |
| NDI Preview Quality | Low / Medium / High |
| Tijd Formaat | 12-hour or 24-hour |
| Datum Formaat | DD-MM-YYYY or MM-DD-YYYY |
| Debug Panel | Show Firebase status & logs |

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
| **Instellingen** | App configuration and Firebase settings |
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
├── firebase-api-key.txt         # Firebase config (NOT committed to git!) used by server.py
├── Ichtus_SPA/
│   └── firebase-config.txt      # Firebase config (NOT committed to git!) auto-loaded by the browser
├── requirements.txt             # Python dependencies
│
├── .gitignore                   # Excludes: .venv/, firebase-api-key.txt
│
├── shared-assets/               # Shared branding & components
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
│   │   ├── firebase-init.js     # Firebase initialization
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
- **Firebase** (optional, for data persistence)
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

## 🔐 Firebase Configuration

The browser (`Ichtus_SPA/js/firebase-init.js`) resolves your Firebase config from any of these 4 sources, in priority order. The first one with a real `apiKey` (starting with `AIza`) wins; if none does, the setup modal asks you to paste one.

| # | Source | Where it lives | When to use |
|---|--------|---------------|-------------|
| 1 | `localStorage.firebaseConfig` | Browser storage of this OS-user, this browser | Pasted through the in-browser setup modal |
| 2 | `window.FIREBASE_CONFIG` | Injected by `server.py` if `firebase-api-key.txt` exists at the project root | Server-admin deployments / multi-tenant setups |
| 3 | `Ichtus_SPA/firebase-config.txt` | Fetched at runtime from the served directory | Single-machine manual setup — just drop the file, refresh, done |
| 4 | `FIREBASE_CONFIG` | Bundled placeholder in `Ichtus_SPA/js/firebase-config.js` | Last-resort template; usually overwritten above |

**To set up Firebase:**

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Copy your web app config from **Project Settings → Your apps → Web app**.
3. Drop it into one of the gitignored drop-in files:
   - `Ichtus_SPA/firebase-config.txt` — preferred for browser-direct/local setups
   - `firebase-api-key.txt` (project root) — used by `server.py` to inject into every served HTML page
4. Or paste through the in-browser setup screen (stored in `localStorage`).
5. Or enter values during `install.bat` setup.

The Instellingen page lets you view, edit, and reset the active config afterward.

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
- Chrome Extension: See `extensions/worshiptools-sync/README.md`

---

*For questions or issues, check the Features document or contact the developer.*