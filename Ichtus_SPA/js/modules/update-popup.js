/* ============================================
   Ichtus SPA — Update Popup
   Modal that surfaces a new server version,
   shows the changelog (commits since HEAD) and
   triggers `/api/update` to git-pull & restart.

   Styled to match the Ichtus liquid-glass theme:
     - Ichtus orange accent (#f47920)
     - Dark glass cards on backdrop blur
     - System fonts only (no custom typeface)
   ============================================ */

const updatePopup = {
    _seenVersion: null,            // localStorage key — dismissed version
    _pulling: false,
    _versionStorageKey: 'ichtus_update_dismissed',

    /**
     * Called by updateChecker when a fresh /api/check-update payload lands.
     * Surfaces the modal if the running version has changed since last dismissal.
     */
    show(payload) {
        if (!payload || !payload.update_available) return;
        if (this._pulling) return;

        // Surfaces the modal — version-badge shows the latest tag if present,
        // otherwise the latest reachable commit hash.
        const badge = payload.latest_tag || (payload.commits && payload.commits[0] && payload.commits[0].short) || 'nieuw';

        // User dismissed this exact version recently — don't pester them.
        if (this._seenVersion === badge && this._wasDismissedRecently()) return;

        this._render(payload, badge);
    },

    _wasDismissedRecently() {
        try {
            const raw = localStorage.getItem(this._versionStorageKey);
            if (!raw) return false;
            const { ts } = JSON.parse(raw);
            // Re-arm popup after 24h so genuinely new updates still surface
            return (Date.now() - ts) < 24 * 60 * 60 * 1000;
        } catch { return false; }
    },

    _render(payload, badge) {
        const modal = document.getElementById('ichtus-update-modal');
        if (!modal) return;

        const branchLabel = payload.branch ? `· ${payload.branch}` : '';
        const newVersionEl = modal.querySelector('[data-up-target="new-version"]');
        const versionLabelEl = modal.querySelector('[data-up-target="version-label"]');
        const subtitleEl = modal.querySelector('[data-up-target="subtitle"]');
        const changelogEl = modal.querySelector('[data-up-target="changelog"]');
        const detailEl = modal.querySelector('[data-up-target="detail"]');

        if (newVersionEl) newVersionEl.textContent = badge;
        if (versionLabelEl) versionLabelEl.textContent = `v${payload.current_version || '—'}`;
        if (subtitleEl) subtitleEl.textContent =
            `${payload.behind_count} nieuwe commit${payload.behind_count === 1 ? '' : 's'} ${branchLabel}`.trim();

        if (detailEl) {
            detailEl.textContent = payload.commits && payload.commits.length
                ? `${payload.commits.length} commit${payload.commits.length === 1 ? '' : 's'} klaargezet om te pullen.`
                : 'Server heeft wijzigingen die nog niet lokaal zijn.';
        }

        // Reset progress UI to a hidden state every time we re-open
        const progressContainer = modal.querySelector('[data-up-target="progress"]');
        const progressBar   = modal.querySelector('[data-up-target="progress-bar"]');
        const statusText    = modal.querySelector('[data-up-target="progress-status"]');
        const percentText   = modal.querySelector('[data-up-target="progress-percent"]');
        if (progressContainer) progressContainer.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        if (statusText) statusText.textContent = 'Pullen van repository…';
        if (percentText) percentText.textContent = '0%';

        if (changelogEl) {
            if (payload.commits && payload.commits.length) {
                changelogEl.innerHTML = `
                    <div class="up-changelog-title">Wat is er nieuw</div>
                    <ul class="up-changelog-list">
                        ${payload.commits.map((c) => `
                            <li>
                                <span class="up-commit-subject">${this._esc(c.subject)}</span>
                                <span class="up-commit-meta">
                                    <span class="up-commit-hash">${this._esc(c.short)}</span>
                                    <span class="up-commit-author">${this._esc(c.author)}</span>
                                </span>
                            </li>
                        `).join('')}
                    </ul>
                `;
            } else {
                changelogEl.innerHTML = `
                    <div class="up-changelog-title">Wat is er nieuw</div>
                    <div class="up-changelog-empty">Geen changelog beschikbaar voor deze update.</div>
                `;
            }
        }

        // Reset button state
        const updateBtn = modal.querySelector('[data-up-target="btn-update"]');
        const laterBtn  = modal.querySelector('[data-up-target="btn-later"]');
        if (updateBtn) { updateBtn.disabled = false; updateBtn.querySelector('span').textContent = 'Nu Pullen & Updaten'; }
        if (laterBtn)  { laterBtn.disabled = false; }

        modal.classList.remove('hidden');
    },

    close(dismiss = true) {
        const modal = document.getElementById('ichtus-update-modal');
        if (!modal) return;
        modal.classList.add('hidden');

        if (dismiss) {
            const badge = (modal.querySelector('[data-up-target="new-version"]') || {}).textContent || '';
            this._seenVersion = badge;
            try {
                localStorage.setItem(this._versionStorageKey, JSON.stringify({
                    ts: Date.now(),
                    version: badge,
                }));
            } catch { /* private mode */ }
        }
    },

    async startUpdate() {
        if (this._pulling) return;
        this._pulling = true;

        const modal = document.getElementById('ichtus-update-modal');
        if (!modal) { this._pulling = false; return; }

        const updateBtn = modal.querySelector('[data-up-target="btn-update"]');
        const laterBtn  = modal.querySelector('[data-up-target="btn-later"]');
        const progressContainer = modal.querySelector('[data-up-target="progress"]');
        const progressBar   = modal.querySelector('[data-up-target="progress-bar"]');
        const statusText    = modal.querySelector('[data-up-target="progress-status"]');
        const percentText   = modal.querySelector('[data-up-target="progress-percent"]');

        if (updateBtn) updateBtn.disabled = true;
        if (laterBtn)  laterBtn.disabled  = true;
        if (progressContainer) progressContainer.style.display = 'block';

        // First, animate the bar while we wait for the (potentially slow) git fetch/pull
        let visual = 0;
        const fake = setInterval(() => {
            visual = Math.min(visual + Math.floor(Math.random() * 8) + 4, 88);
            if (progressBar) progressBar.style.width = visual + '%';
            if (percentText) percentText.textContent = visual + '%';
            if (statusText && visual > 35 && visual <= 65) statusText.textContent = 'Bestanden ophalen…';
            else if (statusText && visual > 65) statusText.textContent = 'Code toepassen…';
        }, 320);

        try {
            const resp = await fetch('/api/update', { method: 'POST' });
            clearInterval(fake);

            const data = await resp.json().catch(() => ({}));

            if (!resp.ok || data.success === false) {
                // Prefer the actual git output for debugging — the generic
                // `message` field gets overridden by the server with
                // "git pull had fouten." which hides the real reason.
                // Strip leading `$` markers so the message stays short.
                const detail = (data.output || '').replace(/\n/g, ' ').trim();
                const fallback = data.message || `HTTP ${resp.status}`;
                const shown = (detail && detail !== 'git pull had fouten.')
                    ? `${fallback} — ${detail.slice(0, 220)}`
                    : fallback;
                this._fail(statusText, percentText, progressBar, shown);
                this._pulling = false;
                if (updateBtn) updateBtn.disabled = false;
                if (laterBtn)  laterBtn.disabled  = false;
                return;
            }

            // Flush to 100% and trigger restart
            if (progressBar) progressBar.style.width = '100%';
            if (percentText) percentText.textContent = '100%';
            if (statusText) {
                statusText.textContent = 'Klaar! Server herstarten…';
                statusText.classList.add('up-status-success');
            }

            // Tell the running node process (NSSM-managed) to restart itself
            try { await fetch('/api/restart-all', { method: 'POST' }); } catch { /* best-effort */ }

            this._pulling = false;

            // After a brief pause hide the modal and reload the page
            setTimeout(() => {
                this.close(false);
                window.location.reload();
            }, 1400);
        } catch (err) {
            clearInterval(fake);
            this._fail(statusText, percentText, progressBar, err.message || 'Netwerkfout');
            this._pulling = false;
            if (updateBtn) updateBtn.disabled = false;
            if (laterBtn)  laterBtn.disabled  = false;
        }
    },

    _fail(statusText, percentText, progressBar, message) {
        if (progressBar) progressBar.style.width = '100%';
        if (percentText) percentText.textContent = '✗';
        if (statusText) {
            statusText.textContent = `Mislukt: ${message}`;
            statusText.classList.remove('up-status-success');
            statusText.classList.add('up-status-fail');
        }
    },

    _esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /** Install the WebSocket listener. Idempotent. */
    bind() {
        if (this._bound) return;
        this._bound = true;

        // Server pushes `app:update` via the WS hub (see server.js +
        // startUpdatePolling). ws-client.js dispatches it as `ws:app:update`
        // on document. We show the modal directly from there so all
        // connected devices — not just the one whose updateChecker
        // polled last — see the popup the moment a new HEAD is detected.
        document.addEventListener('ws:app:update', (evt) => {
            const payload = evt && evt.detail;
            if (!payload) return;

            // Lifecycle states broadcast by /api/update
            if (payload.state === 'pulled') {
                this._onRemotePulled(payload);
                return;
            }
            if (payload.state === 'failed') {
                this._onRemoteFailed(payload);
                return;
            }
            // Default shape: a fresh update is available.
            this.show(payload);
        });

        // Expose `app:update-available` on window for ad-hoc triggers
        // (e.g. a future "check now" button in the Settings view).
        window.addEventListener('app:update-available', (evt) => {
            const payload = evt && evt.detail;
            if (payload) this.show(payload);
        });
    },

    /**
     * One tab already pressed "Nu Pullen & Updaten" — the server has
     * finished `git pull` and broadcast `state: 'pulled'`. Make this
     * client reload too so we pick up the fresh code without forcing
     * every device to click the button themselves.
     */
    _onRemotePulled(payload) {
        // If this tab was the one that pulled, pop-up already reloads.
        // Otherwise show a short notice then reload (gives user context).
        if (this._pulling) return; // we initiated it — let startUpdate() reload
        this._showTransient('Update geïnstalleerd — pagina wordt ververst…', '#00a651');
    },

    /** Companion device saw a failed pull on the originating device. */
    _onRemoteFailed(payload) {
        if (this._pulling) return;
        this._showTransient(`Update mislukt op andere apparaat: ${payload.message || 'onbekend'}`, '#ed1c24');
    },

    /** Tiny auto-dismissing toast to give context before a reload. */
    _showTransient(text, accent) {
        let toast = document.getElementById('ichtus-update-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ichtus-update-toast';
            toast.className = 'ichtus-update-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = text;
        toast.style.borderColor = accent || '#f47920';
        toast.classList.remove('hidden');
        toast.classList.add('visible');
        setTimeout(() => {
            toast.classList.remove('visible');
            toast.classList.add('hidden');
            // Reload so this client picks up the freshly-pulled code.
            window.location.reload();
        }, 1600);
    },
};

// Install the listener as soon as the module loads — runs on every page.
updatePopup.bind();

window.updatePopup = updatePopup;
