/**
 * ProPresenter Widget Module
 * 
 * Handles:
 * - Single presentation slides view with thumbnails
 * - Full playlist slides view (all presentations in active playlist)
 * - WebSocket navigation within playlist context
 * - Slide index polling (fast 500ms + slow 15s)
 * - Playlist change detection (2s)
 * - Playlist slide tracking (1s)
 * 
 * Namespace: window.dashboardWidgets.propresenter
 */
window.dashboardWidgets = window.dashboardWidgets || {};
window.dashboardWidgets.propresenter = {

    // ===============================
    //  PROPRESENTER URL HELPERS
    // ===============================

    _escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _getProPresenterBaseUrl() {
        let ip = '100.113.22.22', port = '51253';
        if (typeof settingsModule !== 'undefined' && settingsModule.settings && settingsModule.settings.proPresenterIp) {
            ip = settingsModule.settings.proPresenterIp;
            port = settingsModule.settings.proPresenterPort || port;
        } else {
            const combined = localStorage.getItem('setlistProIp');
            if (combined && combined.includes(':')) {
                const parts = combined.split(':');
                ip = parts[0];
                port = parts[1];
            } else if (combined) {
                ip = combined;
                port = localStorage.getItem('setlistProPort') || port;
            }
        }
        return `http://${ip}:${port}`;
    },

    /**
     * Unified ProPresenter fetch helper.
     * Always routes through Tauri Axum proxy (/api/pro/*) to prevent CORS and wrong IP/port issues.
     * Falls back to direct HTTP URL if proxy is unavailable.
     */
    _proFetch(endpoint, options = {}) {
        let clean = endpoint || '';
        if (clean.startsWith('http://') || clean.startsWith('https://')) {
            return fetch(clean, options);
        }
        if (!clean.startsWith('/')) clean = '/' + clean;

        // Strip /v1/ for /api/pro proxy because the Axum backend automatically prepends /v1
        let proxyPath = clean;
        if (proxyPath.startsWith('/v1/')) {
            proxyPath = '/api/pro' + proxyPath.slice(3);
        } else if (!proxyPath.startsWith('/api/pro')) {
            proxyPath = '/api/pro' + proxyPath;
        }

        return fetch(proxyPath, options).catch(err => {
            const baseUrl = this._getProPresenterBaseUrl();
            const directUrl = `${baseUrl}${clean.startsWith('/v1') ? clean : '/v1' + clean}`;
            return fetch(directUrl, options);
        });
    },

    _getProPresenterWsUrl() {
        let ip = '127.0.0.1', port = '50001';
        if (typeof settingsModule !== 'undefined' && settingsModule.settings && settingsModule.settings.proPresenterIp) {
            ip = settingsModule.settings.proPresenterIp;
            port = settingsModule.settings.proPresenterPort || port;
        } else {
            const combined = localStorage.getItem('setlistProIp');
            if (combined && combined.includes(':')) {
                const parts = combined.split(':');
                ip = parts[0];
                port = parts[1];
            } else if (combined) {
                ip = combined;
                port = localStorage.getItem('setlistProPort') || port;
            }
        }
        return `ws://${ip}:${port}/remote`;
    },

    // ===============================
    //  SINGLE PRESENTATION WIDGET
    // ===============================

    _fetchProPresenterSlides(widgetEl) {
        Promise.all([
            this._proFetch('/v1/presentation/active', { headers: { 'Accept': 'application/json' } })
                .then(r => r.text()),
            this._proFetch('/v1/presentation/slide_index', { headers: { 'Accept': 'application/json' } })
                .then(r => r.json())
                .catch(() => ({ presentation_index: { index: 0 } }))
        ])
            .then(([text, slideIndexData]) => {
                const currentIdx = slideIndexData?.presentation_index?.index ?? 0;
                const presentationName = slideIndexData?.presentation_index?.presentation_id?.name || '';
                let data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    const slideMatches = text.match(/<RVDisplaySlide[^>]*>/gi);
                    const slideCount = slideMatches ? slideMatches.length : 0;
                    this._proPresenterLastIndex = currentIdx;
                    this._proPresenterLastPresentationUuid = null;
                    this._proPresenterSlideCount = slideCount;
                    const slides = Array.from({ length: slideCount }, (_, i) => ({
                        label: `Slide ${i + 1}`,
                        index: i
                    }));
                    this._renderSlides(widgetEl, slides, currentIdx, null, '');
                    return;
                }
                const presentation = data?.presentation || data;
                const groups = presentation?.groups || [];
                const groupMap = new Map();
                groups.forEach(g => { if (g?.uuid) groupMap.set(g.uuid, g); });

                const targetArrUuid = presentation?.current_arrangement;
                const arrangements = presentation?.arrangements || [];
                const activeArr = arrangements.find(a => a?.id?.uuid === targetArrUuid) || arrangements[0];

                let slides = [];
                if (activeArr && Array.isArray(activeArr.groups) && activeArr.groups.length > 0) {
                    activeArr.groups.forEach(groupUuid => {
                        const g = groupMap.get(groupUuid);
                        if (g && Array.isArray(g.slides)) {
                            slides.push(...g.slides.map(s => ({ ...s, groupName: g.name })));
                        }
                    });
                } else {
                    slides = groups.flatMap(g => (g.slides || []).map(s => ({ ...s, groupName: g.name })));
                }
                const uuid = presentation?.id?.uuid || null;
                this._proPresenterLastIndex = currentIdx;
                this._proPresenterLastPresentationUuid = slideIndexData?.presentation_index?.presentation_id?.uuid || null;
                this._proPresenterSlideCount = slides.length;
                this._renderSlides(widgetEl, slides, currentIdx, uuid, '');
                // Update title
                this._proFetch('/v1/playlist/active', { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json())
                    .then(playlistData => {
                        const playlistName = playlistData?.presentation?.playlist?.name || playlistData?.announcements?.playlist?.name;
                        const titleEl = widgetEl.querySelector('.widget-title');
                        if (titleEl) {
                            if (playlistName) {
                                titleEl.textContent = `Playlist: ${playlistName}`;
                            } else if (presentationName) {
                                titleEl.textContent = `Presentation: ${presentationName}`;
                            }
                        }
                    })
                    .catch(() => {});
            })
            .catch(err => {
                const container = widgetEl.querySelector('.widget-body-inner') || widgetEl.querySelector('#propresenter-slides-container') || widgetEl.querySelector('.widget-body') || widgetEl;
                container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>ProPresenter offline</div><div style="font-size:0.75rem;margin-top:0.5rem;color:#888;">${this._escapeHtml(err.message)}</div></div>`;
            });
    },

    _renderSlides(widgetEl, slides, currentIdx, uuid, playlistName) {
        const container = widgetEl.querySelector('.widget-body-inner') || widgetEl.querySelector('#propresenter-slides-container') || widgetEl.querySelector('.widget-body') || widgetEl;
        if (!slides.length) {
            container.innerHTML = `<div class="pp-loading">No slides found</div>`;
            return;
        }
        const titleEl = widgetEl.querySelector('.widget-title');
        if (titleEl && playlistName) {
            titleEl.textContent = `Playlist "${playlistName}"`;
        }
        const baseUrl = this._getProPresenterBaseUrl();
        const getThumbUrl = (slide, idx) => {
            let url = slide?.thumb_url || slide?.thumbnail || slide?.image_url;
            if (!url && slide?.image) {
                if (slide.image.startsWith('data:')) return slide.image;
                if (slide.image.startsWith('http://') || slide.image.startsWith('https://')) return slide.image;
                if (slide.image.startsWith('/')) return '/api/pro' + slide.image;
                return 'data:image/jpeg;base64,' + slide.image;
            }
            if (!url && uuid) {
                url = `${baseUrl}/v1/presentation/${uuid}/thumbnail/${idx}`;
            }
            if (!url) {
                url = `${baseUrl}/v1/presentation/active/thumbnail/${idx}`;
            }
            return url;
        };
        let html = '';
        slides.forEach((slide, idx) => {
            const activeClass = idx === currentIdx ? ' active' : '';
            const thumbUrl = getThumbUrl(slide, idx);
            const slideTitle = this._escapeHtml(slide.label || slide.text || `Slide ${idx + 1}`);
            const proxyFallback = uuid ? `/api/pro/presentation/${uuid}/thumbnail/${idx}` : '';
            html += `<div class="pp-slide-item${activeClass}" data-slide-index="${idx}" onclick="dashboardModule._triggerSlide(${idx})">
                <img class="pp-slide-thumb" src="${thumbUrl}" alt="Slide ${idx + 1}" loading="lazy"
                     onerror="if(!this.dataset.retry && '${proxyFallback}'){this.dataset.retry='1';this.src='${proxyFallback}';}else{this.style.opacity='0';}"
                     onload="this.style.opacity='1'" />
                <div class="pp-slide-fallback-label" title="${slideTitle}">${slideTitle}</div>
            </div>`;
        });
        container.innerHTML = html;
        // Apply saved slides layout preference
        try {
            const layoutPref = localStorage.getItem('ichtus_pp_slides_layout');
            const btn = widgetEl.querySelector('.pp-layout-toggle');
            if (layoutPref === 'grid') {
                container.classList.add('pp-grid-layout');
                if (btn) btn.textContent = '☰';
            } else {
                container.classList.remove('pp-grid-layout');
                if (btn) btn.textContent = '⊞';
            }
        } catch(e) {}
        // Update slide badge
        const badge = widgetEl.querySelector('#propresenter-slide-badge');
        if (badge) badge.textContent = `${(currentIdx ?? 0) + 1}/${slides.length}`;
        // Scroll active slide into view
        const activeEl = container.querySelector('.pp-slide-item.active');
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },

    _triggerSlide(index) {
        document.querySelectorAll('.pp-slide-item[data-slide-index="' + index + '"]').forEach(el => {
            el.classList.remove('pp-triggered');
            void el.offsetWidth;
            el.classList.add('pp-triggered');
            setTimeout(() => el.classList.remove('pp-triggered'), 350);
        });
        this._proFetch(`/v1/presentation/active/${index}/trigger`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        }).catch(() => {});
    },

    _pollProPresenterIndex(widgetEl) {
        this._proFetch('/v1/presentation/slide_index', {
            headers: { 'Accept': 'application/json' }
        })
            .then(res => res.json())
            .then(data => {
                const idx = data?.presentation_index?.index ?? 0;
                const uuid = data?.presentation_index?.presentation_id?.uuid || null;
                const presentationChanged = uuid && uuid !== this._proPresenterLastPresentationUuid;
                if (presentationChanged) {
                    this._proPresenterLastPresentationUuid = uuid;
                    this._fetchProPresenterSlides(widgetEl);
                    return;
                }
                if (idx !== this._proPresenterLastIndex) {
                    this._proPresenterLastIndex = idx;
                    const container = widgetEl.querySelector('.widget-body-inner') || widgetEl.querySelector('#propresenter-slides-container') || widgetEl.querySelector('.widget-body') || widgetEl;
                    container.querySelectorAll('.pp-slide-item').forEach(el => {
                        el.classList.toggle('active', parseInt(el.dataset.slideIndex) === idx);
                    });
                    const slidesTotal = container.querySelectorAll('.pp-slide-item').length;
                    const badge = widgetEl.querySelector('#propresenter-slide-badge');
                    if (badge && slidesTotal) badge.textContent = `${idx + 1}/${slidesTotal}`;
                    const activeEl = container.querySelector('.pp-slide-item.active');
                    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            })
            .catch(() => {});
    },

    _updateAllProPresenterWidgets() {
        document.querySelectorAll('.widget-card[data-widget-id="propresenter"]').forEach(el => this._fetchProPresenterSlides(el));
    },

    _updateAllProPresenterIndexes() {
        document.querySelectorAll('.widget-card[data-widget-id="propresenter"]').forEach(el => this._pollProPresenterIndex(el));
    },

    // ===============================
    //  PROPRESENTER POLLING (single slides)
    // ===============================

    _startProPresenterPolling() {
        this._stopProPresenterPolling();
        if (!router.isDashboardActive()) return;

        // Fast polling: check slide index every 500ms for active single-slide widgets
        this._proPresenterFastInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            try {
                document.querySelectorAll('.widget-card[data-widget-id="propresenter"]').forEach(el => {
                    this._pollProPresenterIndex(el);
                });
            } catch (e) { /* polling error — silent */ }
        }, 500);

        // Slow polling: full slide refresh every 15s for all propresenter widgets
        this._proPresenterInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            try {
                this._updateAllProPresenterWidgets();
                this._updateAllProPresenterIndexes();
            } catch (e) { /* polling error — silent */ }
        }, 15000);
    },

    _stopProPresenterPolling() {
        if (this._proPresenterFastInterval) {
            clearInterval(this._proPresenterFastInterval);
            this._proPresenterFastInterval = null;
        }
        if (this._proPresenterInterval) {
            clearInterval(this._proPresenterInterval);
            this._proPresenterInterval = null;
        }
    },

    _toggleSlidesLayout(btn) {
        const widgetEl = btn.closest('.widget-card');
        const container = widgetEl.querySelector('.widget-propresenter');
        if (!container) return;
        const isGrid = container.classList.toggle('pp-grid-layout');
        btn.textContent = isGrid ? '☰' : '⊞';
        try { localStorage.setItem('ichtus_pp_slides_layout', isGrid ? 'grid' : 'list'); } catch(e) {}
    },

    // ===============================
    //  PROPRESENTER PLAYLIST WIDGET
    // ===============================

    _startPlaylistChangeDetection() {
        this._stopPlaylistChangeDetection();
        this._proPresenterPlaylistCheckInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            this._proFetch('/v1/playlist/active', { headers: { 'Accept': 'application/json' } })
                .then(r => r.json())
                .then(data => {
                    const presUuid = data?.presentation?.playlist?.uuid || null;
                    const annUuid = data?.announcements?.playlist?.uuid || null;
                    const combinedKey = `${presUuid ?? ''}|${annUuid ?? ''}`;
                    if (!presUuid && !annUuid) return;
                    if (combinedKey === this._proPresenterPlaylistLastUuid) return;
                    const changed = this._proPresenterPlaylistLastUuid !== null || !this._hasPlaylistData;
                    this._proPresenterPlaylistLastUuid = combinedKey;
                    if (changed) this._loadProPresenterPlaylist();
                })
                .catch(() => {});
        }, 2000);
    },

    _stopPlaylistChangeDetection() {
        if (this._proPresenterPlaylistCheckInterval) {
            clearInterval(this._proPresenterPlaylistCheckInterval);
            this._proPresenterPlaylistCheckInterval = null;
        }
    },

    _startPlaylistSlideTracking() {
        this._stopPlaylistSlideTracking();
        const baseUrl = this._getProPresenterBaseUrl();
        this._proPresenterPlaylistSlideCheckInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            Promise.all([
                this._proFetch('/v1/presentation/slide_index', { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json()).catch(() => null),
                this._proFetch('/v1/announcement/slide_index', { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json()).catch(() => null)
            ]).then(([presData, annData]) => {
                let activePresUuid = presData?.presentation_index?.presentation_id?.uuid || null;
                let activeSlideIdx = presData?.presentation_index?.index ?? null;

                if (!activePresUuid && annData?.announcement_index?.presentation_id?.uuid) {
                    activePresUuid = annData.announcement_index.presentation_id.uuid;
                    activeSlideIdx = annData.announcement_index.index ?? 0;
                }
                if (activeSlideIdx === null) activeSlideIdx = 0;
                this._proPresenterCurrentSlideIdx = activeSlideIdx;

                // Update active slide in all propresenter-playlist widgets
                document.querySelectorAll('.widget-card[data-widget-id="propresenter-playlist"]').forEach(widget => {
                    const mode = widget.dataset.ppMode || (typeof localStorage !== 'undefined' ? localStorage.getItem('ichtus_pp_mode') : 'playlist') || 'playlist';
                    if (mode === 'hud') {
                        this._updateLiveHud(baseUrl);
                        return;
                    }
                    const container = widget.querySelector('#propresenter-playlist-container');
                    if (!container) return;
                    container.querySelectorAll('.pp-slide-item.active').forEach(el => el.classList.remove('active'));
                    if (activePresUuid) {
                        const activeEl = container.querySelector(`.pp-slide-item[data-pl-uuid="${activePresUuid}"][data-pl-slide-index="${activeSlideIdx}"]`);
                        if (activeEl) {
                            activeEl.classList.add('active');
                            if (this._playlistAutoScroll) {
                                const rect = activeEl.getBoundingClientRect();
                                const containerRect = container.getBoundingClientRect();
                                if (rect.bottom > containerRect.bottom || rect.top < containerRect.top) {
                                    activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                }
                            }
                        }
                    }
                });

                    // Update active item in all playlist-overview widgets
                    document.querySelectorAll('.widget-card[data-widget-id="playlist-overview"]').forEach(widget => {
                        const container = widget.querySelector('#playlist-overview-container');
                        if (!container) return;
                        container.querySelectorAll('.plo-v2-item.active').forEach(el => el.classList.remove('active'));
                        container.querySelectorAll('.plo-v2-slide-counter').forEach(el => { el.style.display = 'none'; el.textContent = ''; });
                        if (activePresUuid) {
                            const activeEl = container.querySelector(`.plo-v2-item[data-pres-uuid="${activePresUuid}"]`);
                            if (activeEl) {
                                activeEl.classList.add('active');
                                const counterEl = activeEl.querySelector('.plo-v2-slide-counter');
                                if (counterEl) {
                                    const totalSlides = window.dashboardWidgets.playlistOverview?._playlistOverviewSlidesData?.length;
                                    if (totalSlides) {
                                        counterEl.style.display = '';
                                        counterEl.textContent = `${(activeSlideIdx ?? 0) + 1}/${totalSlides}`;
                                    } else {
                                        counterEl.style.display = '';
                                        counterEl.textContent = `${(activeSlideIdx ?? 0) + 1}/—`;
                                    }
                                }
                                const rect = activeEl.getBoundingClientRect();
                                const containerRect = container.getBoundingClientRect();
                                if (rect.bottom > containerRect.bottom || rect.top < containerRect.top) {
                                    activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                }
                            }
                        }
                        // Delegate to playlist-overview module for slides rendering
                        if (window.dashboardWidgets && window.dashboardWidgets.playlistOverview) {
                            window.dashboardWidgets.playlistOverview._loadPlaylistOverviewSlides(baseUrl, activePresUuid, activeSlideIdx);
                        }
                    });
                })
                .catch(() => {});
        }, 1000);
    },

    _stopPlaylistSlideTracking() {
        if (this._proPresenterPlaylistSlideCheckInterval) {
            clearInterval(this._proPresenterPlaylistSlideCheckInterval);
            this._proPresenterPlaylistSlideCheckInterval = null;
        }
    },

    // ===============================
    //  WEBSOCKET NAVIGATION
    // ===============================

    _getActivePlaylistIndex() {
        const baseUrl = this._getProPresenterBaseUrl();
        return fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(data => {
                const idx = data?.presentation?.playlist?.index;
                if (idx !== undefined && idx !== null) {
                    this._proPresenterPlaylistIndex = idx;
                    return idx;
                }
                return fetch(`${baseUrl}/v1/playlist`, { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json())
                    .then(playlists => {
                        const activeUuid = data?.presentation?.playlist?.uuid;
                        const list = Array.isArray(playlists) ? playlists : (playlists?.playlists || []);
                        const found = list.findIndex(p => p.uuid === activeUuid);
                        this._proPresenterPlaylistIndex = found >= 0 ? found : 0;
                        return this._proPresenterPlaylistIndex;
                    });
            })
            .catch(() => {
                this._proPresenterPlaylistIndex = 0;
                return 0;
            });
    },

    _triggerViaWebSocket(uuid, slideIndex, el) {
        const slideIndexStr = String(slideIndex);
        const itemIndex = el ? parseInt(el.dataset.plItemIndex) : 0;

        const usePlaylistIndex = (idx) => {
            const presentationPath = `${idx}:${itemIndex}`;
            const password = localStorage.getItem('ichtus_pp_ws_password') || '';
            if (!password) {
                console.warn('[WS] Geen wachtwoord in localStorage');
                const baseUrl = this._getProPresenterBaseUrl();
                fetch(`${baseUrl}/v1/presentation/${uuid}/trigger`, { method: 'GET' })
                    .then(() => {
                        setTimeout(() => {
                            fetch(`${baseUrl}/v1/presentation/active/${slideIndex}/trigger`, { method: 'GET' }).catch(() => {});
                        }, 150);
                    })
                    .catch(() => {});
                return;
            }

            const wsUrl = this._getProPresenterWsUrl();
            let ws = null;
            let didAuth = false;
            let didTrigger = false;

            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                ws.send(JSON.stringify({
                    action: 'authenticate',
                    protocol: 701,
                    password: password
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.action === 'authenticate' && !didAuth) {
                        didAuth = true;
                        ws.send(JSON.stringify({
                            action: 'presentationTriggerIndex',
                            slideIndex: slideIndexStr,
                            presentationPath: presentationPath
                        }));
                    }
                    if (msg.action === 'presentationTriggerIndex' && !didTrigger) {
                        didTrigger = true;
                        setTimeout(() => {
                            try { ws.close(); } catch(e) {}
                        }, 100);
                    }
                } catch(e) {}
            };

            setTimeout(() => {
                if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                    try { ws.close(); } catch(e) {}
                }
            }, 2000);

            ws.onerror = () => {
                console.warn('[WS] WebSocket error, falling back to REST');
                const baseUrl = this._getProPresenterBaseUrl();
                fetch(`${baseUrl}/v1/presentation/${uuid}/trigger`, { method: 'GET' })
                    .then(() => {
                        setTimeout(() => {
                            fetch(`${baseUrl}/v1/presentation/active/${slideIndex}/trigger`, { method: 'GET' }).catch(() => {});
                        }, 150);
                    })
                    .catch(() => {});
            };

            ws.onclose = () => {};
        };

        if (this._proPresenterPlaylistIndex !== undefined && this._proPresenterPlaylistIndex !== null) {
            usePlaylistIndex(this._proPresenterPlaylistIndex);
        } else {
            this._getActivePlaylistIndex().then(idx => {
                usePlaylistIndex(idx);
            }).catch(() => {
                usePlaylistIndex(0);
            });
        }
    },

    // ===============================
    //  FULL PLAYLIST RENDERING
    // ===============================

    _loadProPresenterPlaylist() {
        document.querySelectorAll('.widget-card[data-widget-id="propresenter-playlist"]').forEach(el => {
            const mode = el.dataset.ppMode || (typeof localStorage !== 'undefined' ? localStorage.getItem('ichtus_pp_mode') : 'playlist') || 'playlist';
            el.dataset.ppMode = mode;
            el.querySelectorAll('.pp-mode-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.mode === mode);
            });

            if (mode === 'hud') {
                this._renderLiveHud(el);
                this._updateLiveHud(this._getProPresenterBaseUrl(), true);
            } else {
                this._fetchProPresenterPlaylist(el);
            }

            try {
                const pref = localStorage.getItem('ichtus_pp_autoscroll');
                if (pref !== null) {
                    this._playlistAutoScroll = pref === '1';
                    const btn = el.querySelector('.pp-autoscroll-btn');
                    if (btn) {
                        btn.classList.toggle('active', this._playlistAutoScroll);
                        btn.title = this._playlistAutoScroll ? 'Auto-scroll naar actieve slide' : 'Auto-scroll uit';
                    }
                }
            } catch(e) {}
        });
    },

    _refreshPlaylist(btn) {
        const widgetEl = btn.closest('.widget-card');
        if (!widgetEl) return;
        const mode = widgetEl.dataset.ppMode || (typeof localStorage !== 'undefined' ? localStorage.getItem('ichtus_pp_mode') : 'playlist') || 'playlist';
        if (mode === 'hud') {
            this._lastHudThumbKey = null;
            this._updateLiveHud(this._getProPresenterBaseUrl(), true);
        } else {
            this._fetchProPresenterPlaylist(widgetEl);
        }
    },

    _fetchProPresenterPlaylist(widgetEl) {
        this._hasPlaylistData = false;
        const baseUrl = this._getProPresenterBaseUrl();
        const container = widgetEl.querySelector('.widget-body-inner') || widgetEl.querySelector('#propresenter-playlist-container') || widgetEl.querySelector('.widget-body') || widgetEl;

        this._proFetch('/v1/playlist/active', { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(activeData => {
                const pres = activeData?.presentation;
                const ann = activeData?.announcements;
                const playlists = [];
                const currentItemIds = [];

                if (pres?.playlist?.uuid) {
                    playlists.push({ uuid: pres.playlist.uuid, name: pres.playlist.name || '', branch: 'presentation' });
                    if (pres?.item?.uuid) currentItemIds.push(pres.item.uuid);
                }
                if (ann?.playlist?.uuid) {
                    if (!playlists.find(p => p.uuid === ann.playlist.uuid)) {
                        playlists.push({ uuid: ann.playlist.uuid, name: ann.playlist.name || '', branch: 'announcements' });
                    }
                    if (ann?.item?.uuid && !currentItemIds.includes(ann.item.uuid)) {
                        currentItemIds.push(ann.item.uuid);
                    }
                }
                const titleEl = widgetEl.querySelector('.widget-title');

                if (!playlists.length) {
                    if (this._hasPlaylistData) return;
                    const cached = localStorage.getItem('ichtus_pp_playlist_cache');
                    if (cached) {
                        try {
                            const cacheData = JSON.parse(cached);
                            if (cacheData.html) {
                                container.innerHTML = cacheData.html.replace(/<div class="pp-group-badge">\s*Group\s*<\/div>\s*/gi, '');
                                this._hasPlaylistData = true;
                                if (cacheData.uuid && !this._proPresenterPlaylistLastUuid) {
                                    this._proPresenterPlaylistLastUuid = cacheData.uuid;
                                }
                                if (cacheData.title) {
                                    const titleEl = widgetEl.querySelector('.widget-title');
                                    if (titleEl) titleEl.textContent = cacheData.title;
                                }
                                try {
                                    const layoutPref = localStorage.getItem('ichtus_pp_playlist_layout');
                                    if (layoutPref === 'grid') container.classList.add('pp-grid-layout');
                                    else container.classList.remove('pp-grid-layout');
                                } catch (e) {}
                                return;
                            }
                        } catch(e) {
                            container.innerHTML = cached;
                            this._hasPlaylistData = true;
                            return;
                        }
                    }
                    if (titleEl) titleEl.textContent = '';
                    container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">📋</div><div>No active playlist</div></div>`;
                    return;
                }

                const titleNames = playlists.map(p => p.name).filter(Boolean);
                const uniqueNames = [...new Set(titleNames)];
                if (titleEl) titleEl.textContent = `Playlist: ${uniqueNames.join(', ')}`;

                const playlistFetches = playlists.map(p =>
                    this._proFetch(`/v1/playlist/${p.uuid}`, { headers: { 'Accept': 'application/json' } })
                        .then(r => r.json())
                        .then(data => ({ branch: p.branch, data }))
                        .catch(() => null)
                );

                Promise.all([
                    Promise.all(playlistFetches),
                    this._proFetch('/v1/presentation/slide_index', { headers: { 'Accept': 'application/json' } })
                        .then(r => r.json())
                        .catch(() => ({ presentation_index: { index: 0 } })),
                    this._proFetch('/v1/announcement/slide_index', { headers: { 'Accept': 'application/json' } })
                        .then(r => r.json())
                        .catch(() => null)
                ])
                    .then(([playlistResults, slideIndexData, annIndexData]) => {
                        let currentSlideIdx = slideIndexData?.presentation_index?.index ?? null;
                        if (currentSlideIdx === null && annIndexData?.announcement_index?.index !== undefined) {
                            currentSlideIdx = annIndexData.announcement_index.index;
                        }
                        if (currentSlideIdx === null) currentSlideIdx = 0;

                        let combinedItems = [];
                        let alreadySeenUuids = new Set();
                        const sortedResults = [];
                        const presResult = playlistResults.find(r => r && r.branch === 'presentation');
                        const annResult = playlistResults.find(r => r && r.branch === 'announcements');
                        if (presResult) sortedResults.push(presResult);
                        if (annResult) sortedResults.push(annResult);

                        sortedResults.forEach(result => {
                            if (!result?.data?.items) return;
                            result.data.items.forEach(item => {
                                const itemUuid = item?.id?.uuid;
                                if (itemUuid && alreadySeenUuids.has(itemUuid)) return;
                                if (itemUuid) alreadySeenUuids.add(itemUuid);
                                combinedItems.push(item);
                            });
                        });

                        if (!combinedItems.length) {
                            container.innerHTML = `<div class="pp-loading">No items in playlist</div>`;
                            return;
                        }

                        const presentationItems = combinedItems.filter(item => item.type === 'presentation' && item.presentation_info?.presentation_uuid);
                        const presentationPromises = presentationItems.map(item => {
                            const uuid = item.presentation_info.presentation_uuid;
                            return this._proFetch(`/v1/presentation/${uuid}`, { headers: { 'Accept': 'application/json' } })
                                .then(r => r.json())
                                .then(data => {
                                    const presentation = data?.presentation || data?.announcement || data;
                                    const groups = presentation?.groups || [];
                                    const groupMap = new Map();
                                    groups.forEach(g => { if (g?.uuid) groupMap.set(g.uuid, g); });

                                    const targetArrUuid = item.presentation_info?.arrangement_uuid || presentation?.current_arrangement;
                                    const arrangements = presentation?.arrangements || [];
                                    const activeArr = arrangements.find(a => a?.id?.uuid === targetArrUuid)
                                        || arrangements.find(a => a?.name === item.presentation_info?.arrangement_name)
                                        || arrangements[0];

                                    let slides = [];
                                    if (activeArr && Array.isArray(activeArr.groups) && activeArr.groups.length > 0) {
                                        activeArr.groups.forEach(groupUuid => {
                                            const g = groupMap.get(groupUuid);
                                            if (g && Array.isArray(g.slides)) {
                                                g.slides.forEach((s, idxInGrp) => {
                                                    slides.push({
                                                        ...s,
                                                        groupName: g.name,
                                                        groupColor: g.color,
                                                        isFirstInGroup: idxInGrp === 0
                                                    });
                                                });
                                            }
                                        });
                                    } else {
                                        groups.forEach(g => {
                                            if (Array.isArray(g.slides)) {
                                                g.slides.forEach((s, idxInGrp) => {
                                                    slides.push({
                                                        ...s,
                                                        groupName: g.name,
                                                        groupColor: g.color,
                                                        isFirstInGroup: idxInGrp === 0
                                                    });
                                                });
                                            }
                                        });
                                    }

                                    return { uuid, item, slides, groups };
                                })
                                .catch(() => ({ uuid, item, slides: [], groups: [] }));
                        });

                        presentationPromises.length ? Promise.all(presentationPromises).then(presentationResults => {
                            const allSlides = [];
                            let foundActive = false;

                            combinedItems.forEach(item => {
                                if (item.type === 'header') {
                                    const color = item.header_color
                                        ? `rgba(${Math.round(item.header_color.red * 255)}, ${Math.round(item.header_color.green * 255)}, ${Math.round(item.header_color.blue * 255)}, 0.3)`
                                        : 'rgba(255,255,255,0.05)';
                                    allSlides.push({ type: 'header', name: item.id?.name || '', color, isActive: currentItemIds.includes(item.id?.uuid) });
                                } else if (item.type === 'presentation') {
                                    const result = presentationResults.find(r => r.uuid === item.presentation_info?.presentation_uuid);
                                    const slides = result?.slides || [];
                                    const isActiveItem = currentItemIds.includes(item.id?.uuid);
                                    if (slides.length > 0) {
                                        allSlides.push({ type: 'presentation-header', name: item.id?.name || '', isActive: isActiveItem });
                                    }

                                    slides.forEach((slide, slideIdx) => {
                                        const isActive = isActiveItem && slideIdx === currentSlideIdx;
                                        if (isActive) foundActive = true;
                                        let bestUrl = null;
                                        if (slide?.image && slide.image.startsWith('data:')) bestUrl = slide.image;
                                        else if (slide?.image && (slide.image.startsWith('http://') || slide.image.startsWith('https://'))) bestUrl = slide.image;
                                        else if (slide?.image && slide.image.startsWith('/')) bestUrl = '/api/pro' + slide.image;
                                        else if (slide?.image) bestUrl = 'data:image/jpeg;base64,' + slide.image;
                                        else if (slide?.thumb_url) bestUrl = slide.thumb_url;
                                        else if (slide?.thumbnail) bestUrl = slide.thumbnail;
                                        else if (slide?.image_url) bestUrl = slide.image_url;

                                        const groupName = slide.isFirstInGroup ? ((slide.groupName && slide.groupName.toLowerCase() !== 'group') ? slide.groupName : null) : null;

                                        allSlides.push({
                                            type: 'slide', uuid: item.presentation_info.presentation_uuid,
                                            itemIndex: item.id?.index ?? 0, slideIndex: slideIdx,
                                            label: slide.label || item.id?.name || '', isActive,
                                            thumbUrl: bestUrl, groupName,
                                            text: slide.text || ''
                                        });
                                    });
                                }
                            });

                            this._renderPlaylistSlides(container, allSlides, baseUrl);
                            this._hasPlaylistData = true;

                            const activeCombinedKey = playlists.map(p => p.uuid).join('|');
                            if (activeCombinedKey) this._proPresenterPlaylistLastUuid = activeCombinedKey;

                            try {
                                const titleEl = widgetEl.querySelector('.widget-title');
                                const cachedTitle = titleEl ? titleEl.textContent : '';
                                localStorage.setItem('ichtus_pp_playlist_cache', JSON.stringify({
                                    html: container.innerHTML, uuid: this._proPresenterPlaylistLastUuid || '', title: cachedTitle
                                }));
                            } catch(e) {}

                            try {
                                const layoutPref = localStorage.getItem('ichtus_pp_playlist_layout');
                                const btn = widgetEl.querySelector('.pp-layout-toggle');
                                if (layoutPref === 'grid') {
                                    container.classList.add('pp-grid-layout');
                                    if (btn) btn.textContent = '☰ Weergave';
                                } else {
                                    container.classList.remove('pp-grid-layout');
                                    if (btn) btn.textContent = '⊞ Weergave';
                                }
                            } catch (e) {}
                        }).catch(() => {
                            container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>Failed to load presentations</div></div>`;
                        }) : (container.innerHTML = `<div class="pp-loading">No items in playlist</div>`);
                    })
                    .catch(() => {
                        container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>Failed to load playlist items</div></div>`;
                    });
            })
            .catch(err => {
                const cached = localStorage.getItem('ichtus_pp_playlist_cache');
                if (cached) {
                    try {
                        const cacheData = JSON.parse(cached);
                        if (cacheData.html) {
                            container.innerHTML = cacheData.html.replace(/<div class="pp-group-badge">\s*Group\s*<\/div>\s*/gi, '');
                            this._hasPlaylistData = true;
                            if (cacheData.uuid && !this._proPresenterPlaylistLastUuid) this._proPresenterPlaylistLastUuid = cacheData.uuid;
                            if (cacheData.title) { const t = widgetEl.querySelector('.widget-title'); if (t) t.textContent = cacheData.title; }
                            return;
                        }
                    } catch(e) {}
                }
                container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>ProPresenter offline</div><div style="font-size:0.75rem;margin-top:0.5rem;color:#888;">${this._escapeHtml(err.message)}</div></div>`;
            });
    },

    _renderPlaylistSlides(container, allSlides, baseUrl) {
        if (!allSlides.length) {
            container.innerHTML = `<div class="pp-loading">No slides in playlist</div>`;
            return;
        }
        let html = '';
        allSlides.forEach((item) => {
            if (item.type === 'header') {
                const safeColor = this._escapeHtml(item.color || '');
                html += `<div class="pl-slide-header" style="border-left: 4px solid ${safeColor}; background: ${safeColor.replace('0.3', '0.08')};">
                    <span class="pl-header-label">${this._escapeHtml(item.name)}</span>
                </div>`;
            } else if (item.type === 'presentation-header') {
                html += `<div class="pl-presentation-header${item.isActive ? ' active' : ''}">
                    <span class="pl-header-label">${this._escapeHtml(item.name)}</span>
                </div>`;
            } else {
                const activeClass = item.isActive ? ' active' : '';
                const safeUuid = this._escapeHtml(item.uuid || '');
                const safeSlideIdx = Number(item.slideIndex) || 0;
                const safeItemIdx = Number(item.itemIndex) || 0;
                const directFallback = item.uuid ? `${baseUrl}/v1/presentation/${encodeURIComponent(item.uuid)}/thumbnail/${safeSlideIdx}` : '';
                let thumbUrl = item.thumbUrl || directFallback || `/api/pro/presentation/${encodeURIComponent(item.uuid || '')}/thumbnail/${safeSlideIdx}`;
                const labelAttr = this._escapeHtml(item.label || '');
                const groupBadge = item.groupName ? `<div class="pp-group-badge">${this._escapeHtml(item.groupName)}</div>` : '';
                const slideTitle = this._escapeHtml(item.label || item.text || `Slide ${safeSlideIdx + 1}`);
                const proxyFallback = item.uuid ? `/api/pro/presentation/${encodeURIComponent(item.uuid)}/thumbnail/${safeSlideIdx}` : '';
                html += `<div class="pp-slide-item${activeClass}" 
                            data-pl-uuid="${safeUuid}" 
                            data-pl-item-index="${safeItemIdx}" 
                            data-pl-slide-index="${safeSlideIdx}"
                            onclick="dashboardModule._triggerPlaylistSlide('${safeUuid}', ${safeSlideIdx}, this)">
                    ${groupBadge}
                    <img class="pp-slide-thumb" src="${this._escapeHtml(thumbUrl)}" alt="${labelAttr}" loading="lazy"
                         onerror="if(!this.dataset.retry && '${proxyFallback}'){this.dataset.retry='1';this.src='${proxyFallback}';}else{this.style.opacity='0';}"
                         onload="this.style.opacity='1'" />
                    <div class="pp-slide-fallback-label" title="${slideTitle}">${slideTitle}</div>
                </div>`;
            }
        });
        container.innerHTML = html;
        if (this._playlistAutoScroll) {
            const activeEl = container.querySelector('.pp-slide-item.active');
            if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    _triggerPlaylistSlide(uuid, slideIndex, el) {
        if (el) {
            el.classList.remove('pp-triggered');
            void el.offsetWidth;
            el.classList.add('pp-triggered');
            setTimeout(() => el.classList.remove('pp-triggered'), 350);
        }
        this._triggerViaWebSocket(uuid, slideIndex, el);
    },

    _togglePlaylistSettingsDropdown(event) {
        event.stopPropagation();
        const btn = event.currentTarget;
        if (!btn) return;
        const wrap = btn.closest('.pp-settings-wrap');
        const dropdown = wrap ? wrap.querySelector('.pp-settings-dropdown') : null;
        if (!dropdown) return;
        document.querySelectorAll('.pp-settings-dropdown.show').forEach(el => {
            if (el !== dropdown) el.classList.remove('show');
        });
        dropdown.classList.toggle('show');
        btn.classList.toggle('active', dropdown.classList.contains('show'));
        if (dropdown.classList.contains('show')) {
            const closeHandler = (e) => {
                if (wrap && !wrap.contains(e.target)) {
                    dropdown.classList.remove('show');
                    btn.classList.remove('active');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    },

    _toggleAutoScroll(btn) {
        this._playlistAutoScroll = !this._playlistAutoScroll;
        btn.classList.toggle('active', this._playlistAutoScroll);
        btn.title = this._playlistAutoScroll ? 'Auto-scroll naar actieve slide' : 'Auto-scroll uit';
        try { localStorage.setItem('ichtus_pp_autoscroll', this._playlistAutoScroll ? '1' : '0'); } catch(e) {}
    },

    _togglePlaylistLayout(btn) {
        const widgetEl = btn.closest('.widget-card');
        const container = widgetEl.querySelector('.widget-propresenter');
        if (!container) return;
        const isGrid = container.classList.toggle('pp-grid-layout');
        btn.textContent = isGrid ? '☰ Weergave' : '⊞ Weergave';
        try { localStorage.setItem('ichtus_pp_playlist_layout', isGrid ? 'grid' : 'single'); } catch(e) {}
    },

    // ==========================================
    //  MXU-STYLE LIVE CONFIDENCE HUD INTEGRATION
    // ==========================================

    _lastHudThumbKey: null,

    _setProPresenterMode(mode, btn) {
        try { localStorage.setItem('ichtus_pp_mode', mode); } catch(e) {}
        const widgetCard = btn ? btn.closest('.widget-card') : document.querySelector('.widget-card[data-widget-id="propresenter-playlist"]');
        if (!widgetCard) return;

        widgetCard.dataset.ppMode = mode;
        widgetCard.querySelectorAll('.pp-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });

        const container = widgetCard.querySelector('.widget-body-inner') || widgetCard.querySelector('#propresenter-playlist-container') || widgetCard.querySelector('.widget-body');
        if (!container) return;

        if (mode === 'hud') {
            container.innerHTML = '';
            this._renderLiveHud(widgetCard);
            this._lastHudThumbKey = null;
            this._updateLiveHud(this._getProPresenterBaseUrl(), true);
        } else {
            container.innerHTML = '<div class="pp-loading">Loading playlist…</div>';
            this._fetchProPresenterPlaylist(widgetCard);
        }
    },

    _renderLiveHud(widgetEl) {
        const container = widgetEl.querySelector('.widget-body-inner') || widgetEl.querySelector('#propresenter-playlist-container') || widgetEl.querySelector('.widget-body') || widgetEl;
        if (!container) return;

        // If HUD is already in the DOM, do not destroy it (preserves smooth state)
        if (container.querySelector('.pp-hud-container')) return;

        container.innerHTML = `
            <div class="pp-hud-container">
                <!-- Transport & Layer Clear Bar -->
                <div class="pp-hud-toolbar">
                    <div class="pp-hud-transport">
                        <button type="button" class="pp-hud-btn pp-btn-prev" onclick="dashboardModule._proPrev(this)" title="Vorige slide">
                            ◀ <span>Vorige</span>
                        </button>
                        <button type="button" class="pp-hud-btn pp-btn-next" onclick="dashboardModule._proNext(this)" title="Volgende slide">
                            <span>Volgende</span> ▶
                        </button>
                    </div>
                    <div class="pp-hud-clears">
                        <button type="button" class="pp-hud-btn pp-clear-btn pp-clear-all" onclick="dashboardModule._proClear('all', this)" title="Wis alle actieve lagen (All Clear)">
                            🚫 <span>Clear All</span>
                        </button>
                        <button type="button" class="pp-hud-btn pp-clear-btn" onclick="dashboardModule._proClear('slide', this)" title="Wis alleen slide tekst (video blijft)">
                            🔤 <span>Slide</span>
                        </button>
                        <button type="button" class="pp-hud-btn pp-clear-btn" onclick="dashboardModule._proClear('media', this)" title="Wis alleen achtergrond video/media">
                            🖼️ <span>Media</span>
                        </button>
                        <button type="button" class="pp-hud-btn pp-clear-btn" onclick="dashboardModule._proClear('messages', this)" title="Wis actieve berichten">
                            💬 <span>Berichten</span>
                        </button>
                    </div>
                </div>

                <!-- Dual Confidence Monitor Cards (Live vs Next) -->
                <div class="pp-hud-cards">
                    <!-- LIVE CARD -->
                    <div class="pp-hud-card pp-hud-live">
                        <div class="pp-hud-card-header">
                            <span class="pp-hud-badge pp-badge-live"><span class="pp-live-dot"></span> LIVE</span>
                            <span class="pp-hud-title" id="pp-live-title">Laden...</span>
                            <span class="pp-hud-index-badge" id="pp-live-index">—</span>
                        </div>
                        <div class="pp-hud-thumb-wrap">
                            <img id="pp-live-thumb" class="pp-hud-thumb" src="" alt="Live Slide Preview" onerror="this.style.opacity='0'" onload="this.style.opacity='1'" />
                            <div class="pp-hud-empty-placeholder" id="pp-live-placeholder">Geen actieve slide</div>
                        </div>
                        <div class="pp-hud-lyrics-box">
                            <div class="pp-hud-lyrics-label">LIVE OP SCHERM</div>
                            <div class="pp-hud-lyrics-text" id="pp-live-text">—</div>
                        </div>
                    </div>

                    <!-- NEXT CUE CARD -->
                    <div class="pp-hud-card pp-hud-next">
                        <div class="pp-hud-card-header">
                            <span class="pp-hud-badge pp-badge-next">⏭️ VOLGENDE</span>
                            <span class="pp-hud-title" id="pp-next-title">Laden...</span>
                            <span class="pp-hud-index-badge" id="pp-next-index">—</span>
                        </div>
                        <div class="pp-hud-thumb-wrap" onclick="dashboardModule._proNext(this)" style="cursor: pointer;" title="Klik om volgende cue te triggeren">
                            <img id="pp-next-thumb" class="pp-hud-thumb" src="" alt="Volgende Slide Preview" onerror="this.style.opacity='0'" onload="this.style.opacity='1'" />
                            <div class="pp-hud-empty-placeholder" id="pp-next-placeholder">Geen volgende slide</div>
                        </div>
                        <div class="pp-hud-lyrics-box">
                            <div class="pp-hud-lyrics-label">AANKOMENDE TEKST</div>
                            <div class="pp-hud-lyrics-text" id="pp-next-text">—</div>
                        </div>
                    </div>
                </div>

                <!-- Stage Display Flash Message Strip -->
                <div class="pp-hud-stage-bar">
                    <div class="pp-hud-stage-input-wrap">
                        <span class="pp-stage-icon" title="Stage Screen Message">📢</span>
                        <input type="text" id="pp-stage-msg-input" class="pp-stage-input" placeholder="Stuur direct bericht naar podium monitor..." onkeydown="if(event.key==='Enter') dashboardModule._sendCustomStageMessage()" />
                        <button type="button" class="pp-hud-btn pp-btn-send-stage" onclick="dashboardModule._sendCustomStageMessage()" title="Verstuur bericht naar stage">Stuur</button>
                        <button type="button" class="pp-hud-btn pp-btn-clear-stage" onclick="dashboardModule._clearStageMessage()" title="Wis stage bericht">Wis</button>
                    </div>
                    <div class="pp-hud-stage-chips">
                        <span class="pp-stage-chip-label">Snelkeuze:</span>
                        <button type="button" class="pp-stage-chip" onclick="dashboardModule._sendQuickStageMessage('⏱️ 1 Minuut')">1 Min</button>
                        <button type="button" class="pp-stage-chip" onclick="dashboardModule._sendQuickStageMessage('⏱️ 5 Minuten')">5 Min</button>
                        <button type="button" class="pp-stage-chip" onclick="dashboardModule._sendQuickStageMessage('🛑 Afronden a.u.b.')">Afronden</button>
                        <button type="button" class="pp-stage-chip" onclick="dashboardModule._sendQuickStageMessage('🎤 Zang harder')">Zang +</button>
                        <button type="button" class="pp-stage-chip" onclick="dashboardModule._sendQuickStageMessage('🔇 Mic zachter')">Mic -</button>
                    </div>
                </div>
            </div>
        `;
    },

    _updateLiveHud(baseUrl, force = false) {
        if (!baseUrl) baseUrl = this._getProPresenterBaseUrl();
        const hudContainers = document.querySelectorAll('.pp-hud-container');
        if (!hudContainers.length) return;

        // Fetch slide index (presentation + announcement) & status in parallel
        Promise.all([
            this._proFetch('/v1/status/slide', { headers: { 'Accept': 'application/json' } })
                .then(r => r.ok ? r.json() : null)
                .catch(() => null),
            this._proFetch('/v1/presentation/slide_index', { headers: { 'Accept': 'application/json' } })
                .then(r => r.ok ? r.json() : null)
                .catch(() => null),
            this._proFetch('/v1/announcement/slide_index', { headers: { 'Accept': 'application/json' } })
                .then(r => r.ok ? r.json() : null)
                .catch(() => null)
        ]).then(([statusData, indexData, annData]) => {
            let curText = statusData?.current?.text || '';
            let nextText = statusData?.next?.text || '';
            let curTitle = statusData?.current?.presentation_id?.name || indexData?.presentation_index?.presentation_id?.name || '';
            let nextTitle = statusData?.next?.presentation_id?.name || curTitle;

            let curIndex = indexData?.presentation_index?.index ?? statusData?.current?.index ?? null;
            let curUuid = statusData?.current?.presentation_id?.uuid || indexData?.presentation_index?.presentation_id?.uuid || null;

            // If presentation is null but announcement is running (e.g. Loop voor de dienst):
            if (!curUuid && annData?.announcement_index?.presentation_id?.uuid) {
                curUuid = annData.announcement_index.presentation_id.uuid;
                curIndex = annData.announcement_index.index ?? 0;
                curTitle = annData.announcement_index.presentation_id.name || 'Aankondigingen';
                nextTitle = curTitle;
            }

            if (curIndex === null) curIndex = 0;
            let nextIndex = statusData?.next?.index ?? (curIndex + 1);
            let nextUuid = statusData?.next?.presentation_id?.uuid || curUuid;

            if (!curText && curUuid) {
                this._proFetch(`/v1/presentation/${curUuid}`, { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json())
                    .then(presData => {
                        const presentation = presData?.presentation || presData?.announcement || presData;
                        const groups = presentation?.groups || [];
                        const groupMap = new Map();
                        groups.forEach(g => { if (g?.uuid) groupMap.set(g.uuid, g); });

                        const targetArrUuid = presentation?.current_arrangement;
                        const arrangements = presentation?.arrangements || [];
                        const activeArr = arrangements.find(a => a?.id?.uuid === targetArrUuid) || arrangements[0];

                        let slides = [];
                        if (activeArr && Array.isArray(activeArr.groups) && activeArr.groups.length > 0) {
                            activeArr.groups.forEach(groupUuid => {
                                const g = groupMap.get(groupUuid);
                                if (g && Array.isArray(g.slides)) {
                                    slides.push(...g.slides.map(s => ({ ...s, groupName: g.name })));
                                }
                            });
                        } else {
                            slides = groups.flatMap(g => (g.slides || []).map(s => ({ ...s, groupName: g.name })));
                        }
                        if (slides[curIndex]) {
                            curText = slides[curIndex].text || slides[curIndex].label || '';
                        }
                        if (slides[nextIndex]) {
                            nextText = slides[nextIndex].text || slides[nextIndex].label || '';
                        }
                        this._applyHudValues(baseUrl, curTitle, curIndex, curUuid, curText, nextTitle, nextIndex, nextUuid, nextText, force);
                    })
                    .catch(() => {
                        this._applyHudValues(baseUrl, curTitle, curIndex, curUuid, curText, nextTitle, nextIndex, nextUuid, nextText, force);
                    });
                return;
            }

            this._applyHudValues(baseUrl, curTitle, curIndex, curUuid, curText, nextTitle, nextIndex, nextUuid, nextText, force);
        }).catch(err => {
            console.warn('[HUD] Status fetch error:', err);
        });
    },

    _applyHudValues(baseUrl, curTitle, curIndex, curUuid, curText, nextTitle, nextIndex, nextUuid, nextText, force) {
        const liveTitleEl = document.getElementById('pp-live-title');
        const liveIndexEl = document.getElementById('pp-live-index');
        const liveThumbEl = document.getElementById('pp-live-thumb');
        const livePlaceholderEl = document.getElementById('pp-live-placeholder');
        const liveTextEl = document.getElementById('pp-live-text');

        const nextTitleEl = document.getElementById('pp-next-title');
        const nextIndexEl = document.getElementById('pp-next-index');
        const nextThumbEl = document.getElementById('pp-next-thumb');
        const nextPlaceholderEl = document.getElementById('pp-next-placeholder');
        const nextTextEl = document.getElementById('pp-next-text');

        if (liveTitleEl && curTitle) liveTitleEl.textContent = curTitle;
        if (liveIndexEl) liveIndexEl.textContent = (curIndex !== null && curIndex !== undefined) ? `Slide ${curIndex + 1}` : '—';
        if (liveTextEl) liveTextEl.textContent = curText || '(Geen tekst / achtergrond media)';

        if (nextTitleEl && nextTitle) nextTitleEl.textContent = nextTitle;
        if (nextIndexEl) nextIndexEl.textContent = (nextIndex !== null && nextIndex !== undefined) ? `Slide ${nextIndex + 1}` : '—';
        if (nextTextEl) nextTextEl.textContent = nextText || '(Einde van presentatie)';

        // Update thumbnails
        const stateKey = `${curUuid}_${curIndex}_${nextUuid}_${nextIndex}`;
        if (this._lastHudThumbKey !== stateKey || force) {
            this._lastHudThumbKey = stateKey;
            if (liveThumbEl) {
                const directLive = curUuid
                    ? `${baseUrl}/v1/presentation/${encodeURIComponent(curUuid)}/thumbnail/${curIndex}?t=${Date.now()}`
                    : '';
                const liveUrl = directLive || (curUuid
                    ? `/api/pro/presentation/${encodeURIComponent(curUuid)}/thumbnail/${curIndex}?t=${Date.now()}`
                    : `/api/pro/presentation/active/thumbnail/${curIndex}?t=${Date.now()}`);
                const proxyFallback = curUuid ? `/api/pro/presentation/${encodeURIComponent(curUuid)}/thumbnail/${curIndex}` : '';
                liveThumbEl.onerror = function() {
                    if (!this.dataset.retry && proxyFallback) {
                        this.dataset.retry = '1';
                        this.src = proxyFallback;
                    } else {
                        this.style.opacity = '0';
                    }
                };
                liveThumbEl.onload = function() {
                    this.style.opacity = '1';
                };
                liveThumbEl.dataset.retry = '';
                liveThumbEl.src = liveUrl;
                if (livePlaceholderEl) livePlaceholderEl.style.display = 'none';
            }
            if (nextThumbEl) {
                const directNext = nextUuid
                    ? `${baseUrl}/v1/presentation/${encodeURIComponent(nextUuid)}/thumbnail/${nextIndex}?t=${Date.now()}`
                    : '';
                const nextUrl = directNext || (nextUuid
                    ? `/api/pro/presentation/${encodeURIComponent(nextUuid)}/thumbnail/${nextIndex}?t=${Date.now()}`
                    : `/api/pro/presentation/active/thumbnail/${nextIndex}?t=${Date.now()}`);
                const proxyFallback = nextUuid ? `/api/pro/presentation/${encodeURIComponent(nextUuid)}/thumbnail/${nextIndex}` : '';
                nextThumbEl.onerror = function() {
                    if (!this.dataset.retry && proxyFallback) {
                        this.dataset.retry = '1';
                        this.src = proxyFallback;
                    } else {
                        this.style.opacity = '0';
                    }
                };
                nextThumbEl.onload = function() {
                    this.style.opacity = '1';
                };
                nextThumbEl.dataset.retry = '';
                nextThumbEl.src = nextUrl;
                if (nextPlaceholderEl) nextPlaceholderEl.style.display = 'none';
            }
        }
    },

    _proPrev(btn) {
        if (btn) {
            btn.classList.add('pp-triggered');
            setTimeout(() => btn.classList.remove('pp-triggered'), 200);
        }
        this._proFetch('/v1/presentation/active/previous/trigger', { method: 'GET' })
            .catch(() => this._proFetch('/v1/announcement/active/previous/trigger', { method: 'GET' }))
            .catch(() => {});
        setTimeout(() => this._updateLiveHud(null, true), 150);
    },

    _proNext(btn) {
        if (btn) {
            btn.classList.add('pp-triggered');
            setTimeout(() => btn.classList.remove('pp-triggered'), 200);
        }
        this._proFetch('/v1/presentation/active/next/trigger', { method: 'GET' })
            .catch(() => this._proFetch('/v1/announcement/active/next/trigger', { method: 'GET' }))
            .catch(() => {});
        setTimeout(() => this._updateLiveHud(null, true), 150);
    },

    _proClear(layer, btn) {
        if (btn) {
            btn.classList.add('pp-triggered');
            setTimeout(() => btn.classList.remove('pp-triggered'), 250);
        }
        if (layer === 'all') {
            this._proFetch('/v1/clear/layer/slide', { method: 'GET' }).catch(() => {});
            this._proFetch('/v1/clear/layer/media', { method: 'GET' }).catch(() => {});
            this._proFetch('/v1/clear/layer/messages', { method: 'GET' }).catch(() => {});
            this._proFetch('/v1/clear/layer/props', { method: 'GET' }).catch(() => {});
            this._proFetch('/v1/presentation/active/clear', { method: 'GET' }).catch(() => {});
            if (typeof dashboardModule !== 'undefined' && dashboardModule.showToast) {
                dashboardModule.showToast('Clear All geactiveerd');
            }
        } else {
            this._proFetch(`/v1/clear/layer/${layer}`, { method: 'GET' }).catch(() => {});
            if (typeof dashboardModule !== 'undefined' && dashboardModule.showToast) {
                dashboardModule.showToast(`Clear ${layer} geactiveerd`);
            }
        }
        setTimeout(() => this._updateLiveHud(null, true), 200);
    },

    _sendCustomStageMessage() {
        const input = document.getElementById('pp-stage-msg-input');
        if (!input) return;
        const msg = (input.value || '').trim();
        if (!msg) return;
        this._sendQuickStageMessage(msg);
        input.value = '';
    },

    _sendQuickStageMessage(text) {
        if (!text) return;
        this._proFetch('/v1/stage/message', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        }).catch(() => {});
        if (typeof dashboardModule !== 'undefined' && dashboardModule.showToast) {
            dashboardModule.showToast(`Stage bericht: "${text}"`);
        }
    },

    _clearStageMessage() {
        this._proFetch('/v1/stage/message', { method: 'DELETE' }).catch(() => {});
        if (typeof dashboardModule !== 'undefined' && dashboardModule.showToast) {
            dashboardModule.showToast('Stage bericht gewist');
        }
    }
};
