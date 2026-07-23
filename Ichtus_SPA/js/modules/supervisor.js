/* ============================================
   Ichtus SPA — Supervisor Module
   Live status dashboard for the service supervisor
   Fetches from http://localhost:9090/api/status
   ============================================ */

const supervisorModule = {
    initialized: false,
    _lastView: null,
    _pollInterval: null,
    _servicesCache: [],

    init() {
        if (this.initialized && this._lastView === 'supervisor') return;

        // Cleanup previous poll if re-initializing
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }

        this.initialized = true;
        this._lastView = 'supervisor';

        // Render initial skeleton then start polling
        this._render();
        this._poll();

        // Poll every 5 seconds (only while this view is active)
        this._pollInterval = setInterval(() => {
            if (router.isSupervisorActive()) {
                this._poll();
            }
        }, 5000);
    },

    cleanup() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        this._lastView = null;
    },

    async _poll() {
        try {
            const resp = await fetch('http://localhost:9090/api/status');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this._servicesCache = data.services || [];
            this._render();
        } catch (err) {
            this._renderError(err);
        }
    },

    async _restartService(key) {
        const btn = document.querySelector(`.sv-btn-restart[data-key="${key}"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '…';
        }
        try {
            const resp = await fetch(`http://localhost:9090/api/restart/${key}`, { method: 'POST' });
            const data = await resp.json();
            // Wait a moment then refresh status
            setTimeout(() => this._poll(), 2000);
        } catch (err) {
            console.warn('[Supervisor] Restart failed:', err);
        }
        setTimeout(() => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Herstart';
            }
        }, 3000);
    },

    async _viewLogs(key) {
        const modal = document.getElementById('sv-log-modal');
        const content = document.getElementById('sv-log-content');
        const title = document.getElementById('sv-log-title');
        if (!modal || !content || !title) return;

        const labels = { spa: 'SPA HTTP server', x32: 'X32 OSC bridge', mic_iem: 'Mic & IEM monitor' };
        title.textContent = `Logs — ${labels[key] || key}`;
        content.innerHTML = '<div class="sv-log-loading">Logs laden…</div>';
        modal.classList.remove('hidden');

        try {
            const resp = await fetch(`http://localhost:9090/api/logs/${key}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const tail = data.tail || [];
            if (tail.length === 0) {
                content.innerHTML = '<div class="sv-log-empty">Geen log entries</div>';
            } else {
                content.innerHTML = '<div class="sv-log-list">' +
                    tail.map(entry =>
                        `<div class="sv-log-line">
                            <span class="sv-log-ts">${entry.ts || ''}</span>
                            <span class="sv-log-msg">${this._escapeHtml(entry.line || '')}</span>
                        </div>`
                    ).join('') +
                    '</div>';
                // Auto-scroll to bottom
                content.scrollTop = content.scrollHeight;
            }
        } catch (err) {
            content.innerHTML = `<div class="sv-log-error">Fout bij laden: ${this._escapeHtml(err.message)}</div>`;
        }
    },

    _closeLogModal() {
        const modal = document.getElementById('sv-log-modal');
        if (modal) modal.classList.add('hidden');
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _render() {
        const container = document.getElementById('sv-services-container');
        if (!container) return;
        container.innerHTML = '';

        if (this._servicesCache.length === 0) {
            container.innerHTML = '<div class="sv-empty">Geen services gevonden</div>';
            return;
        }

        this._servicesCache.forEach(svc => {
            const card = document.createElement('div');
            card.className = 'sv-card';

            const stateClass = svc.state === 'running' ? 'sv-state-running' :
                               svc.state === 'backoff' ? 'sv-state-backoff' :
                               'sv-state-stopped';

            const stateLabel = svc.state === 'running' ? '🟢 Actief' :
                               svc.state === 'backoff' ? '🟠 Herstarten…' :
                               svc.state === 'starting' ? '🔵 Opstarten…' :
                               '🔴 Gestopt';

            const uptimeStr = svc.uptime_sec > 0 ?
                this._formatUptime(svc.uptime_sec) : '—';

            card.innerHTML = `
                <div class="sv-card-header">
                    <div class="sv-card-title">${this._escapeHtml(svc.label)}</div>
                    <div class="sv-card-state ${stateClass}">${stateLabel}</div>
                </div>
                <div class="sv-card-body">
                    <div class="sv-metrics">
                        <div class="sv-metric">
                            <span class="sv-metric-label">Poort</span>
                            <span class="sv-metric-value">${svc.default_port}</span>
                        </div>
                        <div class="sv-metric">
                            <span class="sv-metric-label">PID</span>
                            <span class="sv-metric-value">${svc.pid || '—'}</span>
                        </div>
                        <div class="sv-metric">
                            <span class="sv-metric-label">Uptime</span>
                            <span class="sv-metric-value">${uptimeStr}</span>
                        </div>
                        <div class="sv-metric">
                            <span class="sv-metric-label">Herstarts</span>
                            <span class="sv-metric-value">${svc.restart_count || 0}</span>
                        </div>
                    </div>
                    <div class="sv-actions">
                        <button class="sv-btn sv-btn-restart" data-key="${svc.key}" onclick="supervisorModule._restartService('${svc.key}')">Herstart</button>
                        <button class="sv-btn sv-btn-logs" onclick="supervisorModule._viewLogs('${svc.key}')">📋 Logs</button>
                    </div>
                </div>
            `;

            container.appendChild(card);
        });
    },

    _renderError(err) {
        const container = document.getElementById('sv-services-container');
        if (!container) return;
        container.innerHTML = `
            <div class="sv-error">
                <div class="sv-error-icon">⚠️</div>
                <div class="sv-error-text">
                    <strong>Kan geen verbinding maken met supervisor</strong><br>
                    <span>${this._escapeHtml(err.message)}</span><br><br>
                    Controleer of de supervisor service draait:<br>
                    <code>nssm status IchtusSupervisor</code><br>
                    of open <a href="http://localhost:9090/" target="_blank" rel="noopener">http://localhost:9090/</a>
                </div>
                <button class="sv-btn sv-btn-retry" onclick="supervisorModule._poll()">🔄 Opnieuw proberen</button>
            </div>
        `;
    },

    _formatUptime(sec) {
        if (sec < 60) return `${sec}s`;
        if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}u ${m}m`;
    }
};
