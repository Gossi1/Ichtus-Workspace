/* ============================================
   SHARED STATE MANAGEMENT
   Single source of truth for the SPA
   ============================================ */

// Default preset with checklists (groups) instead of flat tasks
// Used when migrating from old format or creating fresh
const defaultNewPresets = {
    'Standaard Dienst': [
        {
            id: 'cl_techniek',
            name: 'Techniek',
            icon: '\u26a1',
            collapsed: true,
            items: [
                { id: 'itm_t1', name: 'Projectoren aan', completed: false, assignedTo: 'Beamer', dueBefore: 40, tagIds: [] },
                { id: 'itm_t2', name: 'Lobby NDI Feed checken', completed: false, assignedTo: 'Beamer', dueBefore: 30, tagIds: [] },
                { id: 'itm_t3', name: 'Lichtplan laden', completed: false, assignedTo: 'Beamer', dueBefore: 20, tagIds: [] }
            ]
        },
        {
            id: 'cl_worship',
            name: 'Worship',
            icon: '\ud83c\udfb8',
            collapsed: true,
            items: [
                { id: 'itm_w1', name: 'Soundcheck & In-ears', completed: false, assignedTo: 'Worship', dueBefore: 60, tagIds: [] },
                { id: 'itm_w2', name: 'Lyrics syncen', completed: false, assignedTo: 'Worship', dueBefore: 20, tagIds: [] },
                { id: 'itm_w3', name: 'Band klaar op podium', completed: false, assignedTo: 'Worship', dueBefore: 2, tagIds: [] }
            ]
        },
        {
            id: 'cl_livestream',
            name: 'Livestream',
            icon: '\ud83d\udcf9',
            collapsed: true,
            items: [
                { id: 'itm_v1', name: 'Lower thirds test', completed: false, assignedTo: 'Stream', dueBefore: 15, tagIds: [] },
                { id: 'itm_v2', name: 'Stream starten', completed: false, assignedTo: 'Stream', dueBefore: 5, tagIds: [] },
                { id: 'itm_v3', name: 'Audio levels check', completed: false, assignedTo: 'Stream', dueBefore: 10, tagIds: [] }
            ]
        },
        {
            id: 'cl_algemeen',
            name: 'Algemeen',
            icon: '\ud83d\udccb',
            collapsed: true,
            items: [
                { id: 'itm_a1', name: 'Welkomstlogo op scherm', completed: false, assignedTo: 'Media', dueBefore: 5, tagIds: [] },
                { id: 'itm_a2', name: 'Koffie & water klaar', completed: false, assignedTo: 'Algemeen', dueBefore: 15, tagIds: [] }
            ]
        }
    ],
    'Doopdienst': [
        {
            id: 'cl_doop_default',
            name: 'Doopdienst',
            icon: '\u2697\ufe0f',
            collapsed: true,
            items: [
                { id: 'itm_d1', name: 'Doopnamen voorbereiden', completed: false, assignedTo: 'Beamer', dueBefore: 25, tagIds: [] },
                { id: 'itm_d2', name: 'Handdoeken & Microfoon', completed: false, assignedTo: 'Worship', dueBefore: 15, tagIds: [] }
            ]
        }
    ]
};

// Default tags
const defaultTags = {
    'tag_audio':    { id: 'tag_audio',    name: 'Audio',     icon: '\ud83c\udfa4', color: '#f47920', sortOrder: 0 },
    'tag_text':     { id: 'tag_text',     name: 'Tekst',     icon: '\ud83d\udcc4', color: '#3b82f6', sortOrder: 1 },
    'tag_beeld':    { id: 'tag_beeld',    name: 'Beeld',     icon: '\ud83d\uddbc\ufe0f', color: '#22c55e', sortOrder: 2 },
    'tag_techniek': { id: 'tag_techniek', name: 'Techniek',  icon: '\u2699\ufe0f', color: '#6b7280', sortOrder: 3 }
};

// Global state
const appState = {
    // Current user role
    role: null,
    
    // Checklist state (NEW format with checklists + items)
    checklist: {
        serviceDate: new Date().toISOString().split('T')[0],
        serviceTime: '10:00',
        currentPreset: 'Standaard Dienst',
        presets: JSON.parse(JSON.stringify(defaultNewPresets)),
        tags: JSON.parse(JSON.stringify(defaultTags)),
        quickNote: { text: '', isPopup: false, timestamp: 0 },
        // Detail view state
        activeView: 'overview',       // 'overview' | 'detail'
        activeChecklistId: null,      // id van open checklist in detail view
        // Scroll positie voor terug navigeren
        _savedScrollPos: 0
    },
    
    // Agenda state — persisted under the single `ichtus_agenda_state`
    // localStorage key, owned by saveAgenda()/loadState() below. The agenda
    // view reads/writes only `appState.agenda.*` and never touches
    // localStorage directly.
    agenda: {
        weekOffset: 0,
        allEvents: [],
        hiddenEvents: [],
        swappedEvents: [],
        hideSpeakers: true,
        customLabel: 'EREDIENST',
        logicalX: 110,
        logicalY: 290,
    }
};

// Migration: convert old flat task format to new checklists format
function migrateOldFormat(oldState) {
    if (!oldState.presets) return false;
    
    // Check if already migrated (has checklists with items array)
    const samplePreset = Object.values(oldState.presets).find(p => p !== null && Array.isArray(p));
    if (samplePreset && samplePreset.length > 0 && samplePreset[0].items) {
        return false; // Already new format
    }
    
    // Convert each preset: flat tasks → one checklist with all items
    const newPresets = {};
    const oldTasksState = oldState.tasksState || {};
    
    Object.keys(oldState.presets).forEach(presetName => {
        const oldTasks = oldState.presets[presetName];
        if (!oldTasks || !Array.isArray(oldTasks)) {
            newPresets[presetName] = [];
            return;
        }
        
        const newItems = oldTasks.map(t => ({
            id: t.id,
            name: t.name,
            completed: !!oldTasksState[t.id],
            assignedTo: t.team || 'Algemeen',
            dueBefore: t.minsBefore || 0,
            tagIds: []
        }));
        
        newPresets[presetName] = [{
            id: 'cl_default_' + presetName.toLowerCase().replace(/\s+/g, '_'),
            name: 'Taken',
            icon: '\u2705',
            collapsed: false,
            items: newItems
        }];
    });
    
    // Replace state
    oldState.presets = newPresets;
    oldState.tasksState = {}; // completed is now on items
    oldState.currentPreset = oldState.preset || 'Standaard Dienst';
    delete oldState.preset;
    if (!oldState.serviceDate) oldState.serviceDate = oldState.startDate || new Date().toISOString().split('T')[0];
    if (!oldState.serviceTime) oldState.serviceTime = oldState.startTime || '10:00';
    delete oldState.startDate;
    delete oldState.startTime;
    if (!oldState.tags) oldState.tags = JSON.parse(JSON.stringify(defaultTags));
    if (!oldState.activeView) oldState.activeView = 'overview';
    if (!oldState.activeChecklistId) oldState.activeChecklistId = null;
    if (!oldState.quickNote) oldState.quickNote = { text: '', isPopup: false, timestamp: 0 };
    
    return true; // migrated
}

// Load from localStorage
function loadState() {
    const savedChecklist = localStorage.getItem('ichtus_checklist_newstate');
    let migrated = false;
    
    if (savedChecklist) {
        try {
            const parsed = JSON.parse(savedChecklist);
            appState.checklist = { ...appState.checklist, ...parsed };
            // Ensure nested objects exist
            if (!appState.checklist.presets || Object.keys(appState.checklist.presets).length === 0) {
                appState.checklist.presets = JSON.parse(JSON.stringify(defaultNewPresets));
            }
            if (!appState.checklist.tags || Object.keys(appState.checklist.tags).length === 0) {
                appState.checklist.tags = JSON.parse(JSON.stringify(defaultTags));
            }
        } catch (e) {}
    } else {
        // Try loading old format
        const oldSaved = localStorage.getItem('ichtus_checklist_state');
        if (oldSaved) {
            try {
                const parsed = JSON.parse(oldSaved);
                migrated = migrateOldFormat(parsed);
                if (migrated) {
                    appState.checklist = { ...appState.checklist, ...parsed };
                }
            } catch (e) {}
        }
    }
    
    // If no data at all, or migration didn't work, use defaults with migration from old tasks
    if (!appState.checklist.presets || Object.keys(appState.checklist.presets).length === 0) {
        appState.checklist.presets = JSON.parse(JSON.stringify(defaultNewPresets));
        // Try old format one more time
        const oldSaved = localStorage.getItem('ichtus_checklist_state');
        if (oldSaved) {
            try {
                const parsed = JSON.parse(oldSaved);
                const dummy = { presets: parsed.presets, tasksState: parsed.tasksState || {} };
                if (migrateOldFormat(dummy)) {
                    appState.checklist.presets = dummy.presets;
                }
            } catch (e) {}
        }
    }
    
    if (!appState.checklist.tags || Object.keys(appState.checklist.tags).length === 0) {
        appState.checklist.tags = JSON.parse(JSON.stringify(defaultTags));
    }
    
    if (!appState.checklist.currentPreset) {
        appState.checklist.currentPreset = 'Standaard Dienst';
    }
    
    // Fix preset names (backward compat)
    if (appState.checklist.currentPreset === 'Standard') appState.checklist.currentPreset = 'Standaard Dienst';
    if (appState.checklist.currentPreset === 'Baptism') appState.checklist.currentPreset = 'Doopdienst';
    if (!appState.checklist.presets[appState.checklist.currentPreset]) {
        // Find first non-null preset
        const valid = Object.keys(appState.checklist.presets).find(k => appState.checklist.presets[k] !== null);
        appState.checklist.currentPreset = valid || 'Standaard Dienst';
    }

    // Load agenda state. Modern path: read the single `ichtus_agenda_state`
    // blob. Legacy fallback (one-shot migration): if the blob is missing,
    // harvest the four standalone keys, write the consolidated blob, and
    // delete the legacy keys so the migration only runs once per browser.
    const savedAgenda = localStorage.getItem('ichtus_agenda_state');
    if (savedAgenda) {
        try {
            const parsed = JSON.parse(savedAgenda);
            appState.agenda = { ...appState.agenda, ...parsed };
        } catch (e) {}
    } else {
        const legacyHidden = JSON.parse(localStorage.getItem('ichtus_hidden_events') || '[]');
        const legacySwapped = JSON.parse(localStorage.getItem('ichtus_swapped_events') || '[]');
        const legacyHideSpeakers = localStorage.getItem('ichtus_hide_speakers');
        const legacyCustomLabel = localStorage.getItem('ichtus_custom_label');

        if (Array.isArray(legacyHidden)) appState.agenda.hiddenEvents = legacyHidden;
        if (Array.isArray(legacySwapped)) appState.agenda.swappedEvents = legacySwapped;
        if (legacyHideSpeakers !== null) appState.agenda.hideSpeakers = legacyHideSpeakers === 'true';
        if (legacyCustomLabel) appState.agenda.customLabel = legacyCustomLabel;

        // Migration only mutates agenda state, so write only the agenda blob.
        saveAgenda();

        localStorage.removeItem('ichtus_hidden_events');
        localStorage.removeItem('ichtus_swapped_events');
        localStorage.removeItem('ichtus_hide_speakers');
        localStorage.removeItem('ichtus_custom_label');
    }
}

// Granular saveers. Each writes only its own localStorage key, so callers
// don't pay for an unrelated JSON.stringify + disk write on every keystroke.
// agenda.js uses saveAgenda(); checklist.js uses saveChecklist();
function saveAgenda() {
    localStorage.setItem('ichtus_agenda_state', JSON.stringify({
        weekOffset: appState.agenda.weekOffset,
        hiddenEvents: appState.agenda.hiddenEvents,
        swappedEvents: appState.agenda.swappedEvents,
        hideSpeakers: appState.agenda.hideSpeakers,
        customLabel: appState.agenda.customLabel,
        logicalX: appState.agenda.logicalX,
        logicalY: appState.agenda.logicalY,
    }));
}

function saveChecklist() {
    localStorage.setItem('ichtus_checklist_newstate', JSON.stringify(appState.checklist));
}

// Back-compat shim — flushes everything. New callers should reach for the
// granular helpers above; saveState exists so utility code or third-party
// callers don't have to know about the split.
function saveState() {
    saveChecklist();
    saveAgenda();
}

// Initialize state on load
loadState();
