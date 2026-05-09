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
   - If you have an existing `firebase-api-key.txt` from another installation, copy it here
   - If not, you'll enter Firebase values during `install.bat` setup
   - The file is excluded from git (.gitignore) for security

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

## 💻 For Existing Setup

Just run:
```bash
start-server.bat
```

Or manually:
```bash
python server.py --open
```

---

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
├── server.py                    # Local HTTP server
├── start-server.bat             # Windows launcher
├── firebase-api-key.txt         # Firebase config (NOT committed to git!)
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

Your Firebase config is stored in `firebase-api-key.txt` (excluded from git).

**To set up Firebase:**
1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Copy your web app config to `firebase-api-key.txt`
3. Or enter values during `install.bat` setup

The Settings page (Instellingen) allows you to view and edit Firebase config after installation.

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