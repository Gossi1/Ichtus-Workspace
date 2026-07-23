// Settings Module for Ichtus Workspace
const settingsModule = {
    initialized: false,
    
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
        proPresenterPort: '50001'
    },

    // Current settings (loaded from localStorage)
    settings: {},

    init() {
        this.loadSettings();
        this.loadAppVersion();
        this.fetchLatestGitHubVersion();
        this.render();
        this.applySettings();

        // The X32 Library configuration lived here in earlier revisions;
        // it was relocated into the Stage Builder view (open via the
        // 🎚️ button next to the gear icon) so a single workspace
        // owns the operator-chosen name + library-slot ID pairs.
    },
    
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
    },

    getFirebaseConfig() {
        let config = null;
        const savedConfig = localStorage.getItem('firebaseConfig');
        if (savedConfig) {
            try {
                config = JSON.parse(savedConfig);
                if (config && config.apiKey && config.apiKey !== 'YOUR_API_KEY_HERE') {
                    return config;
                }
            } catch (e) {
                localStorage.removeItem('firebaseConfig');
            }
        }
        if (typeof window.FIREBASE_CONFIG !== 'undefined' && window.FIREBASE_CONFIG) {
            config = window.FIREBASE_CONFIG;
            if (config.apiKey && config.apiKey !== 'YOUR_API_KEY_HERE') {
                return config;
            }
        }
        if (typeof FIREBASE_CONFIG !== 'undefined') {
            config = FIREBASE_CONFIG;
            if (config.apiKey && config.apiKey !== 'YOUR_API_KEY_HERE') {
                return config;
            }
        }
        return null;
    },

    loadAppVersion() {
        fetch('../Ichtus_SPA/version.json')
            .then(response => response.json())
            .then(data => {
                this.appVersion = data.version || '1.0.0';
                this.render(); // Re-render when version loaded
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
                }
                this.render(); // Re-render when GitHub version loaded
            })
            .catch(error => {
                console.warn('Could not fetch latest GitHub release:', error);
                this.versionError = __('settings_version_github_error');
                this.render(); // Re-render even on error
            });
    },

    checkForUpdates() {
        const btn = document.getElementById('btn-check-updates');
        const statusEl = document.getElementById('settings-update-status');
        if (!btn || !statusEl) return;

        btn.disabled = true;
        btn.textContent = '⏳ Controleren...';
        statusEl.style.display = 'none';

        fetch('http://localhost:9090/api/check-update')
            .then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(data => {
                if (data.update_available) {
                    btn.textContent = '🔄 Check voor updates';
                    statusEl.className = 'update-notification-tag';
                    statusEl.textContent = '⬆️ Update beschikbaar (' + data.behind_count + ' commits achter)';
                    statusEl.style.display = 'inline-block';
                } else {
                    btn.textContent = '🔄 Check voor updates';
                    statusEl.className = 'update-notification-tag';
                    statusEl.textContent = '✓ Up-to-date';
                    statusEl.style.display = 'inline-block';
                }
                btn.disabled = false;
            })
            .catch(error => {
                console.warn('Update check failed:', error);
                btn.textContent = '🔄 Check voor updates';
                statusEl.className = 'update-notification-tag';
                statusEl.textContent = '⚠️ Kon supervisor niet bereiken';
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
        const config = this.getFirebaseConfig();
        
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
        // 2. Firebase config grid
        // ==========================================
        const fbGrid = document.getElementById('settings-firebase-grid');
        const fbEmpty = document.getElementById('settings-firebase-empty');
        const copyBtn = document.getElementById('btn-copy-apikey');

        if (config && config.apiKey) {
            if (fbGrid) fbGrid.style.display = '';
            if (fbEmpty) fbEmpty.style.display = 'none';
            
            const setCode = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val || '---';
            };
            setCode('fb-apiKey', this.maskValue(config.apiKey));
            setCode('fb-authDomain', config.authDomain || '---');
            setCode('fb-projectId', config.projectId || '---');
            setCode('fb-storageBucket', config.storageBucket || '---');
            setCode('fb-messagingSenderId', config.messagingSenderId || '---');
            setCode('fb-appId', config.appId || '---');
            
            if (copyBtn) {
                copyBtn.onclick = () => this.copyValue(config.apiKey);
            }
        } else {
            if (fbGrid) fbGrid.style.display = 'none';
            if (fbEmpty) fbEmpty.style.display = '';
            if (copyBtn) copyBtn.onclick = null;
        }

        // ==========================================
        // 3. Network & Sync
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
        // 4. NDI Video
        // ==========================================
        const ndiToggle = document.getElementById('settings-ndi-auto-discovery');
        if (ndiToggle) ndiToggle.checked = this.getSetting('ndiAutoDiscovery');

        const ndiQuality = document.getElementById('settings-ndi-quality');
        if (ndiQuality) ndiQuality.value = this.getSetting('ndiPreviewQuality');

        // ==========================================
        // 5. Display
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
        // 6. App Info
        // ==========================================
        const versionEl = document.getElementById('settings-app-version');
        if (versionEl) versionEl.textContent = this.appVersion || '1.0.0';

        const updateEl = document.getElementById('settings-update-notification');
        const updateText = document.getElementById('settings-update-text');
        if (updateEl && updateText) {
            if (this.latestGitHubVersion && this.compareVersions(this.latestGitHubVersion, this.appVersion) > 0) {
                updateEl.style.display = '';
                updateText.textContent = '⬆️ ' + __('settings_version_update_available') + ': ' + this.latestGitHubVersion;
            } else if (this.latestGitHubVersion) {
                updateEl.style.display = '';
                updateText.textContent = '✓ ' + __('settings_version_latest');
            } else {
                updateEl.style.display = 'none';
            }
        }

        const fbStatusBadge = document.getElementById('settings-fb-status-badge');
        if (fbStatusBadge) {
            if (config && config.apiKey) {
                fbStatusBadge.className = 'status-badge status-ok';
                fbStatusBadge.textContent = '✓ ' + __('settings_configured');
            } else {
                fbStatusBadge.className = 'status-badge status-off';
                fbStatusBadge.textContent = '✗ ' + __('settings_not_configured_status');
            }
        }

        const configSource = document.getElementById('settings-config-source');
        if (configSource) configSource.textContent = this.getConfigSource();

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
            const config = this.getFirebaseConfig();
            const online = navigator.onLine ? '🟢 Online' : '🔴 Offline';
            const syncStatus = window.OfflineMode ? 'Offline Mode' : 'Online';
            
            panel.innerHTML = `
                <strong>🐛 DEBUG PANEL</strong>
                <button onclick='settingsModule.toggleDebugLog()' style='float:right;background:none;border:none;color:#00ff88;cursor:pointer;'>Clear</button>
                <hr style='border-color:#333;margin:5px 0;'>
                <div><strong>Status:</strong> ${online} | ${syncStatus}</div>
                <div><strong>Firebase:</strong> ${config ? '✓ Configured (' + config.projectId + ')' : '✗ Not configured'}</div>
                <div><strong>Config Source:</strong> ${this.getConfigSource()}</div>
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

    getConfigSource() {
        const savedConfig = localStorage.getItem('firebaseConfig');
        if (savedConfig) {
            try {
                const config = JSON.parse(savedConfig);
                if (config && config.apiKey && config.apiKey !== 'YOUR_API_KEY_HERE') {
                    return 'Browser (localStorage)';
                }
            } catch (e) {}
        }
        if (typeof window.FIREBASE_CONFIG !== 'undefined' && window.FIREBASE_CONFIG) {
            return 'Server Injected';
        }
        if (typeof FIREBASE_CONFIG !== 'undefined') {
            return 'Global Variable';
        }
        return __('settings_config_source_none');
    },

    maskValue(value) {
        if (!value || value.length < 8) return '****';
        return value.substring(0, 6) + '...' + value.substring(value.length - 4);
    },

    copyValue(value) {
        navigator.clipboard.writeText(value).then(() => {
            this.showToast(__('toast_copied'));
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    },

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'settings-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    },

    editFirebaseConfig() {
        // Populate modal with current config values
        const config = this.getFirebaseConfig();
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };
        setVal('edit-apiKey', config?.apiKey || '');
        setVal('edit-authDomain', config?.authDomain || '');
        setVal('edit-projectId', config?.projectId || '');
        setVal('edit-storageBucket', config?.storageBucket || '');
        setVal('edit-messagingSenderId', config?.messagingSenderId || '');
        setVal('edit-appId', config?.appId || '');

        const modal = document.getElementById('settings-firebase-modal');
        if (modal) modal.classList.remove('hidden');
    },

    closeEditModal() {
        const modal = document.getElementById('settings-firebase-modal');
        if (modal) modal.classList.add('hidden');
    },

    saveFirebaseConfig(e) {
        e.preventDefault();

        const config = {
            apiKey: document.getElementById('edit-apiKey').value.trim(),
            authDomain: document.getElementById('edit-authDomain').value.trim(),
            projectId: document.getElementById('edit-projectId').value.trim(),
            storageBucket: document.getElementById('edit-storageBucket').value.trim(),
            messagingSenderId: document.getElementById('edit-messagingSenderId').value.trim(),
            appId: document.getElementById('edit-appId').value.trim()
        };

        if (!config.apiKey || !config.projectId || !config.appId) {
            alert(__('settings_required_fields'));
            return;
        }

        if (!config.apiKey.startsWith('AIza')) {
            alert(__('settings_invalid_api'));
            return;
        }

        localStorage.setItem('firebaseConfig', JSON.stringify(config));
        window.FIREBASE_CONFIG = config;

        this.closeEditModal();
        this.render();
        this.showToast(__('settings_saved_firebase'));

        setTimeout(() => location.reload(), 1000);
    },

    resetFirebaseConfig() {
        if (confirm(__('settings_confirm_reset_firebase'))) {
            localStorage.removeItem('firebaseConfig');
            this.showToast(__('settings_reset_firebase'));
            setTimeout(() => location.reload(), 1000);
        }
    },

    clearFirebaseCache() {
        if (confirm(__('settings_confirm_clear_cache'))) {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('firebase') || key === 'firebaseConfig') {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            
            this.showToast(__('settings_cleared_cache'));
            this.render();
        }
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

    // The X32 Library configuration was relocated from Settings to the
    // Stage Builder view in this revision; the relevant editor methods
    // now live on `stagebuilderModule` (see `openX32LibraryMap`,
    // `_saveX32LibraryMapLocally`, `_saveX32LibraryMapToFirebase`,
    // `_loadX32LibraryMapFromFirebase`).
};

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

