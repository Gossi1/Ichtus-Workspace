/**
 * Mic & IEM Monitor Widget Module
 * 
 * Handles:
 * - Real-time mic data from the Ichtus server (WebSocket hub + REST)
 * - 3D flip cards for mic info (front) and editing (back)
 * - Roster auto-assignment from WorshipTools extension
 * - AV Stage Business Rules for mic allocation
 * - Hardware write-back via the server (no Firebase)
 * 
 * Namespace: window.dashboardWidgets.micMonitor
 */
window.dashboardWidgets = window.dashboardWidgets || {};
window.dashboardWidgets.micMonitor = {

    _micLocalCache: [],
    _iemListenerAdded: false,
    _onIemStatus: null,
    _rosterListenerAdded: false,

    _initMicMonitor() {
        this._initIemListener();
        this._fetchIemStatus();
    },

    // Server pushes iem:status over the WebSocket hub (ws-client.js
    // dispatches it as a ws:iem:status CustomEvent) whenever the
    // assignment changes — on any device.
    _initIemListener() {
        if (this._iemListenerAdded) return;
        this._iemListenerAdded = true;
        this._onIemStatus = (e) => {
            const channels = e.detail?.channels;
            if (!channels || !Array.isArray(channels)) return;
            this._micLocalCache = channels;
            this._renderMicCardsDOM(channels);
        };
        document.addEventListener('ws:iem:status', this._onIemStatus);
    },

    // Hydratatie: haal de huidige status op bij het laden van de widget
    // (dekt ook de periode vóór de eerste WebSocket broadcast).
    async _fetchIemStatus() {
        try {
            const resp = await fetch('/api/iem/status', { cache: 'no-store' });
            if (!resp.ok) {
                console.warn('[MIC] Status endpoint niet bereikbaar:', resp.status);
                return;
            }
            const data = await resp.json();
            if (data.channels && Array.isArray(data.channels)) {
                this._micLocalCache = data.channels;
                this._renderMicCardsDOM(data.channels);
            }
        } catch (err) {
            console.warn('[MIC] Status ophalen mislukt:', err.message);
        }
    },

    _renderMicCardsDOM(channels) {
        const gridContainer = document.getElementById('mic-monitor-grid');
        if (!gridContainer) return;
        if (gridContainer.querySelector('.mic-flip-card.flipped')) return;

        if (!channels || channels.length === 0) {
            gridContainer.innerHTML = '<div class="pp-loading">Geen data…</div>';
            return;
        }

        const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23444"><circle cx="12" cy="12" r="12"/></svg>`;

        gridContainer.innerHTML = channels.map(mic => {
            const micLabel = mic.name || 'Unassigned / Standby';
            return `<div class="mic-flip-card" data-mic-id="${mic.mic_id}" onclick="dashboardModule._flipMicCard(${mic.mic_id})">
                <div class="mic-flip-inner">
                    <div class="mic-flip-front mic-card">
                        <div class="mic-card-photo" style="background-image: url(${mic.avatar_url || fallbackSvg});">
                            <span class="mic-badge">MIC ${mic.mic_id}</span>
                        </div>
                        <div class="mic-card-info">
                            <div class="mic-name">${micLabel}</div>
                            <div class="mic-iem">${mic.iem_pack}</div>
                            <div class="mic-frequency">${mic.frequency}</div>
                        </div>
                    </div>
                    <div class="mic-flip-back">
                        <div class="mic-card-header">
                            <span class="mic-label">CONFIG MIC ${mic.mic_id}</span>
                        </div>
                        <div class="mic-edit-fields">
                            <div class="mic-edit-row">
                                <label>IEM Pack</label>
                                <input type="text" class="mic-input edit-iem" value="${mic.iem_pack}" placeholder="IEM Pack ${mic.mic_id}" onclick="event.stopPropagation()">
                            </div>
                            <div class="mic-edit-row">
                                <label>RF Frequentie</label>
                                <input type="text" class="mic-input edit-freq" value="${mic.frequency}" placeholder="000.000 MHz" onclick="event.stopPropagation()">
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    _flipMicCard(micId) {
        const flipCard = document.querySelector(`#mic-monitor-grid .mic-flip-card[data-mic-id="${micId}"]`);
        if (!flipCard) return;
        
        const isCurrentlyFlipped = flipCard.classList.contains('flipped');
        
        if (isCurrentlyFlipped) {
            const iemPack = flipCard.querySelector('.edit-iem')?.value?.trim() || '';
            const frequency = flipCard.querySelector('.edit-freq')?.value?.trim() || '';
            
            if (!this._micLocalCache || !Array.isArray(this._micLocalCache)) return;
            const channel = this._micLocalCache.find(c => c.mic_id === micId);
            if (!channel) return;
            
            const changed = channel.iem_pack !== iemPack || channel.frequency !== frequency;
            channel.iem_pack = iemPack;
            channel.frequency = frequency;
            
            if (changed) {
                this._postIemAssign(this._micLocalCache);
            }
            
            const frontIem = flipCard.querySelector('.mic-flip-front .mic-iem');
            const frontFreq = flipCard.querySelector('.mic-flip-front .mic-frequency');
            if (frontIem) frontIem.textContent = iemPack;
            if (frontFreq) frontFreq.textContent = frequency;
            
            flipCard.classList.remove('flipped');
        } else {
            flipCard.classList.add('flipped');
        }
    },

    // ===============================
    //  ROSTER → MIC AUTO-ASSIGNMENT
    // ===============================

    _initRosterListener() {
        if (this._rosterListenerAdded) return;
        this._rosterListenerAdded = true;
        document.addEventListener('worshiptools-roster', (e) => {
            const roster = e.detail?.roster;
            if (!roster || !Array.isArray(roster)) return;
            console.log('[MIC] Received roster from extension:', roster.length, 'assignments');
            this._processRoster(roster);
        });
    },

    _getFirstName(fullName) {
        if (!fullName) return '';
        return fullName.trim().split(' ')[0];
    },

    _processRoster(roster) {
        const personRoles = {};
        const personAvatars = {};
        roster.forEach(entry => {
            const firstName = this._getFirstName(entry.name);
            if (!personRoles[firstName]) personRoles[firstName] = new Set();
            personRoles[firstName].add(entry.role);
            if (entry.avatar_url && !personAvatars[firstName]) personAvatars[firstName] = entry.avatar_url;
        });

        let wlName = null;
        const vocalists = [];

        for (const [name, roles] of Object.entries(personRoles)) {
            const rolesLower = new Set();
            roles.forEach(r => rolesLower.add(r.toLowerCase()));
            if (rolesLower.has('worship leader')) wlName = name;
            if (rolesLower.has('vocalist')) vocalists.push(name);
        }

        console.log('[MIC] WL:', wlName, '| Vocalists:', vocalists);

        const assignments = [];
        let micIndex = 1;

        if (wlName) {
            const wlRoles = personRoles[wlName];
            const wlRolesLower = new Set();
            wlRoles.forEach(r => wlRolesLower.add(r.toLowerCase()));
            if (!wlRolesLower.has('piano')) {
                assignments.push({ mic_id: micIndex, name: wlName });
                micIndex++;
            } else {
                console.log('[MIC] WL', wlName, 'also on Piano — skipping mic assignment');
            }
        }

        vocalists.forEach(name => {
            if (name !== wlName && micIndex <= 4) {
                assignments.push({ mic_id: micIndex, name });
                micIndex++;
            }
        });

        console.log('[MIC] Final assignments:', assignments);

        const channels = [];
        for (let i = 1; i <= 4; i++) {
            const assigned = assignments.find(a => a.mic_id === i);
            channels.push({
                mic_id: i,
                name: assigned ? assigned.name : 'Unassigned / Standby',
                iem_pack: 'IEM Pack ' + i,
                frequency: '',
                active: !!assigned,
                avatar_url: assigned ? (personAvatars[assigned.name] || '') : ''
            });
        }

        this._postIemAssign(channels);
    },

    // Push toewijzing naar de server; die persisteert en broadcast de
    // nieuwe status over de WebSocket hub naar alle clients.
    async _postIemAssign(channels) {
        try {
            const resp = await fetch('/api/iem/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channels }),
            });
            if (!resp.ok) {
                console.error('[MIC] Assign POST mislukt:', resp.status);
                return;
            }
            console.log('[MIC] Mic toewijzing verstuurd naar server');
        } catch (err) {
            console.error('[MIC] Assign POST error:', err);
        }
    }
};
