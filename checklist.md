# Checklist Module — Complete Rebuild Documentation

This document describes the full Ichtus Checklist Module as implemented in the SPA. Use this to rebuild the module from scratch.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      Ichtus SPA Architecture                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  index.html  ──── <base href='/Ichtus_SPA/'> ──── server.py     │
│       │                                                          │
│       ├── css/style.css       (all component styles)             │
│       ├── shared-assets/      (branding.css, sidebar.js)         │
│       │                                                          │
│       └── js/                                                     │
│           ├── app.js          (entry point, globals)              │
│           ├── firebase-init.js(Firebase init, auth, setup)       │
│           ├── state.js        (appState, load/save, migration)   │
│           ├── router.js       (SPA hash router)                  │
│           └── modules/                                             │
│               ├── checklist.js    ★ MAIN MODULE                  │
│               ├── agenda.js                                       │
│               ├── patchbay.js                                     │
│               ├── analytics.js                                    │
│               ├── setlist.js                                      │
│               ├── dashboard.js                                    │
│               ├── ndi.js                                          │
│               └── settings.js                                     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Size | Purpose |
|------|------|---------|
| `Ichtus_SPA/js/modules/checklist.js` | 1701 lines | Main checklist module — ALL logic |
| `Ichtus_SPA/js/state.js` | 258 lines | Global state, defaults, migration |
| `Ichtus_SPA/js/router.js` | 128 lines | SPA hash routing |
| `Ichtus_SPA/js/app.js` | 44 lines | Entry point + globals |
| `Ichtus_SPA/index.html` | 852 lines | DOM structure for all views |
| `Ichtus_SPA/css/style.css` | 4465 lines | All styles including checklist |
| `Ichtus_SPA/js/firebase-init.js` | 276 lines | Firebase init + auth screens |
| `server.py` | ~400 lines | Python HTTP server |

### Initialization Flow

1. `index.html` loads scripts in order:
   - `shared-assets/js/sidebar.js` — Ichtus sidebar
   - `js/state.js` — Loads `appState` from localStorage + migration
   - `js/modules/checklist.js` — Defines `checklistModule` object
   - `js/modules/agenda.js`, `patchbay.js`, etc. — Other modules
   - `js/router.js` — Defines `router` object
   - `js/app.js` — Makes modules global (`window.checklistModule = checklistModule`)
   - `js/firebase-init.js` — Firebase init (async, runs immediately via IIFE)

2. `DOMContentLoaded` → `router.init()` → navigates to default view (`dashboard` or from hash)

3. Router calls `router.navigate(view)`:
   - Hides all `.app-view` elements
   - Shows target view by ID (`#view-checklist`)
   - Calls `checklistModule.init()` for checklist view

4. `checklistModule.init()`:
   - Skips if already initialized (idempotent via `this.initialized`)
   - Updates form fields from state
   - Calls `setupEventListeners()` for DOM events
   - Calls `_setupContextMenuListeners()` for context menus
   - Starts 1-second timer via `setInterval` that calls `updateTimersAndColors()` every second
   - Sets up Firebase `onSnapshot` listener (if Firebase enabled)
   - Calls `processStateChange()`, `renderTaskManageList()`, `renderChecklistOverview()`, `_renderTagFilters()`

---

## 2. Data Model

### Complete State Schema (`appState` defined in `state.js`)

```javascript
const appState = {
    // Current user role
    role: null,  // 'Admin' | 'Beamer' | 'Worship' | null

    // Checklist state
    checklist: {
        // Service info
        serviceDate: "2025-05-18",          // ISO date string
        serviceTime: "10:00",               // HH:MM format

        // Active preset
        currentPreset: "Standaard Dienst",  // name of active preset

        // All presets — key = preset name, value = array of checklists
        presets: {
            "Standaard Dienst": [ /* Checklist[] */ ],
            "Doopdienst": [ /* Checklist[] */ ]
        },

        // Global tags — shared across all presets
        tags: {
            "tag_audio":    { id, name, icon, color, sortOrder },
            "tag_text":     { id, name, icon, color, sortOrder },
            "tag_beeld":    { id, name, icon, color, sortOrder },
            "tag_techniek": { id, name, icon, color, sortOrder }
        },

        // Quick note / broadcast
        quickNote: { text: "", isPopup: false, timestamp: 0 },

        // Detail view state (stack navigation)
        activeView: "overview",             // "overview" | "detail"
        activeChecklistId: null,            // ID of open checklist in detail view
        _savedScrollPos: 0,                 // Scroll position preservation

        // Active tag filter
        _activeTagFilter: null              // tag ID or null
    },

    // Agenda state
    agenda: {
        weekOffset: 0,
        allEvents: [],
        hideSpeakers: true,
        customLabel: "EREDIENST",
        hiddenEvents: [],
        swappedEvents: []
    }
};
```

### Checklist Data Structure

```javascript
// A checklist — a named group of items
{
    id: "cl_techniek",                     // Unique ID (cl_ prefix)
    name: "Techniek",                      // Display name
    icon: "⚡",                             // Emoji icon
    collapsed: true,                       // Collapsed state in overview
    items: [ /* Item[] */ ],               // Array of items
    tagId: "",                             // Optional tag association
    dueDate: "2025-05-18",                 // Optional due date
    dueTime: "10:00",                      // Optional due time
    repeat: "none"                         // "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly"
}
```

### Item Data Structure

```javascript
{
    id: "itm_t1",                          // Unique ID (itm_ prefix)
    name: "Projectoren aan",               // Item name
    completed: false,                      // Checkbox state
    assignedTo: "Beamer",                  // Team assignment
    dueBefore: 40,                         // Minutes before service start
    tagIds: []                             // Array of tag IDs
}
```

### Tag Data Structure

```javascript
{
    id: "tag_audio",                       // Unique ID (tag_ prefix)
    name: "Audio",                         // Display name
    icon: "🎤",                            // Emoji icon
    color: "#f47920",                      // Hex color
    sortOrder: 0                           // Sort priority
}
```

### Default Presets (`defaultNewPresets` in `state.js`)

```javascript
const defaultNewPresets = {
    'Standaard Dienst': [
        {
            id: 'cl_techniek', name: 'Techniek', icon: '⚡', collapsed: true,
            items: [
                { id: 'itm_t1', name: 'Projectoren aan', completed: false, assignedTo: 'Beamer', dueBefore: 40, tagIds: [] },
                { id: 'itm_t2', name: 'Lobby NDI Feed checken', completed: false, assignedTo: 'Beamer', dueBefore: 30, tagIds: [] },
                { id: 'itm_t3', name: 'Lichtplan laden', completed: false, assignedTo: 'Beamer', dueBefore: 20, tagIds: [] }
            ]
        },
        {
            id: 'cl_worship', name: 'Worship', icon: '🎸', collapsed: true,
            items: [
                { id: 'itm_w1', name: 'Soundcheck & In-ears', completed: false, assignedTo: 'Worship', dueBefore: 60, tagIds: [] },
                { id: 'itm_w2', name: 'Lyrics syncen', completed: false, assignedTo: 'Worship', dueBefore: 20, tagIds: [] },
                { id: 'itm_w3', name: 'Band klaar op podium', completed: false, assignedTo: 'Worship', dueBefore: 2, tagIds: [] }
            ]
        },
        {
            id: 'cl_livestream', name: 'Livestream', icon: '📹', collapsed: true,
            items: [
                { id: 'itm_v1', name: 'Lower thirds test', completed: false, assignedTo: 'Stream', dueBefore: 15, tagIds: [] },
                { id: 'itm_v2', name: 'Stream starten', completed: false, assignedTo: 'Stream', dueBefore: 5, tagIds: [] },
                { id: 'itm_v3', name: 'Audio levels check', completed: false, assignedTo: 'Stream', dueBefore: 10, tagIds: [] }
            ]
        },
        {
            id: 'cl_algemeen', name: 'Algemeen', icon: '📋', collapsed: true,
            items: [
                { id: 'itm_a1', name: 'Welkomstlogo op scherm', completed: false, assignedTo: 'Media', dueBefore: 5, tagIds: [] },
                { id: 'itm_a2', name: 'Koffie & water klaar', completed: false, assignedTo: 'Algemeen', dueBefore: 15, tagIds: [] }
            ]
        }
    ],
    'Doopdienst': [
        {
            id: 'cl_doop_default', name: 'Doopdienst', icon: '⚗️', collapsed: true,
            items: [
                { id: 'itm_d1', name: 'Doopnamen voorbereiden', completed: false, assignedTo: 'Beamer', dueBefore: 25, tagIds: [] },
                { id: 'itm_d2', name: 'Handdoeken & Microfoon', completed: false, assignedTo: 'Worship', dueBefore: 15, tagIds: [] }
            ]
        }
    ]
};
```

### Default Tags (`defaultTags` in `state.js`)

```javascript
const defaultTags = {
    'tag_audio':    { id: 'tag_audio',    name: 'Audio',     icon: '🎤', color: '#f47920', sortOrder: 0 },
    'tag_text':     { id: 'tag_text',     name: 'Tekst',     icon: '📄', color: '#3b82f6', sortOrder: 1 },
    'tag_beeld':    { id: 'tag_beeld',    name: 'Beeld',     icon: '🖼️', color: '#22c55e', sortOrder: 2 },
    'tag_techniek': { id: 'tag_techniek', name: 'Techniek',  icon: '⚙️', color: '#6b7280', sortOrder: 3 }
};
```

---

## 3. State Management (`state.js`)

### localStorage Keys

| Key | What it stores | Format |
|-----|---------------|--------|
| `ichtus_checklist_newstate` | Full checklist state (new format) | `JSON.stringify(appState.checklist)` |
| `ichtus_checklist_state` | OLD format (legacy, migrated on load) | Flat tasks array |
| `ichtus_agenda_state` | Agenda state subset | `{ weekOffset, hiddenEvents, swappedEvents }` |
| `ichtus_hide_speakers` | Boolean string | `"true"` / `"false"` |
| `ichtus_custom_label` | String | e.g. `"EREDIENST"` |
| `firebaseConfig` | Firebase config JSON | `{ apiKey, authDomain, ... }` |

### `loadState()` — Called at module level on script load

Priority order:
1. Try `ichtus_checklist_newstate` (new format) — merge into defaults
2. If not found, try `ichtus_checklist_state` (old format) → run `migrateOldFormat()`
3. If still no presets, try old format as fallback
4. Ensures presets, tags, currentPreset all have valid values
5. Fixes backward compat: "Standard" → "Standaard Dienst", "Baptism" → "Doopdienst"
6. Loads agenda state

### `saveState()` — Persists to localStorage

Saves `appState.checklist` and `appState.agenda` to their respective keys.

### `migrateOldFormat(oldState)` — Converts flat tasks to checklists

- Detects old format: checks if `presets[presetName]` contains flat tasks (no `.items` on first element)
- Wraps all tasks per preset into one checklist named "Taken" with id `cl_default_{presetName}`
- Migrates `tasksState` → `item.completed` on each item
- Renames: `preset` → `currentPreset`, `startDate` → `serviceDate`, `startTime` → `serviceTime`
- Ensures `tags`, `activeView`, `activeChecklistId`, `quickNote` exist

---

## 4. Checklist Module — Complete Function Reference

The module is defined as a singleton object: `const checklistModule = { ... }`

### 4.1 Lifecycle

| Method | Line | Description |
|--------|------|-------------|
| `init()` | 11 | Initialize module. Idempotent (checks `this.initialized` + `this._lastView`). Sets up forms, event listeners, timer, Firebase sync, renders overview. |
| `setupEventListeners()` | 101 | Binds all DOM event listeners (date/time/preset inputs, notes, reset, modals, task CRUD). |
| `_setupContextMenuListeners()` | 1674 | One-time setup for closing context menus on outside click and Escape key. |

### 4.2 State & Sync

| Method | Line | Description |
|--------|------|-------------|
| `syncState(updates)` | 314 | Merges updates into `appState.checklist`, syncs `currentPreset` with `preset`, saves to localStorage, calls `processStateChange()` + `updateTimersAndColors()`, syncs to Firebase. |
| `_syncChecklistState()` | 546 | Calls `saveState()` from state.js + `processStateChange()`. Used for checklist-specific state changes. |
| `processStateChange()` | 334 | Updates form fields (date, time, preset) if not focused, calls `renderTaskDOM()`, `renderProgressBars()`, `handleNotes()`. |
| `_escapeHtml(str)` | 508 | Sanitizes strings for HTML insertion using DOM text node. |
| `_getChecklists()` | 516 | Returns current preset's checklist array (supports both `currentPreset` and legacy `preset`). |
| `_getTags()` | 522 | Returns sorted array of all tags from `appState.checklist.tags`. |
| `_formatDueDateLabel(dueDate)` | 527 | Formats ISO date string to Dutch short format (e.g., "18 mei"). |
| `_repeatLabel(repeat)` | 536 | Returns Dutch label for repeat frequency value. |

### 4.3 Firebase Integration

In `init()` at line 45:
```javascript
if (useFirebase && db) {
    db.collection('commandCenter').doc('activeState').onSnapshot((snap) => {
        if (snap.exists) {
            const data = snap.data();
            // Auto-migrate old-format presets from Firebase
            if (data.presets) {
                const samplePreset = Object.values(data.presets).find(p => p !== null && Array.isArray(p));
                if (samplePreset && samplePreset.length > 0 && !samplePreset[0].items) {
                    // Convert flat tasks → checklist format
                    // See lines 52-80 for full migration
                }
            }
            appState.checklist = { ...appState.checklist, ...data };
            this.renderChecklistOverview();
            this.processStateChange();
            this.updateTimersAndColors();
        }
    });
}
```

Firebase writes happen in `syncState()`:
```javascript
if (useFirebase && db) {
    db.collection('commandCenter').doc('activeState').set(updates, { merge: true });
}
```

Firebase collections used:
- `commandCenter/activeState` — Real-time sync of checklist state
- `commandCenterHistory` — Archive documents (date, preset, completed, total)

### 4.4 Timer & Countdown

| Method | Line | Description |
|--------|------|-------------|
| `updateTimersAndColors()` | 405 | Calculates countdown to service start, updates `#main-countdown` element, sets overdue color (`#ed1c24`) vs normal (`#f47920`). Updates each task's deadline time and applies CSS class: `task-completed`, `task-overdue` (with pulse), `task-upcoming`. Runs every 1 second via `setInterval`. |

### 4.5 Role System

| Method | Line | Description |
|--------|------|-------------|
| `selectRole(role, event)` | 263 | Sets `appState.role`. Maps: coordinator/admin → "Admin", beamer → "Beamer", worship/band → "Worship". Hides role selector overlay, shows/hides admin/progress sidebars. Calls `processStateChange()` + `updateTimersAndColors()`. |
| `showRoleSelector()` | 301 | Shows role selector overlay (`#role-selector`), hides both sidebars, clears role. |
| `getActiveTasks()` | 255 | Returns tasks filtered by current role. If role is 'Admin', returns all. Sorted by `minsBefore` descending. Used by OLD legacy rendering. |

### 4.6 Overview Rendering

| Method | Line | Description |
|--------|------|-------------|
| `renderChecklistOverview()` | 579 | Main overview render. Gets checklists from `_getChecklists()`, applies tag filter, renders cards or empty state. Also calls `_renderTagFilters()`. |
| `_renderChecklistCard(cl)` | 604 | Creates a single checklist card DOM element with: header (name + progress "3/9"), progress bar (percentage fill), due date/time label, repeat frequency label. Click handler → `openChecklistDetail(cl.id)`. Context menu → `showChecklistOverviewMenu()`. |

#### HTML Structure of a Card
```html
<div class="cl-checklist-card" id="cl-item-cl_techniek">
    <div class="cl-checklist-header">
        <span class="cl-checklist-name">Techniek</span>
        <span class="cl-checklist-progress">3/9</span>
    </div>
    <div class="cl-checklist-progress-row">
        <div class="cl-checklist-progress-bar">
            <div class="cl-checklist-progress-fill" style="width:33%;"></div>
        </div>
        <span class="cl-checklist-progress-pct">33%</span>
    </div>
    <div class="cl-checklist-due">
        <span class="cl-due-label">18 mei</span>
        <span class="cl-due-time heading-font">10:00</span>
    </div>
</div>
```

### 4.7 Detail View (Stack Navigation)

| Method | Line | Description |
|--------|------|-------------|
| `openChecklistDetail(checklistId)` | 645 | Sets `activeView = 'detail'` + `activeChecklistId`. Hide overview (`#cl-overview`), show detail (`#cl-detail`), show back button (`#cl-back-btn`), add `detail-open` class to main. Calls `_renderChecklistDetail()`. |
| `closeChecklistDetail()` | 662 | Reverses: `activeView = 'overview'`, hide detail, show overview, hide back button. |
| `_renderChecklistDetail(checklistId)` | 682 | Renders full detail view: header with name + progress + add button, progress bar, items split into incomplete + completed sections, empty state if no items. Binds checkbox toggles via event delegation, context menus on items. |

#### Detail View HTML Structure
```html
<div class="cl-detail">
    <div class="cl-detail-content">
        <div class="cl-detail-header">
            <div class="cl-detail-header-left">
                <span class="cl-detail-name">Techniek</span>
                <span style="font-size:0.78rem;color:var(--text-dim,#666);">3/9</span>
            </div>
            <button class="cl-detail-add-btn" id="cl-detail-add-item">+</button>
        </div>
        <div class="cl-detail-progress-wrap">
            <div class="cl-detail-progress-header">
                <span class="cl-detail-progress-label">6 openstaande</span>
                <span class="cl-detail-progress-count">33%</span>
            </div>
            <div class="cl-detail-progress-bar">
                <div class="cl-detail-progress-fill" style="width:33%;"></div>
            </div>
        </div>
        <div class="cl-detail-items">
            <!-- Item cards -->
            <div class="cl-item-card" data-item-id="itm_t1">
                <div class="cl-item-card-top">
                    <input type="checkbox" class="cl-item-checkbox">
                    <span class="cl-item-card-name">Projectoren aan</span>
                </div>
                <div class="cl-item-card-tags">
                    <span class="cl-tag-pill" style="--tag-color:#f47920;">🎤 Audio</span>
                </div>
                <div class="cl-item-card-footer">
                    <span class="cl-item-card-team">Beamer</span>
                    <span class="cl-item-card-time">-40min</span>
                </div>
            </div>
            <!-- Completed separator -->
            <div class="cl-completed-separator">
                <span class="cl-completed-separator-text">2 voltooid</span>
            </div>
            <!-- Completed items -->
        </div>
    </div>
</div>
```

### 4.8 Item Card Rendering

| Method | Line | Description |
|--------|------|-------------|
| `_renderItemCard(item, checklistId, isCompleted)` | 765 | Renders a single item card: checkbox, name (with strikethrough if completed), tag pills, team assignment, time ("-40min"). |

### 4.9 Checklists CRUD

| Method | Line | Description |
|--------|------|-------------|
| `createChecklist(name, icon, skipRename, dueDate, dueTime)` | 957 | Creates a new checklist with generated ID (`cl_{timestamp}_{random}`), adds to current preset, renders overview, optionally opens edit modal. |
| `showCreateChecklistModal()` | — | Shows the create-checklist modal (`#cl-create-checklist-modal`). Called via onclick in HTML. |
| `closeCreateChecklistModal()` | — | Hides the create-checklist modal. |
| `submitCreateChecklist()` | — | Reads name, date, time from create-checklist modal fields, calls `createChecklist()`, closes modal. |
| `renameChecklist(id, newName)` | 979 | Renames a checklist by ID in the current preset. |
| `duplicateChecklist(id)` | 991 | Deep-copies a checklist with new ID and name "X (Kopie)". |
| `deleteChecklist(id)` | 1005 | Removes a checklist with confirmation. Closes detail view if that checklist was open. |
| `showEditChecklistModal(checklistId)` | 1074 | Opens the edit modal, renders content, binds Escape key + overlay click to close. Cleanup old listeners first (`_cleanupEditModalListeners`). |
| `closeEditChecklistModal()` | 1112 | Closes edit modal, cleans up listeners. |
| `_renderEditChecklistContent(container, checklistId)` | 1125 | Renders edit content: name input, tag selector, due date/time, repeat frequency, items list with inline editing, add item row. |
| `_renderEditItemRow(item)` | 1294 | Renders an editable item row with text input and delete button. |
| `_bindEditItemEvents(checklistId)` | 1302 | Binds blur/enter to save item name, click to delete item. |
| `_saveEditChecklistMeta(checklistId)` | 1336 | Saves all metadata changes from edit modal (name, tag, date, time, repeat). |
| `addItemFromEdit(checklistId, name)` | 1385 | Adds item from edit modal, re-renders edit content. |
| `renameItemInState(checklistId, itemId, newName)` | 1417 | Renames an item inline. |

### 4.10 Items CRUD

| Method | Line | Description |
|--------|------|-------------|
| `addItem(checklistId, name, dueTime, team)` | 1028 | Adds item to a checklist. Parses dueTime (HH:MM) as minutes before service start. Auto-updates detail view or overview. |
| `deleteItem(checklistId, itemId)` | 1053 | Removes an item with confirmation. |
| `toggleItemCheck(checklistId, itemId)` | 1074 | Toggles item completed state. Re-renders detail or overview. |
| `showAddItemModal(checklistId)` | 795 | Shows the add item modal, stores checklistId in `dataset`. |
| `closeAddItemModal()` | 802 | Hides add item modal. |
| `submitAddItem()` | 806 | Reads form fields (name, time, team), calls `addItem()`, closes modal, clears fields. |

### 4.11 Context Menus

| Method | Line | Description |
|--------|------|-------------|
| `showChecklistOverviewMenu(e, checklistId)` | 860 | Shows right-click context menu for a checklist card: Bewerk, Dupliceer, Verwijder. |
| `showChecklistItemMenu(e, checklistId, itemId)` | 898 | Shows right-click context menu for an item: Markeer voltooid/open, Verwijder. |
| `closeContextMenu()` | 943 | Removes all `.cl-context-menu` elements from DOM. |

### 4.12 Tags

| Method | Line | Description |
|--------|------|-------------|
| `showTagManager()` | 1488 | Opens tag manager modal. |
| `closeTagManager()` | 1495 | Closes tag manager modal. |
| `_renderTagManagerList()` | 1500 | Renders tag list with icon, name, color dot, delete button. |
| `addTag(icon, name, color)` | 1522 | Creates new tag with auto-generated ID and sortOrder. |
| `deleteTag(tagId)` | 1533 | Removes tag with confirmation. Also removes `tagId` references from all checklists. |

### 4.13 Tag Filtering

| Method | Line | Description |
|--------|------|-------------|
| `getActiveTagFilter()` | 1558 | Returns current active tag filter ID or null. |
| `applyTagFilter(tagId)` | 1562 | Toggles tag filter on/off for a tag ID. Re-renders filters + overview. |
| `clearTagFilter()` | 1573 | Clears active tag filter. |
| `_renderTagFilters()` | 1579 | Renders tag filter bar: shows all tags as clickable pills. Active filter gets solid background. Empty state hides the bar. |

### 4.14 Due Date Modal (Legacy)

| Method | Line | Description |
|--------|------|-------------|
| `showEditDueDateModal(checklistId)` | 1435 | Opens due date edit modal. |
| `closeEditDueDateModal()` | 1451 | Closes due date edit modal. |
| `saveEditDueDate()` | 1456 | Saves due date/time changes to checklist. |

### 4.15 Manage Modal

| Method | Line | Description |
|--------|------|-------------|
| `showManageModal()` | 1622 | Opens manage checklists modal. |
| `closeManageModal()` | 1629 | Closes manage checklists modal. Called via onclick in HTML (`#btn-close-manage-modal`). |
| `_renderManageChecklists()` | 1634 | Renders checklist list with item count and delete button. |

### 4.16 Admin Sidebar

| Method | Line | Description |
|--------|------|-------------|
| `toggleAdminSidebar()` | 1659 | Toggles admin sidebar open/closed. Also toggles master sidebar and `checklist-sidebar-open` class on body. |

### 4.17 Legacy Task Management (OLD format — kept for migration support)

| Method | Line | Description |
|--------|------|-------------|
| `renderTaskDOM()` | 359 | Renders flat task rows in `#checklist` container. Uses virtual DOM diffing (checks by ID, re-renders only if mismatch). |
| `renderProgressBars()` | 460 | Renders per-team progress bars in `#progress-container`. Teams: Beamer, Worship. |
| `handleNotes()` | 490 | Shows/hides note banner (`#note-banner`). Shows alert popup for important notes (`#modal-popup`). |
| `renderTaskManageList()` | 497 | Renders task management list in modal with editable name, time, team fields. |
| `updateTask(id, field, value)` | 558 | Updates a single task field. |
| `deleteTask(id)` | 565 | Removes a task with confirmation. |

---

## 5. DOM Structure (from `index.html`)

### Checklist View HTML Layout

```html
<div id='view-checklist' class='app-view hidden'>
    <!-- Role Selector Overlay -->
    <div id='role-selector' class='overlay-screen overlay-role-selector'>
        <div class='role-selector-wrapper'>
            <h1 class='role-selector-title heading-font'>Selecteer Station</h1>
            <div class='role-selector-container'>
                <button onclick="checklistModule.selectRole('Admin', event)" class='btn-role btn-role-admin'>Coördinator</button>
                <button onclick="checklistModule.selectRole('Beamer', event)" class='btn-role btn-role-beamer'>Beamer Team</button>
                <button onclick="checklistModule.selectRole('Worship', event)" class='btn-role btn-role-worship'>Worship Team</button>
            </div>
        </div>
    </div>

    <!-- Admin Sidebar (left panel) -->
    <aside id='admin-sidebar' class='settings-panel hidden'>
        <div class='panel-header'><h2 class='panel-title heading-font'>Instellingen</h2></div>
        <div class='panel-content spaced'>
            <div class='form-group'>
                <label class='form-label'>Start Datum & Tijd</label>
                <input type='date' id='inp-date'> <input type='time' id='inp-time'>
            </div>
            <div class='form-group'>
                <label class='form-label'>Service Preset</label>
                <select id='inp-preset'></select>
                <button id='btn-preset-menu'>⋮</button>
                <div id='preset-dropdown' class='dropdown-menu hidden'>
                    <button id='btn-add-preset'>Nieuwe lijst (Leeg)</button>
                    <button id='btn-dup-preset'>Dupliceer lijst</button>
                    <button id='btn-rename-preset'>Hernoem lijst</button>
                    <button id='btn-del-preset'>Verwijder lijst</button>
                </div>
            </div>
            <div class='form-group form-group-divider'>
                <h3>Bericht aan US</h3>
                <textarea id='inp-note'></textarea>
                <input type='checkbox' id='inp-popup'> <label>Belangrijke Pop-up</label>
                <button id='btn-send-note'>Broadcast</button>
                <button id='btn-clear-note'>✕</button>
            </div>
        </div>
        <div class='panel-footer'>
            <button id='btn-reset'>Reset & Archiveer</button>
        </div>
    </aside>

    <!-- Main Checklist Area -->
    <div class='checklist-main'>
        <!-- Header -->
        <div class='cl-header-bar'>
            <div class='cl-header-left'>
                <span class='cl-header-title heading-font'>Checklists</span>
                <span id='cl-back-btn' class='cl-back-btn hidden' onclick='checklistModule.closeChecklistDetail()'>← Terug naar overzicht</span>
            </div>
            <div class='cl-header-right'>
                <button id='btn-add-checklist' class='cl-btn cl-btn-add' onclick='checklistModule.showCreateChecklistModal()'>+</button>
                <button id='btn-settings' class='cl-btn cl-btn-settings' onclick="checklistModule.toggleAdminSidebar()">⚙</button>
                <button onclick='checklistModule.showRoleSelector()' class='btn-switch-role'>⇦ Wissel Rol</button>
            </div>
        </div>

        <div id='note-banner' class='note-banner hidden'></div>

        <!-- Overview -->
        <div id='cl-overview' class='cl-overview'>
            <div id='cl-checklist-list' class='cl-checklist-list'></div>
            <div class='cl-action-bar'>
                <button id='btn-open-tag-manager' class='cl-action-btn'>🏷 Tags</button>
                <button id='btn-open-task-modal-main' class='cl-action-btn'>✏️ Beheer</button>
            </div>
            <div id='cl-tag-filters' class='cl-tag-filters hidden'>
                <span class='cl-filter-label'>Filter:</span>
                <div id='cl-tag-filter-list' class='cl-tag-filter-list'></div>
                <button id='cl-clear-tag-filter' class='cl-clear-filter hidden' onclick='checklistModule.clearTagFilter()'>✕ wissen</button>
            </div>
        </div>

        <!-- Detail View -->
        <div id='cl-detail' class='cl-detail hidden'>
            <div id='cl-detail-content' class='cl-detail-content'></div>
        </div>
    </div>

    <!-- Modals (appended after checklist-main) -->

    <!-- Add Item Modal -->
    <div id='cl-add-item-modal' class='overlay-screen overlay-task-modal hidden'>
        <div class='task-modal-dialog'>
            <div class='modal-header'><h3>Nieuw Item</h3></div>
            <div class='modal-form-content'>
                <label>Taak naam</label>
                <input type='text' id='cl-add-item-name' placeholder='Bijv. Projector aan' required>
                <label>Deadline tijd</label>
                <input type='time' id='cl-add-item-time'>
                <label>Team</label>
                <input type='text' id='cl-add-item-team' placeholder='Bijv. Beamer'>
            </div>
            <div class='modal-footer'>
                <button onclick='checklistModule.closeAddItemModal()'>Annuleren</button>
                <button id='cl-add-item-submit' onclick='checklistModule.submitAddItem()'>Toevoegen</button>
            </div>
        </div>
    </div>

    <!-- Create Checklist Modal -->
    <div id='cl-create-checklist-modal' class='overlay-screen overlay-task-modal hidden'>
        <div class='task-modal-dialog'>
            <div class='modal-header'><h3>Nieuwe Checklist</h3></div>
            <div class='modal-form-content'>
                <label>Naam</label>
                <input type='text' id='cl-create-checklist-name' placeholder='Bijv. Zondagochtend' required>
                <label>Datum</label>
                <input type='date' id='cl-checklist-due-date'>
                <label>Tijd</label>
                <input type='time' id='cl-checklist-due-time'>
            </div>
            <div class='modal-footer'>
                <button onclick='checklistModule.closeCreateChecklistModal()'>Annuleren</button>
                <button id='cl-create-checklist-submit' onclick='checklistModule.submitCreateChecklist()'>Aanmaken</button>
            </div>
        </div>
    </div>

    <!-- Edit Due Date Modal -->
    <div id='cl-edit-due-modal' class='overlay-screen overlay-task-modal hidden'>
        <div class='task-modal-dialog'>
            <div class='modal-header'><h3>Deadline Bewerken</h3></div>
            <div class='modal-form-content'>
                <input type='date' id='cl-edit-due-date'>
                <input type='time' id='cl-edit-due-time'>
            </div>
            <div class='modal-footer'>
                <button onclick='checklistModule.closeEditDueDateModal()'>Annuleren</button>
                <button onclick='checklistModule.saveEditDueDate()'>Opslaan</button>
            </div>
        </div>
    </div>

<!-- Edit Checklist Modal (content dynamically rendered by JS) -->
<div id='cl-edit-checklist-modal' class='overlay-screen overlay-task-modal hidden'>
    <div class='task-modal-dialog cl-edit-dialog'>
        <div class='modal-header'><h3 class='heading-font'>Bewerk Checklist</h3></div>
        <div id='cl-edit-checklist-content' class='cl-edit-content'>
            <!-- Dynamically rendered by _renderEditChecklistContent() in JS -->
            <!-- Sections rendered: name input, tag selector, due date/time, -->
            <!-- repeat frequency, items list with inline editing, add item row, footer -->
        </div>
    </div>
</div>

    <!-- Popup Modal -->
    <div id='modal-popup' class='overlay-screen overlay-alert-modal hidden'>
        <div class='modal-dialog'>
            <h2 class='alert-title heading-font'>Alert!</h2>
            <p id='modal-text'></p>
            <button id='btn-close-modal'>Begrepen</button>
        </div>
    </div>

    <!-- Tag Manager Modal -->
    <div id='tag-manager-modal' class='overlay-screen overlay-task-modal hidden'>
        <div class='task-modal-dialog tag-manager-dialog'>
            <h2 class='task-modal-title heading-font'>🏷 Tag Manager</h2>
            <div id='tag-manager-list' class='tag-manager-list'></div>
            <div class='modal-footer'>
                <h3>Nieuwe Tag Toevoegen</h3>
                <div class='tag-input-row'>
                    <input type='text' id='new-tag-icon' placeholder='Icoon' maxlength='2'>
                    <input type='text' id='new-tag-name' placeholder='Naam'>
                    <div class='tag-color-picker' id='new-tag-color'>
                        <button class='tag-color-dot' style='background:#f47920' data-color='#f47920'></button>
                        <button class='tag-color-dot' style='background:#3b82f6' data-color='#3b82f6'></button>
                        <button class='tag-color-dot' style='background:#22c55e' data-color='#22c55e'></button>
                        <button class='tag-color-dot' style='background:#ef4444' data-color='#ef4444'></button>
                        <button class='tag-color-dot' style='background:#a855f7' data-color='#a855f7'></button>
                        <button class='tag-color-dot' style='background:#6b7280' data-color='#6b7280'></button>
                    </div>
                </div>
                <div class='modal-button-row'>
                    <button id='btn-add-tag'>Toevoegen</button>
                    <button id='btn-close-tag-manager'>Sluiten</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Manage Checklists Modal -->
    <div id='manage-modal' class='overlay-screen overlay-task-modal hidden'>
        <div class='task-modal-dialog manage-modal-dialog'>
            <h2 class='task-modal-title heading-font'>✏️ Beheer Checklists</h2>
            <div id='manage-checklist-list' class='tag-manager-list'></div>
            <div class='modal-button-row'>
                <button id='btn-close-manage-modal'>Sluiten</button>
            </div>
        </div>
    </div>

    <!-- Legacy Task Management Modal -->
    <div id='task-modal' class='overlay-screen overlay-task-modal hidden'>
        <div class='task-modal-dialog'>
            <h2 class='task-modal-title heading-font'>Taken Aanpassen</h2>
            <div id='task-manage-list' class='task-manage-list'></div>
            <div class='modal-footer'>
                <h3>Nieuwe Taak Toevoegen</h3>
                <input type='text' id='new-task-name' placeholder='Taak omschrijving'>
                <input type='number' id='new-task-time' placeholder='Min. voor'>
                <select id='new-task-team'>
                    <option value='Beamer'>Beamer</option>
                    <option value='Worship'>Worship</option>
                </select>
                <button id='btn-add-task'>Toevoegen</button>
                <button id='btn-close-task-modal'>Sluiten</button>
            </div>
        </div>
    </div>
</div>
```

---

## 6. CSS Architecture

### Checklist CSS Location

All checklist styles are in `Ichtus_SPA/css/style.css` beginning at line 1077 (context menus) and line 3679 (checklist card/detail system).

### Complete CSS Class Reference

#### Overview & Cards (lines 3679-3774)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-overview` | 3768 | Overview container, margin-top: 16px |
| `.cl-checklist-list` | 3772 | Lists wrapper, margin-bottom: 16px |
| `.cl-checklist-card` | 3679 | Card: dark background (#1e1e1e), border #333, border-radius 8px, hover → orange border + translateY(-1px) |
| `.cl-checklist-header` | 3694 | Flex row: name + progress, padding 10px 14px 4px |
| `.cl-checklist-name` | 3701 | Bold 1rem name, color #eee |
| `.cl-checklist-progress` | 3708 | "3/9" counter, 0.8rem, dimmed |
| `.cl-checklist-progress-row` | 3715 | Flex row bar + percentage |
| `.cl-checklist-progress-bar` | 3722 | 8px height track, #333 background, border-radius 4px |
| `.cl-checklist-progress-fill` | 3730 | Gradient orange fill, width animated via CSS transition 0.6s |
| `.cl-checklist-progress-pct` | 3738 | Percentage label, tabular-nums |
| `.cl-checklist-due` | 3746 | Due date/time row |

#### Header Bar (lines 3777-3818)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-header-bar` | 3777 | Flex row, space-between, gap 12px |
| `.cl-header-title` | 3791 | 1.5rem title, Blockprint font via `.heading-font` |
| `.cl-header-right` | 3796 | Right-aligned button group |
| `.cl-back-btn` | 3810 | Back button, orange, hidden by default |
| `.cl-btn` | 3821 | Base button: 6px 12px padding, #333 background |
| `.cl-btn-add` | 3840 | Circular (+) button, 36x36, orange gradient, white + |
| `.cl-btn-settings` | 3855 | Circular (⚙) button, 36x36, transparent border |

#### Action Bar & Tags (lines 3872-3930)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-action-bar` | 3872 | Flex row with 8px gap |
| `.cl-action-btn` | 3878 | Outline button with border, hover → orange border |
| `.cl-tag-filters` | 3895 | Tag filter bar: dark card background, #1e1e1e, border #333, 8px padding |
| `.cl-filter-label` | 3907 | "Filter:" label, small dimmed text |
| `.cl-clear-filter` | 3919 | "✕ wissen" clear button, orange |
| `.cl-tag-pill` | 4422 | Tag pill: inline-flex, rounded, colored border + background using `--tag-color` CSS variable, font-size 0.72rem, clickable |

#### Detail View (lines 3933-4316)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-detail` | 3933 | Detail container, card style, padding 16px |
| `.cl-detail-header` | 3945 | Flex row header, border-bottom separator |
| `.cl-detail-name` | 3963 | Bold 1.15rem name |
| `.cl-detail-add-btn` | 3972 | Shiny orange gradient + button with liquid shimmer animation |
| `.cl-detail-progress-wrap` | 4272 | Progress section for detail view |
| `.cl-detail-items` | 4311 | Items list, flex column, 6px gap |

#### Item Cards (lines 4368-4435)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-item-card` | 4368 | Item card, padding 10px 12px, hover → orange border |
| `.cl-item-card-completed` | 4380 | 55% opacity for completed items |
| `.cl-item-card-name.completed` | 4406 | Strikethrough text |
| `.cl-item-checkbox` | 4390 | Orange accent checkbox |
| `.cl-item-card-tags` | 4414 | Tag pill row, flex wrap, padding-left 24px |
| `.cl-item-card-footer` | 4418 | Team + time row, 0.75rem dimmed |
| `.cl-item-card-time` | 4423 | Time label, orange, letter-spacing 0.5px |

#### Completed Separator (lines 4345-4362)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-completed-separator` | 4345 | Flex row with ::before/::after lines |
| `.cl-completed-separator-text` | 4358 | "X voltooid" label, 0.75rem |

#### Empty State (lines 4319-4342)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-empty-state` | 4319 | Centered text block, padding 24px 16px |
| `.cl-empty-btn` | 4329 | Outline button with orange border + text, hover → filled |

#### Edit Checklist Modal (lines 4054-4271)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-edit-dialog` | 4054 | Max-width 520px |
| `.cl-edit-content` | 4059 | Scrollable content area, max-height 70vh |
| `.cl-edit-section` | 4065 | Section wrapper, margin-bottom 14px |
| `.cl-edit-label` | 4069 | Section label, uppercase, 0.78rem, dimmed |
| `.cl-edit-input` | 4084 | Dark input field, focus → orange border |
| `.cl-edit-items-list` | 4148 | Items list, max-height 300px, overflow-y auto |
| `.cl-edit-item-row` | 4164 | Item row, flex, hover → orange border |
| `.cl-edit-item-name-input` | 4178 | Inline name editor, transparent background |
| `.cl-edit-item-del` | 4198 | Delete button, hover → red |
| `.cl-edit-empty` | 4157 | "Nog geen items" placeholder |
| `.cl-btn-save` | 4124 | Orange save button |
| `.cl-btn-close` | 4257 | Outline close button |
| `.cl-btn-add-item` | 4230 | Outline + button for adding items |
| `.cl-edit-footer` | 4249 | Footer with border-top |

#### Context Menus (lines 1077-1088)
| Selector | Location | Purpose |
|----------|----------|---------|
| `.cl-context-menu` | 1077 | Fixed position menu, dark background, border, box-shadow, z-index 10000 |
| `.cl-context-menu-item` | 1086 | Menu item: padding 10px 16px, hover → orange bg |
| `.cl-context-menu-item.danger` | 1088 | Red hover for destructive actions |

---

## 7. Router Integration

In `router.js`, the checklist module is initialized at line 110:
```javascript
if (view === 'checklist' && typeof checklistModule !== 'undefined') {
    checklistModule.init();
}
```

The router:
- Listens for `hashchange` events
- Navigates via `router.navigate(view)` which:
  - Hides all `.app-view` elements
  - Shows target view (e.g., `#view-checklist`)
  - Updates sidebar active state
  - Updates URL hash
  - Calls `module.init()` for the target view

---

## 8. Script Loading Order

In `index.html`, scripts load in this exact order:

```html
<!-- Shared sidebar -->
<script src='../shared-assets/js/sidebar.js'></script>

<!-- State (loads immediately) -->
<script src='js/state.js'></script>

<!-- Modules -->
<script src='js/modules/checklist.js'></script>
<script src='js/modules/agenda.js'></script>
<script src='js/modules/dashboard.js'></script>
<script src='js/modules/ndi.js'></script>
<script src='js/modules/patchbay.js'></script>
<script src='js/modules/setlist.js'></script>
<script src='js/modules/analytics.js'></script>
<script src='js/modules/settings.js'></script>

<!-- Router -->
<script src='js/router.js'></script>

<!-- App entry (makes modules global) -->
<script src='js/app.js'></script>

<!-- Firebase init (async IIFE) -->
<script src='js/firebase-init.js'></script>
```

---

## 9. Server Configuration (`server.py`)

### Key Features
- Python HTTP server serving files from project root
- Uses `http.server.SimpleHTTPRequestHandler` with custom `IchtusHandler`
- Serves `Ichtus_SPA/index.html` at root (`/`)
- Detects directory paths → appends `index.html`
- Injects Firebase config via `<script>` tag before `</head>`
- CORS headers on all responses
- API endpoints: `/api/ndi/sources`, `/api/tockify/ics`
- Auto-update mechanism checking GitHub releases
- NDI discovery via mDNS/Zeroconf

### Running
```bash
python server.py                    # Start on http://localhost:8080
python server.py --port 3000        # Custom port
python server.py --host 0.0.0.0     # Network accessible
python server.py --open             # Open browser
```

### HTML Base Tag
```html
<base href='/Ichtus_SPA/'>
```
This ensures all relative paths (`js/router.js`, `css/style.css`) resolve correctly from `/Ichtus_SPA/` regardless of how the user navigates to the page.

---

## 10. Firebase Integration

### Init Flow (`firebase-init.js`)
1. Check localStorage for saved config
2. Check `window.FIREBASE_CONFIG` (server-injected)
3. Check external config file (legacy)
4. If no valid config found → show setup screen
5. On config: `firebase.initializeApp(config)`, enable persistence
6. Listen for auth state changes → show app (even if not signed in)

### Collections Used
| Collection | Document | Usage |
|-----------|----------|-------|
| `commandCenter` | `activeState` | Real-time checklist state sync |
| `commandCenterHistory` | auto-ID | Archived service stats (date, preset, completed, total) |

### Checklist Firebase Flow
- **Read:** `onSnapshot` listener in `init()` — receives real-time updates, auto-migrates old format
- **Write:** `syncState()` → `db.collection('commandCenter').doc('activeState').set(updates, { merge: true })`
- **Archive:** `btn-reset` → `db.collection('commandCenterHistory').add({ date, preset, completed, total })`

---

## 11. Event Listeners Summary

### Setup in `setupEventListeners()` (line 101)
| Element | Event | Handler |
|---------|-------|---------|
| `#inp-date` | input | Update `startDate`, syncState |
| `#inp-time` | input | Update `startTime`, syncState |
| `#inp-preset` | change | Switch preset, reset tasksState |
| `#btn-preset-menu` | click | Toggle preset dropdown |
| `document` | click | Close preset dropdown if clicked outside |
| `document` | keydown (Escape) | Close preset dropdown |
| `#btn-add-preset` | click | Prompt, create empty preset |
| `#btn-dup-preset` | click | Prompt, duplicate current preset |
| `#btn-rename-preset` | click | Prompt, rename preset |
| `#btn-del-preset` | click | Confirm, delete preset |
| `#btn-send-note` | click | Send broadcast note |
| `#btn-clear-note` | click | Clear broadcast |
| `#btn-reset` | click | Archive + reset (with Firebase history) |
| `#btn-close-modal` | click | Close popup modal |
| `#btn-open-task-modal` | click | Open legacy task management modal |
| `#btn-open-task-modal-main` | click | Open legacy task management modal |
| `#btn-close-task-modal` | click | Close legacy task modal |
| `#btn-add-task` | click | Add legacy task |
| `#btn-open-tag-manager` | click | `showTagManager()` |
| `#btn-close-tag-manager` | click | `closeTagManager()` |
| `#btn-add-tag` | click | `addTag()` (reads icon, name, color from form) |
| `#btn-close-manage-modal` | click | `closeManageModal()` |
| `#cl-add-item-submit` | click | `submitAddItem()` |
| `#cl-create-checklist-submit` | click | `submitCreateChecklist()` |

### Global Listeners in `_setupContextMenuListeners()` (line 1674)
| Element | Event | Handler |
|---------|-------|---------|
| `document` | click | Close context menus if clicked outside |
| `document` | keydown (Escape) | Close context menus |

### Per-Card Listeners (in `_renderChecklistCard`)
| Element | Event | Handler |
|---------|-------|---------|
| `.cl-checklist-card` | click | `openChecklistDetail(cl.id)` (unless clicking context menu or tag pill) |
| `.cl-checklist-card` | contextmenu | `showChecklistOverviewMenu(e, cl.id)` |

### Detail View Listeners (in `_renderChecklistDetail`)
| Element | Event | Handler |
|---------|-------|---------|
| `.cl-item-card` | change (checkbox) | `toggleItemCheck(checklistId, itemId)` |
| `.cl-item-card` | contextmenu | `showChecklistItemMenu(e, checklistId, itemId)` |
| `#cl-detail-add-item` | click | `showAddItemModal(checklistId)` |

---

## 12. Rebuild Checklist

To rebuild the checklist module from scratch, you need:

1. **`state.js`** — Define `appState` with defaults for presets, tags, service date/time. Implement `loadState()` + `saveState()` + `migrateOldFormat()`.

2. **`modules/checklist.js`** — Implement the `checklistModule` object with all methods listed in section 4.

3. **`index.html`** — Add the checklist view DOM structure as shown in section 5. Include all modals (add item, create checklist, edit checklist, tag manager, manage, task modal, popup, edit due date).

4. **`css/style.css`** — Add all CSS classes from section 6.

5. **`router.js`** — Add `#checklist` route that calls `checklistModule.init()`.

6. **`app.js`** — Make `checklistModule` globally accessible via `window.checklistModule`.

7. **`firebase-init.js`** — Implement Firebase initialization with config loading from multiple sources.

8. **`server.py`** — Implement HTTP server with Firebase config injection and `<base href='/Ichtus_SPA/'>` support.

9. **`shared-assets/css/branding.css`** — Define CSS variables: `--bg-main`, `--bg-sidebar`, `--text-main`, `--text-dim`, `--border-light`, `--border-color`, `--card-bg`, `--ichtus-orange`, `--ichtus-blue`, `--ichtus-red`.

---

## 13. Design Tokens & Theme

```css
/* Core colors */
--ichtus-orange: #f47920
--ichtus-blue: #3b82f6
--ichtus-red: #ed1c24

/* Backgrounds */
--bg-main: #121212
--bg-sidebar: #1e1e1e
--card-bg: #1e1e1e

/* Text */
--text-main: #eee
--text-dim: #888

/* Borders */
--border-light: #333
--border-color: #333

/* Font stack */
sans-serif for UI
.heading-font { font-family: 'Blockprint', sans-serif; letter-spacing: 1px; }
```

---

## 14. Legacy Compatibility Notes

- The app still has **two rendering systems**: the old flat-task system (`renderTaskDOM()`, `getActiveTasks()`) and the new checklist system (`renderChecklistOverview()`, `_getChecklists()`).
- Both receive updates via `syncState()` → `processStateChange()` which calls both render methods.
- The old system is preserved for backward compatibility and can be safely removed once all data is migrated.
- Key difference: old system uses `appState.checklist.preset` + `tasksState`, new system uses `appState.checklist.currentPreset` + `presets[presetName][].items[].completed`.
- `syncState()` bridges the two by setting `currentPreset` whenever `preset` is updated (line 316-318).
