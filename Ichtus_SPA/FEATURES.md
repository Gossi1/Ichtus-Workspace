# Ichtus Workspace SPA - Feature Documentation

A comprehensive Single Page Application for church service management, featuring multiple modules for coordination, planning, and execution of worship services.

---

## Table of Contents

1. [Dashboard](#1-dashboard)
2. [Agenda Maker](#2-agenda-maker)
3. [Checklist / Command Center](#3-checklist--command-center)
4. [Patchbay - Digital Signal Routing](#4-patchbay---digital-signal-routing)
5. [Analytics - Service Tracking](#5-analytics---service-tracking)
6. [Setlist - ProPresenter Sync](#6-setlist---propresenter-sync)
7. [Global Features](#7-global-features)
8. [Chrome Extension - WorshipTools Sync](#8-chrome-extension---worshiptools-to-ichtus-sync)

---

## 1. Dashboard

### Overview
A customizable workspace dashboard providing quick access to all modules and real-time status information.

### Features

#### Widget System
- **Draggable Widgets** - Rearrange dashboard widgets by dragging and dropping
- **Widget Persistence** - Widget order and collapsed state saved to localStorage
- **Toggle Visibility** - Collapse/expand individual widgets with the −/+ button

#### Available Widgets

| Widget | Description |
|--------|-------------|
| Quick Links | Navigation shortcuts to all modules (Agenda, Checklist, Patchbay, Analytics, Setlist) |
| Service Timer | Start/Stop/Reset countdown timer with HH:MM:SS display |
| Quick Notes | Text area for temporary notes, auto-saved to localStorage |
| Workspace Status | Real-time status indicators showing which modules are loaded |

#### Timer Features
- Start/Stop/Reset controls
- Real-time display updating every 100ms
- Time persists until reset
- Visual feedback on active state

---

## 2. Agenda Maker

### Overview
A visual agenda editor that fetches events from Tockify (iCal feed) and overlays them on a customizable template image.

### Core Features

#### Event Fetching
- **Tockify Integration** - Fetches calendar events via iCal API
- **CORS Proxy Support** - Automatically tries multiple CORS proxies for reliability
- **Week Navigation** - Navigate between weeks with Previous/Next buttons
- **Week Offset Display** - Shows current week offset (e.g., Week +1, Deze Week)

#### Template Management
- **Image Upload** - Load custom background template images
- **Position Persistence** - Template position saved to localStorage
- **Draggable Overlay** - Move the agenda text overlay via drag
- **PNG Export** - Download the final composed image

#### Event Display
- **4-Column Layout** - Date | Divider | Time | Event columns
- **Inline Editing** - All text fields are contentEditable for quick edits
- **Hide Speakers Option** - Toggle visibility for Sunday morning speaker names
- **Custom Label Override** - Replace speaker names with custom text (e.g., EREDIENST)

#### Event Management
- **Visibility Toggle** - Show/hide individual events via checkboxes
- **Manual Swap** - Click event titles to toggle custom label override
- **Hidden Events Persistence** - Hidden event IDs saved to localStorage

#### Position Display
- Real-time X/Y coordinates displayed during drag operations
- Default position: X=110, Y=290 (restored on page load)

---

## 3. Checklist / Command Center

### Overview
A role-based task management system for coordinating church service preparation among different teams.

### Role Selection

| Role | Description | View |
|------|-------------|------|
| Coördinator | Full admin access with all controls | Admin sidebar + Master sidebar |
| Beamer Team | Beamer-specific tasks only | Task list filtered by team |
| Worship Team | Worship-specific tasks only | Task list filtered by team |

### Task Features

#### Task Configuration
- **Minutes Before** - Each task has a deadline relative to service start time
- **Team Assignment** - Tasks tagged as Beamer or Worship
- **Dynamic Timer** - Real-time countdown showing time until each task's deadline

#### Visual States
- **Upcoming (Yellow)** - Task due within 10 minutes
- **Overdue (Red + Pulse)** - Past deadline, not completed
- **Completed (Green)** - Checkbox checked

#### Task Management Modal
- Add new tasks with name, time, and team
- Edit existing task properties inline
- Delete tasks with confirmation
- Reorder by minutes before

#### Preset System
- **Multiple Presets** - Save different task configurations
- **Duplicate Preset** - Copy existing preset to modify
- **Rename Preset** - Customize preset names
- **Delete Preset** - Remove presets (keeps at least one)
- **Persistence** - All presets saved to Firebase/localStorage

### Admin Features

#### Start Date/Time
- Date picker for service date
- Time picker for service start time
- Both sync to Firebase for team visibility

#### Broadcast System
- **Quick Notes** - Send text messages to all teams
- **Popup Alerts** - Optional popup modal for important messages
- **Auto-dismiss** - Alerts clear when new note is broadcast

#### Progress Tracking
- Real-time progress bars for Beamer and Worship teams
- Percentage completion calculated from task count
- Master sidebar shows overall progress

### Firebase Integration
- Real-time sync across multiple devices
- Active state stored in Firestore collection 'commandCenter'
- History archived to 'commandCenterHistory' on reset

---

## 4. Patchbay - Digital Signal Routing

### Overview
A visual node-based interface for planning and documenting signal routing between AV equipment.

### Canvas Features

#### Node Management
- **Add Nodes** - Click to create new device nodes at cursor position
- **Edit Nodes** - Double-click or use context menu to modify node properties
- **Delete Nodes** - Remove with confirmation (also deletes connected cables)
- **Multi-select** - Rectangle selection (marquee) to select multiple nodes
- **Bulk Delete** - Press Delete key to remove all selected nodes

#### Node Properties
- **Title** - Device name displayed in header
- **IP/Subtext** - Secondary information line
- **Inputs** - Array of input port names
- **Outputs** - Array of output port names

#### Connection Management
- **Create Connections** - Drag from output port to input port
- **Edit Connections** - Click connection to open cable configuration
- **Delete Connections** - Click trash icon with confirmation
- **Reconnect** - Drag connection endpoints to re-route

#### Cable Types
- **Video** - HDMI, DisplayPort, SDI (Purple cables)
- **Audio** - XLR, Jack 6.3mm, Jack 3.5mm, Speakon (Green cables)
- **Network** - Ethernet, NDI, Dante (Blue cables)
- **Data & Power** - USB-C, USB-A, PowerCON, IEC, Schuko
- **Lighting** - DMX (Orange cables)

### Navigation & View

#### Pan & Zoom
- **Pan Tool** - Click and drag to move canvas
- **Zoom** - Mouse wheel to zoom in/out (0.2x to 3x)
- **Fit All** - Button to fit all nodes in view
- **Reset View** - Return to default zoom/position

#### Transform System
- CSS transform-based scaling and translation
- All coordinates scaled proportionally

### Sidebar Features

#### Multi-Canvas Support
- **Groups/Folders** - Organize canvases by category
- **Add Canvas** - Create new canvas in current group
- **Add Folder** - Create new group
- **Switch Canvas** - Click to switch between canvases
- **Edit Mode** - Toggle to allow drag-reorder and delete

#### Canvas Operations
- **Copy** - Copy canvas to clipboard
- **Paste** - Paste clipboard contents onto canvas
- **Duplicate** - Create exact copy of canvas
- **Rename** - Inline editing of canvas names
- **Delete** - Remove with confirmation
- **Import** - Import canvas(s) from .ichtus-folder.json or legacy .json files
- **Export All Canvases** - Download all canvases as single .ichtus-folder.json file
- **Export Canvas** - Export current canvas as .ichtus-folder.json file

### Clipboard & Copy-Paste
- Copy selected nodes with all connections
- Paste nodes with automatic ID regeneration
- Offset pasted nodes to avoid overlap
- Paste as new canvas from clipboard

### Context Menus
- **Canvas Right-click** - Add Node, Paste, Copy Canvas, Export Canvas
- **Node Right-click** - Edit Node, Delete Node
- **Sidebar Right-click** - Copy, Export, Duplicate, Rename, Delete, New Canvas/Folder, Import..., Export All...

### Keyboard Shortcuts
- **Delete/Backspace** - Delete selected nodes
- **Escape** - Clear selection
- **Tab** - Focus canvas container

### Touch Support
- Single finger drag for nodes and connections
- Pinch to zoom (two fingers)
- Touch-optimized event handling

---

## 5. Analytics - Service Tracking

### Overview
Automatic service duration tracking via ProPresenter look changes, with planned vs. actual comparisons.

### ProPresenter Integration

#### Connection
- Connects to ProPresenter API at configurable IP:Port
- Polls every 1 second for current look
- Automatic macro trigger on service start (Welkom macro)

#### Service Sequence Configuration
- Define expected looks in order
- Set planned duration for each look (seconds)
- Remove items from sequence with confirmation

### Tracking Features

#### Auto-Start System
- Schedule service to start at specific time
- Triggers both macro and tracking simultaneously
- Cancel scheduled start option

#### Session Tracking
- **Total Service Time** - Running timer from start
- **Total Overage** - Accumulated time over planned duration
- **Items Tracked** - Count of looks processed

#### Session Log Table
| Column | Description |
|--------|-------------|
| Look Name | Name of the look from ProPresenter |
| Planned | Configured expected duration |
| Actual | Measured time from look changes |
| Diff +/- | Over/under time (green = under, red = over) |
| Avg SPL | Placeholder for audio level data |
| Peak SPL | Placeholder for audio level data |

#### Auto-End
- Detects when ProPresenter shows 'Einde' look
- Automatically ends tracking session

### Data Management

#### Export to CSV
- Download session data as CSV file
- Includes all tracked metrics

#### Import from CSV
- Load previous session data for review
- Parses and reconstructs session log

---

## 6. Setlist - ProPresenter Sync

### Overview
Native ProPresenter integration for creating and managing service playlists, with automatic song matching.

### WorshipTools Integration

#### Chrome Extension Bridge
- Receives setlist data from WorshipTools Chrome Extension
- Custom event-driven communication via DOM events
- Persists received setlist to localStorage

#### Setlist Reception
- Extracts songs from raw text format
- Categorizes into: Opening, Praise & Worship, Closing
- Displays service date when available

### ProPresenter Sync

#### Library Integration
- Fetches ProPresenter library by UUID
- Maps song names to presentation UUIDs

#### Template System
Pre-configured templates for different service types:

| Template | Description |
|----------|-------------|
| ZondagDienst | Standard Sunday service with announcements |
| Worship Avond | Evening worship focused |
| DoopDienst | Baptism service with additional songs |
| Delighted Youth | Youth service with announcements |

#### Template Editor
- Create custom templates
- Define item order with drag-reorder
- Set header colors (RGB)
- Configure song insert points
- Specify ProPresenter destination (presentation/announcements)

#### Sync Process
1. Fetch ProPresenter library
2. Match setlist songs to library items
3. Create new playlist in ProPresenter
4. Add template items with matched songs

### Connection Testing
- Manual connection test button
- Auto-test on first load
- Status indicator (online/offline/warning)

### Error Handling
- Shows matched vs. unmatched song count
- Warnings for songs not found in library
- Detailed error messages for sync failures

---

## 7. Global Features

### Navigation

#### Sidebar Menu
- Collapsible sidebar with icon + text navigation
- Active state highlighting
- Mobile hamburger menu for smaller screens

#### View Routing
- SPA-style navigation without page reloads
- Module initialization on view activation
- State persistence between view switches

### Firebase Integration

#### Cloud Sync
- Firestore integration for real-time data sync
- Offline capability with localStorage fallback
- History archiving for analytics data

#### Per-Module Collections
| Module | Collection/Doc | Writes | Reads |
|--------|----------------|--------|-------|
| Checklist / Command Center | `commandCenter/activeState` | `.set(updates, {merge:true})` on every `syncState()` | `onSnapshot` live listen on init |
| Checklist / Command Center | `commandCenterHistory` (collection) | `.add()` on **Reset & Archiveer** | none |
| Dashboard | `dashboard/state` | `.set()` for cloud-synced layout | `.get()` on init |
| Patchbay | `patchbay/projects` | `.set()` for canvas sync | `.get()` on init |
| Dashboard (mic monitor) | `mic_monitor/live_status` | `.set()` on each IEM/mic assignment | `onSnapshot` OR Realtime-DB fallback |

#### Configuration (auto-load chain)
The browser resolves the Firebase config from any of these 4 sources, in priority order. The first one with a real `apiKey` (starting with `AIza`) wins; if none does, the in-page setup modal asks the user to paste one.

| # | Source | Where it lives | When to use |
|---|--------|---------------|-------------|
| 1 | `localStorage.firebaseConfig` | Browser storage of this OS-user, this browser | Pasted through the in-browser setup modal |
| 2 | `window.FIREBASE_CONFIG` | Injected by `server.py` if `firebase-api-key.txt` exists at the project root | Server-admin / multi-tenant deployments |
| 3 | `Ichtus_SPA/firebase-config.txt` | Fetched at runtime from the served directory | Single-machine manual setup — drop the file, refresh, done |
| 4 | `FIREBASE_CONFIG` | Bundled placeholder in `Ichtus_SPA/js/firebase-config.js` | Last-resort template; usually overwritten above |

Supported formats inside the drop-in files: JSON object (`{ "apiKey": "...", ... }`) **or** key:value lines (`apiKey: "…"`), matching the parser in `server.py`. Both file paths are gitignored so real secrets never land in the repo.

### Fullscreen Mode
- Global fullscreen toggle button
- Individual module fullscreen support (Analytics)

### LocalStorage Persistence
- Dashboard widget order and collapsed state
- Agenda template and position
- Checklist presets and active state
- Patchbay projects and current canvas
- Service sequence configuration
- Setlist templates and received data
- `firebaseConfig` — active Firebase web-app config pasted through the in-browser setup modal (auto-detected by `firebase-init.js` as the highest-priority source)

### Responsive Design
- Mobile-friendly sidebar with hamburger menu
- Touch support for Patchbay interactions
- Responsive widgets on dashboard

---

## Technical Architecture

### Module Structure
Each module follows a consistent pattern:
- `initialized` flag prevents double initialization
- `init()` method for setup
- `_lastView` tracking for view changes
- State management via closure or global state object

### State Management
- Central `appState` object in state.js
- Module-specific state extensions
- localStorage sync on changes
- Optional Firebase real-time sync

### File Structure
```
Ichtus_SPA/
├── index.html                # Main HTML with all views
├── css/
│   └── style.css             # Application styles
├── js/
│   ├── app.js                # Application entry point
│   ├── router.js             # View routing system
│   ├── state.js              # Global state management
│   ├── firebase-init.js      # Firebase initialization
│   ├── vendor/
│   │   └── ical.min.js       # ICAL parser for agenda module
│   └── modules/
│       ├── dashboard.js      # Dashboard widget system
│       ├── agenda.js         # Agenda maker module
│       ├── checklist.js      # Command center module
│       ├── patchbay.js       # Digital patchbay module
│       ├── analytics.js      # Service tracking module
│       └── setlist.js        # ProPresenter sync module
└── data/
    └── patchbay-data.json    # Default patchbay data
```

---

## Keyboard Shortcuts

| Shortcut | Module | Action |
|----------|--------|--------|
| Delete/Backspace | Patchbay | Delete selected nodes |
| Escape | Patchbay | Clear selection |
| Enter | Various | Confirm inline edits |
| Escape | Checklist | Close preset dropdown |

---

## 8. Chrome Extension - WorshipTools to Ichtus Sync

### Overview
A Chrome browser extension (Manifest V3) that bridges data from WorshipTools Planning to the Ichtus Workspace SPA Setlist module.

### Architecture
```
WorshipTools Tab ──▶ Background Script ──▶ Ichtus SPA Tab
   content.js          background.js         spa-bridge.js
```

### Extension Files
| File | Description |
|------|-------------|
| `manifest.json` | Extension manifest (Manifest V3), v1.1 |
| `background.js` | Service worker for message relay between tabs |
| `content.js` | Runs on WorshipTools pages, extracts setlists |
| `spa-bridge.js` | Runs on Ichtus SPA, converts messages to DOM events |

### Features

#### Setlist Extraction (content.js)
- **Auto-injected Button** - Orange "Extract Setlist" button appears on WorshipTools pages
- **Date Detection** - Parses Dutch dates (e.g., "zondag 3 mei 2026")
- **Song Scraping** - Multiple CSS selectors for reliability
- **Data Cleaning** - Removes durations, keys, conversational fragments
- **Clipboard Backup** - Also copies to clipboard as backup

#### Message Relay (background.js)
- Relays setlist to all open Ichtus SPA tabs
- Stores latest setlist in memory for retrieval
- Handles GET_LAST_SETLIST requests

#### SPA Bridge (spa-bridge.js)
- Converts Chrome messages to `worshiptools-setlist` CustomEvent
- Listens for `ichtus-setlist-ready` signal to prevent race conditions
- Caches data for re-dispatch on view navigation

### Installation
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extensions/worshiptools-sync/` folder

### Permissions
- `activeTab`, `clipboardWrite`, `tabs`
- Host access: `*://*.worshiptools.com/*`

---

*Documentation generated for Ichtus Workspace SPA*