/* ============================================
   WORSHIPTOOLS SERVICES MODULE
   Linkerbalk met de 10 komende + 4 afgelopen
   diensten (live uit WorshipTools Firestore).
   Klik op een dienst → volledige setlist direct
   in beeld. Node-port van test_api.py op de
   server: /api/worshiptools-services/*
   ============================================ */

const wtServicesModule = {
    initialized: false,
    services: [],          // [{ id, name, displayDate, time, isToday, isPast, cuesCount, rehearsals }]
    selectedId: null,
    pollTimer: null,
    setlistPollTimer: null,
    lastSetlistKey: '',     // fingerprint van de laatst getoonde setlist (om re-renders te skippen)
    loadingList: false,

    // Live volgen van de geselecteerde dienst. Interval (ms) is configureerbaar
    // via de dropdown in de Diensten-kaart; 0 = uit.
    liveIntervalMs: 3000,

    init() {
        // One-time setup
        if (!this.initialized) {
            this.initialized = true;

            document.getElementById('btn-wt-services-refresh')?.addEventListener('click', () => this.loadServices(true));

            // Interval-selector: uit / 2s / 3s / 5s / 10s — opgeslagen in localStorage
            const sel = document.getElementById('wt-svc-live-interval');
            if (sel) {
                let current = 3000;
                try {
                    const saved = localStorage.getItem('wt_svc_live_interval');
                    if (saved != null && saved !== '') current = Number(saved);
                } catch (e) {}
                this.liveIntervalMs = isNaN(current) ? 3000 : Math.max(0, current);
                sel.value = String(this.liveIntervalMs);
                sel.addEventListener('change', () => {
                    const val = parseInt(sel.value, 10) || 0;
                    this.liveIntervalMs = Math.max(0, val);
                    try { localStorage.setItem('wt_svc_live_interval', String(this.liveIntervalMs)); } catch (e) {}
                    this.restartSetlistPoll();
                    this.updateLiveStatus();
                });
            }

            // Restore laatst geselecteerde dienst
            try { this.selectedId = localStorage.getItem('wt_selected_service') || null; } catch (e) {}
        }

        // Bij elke keer dat de setlist-view geopend wordt: lijst verversen
        this.loadServices(false);

        // Auto-ververs elke 5 minuten zolang de view open staat
        this.clearPoll();
        this.pollTimer = setInterval(() => {
            if (typeof router !== 'undefined' && router.isSetlistActive && router.isSetlistActive()) {
                this.loadServices(false);
            }
        }, 5 * 60 * 1000);

        // Live volgen van de geselecteerde dienst: interval configureerbaar,
        // setlist opnieuw ophalen (?live=1) zodat wijzigingen van de worship
        // leader in WorshipTools meteen zichtbaar worden.
        this.startSetlistPoll();

        // Eerder geselecteerde dienst opnieuw laden (uit cache van de server)
        if (this.selectedId) {
            this.lastSetlistKey = '';
            this.loadSetlist(this.selectedId).then(() => this.updateLiveStatus());
        }
    },

    /** Interval (ms) uitlezen; 0 = live volgen uit */
    getLiveInterval() {
        return this.liveIntervalMs > 0 ? this.liveIntervalMs : 0;
    },

    /** (Her)start de live-poll met het gekozen interval */
    startSetlistPoll() {
        this.clearSetlistPoll();
        const interval = this.getLiveInterval();
        if (!interval) return;
        this.setlistPollTimer = setInterval(() => {
            if (!this.selectedId) return;
            if (typeof router !== 'undefined' && router.isSetlistActive && !router.isSetlistActive()) return;
            this.loadSetlist(this.selectedId, true);
        }, interval);
    },

    restartSetlistPoll() {
        this.clearSetlistPoll();
        this.startSetlistPoll();
    },

    /** Statusregel bijwerken met het actieve interval (of 'uit') */
    updateLiveStatus() {
        const statusEl = document.getElementById('wt-services-status');
        if (!statusEl || !this.selectedId) return;
        const interval = this.getLiveInterval();
        if (interval > 0) {
            statusEl.textContent = `● Live volgen actief (elke ${Math.round(interval / 1000)}s)`;
        } else {
            statusEl.textContent = '';
        }
    },

    cleanup() {
        this.clearPoll();
        this.clearSetlistPoll();
    },

    clearPoll() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },

    clearSetlistPoll() {
        if (this.setlistPollTimer) {
            clearInterval(this.setlistPollTimer);
            this.setlistPollTimer = null;
        }
    },

    // ── Lijst ophalen ──────────────────────────────────────────────
    async loadServices(force) {
        if (this.loadingList) return;
        this.loadingList = true;

        const listEl = document.getElementById('wt-services-list');
        const statusEl = document.getElementById('wt-services-status');

        if (force && listEl && !this.services.length) {
            listEl.innerHTML = '<div class="wt-svc-loading">⏳ Diensten ophalen…</div>';
        }
        if (statusEl) statusEl.textContent = force ? 'Verversen…' : '';

        try {
            const resp = await fetch('/api/worshiptools-services/services' + (force ? '?refresh=1' : ''));
            const data = await resp.json();

            if (!resp.ok || !data.success) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }

            // Komende bovenaan, afgelopen onderaan de lijst
            this.services = [...(data.upcoming || []), ...(data.past || [])];
            this.renderList();

            const when = new Date(data.fetchedAt).toLocaleTimeString('nl-NL');
            if (statusEl) statusEl.textContent = `Geverifieerd ${when}`;
        } catch (err) {
            console.warn('[WT-SVC] Diensten ophalen mislukt:', err?.message);
            if (listEl && !this.services.length) {
                listEl.innerHTML = `<div class="wt-svc-error">⚠️ Kon diensten niet ophalen<br><small>${this.escapeHtml(err?.message || '')}</small></div>`;
            }
            if (statusEl) statusEl.textContent = 'Fout bij ophalen';
        } finally {
            this.loadingList = false;
        }
    },

    // ── Render linkerbalk ──────────────────────────────────────────
    renderList() {
        const listEl = document.getElementById('wt-services-list');
        if (!listEl) return;

        if (!this.services.length) {
            listEl.innerHTML = '<div class="wt-svc-empty">Geen diensten gevonden in WorshipTools.</div>';
            return;
        }

        const upcoming = this.services.filter(s => !s.isPast);
        const past = this.services.filter(s => s.isPast);

        const renderItem = (s) => {
            const active = s.id === this.selectedId ? ' active' : '';
            const today = s.isToday ? ' today' : '';
            const countLabel = s.cuesCount > 0 ? `${s.cuesCount}` : '—';
            const reps = (s.rehearsals && s.rehearsals.length)
                ? `<div class="wt-svc-reps">Repeat: ${this.escapeHtml(s.rehearsals.join(', '))}</div>`
                : '';
            return `
                <button class="wt-svc-item${active}${today}" data-id="${this.escapeHtml(s.id)}" onclick="wtServicesModule.selectService('${this.escapeHtml(s.id)}')">
                    <div class="wt-svc-item-top">
                        <span class="wt-svc-date">${this.escapeHtml(s.displayDate)}</span>
                        <span class="wt-svc-count" title="Aantal nummers">${countLabel}</span>
                    </div>
                    <div class="wt-svc-name">${this.escapeHtml(s.name)}</div>
                    ${reps}
                </button>`;
        };

        let html = upcoming.map(renderItem).join('');
        if (past.length) {
            html += `<div class="wt-svc-divider">Afgelopen</div>`;
            html += past.map(renderItem).join('');
        }
        listEl.innerHTML = html;
    },

    // ── Dienst selecteren → setlist laden ──────────────────────────
    async selectService(id) {
        this.selectedId = id;
        // Reset fingerprint zodat een nieuwe dienst altijd volledig rendert
        this.lastSetlistKey = '';
        try { localStorage.setItem('wt_selected_service', id); } catch (e) {}
        this.renderList();
        await this.loadSetlist(id);
        // Toon live-indicator zolang een dienst geselecteerd is
        this.updateLiveStatus();
    },

    /**
     * Haal de setlist van een dienst op.
     * silent=true → geen loading-spinner, geen re-render als de data
     * hetzelfde is als de vorige keer (gebruikt door de live-poll).
     */
    async loadSetlist(id, silent = false) {
        const previewEl = document.getElementById('setlist-preview');

        if (!previewEl) return;

        // Markeer actieve item (ook bij restore zonder klik)
        if (!silent) {
            document.querySelectorAll('.wt-svc-item').forEach(el => {
                el.classList.toggle('active', el.dataset.id === id);
            });
        }

        if (!silent) {
            previewEl.innerHTML = '<div class="wt-svc-loading">⏳ Setlist ophalen…</div>';
        }

        try {
            const resp = await fetch(`/api/worshiptools-services/services/${encodeURIComponent(id)}/setlist${silent ? '?live=1' : ''}`);
            const data = await resp.json();
            if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);

            // Fingerprint van de setlist: bij live-poll alleen updaten als de
            // songs echt veranderd zijn (voorkomt DOM-flikkering elke 3s).
            const key = (data.songs || []).map(s => `${s.position}|${s.title}|${s.key}`).join('\n');
            if (silent && key === this.lastSetlistKey) return;
            this.lastSetlistKey = key;

            if (!data.songs || data.songs.length === 0) {
                if (!silent) previewEl.innerHTML = '<p class="setlist-empty">Geen nummers toegevoegd aan deze dienst.</p>';
                return;
            }

            // Categorize songs into opening / praise / closing buckets
            // using the same markers as setlist.js parseSongs()
            const opening = [], praise = [], closing = [];
            let bucket = opening;
            const ignore = ['preek', 'opening dienst', 'offergave', 'repetities', 'kerkdiensten', 'worship tools', 'avondmaal', 'reserve'];

            for (const song of data.songs) {
                const title = song.title || '';

                if (title.includes('D000 - Opening dienst en offergave')) {
                    bucket = praise;
                    continue;
                }
                if (title.includes('D000 - Preek')) {
                    bucket = closing;
                    continue;
                }
                if (/setlist\s*eind/i.test(title)) break;
                if (ignore.some(w => title.toLowerCase().includes(w))) continue;

                const numMatch = title.match(/^([A-Z]{1,3}\s*\d{1,4}[A-Za-z]?)\s+(.+)/);
                bucket.push({
                    number: numMatch ? numMatch[1] : null,
                    name: numMatch ? numMatch[2] : title,
                });
            }

            const renderBucket = (label, cls, songs) => {
                if (!songs.length) return '';
                let h = `<div class="song-bucket"><h4 class="bucket-title ${cls}">${label} (${songs.length})</h4><ul class="song-link-list">`;
                songs.forEach(s => {
                    const badge = s.number ? `<span class="song-number-badge">${this.escapeHtml(s.number)}</span> ` : '';
                    h += `<li>${badge}${this.escapeHtml(s.name)}</li>`;
                });
                h += '</ul></div>';
                return h;
            };

            let html = '';
            html += renderBucket('Openingsliederen', 'bucket-opening', opening);
            html += renderBucket('Praise & Worship', 'bucket-praise', praise);
            html += renderBucket('Eindliederen', 'bucket-closing', closing);
            if (!html) html = '<p class="setlist-empty">Geen nummers gevonden in de setlist.</p>';

            previewEl.innerHTML = html;

            // Feed parsed songs into setlistModule so sync uses WT data
            if (typeof setlistModule !== 'undefined') {
                setlistModule.parsedSongs = {
                    opening: opening.map(s => s.number ? `${s.number} ${s.name}` : s.name),
                    praise: praise.map(s => s.number ? `${s.number} ${s.name}` : s.name),
                    closing: closing.map(s => s.number ? `${s.number} ${s.name}` : s.name),
                };
                setlistModule.structuredSongs = [...opening, ...praise, ...closing].map(s => ({
                    number: s.number || null,
                    name: s.name,
                }));
                // Format datum als dd-mm-jjjj voor ProPresenter playlist naam
                const svc = data.service || {};
                if (svc.datetime) {
                    const dt = new Date(svc.datetime);
                    if (!isNaN(dt.getTime())) {
                        const pad = n => String(n).padStart(2, '0');
                        setlistModule.serviceDate = `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
                    } else {
                        setlistModule.serviceDate = svc.displayDate || null;
                    }
                } else {
                    setlistModule.serviceDate = svc.displayDate || null;
                }
                setlistModule.renderDateDisplay();
            }
        } catch (err) {
            // Bij een stille live-poll de fout niet op het scherm gooien:
            // de vorige (goede) setlist blijft gewoon staan tot de volgende poll.
            if (!silent) {
                console.warn('[WT-SVC] Setlist ophalen mislukt:', err?.message);
                previewEl.innerHTML = `<div class="wt-svc-error">⚠️ Kon setlist niet ophalen<br><small>${this.escapeHtml(err?.message || '')}</small></div>`;
            }
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    },
};
