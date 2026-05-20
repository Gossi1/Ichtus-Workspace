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
                { type: "header", name: "Doopliederen", color: { red: 0.588, green: 0.518, blue: 0.137, alpha: 1.0 } },
                { type: "header", name: "Eindlied", color: { red: 0.098, green: 0.486, blue: 0.098, alpha: 1.0 }, insert: "closing" },
                { type: "header", name: "Einde-Dienst", color: { red: 0.545, green: 0.0, blue: 0.0, alpha: 1.0 } },
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
    serviceDate: null,
    proConnectionStatus: 'unknown', // 'unknown' | 'online' | 'offline'

    init() {
        // One-time setup: templates, event listeners, button bindings
        if (!this.initialized) {
            this.initialized = true;

            // Load templates
            this.SERVICE_TEMPLATES = JSON.parse(localStorage.getItem('setlistTemplates')) || JSON.parse(JSON.stringify(this.DEFAULT_TEMPLATES));

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

            // Initialize ProPresenter IP display
            this.updateProIpDisplay();

            // Setup IP input change handler
            this.setupProIpInputHandler();

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

        // Restore any previously received setlist from localStorage
        const saved = localStorage.getItem('ichtus_received_setlist');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.receivedSetlist = data.raw;
                this.parsedSongs = data.parsed;
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
                this.receiveSetlist(e.detail.setlist, e.detail.date);
            }
        });
    },

    receiveSetlist(rawText, date) {
        console.log('[SPA] receiveSetlist called. Has date?', !!date, 'date value:', date);
        // Prevent re-processing identical data (e.g. from cached re-dispatch)
        if (this.receivedSetlist === rawText) {
            console.log('[SPA] Skipping duplicate setlist');
            return;
        }

        this.receivedSetlist = rawText;
        this.parsedSongs = this.parseSongs(rawText);
        this.serviceDate = date || null;
        console.log('[SPA] serviceDate set to:', this.serviceDate);

        // Persist
        localStorage.setItem('ichtus_received_setlist', JSON.stringify({
            raw: rawText,
            parsed: this.parsedSongs,
            date: this.serviceDate,
            receivedAt: new Date().toISOString()
        }));

        this.updateConnectionStatus('received');
        this.renderSongPreview();
        this.renderDateDisplay();
        const dateMsg = this.serviceDate ? `📅 ${this.serviceDate} — ` : '';
        this.showStatus(`✅ ${dateMsg}${__('setlist_received')}! ${this.countSongs()} ${__('cl_edit_items_count')} ${__('ndi_sources_found')}.`, 'success');
    },

    renderDateDisplay() {
        const el = document.getElementById('setlist-date-display');
        if (!el) return;
        if (this.serviceDate) {
            el.textContent = __('setlist_service_date') + this.serviceDate;
            el.style.display = 'block';
        } else {
            el.textContent = __('setlist_no_date');
            el.style.display = 'block';
            el.style.color = '#f47920';
        }
    },

    countSongs() {
        if (!this.parsedSongs) return 0;
        return this.parsedSongs.opening.length + this.parsedSongs.praise.length + this.parsedSongs.closing.length;
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

    renderSongPreview() {
        const container = document.getElementById('setlist-preview');
        if (!container || !this.parsedSongs) return;

        const { opening, praise, closing } = this.parsedSongs;
        let html = '';

        if (opening.length > 0) {
            html += `<div class="song-bucket"><h4 class="bucket-title bucket-opening">Openingsliederen (${opening.length})</h4><ul>`;
            opening.forEach(s => html += `<li>${this.escapeHtml(s)}</li>`);
            html += '</ul></div>';
        }
        if (praise.length > 0) {
            html += `<div class="song-bucket"><h4 class="bucket-title bucket-praise">Praise & Worship (${praise.length})</h4><ul>`;
            praise.forEach(s => html += `<li>${this.escapeHtml(s)}</li>`);
            html += '</ul></div>';
        }
        if (closing.length > 0) {
            html += `<div class="song-bucket"><h4 class="bucket-title bucket-closing">Eindliederen (${closing.length})</h4><ul>`;
            closing.forEach(s => html += `<li>${this.escapeHtml(s)}</li>`);
            html += '</ul></div>';
        }

        if (html === '') {
            html = '<p class="setlist-empty">Geen nummers gevonden in de setlist.</p>';
        }

        container.innerHTML = html;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    renderTemplateDropdown() {
        const select = document.getElementById('setlist-service-type');
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '';
        for (const [key, tpl] of Object.entries(this.SERVICE_TEMPLATES)) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = tpl.name;
            select.appendChild(opt);
        }
        if (this.SERVICE_TEMPLATES[currentValue]) select.value = currentValue;
    },

    bindEvents() {
        document.getElementById('btn-setlist-sync')?.addEventListener('click', () => this.handleSync());
        document.getElementById('btn-setlist-clear')?.addEventListener('click', () => this.clearSetlist());
        document.getElementById('btn-open-worshiptools')?.addEventListener('click', () => {
            window.open('https://planning.worshiptools.com/app', '_blank');
        });
        document.getElementById('btn-setlist-template-edit')?.addEventListener('click', () => this.openTemplateEditor());
        document.getElementById('btn-setlist-template-new')?.addEventListener('click', () => this.showNewTemplateModal());

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

    },

    clearSetlist() {
        this.receivedSetlist = null;
        this.parsedSongs = null;
        this.serviceDate = null;
        localStorage.removeItem('ichtus_received_setlist');
        this.updateConnectionStatus('waiting');
        this.showStatus(__('setlist_cleared'), '');
        this.renderDateDisplay();
    },

    updateProIpDisplay() {
        const ipDisplay = document.getElementById('pro-ip-display');
        if (ipDisplay) {
            ipDisplay.value = `${this.CONFIG.PRO_IP}:${this.CONFIG.PRO_PORT}`;
        }
    },

    setupProIpInputHandler() {
        const ipInput = document.getElementById('pro-ip-display');
        if (ipInput) {
            ipInput.addEventListener('change', () => {
                const value = ipInput.value.trim();
                if (value) {
                    const parts = value.split(':');
                    if (parts.length === 2) {
                        this.CONFIG.PRO_IP = parts[0];
                        this.CONFIG.PRO_PORT = parts[1];
                        localStorage.setItem('setlistProIp', value);
                        this.showStatus(`✅ IP opgeslagen: ${value}`, 'success');
                    } else if (parts.length === 1 && parts[0]) {
                        // Only IP provided, use default port
                        this.CONFIG.PRO_IP = parts[0];
                        localStorage.setItem('setlistProIp', `${parts[0]}:${this.CONFIG.PRO_PORT}`);
                        this.showStatus(`✅ IP opgeslagen: ${parts[0]}:${this.CONFIG.PRO_PORT}`, 'success');
                    }
                }
            });
            // Update on Enter key as well
            ipInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    ipInput.blur();
                }
            });
        }
    },

    async testProPresenterConnection() {
        const statusDot = document.getElementById('pro-status-dot');
        const statusText = document.getElementById('pro-connection-status');
        const testBtn = document.getElementById('btn-test-proconnection');
        
        if (statusDot) statusDot.className = 'status-dot warning';
        if (statusText) statusText.textContent = __('setlist_testing');
        if (testBtn) testBtn.disabled = true;

        const BASE_URL = `http://${this.CONFIG.PRO_IP}:${this.CONFIG.PRO_PORT}/v1`;

        try {
            // Try fetching the looks endpoint - this is a reliable endpoint that exists in all ProPresenter versions
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(`${BASE_URL}/looks`, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                this.proConnectionStatus = 'online';
                if (statusDot) statusDot.className = 'status-dot online';
                if (statusText) statusText.textContent = __('setlist_connected');
                this.showStatus(`✅ ProPresenter API is bereikbaar op ${this.CONFIG.PRO_IP}:${this.CONFIG.PRO_PORT}`, 'success');
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
            this.showStatus(`❌ ${errorMsg}. Controleer IP-adres en of ProPresenter draait.`, 'error');
        } finally {
            if (testBtn) {
                testBtn.disabled = false;
                testBtn.textContent = __('setlist_test_connection');
            }
        }
    },

    parseSongs(rawText) {
        let opening = [], praise = [], closing = [];
        let currentBucket = opening;
        const seen = new Set();
        const ignore = ["preek", "opening", "offergave", "repetities", "kerkdiensten", "worship tools", "avondmaal", "reserve"];

        const lines = rawText.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (line.includes("D000 - Opening dienst en offergave")) {
                currentBucket = praise;
                continue;
            } else if (line.includes("D000 - Preek")) {
                currentBucket = closing;
                continue;
            }

            if (ignore.some(word => line.toLowerCase().includes(word))) continue;

            let cleaned = line.replace(/^\d{1,2}:\d{2}\s*(?:\|\s*)?/, '').trim();
            // Remove chord notation from end: basic (A, C#), minor (Am, Dm), extended (G7, Cmaj7), sharp/flat (C#m, Cbm)
            cleaned = cleaned.replace(/\s+[A-G][b#]?(?:m|maj|min|dim|aug|sus|add|\d+)*$/i, '').trim();

            if (cleaned && !seen.has(cleaned)) {
                currentBucket.push(cleaned);
                seen.add(cleaned);
            }
        }
        return { opening, praise, closing };
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

    async handleSync() {
        const statusBox = document.getElementById('setlist-status-box');

        if (!this.parsedSongs || this.countSongs() === 0) {
            this.showStatus(__('setlist_waiting') + ' ' + __('setlist_extract_help'), "error");
            return;
        }

        console.log('[Sync] Starting sync...');
        this.showStatus(__('setlist_syncing'), '');

        try {
            const BASE_URL = `http://${this.CONFIG.PRO_IP}:${this.CONFIG.PRO_PORT}/v1`;

            // Step 1: Get library UUID from name
            console.log('[Sync] Step 1: Fetching libraries list...');
            
            const libsResp = await proFetch(`${BASE_URL}/libraries`, { method: 'GET' });
            console.log('[Sync] Libraries response status:', libsResp.status);
            
            if (!libsResp.ok) {
                const errorText = await libsResp.text();
                throw new Error(`Libraries list fetch failed: HTTP ${libsResp.status} - ${errorText}`);
            }
            
            let libsData;
            try {
                libsData = await libsResp.json();
            } catch (jsonErr) {
                throw new Error(`Libraries response is not valid JSON: ${jsonErr.message}`);
            }
            
            if (!Array.isArray(libsData)) {
                throw new Error(`Libraries response is not an array: ${JSON.stringify(libsData).substring(0, 100)}`);
            }
            
            // Find the library by name
            const targetLib = libsData.find(lib => lib.name === this.CONFIG.LIBRARY_NAME);
            if (!targetLib) {
                throw new Error(`Library "${this.CONFIG.LIBRARY_NAME}" not found. Available: ${libsData.map(l => l.name).join(', ')}`);
            }
            console.log('[Sync] Found library:', targetLib.name, 'UUID:', targetLib.uuid);
            
            // Step 2: Fetch library contents
            console.log('[Sync] Step 2: Fetching library contents...');
            
            const libResp = await proFetch(`${BASE_URL}/library/${targetLib.uuid}`, { method: 'GET' });
            console.log('[Sync] Library response status:', libResp.status);
            
            if (!libResp.ok) {
                const errorText = await libResp.text();
                throw new Error(`Library contents fetch failed: HTTP ${libResp.status} - ${errorText}`);
            }
            
            let libData;
            try {
                libData = await libResp.json();
            } catch (jsonErr) {
                throw new Error(`Library response is not valid JSON: ${jsonErr.message}`);
            }
            console.log('[Sync] Library items count:', libData.items?.length || 0);
            
            const libraryMap = {};
            libData.items.forEach(item => {
                libraryMap[item.name.toLowerCase().trim()] = item.uuid;
            });

            // Step 3: Build setlist items
            console.log('[Sync] Step 3: Building setlist items...');
            const { opening, praise, closing } = this.parsedSongs;
            console.log('[Sync] Songs found - Opening:', opening.length, 'Praise:', praise.length, 'Closing:', closing.length);

            const selectedTemplateKey = document.getElementById('setlist-service-type').value;
            const template = this.SERVICE_TEMPLATES[selectedTemplateKey];

            let items = [];
            let matchedSongs = 0;
            let unmatchedSongs = [];

            template.items.forEach(tplItem => {
                items.push(this.createItem(tplItem.name, tplItem.uuid || "", tplItem.type === "header", tplItem.color, tplItem.destination || "presentation"));
                if (tplItem.insert) {
                    let listToInsert = [];
                    if (tplItem.insert === "opening") listToInsert = opening;
                    if (tplItem.insert === "praise") listToInsert = praise;
                    if (tplItem.insert === "closing") listToInsert = closing;
                    listToInsert.forEach(s => {
                        const uuid = libraryMap[s.toLowerCase()];
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
                console.warn('[Sync] No songs matched! Unmatched songs:', unmatchedSongs);
                console.warn('[Sync] Available library items (first 10):', Object.keys(libraryMap).slice(0, 10));
            }

            // Step 4: Create new playlist
            console.log('[Sync] Step 4: Creating playlist...');
            const playlistName = this.serviceDate || ("Web Sync: " + new Date().toLocaleTimeString(i18n.getLocale()));
            console.log('[Sync] Creating playlist with name:', playlistName);
            if (!this.serviceDate) {
                console.warn('[Sync] WARNING: No serviceDate available! Using fallback name.');
            }
            const createPlaylist = await proFetch(`${BASE_URL}/playlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: playlistName })
            }, 15000);
            console.log('[Sync] Playlist creation status:', createPlaylist.status);
            
            if (!createPlaylist.ok) {
                const errorText = await createPlaylist.text();
                throw new Error(`Playlist creation failed: HTTP ${createPlaylist.status} - ${errorText}`);
            }
            
            const newPlaylist = await createPlaylist.json();
            console.log('[Sync] Playlist response:', newPlaylist);
            
            const playlistUuid = newPlaylist.uuid || newPlaylist.id?.uuid;
            if (!playlistUuid) {
                throw new Error('Could not get playlist UUID from response');
            }
            console.log('[Sync] Created playlist UUID:', playlistUuid);

            // Step 5: Add items to playlist
            console.log('[Sync] Step 5: Adding items to playlist...');
            const putResp = await proFetch(`${BASE_URL}/playlist/${playlistUuid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items)
            }, 15000);
            console.log('[Sync] Playlist update status:', putResp.status);
            
            if (!putResp.ok) {
                const errorText = await putResp.text();
                throw new Error(`Playlist update failed: HTTP ${putResp.status} - ${errorText}`);
            }

            let statusMsg = `✅ Sync gelukt! ${matchedSongs} nummers gesynchroniseerd.`;
            if (unmatchedSongs.length > 0) {
                statusMsg += `\n❌ Niet gevonden (${unmatchedSongs.length}): ${unmatchedSongs.join(', ')}`;
            }
            this.showStatus(statusMsg, "success");
            
            if (unmatchedSongs.length > 0) {
                console.warn('[Sync] Unmatched songs:', unmatchedSongs);
            }
            
        } catch (err) {
            console.error('[Sync] Error:', err);
            this.showStatus(`❌ Sync fout: ${err.message}`, "error");
        }
    },

    showStatus(msg, type) {
        const box = document.getElementById('setlist-status-box');
        if (!box) return;
        box.innerText = msg;
        box.className = 'setlist-status';
        if (type) box.classList.add(type);
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
        document.getElementById('edit-tpl-name').innerText = tpl.name;

        const container = document.getElementById('tpl-items-container');
        container.innerHTML = '';
        tpl.items.forEach((item, index) => {
            container.appendChild(this.createItemRow(item, index));
        });

        const resetBtn = document.getElementById('btn-reset-tpl');
        if (resetBtn) {
            resetBtn.style.display = this.DEFAULT_TEMPLATES[this.editingTemplateKey] ? 'inline-block' : 'none';
        }

        document.getElementById('setlist-template-modal').classList.remove('hidden');
    },

    createItemRow(item, index) {
        const div = document.createElement('div');
        div.className = 'tpl-item-row';
        const isHeader = item.type === 'header';

        div.innerHTML = `
            <input type="text" class="i-name" value="${item.name || ''}" placeholder="Header/Item Name" style="flex:2; min-width:150px;">
            <select class="i-type" onchange="setlistModule.toggleRowFields(this)">
                <option value="header" ${isHeader ? 'selected' : ''}>Header</option>
                <option value="presentation" ${!isHeader ? 'selected' : ''}>Presentation</option>
            </select>
            <input type="color" class="i-color" value="${this.rgbToHex(item.color)}" title="Header Color" style="display:${isHeader ? 'block' : 'none'}">
            <select class="i-insert" style="display:${isHeader ? 'block' : 'none'}; flex:1;">
                <option value="">No Insert</option>
                <option value="opening" ${item.insert === 'opening' ? 'selected' : ''}>+ Opening Songs</option>
                <option value="praise" ${item.insert === 'praise' ? 'selected' : ''}>+ Worship Songs</option>
                <option value="closing" ${item.insert === 'closing' ? 'selected' : ''}>+ Closing Songs</option>
            </select>
            <input type="text" class="i-uuid" value="${item.uuid || ''}" placeholder="Target UUID" style="display:${!isHeader ? 'block' : 'none'}; flex:2;">
            <input type="text" class="i-dest" value="${item.destination || 'presentation'}" placeholder="Destination" style="width:120px">
            <button class="tpl-btn-remove" onclick="this.parentElement.remove()" title="Verwijder">✖</button>
        `;
        return div;
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
        container.appendChild(this.createItemRow({ type: 'header', name: 'New Item' }, container.children.length));
    },

    saveTemplateEdit() {
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
        localStorage.setItem('setlistTemplates', JSON.stringify(this.SERVICE_TEMPLATES));
        this.closeTemplateModal();
        this.showStatus('Template opgeslagen!', 'success');
    },

    closeTemplateModal() {
        document.getElementById('setlist-template-modal')?.classList.add('hidden');
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

    confirmNewTemplate() {
        const name = document.getElementById('new-tpl-name-input')?.value.trim();
        if (!name) return;
        const key = name.replace(/[^a-zA-Z0-9]/g, '') + Date.now();
        this.SERVICE_TEMPLATES[key] = { name: name, items: [] };
        localStorage.setItem('setlistTemplates', JSON.stringify(this.SERVICE_TEMPLATES));
        this.renderTemplateDropdown();
        document.getElementById('setlist-service-type').value = key;
        this.closeNewTemplateModal();
        this.openTemplateEditor();
    },

    deleteCurrentTemplate() {
        if (Object.keys(this.SERVICE_TEMPLATES).length <= 1) {
            alert(__('setlist_cannot_delete_last'));
            return;
        }
        if (confirm(__('setlist_confirm_delete') + ' \'' + this.SERVICE_TEMPLATES[this.editingTemplateKey].name + '\' ' + __('setlist_wilt_verwijderen'))) {
            delete this.SERVICE_TEMPLATES[this.editingTemplateKey];
            localStorage.setItem('setlistTemplates', JSON.stringify(this.SERVICE_TEMPLATES));
            this.closeTemplateModal();
            this.renderTemplateDropdown();
            this.showStatus('Template verwijderd.', 'success');
        }
    },

    resetTemplateToDefault() {
        if (confirm(__('setlist_confirm_reset'))) {
            this.SERVICE_TEMPLATES[this.editingTemplateKey] = JSON.parse(JSON.stringify(this.DEFAULT_TEMPLATES[this.editingTemplateKey]));
            localStorage.setItem('setlistTemplates', JSON.stringify(this.SERVICE_TEMPLATES));
            this.openTemplateEditor();
        }
    },

};

// Make globally available for onclick handlers
window.setlistModule = setlistModule;
