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
    _wtSyncInFlight: false,
    _wtInitialSyncDone: false,

    _initMicMonitor() {
        this._initIemListener();
        this._initRosterListener();
        if (this._micLocalCache && this._micLocalCache.length > 0) {
            this._renderMicCardsDOM(this._micLocalCache);
        }
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

                const hasAssigned = data.channels.some(c => c.active && c.name && c.name !== 'Unassigned / Standby');
                if (!hasAssigned || !this._wtInitialSyncDone) {
                    this._wtInitialSyncDone = true;
                    this._syncFromWorshipTools();
                }
            }
        } catch (err) {
            console.warn('[MIC] Status ophalen mislukt:', err.message);
        }
    },

    async _syncFromWorshipTools(preferredServiceId) {
        if (this._wtSyncInFlight) return;
        this._wtSyncInFlight = true;
        try {
            let serviceId = preferredServiceId || '';
            if (!serviceId) {
                try { serviceId = localStorage.getItem('wt_selected_service') || ''; } catch (e) {}
            }

            const svcsResp = await fetch('/api/worshiptools-services/services', { cache: 'no-store' });
            if (svcsResp.ok) {
                const svcsData = await svcsResp.json();
                const upcoming = Array.isArray(svcsData.upcoming) ? svcsData.upcoming : [];
                const past = Array.isArray(svcsData.past) ? svcsData.past : [];
                const all = upcoming.concat(past);

                // Als de opgeslagen serviceId niet (meer) bestaat of in het verleden ligt terwijl er een komende dienst is,
                // kies dan de eerstvolgende dienst.
                const found = serviceId ? all.find(s => s.id === serviceId) : null;
                if (!found || (found.isPast && upcoming.length > 0 && !preferredServiceId)) {
                    serviceId = (upcoming[0] && upcoming[0].id) || (past[0] && past[0].id) || '';
                }
            }

            if (!serviceId) return;

            const rosterResp = await fetch('/api/worshiptools-services/services/' + encodeURIComponent(serviceId) + '/roster', { cache: 'no-store' });
            if (!rosterResp.ok) return;
            const rosterData = await rosterResp.json();
            if (rosterData && Array.isArray(rosterData.roster) && rosterData.roster.length > 0) {
                this._processRoster(rosterData.roster);
            }
        } catch (err) {
            console.warn('[MIC] Auto-sync vanuit WorshipTools mislukt:', err.message);
        } finally {
            this._wtSyncInFlight = false;
        }
    },

    _renderMicCardsDOM(channels) {
        const grids = document.querySelectorAll('#mic-monitor-grid, .mic-monitor-grid');
        if (!grids || grids.length === 0) return;

        const escapeHtml = str => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const buildFallbackSvg = (name, isAssigned) => {
            if (!isAssigned) {
                return `data:image/svg+xml;utf8,` + encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
                    `<rect width="120" height="120" fill="#262626"/>` +
                    `<circle cx="60" cy="54" r="18" fill="#3a3a3a"/>` +
                    `<path d="M30 106c0-16.5 13.5-30 30-30s30 13.5 30 30" fill="#3a3a3a"/>` +
                    `</svg>`
                );
            }
            const initial = (String(name || '').trim().charAt(0) || '🎤').toUpperCase();
            return `data:image/svg+xml;utf8,` + encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
                `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#334155"/><stop offset="100%" stop-color="#1e293b"/></linearGradient></defs>` +
                `<rect width="120" height="120" fill="url(#g)"/>` +
                `<circle cx="60" cy="64" r="28" fill="rgba(244,121,32,0.18)" stroke="rgba(244,121,32,0.45)" stroke-width="2"/>` +
                `<text x="60" y="74" text-anchor="middle" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700">${initial}</text>` +
                `</svg>`
            );
        };
        const safeAvatar = (url, name, isAssigned) => {
            if (!url || typeof url !== 'string') return buildFallbackSvg(name, isAssigned);
            const t = url.trim();
            if (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('data:image/')) {
                return t.replace(/["'()]/g, '');
            }
            return buildFallbackSvg(name, isAssigned);
        };

        grids.forEach(gridContainer => {
            if (gridContainer.querySelector('.mic-flip-card.flipped')) return;

            if (!channels || channels.length === 0) {
                gridContainer.innerHTML = '<div class="pp-loading">Geen data…</div>';
                return;
            }

            gridContainer.innerHTML = channels.map(mic => {
                const rawName = mic.name || 'Unassigned / Standby';
                const isAssigned = Boolean(mic.active && rawName !== 'Unassigned / Standby');
                const micLabel = escapeHtml(rawName);
                const iemPack = escapeHtml(mic.iem_pack || '');
                const frequency = escapeHtml(mic.frequency || '');
                const avatarUrl = safeAvatar(mic.avatar_url, rawName, isAssigned);
                const micId = parseInt(mic.mic_id) || 0;
                return `<div class="mic-flip-card" data-mic-id="${micId}" onclick="dashboardModule._flipMicCard(${micId})">
                    <div class="mic-flip-inner">
                        <div class="mic-flip-front mic-card">
                            <div class="mic-card-photo" style="background-image: url('${avatarUrl}');">
                                <span class="mic-badge">MIC ${micId}</span>
                            </div>
                            <div class="mic-card-info">
                                <div class="mic-name">${micLabel}</div>
                                <div class="mic-iem">${iemPack}</div>
                                <div class="mic-frequency">${frequency}</div>
                            </div>
                        </div>
                        <div class="mic-flip-back">
                            <div class="mic-card-header">
                                <span class="mic-label">CONFIG MIC ${micId}</span>
                            </div>
                            <div class="mic-edit-fields">
                                <div class="mic-edit-row">
                                    <label>IEM Pack</label>
                                    <input type="text" class="mic-input edit-iem" value="${iemPack}" placeholder="IEM Pack ${micId}" onclick="event.stopPropagation()">
                                </div>
                                <div class="mic-edit-row">
                                    <label>RF Frequentie</label>
                                    <input type="text" class="mic-input edit-freq" value="${frequency}" placeholder="000.000 MHz" onclick="event.stopPropagation()">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('');
        });
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
        document.addEventListener('ws:wt:roster', (e) => {
            const d = e.detail || {};
            if (d.source === 'server') return; // Server already updated IEM manager and broadcasted ws:iem:status
            const roster = d.roster;
            if (!roster || !Array.isArray(roster)) return;
            console.log('[MIC] Received roster via WebSocket:', roster.length, 'assignments');
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
            if (!firstName) return;
            if (!personRoles[firstName]) personRoles[firstName] = new Set();
            if (entry.role) personRoles[firstName].add(entry.role);
            const avatar = entry.avatar_url || entry.avatarUrl || '';
            if (avatar && !personAvatars[firstName]) personAvatars[firstName] = avatar;
        });

        let wlName = null;
        const vocalists = [];

        for (const [name, roles] of Object.entries(personRoles)) {
            const rolesLower = new Set();
            roles.forEach(r => rolesLower.add(String(r).toLowerCase()));
            if (rolesLower.has('worship leader')) wlName = name;
            if (rolesLower.has('vocalist')) vocalists.push(name);
        }

        console.log('[MIC] WL:', wlName, '| Vocalists:', vocalists);

        const assignments = [];
        let micIndex = 1;

        if (wlName) {
            const wlRoles = personRoles[wlName];
            const wlRolesLower = new Set();
            wlRoles.forEach(r => wlRolesLower.add(String(r).toLowerCase()));
            if (!wlRolesLower.has('piano') && !wlRolesLower.has('keys')) {
                assignments.push({ mic_id: micIndex, name: wlName });
                micIndex++;
            } else {
                console.log('[MIC] WL', wlName, 'also on Piano/Keys — skipping mic assignment');
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
            const existing = (this._micLocalCache || []).find(c => c.mic_id === i);
            channels.push({
                mic_id: i,
                name: assigned ? assigned.name : 'Unassigned / Standby',
                iem_pack: (existing && existing.iem_pack) ? existing.iem_pack : ('IEM Pack ' + i),
                frequency: (existing && existing.frequency) ? existing.frequency : '',
                active: !!assigned,
                avatar_url: assigned ? (personAvatars[assigned.name] || (existing && existing.avatar_url) || '') : ''
            });
        }

        this._micLocalCache = channels;
        this._renderMicCardsDOM(channels);
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
