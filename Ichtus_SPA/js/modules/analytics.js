/* ============================================
   ANALYTICS MODULE
   Service Tracking Analytics - Dynamic Look Tracking
   ============================================ */

const analyticsModule = {
    PP_IP: "100.113.22.22",
    PP_PORT: "51253",
    BASE_URL: null,
    lookDurations: {},        // { "Welkom": 300, "Openingslied": 120, ... }
    isServiceRunning: false,
    serviceStartTime: null,
    previousLookName: null,   // track the last active look name
    currentItem: null,
    serviceLog: [],
    autoStartTimeout: null,
    initialized: false,
    _availableLooks: [],

    init() {
        if (this.initialized && this._lastView === 'analytics') return;

        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }

        this.initialized = true;
        this._lastView = 'analytics';

        this.BASE_URL = `http://${this.PP_IP}:${this.PP_PORT}/v1`;

        // Load look durations from localStorage
        this.lookDurations = JSON.parse(localStorage.getItem('lookDurations')) || {};

        // Fetch available looks from ProPresenter and render the config UI
        this.refreshLooks();
        this.renderDashboard();
        this.renderAutoStartStatus();

        // Poll ProPresenter for look changes
        this._pollInterval = setInterval(() => this.pollProPresenter(), 1000);
    },

    // --- API Functions ---

    async fetchCurrentLook() {
        try {
            const response = await fetch(`${this.BASE_URL}/look/current`);
            if (response.ok) return await response.json();
        } catch (err) {
            console.error("ProPresenter sync error:", err);
        }
        return null;
    },

    async fetchAllLooks() {
        try {
            const response = await fetch(`${this.BASE_URL}/looks`);
            if (response.ok) {
                const looks = await response.json();
                return looks.map(l => {
                    if (typeof l === 'string') return l;
                    if (l.id && l.id.name) return l.id.name;
                    if (l.name) return l.name;
                    return null;
                }).filter(Boolean);
            }
        } catch (err) {
            console.error("Failed to fetch looks from ProPresenter:", err);
        }
        return [];
    },

    async triggerWelkomMacro() {
        try {
            const response = await fetch(`${this.BASE_URL}/macros`);
            if (response.ok) {
                const macros = await response.json();
                const welkomMacro = macros.find(m => m.id && m.id.name && m.id.name.toLowerCase() === 'welkom');
                if (welkomMacro) {
                    const macroId = welkomMacro.id.uuid || welkomMacro.id;
                    await fetch(`${this.BASE_URL}/macro/${macroId}/trigger`);
                }
            }
        } catch (err) {
            console.error("Failed to trigger Welkom macro:", err);
        }
    },

    // --- Look Duration Management ---

    async refreshLooks() {
        const looks = await this.fetchAllLooks();
        this._availableLooks = looks;
        this.renderLookDurations();
    },

    renderLookDurations() {
        const container = document.getElementById('look-durations-list');
        if (!container) return;

        container.innerHTML = '';

        if (!this._availableLooks || this._availableLooks.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:12px 0; color:var(--text-muted); font-style:italic;">
                    Geen Looks gevonden. Zorg dat ProPresenter draait en klik op "Ververs Looks".
                </div>
            `;
            return;
        }

        this._availableLooks.forEach(lookName => {
            const row = document.createElement('div');
            row.className = 'toggle-item look-duration-row';

            const currentDuration = this.lookDurations[lookName] || '';
            const displayTime = currentDuration ? analyticsModule.formatTime(parseInt(currentDuration)) : '—';

            row.innerHTML = `
                <span style="font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${lookName}</span>
                <span style="font-size:0.8rem; color:var(--text-muted); margin:0 8px; min-width:50px; text-align:right; flex-shrink:0;">${displayTime}</span>
                <input type="number" class="form-input" value="${currentDuration}" placeholder="Sec" style="width:80px; padding:4px 8px; font-size:0.8rem; flex-shrink:0;" data-look="${lookName}">
                <button class="btn-nav" style="padding:4px 10px; font-size:0.75rem; border-radius:6px; flex-shrink:0;" data-look="${lookName}">Opslaan</button>
            `;

            const saveBtn = row.querySelector('button');
            const input = row.querySelector('input');

            saveBtn.addEventListener('click', () => {
                const val = parseInt(input.value, 10);
                if (!isNaN(val) && val >= 0) {
                    this.saveLookDuration(lookName, val);
                } else {
                    delete this.lookDurations[lookName];
                    this.saveLookDurations();
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveBtn.click();
            });

            container.appendChild(row);
        });
    },

    saveLookDuration(lookName, seconds) {
        this.lookDurations[lookName] = seconds;
        this.saveLookDurations();
    },

    saveLookDurations() {
        localStorage.setItem('lookDurations', JSON.stringify(this.lookDurations));
        this.renderLookDurations();
    },

    // --- Tracker Functions ---

    async pollProPresenter() {
        if (!this.isServiceRunning) return;

        const data = await this.fetchCurrentLook();
        if (data && data.id && data.id.name) {
            const activeName = data.id.name;

            // Auto-stop on "Einde" look
            if (activeName.toLowerCase() === 'einde' && this.isServiceRunning) {
                this.toggleService();
                return;
            }

            // Check if look changed (only start tracking after first look is established)
            if (this.previousLookName !== null && activeName !== this.previousLookName) {
                // Close the previous item
                if (this.currentItem) {
                    this.currentItem.actualDuration = Math.floor((Date.now() - this.currentItem.startTime) / 1000);
                    this.serviceLog.push(this.currentItem);
                }

                // Start a new item for the current look
                const plannedDuration = this.lookDurations[activeName] || 0;

                this.currentItem = {
                    name: activeName,
                    plannedDuration: plannedDuration,
                    startTime: Date.now(),
                    actualDuration: 0,
                    avgSPL: '--',
                    peakSPL: '--'
                };
            } else if (this.previousLookName === null && activeName) {
                // First look detected — start tracking it
                const plannedDuration = this.lookDurations[activeName] || 0;
                this.currentItem = {
                    name: activeName,
                    plannedDuration: plannedDuration,
                    startTime: Date.now(),
                    actualDuration: 0,
                    avgSPL: '--',
                    peakSPL: '--'
                };
            } else if (this.currentItem && activeName === this.previousLookName) {
                // Update running duration of current item
                this.currentItem.actualDuration = Math.floor((Date.now() - this.currentItem.startTime) / 1000);
            }

            this.previousLookName = activeName;
        }

        this.renderDashboard();
    },

    toggleService() {
        const btn = document.getElementById('toggle-service-btn');
        if (this.isServiceRunning) {
            this.isServiceRunning = false;
            if (btn) {
                btn.innerText = __('analytics_start_tracking');
                btn.style.backgroundColor = "";
            }
            if (this.currentItem) {
                this.currentItem.actualDuration = Math.floor((Date.now() - this.currentItem.startTime) / 1000);
                this.serviceLog.push(this.currentItem);
                this.currentItem = null;
            }
            this.previousLookName = null;
            this.renderDashboard();
        } else {
            this.isServiceRunning = true;
            this.serviceStartTime = Date.now();
            this.serviceLog = [];
            this.currentItem = null;
            this.previousLookName = null;
            if (btn) {
                btn.innerText = __('analytics_end_session');
                btn.style.backgroundColor = "#ed1c24";
            }
            this.triggerWelkomMacro();
        }
    },

    scheduleAutoStart() {
        const timeVal = document.getElementById('auto-start-time').value;
        if (!timeVal) return alert('Please select a valid time.');

        const [hours, minutes] = timeVal.split(':').map(Number);
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        if (target < now) target.setDate(target.getDate() + 1);

        const delay = target - now;
        if (this.autoStartTimeout) clearTimeout(this.autoStartTimeout);

        this.autoStartTimeout = setTimeout(async () => {
            if (!this.isServiceRunning) await this.toggleService();
            this.cancelAutoStart();
        }, delay);

        const statusEl = document.getElementById('auto-start-status');
        if (statusEl) {
            statusEl.innerText = __('analytics_scheduled_prefix') + timeVal;
            statusEl.style.display = 'block';
        }
        const btn = document.getElementById('auto-start-btn');
        if (btn) {
            btn.innerText = __('analytics_cancel');
            btn.style.backgroundColor = '#ed1c24';
            btn.onclick = () => analyticsModule.cancelAutoStart();
        }
    },

    cancelAutoStart() {
        if (this.autoStartTimeout) clearTimeout(this.autoStartTimeout);
        this.autoStartTimeout = null;

        const statusEl = document.getElementById('auto-start-status');
        if (statusEl) statusEl.style.display = 'none';

        const btn = document.getElementById('auto-start-btn');
        if (btn) {
            btn.innerText = __('analytics_set');
            btn.style.backgroundColor = '';
            btn.onclick = () => analyticsModule.scheduleAutoStart();
        }
    },

    renderAutoStartStatus() {
        const statusEl = document.getElementById('auto-start-status');
        if (statusEl) statusEl.style.display = 'none';
    },

    // --- UI Functions ---

    renderDashboard() {
        let totalOverageSecs = 0;

        if (this.serviceStartTime && this.isServiceRunning) {
            const totalSecs = Math.floor((Date.now() - this.serviceStartTime) / 1000);
            const el = document.getElementById('total-service-time');
            if (el) el.innerText = analyticsModule.formatTime(totalSecs);
        }

        const tbody = document.getElementById('log-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const allItems = this.currentItem ? [...this.serviceLog, this.currentItem] : this.serviceLog;
        const itemsTrackedEl = document.getElementById('items-tracked');
        if (itemsTrackedEl) itemsTrackedEl.innerText = allItems.length;

        if (allItems.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Waiting for first Look to be activated...</td></tr>`;
            return;
        }

        allItems.forEach((item) => {
            const isActive = (item === this.currentItem);
            const diff = item.actualDuration - item.plannedDuration;

            if (!isActive) totalOverageSecs += diff;

            const diffClass = diff > 0 ? 'overage' : (diff < 0 ? 'under' : '');
            const diffText = (diff > 0 ? '+' : '') + analyticsModule.formatTime(diff);
            const rowClass = isActive ? 'class="active-row"' : '';
            const namePrefix = isActive ? '▶ ' : '<span class="status-complete">✔ </span>';
            const formattedName = item.name.replace(/US/g, '<span class="highlight-us">US</span>').replace(/us/g, '<span class="highlight-us">us</span>');

            tbody.innerHTML += `
                <tr ${rowClass}>
                    <td style="font-weight: ${isActive ? 'bold' : 'normal'}">${namePrefix}${formattedName}</td>
                    <td>${analyticsModule.formatTime(item.plannedDuration)}</td>
                    <td>${analyticsModule.formatTime(item.actualDuration)}</td>
                    <td class="${diffClass}">${diffText}</td>
                    <td>${item.avgSPL === '--' ? '--' : (isActive ? '~' : '') + item.avgSPL + ' dB'}</td>
                    <td>${item.peakSPL === '--' ? '--' : (isActive ? '~' : '') + item.peakSPL + ' dB'}</td>
                </tr>
            `;
        });

        const overageEl = document.getElementById('total-overage');
        if (overageEl) {
            overageEl.innerText = (totalOverageSecs > 0 ? '+' : '') + analyticsModule.formatTime(totalOverageSecs);
        }
    },

    formatTime(seconds) {
        const sign = seconds < 0 ? '-' : '';
        seconds = Math.abs(seconds);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return h > 0 ? `${sign}${h}:${m}:${s}` : `${sign}${m}:${s}`;
    },

    parseTimeStringToSeconds(timeStr) {
        if (!timeStr) return 0;
        const sign = timeStr.startsWith('-') ? -1 : 1;
        const cleanStr = timeStr.replace(/^[+-]/, '').split('.')[0];
        const parts = cleanStr.split(':');
        let seconds = 0;
        if (parts.length === 3) {
            seconds += (parseInt(parts[0], 10) || 0) * 3600;
            seconds += (parseInt(parts[1], 10) || 0) * 60;
            seconds += (parseInt(parts[2], 10) || 0);
        } else if (parts.length === 2) {
            seconds += (parseInt(parts[0], 10) || 0) * 60;
            seconds += (parseInt(parts[1], 10) || 0);
        } else if (parts.length === 1) {
            seconds += (parseInt(parts[0], 10) || 0);
        }
        return seconds * sign;
    },

    exportCSV() {
        if (this.serviceLog.length === 0) return alert("No data to export. Please end the session first.");
        let csv = "Look Name,Planned Duration,Actual Duration,Difference,Avg SPL,Peak SPL\\n";
        this.serviceLog.forEach(item => {
            const diff = item.actualDuration - item.plannedDuration;
            csv += `"${item.name}",${analyticsModule.formatTime(item.plannedDuration)},${analyticsModule.formatTime(item.actualDuration)},${analyticsModule.formatTime(diff)},${item.avgSPL},${item.peakSPL}\\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        a.download = `ProdLink_Service_Summary_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    importFromCSV(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            const lines = text.trim().replace(/\\\\n/g, '\n').split('\n');
            if (lines.length <= 1) return alert("CSV file is empty or invalid.");

            const newLog = [];
            let totalServiceSeconds = 0;

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;
                const nameMatch = line.match(/^"([^"]+)"/);
                if (!nameMatch) continue;
                const name = nameMatch[1];
                const rest = line.substring(nameMatch[0].length + 1);
                const values = rest.split(',');
                if (values.length < 5) continue;
                const actualDuration = analyticsModule.parseTimeStringToSeconds(values[1]);
                totalServiceSeconds += actualDuration;
                newLog.push({
                    name: name,
                    plannedDuration: analyticsModule.parseTimeStringToSeconds(values[0]),
                    actualDuration: actualDuration,
                    avgSPL: isNaN(parseInt(values[3])) ? '--' : parseInt(values[3]),
                    peakSPL: isNaN(parseInt(values[4])) ? '--' : parseInt(values[4]),
                    startTime: 0
                });
            }

            if (analyticsModule.isServiceRunning) analyticsModule.toggleService();
            analyticsModule.serviceLog = newLog;
            analyticsModule.currentItem = null;
            const el = document.getElementById('total-service-time');
            if (el) el.innerText = analyticsModule.formatTime(totalServiceSeconds);
            analyticsModule.renderDashboard();
            alert(`Imported ${newLog.length} items from ${file.name}.`);
        };
        reader.onerror = () => alert("Failed to read the file.");
        reader.readAsText(file);
        event.target.value = '';
    }
};

// Auto-initialize when view is shown - handled by router
