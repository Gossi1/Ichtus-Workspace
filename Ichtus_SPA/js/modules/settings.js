// Settings Module for Ichtus Workspace
const settingsModule = {
    initialized: false,
    
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
        this.render();
        this.applySettings();
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

    render() {
        const view = document.getElementById('view-settings');
        const config = this.getFirebaseConfig();
        
        // Format preview based on settings
        const sampleDate = new Date(2024, 11, 25, 14, 30); // Dec 25, 2024, 14:30
        const dateFormatPreview = this.formatDateSample(sampleDate);
        const timeFormatPreview = this.formatTimeSample(14, 30);

        let configHtml = '';
        if (config && config.apiKey) {
            configHtml = `
                <div class='settings-section'>
                    <h2 class='settings-section-title'>${__('settings_firebase')}</h2>
                    <div class='settings-info-grid'>
                        <div class='settings-info-item'>
                            <label>API Key</label>
                            <div class='settings-info-value'>
                                <code>${this.maskValue(config.apiKey)}</code>
                                <button class='btn-copy' onclick='settingsModule.copyValue(\"${config.apiKey}\")' title='Copy'>📋</button>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>Auth Domain</label>
                            <div class='settings-info-value'>
                                <code>${config.authDomain || __('settings_not_configured_status')}</code>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>Project ID</label>
                            <div class='settings-info-value'>
                                <code>${config.projectId || __('settings_not_configured_status')}</code>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>Storage Bucket</label>
                            <div class='settings-info-value'>
                                <code>${config.storageBucket || __('settings_not_configured_status')}</code>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>Messaging Sender ID</label>
                            <div class='settings-info-value'>
                                <code>${config.messagingSenderId || __('settings_not_configured_status')}</code>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>App ID</label>
                            <div class='settings-info-value'>
                                <code>${config.appId || __('settings_not_configured_status')}</code>
                            </div>
                        </div>
                    </div>
                    <div class='settings-actions'>
                        <button class='btn-settings-action' onclick='settingsModule.editFirebaseConfig()'>
                            ✏️ ${__('settings_edit')}
                        </button>
                        <button class='btn-settings-action btn-settings-danger' onclick='settingsModule.resetFirebaseConfig()'>
                            🗑️ ${__('settings_reset')}
                        </button>
                    </div>
                </div>
            `;
        } else {
            configHtml = `
                <div class='settings-section'>
                    <h2 class='settings-section-title'>${__('settings_firebase')}</h2>
                    <div class='settings-empty'>
                        <p>${__('settings_not_configured')}</p>
                        <button class='btn-settings-action' onclick='settingsModule.setupFirebase()'>
                            ➕ ${__('settings_configure')}
                        </button>
                    </div>
                </div>
            `;
        }
        
        // Determine language selector value
        const currentLang = this.getSetting('language') || 'nl';

        view.innerHTML = `
            <div class='settings-container'>
                <header class='settings-header'>
                    <h1>⚙️ ${__('settings_title')}</h1>
                    <p class='settings-subtitle'>${__('settings_subtitle')}</p>
                </header>

                <!-- Language Settings -->
                <div class='settings-section'>
                    <h2 class='settings-section-title'>\ud83c\udf10 ${__('settings_language')}</h2>
                    <div class='settings-control-grid'>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_language')}</label>
                                <desc>${__('settings_language_desc')}</desc>
                            </div>
                            <select class='settings-select' onchange='settingsModule.setSetting(\"language\", this.value)'>
                                <option value='nl' ${currentLang === 'nl' ? 'selected' : ''}>${__('settings_dutch')}</option>
                                <option value='en' ${currentLang === 'en' ? 'selected' : ''}>${__('settings_english')}</option>
                            </select>
                        </div>
                    </div>
                </div>

                ${configHtml}
                
                <!-- Network & Sync Settings -->
                <div class='settings-section'>
                    <h2 class='settings-section-title'>🌐 ${__('settings_network')}</h2>
                    <div class='settings-control-grid'>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_pro_ip')}</label>
                                <desc>${__('settings_pro_ip_desc')}</desc>
                            </div>
                            <div style='display:flex;gap:0.5rem;align-items:center;flex-shrink:0;'>
                                <input type='text' class='settings-input-text' 
                                    value='${this.getSetting('proPresenterIp')}' 
                                    placeholder='127.0.0.1'
                                    onchange='settingsModule.setSetting(\"proPresenterIp\", this.value.trim())'
                                    style='width:130px;'>
                                <span style='color:var(--text-secondary);'>:</span>
                                <input type='text' class='settings-input-text' 
                                    value='${this.getSetting('proPresenterPort')}' 
                                    placeholder='50001'
                                    onchange='settingsModule.setSetting(\"proPresenterPort\", this.value.trim())'
                                    style='width:80px;'>
                            </div>
                        </div>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_offline')}</label>
                                <desc>${__('settings_offline_desc')}</desc>
                            </div>
                            <label class='toggle-switch'>
                                <input type='checkbox' 
                                    ${this.getSetting('offlineMode') ? 'checked' : ''} 
                                    onchange='settingsModule.setSetting(\"offlineMode\", this.checked)'>
                                <span class='toggle-slider'></span>
                            </label>
                        </div>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_debug')}</label>
                                <desc>${__('settings_debug_desc')}</desc>
                            </div>
                            <label class='toggle-switch'>
                                <input type='checkbox' 
                                    ${this.getSetting('showDebugPanel') ? 'checked' : ''} 
                                    onchange='settingsModule.setSetting(\"showDebugPanel\", this.checked)'>
                                <span class='toggle-slider'></span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- NDI Settings -->
                <div class='settings-section'>
                    <h2 class='settings-section-title'>📡 ${__('settings_ndi')}</h2>
                    <div class='settings-control-grid'>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_ndi_auto')}</label>
                                <desc>${__('settings_ndi_auto_desc')}</desc>
                            </div>
                            <label class='toggle-switch'>
                                <input type='checkbox' 
                                    ${this.getSetting('ndiAutoDiscovery') ? 'checked' : ''} 
                                    onchange='settingsModule.setSetting(\"ndiAutoDiscovery\", this.checked)'>
                                <span class='toggle-slider'></span>
                            </label>
                        </div>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_ndi_quality')}</label>
                                <desc>${__('settings_ndi_quality_desc')}</desc>
                            </div>
                            <select class='settings-select' onchange='settingsModule.setSetting(\"ndiPreviewQuality\", this.value)'>
                                <option value='low' ${this.getSetting('ndiPreviewQuality') === 'low' ? 'selected' : ''}>${__('settings_ndi_low')}</option>
                                <option value='medium' ${this.getSetting('ndiPreviewQuality') === 'medium' ? 'selected' : ''}>${__('settings_ndi_medium')}</option>
                                <option value='high' ${this.getSetting('ndiPreviewQuality') === 'high' ? 'selected' : ''}>${__('settings_ndi_high')}</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Display Settings -->
                <div class='settings-section'>
                    <h2 class='settings-section-title'>🕐 ${__('settings_display')}</h2>
                    <div class='settings-control-grid'>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_clock')}</label>
                                <desc>${__('settings_clock_desc')}: ${timeFormatPreview}</desc>
                            </div>
                            <select class='settings-select' onchange='settingsModule.setSetting(\"clockFormat\", this.value)'>
                                <option value='12h' ${this.getSetting('clockFormat') === '12h' ? 'selected' : ''}>${__('settings_clock_12h')}</option>
                                <option value='24h' ${this.getSetting('clockFormat') === '24h' ? 'selected' : ''}>${__('settings_clock_24h')}</option>
                            </select>
                        </div>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_date')}</label>
                                <desc>${__('settings_date_desc')}: ${dateFormatPreview}</desc>
                            </div>
                            <select class='settings-select' onchange='settingsModule.setSetting(\"dateFormat\", this.value)'>
                                <option value='DD-MM-YYYY' ${this.getSetting('dateFormat') === 'DD-MM-YYYY' ? 'selected' : ''}>${__('settings_date_dmy')}</option>
                                <option value='MM-DD-YYYY' ${this.getSetting('dateFormat') === 'MM-DD-YYYY' ? 'selected' : ''}>${__('settings_date_mdy')}</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Data Management -->
                <div class='settings-section'>
                    <h2 class='settings-section-title'>💾 ${__('settings_data')}</h2>
                    <div class='settings-control-grid'>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_clear_cache')}</label>
                                <desc>${__('settings_clear_cache_desc')}</desc>
                            </div>
                            <button class='btn-settings-action btn-settings-warning' onclick='settingsModule.clearFirebaseCache()'>
                                🧹 ${__('settings_clear_cache_btn')}
                            </button>
                        </div>
                        <div class='settings-control-item'>
                            <div class='settings-control-info'>
                                <label>${__('settings_clear_all')}</label>
                                <desc>${__('settings_clear_all_desc')}</desc>
                            </div>
                            <button class='btn-settings-action btn-settings-danger' onclick='settingsModule.clearAllLocalData()'>
                                🗑️ ${__('settings_clear_all_btn')}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- App Info -->
                <div class='settings-section'>
                    <h2 class='settings-section-title'>ℹ️ ${__('settings_app_info')}</h2>
                    <div class='settings-info-grid'>
                        <div class='settings-info-item'>
                            <label>${__('settings_version')}</label>
                            <div class='settings-info-value'>
                                <code>1.0.0</code>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>${__('settings_firebase_status')}</label>
                            <div class='settings-info-value'>
                                <span class='status-badge ${config && config.apiKey ? 'status-ok' : 'status-warning'}'>
                                    ${config && config.apiKey ? '✓ ' + __('settings_configured') : '✗ ' + __('settings_not_configured_status')}
                                </span>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>${__('settings_config_source')}</label>
                            <div class='settings-info-value'>
                                <code>${this.getConfigSource()}</code>
                            </div>
                        </div>
                        <div class='settings-info-item'>
                            <label>${__('settings_offline_status')}</label>
                            <div class='settings-info-value'>
                                <span class='status-badge ${this.getSetting('offlineMode') ? 'status-ok' : 'status-info'}'>
                                    ${this.getSetting('offlineMode') ? '✓ ' + __('settings_active') : '✗ ' + __('settings_inactive')}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Edit Firebase Modal -->
            <div id='settings-firebase-modal' class='overlay-screen overlay-task-modal hidden'>
                <div class='task-modal-dialog'>
                    <div class='modal-header'>
                        <h3 class='task-modal-title'>${__('settings_edit_title')}</h3>
                        <button onclick='settingsModule.closeEditModal()' class='tpl-btn-remove' style='border:none;background:transparent;color:#aaa;font-size:24px;padding:0;' title='${__('close')}'>✖</button>
                    </div>
                    <form id='firebase-edit-form' onsubmit='settingsModule.saveFirebaseConfig(event)'>
                        <div class='modal-form-content'>
                            <div class='form-group'>
                                <label for='edit-apiKey'>API Key *</label>
                                <input type='text' id='edit-apiKey' class='form-input' required value='${config?.apiKey || ''}'>
                            </div>
                            <div class='form-group'>
                                <label for='edit-authDomain'>Auth Domain</label>
                                <input type='text' id='edit-authDomain' class='form-input' value='${config?.authDomain || ''}'>
                            </div>
                            <div class='form-group'>
                                <label for='edit-projectId'>Project ID *</label>
                                <input type='text' id='edit-projectId' class='form-input' required value='${config?.projectId || ''}'>
                            </div>
                            <div class='form-group'>
                                <label for='edit-storageBucket'>Storage Bucket</label>
                                <input type='text' id='edit-storageBucket' class='form-input' value='${config?.storageBucket || ''}'>
                            </div>
                            <div class='form-group'>
                                <label for='edit-messagingSenderId'>Messaging Sender ID</label>
                                <input type='text' id='edit-messagingSenderId' class='form-input' value='${config?.messagingSenderId || ''}'>
                            </div>
                            <div class='form-group'>
                                <label for='edit-appId'>App ID *</label>
                                <input type='text' id='edit-appId' class='form-input' required value='${config?.appId || ''}'>
                            </div>
                        </div>
                        <div class='modal-footer'>
                            <button type='button' onclick='settingsModule.closeEditModal()' class='btn-secondary'>${__('cancel')}</button>
                            <button type='submit' class='btn-setlist-primary'>${__('save')}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        // Show debug panel if enabled
        this.renderDebugPanel();
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
        document.getElementById('settings-firebase-modal').classList.remove('hidden');
    },

    closeEditModal() {
        document.getElementById('settings-firebase-modal').classList.add('hidden');
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

    setupFirebase() {
        this.editFirebaseConfig();
    },
    
    clearFirebaseCache() {
        if (confirm(__('settings_confirm_clear_cache'))) {
            // Clear Firebase related localStorage items except settings
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
    }
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
    this.pollingInterval = setInterval(() => this.refreshSources(), 5000);
};

ndiModule.stopAutoRefresh = function() {
    if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
    }
};

// Extend NDI module with preview quality
ndiModule.getPreviewQuality = function() {
    if (!settingsModule.settings) {
        settingsModule.loadSettings();
    }
    return settingsModule.getSetting('ndiPreviewQuality') || 'medium';
};