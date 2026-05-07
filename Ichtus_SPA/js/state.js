/* ============================================
   SHARED STATE MANAGEMENT
   Single source of truth for the SPA
   ============================================ */

// Checked-in state (persisted)
const defaultPresets = {
    'Standaard Dienst': [
        { id: 't1', team: 'Beamer', name: 'Projectoren aan', minsBefore: 40 },
        { id: 't2', team: 'Beamer', name: 'Lobby NDI Feed checken', minsBefore: 30 },
        { id: 't3', team: 'Worship', name: 'Soundcheck & In-ears', minsBefore: 60 },
        { id: 't4', team: 'Worship', name: 'Lyrics syncen', minsBefore: 20 },
        { id: 't5', team: 'Beamer', name: 'Livestream Lower Thirds test', minsBefore: 15 },
        { id: 't6', team: 'Beamer', name: 'Welkomstlogo op scherm', minsBefore: 5 },
        { id: 't7', team: 'Worship', name: 'Band klaar op podium', minsBefore: 2 }
    ],
    'Doopdienst': [
        { id: 't1', team: 'Beamer', name: 'Projectoren aan', minsBefore: 40 },
        { id: 't2', team: 'Beamer', name: 'Lobby NDI Feed checken', minsBefore: 30 },
        { id: 't3', team: 'Worship', name: 'Soundcheck & In-ears', minsBefore: 60 },
        { id: 't4', team: 'Worship', name: 'Lyrics syncen', minsBefore: 20 },
        { id: 't5', team: 'Beamer', name: 'Livestream Lower Thirds test', minsBefore: 15 },
        { id: 't6', team: 'Beamer', name: 'Welkomstlogo op scherm', minsBefore: 5 },
        { id: 't7', team: 'Worship', name: 'Band klaar op podium', minsBefore: 2 },
        { id: 'b1', team: 'Beamer', name: 'Doopnamen voorbereiden', minsBefore: 25 },
        { id: 'b2', team: 'Worship', name: 'Handdoeken & Microfoon', minsBefore: 15 }
    ]
};

// Global state
const appState = {
    // Current user role
    role: null,
    
    // Checklist state
    checklist: {
        startDate: new Date().toISOString().split('T')[0],
        startTime: '10:00',
        preset: 'Standaard Dienst',
        presets: JSON.parse(JSON.stringify(defaultPresets)),
        tasksState: {},
        quickNote: { text: '', isPopup: false, timestamp: 0 }
    },
    
    // Agenda state
    agenda: {
        weekOffset: 0,
        allEvents: [],
        hideSpeakers: true,
        customLabel: 'EREDIENST',
        hiddenEvents: [],
        swappedEvents: []
    }
};

// Load from localStorage
function loadState() {
    const savedChecklist = localStorage.getItem('ichtus_checklist_state');
    if (savedChecklist) {
        try {
            const parsed = JSON.parse(savedChecklist);
            appState.checklist = { ...appState.checklist, ...parsed };
            if (!appState.checklist.presets || Object.keys(appState.checklist.presets).length === 0) {
                appState.checklist.presets = JSON.parse(JSON.stringify(defaultPresets));
            }
        } catch (e) {}
    }
    
    // Fix preset names
    if (appState.checklist.preset === 'Standard') appState.checklist.preset = 'Standaard Dienst';
    if (appState.checklist.preset === 'Baptism') appState.checklist.preset = 'Doopdienst';
    if (!appState.checklist.presets[appState.checklist.preset]) {
        appState.checklist.preset = 'Standaard Dienst';
    }

    // Load agenda state
    const savedAgenda = localStorage.getItem('ichtus_agenda_state');
    if (savedAgenda) {
        try {
            const parsed = JSON.parse(savedAgenda);
            appState.agenda = { ...appState.agenda, ...parsed };
        } catch (e) {}
    }
    
    // Load hide speakers and custom label
    const savedHideSpeakers = localStorage.getItem('ichtus_hide_speakers');
    if (savedHideSpeakers !== null) {
        appState.agenda.hideSpeakers = savedHideSpeakers === 'true';
    }
    const savedCustomLabel = localStorage.getItem('ichtus_custom_label');
    if (savedCustomLabel) {
        appState.agenda.customLabel = savedCustomLabel;
    }
}

// Save state to localStorage
function saveState() {
    localStorage.setItem('ichtus_checklist_state', JSON.stringify(appState.checklist));
    localStorage.setItem('ichtus_agenda_state', JSON.stringify({
        weekOffset: appState.agenda.weekOffset,
        hiddenEvents: appState.agenda.hiddenEvents,
        swappedEvents: appState.agenda.swappedEvents
    }));
}

// Initialize state on load
loadState();