/* ============================================
   ANALYTICS MODULE
   Service Tracking Analytics - merged from ProPresenter
   ============================================ */

const analyticsModule = {
    PP_IP: "100.113.22.22",
    PP_PORT: "51253",
    BASE_URL: null,
    SERVICE_SEQUENCE: null,
    isServiceRunning: false,
    serviceStartTime: null,
    sectionTimerId: null,
    currentItem: null,
    serviceLog: [],
    sequenceIndex: 0,
    autoStartTimeout: null,
    initialized: false,

    init() {
        if (this.initialized && this._lastView === 'analytics') return;

        // Clean up any previous poll interval before reinitializing
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }

        this.initialized = true;
        this._lastView = 'analytics';

        this.BASE_URL = `http://${this.PP_IP}:${this.PP_PORT}/v1`;

        // Load sequence
        this.SERVICE_SEQUENCE = JSON.parse(localStorage.getItem('serviceSequence')) || [
            { name: "Welkom", displayName: "Welkom" },
            { name: "Worship", plannedDuration: 300, displayName: "Openingslied" },
            { name: "Mededelingen", displayName: "Mededelingen" },
            { name: "Worship", plannedDuration: 1800, displayName: "Worship" },
            { name: "Scripture", displayName: "Preek" },
            { name: "Worship", plannedDuration: 480, displayName: "Eindlied" },
            { name: "Einde", plannedDuration: 0, displayName: "Einde" }
        ];

        this.renderServiceSequence();
        this.renderDashboard();

        // Find Section_Timer ID
        this.initializeTracker().then(id => {
            if (id) {
                this.sectionTimerId = id;
            }
        });

        // Poll ProPresenter
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

    async fetchSectionTimerDuration(sectionTimerId) {
        try {
            const timerResponse = await fetch(`${this.BASE_URL}/timer/${sectionTimerId}`);
            if (timerResponse.ok) return await timerResponse.json();
        } catch (err) {
            console.error("Failed to fetch Section_Timer duration:", err);
        }
        return null;
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

    async initializeTracker() {
        try {
            const response = await fetch(`${this.BASE_URL}/timers`);
            if (response.ok) {
                const timers = await response.json();
                const sectionTimer = timers.find(t => t.id && t.id.name && t.id.name.toLowerCase() === 'section_timer');
                if (sectionTimer) return sectionTimer.id.uuid;
            }
        } catch (err) {
            console.error("Failed to initialize timers:", err);
        }
        return null;
    },

    // --- Tracker Functions ---

    saveServiceSequence() {
        localStorage.setItem('serviceSequence', JSON.stringify(this.SERVICE_SEQUENCE));
        this.renderServiceSequence();
    },

    addSequenceItem() {
        const lookNameInput = document.getElementById('new-sequence-look-name');
        const displayNameInput = document.getElementById('new-sequence-display-name');
        const plannedDurationInput = document.getElementById('new-sequence-planned-duration');

        const lookName = lookNameInput.value.trim();
        const displayName = displayNameInput.value.trim();
        const plannedDuration = parseInt(plannedDurationInput.value, 10);

        if (!lookName || !displayName) {
            alert('Please enter a valid Look Name and Display Name.');
            return;
        }

        const newItem = { name: lookName, displayName: displayName };
        if (!isNaN(plannedDuration) && plannedDuration >= 0) {
            newItem.plannedDuration = plannedDuration;
        }

        this.SERVICE_SEQUENCE.push(newItem);
        this.saveServiceSequence();

        lookNameInput.value = '';
        displayNameInput.value = '';
        plannedDurationInput.value = '';
    },

    removeSequenceItem(index) {
        if (confirm(`Are you sure you want to remove "${this.SERVICE_SEQUENCE[index].displayName}" from the sequence?`)) {
            this.SERVICE_SEQUENCE.splice(index, 1);
            this.saveServiceSequence();
        }
    },

    async pollProPresenter() {
        if (!this.isServiceRunning) return;

        const data = await this.fetchCurrentLook();
        if (data && data.id && data.id.name) {
            const activeName = data.id.name;

            if (activeName.toLowerCase() === 'einde' && this.isServiceRunning) {
                this.toggleService();
                return;
            }

            if (!this.currentItem || activeName.toLowerCase() !== this.currentItem.name.toLowerCase()) {
                let foundNewSequenceIndex = -1;
                for (let i = this.sequenceIndex; i < this.SERVICE_SEQUENCE.length; i++) {
                    if (this.SERVICE_SEQUENCE[i].name.trim().toLowerCase() === activeName.trim().toLowerCase()) {
                        foundNewSequenceIndex = i;
                        break;
                    }
                }

                if (foundNewSequenceIndex !== -1) {
                    if (this.currentItem) {
                        this.currentItem.actualDuration = Math.floor((Date.now() - this.currentItem.startTime) / 1000);
                        this.serviceLog.push(this.currentItem);
                    }

                    this.sequenceIndex = foundNewSequenceIndex;
                    const currentSequenceItemDefinition = this.SERVICE_SEQUENCE[this.sequenceIndex];

                    let plannedDuration = currentSequenceItemDefinition.plannedDuration;

                    if (plannedDuration === undefined && this.sectionTimerId) {
                        const timerData = await this.fetchSectionTimerDuration(this.sectionTimerId);
                        if (timerData) {
                            let fetchedDuration = 0;
                            if (timerData.countdown && typeof timerData.countdown.duration === 'number') {
                                fetchedDuration = timerData.countdown.duration;
                            } else if (timerData.elapsed && timerData.elapsed.has_end_time && typeof timerData.elapsed.end_time === 'number') {
                                fetchedDuration = timerData.elapsed.end_time;
                            } else if (typeof timerData.clockDuration === 'string') {
                                fetchedDuration = analyticsModule.parseTimeStringToSeconds(timerData.clockDuration);
                            } else if (typeof timerData.duration === 'string') {
                                fetchedDuration = analyticsModule.parseTimeStringToSeconds(timerData.duration);
                            } else if (typeof timerData.duration === 'number') {
                                fetchedDuration = timerData.duration;
                            } else if (timerData.duration && typeof timerData.duration.time === 'number') {
                                fetchedDuration = timerData.duration.time;
                            }
                            plannedDuration = fetchedDuration > 0 ? fetchedDuration : 0;
                        } else {
                            plannedDuration = 0;
                        }
                    } else if (plannedDuration === undefined) {
                        plannedDuration = 0;
                    }

                    this.currentItem = {
                        name: activeName,
                        displayName: currentSequenceItemDefinition.displayName,
                        plannedDuration: plannedDuration,
                        startTime: Date.now(),
                        actualDuration: 0,
                        avgSPL: '--',
                        peakSPL: '--',
                        sequenceIndex: this.sequenceIndex
                    };
                    if (this.sequenceIndex < this.SERVICE_SEQUENCE.length - 1) {
                        this.sequenceIndex++;
                    }
                } else {
                    if (this.currentItem) {
                        this.currentItem.actualDuration = Math.floor((Date.now() - this.currentItem.startTime) / 1000);
                    }
                }
            } else if (this.currentItem) {
                this.currentItem.actualDuration = Math.floor((Date.now() - this.currentItem.startTime) / 1000);
            }
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
            this.renderDashboard();
            this.sequenceIndex = 0;
        } else {
            this.isServiceRunning = true;
            this.serviceStartTime = Date.now();
            this.serviceLog = [];
            this.currentItem = null;
            this.sequenceIndex = 0;
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

    // --- UI Functions ---

    renderServiceSequence() {
        const container = document.getElementById('service-sequence-display');
        if (!container) return;
        container.innerHTML = '';
        this.SERVICE_SEQUENCE.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'toggle-item sequence-row';
            itemDiv.innerHTML = `
                <span>${index + 1}. <strong>${item.displayName}</strong> (${item.name}) - ${item.plannedDuration !== undefined ? analyticsModule.formatTime(item.plannedDuration) : 'Auto'}</span>
                <button class="btn-delete" onclick="analyticsModule.removeSequenceItem(${index})">&times;</button>
            `;
            container.appendChild(itemDiv);
        });
    },

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
            const displayText = item.displayName || item.name;
            const formattedName = displayText.replace(/US/g, '<span class="highlight-us">US</span>').replace(/us/g, '<span class="highlight-us">us</span>');

            tbody.innerHTML += `
                <tr ${rowClass} data-sequence-index="${item.sequenceIndex}">
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
            const lines = text.trim().replace(/\\n/g, '\n').split('\n');
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
