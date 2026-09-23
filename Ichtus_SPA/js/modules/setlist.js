/* ============================================
   SETLIST MODULE
   Native ProPresenter Setlist Sync for SPA
   Receives data from WorshipTools Chrome Extension
   ============================================ */

// Helper for timed fetch calls
async function proFetch(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return resp;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Timeout - ProPresenter reageert niet');
        }
        throw err;
    }
}

const setlistModule = {
    initialized: false,

    // --- CONFIGURATION ---
    CONFIG: {
        PRO_IP: "100.113.22.22",
        PRO_PORT: "51253",
        LIBRARY_NAME: "Songs", // Library name to search for
        LOOP_VOOR_UUID: "0c473d4a-6d2f-4c47-bc6b-f2f405de4e52",
        MEDEDELINGEN_UUID: "e111bd8c-b0b2-4caf-ac45-1a6cd3f753e9",
        LOOP_NA_UUID: "6e8e3626-ebcc-4efa-aad1-53253561d08a",
        YOUTH_ANNOUNCEMENT_UUID: "fe887688-747e-442e-a357-8b37865bdf5a"
    },

    // --- DEFAULT TEMPLATES ---
    DEFAULT_TEMPLATES: {
        "zondagDienst": {
            name: "ZondagDienst",
            items: [
                { type: "header", name: "Welcome", color: { red: 0.407, green: 0.572, blue: 0.686, alpha: 1.0 } },
                { type: "presentation", name: "Loop voor de dienst", uuid: "0c473d4a-6d2f-4c47-bc6b-f2f405de4e52" },
                { type: "header", name: "Openingslied", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "opening" },
                { type: "header", name: "Mededelingen", color: { red: 0.368, green: 0.274, blue: 0.043, alpha: 1.0 } },
                { type: "presentation", name: "Mededelingen", uuid: "e111bd8c-b0b2-4caf-ac45-1a6cd3f753e9" },
                { type: "header", name: "Praise & Worship", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "praise" },
                { type: "header", name: "Preek", color: { red: 0.713, green: 0.352, blue: 0.062, alpha: 1.0 } },
                { type: "header", name: "Eindlied", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "closing" },
                { type: "header", name: "Einde-Dienst", color: { red: 0.545, green: 0.0, blue: 0.0, alpha: 1.0 } },
                { type: "presentation", name: "Loop na de dienst", uuid: "6e8e3626-ebcc-4efa-aad1-53253561d08a" }
            ]
        },
        "worshipAvond": {
            name: "Worship Avond",
            items: [
                { type: "header", name: "Welcome", color: { red: 0.407, green: 0.572, blue: 0.686, alpha: 1.0 } },
                { type: "presentation", name: "Loop voor de dienst", uuid: "0c473d4a-6d2f-4c47-bc6b-f2f405de4e52" },
                { type: "header", name: "Worship", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "praise" },
                { type: "header", name: "Einde-Dienst", color: { red: 0.545, green: 0.0, blue: 0.0, alpha: 1.0 } },
                { type: "presentation", name: "Loop na de dienst", uuid: "6e8e3626-ebcc-4efa-aad1-53253561d08a" }
            ]
        },
        "doopDienst": {
            name: "DoopDienst",
            items: [
                { type: "header", name: "Welcome", color: { red: 0.407, green: 0.572, blue: 0.686, alpha: 1.0 } },
                { type: "presentation", name: "Loop voor de dienst", uuid: "0c473d4a-6d2f-4c47-bc6b-f2f405de4e52" },
                { type: "header", name: "Openingslied", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "opening" },
                { type: "header", name: "Mededelingen", color: { red: 0.368, green: 0.274, blue: 0.043, alpha: 1.0 } },
                { type: "presentation", name: "Mededelingen", uuid: "e111bd8c-b0b2-4caf-ac45-1a6cd3f753e9" },
                { type: "header", name: "Praise & Worship", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "praise" },
                { type: "header", name: "Preek", color: { red: 0.713, green: 0.352, blue: 0.062, alpha: 1.0 } },
                { type: "header", name: "Doopliederen", color: { red: 0.588, green: 0.518, blue: 0.137, alpha: 1.0 }, insert: "doop" },
                { type: "header", name: "Eindlied", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "closing" },
                { type: "header", name: "Einde-Dienst", color: { red: 0.545, green: 0.0, blue: 0.0, alpha: 1.0 } },
                { type: "presentation", name: "Loop na de dienst", uuid: "6e8e3626-ebcc-4efa-aad1-53253561d08a" }
            ]
        },
        "avondmaalDienst": {
            name: "AvondmaalDienst",
            items: [
                { type: "header", name: "Welcome", color: { red: 0.40784314274787903, green: 0.572549045085907, blue: 0.686274528503418, alpha: 1.0 } },
                { type: "presentation", name: "Loop voor de dienst", uuid: "0c473d4a-6d2f-4c47-bc6b-f2f405de4e52" },
                { type: "header", name: "Intro", color: { red: 0.09803921729326248, green: 0.48627451062202454, blue: 0.09803921729326248, alpha: 1.0 }, insert: "opening" },
                { type: "header", name: "Announcments", color: { red: 0.3686274588108063, green: 0.27450981736183167, blue: 0.04313725605607033, alpha: 1.0 } },
                { type: "presentation", name: "Mededelingen", uuid: "e111bd8c-b0b2-4caf-ac45-1a6cd3f753e9" },
                { type: "header", name: "Worship", color: { red: 0.09803921729326248, green: 0.48627451062202454, blue: 0.09803921729326248, alpha: 1.0 }, insert: "praise" },
                { type: "header", name: "Avondmaal", color: { red: 1.0, green: 0.843137264251709, blue: 0.0, alpha: 1.0 }, insert: "avondmaal" },
                { type: "header", name: "Preek", color: { red: 0.7137255072593689, green: 0.3529411852359772, blue: 0.062745101749897, alpha: 1.0 } },
                { type: "header", name: "Ending Song", color: { red: 0.09803921729326248, green: 0.48627451062202454, blue: 0.09803921729326248, alpha: 1.0 }, insert: "closing" },
                { type: "header", name: "Service End", color: { red: 0.545098066329956, green: 0.0, blue: 0.0, alpha: 1.0 } },
                { type: "presentation", name: "Loop na de dienst", uuid: "6e8e3626-ebcc-4efa-aad1-53253561d08a" }
            ]
        },
        "delightedYouth": {
            name: "Delighted Youth",
            items: [
                { type: "header", name: "Welcome", color: { red: 0.407, green: 0.572, blue: 0.686, alpha: 1.0 } },
                { type: "presentation", name: "YOUTH Announcement", uuid: "fe887688-747e-442e-a357-8b37865bdf5a", destination: "announcements" },
                { type: "header", name: "Intro", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "opening" },
                { type: "header", name: "Announcements", color: { red: 0.368, green: 0.274, blue: 0.043, alpha: 1.0 } },
                { type: "header", name: "Worship", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "praise" },
                { type: "header", name: "Preek", color: { red: 0.713, green: 0.352, blue: 0.062, alpha: 1.0 } },
                { type: "header", name: "Service End", color: { red: 0.545, green: 0.0, blue: 0.0, alpha: 1.0 }, insert: "closing" },
                { type: "presentation", name: "YOUTH Announcement", uuid: "fe887688-747e-442e-a357-8b37865bdf5a", destination: "announcements" }
            ]
        }
    },

    SERVICE_TEMPLATES: null,
    editingTemplateKey: null,
    receivedSetlist: null,
    parsedSongs: null,
    structuredSongs: null, // [{ number?, name }] from content.js extraction
    fullItems: null,
    serviceDate: null,
    proConnectionStatus: 'unknown', // 'unknown' | 'online' | 'offline'

    init() {
        // One-time setup: templates, event listeners, button bindings
        if (!this.initialized) {
            this.initialized = true;

            // Load templates from file (defaults loaded synchronously as immediate baseline)
            this.SERVICE_TEMPLATES = JSON.parse(JSON.stringify(this.DEFAULT_TEMPLATES));
            this.loadTemplates();

            // Load saved ProPresenter IP — priority:
            // 1. Centrale settings (Settings app) — alleen als expliciet opgeslagen
            // 2. Legacy setlistProIp (Setlist pagina) — voor bestaande gebruikers
            // 3. Hardcoded defaults (CONFIG)
            if (typeof settingsModule !== 'undefined' && settingsModule.settings && settingsModule.settings.proPresenterIp) {
                this.CONFIG.PRO_IP = settingsModule.settings.proPresenterIp;
                if (settingsModule.settings.proPresenterPort) {
                    this.CONFIG.PRO_PORT = settingsModule.settings.proPresenterPort;
                }
            } else {
                const savedProIp = localStorage.getItem('setlistProIp');
                if (savedProIp) {
                    const parts = savedProIp.split(':');
                    this.CONFIG.PRO_IP = parts[0] || this.CONFIG.PRO_IP;
                    this.CONFIG.PRO_PORT = parts[1] || this.CONFIG.PRO_PORT;
                }
            }

            // Render template dropdown
            this.renderTemplateDropdown();

            // Setup extension listener (permanent, only once)
            this.setupExtensionListener();

            // Bind button events (permanent, only once)
            this.bindEvents();

            // Initialize ProPresenter IP display (read-only — source of truth
            // is the Integrations view; we only mirror the value here).
            this.updateProIpDisplay();

            // Auto-test connection on first init (only if not yet tested)
            if (this.proConnectionStatus === 'unknown') {
                this.testProPresenterConnection();
            }

        }


        // Every time we enter the setlist view, signal to the extension bridge
        // that we are ready to receive any cached setlist data.
        console.log('[SPA] Signaling ichtus-setlist-ready to extension bridge');
        document.dispatchEvent(new CustomEvent('ichtus-setlist-ready', {
            bubbles: true,
            composed: true
        }));

        // Check bridge status indicator (data-ichtus-bridge attribute on <html>)
        this.checkBridgeStatus();

        // Watch for the bridge to appear dynamically (e.g. if spa-bridge.js
        // is injected after the page has already loaded).
        if (!this._bridgeObserver) {
            this._bridgeObserver = new MutationObserver(() => this.checkBridgeStatus());
            this._bridgeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-ichtus-bridge']
            });
        }

        // Try to fetch from server API (fallback when extension isn't available)
        this.fetchFromServer();

        // Restore any previously received setlist from localStorage
        const saved = localStorage.getItem('ichtus_received_setlist');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.receivedSetlist = data.raw;
                // Re-parse from the raw text instead of trusting the stored
                // buckets — heals setlists cached before the chord-stripping
                // fix ("Great I Am" had been cut to "Great I").
                this.parsedSongs = data.raw ? this.parseSongs(data.raw) : data.parsed;
                this.structuredSongs = data.structured || null;
                this.fullItems = data.fullItems || null;
                this.serviceDate = data.date || null;
                this.updateConnectionStatus('received');
                this.renderSongPreview();
                this.renderDateDisplay();
            } catch (e) {}
        }
    },

    setupExtensionListener() {
        // Listen for custom event dispatched by spa-bridge.js content script.
        // Content scripts share the DOM but have an isolated JS context,
        // so CustomEvent (which travels through the DOM) is the reliable bridge.
        document.addEventListener('worshiptools-setlist', (e) => {
            const dateStr = e.detail?.date || 'none';
            console.log('[SPA] Received worshiptools-setlist event, length:', e.detail?.setlist?.length, 'date:', dateStr);
            if (e.detail && e.detail.setlist) {
                this.receiveSetlist(e.detail.setlist, e.detail.date, e.detail.structured);
            }
        });

        // Listen for WebSocket broadcasts from the server hub.
        // WsClient dispatches ws:wt:setlist when the server pushes new data.
        document.addEventListener('ws:wt:setlist', (e) => {
            const d = e.detail || {};
            console.log('[SPA] Received ws:wt:setlist, items:', d.structured?.length || d.items?.length || 0, 'date:', d.date);
            if (d.items || d.structured) {
                const rawText = Array.isArray(d.items) ? d.items.join('\n') : (typeof d.items === 'string' ? d.items : null);
                if (rawText) {
                    this.receiveSetlist(rawText, d.date, d.structured);
                }
            }
        });
    },

    /**
     * Fetch setlist data from the server API.
     * Fallback for when the Chrome extension isn't available.
     * Server caches the latest data from the extension.
     */
    async fetchFromServer() {
        try {
            const response = await fetch('/api/worshiptools/setlist');
            const result = await response.json();
            
            if (result.success && result.data) {
                const { items, structured, date } = result.data;
                
                // Only use server data if we don't already have extension data
                if (!this.receivedSetlist && items) {
                    console.log('[SPA] Fetching setlist from server API, items:', items.length, 'date:', date);
                    this.receiveSetlist(items, date, structured);
                }
            }
        } catch (err) {
            // Server might not be running — that's OK, extension will provide data
            console.log('[SPA] Server API niet bereikbaar voor setlist:', err?.message);
        }
    },

    receiveSetlist(rawText, date, structured) {
        console.log('[SPA] receiveSetlist called. Has date?', !!date, 'date:', date, 'structured:', structured?.length || 0);
        // Prevent re-processing identical data (e.g. from cached re-dispatch)
        if (this.receivedSetlist === rawText) {
            console.log('[SPA] Skipping duplicate setlist');
            return;
        }

        this.receivedSetlist = rawText;
        this.structuredSongs = structured || null;
        this.parsedSongs = this.parseSongs(rawText);
        this.fullItems = this.parseFullItems(rawText);
        this.serviceDate = date || null;
        console.log('[SPA] serviceDate set to:', this.serviceDate);

        // Persist first so a partial failed render does not lose data.
        localStorage.setItem('ichtus_received_setlist', JSON.stringify({
            raw: rawText,
            parsed: this.parsedSongs,
            structured: structured,
            fullItems: this.fullItems,
            date: this.serviceDate,
            receivedAt: new Date().toISOString()
        }));

        this.updateConnectionStatus('received');

        // -------- New-vs-library detection --------
        // Load the local song library so each setlist item can be tagged
        // ``NIEUW`` when its number isn't in the library yet.
        // Awaiting DOES NOT block the rest of the render: we render the
        // preview first, then update badges once the library fetch resolves.
        this._loadKnownSongIdsFromLibrary()
            .then(knownIds => {
                // An empty Set means the library loaded but has no songs —
                // treat it the same as null so we don't false-positive NIEUW
                // on every single song.
                this.knownSongIds = knownIds.size > 0 ? knownIds : null;
                const newCount = this._countNewSongs();
                console.log('[SPA] Known song IDs loaded:', knownIds.size, '— new in this setlist:', newCount);
                this.renderSongPreview();
                if (newCount > 0) {
                    const dateMsg = this.serviceDate ? `📅 ${this.serviceDate} — ` : '';
                    const numberedCount = this.structuredSongs
                        ? this.structuredSongs.filter(s => s.number).length : 0;
                    const numberInfo = numberedCount > 0 ? ` (${numberedCount} met nummer)` : '';
                    this.showStatus(
                        `✅ ${dateMsg}${__('setlist_received')}! ${this.countSongs()} ${__('cl_edit_items_count')} — `
                        + `⚠️ ${newCount} NIEUW t.o.v. bibliotheek${numberInfo}.`,
                        'warning'
                    );
                }
            })
            .catch(err => {
                console.warn('[SPA] Could not load library for new-song detection:', err?.message);
                // Library unreachable — fall back to null so renderList
                // skips NIEUW-badge logic entirely (no false positives).
                this.knownSongIds = null;
                this.renderSongPreview();
            });

        this.renderSongPreview();
        this.renderDateDisplay();
        const dateMsg = this.serviceDate ? `📅 ${this.serviceDate} — ` : '';
        const numberedCount = structured ? structured.filter(s => s.number).length : 0;
        const numberInfo = numberedCount > 0 ? ` (${numberedCount} met nummer)` : '';
        this.showStatus(`✅ ${dateMsg}${__('setlist_received')}! ${this.countSongs()} ${__('cl_edit_items_count')} ${__('ndi_sources_found')}${numberInfo}.`, 'success');
    },

    /**
     * Fetch the Ichtus local song library and return a Set of normalized
     * song IDs (prefix+number, with spaces stripped). This is the SAME
     * endpoint that Song ID Assigner uses — so whatever is in the user's
     * library-ids.json is what we consider "known" by definition.
     *
     * Normalization:
     *   - Strip whitespace (WT sends "LvK 9"; library canonical = "LvK9").
     *   - Include both `s.id` (canonical) and `s.prefix + s.number` (raw),
     *     to handle libraries where IDs aren't zero-padded yet.
     *
     * Returns an empty Set (not throws) on any error so the caller's
     * `.then()` can still mark new-songs as "unknown" safely.
     */
    async _loadKnownSongIdsFromLibrary() {
        const norm = s => String(s || '').replace(/\s+/g, '');
        let filePath = null;
        try {
            const cfgResp = await fetch('/api/library/config');
            if (cfgResp.ok) {
                const cfg = await cfgResp.json();
                if (cfg && cfg.success && cfg.libraryPath) {
                    filePath = cfg.libraryPath;
                }
            }
        } catch (e) {
            console.warn('[SPA] /api/library/config unreachable:', e?.message);
        }

        const url = filePath
            ? '/api/library/load?file=' + encodeURIComponent(filePath)
            : '/api/library/load';

        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[SPA] /api/library/load HTTP', resp.status);
            return new Set();
        }
        const json = await resp.json();
        const songs = (json && (json.songs || json.data?.songs)) || [];
        if (!Array.isArray(songs) || songs.length === 0) {
            console.warn('[SPA] Library is empty or has a different shape — no known songs to compare against');
            return new Set();
        }

        const ids = new Set();
        for (const s of songs) {
            if (s && s.id)        ids.add(norm(s.id));
            if (s && s.prefix)    ids.add(norm(s.prefix + s.number));
        }
        return ids;
    },

    /**
     * Count how many structured setlist songs have a number that is NOT
     * in `this.knownSongIds`. Songs WITHOUT a number are counted as new
     * because we can't confirm them against the library. Used for the
     * status banner after the library has loaded.
     */
    _countNewSongs() {
        if (!this.structuredSongs || !this.knownSongIds) return 0;
        const norm = s => String(s || '').replace(/\s+/g, '');
        const lib = this.knownSongIds;
        return this.structuredSongs.filter(s => {
            if (!s.number) return true; // unknown song — counts as "new"
            return !lib.has(norm(s.number));
        }).length;
    },

    renderDateDisplay() {
        const el = document.getElementById('setlist-date-display');
        if (!el) return;
        el.className = 'toggle-item status-alert-box orange-alert';
        if (this.serviceDate) {
            el.textContent = __('setlist_service_date') + this.serviceDate;
        } else {
            el.textContent = __('setlist_no_date');
            el.style.color = '#f47920';
        }
        el.style.display = 'block';
    },

    countSongs() {
        if (!this.parsedSongs) return 0;
        return Object.values(this.parsedSongs).reduce((total, arr) => total + (Array.isArray(arr) ? arr.length : 0), 0);
    },

    updateConnectionStatus(state) {
        const statusEl = document.getElementById('setlist-connection-status');
        const dotEl = document.getElementById('setlist-status-dot');
        const timeEl = document.getElementById('setlist-received-time');
        const previewEl = document.getElementById('setlist-preview');

        if (!statusEl) return;

        if (state === 'waiting') {
            statusEl.textContent = __('setlist_waiting');
            if (dotEl) dotEl.className = 'status-dot warning';
            if (previewEl) previewEl.innerHTML = '<p class="setlist-empty">' + __('setlist_empty_preview') + '</p>';
        } else if (state === 'received') {
            statusEl.textContent = __('setlist_received');
            if (dotEl) dotEl.className = 'status-dot online';
            const saved = localStorage.getItem('ichtus_received_setlist');
            if (saved && timeEl) {
                try {
                    const data = JSON.parse(saved);
                    const time = new Date(data.receivedAt);
                    timeEl.textContent = __('setlist_received_at') + time.toLocaleTimeString(i18n.getLocale());
                } catch (e) {}
            }
        }
    },

    /**
     * Render the template-driven preview showing all headers, presentation cues,
     * and songs assigned to their template slots. Supports drag-and-drop reordering.
     */
    renderSongPreview() {
        const container = document.getElementById('setlist-preview');
        if (!container) return;
        if (!this.parsedSongs) {
            container.innerHTML = '<p class="setlist-empty">' + __('setlist_empty_preview') + '</p>';
            return;
        }

        const selectEl = document.getElementById('setlist-service-type');
        let selectedTemplateKey = selectEl?.value;
        const allTemplates = (this.SERVICE_TEMPLATES && Object.keys(this.SERVICE_TEMPLATES).length > 0)
            ? this.SERVICE_TEMPLATES
            : this.DEFAULT_TEMPLATES;

        if (!selectedTemplateKey || !allTemplates?.[selectedTemplateKey]) {
            selectedTemplateKey = allTemplates ? Object.keys(allTemplates)[0] : 'zondagDienst';
            if (selectEl && selectedTemplateKey) selectEl.value = selectedTemplateKey;
        }

        let template = allTemplates?.[selectedTemplateKey] || this.DEFAULT_TEMPLATES?.zondagDienst;
        if (!template || !Array.isArray(template.items)) {
            template = this.DEFAULT_TEMPLATES?.zondagDienst;
        }

        // Build a lookup from structured data (song name -> number)
        const numberMap = {};
        if (this.structuredSongs) {
            this.structuredSongs.forEach(s => {
                if (s.number && s.name) {
                    numberMap[s.name.toLowerCase()] = s.number;
                }
            });
        }

        const knownIds = this.knownSongIds || null;
        const norm = v => String(v || '').replace(/\s+/g, '');

        /** Render a list of songs, adding drag handles and badges */
        const renderList = (songs, slotKey) => {
            return songs.map((s, idx) => {
                const cleanName = this.stripSongNumberPrefix(s);
                const num = numberMap[cleanName.toLowerCase()] || numberMap[s.toLowerCase()];
                const displayName = num ? cleanName : s;
                const escaped = this.escapeHtml(displayName);

                let isNew = false;
                if (num && knownIds) {
                    isNew = !knownIds.has(norm(num));
                }
                const newBadge = isNew
                    ? '<span class="song-new-badge" title="Niet in je bibliotheek — controleer of je tekst/chords hebt">NIEUW</span> '
                    : '';

                const badge = num ? `<span class="song-number-badge">${this.escapeHtml(num)}</span> ` : '';
                const dragIcon = `<span class="song-drag-handle" title="Sleep om te verplaatsen">⠿</span>`;
                return `<li class="song-preview-item" data-index="${idx}" data-song="${this.escapeHtml(s)}">${dragIcon}${badge}${newBadge}<span>${escaped}</span></li>`;
            }).join('');
        };

        // Auto-merge into single slot if template defines only one slot (e.g. Worship Avond)
        const availableSlots = template.items.filter(i => i.insert).map(i => i.insert);
        if (availableSlots.length === 1) {
            const singleSlot = availableSlots[0];
            for (const [slot, songs] of Object.entries(this.parsedSongs)) {
                if (slot !== singleSlot && Array.isArray(songs) && songs.length > 0) {
                    if (!this.parsedSongs[singleSlot]) this.parsedSongs[singleSlot] = [];
                    this.parsedSongs[singleSlot].push(...songs);
                    this.parsedSongs[slot] = [];
                }
            }
        }

        // Group items into header sections so presentations are contained in their header's box
        const sections = [];
        let currentSection = null;

        template.items.forEach(tplItem => {
            if (tplItem.type === 'header') {
                currentSection = {
                    header: tplItem,
                    presentations: [],
                    insert: tplItem.insert || null
                };
                sections.push(currentSection);
            } else if (tplItem.type === 'presentation') {
                if (!currentSection) {
                    currentSection = {
                        header: { name: 'Intro', color: { red: 0.407, green: 0.572, blue: 0.686, alpha: 1.0 } },
                        presentations: [],
                        insert: null
                    };
                    sections.push(currentSection);
                }
                currentSection.presentations.push(tplItem);
            }
        });

        let html = '';
        const renderedSlots = new Set();

        sections.forEach(sec => {
            const hex = this.rgbToHex(sec.header.color);
            const songs = sec.insert ? (this.parsedSongs[sec.insert] || []) : [];
            if (sec.insert) {
                renderedSlots.add(sec.insert);
            }
            const totalCount = sec.presentations.length + songs.length;

            html += `
            <div class="song-bucket template-header-bucket" ${sec.insert ? `data-insert="${this.escapeHtml(sec.insert)}"` : ''}>
                <div class="bucket-header" style="border-left-color: ${hex};">
                    <span class="bucket-color-dot" style="background-color: ${hex};"></span>
                    <h4 class="bucket-title" style="color: ${hex};">${this.escapeHtml(sec.header.name)}</h4>
                    <span class="bucket-count-badge" style="background-color: ${hex}20; color: ${hex}; border: 1px solid ${hex}40;">${totalCount}</span>
                </div>
                <div class="bucket-body">`;

            // Presentations belonging to this header
            if (sec.presentations.length > 0) {
                sec.presentations.forEach(pres => {
                    html += `
                    <div class="template-presentation-item">
                        <span class="presentation-icon">🎬</span>
                        <span class="presentation-name">${this.escapeHtml(pres.name)}</span>
                        <span class="presentation-dest-badge">${this.escapeHtml(pres.destination || 'presentation')}</span>
                    </div>`;
                });
            }

            // Songs belonging to this header (if slot is defined)
            if (sec.insert) {
                html += `
                    <ul class="song-link-list ${songs.length === 0 ? 'empty-list' : ''}" data-insert="${this.escapeHtml(sec.insert)}">
                        ${songs.length > 0 ? renderList(songs, sec.insert) : '<li class="slot-empty-notice">(Geen liederen toegewezen)</li>'}
                    </ul>`;
            } else if (sec.presentations.length === 0) {
                html += `<div class="slot-empty-notice">(Geen items)</div>`;
            }

            html += `
                </div>
            </div>`;
        });

        // Check for any unassigned songs not covered by the template's slots
        const unassignedSlots = [];
        for (const [slotKey, songs] of Object.entries(this.parsedSongs)) {
            if (!renderedSlots.has(slotKey) && Array.isArray(songs) && songs.length > 0) {
                unassignedSlots.push({ slot: slotKey, songs });
            }
        }

        if (unassignedSlots.length > 0) {
            unassignedSlots.forEach(u => {
                html += `
                <div class="song-bucket template-header-bucket" data-insert="${this.escapeHtml(u.slot)}">
                    <div class="bucket-header" style="border-left-color: #f47920;">
                        <span class="bucket-color-dot" style="background-color: #f47920;"></span>
                        <h4 class="bucket-title" style="color: #f47920;">Overige liederen (${this.escapeHtml(u.slot)})</h4>
                        <span class="bucket-count-badge" style="background-color: rgba(244,121,32,0.2); color: #f47920; border: 1px solid rgba(244,121,32,0.4);">${u.songs.length}</span>
                    </div>
                    <ul class="song-link-list" data-insert="${this.escapeHtml(u.slot)}">
                        ${renderList(u.songs, u.slot)}
                    </ul>
                </div>`;
            });
        }

        container.innerHTML = html;

        // Bind SortableJS for drag-and-drop between headers
        if (typeof Sortable !== 'undefined') {
            if (this.previewSortables) {
                this.previewSortables.forEach(s => {
                    try { s.destroy(); } catch (_) {}
                });
            }
            this.previewSortables = [];

            const lists = container.querySelectorAll('.song-link-list');
            lists.forEach(listEl => {
                const s = Sortable.create(listEl, {
                    group: 'setlist-preview-songs',
                    animation: 150,
                    handle: '.song-drag-handle',
                    draggable: '.song-preview-item',
                    filter: '.slot-empty-notice',
                    ghostClass: 'sortable-ghost',
                    onEnd: (evt) => {
                        const fromSlot = evt.from.dataset.insert;
                        const toSlot = evt.to.dataset.insert;
                        if (!fromSlot || !toSlot) return;

                        if (fromSlot === toSlot) {
                            const arr = this.parsedSongs[fromSlot];
                            if (arr) {
                                const [item] = arr.splice(evt.oldIndex, 1);
                                arr.splice(evt.newIndex, 0, item);
                            }
                        } else {
                            const srcArr = this.parsedSongs[fromSlot] || [];
                            const tgtArr = this.parsedSongs[toSlot] || (this.parsedSongs[toSlot] = []);
                            const [item] = srcArr.splice(evt.oldIndex, 1);
                            if (item) {
                                tgtArr.splice(evt.newIndex, 0, item);
                            }
                        }

                        // Re-render to refresh counts and empty placeholders
                        this.renderSongPreview();
                    }
                });
                this.previewSortables.push(s);
            });
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Remove a leading song-number prefix (e.g. "D044 ", "O586 ") from a raw
     * setlist line, leaving the clean song name ("Great I Am"). Used wherever
     * a parsed line (which keeps its number) is matched against structured
     * names (which don't) — one place to keep the pattern consistent.
     */
    stripSongNumberPrefix(name) {
        return String(name || '').replace(/^[A-Z]{1,3}\s*\d{1,4}[A-Za-z]?\s+/, '').trim();
    },

    renderTemplateDropdown() {
        const select = document.getElementById('setlist-service-type');
        if (!this.SERVICE_TEMPLATES) return;

        const currentValue = select ? select.value : '';
        const validKey = this.SERVICE_TEMPLATES[currentValue] ? currentValue : Object.keys(this.SERVICE_TEMPLATES)[0];

        if (select) {
            select.innerHTML = '';
            for (const [key, tpl] of Object.entries(this.SERVICE_TEMPLATES)) {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = tpl.name;
                select.appendChild(opt);
            }
            if (validKey) select.value = validKey;
        }

        // Render custom Stage Builder-style dropdown menu
        const menu = document.getElementById('setlist-tpl-menu');
        const triggerText = document.getElementById('setlist-tpl-trigger-text');

        if (triggerText && validKey && this.SERVICE_TEMPLATES[validKey]) {
            triggerText.textContent = this.SERVICE_TEMPLATES[validKey].name;
            triggerText.title = this.SERVICE_TEMPLATES[validKey].name;
        }

        if (menu) {
            let html = '<div class="setlist-template-menu-header">Templates</div>';
            for (const [key, tpl] of Object.entries(this.SERVICE_TEMPLATES)) {
                const isSelected = key === validKey;
                html += `
                <div class="setlist-template-item ${isSelected ? 'selected' : ''}" data-tpl-key="${this.escapeHtml(key)}" onclick="setlistModule.selectTemplate('${this.escapeHtml(key)}')">
                    <span class="setlist-template-item-name">${this.escapeHtml(tpl.name)}</span>
                    <span class="setlist-template-item-check" aria-hidden="true">✓</span>
                </div>`;
            }
            menu.innerHTML = html;
        }
    },

    toggleTemplateDropdown(event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        const wrap = document.getElementById('setlist-tpl-dropdown-wrap');
        const trigger = document.getElementById('setlist-tpl-trigger');
        if (!wrap) return;
        const isOpen = wrap.classList.toggle('open');
        if (trigger) trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    },

    closeTemplateDropdown() {
        const wrap = document.getElementById('setlist-tpl-dropdown-wrap');
        const trigger = document.getElementById('setlist-tpl-trigger');
        if (wrap && wrap.classList.contains('open')) {
            wrap.classList.remove('open');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
    },

    selectTemplate(key) {
        if (!this.SERVICE_TEMPLATES || !this.SERVICE_TEMPLATES[key]) return;
        const select = document.getElementById('setlist-service-type');
        if (select) {
            select.value = key;
        }

        const triggerText = document.getElementById('setlist-tpl-trigger-text');
        if (triggerText) {
            triggerText.textContent = this.SERVICE_TEMPLATES[key].name;
            triggerText.title = this.SERVICE_TEMPLATES[key].name;
        }

        const items = document.querySelectorAll('#setlist-tpl-menu .setlist-template-item');
        items.forEach(el => {
            el.classList.toggle('selected', el.getAttribute('data-tpl-key') === key);
        });

        this.closeTemplateDropdown();

        // Re-parse and re-render preview
        if (this.receivedSetlist) {
            this.parsedSongs = this.parseSongs(this.receivedSetlist);
        }
        this.renderSongPreview();
    },

    async loadTemplates() {
        try {
            // First attempt to load from server API (persisted to Ichtus_SPA/data/setlist-templates.json)
            const res = await fetch('/api/setlist/templates');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.templates && Object.keys(data.templates).length > 0) {
                    // Check if there was an unmigrated localStorage version with custom templates
                    const localSaved = localStorage.getItem('setlistTemplates');
                    if (localSaved && !localStorage.getItem('setlistTemplatesMigrated')) {
                        try {
                            const parsedLocal = JSON.parse(localSaved);
                            if (parsedLocal && Object.keys(parsedLocal).length > 0) {
                                await this.saveTemplates(parsedLocal);
                                this.SERVICE_TEMPLATES = parsedLocal;
                                localStorage.setItem('setlistTemplatesMigrated', 'true');
                                this.renderTemplateDropdown();
                                this.renderSongPreview();
                                return;
                            }
                        } catch (_) {}
                    }

                    this.SERVICE_TEMPLATES = data.templates;
                    this.renderTemplateDropdown();
                    this.renderSongPreview();
                    return;
                }
            }
        } catch (err) {
            console.warn('[Setlist] Server template API failed, trying static fallback:', err.message);
        }

        // Fallback: static JSON file in data/
        try {
            const res = await fetch('data/setlist-templates.json');
            if (res.ok) {
                const templates = await res.json();
                if (templates && Object.keys(templates).length > 0) {
                    this.SERVICE_TEMPLATES = templates;
                    this.renderTemplateDropdown();
                    this.renderSongPreview();
                    return;
                }
            }
        } catch (_) {}

        // Fallback to defaults
        this.SERVICE_TEMPLATES = JSON.parse(JSON.stringify(this.DEFAULT_TEMPLATES));
        this.renderTemplateDropdown();
        this.renderSongPreview();
    },

    async saveTemplates(templatesToSave = null) {
        const templates = templatesToSave || this.SERVICE_TEMPLATES;
        try {
            const res = await fetch('/api/setlist/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(templates)
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            console.log('[Setlist] Templates saved to file successfully');
            return true;
        } catch (err) {
            console.error('[Setlist] Failed to save templates to file:', err.message);
            // Fallback: save to localStorage so changes are not lost if server is unreachable
            localStorage.setItem('setlistTemplates', JSON.stringify(templates));
            this.showStatus('Server offline: lokaal opgeslagen', 'warning');
            return false;
        }
    },

    exportTemplatesToFile() {
        try {
            const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.SERVICE_TEMPLATES, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute('href', dataStr);
            downloadAnchor.setAttribute('download', 'setlist-templates.json');
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            this.showStatus('Templates geëxporteerd!', 'success');
        } catch (e) {
            alert('Fout bij exporteren: ' + e.message);
        }
    },

    importTemplatesFromFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (typeof imported !== 'object' || Array.isArray(imported)) {
                    throw new Error('Ongeldig bestandsformaat');
                }
                this.SERVICE_TEMPLATES = imported;
                await this.saveTemplates();
                this.renderTemplateDropdown();
                if (this.editingTemplateKey && this.SERVICE_TEMPLATES[this.editingTemplateKey]) {
                    this.openTemplateEditor();
                } else {
                    this.closeTemplateModal();
                }
                this.showStatus('Templates geïmporteerd en opgeslagen!', 'success');
            } catch (err) {
                alert('Kon bestand niet importeren: ' + err.message);
            }
        };
        reader.readAsText(file);
    },

    bindEvents() {
        document.getElementById('btn-setlist-sync')?.addEventListener('click', () => this.handleSync());
        document.getElementById('btn-setlist-clear')?.addEventListener('click', () => this.clearSetlist());
        document.getElementById('btn-open-worshiptools')?.addEventListener('click', () => {
            window.open('https://planning.worshiptools.com/app', '_blank');
        });
        document.getElementById('setlist-service-type')?.addEventListener('change', () => {
            console.log('[SPA] Service template changed in dropdown');
            if (this.receivedSetlist) {
                this.parsedSongs = this.parseSongs(this.receivedSetlist);
            }
            this.renderSongPreview();
        });
        document.getElementById('btn-setlist-template-edit')?.addEventListener('click', () => this.openTemplateEditor());
        document.getElementById('btn-setlist-template-new')?.addEventListener('click', () => this.showNewTemplateModal());

        // Close template dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const wrap = document.getElementById('setlist-tpl-dropdown-wrap');
            if (wrap && !wrap.contains(e.target)) {
                this.closeTemplateDropdown();
            }
        });

        // Modal events
        document.getElementById('btn-close-setlist-modal')?.addEventListener('click', () => this.closeTemplateModal());
        document.getElementById('btn-add-tpl-item')?.addEventListener('click', () => this.addTemplateItem());
        document.getElementById('btn-save-tpl')?.addEventListener('click', () => this.saveTemplateEdit());
        document.getElementById('btn-reset-tpl')?.addEventListener('click', () => this.resetTemplateToDefault());
        document.getElementById('btn-del-tpl')?.addEventListener('click', () => this.deleteCurrentTemplate());
        document.getElementById('btn-close-new-tpl-modal')?.addEventListener('click', () => this.closeNewTemplateModal());
        document.getElementById('btn-confirm-new-tpl')?.addEventListener('click', () => this.confirmNewTemplate());

        const newNameInput = document.getElementById('new-tpl-name-input');
        if (newNameInput) {
            newNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.confirmNewTemplate();
            });
        }

        // Realtime template sync via WebSocket hub
        document.addEventListener('ws:setlist:templates', (e) => {
            if (e.detail?.templates) {
                console.log('[SPA] Realtime setlist templates update received');
                this.SERVICE_TEMPLATES = e.detail.templates;
                this.renderTemplateDropdown();
                const modal = document.getElementById('setlist-template-modal');
                if (modal && !modal.classList.contains('hidden') && this.editingTemplateKey) {
                    if (this.SERVICE_TEMPLATES[this.editingTemplateKey]) {
                        this.openTemplateEditor();
                    } else {
                        this.closeTemplateModal();
                    }
                }
            }
        });

        // Template file export / import
        document.getElementById('btn-export-tpl')?.addEventListener('click', () => this.exportTemplatesToFile());
        document.getElementById('btn-import-tpl')?.addEventListener('click', () => {
            document.getElementById('input-import-tpl')?.click();
        });
        document.getElementById('input-import-tpl')?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.importTemplatesFromFile(e.target.files[0]);
                e.target.value = '';
            }
        });
    },

    /**
     * Check whether the spa-bridge content script is present and active.
     * The bridge sets data-ichtus-bridge on <html> when it is injected.
     *   - 'loaded'  = bridge is in the page, waiting for data
     *   - 'active'  = bridge has dispatched at least one payload
     *   - (absent)  = bridge not running (ext not installed / file:// access denied)
     *
     * This method updates the #bridge-status-dot and #bridge-status-text
     * elements in the WorshipTools card.
     */
    checkBridgeStatus() {
        const dot = document.getElementById('bridge-status-dot');
        const text = document.getElementById('bridge-status-text');
        if (!dot || !text) return;

        const status = document.documentElement.dataset.ichtusBridge;

        if (status === 'active' || status === 'loaded') {
            dot.className = 'status-dot online';
            text.textContent = status === 'active'
                ? 'Extensie actief ✓'
                : 'Extensie geladen — wacht op data...';
        } else {
            dot.className = 'status-dot offline';
            text.textContent = 'Extensie niet gevonden — zet "Toegang tot bestands-URL" aan in chrome://extensions';
        }
    },

    clearSetlist() {
        this.receivedSetlist = null;
        this.parsedSongs = null;
        this.structuredSongs = null;
        this.serviceDate = null;
        localStorage.removeItem('ichtus_received_setlist');
        this.updateConnectionStatus('waiting');
        this.showStatus(__('setlist_cleared'), '');
        this.renderDateDisplay();
    },

    updateProIpDisplay() {
        // Mirrors the IP/port coming from settingsModule (the Integrations
        // view is the single source of truth). The display is read-only.
        const ip = this._getProIp();
        const port = this._getProPort();
        const valueEl = document.getElementById('pro-ip-display-value');
        if (valueEl) {
            valueEl.textContent = (ip && port) ? `${ip}:${port}` : '— niet ingesteld';
        }
    },

    // Pull the current ProPresenter IP from settingsModule (fresh on every
    // call so changes in the Integrations view are picked up immediately).
    _getProIp() {
        if (typeof settingsModule !== 'undefined' && settingsModule.getSetting) {
            return settingsModule.getSetting('proPresenterIp') || '';
        }
        return this.CONFIG.PRO_IP || '';
    },

    _getProPort() {
        if (typeof settingsModule !== 'undefined' && settingsModule.getSetting) {
            return settingsModule.getSetting('proPresenterPort') || '';
        }
        return this.CONFIG.PRO_PORT || '';
    },

    _getProBaseUrl() {
        const ip = this._getProIp();
        const port = this._getProPort();
        if (!ip || !port) return '';
        return `http://${ip}:${port}/v1`;
    },

    _getProAuthHeaders() {
        if (typeof settingsModule === 'undefined' || !settingsModule.getSetting) return {};
        const pw = settingsModule.getSetting('proPresenterPassword');
        if (!pw) return {};
        // ProPresenter REST API uses HTTP Basic with user "API".
        const basic = (typeof btoa === 'function')
            ? btoa('API:' + pw)
            : (typeof Buffer !== 'undefined' ? Buffer.from('API:' + pw).toString('base64') : '');
        return basic ? { 'Authorization': 'Basic ' + basic } : {};
    },

    async testProPresenterConnection() {
        const statusDot = document.getElementById('pro-status-dot');
        const statusText = document.getElementById('pro-connection-status');
        const testBtn = document.getElementById('btn-test-proconnection');
        const gotoBtn = () => document.getElementById('pro-goto-integration-btn');

        // Always pull IP/port from the integration settings (single source
        // of truth); never let stale CONFIG values win.
        const ip = this._getProIp();
        const port = this._getProPort();
        const baseUrl = this._getProBaseUrl();

        if (statusDot) statusDot.className = 'status-dot warning';
        if (statusText) statusText.textContent = __('setlist_testing');
        if (testBtn) testBtn.disabled = true;
        if (gotoBtn()) gotoBtn().style.display = 'none';

        if (!baseUrl) {
            if (statusDot) statusDot.className = 'status-dot offline';
            if (statusText) statusText.textContent = 'Geen IP ingesteld — vul in via Integraties';
            if (testBtn) testBtn.disabled = false;
            if (gotoBtn()) gotoBtn().style.display = 'block';
            return;
        }

        try {
            // Try fetching the looks endpoint - this is a reliable endpoint that exists in all ProPresenter versions
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(`${baseUrl}/looks`, {
                method: 'GET',
                headers: this._getProAuthHeaders(),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                this.proConnectionStatus = 'online';
                if (statusDot) statusDot.className = 'status-dot online';
                if (statusText) statusText.textContent = __('setlist_connected');
                if (gotoBtn()) gotoBtn().style.display = 'none';
                this.showStatus(`✅ ProPresenter API is bereikbaar op ${ip}:${port}`, 'success');
                this.updateProIpDisplay(); // keep read-only pill in sync
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (err) {
            this.proConnectionStatus = 'offline';
            if (statusDot) statusDot.className = 'status-dot offline';
            
            let errorMsg = 'ProPresenter niet bereikbaar';
            if (err.name === 'AbortError') {
                errorMsg = 'Timeout - ProPresenter reageert niet';
            } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                errorMsg = 'Geen netwerkverbinding met ProPresenter';
            } else {
                errorMsg = `Fout: ${err.message}`;
            }
            
            if (statusText) statusText.textContent = errorMsg;
            if (gotoBtn()) gotoBtn().style.display = 'block';
            this.showStatus(`❌ ${errorMsg}. Controleer IP-adres en of ProPresenter draait.`, 'error');
        } finally {
            if (testBtn) {
                testBtn.disabled = false;
                testBtn.textContent = __('setlist_test_connection');
            }
        }
    },

    parseFullItems(rawText) {
        const items = [];
        let currentSection = 'opening';
        const lines = rawText.split('\n');

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Detect section breaks from WorshipTools markers
            if (line.includes("D000 - Opening dienst en offergave")) {
                currentSection = 'praise';
                items.push({ name: 'Openingsliederen', type: 'section', section: currentSection });
                continue;
            } else if (line.includes("D000 - Preek")) {
                currentSection = 'closing';
                items.push({ name: 'Eindliederen', type: 'section', section: currentSection });
                continue;
            }

            // "D000 - Setlist eind" — end-of-service placeholder. Not an item
            // itself, and everything after it is not part of the service.
            if (/setlist\s*eind/i.test(line)) {
                break;
            }

            // Skip noisy items
            const ignore = ["preek", "opening", "offergave", "repetities", "kerkdiensten", "worship tools", "avondmaal", "reserve"];
            if (ignore.some(word => line.toLowerCase().includes(word))) continue;

            let cleaned = line.replace(/^\d{1,2}:\d{2}\s*(?:\|\s*)?/, '').trim();
            // Strip only a trailing SINGLE-letter key (e.g. " D", " F#") — a
            // legacy fallback for payloads that still carry the key inline.
            // Multi-letter chords (Am, Dm, C#m, maj, sus, ...) are NEVER
            // stripped: they collide with real words like "Am" in "Great I Am".
            // The key badge is already excluded at extraction (content.js).
            cleaned = cleaned.replace(/\s+[A-G][b#]?\s*$/, '').trim();

            if (cleaned) {
                items.push({ name: cleaned, type: 'item', section: currentSection });
            }
        }

        return items;
    },

    parseSongs(rawText) {
        let opening = [], praise = [], closing = [], doop = [], avondmaal = [];
        let currentBucket = opening;
        const seen = new Set();
        const ignore = ["preek", "opening", "offergave", "repetities", "kerkdiensten", "worship tools", "reserve"];

        // If template has no opening slot (e.g. Worship Avond), start in praise
        const selectedKey = document.getElementById('setlist-service-type')?.value;
        const currentTpl = (this.SERVICE_TEMPLATES && this.SERVICE_TEMPLATES[selectedKey]) || (this.DEFAULT_TEMPLATES && this.DEFAULT_TEMPLATES[selectedKey]);
        const hasOpening = currentTpl ? currentTpl.items.some(i => i.insert === 'opening') : true;
        if (!hasOpening) {
            currentBucket = praise;
        }

        const lines = rawText.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Detect section markers
            if (line.includes("D000 - Opening dienst en offergave") || /opening\s*dienst/i.test(line)) {
                currentBucket = praise;
                continue;
            } else if (line.includes("D000 - Preek") || /^D\d{3}\s*-\s*preek/i.test(line)) {
                currentBucket = closing;
                continue;
            } else if (/doop/i.test(line) && /^D\d{3}/i.test(line)) {
                currentBucket = doop;
                continue;
            } else if (/avondmaal/i.test(line) && /^D\d{3}/i.test(line)) {
                currentBucket = avondmaal;
                continue;
            }

            // "D000 - Setlist eind" — end-of-service placeholder
            if (/setlist\s*eind/i.test(line)) {
                break;
            }

            if (ignore.some(word => line.toLowerCase() === word || line.toLowerCase().startsWith(word + ' '))) continue;

            let cleaned = line.replace(/^\d{1,2}:\d{2}\s*(?:\|\s*)?/, '').trim();
            cleaned = cleaned.replace(/\s+[A-G][b#]?\s*$/, '').trim();

            if (cleaned && !seen.has(cleaned)) {
                currentBucket.push(cleaned);
                seen.add(cleaned);
            }
        }
        return { opening, praise, closing, doop, avondmaal };
    },

    createItem(name, uuid, isHeader = false, color = null, destination = "presentation") {
        const struct = {
            "id": { "uuid": uuid || "", "name": name, "index": 0 },
            "type": isHeader ? "header" : "presentation",
            "is_hidden": false,
            "is_pco": false,
            "target_uuid": uuid || "",
            "destination": destination
        };
        if (isHeader && color) {
            struct["header_color"] = color;
        }
        return struct;
    },

    /**
     * Show conflict modal and return a Promise resolving to
     * 'skip' | 'new' | 'override'.
     */
    _showConflictModal(existingName) {
        return new Promise(resolve => {
            const modal = document.getElementById('sync-conflict-modal');
            const msgEl = document.getElementById('sync-conflict-msg');
            if (!modal || !msgEl) { resolve('skip'); return; }

            msgEl.textContent = `Er bestaat al een playlist "${existingName}" in ProPresenter. Wat wil je doen?`;
            modal.classList.remove('hidden');

            const cleanup = () => {
                modal.classList.add('hidden');
                modal.removeEventListener('click', onBackdrop);
                document.getElementById('sync-btn-skip')?.removeEventListener('click', onSkip);
                document.getElementById('sync-btn-new')?.removeEventListener('click', onNew);
                document.getElementById('sync-btn-override')?.removeEventListener('click', onOverride);
            };
            const onSkip    = () => { cleanup(); resolve('skip'); };
            const onNew     = () => { cleanup(); resolve('new'); };
            const onOverride = () => { cleanup(); resolve('override'); };
            // Click on backdrop (outside dialog) = skip
            const onBackdrop = (e) => { if (e.target === modal) onSkip(); };

            document.getElementById('sync-btn-skip')?.addEventListener('click', onSkip);
            document.getElementById('sync-btn-new')?.addEventListener('click', onNew);
            document.getElementById('sync-btn-override')?.addEventListener('click', onOverride);
            modal.addEventListener('click', onBackdrop);
        });
    },

    /**
     * Build sync items from parsedSongs + libraryMap.
     * Returns { items, matchedSongs, unmatchedSongs }.
     */
    _buildSyncItems(libraryMap) {
        const selectedTemplateKey = document.getElementById('setlist-service-type').value;
        const template = (this.SERVICE_TEMPLATES && this.SERVICE_TEMPLATES[selectedTemplateKey])
            || (this.DEFAULT_TEMPLATES && this.DEFAULT_TEMPLATES[selectedTemplateKey]);

        let items = [];
        let matchedSongs = 0;
        let unmatchedSongs = [];

        template.items.forEach(tplItem => {
            items.push(this.createItem(tplItem.name, tplItem.uuid || "", tplItem.type === "header", tplItem.color, tplItem.destination || "presentation"));
            if (tplItem.insert) {
                let listToInsert = (this.parsedSongs && this.parsedSongs[tplItem.insert]) || [];
                listToInsert.forEach(s => {
                    const processedName = s.toLowerCase();
                    let uuid = libraryMap[processedName];

                    if (!uuid && this.structuredSongs) {
                        const structured = this.structuredSongs.find(st => st.name && st.name.toLowerCase() === this.stripSongNumberPrefix(s).toLowerCase());
                        if (structured && structured.number) {
                            uuid = libraryMap[structured.number.toLowerCase()];
                            if (uuid) console.log('[Sync] Matched by number:', structured.number, '→', s);
                        }
                    }

                    if (!uuid) {
                        const nameWithoutNumber = this.stripSongNumberPrefix(s);
                        if (nameWithoutNumber && nameWithoutNumber !== s) {
                            uuid = libraryMap[nameWithoutNumber.toLowerCase()];
                            if (uuid) console.log('[Sync] Matched by clean name:', nameWithoutNumber, '←', s);
                        }
                    }

                    if (uuid) {
                        items.push(this.createItem(s, uuid));
                        matchedSongs++;
                    } else {
                        unmatchedSongs.push(s);
                    }
                });
            }
        });

        console.log('[Sync] Matched songs:', matchedSongs, 'Unmatched:', unmatchedSongs);
        if (matchedSongs === 0 && unmatchedSongs.length > 0) {
            console.warn('[Sync] No songs matched! Unmatched:', unmatchedSongs);
            console.warn('[Sync] Available library items (first 10):', Object.keys(libraryMap).slice(0, 10));
        }
        return { items, matchedSongs, unmatchedSongs };
    },

    async handleSync() {
        if (!this.parsedSongs || this.countSongs() === 0) {
            const hasDataInStorage = !!localStorage.getItem('ichtus_received_setlist');
            if (hasDataInStorage) {
                try {
                    const saved = JSON.parse(localStorage.getItem('ichtus_received_setlist'));
                    if (saved && saved.raw) {
                        this.receivedSetlist = saved.raw;
                        this.parsedSongs = saved.raw ? this.parseSongs(saved.raw) : saved.parsed;
                        this.fullItems = saved.fullItems || null;
                        this.serviceDate = saved.date || null;
                        this.updateConnectionStatus('received');
                        this.renderSongPreview();
                        this.renderDateDisplay();
                        if (this.parsedSongs && this.countSongs() > 0) {
                            console.log('[Sync] Restored setlist from localStorage — retrying sync in next tick');
                            setTimeout(() => this.handleSync(), 0);
                            return;
                        }
                    }
                } catch (_) {}
            }

            const locale = (typeof i18n !== 'undefined' && i18n.lang === 'nl') ? 'nl' : 'en';
            const tip = locale === 'nl'
                ? 'Tip: Zorg dat de Chrome-extensie \"WorshipTools to Ichtus SPA Sync\" is geïnstalleerd. Open chrome://extensions, zoek de extensie en zet \"Toegang tot bestands-URL\" aan. Ververs daarna deze pagina en probeer opnieuw.'
                : 'Tip: Make sure the \"WorshipTools to Ichtus SPA Sync\" Chrome extension is installed. Open chrome://extensions, find the extension and enable \"Allow access to file URLs\". Then refresh this page and try again.';
            this.showStatus(__('setlist_waiting') + ' ' + __('setlist_extract_help') + "\n\n" + tip, "error");
            return;
        }

        console.log('[Sync] Starting sync...');
        this.showStatus(__('setlist_syncing'), '');

        try {
            const PROXY_BASE = `${window.location.origin}/api/pro`;
            const BASE_URL = PROXY_BASE;

            // Step 1: Get library
            const libsResp = await proFetch(`${BASE_URL}/libraries`, { method: 'GET' });
            if (!libsResp.ok) throw new Error(`Libraries list fetch failed: HTTP ${libsResp.status}`);
            const libsData = await libsResp.json();
            if (!Array.isArray(libsData)) throw new Error('Libraries response is not an array');

            const targetLib = libsData.find(lib => lib.name === this.CONFIG.LIBRARY_NAME);
            if (!targetLib) throw new Error(`Library "${this.CONFIG.LIBRARY_NAME}" not found. Available: ${libsData.map(l => l.name).join(', ')}`);

            // Step 2: Fetch library contents
            const libResp = await proFetch(`${BASE_URL}/library/${targetLib.uuid}`, { method: 'GET' });
            if (!libResp.ok) throw new Error(`Library contents fetch failed: HTTP ${libResp.status}`);
            const libData = await libResp.json();

            const libraryMap = {};
            libData.items.forEach(item => {
                libraryMap[item.name.toLowerCase().trim()] = item.uuid;
            });

            // Step 3: Build setlist items
            const { items, matchedSongs, unmatchedSongs } = this._buildSyncItems(libraryMap);

            // Step 4: Determine playlist name & check all existing playlists
            const playlistName = this.serviceDate || ("Web Sync: " + new Date().toLocaleTimeString(i18n.getLocale()));

            let existingPlaylistUuid = null;
            let allPlaylists = [];
            try {
                const plsResp = await proFetch(`${BASE_URL}/playlists`, { method: 'GET' });
                console.log('[Sync] Playlist list status:', plsResp.status);
                if (plsResp.ok) {
                    const raw = await plsResp.json();
                    console.log('[Sync] Playlist list raw:', JSON.stringify(raw).substring(0, 500));
                    const tree = Array.isArray(raw) ? raw : (raw?.playlists || []);
                    // Flatten nested tree: groups → children → playlists
                    const flatten = (nodes) => {
                        const result = [];
                        for (const n of nodes) {
                            if (n.field_type === 'playlist') result.push(n);
                            if (n.children) result.push(...flatten(n.children));
                        }
                        return result;
                    };
                    allPlaylists = flatten(tree);
                    console.log('[Sync] Parsed playlists count:', allPlaylists.length, 'names:', allPlaylists.map(p => p.id?.name));
                    console.log('[Sync] Looking for:', playlistName);
                    const match = allPlaylists.find(p => p.id?.name === playlistName);
                    if (match) {
                        existingPlaylistUuid = match.id?.uuid;
                        console.log('[Sync] Existing playlist found:', match.id?.name, match.id?.uuid);
                    } else {
                        console.log('[Sync] No matching playlist found');
                    }
                }
            } catch (e) { console.log('[Sync] Playlist fetch error:', e.message); }

            let targetPlaylistUuid;

            if (existingPlaylistUuid) {
                // Playlist bestaat → vraag gebruiker
                const choice = await this._showConflictModal(playlistName);
                console.log('[Sync] Conflict choice:', choice);

                if (choice === 'skip') {
                    this.showStatus('⏭ Sync overgeslagen.', '');
                    return;
                }

                if (choice === 'new') {
                    // Zoek unieke naam met suffix
                    let suffix = 2;
                    let newName = `${playlistName} (${suffix})`;
                    while (allPlaylists.some(p => p.id?.name === newName)) {
                        suffix++;
                        newName = `${playlistName} (${suffix})`;
                    }
                    const createResp = await proFetch(`${BASE_URL}/playlists`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newName })
                    }, 15000);
                    if (!createResp.ok) throw new Error(`Playlist creation failed: HTTP ${createResp.status}`);
                    const newPl = await createResp.json();
                    targetPlaylistUuid = newPl.uuid || newPl.id?.uuid;
                }

                if (choice === 'override') {
                    // Update de BESTAANDE playlist in-place (geen nieuwe aanmaken).
                    // Eerst items tussen Preek en Eindlied bewaren (handmatig toegevoegd),
                    // dan die terug invoegen en de hele playlist vervangen via PUT.
                    targetPlaylistUuid = existingPlaylistUuid;
                    let preservedManualItems = [];
                    try {
                        const existResp = await proFetch(`${BASE_URL}/playlist/${existingPlaylistUuid}`, { method: 'GET' });
                        if (existResp.ok) {
                            const existData = await existResp.json();
                            const existingItems = existData.items || existData;
                            if (Array.isArray(existingItems)) {
                                const preekIdx = existingItems.findIndex(i => i.type === 'header' && /preek/i.test(i.id?.name));
                                const eindIdx = existingItems.findIndex(i => i.type === 'header' && /eind/i.test(i.id?.name));
                                if (preekIdx >= 0 && eindIdx > preekIdx) {
                                    preservedManualItems = existingItems.slice(preekIdx + 1, eindIdx).map(item => {
                                        // id.uuid MOET gelijk zijn aan target_uuid, anders geeft
                                        // ProPresenter PUT een 404 (de id.uuid van een playlist-item
                                        // is niet dezelfde als de presentatie-uuid in de library).
                                        const targetUuid = item.target_uuid || item.presentation_info?.presentation_uuid || item.id?.uuid || '';
                                        return {
                                            id: { uuid: targetUuid, name: item.id?.name || '', index: 0 },
                                            type: item.type || 'presentation',
                                            is_hidden: item.is_hidden ?? false,
                                            is_pco: item.is_pco ?? false,
                                            target_uuid: targetUuid,
                                            destination: item.destination || 'presentation'
                                        };
                                    });
                                }
                            }
                        }
                    } catch (e) { console.warn('[Sync] Could not read existing playlist:', e.message); }

                    if (preservedManualItems.length) {
                        const newPreekIdx = items.findIndex(i => i.type === 'header' && /preek/i.test(i.id?.name));
                        if (newPreekIdx >= 0) {
                            items.splice(newPreekIdx + 1, 0, ...preservedManualItems);
                            console.log('[Sync] Preserved', preservedManualItems.length, 'manual items after Preek');
                        }
                    }
                    console.log('[Sync] Override target UUID (bestaande playlist):', targetPlaylistUuid);
                }
            }

            if (!targetPlaylistUuid) {
                // Geen conflict → maak nieuwe playlist
                const createResp = await proFetch(`${BASE_URL}/playlists`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: playlistName })
                }, 15000);
                if (!createResp.ok) throw new Error(`Playlist creation failed: HTTP ${createResp.status}`);
                const newPl = await createResp.json();
                targetPlaylistUuid = newPl.uuid || newPl.id?.uuid;
            }
            if (!targetPlaylistUuid) throw new Error('Could not get playlist UUID from response');

            // Step 5: PUT items into playlist
            console.log('[Sync] PUT:', `${BASE_URL}/playlist/${targetPlaylistUuid}`, 'items:', items.length);
            const putResp = await proFetch(`${BASE_URL}/playlist/${targetPlaylistUuid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items)
            }, 15000);

            console.log('[Sync] PUT status:', putResp.status);
            if (!putResp.ok) {
                const errorText = await putResp.text();
                console.error('[Sync] PUT error body:', errorText);
                throw new Error(`Playlist update failed: HTTP ${putResp.status} - ${errorText}`);
            }

            let statusMsg = `✅ Sync gelukt! ${matchedSongs} nummers gesynchroniseerd.`;
            if (existingPlaylistUuid) statusMsg += ` (Playlist geüpdatet)`;
            if (unmatchedSongs.length > 0) {
                statusMsg += `\n❌ Niet gevonden (${unmatchedSongs.length}): ${unmatchedSongs.join(', ')}`;
            }
            this.showStatus(statusMsg, "success");

        } catch (err) {
            console.error('[Sync] Error:', err);
            this.showStatus(`❌ Sync fout: ${err.message}`, "error");
        }
    },

    showStatus(msg, type) {
        const box = document.getElementById('setlist-status-box');
        if (!box) return;
        box.innerText = msg;
        box.className = 'toggle-item status-alert-box';
        if (type === 'success') box.classList.add('green-alert');
        else if (type === 'error') box.classList.add('orange-alert');
        box.style.display = 'block';
    },

    // --- TEMPLATE EDITOR ---
    rgbToHex(c) {
        if (!c) return "#000000";
        const r = Math.round((c.red || 0) * 255).toString(16).padStart(2, '0');
        const g = Math.round((c.green || 0) * 255).toString(16).padStart(2, '0');
        const b = Math.round((c.blue || 0) * 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    },

    hexToRgb(h) {
        const hex = h.replace('#', '');
        return {
            red: parseInt(hex.substring(0, 2), 16) / 255,
            green: parseInt(hex.substring(2, 4), 16) / 255,
            blue: parseInt(hex.substring(4, 6), 16) / 255,
            alpha: 1.0
        };
    },

    openTemplateEditor() {
        this.editingTemplateKey = document.getElementById('setlist-service-type').value;
        const tpl = this.SERVICE_TEMPLATES[this.editingTemplateKey];
        // edit-tpl-name is now an <input type="text"> (editable inline title) — use .value.
        document.getElementById('edit-tpl-name').value = tpl.name;

        const container = document.getElementById('tpl-items-container');
        // Remove only existing rows - preserve the .btn-list-add-trigger at the bottom.
        container.querySelectorAll('.tpl-item-row').forEach(r => r.remove());
        tpl.items.forEach((item, index) => {
            container.appendChild(this.createItemRow(item, index));
        });

        const resetBtn = document.getElementById('btn-reset-tpl');
        if (resetBtn) {
            resetBtn.style.display = this.DEFAULT_TEMPLATES[this.editingTemplateKey] ? 'inline-block' : 'none';
        }

        document.getElementById('setlist-template-modal').classList.remove('hidden');

        // Bind (or rebind) Sortable.js for drag/drop reordering on the rows container.
        // The drag handle is .tpl-drag-handle; only .tpl-item-row is draggable so the
        // + add-trigger at the bottom stays anchored. The btn-list-add-trigger must
        // remain the LAST child of the container for addNewItemAtPosition() inserts.
        if (typeof Sortable !== 'undefined') {
            if (this.tplSortable) {
                this.tplSortable.destroy();
            }
            this.tplSortable = Sortable.create(container, {
                handle: '.tpl-drag-handle',
                animation: 200,
                draggable: '.tpl-item-row',
                ghostClass: 'sortable-ghost'
            });
        }
    },

    createItemRow(item, index) {
        const div = document.createElement('div');
        div.className = 'tpl-item-row';
        const isHeader = item.type === 'header';
        // 6-dot SVG handle (SortableJS .tpl-drag-handle target)
        const dragHandleSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
        // X-icon SVG for the remove button
        const removeSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

        div.innerHTML = `
            <div class="tpl-drag-handle">${dragHandleSvg}</div>
            <div class="tpl-row-fields">
                <input type="text" class="i-name" value="${item.name || ''}" placeholder="Name" style="width: 100%; flex-basis: 100%;">
                <select class="i-type" onchange="setlistModule.toggleRowFields(this)" style="flex: 1;">
                    <option value="header" ${isHeader ? 'selected' : ''}>Header</option>
                    <option value="presentation" ${!isHeader ? 'selected' : ''}>Presentation</option>
                </select>
                <input type="color" class="i-color" value="${this.rgbToHex(item.color)}" title="Color" style="display:${isHeader ? 'block' : 'none'}">
                <select class="i-insert" style="display:${isHeader ? 'block' : 'none'}; flex: 1.5;">
                    <option value="">No Insert</option>
                    <option value="opening" ${item.insert === 'opening' ? 'selected' : ''}>+ Opening</option>
                    <option value="praise" ${item.insert === 'praise' ? 'selected' : ''}>+ Worship</option>
                    <option value="closing" ${item.insert === 'closing' ? 'selected' : ''}>+ Closing</option>
                    <option value="doop" ${item.insert === 'doop' ? 'selected' : ''}>+ Doop</option>
                    <option value="avondmaal" ${item.insert === 'avondmaal' ? 'selected' : ''}>+ Avondmaal</option>
                </select>
                <input type="text" class="i-uuid" value="${item.uuid || ''}" placeholder="Target UUID" style="display:${!isHeader ? 'block' : 'none'}; flex: 2;">
                <input type="text" class="i-dest" value="${item.destination || 'presentation'}" placeholder="Dest" style="width: 90px;">
            </div>
            <button class="tpl-btn-remove" onclick="setlistModule.removeRow(this)" title="Verwijder">${removeSvg}</button>
            <div class="tpl-inline-insert-trigger" onclick="setlistModule.addNewItemAtPosition(this)" title="Voeg item hier tussenin toe">+</div>
        `;
        return div;
    },

    /**
     * Remove a single template row by its remove button.
     * Used by the fade-in delete buttons; called via inline onclick.
     * Renamed from inline parentElement.remove() so we can hook in
     * animations / dirty-state tracking later without touching markup.
     */
    removeRow(btnEl) {
        const row = btnEl.closest('.tpl-item-row');
        if (row) row.remove();
    },

    /**
     * Insert a new editable template row IMMEDIATELY AFTER the row
     * whose .tpl-inline-insert-trigger was clicked. The new row has
     * the same DOM structure as createItemRow({type:'header',name:''}).
     * Used by the green ⊕ buttons that appear between rows on hover.
     */
    addNewItemAtPosition(triggerEl) {
        const container = document.getElementById('tpl-items-container');
        if (!container) return;
        const currentRow = triggerEl.closest('.tpl-item-row');
        const newRow = this.createItemRow({ type: 'header', name: '' }, container.querySelectorAll('.tpl-item-row').length);
        if (currentRow && currentRow.parentElement === container) {
            currentRow.insertAdjacentElement('afterend', newRow);
        } else {
            const addBtn = container.querySelector('.btn-list-add-trigger');
            if (addBtn) container.insertBefore(newRow, addBtn);
            else container.appendChild(newRow);
        }
        // Autofocus the row's name input for quick editing
        const nameInput = newRow.querySelector('.i-name');
        if (nameInput) nameInput.focus();
    },

    toggleRowFields(selectEl) {
        const row = selectEl.closest('.tpl-item-row');
        const isHeader = selectEl.value === 'header';
        row.querySelector('.i-color').style.display = isHeader ? 'block' : 'none';
        row.querySelector('.i-insert').style.display = isHeader ? 'block' : 'none';
        row.querySelector('.i-uuid').style.display = !isHeader ? 'block' : 'none';
    },

    addTemplateItem() {
        const container = document.getElementById('tpl-items-container');
        // Insert the new row ABOVE the .btn-list-add-trigger.
        const newRow = this.createItemRow({ type: 'header', name: 'New Item' }, container.querySelectorAll('.tpl-item-row').length);
        const addBtn = container.querySelector('.btn-list-add-trigger');
        if (addBtn) container.insertBefore(newRow, addBtn);
        else container.appendChild(newRow);
    },

    async saveTemplateEdit() {
        // Persist any changes to the editable template title (the input.next to "Template:").
        const titleEl = document.getElementById('edit-tpl-name');
        if (titleEl && this.SERVICE_TEMPLATES[this.editingTemplateKey]) {
            const newName = (titleEl.value || '').trim();
            if (newName) this.SERVICE_TEMPLATES[this.editingTemplateKey].name = newName;
        }
        const rows = document.querySelectorAll('#tpl-items-container .tpl-item-row');
        const newItems = [];
        rows.forEach(row => {
            const type = row.querySelector('.i-type').value;
            let obj = {
                type: type,
                name: row.querySelector('.i-name').value,
                destination: row.querySelector('.i-dest').value || 'presentation'
            };
            if (type === 'header') {
                obj.color = this.hexToRgb(row.querySelector('.i-color').value);
                const ins = row.querySelector('.i-insert').value;
                if (ins) obj.insert = ins;
            } else {
                obj.uuid = row.querySelector('.i-uuid').value;
            }
            newItems.push(obj);
        });
        this.SERVICE_TEMPLATES[this.editingTemplateKey].items = newItems;
        await this.saveTemplates();
        this.renderTemplateDropdown();
        this.closeTemplateModal();
        this.showStatus('Template opgeslagen!', 'success');
    },

    closeTemplateModal() {
        document.getElementById('setlist-template-modal')?.classList.add('hidden');
        // Collapse the footer dropdown so re-opening doesnt show a stuck-open menu.
        const wrapper = document.querySelector('#setlist-template-modal .footer-actions-menu-wrapper');
        if (wrapper) wrapper.classList.remove('open');
        // Tear down the Sortable instance so any in-progress drag stops leaking listeners.
        if (this.tplSortable) {
            this.tplSortable.destroy();
            this.tplSortable = null;
        }
    },

    showNewTemplateModal() {
        const input = document.getElementById('new-tpl-name-input');
        if (input) input.value = '';
        document.getElementById('new-template-modal')?.classList.remove('hidden');
        setTimeout(() => input?.focus(), 50);
    },

    closeNewTemplateModal() {
        document.getElementById('new-template-modal')?.classList.add('hidden');
    },

    async confirmNewTemplate() {
        const name = document.getElementById('new-tpl-name-input')?.value.trim();
        if (!name) return;
        const key = name.replace(/[^a-zA-Z0-9]/g, '') + Date.now();
        this.SERVICE_TEMPLATES[key] = { name: name, items: [] };
        await this.saveTemplates();
        this.renderTemplateDropdown();
        document.getElementById('setlist-service-type').value = key;
        this.closeNewTemplateModal();
        this.openTemplateEditor();
    },

    async deleteCurrentTemplate() {
        if (Object.keys(this.SERVICE_TEMPLATES).length <= 1) {
            alert(__('setlist_cannot_delete_last'));
            return;
        }
        if (confirm(__('setlist_confirm_delete') + ' \'' + this.SERVICE_TEMPLATES[this.editingTemplateKey].name + '\' ' + __('setlist_wilt_verwijderen'))) {
            delete this.SERVICE_TEMPLATES[this.editingTemplateKey];
            await this.saveTemplates();
            this.closeTemplateModal();
            this.renderTemplateDropdown();
            this.showStatus('Template verwijderd.', 'success');
        }
    },

    async resetTemplateToDefault() {
        if (confirm(__('setlist_confirm_reset'))) {
            this.SERVICE_TEMPLATES[this.editingTemplateKey] = JSON.parse(JSON.stringify(this.DEFAULT_TEMPLATES[this.editingTemplateKey]));
            await this.saveTemplates();
            this.openTemplateEditor();
        }
    },

};

// Close the footer dropdown on outside click.
document.addEventListener('click', function(event) {
    const menuWrapper = document.querySelector('.footer-actions-menu-wrapper');
    if (menuWrapper && !menuWrapper.contains(event.target)) {
        menuWrapper.classList.remove('open');
    }
});

// Make globally available for onclick handlers
window.setlistModule = setlistModule;
