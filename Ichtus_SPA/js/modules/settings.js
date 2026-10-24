// ── Global update checker ──
// Periodically polls the server for git updates and shows a badge on the Settings nav item.
const updateChecker = {
    _interval: null,
    _checkIntervalMs: 5 * 60 * 1000, // 5 minutes

    start() {
        if (this._interval) return;
        setTimeout(() => this._check(), 3000);
        this._interval = setInterval(() => this._check(), this._checkIntervalMs);
    },

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    },

    async _check() {
        try {
            const resp = await fetch('/api/check-update');
            if (!resp.ok) return;
            const data = await resp.json();
            this._updateBadges(data.update_available, data.behind_count);

            if (data.update_available && window.updatePopup && window.updatePopup.show) {
                window.updatePopup.show(data);
            }
        } catch (err) {
            this._updateBadges(false);
        }
    },

    _updateBadges(available, count) {
        const badge = document.getElementById('badge-settings');
        if (!badge) return;
        if (available) {
            badge.classList.remove('hidden');
            badge.textContent = (count > 0) ? '⬆' + count : '⬆';
        } else {
            badge.classList.add('hidden');
        }
    },

    forceCheck() {
        this._check();
    },

    clearBadges() {
        this._updateBadges(false);
    }
};

window.updateChecker = updateChecker;

// Settings Module for Ichtus Workspace
const settingsModule = {
    initialized: false,
    _statusPollInterval: null,
    
    // Version information
    appVersion: null,
    latestGitHubVersion: null,
    versionError: null,
    
    // Default settings
    defaults: {
        language: 'nl',
        offlineMode: false,
        ndiAutoDiscovery: true,
        ndiPreviewQuality: 'medium', // low, medium, high
        clockFormat: '24h', // 12h or 24h
        dateFormat: 'DD-MM-YYYY', // DD-MM-YYYY or MM-DD-YYYY
        showDebugPanel: false,
        proPresenterIp: '127.0.0.1',
        proPresenterPort: '50001',
        proPresenterPassword: '',
        calendarIcsUrl: 'https://tockify.com/api/feeds/ics/ichtus',
        // Sidebar app visibility - all apps visible by default
        sidebarApps: {
            dashboard: true,
            agenda: true,
            checklist: true,
            patchbay: true,
            analytics: true,
            setlist: true,
            ndi: true,
            stagebuilder: true,
            songidassigner: true,
            settings: true
        }
    },

    // Current settings (loaded from localStorage)
    settings: {},

    init() {
        this.loadSettings();
        this.loadAppVersion();
        this.fetchLatestGitHubVersion();
        this.render();
        this.applySettings();
        this.fetchServerStatus();

        if (this._statusPollInterval) clearInterval(this._statusPollInterval);
        this._statusPollInterval = setInterval(() => {
            if (typeof router !== 'undefined' && router.isSettingsActive && router.isSettingsActive()) {
                this.fetchServerStatus();
            }
        }, 5000);
    },

    cleanup() {
        if (this._statusPollInterval) {
            clearInterval(this._statusPollInterval);
            this._statusPollInterval = null;
        }
    },

    // The X32 Library configuration lived here in earlier revisions;
    // it was relocated into the Stage Builder view (open via the
    // 🎚️ button next to the gear icon) so a single workspace
    // owns the operator-chosen name + library-slot ID pairs.
    loadSettings() {
        const saved = localStorage.getItem('ichtus_settings');
        if (saved) {
            try {
                this.settings = { ...this.defaults, ...JSON.parse(saved) };
            } catch (e) {
                this.settings = { ...this.defaults };
            }
        } else {
            this.settings = { ...this.defaults };
        }
    },
    
    saveSettings() {
        localStorage.setItem('ichtus_settings', JSON.stringify(this.settings));
        this.applySettings();
    },
    
    getSetting(key) {
        return this.settings[key] !== undefined ? this.settings[key] : this.defaults[key];
    },
    
    setSetting(key, value) {
        this.settings[key] = value;
        // If language changed, update i18n and re-render all views
        if (key === 'language') {
            if (typeof i18n !== 'undefined') {
                i18n.setLang(value);
            }
            // Re-render all visible views when language changes
            this.saveSettings();
            this.render();
            if (typeof router !== 'undefined' && router.currentView) {
                router.navigate(router.currentView);
            }
            location.reload(); // Full reload to refresh all strings
            return;
        }
        // Keep legacy setlistProIp in sync for backward compatibility
        if (key === 'proPresenterIp' || key === 'proPresenterPort') {
            const ip = key === 'proPresenterIp' ? value : this.getSetting('proPresenterIp');
            const port = key === 'proPresenterPort' ? value : this.getSetting('proPresenterPort');
            localStorage.setItem('setlistProIp', `${ip}:${port}`);
        }
        this.saveSettings();
        this.render(); // Re-render to update UI
        this.showToast(__('toast_saved'));
    },
    
    applySettings() {
        // Apply i18n language
        if (typeof i18n !== 'undefined') {
            const lang = this.getSetting('language');
            if (lang && i18n.lang !== lang) {
                i18n.setLang(lang);
            } else if (lang) {
                i18n.lang = lang;
            } else {
                // Default to Dutch
                this.settings.language = 'nl';
                i18n.lang = 'nl';
            }
        }
        
        // Apply clock format globally
        window.ClockFormat = this.getSetting('clockFormat');
        window.DateFormat = this.getSetting('dateFormat');
        
        // Apply NDI settings
        if (ndiModule) {
            if (!this.getSetting('ndiAutoDiscovery')) {
                ndiModule.stopAutoRefresh();
            } else {
                ndiModule.startAutoRefresh();
            }
        }
        
        // Apply debug panel visibility
        const debugPanel = document.getElementById('debug-panel');
        if (debugPanel) {
            debugPanel.style.display = this.getSetting('showDebugPanel') ? 'block' : 'none';
        }
        
        // Apply offline mode - update app behavior
        window.OfflineMode = this.getSetting('offlineMode');

        // Apply sidebar visibility
        this.applySidebarVisibility();
    },

    loadAppVersion() {
        fetch('../Ichtus_SPA/version.json?t=' + Date.now(), { cache: 'no-store' })
            .then(response => response.json())
            .then(data => {
                this.appVersion = data.version || '1.0.0';
                this.render(); // Re-render when version loaded
                if (this.latestGitHubVersion && this.compareVersions(this.latestGitHubVersion, this.appVersion) > 0) {
                    if (window.updateChecker) window.updateChecker._updateBadges(true, 1);
                    if (window.updatePopup && window.updatePopup.show) {
                        window.updatePopup.show(this._buildGitHubUpdatePayload(), false);
                    }
                }
            })
            .catch(error => {
                console.warn('Could not load version.json:', error);
                this.appVersion = '1.0.0';
                this.render(); // Re-render even on error
            });
    },

    fetchLatestGitHubVersion() {
        fetch('https://api.github.com/repos/Gossi1/Ichtus-Workspace/releases/latest')
            .then(response => {
                if (!response.ok) throw new Error('GitHub API error');
                return response.json();
            })
            .then(data => {
                if (data.tag_name) {
                    this.latestGitHubVersion = data.tag_name.replace(/^v/, '');
                    this.latestGitHubReleaseNotes = data.body || '';
                }
                this.render(); // Re-render when GitHub version loaded
                if (this.latestGitHubVersion && this.appVersion && this.compareVersions(this.latestGitHubVersion, this.appVersion) > 0) {
                    if (window.updateChecker) window.updateChecker._updateBadges(true, 1);
                    if (window.updatePopup && window.updatePopup.show) {
                        window.updatePopup.show(this._buildGitHubUpdatePayload(), false);
                    }
                }
            })
            .catch(error => {
                console.warn('Could not fetch latest GitHub release:', error);
                this.versionError = __('settings_version_github_error');
                this.render(); // Re-render even on error
            });
    },

    _buildGitHubUpdatePayload() {
        const tag = 'v' + (this.latestGitHubVersion || '');
        return {
            update_available: true,
            behind_count: 1,
            branch: 'release',
            current_version: this.appVersion || '1.0.0',
            latest_tag: tag,
            commits: [
                {
                    short: tag,
                    subject: this.latestGitHubReleaseNotes || ('Nieuwe release ' + tag + ' beschikbaar op GitHub'),
                    author: 'GitHub Release'
                }
            ]
        };
    },

    openUpdateScreen(customPayload) {
        if (customPayload && customPayload.update_available && window.updatePopup && window.updatePopup.show) {
            window.updatePopup.show(customPayload, true);
            return;
        }
        fetch('/api/check-update')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data && data.update_available && window.updatePopup && window.updatePopup.show) {
                    window.updatePopup.show(data, true);
                } else if (this.latestGitHubVersion && this.compareVersions(this.latestGitHubVersion, this.appVersion) > 0 && window.updatePopup && window.updatePopup.show) {
                    window.updatePopup.show(this._buildGitHubUpdatePayload(), true);
                }
            })
            .catch(() => {
                if (this.latestGitHubVersion && this.compareVersions(this.latestGitHubVersion, this.appVersion) > 0 && window.updatePopup && window.updatePopup.show) {
                    window.updatePopup.show(this._buildGitHubUpdatePayload(), true);
                }
            });
    },

    checkForUpdates() {
        // Also trigger the global update checker to sync sidebar badges
        if (window.updateChecker) {
            window.updateChecker.forceCheck();
        }

        const btn = document.getElementById('btn-check-updates');
        const statusEl = document.getElementById('settings-update-status');
        if (!btn || !statusEl) return;

        btn.disabled = true;
        btn.textContent = '⏳ Controleren...';
        statusEl.style.display = 'none';

        fetch('/api/check-update')
            .then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(data => {
                if (data.update_available) {
                    btn.textContent = '🔄 Check voor updates';
                    statusEl.className = 'update-notification-tag';
                    statusEl.textContent = '⬆️ Update beschikbaar (' + data.behind_count + ' commits achter) — Klik om te updaten';
                    statusEl.style.cursor = 'pointer';
                    statusEl.onclick = () => this.openUpdateScreen(data);
                    statusEl.style.display = 'inline-block';
                    this.openUpdateScreen(data);
                } else if (this.latestGitHubVersion && this.compareVersions(this.latestGitHubVersion, this.appVersion) > 0) {
                    btn.textContent = '🔄 Check voor updates';
                    statusEl.className = 'update-notification-tag';
                    statusEl.textContent = '⬆️ Release v' + this.latestGitHubVersion + ' beschikbaar — Klik om te updaten';
                    statusEl.style.cursor = 'pointer';
                    statusEl.onclick = () => this.openUpdateScreen(this._buildGitHubUpdatePayload());
                    statusEl.style.display = 'inline-block';
                    this.openUpdateScreen(this._buildGitHubUpdatePayload());
                } else {
                    btn.textContent = '🔄 Check voor updates';
                    statusEl.className = 'update-notification-tag';
                    statusEl.textContent = '✓ Up-to-date';
                    statusEl.style.cursor = '';
                    statusEl.onclick = null;
                    statusEl.style.display = 'inline-block';
                }
                btn.disabled = false;
            })
            .catch(error => {
                console.warn('Update check failed:', error);
                btn.textContent = '🔄 Check voor updates';
                statusEl.className = 'update-notification-tag';
                statusEl.textContent = '⚠️ Kon server niet bereiken';
                statusEl.style.display = 'inline-block';
                btn.disabled = false;
            });
    },

    compareVersions(version1, version2) {
        if (!version1 || !version2) return 0;
        const parts1 = version1.split('.').map(Number);
        const parts2 = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const part1 = parts1[i] || 0;
            const part2 = parts2[i] || 0;
            if (part1 > part2) return 1;
            if (part1 < part2) return -1;
        }
        return 0;
    },

    render() {
        // Format preview based on settings
        const sampleDate = new Date(2024, 11, 25, 14, 30); // Dec 25, 2024, 14:30
        
        // ==========================================
        // 1. Language
        // ==========================================
        const langSelect = document.getElementById('settings-language-select');
        if (langSelect) {
            langSelect.value = this.getSetting('language') || 'nl';
        }

        // ==========================================
        // 2. Network & Sync
        // ==========================================
        const ipInput = document.getElementById('settings-pro-ip');
        const portInput = document.getElementById('settings-pro-port');
        if (ipInput) ipInput.value = this.getSetting('proPresenterIp');
        if (portInput) portInput.value = this.getSetting('proPresenterPort');

        const offlineToggle = document.getElementById('settings-offline-mode');
        if (offlineToggle) offlineToggle.checked = this.getSetting('offlineMode');

        const debugToggle = document.getElementById('settings-debug-panel');
        if (debugToggle) debugToggle.checked = this.getSetting('showDebugPanel');

        // ==========================================
        // 3. NDI Video
        // ==========================================
        const ndiToggle = document.getElementById('settings-ndi-auto-discovery');
        if (ndiToggle) ndiToggle.checked = this.getSetting('ndiAutoDiscovery');

        const ndiQuality = document.getElementById('settings-ndi-quality');
        if (ndiQuality) ndiQuality.value = this.getSetting('ndiPreviewQuality');

        // ==========================================
        // 4. Display
        // ==========================================
        const clockSelect = document.getElementById('settings-clock-format');
        if (clockSelect) clockSelect.value = this.getSetting('clockFormat');

        const dateSelect = document.getElementById('settings-date-format');
        if (dateSelect) dateSelect.value = this.getSetting('dateFormat');

        const clockDesc = document.getElementById('settings-clock-desc');
        if (clockDesc) clockDesc.textContent = __('settings_clock_desc') + ': ' + this.formatTimeSample(14, 30);

        const dateDesc = document.getElementById('settings-date-desc');
        if (dateDesc) dateDesc.textContent = __('settings_date_desc') + ': ' + this.formatDateSample(sampleDate);

        // ==========================================
        // 5. App Info
        // ==========================================
        const versionEl = document.getElementById('settings-app-version');
        if (versionEl) versionEl.textContent = this.appVersion || '1.0.0';

        const updateEl = document.getElementById('settings-update-notification');
        const updateText = document.getElementById('settings-update-text');
        if (updateEl && updateText) {
            if (this.latestGitHubVersion && this.compareVersions(this.latestGitHubVersion, this.appVersion) > 0) {
                updateEl.style.display = '';
                updateEl.style.cursor = 'pointer';
                updateEl.title = 'Klik om het update-scherm te openen';
                updateEl.onclick = () => this.openUpdateScreen(this._buildGitHubUpdatePayload());
                updateText.textContent = '⬆️ ' + __('settings_version_update_available') + ': ' + this.latestGitHubVersion + ' (Nu updaten)';
            } else if (this.latestGitHubVersion) {
                updateEl.style.display = '';
                updateEl.style.cursor = '';
                updateEl.title = '';
                updateEl.onclick = null;
                updateText.textContent = '✓ ' + __('settings_version_latest');
            } else {
                updateEl.style.display = 'none';
            }
        }

        const offlineBadge = document.getElementById('settings-offline-badge');
        if (offlineBadge) {
            if (this.getSetting('offlineMode')) {
                offlineBadge.className = 'status-badge status-ok';
                offlineBadge.textContent = '✓ ' + __('settings_active');
            } else {
                offlineBadge.className = 'status-badge status-off';
                offlineBadge.textContent = '✗ ' + __('settings_inactive');
            }
        }

        const calendarFeedInput = document.getElementById('settings-calendar-feed-input');
        if (calendarFeedInput) {
            calendarFeedInput.value = this.getSetting('calendarIcsUrl') || 'https://tockify.com/api/feeds/ics/ichtus';
        }

        // ==========================================
        // 6. Sidebar Customization
        // ==========================================
        this.renderSidebarCustomization();

        // ==========================================
        // 7. Debug panel
        // ==========================================
        this.renderDebugPanel();

        // The X32 Library Map editor used to live in this render() body
        // until the move-to-Stage-Builder pivot in this revision; the
        // 🎚️ button on the Stage Builder header now owns the editor.

    },

    formatDateSample(date) {
        const format = this.getSetting('dateFormat');
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        
        if (format === 'MM-DD-YYYY') {
            return `${month}-${day}-${year}`;
        }
        return `${day}-${month}-${year}`;
    },
    
    formatTimeSample(hours, minutes) {
        const format = this.getSetting('clockFormat');
        const h = hours % 12 || 12;
        const ampm = hours >= 12 ? ' PM' : ' AM';
        
        if (format === '12h') {
            return `${h}:${String(minutes).padStart(2, '0')}${ampm}`;
        }
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    },
    
    renderSidebarCustomization() {
        const container = document.getElementById('settings-sidebar-apps');
        if (!container) return;

        const sidebarApps = this.getSetting('sidebarApps') || this.defaults.sidebarApps;
        const appNames = [
            { key: 'dashboard', label: __('nav_dashboard'), icon: '📊' },
            { key: 'agenda', label: __('nav_agenda'), icon: '📅' },
            { key: 'checklist', label: __('nav_checklist'), icon: '✅' },
            { key: 'patchbay', label: __('nav_patchbay'), icon: '🔌' },
            { key: 'analytics', label: __('nav_analytics'), icon: '📈' },
            { key: 'setlist', label: __('nav_setlist'), icon: '🎵' },
            { key: 'ndi', label: __('nav_ndi'), icon: '📡' },
            { key: 'stagebuilder', label: __('nav_stagebuilder'), icon: '🎭' },
            { key: 'songidassigner', label: __('nav_songids'), icon: '🎹' }
            // Settings intentionally excluded — always visible, not user-configurable
        ];

        container.innerHTML = appNames.map(app => {
            const isLocked = app.key === 'settings'; // Settings always visible
            const isVisible = isLocked || sidebarApps[app.key] !== false;
            return `
                <div class="sidebar-app-item${isLocked ? ' sidebar-app-locked' : ''}">
                    <div class="sidebar-app-info">
                        <span class="sidebar-app-icon">${app.icon}</span>
                        <span class="sidebar-app-name">${app.label}</span>
                        ${isLocked ? '<span class="sidebar-app-locked-tag">altijd aan</span>' : ''}
                    </div>
                    <label class="toggle-item-switch">
                        <input type="checkbox" 
                               ${isVisible ? 'checked' : ''} 
                               ${isLocked ? 'disabled' : ''}
                               onchange="settingsModule.toggleSidebarApp('${app.key}', this.checked)">
                        <span class="toggle-slider-engine"></span>
                    </label>
                </div>
            `;
        }).join('');
    },

    toggleSidebarApp(appKey, isVisible) {
        if (appKey === 'settings') return; // Settings cannot be disabled
        let sidebarApps = this.getSetting('sidebarApps') || { ...this.defaults.sidebarApps };
        sidebarApps[appKey] = isVisible;
        this.settings.sidebarApps = sidebarApps;
        this.saveSettings();
        this.applySidebarVisibility();
    },

    applySidebarVisibility() {
        const sidebarApps = this.getSetting('sidebarApps') || this.defaults.sidebarApps;
        const sidebarItems = document.querySelectorAll('#ichtus-sidebar .sidebar-menu li[data-view]');
        
        sidebarItems.forEach(item => {
            const view = item.getAttribute('data-view');
            if (view === 'settings') return; // Settings always visible
            if (view && sidebarApps[view] === false) {
                item.classList.add('hidden');
                item.style.display = 'none';
            } else {
                item.classList.remove('hidden');
                item.style.display = '';
            }
        });
    },

    renderDebugPanel() {
        // Create debug panel if it doesn't exist
        if (!document.getElementById('debug-panel')) {
            const panel = document.createElement('div');
            panel.id = 'debug-panel';
            panel.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#1a1a2e;color:#00ff88;padding:10px;font-family:monospace;font-size:12px;z-index:9999;max-height:200px;overflow:auto;';
            panel.innerHTML = '<strong>🐛 DEBUG PANEL</strong><br>';
            document.body.appendChild(panel);
        }
        
        const panel = document.getElementById('debug-panel');
        if (this.getSetting('showDebugPanel')) {
            const online = navigator.onLine ? '🟢 Online' : '🔴 Offline';
            const syncStatus = window.OfflineMode ? 'Offline Mode' : 'Online';
            
            panel.innerHTML = `
                <strong>🐛 DEBUG PANEL</strong>
                <button onclick='settingsModule.toggleDebugLog()' style='float:right;background:none;border:none;color:#00ff88;cursor:pointer;'>Clear</button>
                <hr style='border-color:#333;margin:5px 0;'>
                <div><strong>Status:</strong> ${online} | ${syncStatus}</div>
                <div><strong>Clock:</strong> ${window.ClockFormat} | <strong>Date:</strong> ${window.DateFormat}</div>
                <div><strong>NDI Auto:</strong> ${this.getSetting('ndiAutoDiscovery') ? 'On' : 'Off'} | <strong>Quality:</strong> ${this.getSetting('ndiPreviewQuality')}</div>
                <div><strong>Timestamp:</strong> ${new Date().toLocaleTimeString()}</div>
            `;
        }
    },
    
    toggleDebugLog() {
        const panel = document.getElementById('debug-panel');
        if (panel) {
            panel.innerHTML = '<strong>🐛 DEBUG PANEL</strong><br><em>Log cleared</em>';
        }
    },

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'settings-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    },

    clearAllLocalData() {
        if (confirm(__('settings_confirm_clear_all'))) {
            if (confirm(__('settings_confirm_clear_all2'))) {
                localStorage.clear();
                this.showToast(__('settings_cleared_all'));
                setTimeout(() => location.reload(), 1500);
            }
        }
    },

    async fetchServerStatus() {
        try {
            const resp = await fetch('/api/status');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            
            const badgeEl = document.getElementById('settings-server-badge');
            const uptimeEl = document.getElementById('settings-server-uptime');
            const pidEl = document.getElementById('settings-server-pid');
            const portEl = document.getElementById('settings-server-port');

            if (badgeEl) {
                badgeEl.className = 'status-badge status-ok';
                badgeEl.textContent = '🟢 ' + (__('settings_server_running') || 'Actief');
            }
            if (uptimeEl) {
                uptimeEl.textContent = this.formatUptime(data.uptime_sec || 0);
            }
            if (pidEl) {
                pidEl.textContent = data.pid || '—';
            }
            if (portEl) {
                const defaultPort = (data.services && data.services[0] && data.services[0].default_port) || window.location.port || '8080';
                portEl.textContent = defaultPort;
            }
        } catch (err) {
            const badgeEl = document.getElementById('settings-server-badge');
            if (badgeEl) {
                badgeEl.className = 'status-badge status-off';
                badgeEl.textContent = '🔴 ' + (__('settings_server_stopped') || 'Offline / Fout');
            }
        }
    },

    formatUptime(sec) {
        if (sec < 60) return `${sec}s`;
        if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}u ${m}m`;
    },

    async viewServerLogs() {
        const modal = document.getElementById('settings-log-modal');
        const content = document.getElementById('settings-log-content');
        if (!modal || !content) return;

        modal.classList.remove('hidden');
        content.innerHTML = '<div class="settings-log-loading">' + (__('settings_logs_loading') || 'Logs laden…') + '</div>';

        try {
            const resp = await fetch('/api/logs/server');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const tail = data.tail || [];

            if (tail.length === 0) {
                content.innerHTML = '<div class="settings-log-empty">' + (__('settings_logs_empty') || 'Geen log entries') + '</div>';
            } else {
                content.innerHTML = '<div class="settings-log-list">' +
                    tail.map(entry => {
                        const lineText = typeof entry === 'string' ? entry : (entry.line || '');
                        const tsText = entry.ts || '';
                        const div = document.createElement('div');
                        div.textContent = lineText;
                        const safeLine = div.innerHTML;
                        return `<div class="settings-log-line">
                            ${tsText ? `<span class="settings-log-ts">${tsText}</span>` : ''}
                            <span class="settings-log-msg">${safeLine}</span>
                        </div>`;
                    }).join('') +
                    '</div>';
                content.scrollTop = content.scrollHeight;
            }
        } catch (err) {
            content.innerHTML = `<div class="settings-log-error">Fout bij laden: ${err.message}</div>`;
        }
    },

    closeLogModal() {
        const modal = document.getElementById('settings-log-modal');
        if (modal) modal.classList.add('hidden');
    },

    async restartServer() {
        const confirmMsg = __('settings_confirm_restart_server') || 'Weet je zeker dat je de server wilt herstarten?';
        if (!confirm(confirmMsg)) return;

        const btn = document.getElementById('btn-restart-server');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Herstarten…';
        }

        try {
            const resp = await fetch('/api/restart/server', { method: 'POST' });
            const data = await resp.json();
            this.showToast(data.message || 'Server herstart aangevraagd...');
            setTimeout(() => {
                this.fetchServerStatus();
            }, 3000);
        } catch (err) {
            this.showToast('Herstart fout: ' + err.message);
        } finally {
            setTimeout(() => {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = __('settings_restart_server') || '🔄 Herstart Server';
                }
            }, 3500);
        }
    },

    saveCalendarFeedUrl(val) {
        let url = (val || '').trim();
        if (url.toLowerCase().startsWith('webcal://')) {
            url = 'https://' + url.substring('webcal://'.length);
        }
        if (!url) {
            url = this.defaults.calendarIcsUrl;
        }
        this.setSetting('calendarIcsUrl', url);
        if (typeof appState !== 'undefined' && appState.agenda) {
            appState.agenda.icsUrl = url;
            if (typeof saveAgenda === 'function') saveAgenda();
        }
        const feedInput = document.getElementById('settings-calendar-feed-input');
        if (feedInput) feedInput.value = url;
        this.showToast(__('agenda_feed_saved') || 'Kalender URL opgeslagen!');
    },

    resetCalendarFeedUrl() {
        const defaultUrl = this.defaults.calendarIcsUrl;
        this.saveCalendarFeedUrl(defaultUrl);
        this.showToast(__('agenda_feed_reset') || 'Kalender URL hersteld naar standaard.');
    },

};

window.settingsModule = settingsModule;

// Global format helper functions that other modules can use
window.formatTime = function(hours, minutes) {
    const clockFormat = window.ClockFormat || '24h';
    const h = hours % 12 || 12;
    const ampm = hours >= 12 ? ' PM' : ' AM';
    
    if (clockFormat === '12h') {
        return `${h}:${String(minutes).padStart(2, '0')}${ampm}`;
    }
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

window.formatDate = function(date) {
    const dateFormat = window.DateFormat || 'DD-MM-YYYY';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    if (dateFormat === 'MM-DD-YYYY') {
        return `${month}-${day}-${year}`;
    }
    return `${day}-${month}-${year}`;
};

// Extend NDI module with auto-refresh control
const originalNdiInit = ndiModule.init;
ndiModule.init = function() {
    originalNdiInit.call(this);
    // Respect auto-discovery setting
    if (!window.ClockFormat) {
        // Load settings first
        settingsModule.loadSettings();
    }
    if (!settingsModule.getSetting('ndiAutoDiscovery')) {
        // Don't auto-start polling
        return;
    }
    this.startAutoRefresh();
};

ndiModule.startAutoRefresh = function() {
    if (this.pollingInterval) return; // Already running
    // Skip the 5 s refresh when the user is on a different view.
    this.pollingInterval = setInterval(() => {
        if (!router.isNdiActive()) return;
        this.refreshSources();
    }, 5000);
};

ndiModule.stopAutoRefresh = function() {
    if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
    }
};

