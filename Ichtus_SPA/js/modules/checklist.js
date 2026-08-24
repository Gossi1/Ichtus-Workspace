/* ============================================
   CHECKLIST MODULE
   Command Center functionality for SPA
   ============================================ */

const checklistModule = {
    lastProcessedNoteTime: 0,
    initialized: false,
    _contextMenuActive: false,

    init() {
        // Skip if already initialized for this view
        if (this.initialized && this._lastView === 'checklist') return;
        this.initialized = true;
        this._lastView = 'checklist';

        // Update form values from state
        const dateInp = document.getElementById('inp-date');
        const timeInp = document.getElementById('inp-time');

        if (dateInp) dateInp.value = appState.checklist.startDate || appState.checklist.serviceDate || new Date().toISOString().split('T')[0];
        if (timeInp) timeInp.value = appState.checklist.startTime || appState.checklist.serviceTime || '10:00';

        this._populatePresetDropdown();

        // Setup event listeners
        this.setupEventListeners();
        this._setupContextMenuListeners();

        // Start timer — no-op while another view is active so the per-second
        // DOM walk over every task row stays scoped to the checklist view.
        this._timersInterval = setInterval(() => {
            if (!router.isChecklistActive()) return;
            this.updateTimersAndColors();
        }, 1000);

        // Local-first sync: haal state op bij de server (REST) en luister
        // live naar de WebSocket hub. Firestore is enkel backup op de server.
        this._initCommandCenterSync();

        this.processStateChange();
        this.renderTaskManageList();
        this.renderChecklistOverview();
        this._renderTagFilters();

        this.initialized = true;
    },

    cleanup() {
        if (this._timersInterval) { clearInterval(this._timersInterval); this._timersInterval = null; }
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

        // Preset trigger (click to toggle dropdown)
        document.getElementById('btn-preset-trigger')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('preset-dropdown-wrapper')?.classList.toggle('open');
        });

        // Close preset dropdown on outside click
        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('preset-dropdown-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                wrapper.classList.remove('open');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('preset-dropdown-wrapper')?.classList.remove('open');
            }
        });

        // Preset actions
        document.getElementById('btn-add-preset-modern')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown-wrapper')?.classList.remove('open');
            const name = prompt(__('cl_preset_new_name'));
            if (!name || appState.checklist.presets[name]) return;
            const newPresets = { ...appState.checklist.presets };
            newPresets[name] = [];
            this.syncState({ presets: newPresets, preset: name, tasksState: {} });
        });

        document.getElementById('btn-dup-preset-modern')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown-wrapper')?.classList.remove('open');
            const name = prompt(__('cl_preset_rename_prompt') + ' \u2018' + appState.checklist.preset + '\u2019:', appState.checklist.preset + ' ' + __('cl_preset_dup_suffix'));
            if (!name || appState.checklist.presets[name]) return;
            const newPresets = { ...appState.checklist.presets };
            newPresets[name] = [...(appState.checklist.presets[appState.checklist.preset] || [])].map(t => ({...t, id: 'c'+Math.random().toString(36).substr(2,9)}));
            this.syncState({ presets: newPresets, preset: name, tasksState: {} });
        });

        document.getElementById('btn-rename-preset-modern')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown-wrapper')?.classList.remove('open');
            const oldName = appState.checklist.preset;
            const newName = prompt(__('cl_preset_rename_prompt') + ' ‘' + oldName + '’:', oldName);
            if (!newName || newName === oldName || appState.checklist.presets[newName]) return;
            const newPresets = { ...appState.checklist.presets };
            newPresets[newName] = newPresets[oldName];
            newPresets[oldName] = null;
            this.syncState({ presets: newPresets, preset: newName });
        });

        document.getElementById('btn-del-preset-modern')?.addEventListener('click', () => {
            document.getElementById('preset-dropdown-wrapper')?.classList.remove('open');
            const validPresets = Object.keys(appState.checklist.presets).filter(k => appState.checklist.presets[k] !== null);
            if (validPresets.length <= 1) return alert(__('cl_preset_cannot_delete'));
            if (!confirm(__('cl_preset_confirm_delete') + ' \u2018' + appState.checklist.preset + '\u2019 ' + __('cl_preset_wilt_verwijderen'))) return;
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
        document.getElementById('btn-reset')?.addEventListener('click', () => this.resetAndArchive());

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
        // Keep currentPreset in sync with preset (new code uses currentPreset)
        if (updates.preset !== undefined) {
            updates.currentPreset = updates.preset;
        }
        appState.checklist = { ...appState.checklist, ...updates };
        localStorage.setItem('ichtus_checklist_state', JSON.stringify(appState.checklist));

        this.processStateChange();
        this.updateTimersAndColors();

        // Push naar de server (local-first): die merged, broadcast via
        // WebSocket en backed up gedebounced naar Firestore.
        this._pushState(updates);
    },

    // ── Local-first server sync (geen direct Firestore gebruik meer) ──

    _initCommandCenterSync() {
        if (this._ccListenerAdded) return;
        this._ccListenerAdded = true;

        document.addEventListener('ws:commandCenter:state', (e) => {
            const data = e.detail;
            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                this._applyRemoteState(data);
            }
        });

        this._fetchCommandCenterState();
    },

    async _fetchCommandCenterState() {
        try {
            const resp = await fetch('/api/commandcenter/state', { cache: 'no-store' });
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                this._applyRemoteState(data);
            }
        } catch (e) {
            console.warn('[CC] Server state ophalen mislukt:', e.message);
        }
    },

    _pushState(patch) {
        fetch('/api/commandcenter/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        }).catch((e) => {
            console.warn('[CC] State push mislukt:', e.message);
        });
    },

    // Merge remote (server) state in appState.checklist, met migratie
    // van het oude 'flat tasks' formaat.
    _applyRemoteState(data) {
        const merged = { ...data };
        if (merged.presets) {
            const samplePreset = Object.values(merged.presets).find(p => p !== null && Array.isArray(p));
            if (samplePreset && samplePreset.length > 0 && !samplePreset[0].items) {
                // Old format detected — migrate flat tasks to checklist format
                const migratedPresets = {};
                const tasksState = merged.tasksState || {};
                Object.keys(merged.presets).forEach(presetName => {
                    const oldTasks = merged.presets[presetName];
                    if (!oldTasks || !Array.isArray(oldTasks)) {
                        migratedPresets[presetName] = [];
                        return;
                    }
                    const newItems = oldTasks.map(t => ({
                        id: t.id,
                        name: t.name,
                        completed: !!tasksState[t.id],
                        assignedTo: t.team || 'Algemeen',
                        dueBefore: t.minsBefore || 0,
                        tagIds: []
                    }));
                    migratedPresets[presetName] = [{
                        id: 'cl_default_' + presetName.toLowerCase().replace(/\s+/g, '_'),
                        name: 'Taken',
                        icon: '\u2705',
                        collapsed: false,
                        items: newItems
                    }];
                });
                merged.presets = migratedPresets;
                delete merged.tasksState;
            }
        }
        appState.checklist = { ...appState.checklist, ...merged };
        if (!appState.checklist.presets || Object.keys(appState.checklist.presets).length === 0) {
            appState.checklist.presets = JSON.parse(JSON.stringify(defaultNewPresets));
        }
        this.renderChecklistOverview();
        this.processStateChange();
        this.updateTimersAndColors();
    },

    processStateChange() {
        const dateInp = document.getElementById('inp-date');
        if (dateInp && document.activeElement !== dateInp) dateInp.value = appState.checklist.startDate || appState.checklist.serviceDate || new Date().toISOString().split('T')[0];

        const timeInp = document.getElementById('inp-time');
        if (timeInp && document.activeElement !== timeInp) timeInp.value = appState.checklist.startTime || appState.checklist.serviceTime || '10:00';

        this._populatePresetDropdown();

        this.renderTaskDOM();
        this.renderProgressBars();
        this.handleNotes();
        this._renderMetrics();
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
            div.innerHTML = '<input type=\"text\" value=\"' + task.name + '\" class=\"manage-input flex-1\" onchange=\"checklistModule.updateTask(\u0027' + task.id + '\u0027, \u0027name\u0027, this.value)\"><input type=\"number\" value=\"' + task.minsBefore + '\" class=\"manage-input w-16\" onchange=\"checklistModule.updateTask(\u0027' + task.id + '\u0027, \u0027minsBefore\u0027, this.value)\"><select ' + isTeamDisabled + ' class=\"manage-input w-24\" onchange=\"checklistModule.updateTask(\u0027' + task.id + '\u0027, \u0027team\u0027, this.value)\"><option value=\"Beamer\" ' + (task.team === 'Beamer' ? 'selected' : '') + '>Beamer</option><option value=\"Worship\" ' + (task.team === 'Worship' ? 'selected' : '') + '>Worship</option></select><button onclick=\"checklistModule.deleteTask(\u0027' + task.id + '\u0027)\" class=\"btn-delete-task\" title=\"Verwijderen\">âœ•</button>';
            container.appendChild(div);
        });
    },

    updateTask(id, field, value) {
        let list = [...(appState.checklist.presets[appState.checklist.preset] || [])];
        list = list.map(t => t.id === id ? { ...t, [field]: field === 'minsBefore' ? parseInt(value) || 0 : value } : t);
        this.syncState({ presets: { ...appState.checklist.presets, [appState.checklist.preset]: list } });
    },

    deleteTask(id) {
        if (!confirm(__('cl_legacy_delete_task'))) return;
        let list = [...(appState.checklist.presets[appState.checklist.preset] || [])];
        list = list.filter(t => t.id !== id);
        this.syncState({ presets: { ...appState.checklist.presets, [appState.checklist.preset]: list } });
        this.renderTaskManageList();
    },

    // ========================================================================
    // NEW CHECKLIST SYSTEM - Helpers
    // ========================================================================

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str || ''));
        return div.innerHTML;
    },

    _getChecklists() {
        // Support both currentPreset (new) and preset (old fallback)
        const presetName = appState.checklist.currentPreset || appState.checklist.preset;
        return appState.checklist.presets[presetName] || [];
    },

    _getTags() {
        const t = appState.checklist.tags || {};
        return Object.values(t).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    _formatDueDateLabel(dueDate) {
        if (!dueDate) return '';
        const parts = dueDate.split('-');
        if (parts.length !== 3) return dueDate;
        const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
        return parseInt(parts[2]) + ' ' + months[parseInt(parts[1]) - 1] || parts[2] + '/' + parts[1];
    },

    _repeatLabel(repeat) {
        const labels = {
            'daily': __('cl_repeat_daily'),
            'weekly': __('cl_repeat_weekly'),
            'biweekly': __('cl_repeat_biweekly'),
            'monthly': __('cl_repeat_monthly'),
            'yearly': __('cl_repeat_yearly')
        };
        return labels[repeat] || '';
    },

    _syncChecklistState() {
        saveChecklist();
        this._pushState({ presets: appState.checklist.presets });
        this.processStateChange();
    },

    // ========================================================================
    // CREATE CHECKLIST MODAL
    // ========================================================================

    showCreateChecklistModal() {
        const modal = document.getElementById('cl-create-checklist-modal');
        if (modal) {
            modal.classList.remove('hidden');
            document.getElementById('cl-create-checklist-name')?.focus();
            document.getElementById('cl-checklist-due-date').value = appState.checklist.serviceDate || new Date().toISOString().split('T')[0];
            document.getElementById('cl-checklist-due-time').value = appState.checklist.serviceTime || '10:00';
        }
    },

    closeCreateChecklistModal() {
        const modal = document.getElementById('cl-create-checklist-modal');
        if (modal) modal.classList.add('hidden');
    },

    submitCreateChecklist() {
        const nameInput = document.getElementById('cl-create-checklist-name');
        const dateInput = document.getElementById('cl-checklist-due-date');
        const timeInput = document.getElementById('cl-checklist-due-time');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) return;
        const dueDate = dateInput ? dateInput.value : '';
        const dueTime = timeInput ? timeInput.value : '';
        this.createChecklist(name, null, true, dueDate, dueTime);
        this.closeCreateChecklistModal();
        this.closeContextMenu();
    },

    // ========================================================================
    // OVERVIEW RENDERING
    // ========================================================================

    _renderMetrics() {
        const checklists = this._getChecklists();
        const totalCl = checklists.length;
        let totalItems = 0;
        let doneItems = 0;
        checklists.forEach(cl => {
            const items = cl.items || [];
            totalItems += items.length;
            doneItems += items.filter(i => i.completed).length;
        });
        const pct = totalItems === 0 ? 0 : Math.round((doneItems / totalItems) * 100);
        const setVal = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.innerText = v;
        };
        setVal('cl-metric-total', totalCl);
        setVal('cl-metric-open', totalItems - doneItems);
        setVal('cl-metric-progress', pct + '%');
    },

    renderChecklistOverview() {
        const listEl = document.getElementById('cl-checklist-list');
        if (!listEl) return;
        const checklists = this._getChecklists();
        const tagFilter = this.getActiveTagFilter();
        const filtered = tagFilter ? checklists.filter(cl => cl.tagId === tagFilter) : checklists;

        if (filtered.length === 0) {
            listEl.innerHTML = '<div class="cl-empty-state"><p>' + __('cl_no_checklists') + '</p><button class="cl-empty-btn" onclick="checklistModule.showCreateChecklistModal()">' + __('cl_new_checklist') + '</button></div>';
            return;
        }

        listEl.innerHTML = '';
        filtered.forEach(cl => {
            const card = this._renderChecklistCard(cl);
            if (card) listEl.appendChild(card);
        });

        // Refresh tag filters
        this._renderTagFilters();
    },

    _renderChecklistCard(cl) {
        if (!cl) return null;
        const card = document.createElement('div');
        card.className = 'cl-checklist-card';
        card.id = 'cl-item-' + cl.id;

        const items = cl.items || [];
        const total = items.length;
        const done = items.filter(i => i.completed).length;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);

        let progressHtml = '';
        if (total > 0) {
            progressHtml = '<div class="cl-checklist-progress-row"><div class="cl-checklist-progress-bar"><div class="cl-checklist-progress-fill" style="width:' + pct + '%;"></div></div><span class="cl-checklist-progress-pct">' + pct + '%</span></div>';
        }

        const dueLabel = this._formatDueDateLabel(cl.dueDate);
        const dueTimeStr = cl.dueTime || '';
        const repeatIcon = cl.repeat && cl.repeat !== 'none'
            ? '<span class="cl-repeat-icon" title="' + this._escapeHtml(this._repeatLabel(cl.repeat)) + '"><svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" height="14" width="14"><path d="M11 5.466V4H5a4 4 0 0 0 -3.584 5.777 0.5 0.5 0 1 1 -0.896 0.446A5 5 0 0 1 5 3h6V1.534a0.25 0.25 0 0 1 0.41 -0.192l2.36 1.966c0.12 0.1 0.12 0.284 0 0.384l-2.36 1.966a0.25 0.25 0 0 1 -0.41 -0.192m3.81 0.086a0.5 0.5 0 0 1 0.67 0.225A5 5 0 0 1 11 13H5v1.466a0.25 0.25 0 0 1 -0.41 0.192l-2.36 -1.966a0.25 0.25 0 0 1 0 -0.384l2.36 -1.966a0.25 0.25 0 0 1 0.41 0.192V12h6a4 4 0 0 0 3.585 -5.777 0.5 0.5 0 0 1 0.225 -0.67Z" </path></svg></span>'
            : '';
        card.innerHTML = '<div class="cl-checklist-header"><span class="cl-checklist-name">' + this._escapeHtml(cl.name) + '</span>' + repeatIcon + '<span class="cl-checklist-progress">' + done + '/' + total + '</span></div>' +
            (dueLabel || dueTimeStr ? '<div class="cl-checklist-due"><span class="cl-due-label">' + (dueLabel ? dueLabel : '') + '</span>' +
            (dueTimeStr ? '<span class="cl-due-time heading-font">' + this._escapeHtml(dueTimeStr) + '</span>' : '') + '</div>' : '') +
            progressHtml;

        card.addEventListener('click', (e) => {
            if (!e.target.closest('.cl-context-menu, .cl-checklist-card .cl-tag-pill')) {
                this.openChecklistDetail(cl.id);
            }
        });

        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showChecklistOverviewMenu(e, cl.id);
        });

        return card;
    },

    // ========================================================================
    // DETAIL VIEW
    // ========================================================================

    openChecklistDetail(checklistId) {
        const checklists = this._getChecklists();
        const cl = checklists.find(c => c.id === checklistId);
        if (!cl) return;

        appState.checklist.activeView = 'detail';
        appState.checklist.activeChecklistId = checklistId;

        const overview = document.getElementById('cl-overview');
        const detail = document.getElementById('cl-detail');
        const backBtn = document.getElementById('cl-back-btn');
        const main = document.querySelector('.checklist-main');

        if (overview) overview.classList.add('hidden');
        if (detail) detail.classList.remove('hidden');
        if (backBtn) backBtn.classList.remove('hidden');
        if (main) main.classList.add('detail-open');

        this._renderChecklistDetail(checklistId);
        this.closeContextMenu();
    },

    closeChecklistDetail() {
        appState.checklist.activeView = 'overview';
        appState.checklist.activeChecklistId = null;

        const overview = document.getElementById('cl-overview');
        const detail = document.getElementById('cl-detail');
        const backBtn = document.getElementById('cl-back-btn');
        const main = document.querySelector('.checklist-main');

        if (overview) overview.classList.remove('hidden');
        if (detail) detail.classList.add('hidden');
        if (backBtn) backBtn.classList.add('hidden');
        if (main) main.classList.remove('detail-open');
    },

    _renderChecklistDetail(checklistId) {
        const container = document.getElementById('cl-detail-content');
        if (!container) return;

        const checklists = this._getChecklists();
        const cl = checklists.find(c => c.id === checklistId);
        if (!cl) { container.innerHTML = ''; return; }

        const items = cl.items || [];
        const total = items.length;
        const done = items.filter(i => i.completed).length;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);

        const dueStr = cl.dueDate ? ' \u2022 ' + this._formatDueDateLabel(cl.dueDate) : '';
        const repeatStr = cl.repeat && cl.repeat !== 'none' ? ' \u2022 ' + this._repeatLabel(cl.repeat) : '';

        let html = '<div class="cl-detail-header">';
        html += '  <div class="cl-detail-header-left">';
        html += '    <span class="cl-detail-name">' + this._escapeHtml(cl.name) + '</span>';
        html += '    <span style="font-size:0.8rem;color:var(--text-muted);">' + done + '/' + total + (dueStr || repeatStr ? dueStr + repeatStr : '') + '</span>';
        html += '  </div>';
        html += '  <button class="cl-btn cl-btn-add" id="cl-detail-add-item" title="Item toevoegen">+</button>';
        html += '</div>';

        if (total > 0) {
            html += '<div class="cl-detail-progress-wrap">';
            html += '  <div class="cl-checklist-progress-row">';
            html += '    <div class="cl-checklist-progress-bar"><div class="cl-checklist-progress-fill" style="width:' + pct + '%;"></div></div>';
            html += '    <span class="cl-checklist-progress-pct">' + pct + '%</span>';
            html += '  </div>';
            html += '</div>';
        }

        html += '<div class="cl-detail-items">';
        const incomplete = items.filter(i => !i.completed);
        const completedItems = items.filter(i => i.completed);

        incomplete.forEach(item => {
            html += this._renderItemCard(item, checklistId, false);
        });

        if (completedItems.length > 0) {
            html += '<div class="cl-completed-separator"><span class="cl-completed-separator-text">' + completedItems.length + ' voltooid</span></div>';
            completedItems.forEach(item => {
                html += this._renderItemCard(item, checklistId, true);
            });
        }

        if (total === 0) {
            html += '<div class="cl-empty-state"><p>' + __('cl_empty_items') + '</p><button class="cl-empty-btn" onclick="checklistModule.showAddItemModal(\'' + checklistId + '\')">' + __('cl_add_item') + '</button></div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // Bind clicks on item cards (click card = toggle item, click checkbox directly also works)
        container.querySelectorAll('.cl-item-card').forEach(card => {
            const checkbox = card.querySelector('.cl-item-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const itemId = card.dataset.itemId;
                    if (itemId) this.toggleItemCheck(checklistId, itemId);
                });
            }
            // Click on card (but not the checkbox itself) toggles the item
            card.addEventListener('click', (e) => {
                if (e.target.closest('.cl-item-checkbox')) return;
                const itemId = card.dataset.itemId;
                if (itemId) this.toggleItemCheck(checklistId, itemId);
            });
            // Context menu on item cards
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const itemId = card.dataset.itemId;
                if (itemId) this.showChecklistItemMenu(e, checklistId, itemId);
            });
        });

        // Bind add item button
        const addBtn = document.getElementById('cl-detail-add-item');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAddItemModal(checklistId));
        }
    },

    _renderItemCard(item, checklistId, isCompleted) {
        const tags = this._getTags();
        const itemTags = (item.tagIds || []).map(tid => tags.find(t => t.id === tid)).filter(Boolean);
        const teamStr = item.assignedTo ? '<span class="cl-item-card-team">' + this._escapeHtml(item.assignedTo) + '</span>' : '';
        let timeStr = '';
        if (item.dueBefore != null && item.dueBefore > 0) {
            const serviceParts = (appState.checklist.serviceTime || '10:00').split(':');
            const serviceMins = parseInt(serviceParts[0]) * 60 + parseInt(serviceParts[1]);
            const itemMins = Math.max(0, serviceMins - item.dueBefore);
            const hh = String(Math.floor(itemMins / 60)).padStart(2, '0');
            const mm = String(itemMins % 60).padStart(2, '0');
            timeStr = '<span class="cl-item-card-time">' + hh + ':' + mm + '</span>';
        }

        let html = '<div class="cl-item-card' + (isCompleted ? ' cl-item-card-completed' : '') + '" data-item-id="' + item.id + '">';
        html += '  <div class="cl-item-card-top">';
        html += '    <input type="checkbox" class="cl-item-checkbox" ' + (item.completed ? 'checked' : '') + '>';
        html += '    <span class="cl-item-card-name' + (item.completed ? ' completed' : '') + '">' + this._escapeHtml(item.name) + '</span>';
        html += '  </div>';

        if (itemTags.length > 0) {
            html += '  <div class="cl-item-card-tags">';
            itemTags.forEach(t => {
                html += '    <span class="cl-tag-pill" style="--tag-color:' + t.color + ';">' + this._escapeHtml(t.icon || '') + ' ' + this._escapeHtml(t.name) + '</span>';
            });
            html += '  </div>';
        }

        if (teamStr || timeStr) {
            html += '  <div class="cl-item-card-footer">' + teamStr + timeStr + '</div>';
        }

        html += '</div>';

        return html;
    },

    // ========================================================================
    // ADD ITEM MODAL
    // ========================================================================

    showAddItemModal(checklistId) {
        const modal = document.getElementById('cl-add-item-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.dataset.checklistId = checklistId;
            delete modal.dataset.editItemId;
            // Clear fields
            const nameInput = document.getElementById('cl-add-item-name');
            const timeInput = document.getElementById('cl-add-item-time');
            const teamInput = document.getElementById('cl-add-item-team');
            if (nameInput) nameInput.value = '';
            if (timeInput) timeInput.value = '';
            if (teamInput) teamInput.value = '';
            // Reset submit button text
            const submitBtn = document.getElementById('cl-add-item-submit');
            if (submitBtn) submitBtn.textContent = __('add');
            // Focus and Enter-to-submit
            if (nameInput) {
                nameInput.focus();
                nameInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        document.getElementById('cl-add-item-submit')?.click();
                    }
                };
            }
        }
    },

    showEditItemModal(checklistId, itemId) {
        const checklists = this._getChecklists();
        const cl = checklists.find(c => c.id === checklistId);
        if (!cl) return;
        const item = (cl.items || []).find(i => i.id === itemId);
        if (!item) return;

        const modal = document.getElementById('cl-add-item-modal');
        if (!modal) return;

        // Pre-fill fields with current item data
        const nameInput = document.getElementById('cl-add-item-name');
        const timeInput = document.getElementById('cl-add-item-time');
        const teamInput = document.getElementById('cl-add-item-team');
        const submitBtn = document.getElementById('cl-add-item-submit');

        if (nameInput) nameInput.value = item.name;
        if (teamInput) teamInput.value = item.assignedTo || '';

        // Convert dueBefore (minutes before service) to HH:MM time input
        if (timeInput) {
            if (item.dueBefore > 0) {
                const serviceParts = (appState.checklist.serviceTime || '10:00').split(':');
                const serviceMins = parseInt(serviceParts[0]) * 60 + parseInt(serviceParts[1]);
                const itemMins = Math.max(0, serviceMins - item.dueBefore);
                const hh = String(Math.floor(itemMins / 60)).padStart(2, '0');
                const mm = String(itemMins % 60).padStart(2, '0');
                timeInput.value = hh + ':' + mm;
            } else {
                timeInput.value = '';
            }
        }

        // Store edit mode info
        modal.dataset.checklistId = checklistId;
        modal.dataset.editItemId = itemId;

        // Change button text to 'Save'
        if (submitBtn) submitBtn.textContent = __('save');

        modal.classList.remove('hidden');
        // Focus and Enter-to-submit
        if (nameInput) {
            nameInput.focus();
            nameInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('cl-add-item-submit')?.click();
                }
            };
        }
    },

    closeAddItemModal() {
        const modal = document.getElementById('cl-add-item-modal');
        if (modal) {
            modal.classList.add('hidden');
            delete modal.dataset.editItemId;
            // Reset submit button text
            const submitBtn = document.getElementById('cl-add-item-submit');
            if (submitBtn) submitBtn.textContent = __('add');
        }
    },

    submitAddItem() {
        const modal = document.getElementById('cl-add-item-modal');
        const checklistId = modal ? modal.dataset.checklistId : '';
        const editItemId = modal ? modal.dataset.editItemId : '';
        const nameInput = document.getElementById('cl-add-item-name');
        const timeInput = document.getElementById('cl-add-item-time');
        const teamInput = document.getElementById('cl-add-item-team');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name || !checklistId) return;

        const dueTime = timeInput ? timeInput.value : '';
        const team = teamInput ? teamInput.value.trim() : '';

        if (editItemId) {
            this.editItem(checklistId, editItemId, name, dueTime, team);
        } else {
            this.addItem(checklistId, name, dueTime, team);
        }
        this.closeAddItemModal();
        if (nameInput) nameInput.value = '';
        if (timeInput) timeInput.value = '';
        if (teamInput) teamInput.value = '';
    },

    // ========================================================================
    // CONTEXT MENUS
    // ========================================================================

    showChecklistOverviewMenu(e, checklistId) {
        this.closeContextMenu();
        const menu = document.createElement('div');
        menu.className = 'cl-context-menu';
        menu.style.display = 'flex';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        const items = [
            { label: 'Bewerk', icon: '\u270F\uFE0F', action: () => this.showEditChecklistModal(checklistId) },
            { label: 'Dupliceer', icon: '\uD83D\uDD02', action: () => this.duplicateChecklist(checklistId) },
            { label: 'Verwijder', icon: '\uD83D\uDDD1\uFE0F', action: () => this.deleteChecklist(checklistId), danger: true }
        ];

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'cl-context-menu-item' + (item.danger ? ' danger' : '');
            div.innerHTML = '<span>' + item.icon + '</span> ' + item.label;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();
                item.action();
            });
            menu.appendChild(div);
        });

        document.body.appendChild(menu);
        this._contextMenuActive = true;

        // Clamp position
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    },

    showChecklistItemMenu(e, checklistId, itemId) {
        this.closeContextMenu();
        const checklists = this._getChecklists();
        const cl = checklists.find(c => c.id === checklistId);
        if (!cl) return;
        const item = (cl.items || []).find(i => i.id === itemId);
        if (!item) return;

        const menu = document.createElement('div');
        menu.className = 'cl-context-menu';
        menu.style.display = 'flex';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        const items = [
            { label: item.completed ? 'Markeer open' : 'Markeer voltooid', icon: item.completed ? '\u274C' : '\u2705', action: () => this.toggleItemCheck(checklistId, itemId) },
            { label: 'Bewerk', icon: '\u270F\uFE0F', action: () => this.showEditItemModal(checklistId, itemId) },
            { label: 'Verwijder', icon: '\uD83D\uDDD1\uFE0F', action: () => this.deleteItem(checklistId, itemId), danger: true }
        ];

        items.forEach(itemOpt => {
            const div = document.createElement('div');
            div.className = 'cl-context-menu-item' + (itemOpt.danger ? ' danger' : '');
            div.innerHTML = '<span>' + itemOpt.icon + '</span> ' + itemOpt.label;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();
                itemOpt.action();
            });
            menu.appendChild(div);
        });

        document.body.appendChild(menu);
        this._contextMenuActive = true;

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    },

    closeContextMenu() {
        document.querySelectorAll('.cl-context-menu').forEach(el => el.remove());
        this._contextMenuActive = false;
    },

    // ========================================================================
    // CRUD - CHECKLISTS
    // ========================================================================

    createChecklist(name, icon, skipRename, dueDate, dueTime) {
        const id = 'cl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const checklists = JSON.parse(JSON.stringify(this._getChecklists()));
        const newCl = {
            id: id,
            name: name,
            icon: icon || '',
            collapsed: false,
            items: [],
            dueDate: dueDate || appState.checklist.serviceDate || '',
            dueTime: dueTime || '',
            tagId: ''
        };
        checklists.push(newCl);
        appState.checklist.presets[appState.checklist.currentPreset] = checklists;
        this._syncChecklistState();
        this.renderChecklistOverview();

        // Open edit modal if we should
        if (!skipRename) {
            this.showEditChecklistModal(id);
        }

        return id;
    },

    duplicateChecklist(id) {
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === id);
        if (!cl) return;
        const newCl = JSON.parse(JSON.stringify(cl));
        newCl.id = 'cl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        newCl.name = cl.name + ' (Kopie)';
        current.push(newCl);
        appState.checklist.presets = presets;
        this._syncChecklistState();
        this.renderChecklistOverview();
    },

    deleteChecklist(id) {
        if (!confirm(__('cl_confirm_delete_checklist'))) return;
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        presets[appState.checklist.currentPreset] = current.filter(c => c.id !== id);
        appState.checklist.presets = presets;

        if (appState.checklist.activeChecklistId === id) {
            this.closeChecklistDetail();
        }

        this._syncChecklistState();
        this.renderChecklistOverview();
    },

    // ========================================================================
    // CRUD - ITEMS
    // ========================================================================

    addItem(checklistId, name, dueTime, team) {
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === checklistId);
        if (!cl || !name) return;

        if (!cl.items) cl.items = [];
        const newItem = {
            id: 'itm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: name,
            completed: false,
            assignedTo: team || '',
            dueBefore: 0,
            tagIds: []
        };

        if (dueTime) {
            // Parse dueTime as minutes before service start
            const parts = dueTime.split(':');
            if (parts.length === 2) {
                const itemMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                const serviceParts = (appState.checklist.serviceTime || '10:00').split(':');
                const serviceMins = parseInt(serviceParts[0]) * 60 + parseInt(serviceParts[1]);
                newItem.dueBefore = Math.max(0, serviceMins - itemMins);
            }
        }

        cl.items.push(newItem);
        appState.checklist.presets = presets;
        this._syncChecklistState();

        if (appState.checklist.activeChecklistId === checklistId) {
            this._renderChecklistDetail(checklistId);
        } else {
            this.renderChecklistOverview();
        }
    },

    deleteItem(checklistId, itemId) {
        if (!confirm(__('cl_confirm_delete_item'))) return;
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === checklistId);
        if (!cl || !cl.items) return;

        cl.items = cl.items.filter(i => i.id !== itemId);
        appState.checklist.presets = presets;
        this._syncChecklistState();

        if (appState.checklist.activeChecklistId === checklistId) {
            this._renderChecklistDetail(checklistId);
        } else {
            this.renderChecklistOverview();
        }
    },

    editItem(checklistId, itemId, name, dueTime, team) {
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === checklistId);
        if (!cl || !cl.items) return;
        const item = cl.items.find(i => i.id === itemId);
        if (!item) return;

        item.name = name;

        // Parse dueTime (HH:MM) back to minutes before service start
        if (dueTime) {
            const parts = dueTime.split(':');
            if (parts.length === 2) {
                const itemMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                const serviceParts = (appState.checklist.serviceTime || '10:00').split(':');
                const serviceMins = parseInt(serviceParts[0]) * 60 + parseInt(serviceParts[1]);
                item.dueBefore = Math.max(0, serviceMins - itemMins);
            }
        } else {
            item.dueBefore = 0;
        }

        if (team) item.assignedTo = team;
        else delete item.assignedTo;

        appState.checklist.presets = presets;
        this._syncChecklistState();

        if (appState.checklist.activeChecklistId === checklistId) {
            this._renderChecklistDetail(checklistId);
        } else {
            this.renderChecklistOverview();
        }
    },

    toggleItemCheck(checklistId, itemId) {
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === checklistId);
        if (!cl || !cl.items) return;

        const item = cl.items.find(i => i.id === itemId);
        if (item) {
            item.completed = !item.completed;
            appState.checklist.presets = presets;
            this._syncChecklistState();

            if (appState.checklist.activeChecklistId === checklistId) {
                this._renderChecklistDetail(checklistId);
            } else {
                this.renderChecklistOverview();
            }
        }
    },

    // ========================================================================
    // EDIT CHECKLIST MODAL
    // ========================================================================

    showEditChecklistModal(checklistId) {
        const modal = document.getElementById('cl-edit-checklist-modal');
        const container = document.getElementById('cl-edit-checklist-content');
        if (!modal || !container) return;

        // Clean up any previous listeners before adding new ones
        this._cleanupEditModalListeners(modal);

        modal.classList.remove('hidden');
        this._renderEditChecklistContent(container, checklistId);

        // Bind Escape key to close
        this._boundEditModalKeydown = (e) => {
            if (e.key === 'Escape') this.closeEditChecklistModal();
        };
        document.addEventListener('keydown', this._boundEditModalKeydown);

        // Click on overlay backdrop closes modal
        const closeOverlay = () => {
            if (modal.classList.contains('hidden')) return;
            this.closeEditChecklistModal();
        };
        modal.addEventListener('click', closeOverlay);
        this._boundEditModalOverlay = closeOverlay;

        // Prevent clicks inside the dialog from bubbling to overlay
        const dialog = modal.querySelector('.task-modal-dialog');
        if (dialog) {
            const stopProp = (e) => e.stopPropagation();
            dialog.addEventListener('click', stopProp);
            this._boundEditModalStopProp = { el: dialog, handler: stopProp };
        }
    },

    _cleanupEditModalListeners(modal) {
        if (this._boundEditModalKeydown) {
            document.removeEventListener('keydown', this._boundEditModalKeydown);
            this._boundEditModalKeydown = null;
        }
        if (this._boundEditModalOverlay && modal) {
            modal.removeEventListener('click', this._boundEditModalOverlay);
            this._boundEditModalOverlay = null;
        }
        if (this._boundEditModalStopProp) {
            this._boundEditModalStopProp.el.removeEventListener('click', this._boundEditModalStopProp.handler);
            this._boundEditModalStopProp = null;
        }
    },

    closeEditChecklistModal() {
        const modal = document.getElementById('cl-edit-checklist-modal');
        if (modal) modal.classList.add('hidden');
        this._cleanupEditModalListeners(modal);
    },

    _renderEditChecklistContent(container, checklistId) {
        const checklists = this._getChecklists();
        const cl = checklists.find(c => c.id === checklistId);
        if (!cl) {
            container.innerHTML = '<div class="cl-edit-empty" style="padding-bottom:20px;">' + __('cl_checklist_not_found') + '</div><div class="cl-edit-footer"><button class="cl-btn-close" id="cl-edit-close-modal-fallback">' + __('close') + '</button></div>';
            const fallbackClose = document.getElementById('cl-edit-close-modal-fallback');
            if (fallbackClose) fallbackClose.addEventListener('click', () => this.closeEditChecklistModal());
            return;
        }

        const tags = this._getTags();
        const items = cl.items || [];

        let html = '';

        // Checklist name
        html += '<div class="cl-edit-section">';
        html += '  <label class="cl-edit-label" for="cl-edit-checklist-name">' + __('name') + '</label>';
        html += '  <input type="text" id="cl-edit-checklist-name" class="cl-edit-input" value="' + this._escapeHtml(cl.name) + '" maxlength="100">';
        html += '</div>';

        // Tag selector
        html += '<div class="cl-edit-section">';
        html += '  <label class="cl-edit-label" for="cl-edit-checklist-tag">' + __('cl_tags') + ' <span class="cl-edit-count">(' + tags.length + ')</span></label>';
        if (tags.length > 0) {
            html += '  <div class="cl-edit-tag-selector">';
            html += '    <select id="cl-edit-checklist-tag" class="cl-edit-input cl-edit-select">';
            html += '      <option value="">— ' + __('none') + ' —</option>';
            tags.forEach(t => {
                const selected = cl.tagId === t.id ? ' selected' : '';
                html += '      <option value="' + t.id + '"' + selected + '>' + this._escapeHtml(t.icon + ' ' + t.name) + '</option>';
            });
            html += '    </select>';
            html += '  </div>';
        } else {
            html += '  <div class="cl-edit-empty-tags">' + __('cl_edit_no_tags') + '. <button class="cl-clear-filter" onclick="checklistModule.closeEditChecklistModal();checklistModule.showTagManager();">' + __('cl_tag_add') + '</button></div>';
        }
        html += '</div>';

        // Due date
        html += '<div class="cl-edit-section">';
        html += '  <label class="cl-edit-label" for="cl-edit-due-date">' + __('cl_checklist_duedate') + '</label>';
        html += '  <input type="date" id="cl-edit-due-date" class="cl-edit-input" value="' + this._escapeHtml(cl.dueDate || appState.checklist.serviceDate || '') + '">';
        html += '</div>';

        // Due time
        html += '<div class="cl-edit-section">';
        html += '  <label class="cl-edit-label" for="cl-edit-due-time">' + __('cl_checklist_duetime') + '</label>';
        html += '  <input type="time" id="cl-edit-due-time" class="cl-edit-input" value="' + this._escapeHtml(cl.dueTime || '10:00') + '">';
        html += '</div>';

        // Repeat frequency
        const repeatOptions = [
            { value: 'none', label: __('cl_repeat_none') },
            { value: 'daily', label: __('cl_repeat_daily') },
            { value: 'weekly', label: __('cl_repeat_weekly') },
            { value: 'biweekly', label: __('cl_repeat_biweekly') },
            { value: 'monthly', label: __('cl_repeat_monthly') },
            { value: 'yearly', label: __('cl_repeat_yearly') }
        ];
        const currentRepeat = cl.repeat || 'none';
        html += '<div class="cl-edit-section">';
        html += '  <label class="cl-edit-label" for="cl-edit-repeat">' + __('cl_checklist_repeat') + '</label>';
        html += '  <select id="cl-edit-repeat" class="cl-edit-input cl-edit-select">';
        repeatOptions.forEach(opt => {
            const selected = opt.value === currentRepeat ? ' selected' : '';
            html += '    <option value="' + opt.value + '"' + selected + '>' + opt.label + '</option>';
        });
        html += '  </select>';
        html += '</div>';

        // Save button for checklist-level changes
        html += '<div class="cl-edit-actions">';
        html += '  <button class="cl-btn-save" id="cl-edit-save-checklist">' + __('cl_edit_checklist') + '</button>';
        html += '</div>';

        // Separator
        html += '<div class="cl-edit-separator"></div>';

        // Items section
        html += '<div class="cl-edit-section">';
        html += '  <label class="cl-edit-label">' + __('cl_edit_items') + ' <span class="cl-edit-count">(' + items.length + ')</span></label>';
        html += '</div>';

        html += '<div class="cl-edit-items-list" id="cl-edit-items-list">';
        if (items.length === 0) {
            html += '<div class="cl-edit-empty">' + __('cl_edit_no_tags') + '</div>';
        } else {
            items.forEach(item => {
                html += this._renderEditItemRow(item);
            });
        }
        html += '</div>';

        // Add item row
        html += '<div class="cl-edit-add-item-row">';
        html += '  <input type="text" id="cl-edit-new-item" class="cl-edit-input cl-edit-new-item-input" placeholder="' + __('cl_edit_new_item_placeholder') + '" maxlength="100">';
        html += '  <button class="cl-btn-add-item" id="cl-edit-add-item-btn">+ ' + __('add') + '</button>';
        html += '</div>';

        // Footer close button
        html += '<div class="cl-edit-footer">';
        html += '  <button class="cl-btn-close" id="cl-edit-close-modal">' + __('close') + '</button>';
        html += '</div>';

        container.innerHTML = html;

        // Bind events
        const saveBtn = document.getElementById('cl-edit-save-checklist');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this._saveEditChecklistMeta(checklistId));
        }

        const closeBtn = document.getElementById('cl-edit-close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeEditChecklistModal());
        }

        const addItemBtn = document.getElementById('cl-edit-add-item-btn');
        const newItemInput = document.getElementById('cl-edit-new-item');
        if (addItemBtn && newItemInput) {
            const addItemHandler = () => {
                const name = newItemInput.value.trim();
                if (name) {
                    this.addItemFromEdit(checklistId, name);
                }
            };
            addItemBtn.addEventListener('click', addItemHandler);
            newItemInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addItemHandler();
            });
        }

        this._bindEditItemEvents(checklistId);
    },

    _renderEditItemRow(item) {
        const safeName = this._escapeHtml(item.name).replace(/"/g, '&quot;');
        return '<div class="cl-edit-item-row" data-item-id="' + item.id + '">' +
            '<input type="text" class="cl-edit-item-name-input" value="' + safeName + '" maxlength="100">' +
            '<button class="cl-edit-item-del" title="' + __('remove') + '" data-item-id="' + item.id + '">&#x2715;</button>' +
            '</div>';
    },

    _bindEditItemEvents(checklistId) {
        const itemsList = document.getElementById('cl-edit-items-list');
        if (!itemsList) return;

        // Rename on blur/enter
        itemsList.querySelectorAll('.cl-edit-item-name-input').forEach(input => {
            const saveName = () => {
                const row = input.closest('.cl-edit-item-row');
                const itemId = row ? row.dataset.itemId : '';
                const newName = input.value.trim();
                if (itemId && newName) {
                    this.renameItemInState(checklistId, itemId, newName);
                }
            };
            input.addEventListener('blur', saveName);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { input.blur(); }
            });
        });

        // Delete buttons
        itemsList.querySelectorAll('.cl-edit-item-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const itemId = btn.dataset.itemId;
                if (itemId && confirm(__('cl_edit_item_delete_confirm'))) {
                    this.deleteItem(checklistId, itemId);
                    // Re-render edit content
                    const container = document.getElementById('cl-edit-checklist-content');
                    if (container) this._renderEditChecklistContent(container, checklistId);
                }
            });
        });
    },

    _saveEditChecklistMeta(checklistId) {
        const nameInput = document.getElementById('cl-edit-checklist-name');
        const tagSelect = document.getElementById('cl-edit-checklist-tag');
        const dateInput = document.getElementById('cl-edit-due-date');
        const timeInput = document.getElementById('cl-edit-due-time');
        const repeatSelect = document.getElementById('cl-edit-repeat');

        const newName = nameInput ? nameInput.value.trim() : '';
        const newTagId = tagSelect ? tagSelect.value : '';
        const newDate = dateInput ? dateInput.value : '';
        const newTime = timeInput ? timeInput.value : '';
        const newRepeat = repeatSelect ? repeatSelect.value : 'none';

        // Batch all changes in a single deep-clone + sync
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === checklistId);
        if (!cl) return;

        if (newName) {
            cl.name = newName;
        }
        if (newTagId) {
            cl.tagId = newTagId;
        } else {
            delete cl.tagId;
        }
        if (newDate) {
            cl.dueDate = newDate;
        } else {
            delete cl.dueDate;
        }
        if (newTime) {
            cl.dueTime = newTime;
        } else {
            delete cl.dueTime;
        }
        if (newRepeat && newRepeat !== 'none') {
            cl.repeat = newRepeat;
        } else {
            delete cl.repeat;
        }

        appState.checklist.presets = presets;
        this._syncChecklistState();
        this.renderChecklistOverview();
        this.closeEditChecklistModal();
    },

    addItemFromEdit(checklistId, name) {
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === checklistId);
        if (!cl || !name) return;

        if (!cl.items) cl.items = [];
        const newItem = {
            id: 'itm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: name,
            completed: false,
            assignedTo: '',
            dueBefore: 0,
            tagIds: []
        };
        cl.items.push(newItem);
        appState.checklist.presets = presets;
        this._syncChecklistState();

        // Re-render edit content
        const container = document.getElementById('cl-edit-checklist-content');
        if (container) {
            this._renderEditChecklistContent(container, checklistId);
            // Clear input
            const input = document.getElementById('cl-edit-new-item');
            if (input) input.value = '';
            // Focus back on input
            setTimeout(() => { document.getElementById('cl-edit-new-item')?.focus(); }, 50);
        }
        this.renderChecklistOverview();
    },

    renameItemInState(checklistId, itemId, newName) {
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        const current = presets[appState.checklist.currentPreset] || [];
        const cl = current.find(c => c.id === checklistId);
        if (!cl || !cl.items) return;
        const item = cl.items.find(i => i.id === itemId);
        if (item) {
            item.name = newName;
            appState.checklist.presets = presets;
            this._syncChecklistState();
            this.renderChecklistOverview();
        }
    },

    // ========================================================================
    // TAG MANAGER
    // ========================================================================

    showTagManager() {
        const modal = document.getElementById('tag-manager-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this._renderTagManagerList();
    },

    _renderTagManagerList() {
        const list = document.getElementById('tag-manager-list');
        if (!list) return;
        const tags = this._getTags();

        if (tags.length === 0) {
            list.innerHTML = '<div class="cl-edit-empty">' + __('cl_edit_no_tags') + '</div>';
            return;
        }

        list.innerHTML = '';
        tags.forEach(tag => {
            const row = document.createElement('div');
            row.className = 'manage-list-item';
            row.innerHTML = '<span style="font-size:1rem;">' + this._escapeHtml(tag.icon || '') + '</span>' +
                '<span style="flex:1;margin-left:8px;color:#eee;">' + this._escapeHtml(tag.name) + '</span>' +
                '<span style="width:16px;height:16px;border-radius:50%;background:' + tag.color + ';display:inline-block;margin-right:8px;"></span>' +
                '<button class="btn-delete-task" onclick="checklistModule.deleteTag(\'' + tag.id + '\')" title="' + __('delete') + '">&#x2715;</button>';
            list.appendChild(row);
        });
    },

    deleteTag(tagId) {
        if (!confirm(__('cl_confirm_delete_tag'))) return;
        const tags = appState.checklist.tags || {};
        delete tags[tagId];
        appState.checklist.tags = tags;

        // Also remove tagId from all checklists
        const presets = JSON.parse(JSON.stringify(appState.checklist.presets));
        Object.keys(presets).forEach(presetName => {
            const list = presets[presetName] || [];
            list.forEach(cl => {
                if (cl.tagId === tagId) delete cl.tagId;
            });
        });
        appState.checklist.presets = presets;

        this._syncChecklistState();
        this._renderTagManagerList();
        this.renderChecklistOverview();
    },

    // ========================================================================
    // TAG FILTER
    // ========================================================================

    getActiveTagFilter() {
        return appState.checklist._activeTagFilter || null;
    },

    applyTagFilter(tagId) {
        if (appState.checklist._activeTagFilter === tagId) {
            this.clearTagFilter();
            return;
        }
        appState.checklist._activeTagFilter = tagId;
        this._renderTagFilters();
        this.renderChecklistOverview();
        this.closeContextMenu();
    },

    clearTagFilter() {
        delete appState.checklist._activeTagFilter;
        this._renderTagFilters();
        this.renderChecklistOverview();
    },

    _renderTagFilters() {
        const container = document.getElementById('cl-tag-filters');
        const list = document.getElementById('cl-tag-filter-list');
        const clearBtn = document.getElementById('cl-clear-tag-filter');
        if (!container || !list) return;

        const tags = this._getTags();
        const activeFilter = this.getActiveTagFilter();

        if (tags.length === 0) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        list.innerHTML = '';
        tags.forEach(tag => {
            const pill = document.createElement('span');
            pill.className = 'cl-tag-pill' + (activeFilter === tag.id ? ' active' : '');
            pill.style.setProperty('--tag-color', tag.color);
            pill.style.cursor = 'pointer';
            if (activeFilter === tag.id) {
                pill.style.background = tag.color;
                pill.style.color = '#fff';
            }
            pill.innerHTML = this._escapeHtml(tag.icon || '') + ' ' + this._escapeHtml(tag.name);
            pill.addEventListener('click', () => this.applyTagFilter(tag.id));
            list.appendChild(pill);
        });

        if (clearBtn) {
            if (activeFilter) {
                clearBtn.classList.remove('hidden');
            } else {
                clearBtn.classList.add('hidden');
            }
        }
    },

    // ========================================================================
    // PRESET DROPDOWN (custom modern dropdown)
    // ========================================================================

    _populatePresetDropdown() {
        const listContainer = document.getElementById('preset-list-items');
        const triggerText = document.getElementById('preset-trigger-text');
        if (!listContainer || !triggerText) return;

        const validPresets = Object.keys(appState.checklist.presets)
            .filter(k => appState.checklist.presets[k] !== null);
        const currentPreset = appState.checklist.preset || appState.checklist.currentPreset || '';

        listContainer.innerHTML = '';
        validPresets.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'modern-dropdown-item' + (p === currentPreset ? ' active' : '');
            btn.textContent = p;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrapper = document.getElementById('preset-dropdown-wrapper');
                if (wrapper) wrapper.classList.remove('open');
                if (p !== currentPreset) {
                    this.syncState({ preset: p, tasksState: {} });
                }
            });
            listContainer.appendChild(btn);
        });

        triggerText.textContent = currentPreset || 'Selecteer...';
    },

    // ========================================================================
    // ADMIN SIDEBAR TOGGLE
    // ========================================================================

    toggleAdminSidebar() {
        const sidebar = document.getElementById('admin-sidebar');
        const master = document.getElementById('master-sidebar');
        if (sidebar) {
            const isHidden = sidebar.classList.contains('hidden');
            sidebar.classList.toggle('hidden');
            if (master) master.classList.toggle('hidden');
            document.body.classList.toggle('checklist-sidebar-open', !isHidden);
        }
    },

    // ========================================================================
    // GLOBAL LISTENERS (set up once)
    // ========================================================================

    _setupContextMenuListeners() {
        if (this.__contextMenuListenersSetup) return;
        this.__contextMenuListenersSetup = true;

        // Close context menus on outside click
        document.addEventListener('click', function(e) {
            if (checklistModule._contextMenuActive) {
                const menus = document.querySelectorAll('.cl-context-menu');
                let clickedOnMenu = false;
                menus.forEach(menu => {
                    if (menu.contains(e.target)) clickedOnMenu = true;
                });
                if (!clickedOnMenu) {
                    checklistModule.closeContextMenu();
                }
            }
        });

        // Close context menus on Escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                checklistModule.closeContextMenu();
            }
        });
    },

    // ========================================================================
    // SETTINGS MODAL (Dienst Instellingen) — kalender-, tijd- en preset-pickers
    // ========================================================================
    _STG_MONTHS: ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'],
    _STG_FULL_MONTHS: ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'],

    _settingsModalInit() {
        if (this.__stgReady) return;
        this.__stgReady = true;

        this.__stg = { calView: new Date(), els: {} };
        ['stg-date', 'stg-time', 'stg-btn-preset', 'stg-panel-date', 'stg-panel-time', 'stg-panel-preset', 'stg-cal-days', 'stg-cal-title', 'stg-time-hours', 'stg-time-mins', 'stg-preset-list']
            .forEach(id => { this.__stg.els[id] = document.getElementById(id); });

        this.__stgBindEvents();
        this.__stgRefreshFromState();
        this.__stgRenderAll();
    },

    // Haal datum/tijd/preset live uit appState
    __stgRefreshFromState() {
        const c = appState.checklist;
        this.__stg.date = c.startDate || c.serviceDate || new Date().toISOString().split('T')[0];
        this.__stg.time = c.startTime || c.serviceTime || '10:00';
        const [y, m, d] = this.__stg.date.split('-').map(Number);
        this.__stg.calView = new Date(y || 2000, (m || 1) - 1, d || 1);
    },

    __stgCurrentPreset() {
        return appState.checklist.preset || appState.checklist.currentPreset || '';
    },

    __stgValidPresets() {
        return Object.keys(appState.checklist.presets || {}).filter(k => appState.checklist.presets[k] !== null);
    },

    __stgRenderAll() {
        const [y, m, d] = this.__stg.date.split('-').map(Number);
        const dateInp = this.__stg.els['stg-date'];
        if (dateInp) dateInp.value = `${d} ${this._STG_MONTHS[(m || 1) - 1]} ${y}`;
        const timeInp = this.__stg.els['stg-time'];
        if (timeInp) timeInp.value = this.__stg.time;
        const presetBtn = this.__stg.els['stg-btn-preset'];
        if (presetBtn && presetBtn.firstElementChild) presetBtn.firstElementChild.textContent = this.__stgCurrentPreset() || 'Selecteer...';
        this.__stgInitPickers();
        this.__stgRenderCalendar();
        this.__stgRenderPresets();
    },

    __stgInitPickers() {
        const [curH, curM] = this.__stg.time.split(':');
        const hoursEl = this.__stg.els['stg-time-hours'];
        const minsEl = this.__stg.els['stg-time-mins'];
        if (hoursEl) {
            hoursEl.innerHTML = Array.from({ length: 24 }, (_, h) => {
                const val = String(h).padStart(2, '0');
                return `<button class="stg-time-btn${val === curH ? ' selected' : ''}" data-val="${val}">${val}</button>`;
            }).join('');
        }
        if (minsEl) {
            minsEl.innerHTML = Array.from({ length: 12 }, (_, i) => {
                const val = String(i * 5).padStart(2, '0');
                return `<button class="stg-time-btn${val === curM ? ' selected' : ''}" data-val="${val}">${val}</button>`;
            }).join('');
        }
    },

    __stgRenderCalendar() {
        const y = this.__stg.calView.getFullYear(), m = this.__stg.calView.getMonth();
        const titleEl = this.__stg.els['stg-cal-title'];
        if (titleEl) titleEl.textContent = `${this._STG_FULL_MONTHS[m]} ${y}`;

        const firstDay = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const prevDays = new Date(y, m, 0).getDate();
        const [selY, selM, selD] = this.__stg.date.split('-').map(Number);

        let html = '';
        for (let i = firstDay - 1; i >= 0; i--) html += `<div class="stg-cal-cell other" data-date="${y}-${m}-${prevDays - i}">${prevDays - i}</div>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const isSel = selY === y && selM === m + 1 && selD === d;
            html += `<div class="stg-cal-cell${isSel ? ' selected' : ''}" data-date="${y}-${m + 1}-${d}">${d}</div>`;
        }
        const total = (firstDay + daysInMonth > 35) ? 42 : 35;
        for (let d = 1; d <= total - (firstDay + daysInMonth); d++) html += `<div class="stg-cal-cell other" data-date="${y}-${m + 2}-${d}">${d}</div>`;

        const daysEl = this.__stg.els['stg-cal-days'];
        if (daysEl) daysEl.innerHTML = html;
    },

    __stgRenderPresets() {
        const listEl = this.__stg.els['stg-preset-list'];
        if (!listEl) return;
        const current = this.__stgCurrentPreset();
        listEl.innerHTML = this.__stgValidPresets().map(p =>
            `<button class="stg-preset-item${p === current ? ' selected' : ''}" data-preset="${String(p).replace(/"/g, '&quot;')}"><span>${String(p).replace(/</g, '&lt;')}</span>${p === current ? '&#10003;' : ''}</button>`
        ).join('');
    },

    shiftSettingsMonth(dir) {
        if (!this.__stg) return;
        this.__stg.calView.setMonth(this.__stg.calView.getMonth() + dir);
        this.__stgRenderCalendar();
    },

    __stgClosePanels() {
        ['stg-panel-date', 'stg-panel-time', 'stg-panel-preset'].forEach(id => this.__stg.els[id]?.classList.add('hidden'));
        ['stg-date', 'stg-time', 'stg-btn-preset'].forEach(id => this.__stg.els[id]?.classList.remove('active'));
    },

    __stgBindEvents() {
        const toggle = (panel, trigger) => {
            if (!panel || !trigger) return;
            const isClosed = panel.classList.contains('hidden');
            this.__stgClosePanels();
            if (isClosed) {
                panel.classList.remove('hidden');
                trigger.classList.add('active');
            }
        };

        const dateInp = this.__stg.els['stg-date'];
        const timeInp = this.__stg.els['stg-time'];
        const presetBtn = this.__stg.els['stg-btn-preset'];
        if (dateInp) dateInp.onfocus = () => toggle(this.__stg.els['stg-panel-date'], dateInp);
        if (timeInp) timeInp.onfocus = () => toggle(this.__stg.els['stg-panel-time'], timeInp);
        if (presetBtn) presetBtn.onclick = (e) => { e.stopPropagation(); toggle(this.__stg.els['stg-panel-preset'], presetBtn); };

        const calDays = this.__stg.els['stg-cal-days'];
        if (calDays) calDays.onclick = (e) => {
            const target = e.target.closest('[data-date]');
            if (!target) return;
            const [y, m, d] = target.dataset.date.split('-').map(Number);
            const dt = new Date(y, m - 1, d);
            this.__stg.date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            this.__stg.calView = new Date(dt);
            appState.checklist.startDate = this.__stg.date;
            this.syncState({ startDate: this.__stg.date });
            this.__stgRenderAll();
            this.__stgClosePanels();
        };

        const updateTime = (type, val) => {
            let [h, m] = this.__stg.time.split(':');
            if (type === 'h') h = val; else m = val;
            this.__stg.time = `${h}:${m}`;
            appState.checklist.startTime = this.__stg.time;
            this.syncState({ startTime: this.__stg.time });
            this.__stgInitPickers();
            const timeInp = this.__stg.els['stg-time'];
            if (timeInp) timeInp.value = this.__stg.time;
        };
        const hoursEl = this.__stg.els['stg-time-hours'];
        const minsEl = this.__stg.els['stg-time-mins'];
        if (hoursEl) hoursEl.onclick = (e) => e.target.dataset && e.target.dataset.val && updateTime('h', e.target.dataset.val);
        if (minsEl) minsEl.onclick = (e) => e.target.dataset && e.target.dataset.val && updateTime('m', e.target.dataset.val);

        const presetList = this.__stg.els['stg-preset-list'];
        if (presetList) presetList.onclick = (e) => {
            const item = e.target.closest('[data-preset]');
            if (!item) return;
            const name = item.dataset.preset;
            if (name !== this.__stgCurrentPreset()) {
                this.syncState({ preset: name, tasksState: {} });
            }
            this.__stgRefreshFromState();
            this.__stgRenderAll();
            this.__stgClosePanels();
        };

        if (dateInp) dateInp.onblur = () => {
            const val = dateInp.value.trim();
            const match = val.match(/^(\d{1,2})[\s\-\/\.]([a-zA-Z]{3,9}|\d{1,2})(?:[\s\-\/\.](\d{2,4}))?$/);
            if (match) {
                const d = parseInt(match[1], 10);
                const y = match[3] ? (match[3].length === 2 ? 2000 + +match[3] : +match[3]) : new Date().getFullYear();
                const m = isNaN(match[2]) ? this._STG_MONTHS.findIndex(x => x.toLowerCase() === match[2].slice(0, 3).toLowerCase()) : match[2] - 1;
                if (m >= 0 && m < 12) {
                    this.__stg.date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    this.__stg.calView = new Date(y, m, d);
                    appState.checklist.startDate = this.__stg.date;
                    this.syncState({ startDate: this.__stg.date });
                }
            }
            this.__stgRenderAll();
        };

        if (timeInp) timeInp.onblur = () => {
            const match = timeInp.value.trim().match(/^(\d{1,2})[:.,\-]??(\d{2})?$/);
            if (match) {
                const h = String(Math.min(23, +match[1])).padStart(2, '0');
                const m = String(Math.min(59, +(match[2] || 0))).padStart(2, '0');
                this.__stg.time = `${h}:${m}`;
                appState.checklist.startTime = this.__stg.time;
                this.syncState({ startTime: this.__stg.time });
                this.__stgInitPickers();
            }
            if (timeInp) timeInp.value = this.__stg.time;
        };

        // Dismiss dropdowns bij klik buiten de pickers
        document.addEventListener('click', (e) => {
            if (this.__stg && !e.target.closest('.stg-picker-wrap')) this.__stgClosePanels();
        });
        // Escape sluit de panels én de modal
        document.addEventListener('keydown', (e) => {
            if (this.__stg && e.key === 'Escape') {
                this.__stgClosePanels();
                this.closeSettingsModal();
            }
        });
    },

    openSettingsModal() {
        this._settingsModalInit();
        this.__stgRefreshFromState();
        this.__stgRenderAll();
        const modal = document.getElementById('stg-modal');
        if (modal) modal.classList.remove('hidden');
    },

    closeSettingsModal() {
        const modal = document.getElementById('stg-modal');
        if (modal) modal.classList.add('hidden');
        this.__stgClosePanels();
    },

    toggleSettingsModal() {
        const modal = document.getElementById('stg-modal');
        if (!modal) return;
        if (modal.classList.contains('hidden')) this.openSettingsModal();
        else this.closeSettingsModal();
    },

    // Preset-operaties (zelfde logica als de admin-sidebar dropdown)
    addSettingsPreset() {
        const name = prompt(__('cl_preset_new_name'));
        if (!name || appState.checklist.presets[name]) return;
        const newPresets = { ...appState.checklist.presets };
        newPresets[name] = [];
        this.syncState({ presets: newPresets, preset: name, tasksState: {} });
        this.__stgRefreshFromState();
        this.__stgRenderAll();
    },

    dupSettingsPreset() {
        const name = prompt(__('cl_preset_rename_prompt') + ' \u2018' + this.__stgCurrentPreset() + '\u2019:', this.__stgCurrentPreset() + ' ' + __('cl_preset_dup_suffix'));
        if (!name || appState.checklist.presets[name]) return;
        const newPresets = { ...appState.checklist.presets };
        newPresets[name] = [...(appState.checklist.presets[this.__stgCurrentPreset()] || [])].map(t => ({ ...t, id: 'c' + Math.random().toString(36).substr(2, 9) }));
        this.syncState({ presets: newPresets, preset: name, tasksState: {} });
        this.__stgRefreshFromState();
        this.__stgRenderAll();
    },

    renameSettingsPreset() {
        const oldName = this.__stgCurrentPreset();
        const newName = prompt(__('cl_preset_rename_prompt') + ' \u2018' + oldName + '\u2019:', oldName);
        if (!newName || newName === oldName || appState.checklist.presets[newName]) return;
        const newPresets = { ...appState.checklist.presets };
        newPresets[newName] = newPresets[oldName];
        newPresets[oldName] = null;
        this.syncState({ presets: newPresets, preset: newName });
        this.__stgRefreshFromState();
        this.__stgRenderAll();
    },

    delSettingsPreset() {
        const validPresets = this.__stgValidPresets();
        if (validPresets.length <= 1) return alert(__('cl_preset_cannot_delete'));
        if (!confirm(__('cl_preset_confirm_delete') + ' \u2018' + this.__stgCurrentPreset() + '\u2019 ' + __('cl_preset_wilt_verwijderen'))) return;
        const newPresets = { ...appState.checklist.presets };
        newPresets[this.__stgCurrentPreset()] = null;
        const newActive = Object.keys(newPresets).find(k => newPresets[k] !== null);
        this.syncState({ presets: newPresets, preset: newActive, tasksState: {} });
        this.__stgRefreshFromState();
        this.__stgRenderAll();
    },

    // Reset & archiveer de dienst (zelfde logica als btn-reset in de admin-sidebar)
    async resetAndArchive() {
        if (!confirm(__('cl_confirm_archive'))) return;
        const activeTasks = this.getActiveTasks();
        const done = activeTasks.filter(t => appState.checklist.tasksState[t.id]).length;
        try {
            await fetch('/api/commandcenter/archive', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preset: appState.checklist.preset,
                    completed: done,
                    total: activeTasks.length
                })
            });
        } catch (e) {
            console.warn('[CC] Archive push mislukt:', e.message);
        }
        this.syncState({ tasksState: {}, quickNote: { text: '', isPopup: false, timestamp: Date.now() } });
        this.closeSettingsModal();
    },

};

// Auto-initialize when view is shown - handled by router