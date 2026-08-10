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

    _getProPresenterBaseUrl() {
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
        return `http://${ip}:${port}`;
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
        const baseUrl = this._getProPresenterBaseUrl();
        Promise.all([
            fetch(`${baseUrl}/v1/presentation/active`, { headers: { 'Accept': 'application/json' } })
                .then(r => r.text()),
            fetch(`${baseUrl}/v1/presentation/slide_index`, { headers: { 'Accept': 'application/json' } })
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
                const slides = presentation?.groups
                    ? presentation.groups.flatMap(g => g.slides || [])
                    : (presentation?.slides || []);
                const uuid = presentation?.id?.uuid || null;
                this._proPresenterLastIndex = currentIdx;
                this._proPresenterLastPresentationUuid = slideIndexData?.presentation_index?.presentation_id?.uuid || null;
                this._proPresenterSlideCount = slides.length;
                this._renderSlides(widgetEl, slides, currentIdx, uuid, '');
                // Update title
                fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
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
                const container = widgetEl.querySelector('#propresenter-slides-container') || widgetEl.querySelector('.widget-body') || widgetEl;
                container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>ProPresenter offline</div><div style="font-size:0.75rem;margin-top:0.5rem;color:#888;">${err.message}</div></div>`;
            });
    },

    _renderSlides(widgetEl, slides, currentIdx, uuid, playlistName) {
        const container = widgetEl.querySelector('#propresenter-slides-container') || widgetEl.querySelector('.widget-body') || widgetEl;
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
                if (slide.image.startsWith('/')) return baseUrl + slide.image;
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
            html += `<div class="pp-slide-item${activeClass}" data-slide-index="${idx}" onclick="dashboardModule._triggerSlide(${idx})">
                <img class="pp-slide-thumb" src="${thumbUrl}" alt="Slide ${idx + 1}" loading="lazy" onerror="this.style.visibility='hidden'" />
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
        const baseUrl = this._getProPresenterBaseUrl();
        document.querySelectorAll('.pp-slide-item[data-slide-index="' + index + '"]').forEach(el => {
            el.classList.remove('pp-triggered');
            void el.offsetWidth;
            el.classList.add('pp-triggered');
            setTimeout(() => el.classList.remove('pp-triggered'), 350);
        });
        fetch(`${baseUrl}/v1/presentation/active/${index}/trigger`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        }).catch(() => {});
    },

    _pollProPresenterIndex(widgetEl) {
        const baseUrl = this._getProPresenterBaseUrl();
        fetch(`${baseUrl}/v1/presentation/slide_index`, {
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
                    const container = widgetEl.querySelector('#propresenter-slides-container') || widgetEl.querySelector('.widget-body') || widgetEl;
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
        const baseUrl = this._getProPresenterBaseUrl();
        this._proPresenterPlaylistCheckInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
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
            fetch(`${baseUrl}/v1/presentation/slide_index`, {
                headers: { 'Accept': 'application/json' }
            })
                .then(r => r.json())
                .then(data => {
                    const activePresUuid = data?.presentation_index?.presentation_id?.uuid || null;
                    const activeSlideIdx = data?.presentation_index?.index ?? 0;
                    this._proPresenterCurrentSlideIdx = activeSlideIdx;

                    // Update active slide in all propresenter-playlist widgets
                    document.querySelectorAll('.widget-card[data-widget-id="propresenter-playlist"]').forEach(widget => {
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
                                    counterEl.style.display = '';
                                    counterEl.textContent = `${(activeSlideIdx ?? 0) + 1}/${this._playlistOverviewSlidesData?.length || '?'}`;
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
            this._fetchProPresenterPlaylist(el);
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
        if (widgetEl) this._fetchProPresenterPlaylist(widgetEl);
    },

    _fetchProPresenterPlaylist(widgetEl) {
        this._hasPlaylistData = false;
        const baseUrl = this._getProPresenterBaseUrl();
        const container = widgetEl.querySelector('#propresenter-playlist-container') || widgetEl.querySelector('.widget-body') || widgetEl;

        fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
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
                    fetch(`${baseUrl}/v1/playlist/${p.uuid}`, { headers: { 'Accept': 'application/json' } })
                        .then(r => r.json())
                        .then(data => ({ branch: p.branch, data }))
                        .catch(() => null)
                );

                Promise.all([
                    Promise.all(playlistFetches),
                    fetch(`${baseUrl}/v1/presentation/slide_index`, { headers: { 'Accept': 'application/json' } })
                        .then(r => r.json())
                        .catch(() => ({ presentation_index: { index: 0 } }))
                ])
                    .then(([playlistResults, slideIndexData]) => {
                        const currentSlideIdx = slideIndexData?.presentation_index?.index ?? 0;
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
                            return fetch(`${baseUrl}/v1/presentation/${uuid}`, { headers: { 'Accept': 'application/json' } })
                                .then(r => r.json())
                                .then(data => {
                                    const groups = data?.presentation?.groups || [];
                                    const slides = groups.flatMap(g => g.slides || []);
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
                                    const resultGroups = result?.groups || [];
                                    let globalSlideIdx = 0;
                                    const groupFirstSlides = new Set();
                                    resultGroups.forEach(g => {
                                        const groupSlides = g.slides || [];
                                        if (groupSlides.length > 0) {
                                            groupFirstSlides.add(globalSlideIdx);
                                            globalSlideIdx += groupSlides.length;
                                        }
                                    });

                                    slides.forEach((slide, slideIdx) => {
                                        const isActive = isActiveItem && slideIdx === currentSlideIdx;
                                        if (isActive) foundActive = true;
                                        let bestUrl = null;
                                        if (slide?.image && slide.image.startsWith('data:')) bestUrl = slide.image;
                                        else if (slide?.image && (slide.image.startsWith('http://') || slide.image.startsWith('https://'))) bestUrl = slide.image;
                                        else if (slide?.image && slide.image.startsWith('/')) bestUrl = baseUrl + slide.image;
                                        else if (slide?.image) bestUrl = 'data:image/jpeg;base64,' + slide.image;
                                        else if (slide?.thumb_url) bestUrl = slide.thumb_url;
                                        else if (slide?.thumbnail) bestUrl = slide.thumbnail;
                                        else if (slide?.image_url) bestUrl = slide.image_url;

                                        let groupName = null;
                                        if (groupFirstSlides.has(slideIdx)) {
                                            let cursor = 0;
                                            for (const g of resultGroups) {
                                                const gSlides = g.slides || [];
                                                if (cursor === slideIdx && gSlides.length > 0) {
                                                    const rawName = g.name || '';
                                                    groupName = (rawName.toLowerCase() === 'group') ? null : rawName;
                                                    break;
                                                }
                                                cursor += gSlides.length;
                                            }
                                        }
                                        allSlides.push({
                                            type: 'slide', uuid: item.presentation_info.presentation_uuid,
                                            itemIndex: item.id?.index ?? 0, slideIndex: slideIdx,
                                            label: slide.label || item.id?.name || '', isActive,
                                            thumbUrl: bestUrl, groupName
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
                container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>ProPresenter offline</div><div style="font-size:0.75rem;margin-top:0.5rem;color:#888;">${err.message}</div></div>`;
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
                html += `<div class="pl-slide-header" style="border-left: 4px solid ${item.color}; background: ${item.color.replace('0.3', '0.08')};">
                    <span class="pl-header-label">${item.name}</span>
                </div>`;
            } else if (item.type === 'presentation-header') {
                html += `<div class="pl-presentation-header${item.isActive ? ' active' : ''}">
                    <span class="pl-header-label">${item.name}</span>
                </div>`;
            } else {
                const activeClass = item.isActive ? ' active' : '';
                let thumbUrl = item.thumbUrl || `${baseUrl}/v1/presentation/${item.uuid}/thumbnail/${item.slideIndex}`;
                const labelAttr = (item.label || '').replace(/'/g, "&#39;").replace(/"/g, "&quot;");
                const groupBadge = item.groupName ? `<div class="pp-group-badge">${item.groupName.replace(/'/g, "&#39;").replace(/"/g, "&quot;")}</div>` : '';
                html += `<div class="pp-slide-item${activeClass}" 
                            data-pl-uuid="${item.uuid}" 
                            data-pl-item-index="${item.itemIndex}" 
                            data-pl-slide-index="${item.slideIndex}"
                            onclick="dashboardModule._triggerPlaylistSlide('${item.uuid}', ${item.slideIndex}, this)">
                    ${groupBadge}
                    <img class="pp-slide-thumb" src="${thumbUrl}" alt="${labelAttr}" loading="lazy" onerror="this.style.visibility='hidden'" />
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
    }
};
