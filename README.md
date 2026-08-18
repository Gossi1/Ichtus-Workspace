# Ichtus Workspace

Church service management Single Page Application (SPA) for coordinating worship services.

---

## 🛠️ Install on a Windows PC

> **Prerequisites:** Windows 10 / 11 (64-bit). Admin PowerShell (run *Windows PowerShell* via *Run as administrator*).

### ⚡ One-command install *(recommended)*

Open **PowerShell as Administrator**, then paste exactly **one** line. The script handles Git + Node.js installation, cloning, `npm install`, NSSM download and Windows-service registration — no further input needed.

```powershell
irm https://raw.githubusercontent.com/Gossi1/Ichtus-Workspace/master/setup.ps1 | iex
```

No Git installed yet? That's fine — the script installs it (and Node.js LTS) automatically via `winget` on Windows 10/11.

Once you see **`INSTALLATIE VOLTOOID`** at the bottom of the output, the server is live at:

```
http://localhost:8080/Ichtus_SPA/
```

The Windows service **`IchtusServer`** will now start with Windows and restart itself after crashes.

> **Prefer double-clicking a file?** Right-click and save the link below as `setup.bat`, then double-click it. It does the same thing via the same GitHub-hosted script:
>
> [⬇ setup.bat](https://raw.githubusercontent.com/Gossi1/Ichtus-Workspace/master/setup.bat)

### 🪜 Manual steps (fallback)

Volg deze stappen alleen als de one-liner hierboven niet werkt (bijv. winget ontbreekt, GitHub geblokkeerd op het netwerk, of je liever stap-voor-stap werkt). Alles wat hieronder staat, doet het one-liner-script ook automatisch.

---

#### Step 1 — Install Git *(skip this step if you'll download the ZIP)*

Git is needed only if you want to pull updates later instead of re-downloading the ZIP each time.

```cmd
winget install --id Git.Git -e --source winget
```

If `winget` is missing: download the installer from <https://git-scm.com/download/win> and run it (next → next → finish, accept defaults).

Verify in a fresh Command Prompt:
```cmd
git --version
```

---

#### Step 2 — Install Node.js LTS *(required)*

The server runs on Node.js 18 or newer.

```cmd
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

If `winget` is missing: download the LTS installer from <https://nodejs.org/> and run it (next → next → finish, **enable "Add to PATH"** which is on by default).

**Open a fresh Command Prompt** (so the new PATH is picked up) and verify:
```cmd
node --version    :: should print v18.x.x or higher
npm --version
```

---

#### Step 3 — Get the code

Pick one of the two options below.

#### Option A — Clone with Git *(recommended: lets you pull future updates)*

```cmd
cd C:\
git clone https://github.com/Gossi1/Ichtus-Workspace.git C:\Ichtus_apps
cd C:\Ichtus_apps
```

#### Option B — Download ZIP *(no Git required)*

1. Open <https://github.com/Gossi1/Ichtus-Workspace> in a browser.
2. Click **Code → Download ZIP**.
3. Extract the ZIP contents into `C:\Ichtus_apps\` (you should see `install-service.bat`, `package.json`, `src\`, … directly inside the folder).
4. Open a **Command Prompt** in `C:\Ichtus_apps\`: right-click the folder in Explorer → *Open in Terminal* / *Open Command Prompt here*.

> Going forward, all commands assume your current directory is the project root (`C:\Ichtus_apps`).

---

#### Step 4 — Install JavaScript dependencies

```cmd
npm install
```

This downloads Express, Firebase Admin, `ws`, etc. into `node_modules\`. Takes 1–2 minutes. You only re-run this if `package.json` changes (e.g. after `git pull`).

---

#### Step 5 — Add Firebase config *(optional, for cloud data sync)*

The app works fully offline if you skip this step — a setup modal will ask for your config on first launch and store it in browser `localStorage`.

If you already have a Firebase project (or want to copy config from another installation), pick one of:

- Drop a `firebase-api-key.txt` into the project root — the server injects it into every served HTML page.
- Drop `Ichtus_SPA\firebase-config.txt` — the browser fetches it at runtime.

Both files are gitignored, so secrets never accidentally leak.

---

#### Step 6 — Configure NSSM service

Copy the example config and edit it:

```cmd
copy nssm-service.example.json nssm-service.json
```

Open `nssm-service.json` in Notepad and adjust at least these:

| Key | What to put |
|-----|-------------|
| `stdoutLog` / `stderrLog` | Where NSSM writes server logs (default: `C:\Ichtus_apps\logs\…`) |
| `env.PORT` | TCP port for the SPA + API (default: `8080`) |
| `env.X32_IP` | IP of your Behringer X32 mixer on the LAN |
| `nssmPath` | Leave empty to auto-download, or set to e.g. `C:\Program Files\nssm\win64\nssm.exe` |

> `nssm-service.json` itself is gitignored — your local paths stay private.

---

#### Step 7 — Register the Windows service

```cmd
install-service.bat
```

This single command:

1. Verifies Node.js is installed.
2. Looks for NSSM in this order: `nssm-service.json → nssmPath` → on `PATH` → previously downloaded `nssm_temp\`.
3. **If NSSM isn't found anywhere, it offers to download NSSM 2.24 (~300 KB) into the project's `nssm_temp\` folder.** Answer `J` to accept. Internet access required.
4. Registers the Windows service `IchtusServer` with auto-start, restart-on-crash, log rotation.
5. Starts the service immediately.

When you see **`[OK] Service gestart`**, open in a browser:

```
http://localhost:8080/Ichtus_SPA/
```

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

Or use the in-app **Supervisor** tab, which does `git pull` + restart with one click.

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

You can inspect or remove the entries any time with:

```cmd
git config --global --get-all safe.directory
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