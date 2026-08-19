// Integrations Module for Ichtus Workspace
const integrationModule = {
    initialized: false,

    // Source of truth — rendered into #integration-card-grid
    // `connected` is recomputed from settings on render so card status
    // always reflects reality, not a stale hard-coded value.
    INTEGRATIONS: [
        {
            id: 'propresenter',
            name: 'ProPresenter',
            icon: 'PP',
            iconTheme: 'orange',
            tagline: '',
            description: 'Follow slides and timers in live service dashboards.',
            // connected / accountName refreshed by _applyProPresenterState()
            connected: false,
            accountName: '',
            primaryAction: true,
            actionLabel: 'Connect',
            managedByModal: true
        },
        {
            id: 'worshiptools-ext',
            name: 'WorshipTools Extensie',
            icon: 'WT',
            iconTheme: 'green',
            tagline: 'Chrome Extension',
            description: 'Extract setlists from WorshipTools Planning and sync them directly to the Setlist module.',
            connected: false,
            accountName: '',
            primaryAction: true,
            actionLabel: 'Installeer',
            managedByModal: true
        }
    ],

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this._bindCardEvents();
        this._bindModalEvents();
        this.render();

        // Re-sync every time the integration view comes into focus
        if (typeof router !== 'undefined') {
            const orig = router.navigate.bind(router);
            router.navigate = (view, updateHash) => {
                const result = orig(view, updateHash);
                if (view === 'integration') {
                    this._applyProPresenterState();
                    this.render();
                }
                return result;
            };
        }
    },

    // ── Card event delegation ──────────────────────────────────────────
    _bindCardEvents() {
        const grid = document.getElementById('integration-card-grid');
        if (!grid || grid._integrationDelegated) return;
        grid._integrationDelegated = true;
        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = btn.dataset.action;
            if (id === 'propresenter') {
                this.openProPresenterModal();
            } else if (id === 'worshiptools-ext') {
                this.openWorshipToolsExtModal();
            }
        });
    },

    render() {
        const grid = document.getElementById('integration-card-grid');
        if (!grid) return;
        this._applyProPresenterState();
        this._applyWorshipToolsExtState();
        grid.innerHTML = this.INTEGRATIONS.map(i => this._cardMarkup(i)).join('');
    },

    // Re-read the ProPresenter connection state from settings so the card
    // label/dot reflect reality (instead of a hard-coded literal).
    _applyProPresenterState() {
        if (typeof settingsModule === 'undefined') return;
        const ip     = settingsModule.getSetting('proPresenterIp');
        const port   = settingsModule.getSetting('proPresenterPort');
        const pass   = settingsModule.getSetting('proPresenterPassword');
        const haveCredentials = !!ip && !!port && this._lastProConnected === true;

        const card = this.INTEGRATIONS.find(i => i.id === 'propresenter');
        if (!card) return;
        card.connected = haveCredentials;
        card.accountName = haveCredentials ? `${ip}:${port}` : '';
        card.actionLabel = haveCredentials ? 'Manage' : 'Connect';
        // password presence hints present but we don't show it on the card.
        void pass;
    },

    // Last test outcome — used by _applyProPresenterState() above.
    _lastProConnected: false,
    // Guard against parallel auto-connect attempts (e.g. if app.js and a
    // view-init fire roughly at the same time on cold-boot).
    _autoConnecting: false,

    // Called once on app boot. If the user previously saved ProPresenter
    // credentials, reconnect silently so the rest of the app can rely on
    // the API being available without forcing a modal visit.
    async autoConnectProPresenter() {
        if (this._autoConnecting) return;
        if (typeof settingsModule === 'undefined') return;

        const ip = settingsModule.getSetting('proPresenterIp');
        const port = settingsModule.getSetting('proPresenterPort');
        if (!ip || !port) return; // nothing saved — leave disconnected

        this._autoConnecting = true;
        try {
            const password = settingsModule.getSetting('proPresenterPassword') || '';
            const ok = await this._probeProPresenter(ip, port, password);
            this._lastProConnected = ok;
            if (ok && typeof console !== 'undefined') {
                console.info(`[integrationModule] ProPresenter reachable at ${ip}:${port}`);
            }
            // Only re-render if the user is actually looking at the
            // integration view — otherwise there's no card to update.
            if (typeof router !== 'undefined' && router.currentView === 'integration') {
                this._applyProPresenterState();
                this.render();
            }
        } finally {
            this._autoConnecting = false;
        }
    },

    // ── Modal: open / close / submit ────────────────────────────────────

    openProPresenterModal() {
        if (typeof settingsModule === 'undefined') {
            console.warn('integrationModule: settingsModule missing, cannot open ProPresenter modal');
            return;
        }
        const modal = document.getElementById('integration-pp-modal');
        if (!modal) return;

        // Prefill from settings
        this._setModalField('integration-pp-ip', settingsModule.getSetting('proPresenterIp'));
        this._setModalField('integration-pp-port', settingsModule.getSetting('proPresenterPort'));
        this._setModalField('integration-pp-password', settingsModule.getSetting('proPresenterPassword') || '');

        // Reset status banner
        const banner = document.getElementById('integration-pp-status');
        if (banner) {
            banner.className = 'integration-pp-status';
            banner.style.display = 'none';
            banner.textContent = '';
        }

        modal.classList.remove('hidden');
        const ipField = document.getElementById('integration-pp-ip');
        if (ipField) ipField.focus();
    },

    closeProPresenterModal() {
        const modal = document.getElementById('integration-pp-modal');
        if (modal) modal.classList.add('hidden');
    },

    _setModalField(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value == null ? '' : value;
    },

    _bindModalEvents() {
        // Allow clicking the backdrop to dismiss
        const modal = document.getElementById('integration-pp-modal');
        if (modal && !modal._integrationDelegated) {
            modal._integrationDelegated = true;
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeProPresenterModal();
            });
        }
        // Persist as you type so a reload doesn't lose what was typed.
        // Using input (not change) means we capture every keystroke.
        const fieldMap = {
            'integration-pp-ip': 'proPresenterIp',
            'integration-pp-port': 'proPresenterPort',
            'integration-pp-password': 'proPresenterPassword'
        };
        Object.keys(fieldMap).forEach((fieldId) => {
            const el = document.getElementById(fieldId);
            if (!el || el._integrationBound) return;
            el._integrationBound = true;
            const key = fieldMap[fieldId];
            el.addEventListener('input', () => {
                if (typeof settingsModule === 'undefined') return;
                const raw = el.value;
                // Strip surrounding whitespace; trim port too.
                const value = fieldId === 'integration-pp-password' ? raw : raw.trim();
                settingsModule.setSetting(key, value);
            });
        });
        // Esc to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const pp = document.getElementById('integration-pp-modal');
                const wt = document.getElementById('integration-wt-ext-modal');
                if (pp && !pp.classList.contains('hidden')) this.closeProPresenterModal();
                if (wt && !wt.classList.contains('hidden')) this.closeWorshipToolsExtModal();
            }
        });
    },

    // ── Modal: WorshipTools Extension ────────────────────────────────────

    openWorshipToolsExtModal() {
        const modal = document.getElementById('integration-wt-ext-modal');
        if (!modal) return;
        this._applyWorshipToolsExtState();
        modal.classList.remove('hidden');
    },

    closeWorshipToolsExtModal() {
        const modal = document.getElementById('integration-wt-ext-modal');
        if (modal) modal.classList.add('hidden');
    },

    async copyExtPath() {
        const extPath = window.location.origin + '/extensions/worshiptools-sync';
        try {
            await navigator.clipboard.writeText(extPath);
            this._showCopyFeedback('Pad gekopieerd!');
        } catch (_) {
            // Fallback: select text for manual copy
            const input = document.createElement('input');
            input.value = extPath;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            this._showCopyFeedback('Pad gekopieerd!');
        }
    },

    _showCopyFeedback(msg) {
        const status = document.getElementById('wt-ext-status');
        if (!status) return;
        status.innerHTML = `<div class='wt-ext-copied'>✓ ${msg}</div>`;
        setTimeout(() => { status.innerHTML = ''; }, 2000);
    },

    _applyWorshipToolsExtState() {
        const status = document.documentElement.dataset.ichtusBridge;
        const card = this.INTEGRATIONS.find(i => i.id === 'worshiptools-ext');
        if (!card) return;

        if (status === 'active' || status === 'loaded') {
            card.connected = true;
            card.accountName = status === 'active' ? 'Actief ✓' : 'Geladen...';
            card.actionLabel = 'Geïnstalleerd';
        } else {
            card.connected = false;
            card.accountName = '';
            card.actionLabel = 'Installeer';
        }
    },

    toggleProPresenterPasswordVisibility() {
        const field = document.getElementById('integration-pp-password');
        const toggle = document.getElementById('integration-pp-password-toggle');
        if (!field || !toggle) return;
        if (field.type === 'password') {
            field.type = 'text';
            toggle.textContent = '🙈';
        } else {
            field.type = 'password';
            toggle.textContent = '👁';
        }
    },

    async submitProPresenterConnection() {
        if (typeof settingsModule === 'undefined') return;

        const ip       = (document.getElementById('integration-pp-ip')?.value || '').trim();
        const port     = (document.getElementById('integration-pp-port')?.value || '').trim() || '50001';
        const password = document.getElementById('integration-pp-password')?.value || '';

        if (!ip) {
            this._showModalStatus('Vul een IP-adres in.', 'error');
            return;
        }

        const submitBtn = document.getElementById('integration-pp-submit');
        if (submitBtn) submitBtn.disabled = true;

        this._showModalStatus(`Verbinden met ${ip}:${port}…`, 'pending');

        // Persist user input FIRST — even if the probe fails we want the
        // last-typed values to survive across reloads.
        settingsModule.setSetting('proPresenterIp', ip);
        settingsModule.setSetting('proPresenterPort', port);
        if (password) {
            settingsModule.setSetting('proPresenterPassword', password);
        } else {
            // Empty password → clear the key so we don't ship a stale one.
            settingsModule.setSetting('proPresenterPassword', '');
        }

        const ok = await this._probeProPresenter(ip, port, password);
        if (ok) {
            this._lastProConnected = true;
            this._showModalStatus('✓ Verbonden. Gegevens opgeslagen.', 'success');
            this.render();
            setTimeout(() => this.closeProPresenterModal(), 600);
        } else {
            this._lastProConnected = false;
            this._showModalStatus(`✗ Niet bereikbaar (${ip}:${port}). Controleer IP en of ProPresenter draait.`, 'error');
            this.render();
        }

        if (submitBtn) submitBtn.disabled = false;
    },

    // Probes /v1/looks (exists in every ProPresenter version) using Basic
    // auth when a password is supplied. Returns boolean.
    async _probeProPresenter(ip, port, password) {
        try {
            const headers = {};
            if (password) {
                // ProPresenter's REST API uses HTTP Basic with user "API".
                headers['Authorization'] = 'Basic ' + this._base64('API:' + password);
            }
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`http://${ip}:${port}/v1/looks`, {
                method: 'GET',
                headers,
                signal: controller.signal
            });
            clearTimeout(t);
            return res.ok;
        } catch (err) {
            return false;
        }
    },

    _base64(str) {
        // Works in both browser and mixed-script contexts.
        try { return btoa(str); }
        catch { return Buffer.from(str).toString('base64'); }
    },

    _showModalStatus(message, type) {
        const el = document.getElementById('integration-pp-status');
        if (!el) return;
        el.style.display = 'block';
        el.textContent = message;
        el.className = `integration-pp-status status-${type}`;
    },

    // ── Card markup ─────────────────────────────────────────────────────
    _cardMarkup(item) {
        const iconClass = `int-icon-${item.iconTheme || 'slate'}`;
        const statusRow = item.connected && item.accountName
            ? `<div class="integration-card-status">
                 <span class="integration-dot"></span>
                 <span>${this._escape(item.accountName)}</span>
               </div>`
            : '';
        const titleRow = item.learnMoreUrl
            ? `<div class="integration-card-title-row">
                 <h3 class="integration-card-title">${this._escape(item.name)}</h3>
                 <a href="${this._escape(item.learnMoreUrl)}" class="integration-card-extlink" title="${this._escape(item.name)}">
                   <i class="fa-solid fa-arrow-up-right-from-square"></i>
                 </a>
               </div>`
            : `<h3 class="integration-card-title">${this._escape(item.name)}</h3>`;

        const tagline = item.tagline
            ? `<div class="integration-card-tagline">${this._escape(item.tagline)}</div>`
            : '';
        const btnClass = item.primaryAction ? 'integration-btn primary' : 'integration-btn';
        const chevron = `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

        return `
            <article class="integration-card" data-integration-id="${this._escape(item.id)}">
                <div>
                    <div class="integration-card-head">
                        <div class="integration-card-icon ${iconClass}">${this._escape(item.icon)}</div>
                        <div>
                            ${titleRow}
                            ${tagline}
                        </div>
                    </div>
                    <p class="integration-card-desc">${this._escape(item.description)}</p>
                </div>
                <div class="integration-card-footer">
                    ${statusRow}
                    <button type="button" class="${btnClass}" data-action="${this._escape(item.id)}">
                        <span>${this._escape(item.actionLabel)}</span>
                        ${chevron}
                    </button>
                </div>
            </article>
        `;
    },

    // Minimal HTML escape so user-facing strings can't break the layout.
    _escape(value) {
        if (value === undefined || value === null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};
