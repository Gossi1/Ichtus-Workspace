# Ichtus Workspace

Church service management Single Page Application (SPA) for coordinating worship services.

---

## 🚀 Quick Start (New Installation)

### On a NEW PC:

#### Option A: Using Git (recommended)

**1. Install Git** (if not already installed)
   ```cmd
   winget install --id Git.Git -e --source winget
   ```
   Or download from [git-scm.com/download/win](https://git-scm.com/download/win).

**2. Clone the repository**
   ```bash
   git clone https://github.com/Gossi1/Ichtus-Workspace.git
   cd Ichtus_apps
   ```

#### Option B: Without Git (Download ZIP)

1. Go to [github.com/Gossi1/Ichtus-Workspace](https://github.com/Gossi1/Ichtus-Workspace) in your browser
2. Click **Code** → **Download ZIP**
3. Extract the ZIP to a folder (e.g. `C:\Ichtus_apps\`)
4. Open a **Command Prompt** in that folder and continue below

**Then, continue with:**

- **Copy your Firebase config** (optional — enables data sync)
   - Either copy an existing `firebase-api-key.txt` from another installation into the project root
   - Or paste your Firebase web-app config straight into `firebase-api-key.txt` — the server injects it into HTML on page boot
   - File is excluded from git (.gitignore) for security

- **Install dependencies**
   ```bash
   npm install
   ```

- **Start the server**
   ```bash
   start-server.bat
   ```
   Or directly:
   ```bash
   node src/server.js
   ```

- **Open in browser**
   ```
   http://localhost:8080/Ichtus_SPA/
   ```

---

## 🪟 Auto-start with NSSM

Want the server to **start automatically and restart on crashes** as a proper Windows service?

**1. Install NSSM** (if not already present)
   Download from [nssm.cc/download](https://nssm.cc/download) and extract
   `nssm.exe` to `C:\Program Files\nssm\win64\` (or somewhere on `PATH`).

**2. Create your local service config**
   ```cmd
   copy nssm-service.example.json nssm-service.json
   ```
   Edit `nssm-service.json` to match your install paths, port, X32 IP, etc.

**3. Run the installer**
   ```cmd
   install-service.bat
   ```
   This registers a Windows service called `IchtusServer` (auto-start, log
   rotation, restart-on-crash) and starts it immediately.

### NSSM Management

| Action | Command |
|--------|---------|
| Check status | `nssm status IchtusServer` |
| View logs | open the paths set in `stdoutLog` / `stderrLog` |
| Restart | `nssm restart IchtusServer` |
| Stop | `nssm stop IchtusServer` |
| Open config GUI | `nssm edit IchtusServer` |
| Remove | run `uninstall-service.bat` |

### Service URLs

| Service | URL |
|---------|-----|
| **SPA** (Ichtus Workspace) | `http://localhost:8080/Ichtus_SPA/` |
| **Health check** | `http://localhost:8080/api/health` |
| **Status + logs** | `http://localhost:8080/api/status` |
| **WebSocket** | `ws://localhost:8080/ws` |

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
- SPA HTTP server + Firebase config injection
- X32 OSC bridge (UDP :10023)
- Mic/IEM monitor (Firestore)
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
| Mic/IEM roster | `POST /api/iem/update-roster` | WorshipTools → Firestore live sync |
| Git update check | `GET /api/check-update` | Compares HEAD with origin |
| WebSocket | `ws://localhost:8080/ws` | Realtime X32 + IEM status push |

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
| **Settings** | App configuration and Firebase settings |
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