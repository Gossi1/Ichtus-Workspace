# Ichtus Workspace

Church service management Single Page Application (SPA) for coordinating worship services.

## Quick Start

### 1. Start the Server

**Windows (double-click):**
```
start-server.bat
```

**Or manually:**
```bash
python server.py --open
```

### 2. Open in Browser

Navigate to: http://localhost:8080/Ichtus_SPA/

---

## Features

| Module | Description |
|--------|-------------|
| **Dashboard** | Customizable widgets, timer, notes |
| **Agenda Maker** | Visual agenda editor with Tockify calendar integration |
| **Command Center** | Task management with role-based assignments |
| **Patchbay** | Digital signal routing canvas for A/V setup |
| **Analytics** | Service sequencing and tracking |
| **Setlist** | ProPresenter integration with WorshipTools sync |

---

## Requirements

- **Python 3.8+** (for local dev server)
- **Chrome** browser (recommended)
- **Firebase** (optional, for data persistence)

---

## Project Structure

```
Ichtus_apps/
├── README.md                    # This file
├── server.py                    # Local HTTP server
├── start-server.bat             # Windows launcher
│
├── shared-assets/               # Shared branding & components
│   ├── css/branding.css
│   ├── fonts/
│   └── js/
│
├── Ichtus_SPA/                  # Main SPA application
│   ├── index.html
│   ├── css/style.css
│   ├── js/                      # App modules
│   └── data/                    # Sample data
│
└── extensions/                  # Browser extensions
    └── worshiptools-sync/       # Chrome extension for setlist import
```

---

## Browser Extension (Optional)

The WorshipTools Sync extension imports setlists from WorshipTools Planning.

**Installation:**
1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `extensions/worshiptools-sync/`

---

## Development

### Server Options

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

## Documentation

- [Feature Overview](Ichtus_SPA/FEATURES.md)
- Chrome Extension: See `extensions/worshiptools-sync/README.md`

---

*For questions or issues, check the Features document or contact the developer.*