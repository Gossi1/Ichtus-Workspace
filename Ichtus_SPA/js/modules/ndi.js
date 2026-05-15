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
            statusEl.textContent = __('ndi_searching');
            statusEl.className = 'ndi-status searching';
        }

        try {
            // Add timeout to prevent hanging requests
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch('/api/ndi/sources', { signal: controller.signal });
            clearTimeout(timeout);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.sources = data.sources || [];
            this.lastDiscovery = new Date();
            
            this.renderSources();
            
            if (statusEl) {
                if (this.sources.length === 0) {
                    statusEl.textContent = __('ndi_none_found');
                    statusEl.className = 'ndi-status none';
                } else {
                    statusEl.textContent = `${this.sources.length} ${this.sources.length !== 1 ? __('ndi_sources_found') : __('ndi_source_found')}`;
                    statusEl.className = 'ndi-status found';
                }
            }
        } catch (error) {
            console.error('NDI discovery error:', error);
            if (statusEl) {
                statusEl.textContent = __('ndi_error') + error.message;
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
                    <div class='ndi-empty-text'>${__('ndi_empty_text')}</div>
                    <div class='ndi-empty-hint'>${__('ndi_empty_hint')}</div>
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
                            <span class='ndi-source-ip'>${this.escapeHtml(source.address || __('ndi_unknown'))}</span>
                            ${source.type ? `<span class='ndi-source-type'>${this.escapeHtml(source.type)}</span>` : ''}
                        </div>
                        ${source.metadata ? `<div class='ndi-source-meta'>${this.escapeHtml(source.metadata)}</div>` : ''}
                    </div>
                    <div class='ndi-source-actions'>
                        <button class='ndi-action-btn' onclick='ndiModule.copyToClipboard(\"${this.escapeHtml(source.name)}\")' title='${__('ndi_copy_title')}'>
                            📋
                        </button>
                        <button class='ndi-action-btn' onclick='ndiModule.showSourceDetails(${index})' title='${__('ndi_details_title')}'>
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
                <div class='ndi-error-text'>${__('ndi_conn_error')}</div>
                <div class='ndi-error-hint'>${__('ndi_conn_hint')}</div>
                <button class='ndi-retry-btn' onclick='ndiModule.refreshSources()'>${__('ndi_retry')}</button>
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
            this.showToast(__('ndi_copied') + text);
        }).catch(err => {
            console.error('Copy failed:', err);
        });
    },

    showSourceDetails(index) {
        const source = this.sources[index];
        if (!source) return;

        const details = `${__('ndi_details_header')}
${'─'.repeat(18)}
${__('ndi_details_name')}: ${source.name}
${__('ndi_details_ip')}: ${source.address || __('ndi_unknown')}
${__('ndi_details_port')}: ${source.port || __('ndi_default_port')}
${__('ndi_details_type')}: ${source.type || __('ndi_unknown')}
${source.metadata ? `${__('ndi_details_extra')}: ${source.metadata}` : ''}
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