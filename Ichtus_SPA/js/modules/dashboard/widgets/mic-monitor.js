/**
 * Mic & IEM Monitor Widget Module
 * 
 * Handles:
 * - Real-time mic data from Firebase (Realtime DB or Firestore)
 * - 3D flip cards for mic info (front) and editing (back)
 * - Roster auto-assignment from WorshipTools extension
 * - AV Stage Business Rules for mic allocation
 * - Hardware write-back to Firestore
 * 
 * Namespace: window.dashboardWidgets.micMonitor
 */
window.dashboardWidgets = window.dashboardWidgets || {};
window.dashboardWidgets.micMonitor = {

    _micLocalCache: [],
    _micUnsubscribe: null,
    _rosterListenerAdded: false,

    _initMicMonitor() {
        if (typeof firebase === 'undefined' || !firebase.database) {
            this._initMicMonitorFirestore();
            return;
        }
        try {
            const ref = firebase.database().ref('/mic_monitor/live_status');
            this._micUnsubscribe = ref.on('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this._micLocalCache = data;
                    this._renderMicCardsDOM(data);
                }
            });
        } catch (e) {
            console.warn('[MIC] Realtime Database failed, trying Firestore:', e.message);
            this._initMicMonitorFirestore();
        }
    },

    _initMicMonitorFirestore() {
        if (typeof firebase === 'undefined' || !firebase.firestore) {
            console.warn('[MIC] No Firebase available');
            return;
        }
        try {
            this._micUnsubscribe = firebase.firestore().collection('mic_monitor').doc('live_status')
                .onSnapshot((doc) => {
                    if (doc.exists) {
                        const data = doc.data();
                        const channels = data.channels || [];
                        this._micLocalCache = channels;
                        this._renderMicCardsDOM(channels);
                    }
                }, (err) => {
                    console.warn('[MIC] Firestore listener error:', err.message);
                });
        } catch (e) {
            console.warn('[MIC] Firestore init failed:', e.message);
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
                this._writeMicAssignmentsToFirestore(this._micLocalCache, 'hardware');
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

        this._writeMicAssignmentsToFirestore(channels);
    },

    _writeMicAssignmentsToFirestore(channels, context) {
        if (typeof firebase === 'undefined') {
            console.warn('[MIC] No Firebase available — cannot write assignments');
            return;
        }

        const isHardwareSave = context === 'hardware';
        const label = isHardwareSave ? 'Mic configuratie' : 'Mic toewijzing';
        const activeCount = channels.filter(c => c.active).length;

        if (firebase.firestore) {
            try {
                firebase.firestore().collection('mic_monitor').doc('live_status').set({
                    channels: channels,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true }).then(() => {
                    console.log('[MIC]', label, 'written to Firestore');
                }).catch(err => {
                    console.error('[MIC] Firestore write failed:', err);
                });
            } catch (e) {
                console.error('[MIC] Firestore write error:', e);
            }
        } else if (firebase.database) {
            try {
                firebase.database().ref('/mic_monitor/live_status').set(channels).then(() => {
                    console.log('[MIC]', label, 'written to RTDB');
                }).catch(err => {
                    console.error('[MIC] RTDB write failed:', err);
                });
            } catch (e) {
                console.error('[MIC] RTDB write error:', e);
            }
        }
    }
};
