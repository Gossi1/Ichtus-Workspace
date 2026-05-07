/* ============================================
   NDI Source Discovery Module
   Finds all NDI sources on the network
   ============================================ */

const ndiModule = {
    sources: [],
    pollingInterval: null,
    lastDiscovery: null,

    init() {
        console.log('NDI Module initialized');
        this.bindEvents();
        this.refreshSources();
    },

    bindEvents() {
        const refreshBtn = document.getElementById('ndi-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshSources());
        }

        const autoRefresh = document.getElementById('ndi-auto-refresh');
        if (autoRefresh) {
            autoRefresh.addEventListener('change', (e) => this.toggleAutoRefresh(e.target.checked));
        }
    },

    async refreshSources() {
        const statusEl = document.getElementById('ndi-status');
        const listEl = document.getElementById('ndi-source-list');
        
        if (statusEl) {
            statusEl.textContent = 'Zoeken naar NDI bronnen...';
            statusEl.className = 'ndi-status searching';
        }

        try {
            const response = await fetch('/api/ndi/sources');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.sources = data.sources || [];
            this.lastDiscovery = new Date();
            
            this.renderSources();
            
            if (statusEl) {
                if (this.sources.length === 0) {
                    statusEl.textContent = 'Geen NDI bronnen gevonden';
                    statusEl.className = 'ndi-status none';
                } else {
                    statusEl.textContent = `${this.sources.length} bron${this.sources.length !== 1 ? 'nen' : ''} gevonden`;
                    statusEl.className = 'ndi-status found';
                }
            }
        } catch (error) {
            console.error('NDI discovery error:', error);
            if (statusEl) {
                statusEl.textContent = 'Fout bij zoeken: ' + error.message;
                statusEl.className = 'ndi-status error';
            }
            this.renderError();
        }
    },

    renderSources() {
        const listEl = document.getElementById('ndi-source-list');
        if (!listEl) return;

        if (this.sources.length === 0) {
            listEl.innerHTML = `
                <div class='ndi-empty'>
                    <div class='ndi-empty-icon'>📡</div>
                    <div class='ndi-empty-text'>Geen NDI bronnen actief op dit netwerk</div>
                    <div class='ndi-empty-hint'>Zorg dat NDI bronnen actief zijn (bijv. NDI Tools, ProPresenter, vMix)</div>
                </div>
            `;
            return;
        }

        let html = '';
        this.sources.forEach((source, index) => {
            const icon = this.getSourceIcon(source.type);
            html += `
                <div class='ndi-source-card' data-index='${index}'>
                    <div class='ndi-source-icon'>${icon}</div>
                    <div class='ndi-source-info'>
                        <div class='ndi-source-name'>${this.escapeHtml(source.name)}</div>
                        <div class='ndi-source-details'>
                            <span class='ndi-source-ip'>${this.escapeHtml(source.address || 'Onbekend')}</span>
                            ${source.type ? `<span class='ndi-source-type'>${this.escapeHtml(source.type)}</span>` : ''}
                        </div>
                        ${source.metadata ? `<div class='ndi-source-meta'>${this.escapeHtml(source.metadata)}</div>` : ''}
                    </div>
                    <div class='ndi-source-actions'>
                        <button class='ndi-action-btn' onclick='ndiModule.copyToClipboard(\"${this.escapeHtml(source.name)}\")' title='Kopieer naam'>
                            📋
                        </button>
                        <button class='ndi-action-btn' onclick='ndiModule.showSourceDetails(${index})' title='Details'>
                            ℹ️
                        </button>
                    </div>
                </div>
            `;
        });

        listEl.innerHTML = html;
    },

    renderError() {
        const listEl = document.getElementById('ndi-source-list');
        if (!listEl) return;

        listEl.innerHTML = `
            <div class='ndi-error'>
                <div class='ndi-error-icon'>⚠️</div>
                <div class='ndi-error-text'>Kon geen verbinding maken met de server</div>
                <div class='ndi-error-hint'>Controleer of de server draait met NDI ondersteuning</div>
                <button class='ndi-retry-btn' onclick='ndiModule.refreshSources()'>Opnieuw proberen</button>
            </div>
        `;
    },

    getSourceIcon(type) {
        // NDI sources typically broadcast on specific ports
        if (type && type.toLowerCase().includes('video')) return '📹';
        if (type && type.toLowerCase().includes('audio')) return '🔊';
        if (type && type.toLowerCase().includes('presentation')) return '🖥️';
        return '📺';
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    toggleAutoRefresh(enabled) {
        if (enabled) {
            this.pollingInterval = setInterval(() => this.refreshSources(), 5000);
        } else {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
        }
    },

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast(`Gekopieerd: ${text}`);
        }).catch(err => {
            console.error('Copy failed:', err);
        });
    },

    showSourceDetails(index) {
        const source = this.sources[index];
        if (!source) return;

        const details = `
NDI Source Details
──────────────────
Naam: ${source.name}
IP Adres: ${source.address || 'Onbekend'}
Poort: ${source.port || 'NDI default'}
Type: ${source.type || 'Onbekend'}
${source.metadata ? `Extra: ${source.metadata}` : ''}
        `.trim();

        alert(details);
    },

    showToast(message) {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'ndi-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Animate in
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove after delay
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    },

    // Called when view is navigated away
    cleanup() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
};