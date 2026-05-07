/* ============================================
   CHECKLIST MODULE
   Command Center functionality for SPA
   ============================================ */

const checklistModule = {
    lastProcessedNoteTime: 0,
    initialized: false,

    init() {
        // Skip if already initialized for this view
        if (this.initialized && this._lastView === 'checklist') return;
        this.initialized = true;
        this._lastView = 'checklist';

        // Update form values from state
        const dateInp = document.getElementById('inp-date');
        const timeInp = document.getElementById('inp-time');
        const presetInp = document.getElementById('inp-preset');

        if (dateInp) dateInp.value = appState.checklist.startDate;
        if (timeInp) timeInp.value = appState.checklist.startTime;

        if (presetInp) {
            const validPresets = Object.keys(appState.checklist.presets).filter(k => appState.checklist.presets[k] !== null);
            presetInp.innerHTML = '';
            validPresets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.innerText = p;
                presetInp.appendChild(opt);
            });
            presetInp.value = appState.checklist.preset;
        }

        // Setup event listeners
        this.setupEventListeners();

        // Start timer
        setInterval(() => this.updateTimersAndColors(), 1000);

        // Firebase sync
        if (useFirebase && db) {
            db.collection('commandCenter').doc('activeState').onSnapshot((snap) => {
                if (snap.exists) {
                    const data = snap.data();
                    appState.checklist = { ...appState.checklist, ...data };
                    if (!appState.checklist.presets || Object.keys(appState.checklist.presets).length === 0) {
                        appState.checklist.presets = JSON.parse(JSON.stringify(defaultPresets));
                    }
                    this.processStateChange();
                    this.updateTimersAndColors();
                }
            });
        }

        this.processStateChange();
        this.renderTaskManageList();

        this.initialized = true;
    },

    setupEventListeners() {
        // Date/Time inputs
        document.getElementById('inp-date')?.addEventListener('input', (e) => {
            appState.checklist.startDate = e.target.value;
            this.syncState({ startDate: e.target.value });
        });

        document.getElementById('inp-time')?.addEventListener('input', (e) => {
            appState.checklist.startTime = e.target.value;
            this.syncState({ startTime: e.target.value });
        });

        document.getElementById('inp-preset')?.addEventListener('change', (e) => {
            this.syncState({ preset: e.target.value, tasksState: {} });
        });

        // Preset menu
        document.getElementById('btn-preset-menu')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('preset-dropdown')?.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('preset-dropdown');
            const menuBtn = document.getElementById('btn-preset-menu');
            if (dropdown && menuBtn && !dropdown.contains(e.target) && !menuBtn.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('preset-dropdown')?.classList.add('hidden');
            }
        });

        // Preset actions
        document.getElementById('btn-add-preset')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown')?.classList.add('hidden');
            const name = prompt('Naam voor de nieuwe dienst lijst:');
            if (!name || appState.checklist.presets[name]) return;
            const newPresets = { ...appState.checklist.presets };
            newPresets[name] = [];
            this.syncState({ presets: newPresets, preset: name, tasksState: {} });
        });

        document.getElementById('btn-dup-preset')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown')?.classList.add('hidden');
            const name = prompt('Naam voor de gedupliceerde lijst:', appState.checklist.preset + ' (Kopie)');
            if (!name || appState.checklist.presets[name]) return;
            const newPresets = { ...appState.checklist.presets };
            newPresets[name] = [...(appState.checklist.presets[appState.checklist.preset] || [])].map(t => ({...t, id: 'c'+Math.random().toString(36).substr(2,9)}));
            this.syncState({ presets: newPresets, preset: name, tasksState: {} });
        });

        document.getElementById('btn-rename-preset')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown')?.classList.add('hidden');
            const oldName = appState.checklist.preset;
            const newName = prompt('Nieuwe naam voor \u2018' + oldName + '\u2019:', oldName);
            if (!newName || newName === oldName || appState.checklist.presets[newName]) return;
            const newPresets = { ...appState.checklist.presets };
            newPresets[newName] = newPresets[oldName];
            newPresets[oldName] = null;
            this.syncState({ presets: newPresets, preset: newName });
        });

        document.getElementById('btn-del-preset')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown')?.classList.add('hidden');
            const validPresets = Object.keys(appState.checklist.presets).filter(k => appState.checklist.presets[k] !== null);
            if (validPresets.length <= 1) return alert('Je kunt de laatste lijst niet verwijderen.');
            if (!confirm('Weet je zeker dat je de lijst \u2018' + appState.checklist.preset + '\u2019 wilt verwijderen?')) return;
            const newPresets = { ...appState.checklist.presets };
            newPresets[appState.checklist.preset] = null;
            const newActive = Object.keys(newPresets).find(k => newPresets[k] !== null);
            this.syncState({ presets: newPresets, preset: newActive, tasksState: {} });
        });

        // Notes
        document.getElementById('btn-send-note')?.addEventListener('click', () => {
            const noteInp = document.getElementById('inp-note');
            const popupInp = document.getElementById('inp-popup');
            const text = noteInp ? noteInp.value.trim() : '';
            if (!text) return;
            this.syncState({
                quickNote: { text, isPopup: popupInp ? popupInp.checked : false, timestamp: Date.now() }
            });
            if (noteInp) noteInp.value = '';
        });

        document.getElementById('btn-clear-note')?.addEventListener('click', () => {
            this.syncState({ quickNote: { text: '', isPopup: false, timestamp: Date.now() } });
        });

        // Reset
        document.getElementById('btn-reset')?.addEventListener('click', async () => {
            if (!confirm('Huidige dienst archiveren en resetten?')) return;
            if (useFirebase && db) {
                const activeTasks = this.getActiveTasks();
                const done = activeTasks.filter(t => appState.checklist.tasksState[t.id]).length;
                await db.collection('commandCenterHistory').add({
                    date: new Date().toISOString(),
                    preset: appState.checklist.preset,
                    completed: done,
                    total: activeTasks.length
                });
            }
            this.syncState({ tasksState: {}, quickNote: { text: '', isPopup: false, timestamp: Date.now() } });
        });

        // Modal
        document.getElementById('btn-close-modal')?.addEventListener('click', () => {
            document.getElementById('modal-popup')?.classList.add('hidden');
        });

        // Task modals
        const openTaskModal = () => {
            this.renderTaskManageList();
            document.getElementById('task-modal')?.classList.remove('hidden');
            
            const teamSelect = document.getElementById('new-task-team');
            if (teamSelect) {
                if (appState.role && appState.role !== 'Admin') {
                    teamSelect.value = appState.role;
                    teamSelect.disabled = true;
                } else {
                    teamSelect.disabled = false;
                }
            }
        };

        document.getElementById('btn-open-task-modal')?.addEventListener('click', openTaskModal);
        document.getElementById('btn-open-task-modal-main')?.addEventListener('click', openTaskModal);
        document.getElementById('btn-close-task-modal')?.addEventListener('click', () => {
            document.getElementById('task-modal')?.classList.add('hidden');
        });

        document.getElementById('btn-add-task')?.addEventListener('click', () => {
            const name = document.getElementById('new-task-name')?.value.trim();
            const mins = parseInt(document.getElementById('new-task-time')?.value) || 0;
            const team = document.getElementById('new-task-team')?.value;

            if (!name) return;

            let list = [...(appState.checklist.presets[appState.checklist.preset] || [])];
            list.push({ id: 'c' + Date.now(), team: team, name: name, minsBefore: mins });

            this.syncState({ presets: { ...appState.checklist.presets, [appState.checklist.preset]: list } });

            document.getElementById('new-task-name') && (document.getElementById('new-task-name').value = '');
            document.getElementById('new-task-time') && (document.getElementById('new-task-time').value = '');
            this.renderTaskManageList();
        });
    },

    getActiveTasks() {
        let list = appState.checklist.presets[appState.checklist.preset] || [];
        if (appState.role && appState.role !== 'Admin') {
            list = list.filter(t => t.team === appState.role);
        }
        return list.sort((a, b) => b.minsBefore - a.minsBefore);
    },

    selectRole(role, evt) {
        if (evt && typeof evt.preventDefault === 'function') evt.preventDefault();

        const r = role.toLowerCase();
        if (r.includes('coordinator') || r === 'admin') {
            appState.role = 'Admin';
        } else if (r.includes('beamer')) {
            appState.role = 'Beamer';
        } else if (r.includes('worship') || r.includes('band')) {
            appState.role = 'Worship';
        } else {
            appState.role = role;
        }

        // Hide role selector
        const selector = document.getElementById('role-selector');
        if (selector) {
            selector.classList.add('hidden');
            selector.style.display = 'none';
        }

        // Show/hide admin panels
        if (appState.role === 'Admin') {
            document.getElementById('admin-sidebar')?.classList.remove('hidden');
            document.getElementById('master-sidebar')?.classList.remove('hidden');
            document.getElementById('btn-open-task-modal-main')?.classList.add('hidden');
            document.body.classList.add('checklist-sidebar-open');
        } else {
            document.getElementById('admin-sidebar')?.classList.add('hidden');
            document.getElementById('master-sidebar')?.classList.add('hidden');
            document.getElementById('btn-open-task-modal-main')?.classList.remove('hidden');
            document.body.classList.remove('checklist-sidebar-open');
        }

        this.processStateChange();
        this.updateTimersAndColors();
    },

    showRoleSelector() {
        const selector = document.getElementById('role-selector');
        if (selector) {
            selector.classList.remove('hidden');
            selector.style.display = 'flex';
        }
        document.getElementById('admin-sidebar')?.classList.add('hidden');
        document.getElementById('master-sidebar')?.classList.add('hidden');
        // Remove checklist-sidebar-open so role selector aligns with ichthus-sidebar only
        document.body.classList.remove('checklist-sidebar-open');
        appState.role = null;
    },

    syncState(updates) {
        appState.checklist = { ...appState.checklist, ...updates };
        localStorage.setItem('ichtus_checklist_state', JSON.stringify(appState.checklist));

        this.processStateChange();
        this.updateTimersAndColors();

        if (useFirebase && db) {
            try {
                db.collection('commandCenter').doc('activeState').set(updates, { merge: true });
            } catch (e) {
                console.error('Firebase update failed', e);
            }
        }
    },

    processStateChange() {
        const dateInp = document.getElementById('inp-date');
        if (dateInp && document.activeElement !== dateInp) dateInp.value = appState.checklist.startDate;

        const timeInp = document.getElementById('inp-time');
        if (timeInp && document.activeElement !== timeInp) timeInp.value = appState.checklist.startTime;

        const presetInp = document.getElementById('inp-preset');
        if (presetInp && document.activeElement !== presetInp) {
            const validPresets = Object.keys(appState.checklist.presets).filter(k => appState.checklist.presets[k] !== null);
            presetInp.innerHTML = '';
            validPresets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.innerText = p;
                presetInp.appendChild(opt);
            });
            presetInp.value = appState.checklist.preset;
        }

        this.renderTaskDOM();
        this.renderProgressBars();
        this.handleNotes();
    },

    renderTaskDOM() {
        const container = document.getElementById('checklist');
        if (!container) return;

        const activeTasks = this.getActiveTasks();

        if (activeTasks.length === 0) {
            container.innerHTML = '<div class=\"p-6 text-gray-400 text-center italic\">Geen taken gevonden voor de geselecteerde rol (' + (appState.role || 'Alle') + ').</div>';
            return;
        }

        let idsMatch = true;
        if (container.children.length === activeTasks.length) {
            activeTasks.forEach((t, i) => {
                if (container.children[i].id !== 'task-row-' + t.id) idsMatch = false;
            });
        } else {
            idsMatch = false;
        }

        if (!idsMatch) {
            container.innerHTML = '';
            activeTasks.forEach(task => {
                const div = document.createElement('div');
                div.id = 'task-row-' + task.id;
                div.className = 'task-row';

                div.innerHTML = '<div class=\"task-info-group\"><input type=\"checkbox\" id=\"check-' + task.id + '\" class=\"task-checkbox\"><div><div id=\"name-' + task.id + '\" class=\"task-name\">' + task.name + '</div><div id=\"team-' + task.id + '\" class=\"task-team\">' + task.team + '</div></div></div><div id=\"time-' + task.id + '\" class=\"task-time heading-font\"></div>';
                container.appendChild(div);

                document.getElementById('check-' + task.id)?.addEventListener('change', (e) => {
                    const tasksState = { ...appState.checklist.tasksState };
                    tasksState[task.id] = e.target.checked;
                    this.syncState({ tasksState });
                });
            });
        } else {
            activeTasks.forEach(task => {
                const nameEl = document.getElementById('name-' + task.id);
                const teamEl = document.getElementById('team-' + task.id);
                if (nameEl && nameEl.innerText !== task.name) nameEl.innerText = task.name;
                if (teamEl && teamEl.innerText !== task.team) teamEl.innerText = task.team;
            });
        }
    },

    updateTimersAndColors() {
        const now = new Date();
        let target = new Date();

        if (appState.checklist.startDate) {
            const [y, mo, d] = appState.checklist.startDate.split('-').map(Number);
            target.setFullYear(y, mo - 1, d);
        }

        const [h, m] = (appState.checklist.startTime || '10:00').split(':').map(Number);
        target.setHours(h, m, 0, 0);

        const diff = target - now;
        const abs = Math.abs(diff);
        const days = Math.floor(abs / 86400000);
        const remH = Math.floor((abs % 86400000) / 3600000).toString().padStart(2, '0');
        const gh = Math.floor(abs / 3600000).toString().padStart(2, '0');
        const gm = Math.floor((abs % 3600000) / 60000).toString().padStart(2, '0');
        const gs = Math.floor((abs % 60000) / 1000).toString().padStart(2, '0');

        const countEl = document.getElementById('main-countdown');
        if (countEl) {
            countEl.innerText = days > 0 ? (diff < 0 ? '-' : '') + days + 'd ' + remH + ':' + gm + ':' + gs : (diff < 0 ? '-' : '') + gh + ':' + gm + ':' + gs;
            countEl.style.color = diff < 0 ? '#ed1c24' : '#f47920';
        }

        this.getActiveTasks().forEach(task => {
            const row = document.getElementById('task-row-' + task.id);
            if (!row) return;

            let deadline = new Date(target);
            deadline.setMinutes(target.getMinutes() - task.minsBefore);
            const done = appState.checklist.tasksState[task.id];

            const timeEl = document.getElementById('time-' + task.id);
            if (timeEl) timeEl.innerText = deadline.getHours().toString().padStart(2, '0') + ':' + deadline.getMinutes().toString().padStart(2, '0');

            const checkEl = document.getElementById('check-' + task.id);
            if (checkEl) checkEl.checked = !!done;

            row.classList.remove('task-completed', 'task-overdue', 'task-upcoming', 'animate-pulse');

            if (done) {
                row.classList.add('task-completed');
            } else {
                const minsTo = (deadline - now) / 60000;
                if (minsTo <= 0) {
                    row.classList.add('task-overdue', 'animate-pulse');
                } else if (minsTo <= 10) {
                    row.classList.add('task-upcoming');
                }
            }
        });
    },

    renderProgressBars() {
        const activeTasks = this.getActiveTasks();
        const teams = ['Beamer', 'Worship'];
        const container = document.getElementById('progress-container');
        if (!container) return;

        let html = '';

        teams.forEach(team => {
            const teamTasks = activeTasks.filter(t => t.team === team);
            const total = teamTasks.length;
            const done = teamTasks.filter(t => appState.checklist.tasksState[t.id]).length;
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);

            html += '<div class=\"progress-item\"><div class=\"progress-header\"><span class=\"progress-team\">' + team + '</span><span class=\"progress-pct\">' + pct + '%</span></div><div class=\"progress-track\"><div class=\"progress-fill\" style=\"width: ' + pct + '%\"></div></div></div>';
        });

        container.innerHTML = html;
    },

    handleNotes() {
        const banner = document.getElementById('note-banner');
        const modal = document.getElementById('modal-popup');
        if (!banner) return;

        const note = appState.checklist.quickNote;
        if (!note || !note.text) {
            banner.classList.add('hidden');
            return;
        }

        banner.innerText = note.text;
        banner.classList.remove('hidden');

        if (modal && note.isPopup && note.timestamp > this.lastProcessedNoteTime) {
            const modalText = document.getElementById('modal-text');
            if (modalText) modalText.innerText = note.text;
            modal.classList.remove('hidden');
            this.lastProcessedNoteTime = note.timestamp;
        }
    },

    renderTaskManageList() {
        const container = document.getElementById('task-manage-list');
        if (!container) return;

        let list = appState.checklist.presets[appState.checklist.preset] || [];

        if (appState.role && appState.role !== 'Admin') {
            list = list.filter(t => t.team === appState.role);
        }

        container.innerHTML = '';

        [...list].sort((a, b) => b.minsBefore - a.minsBefore).forEach(task => {
            const div = document.createElement('div');
            div.className = 'manage-list-item';

            const isTeamDisabled = (appState.role && appState.role !== 'Admin') ? 'disabled' : '';
            div.innerHTML = '<input type=\"text\" value=\"' + task.name + '\" class=\"manage-input flex-1\" onchange=\"checklistModule.updateTask(\u0027' + task.id + '\u0027, \u0027name\u0027, this.value)\"><input type=\"number\" value=\"' + task.minsBefore + '\" class=\"manage-input w-16\" onchange=\"checklistModule.updateTask(\u0027' + task.id + '\u0027, \u0027minsBefore\u0027, this.value)\"><select ' + isTeamDisabled + ' class=\"manage-input w-24\" onchange=\"checklistModule.updateTask(\u0027' + task.id + '\u0027, \u0027team\u0027, this.value)\"><option value=\"Beamer\" ' + (task.team === 'Beamer' ? 'selected' : '') + '>Beamer</option><option value=\"Worship\" ' + (task.team === 'Worship' ? 'selected' : '') + '>Worship</option></select><button onclick=\"checklistModule.deleteTask(\u0027' + task.id + '\u0027)\" class=\"btn-delete-task\" title=\"Verwijderen\">✕</button>';
            container.appendChild(div);
        });
    },

    updateTask(id, field, value) {
        let list = [...(appState.checklist.presets[appState.checklist.preset] || [])];
        list = list.map(t => t.id === id ? { ...t, [field]: field === 'minsBefore' ? parseInt(value) || 0 : value } : t);
        this.syncState({ presets: { ...appState.checklist.presets, [appState.checklist.preset]: list } });
    },

    deleteTask(id) {
        if (!confirm('Taak definitief verwijderen?')) return;
        let list = [...(appState.checklist.presets[appState.checklist.preset] || [])];
        list = list.filter(t => t.id !== id);
        this.syncState({ presets: { ...appState.checklist.presets, [appState.checklist.preset]: list } });
        this.renderTaskManageList();
    }
};

// Auto-initialize when view is shown - handled by router