/**
 * Playlist Overview Widget Module
 * 
 * Shows the full playlist structure: presentation names, headers,
 * and announcements without individual slides.
 * 
 * Namespace: window.dashboardWidgets.playlistOverview
 */
window.dashboardWidgets = window.dashboardWidgets || {};
window.dashboardWidgets.playlistOverview = {

    _loadPlaylistOverview() {
        document.querySelectorAll('.widget-card[data-widget-id="playlist-overview"]').forEach(el => {
            this._fetchPlaylistOverview(el);
        });
    },

    _refreshPlaylistOverview(btn) {
        const widgetEl = btn.closest('.widget-card');
        if (widgetEl) this._fetchPlaylistOverview(widgetEl);
    },

    _startPlaylistOverviewPolling() {
        this._stopPlaylistOverviewPolling();
        this._loadPlaylistOverview();
        this._playlistOverviewInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            this._loadPlaylistOverview();
        }, 10000);
    },

    _stopPlaylistOverviewPolling() {
        if (this._playlistOverviewInterval) {
            clearInterval(this._playlistOverviewInterval);
            this._playlistOverviewInterval = null;
        }
    },

    _fetchPlaylistOverview(widgetEl) {
        const baseUrl = this._getProPresenterBaseUrl();
        const container = widgetEl.querySelector('#playlist-overview-container') || widgetEl.querySelector('.widget-body') || widgetEl;
        const liveBadge = widgetEl.querySelector('#plo-live-badge');

        fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(activeData => {
                const pres = activeData?.presentation;
                const ann = activeData?.announcements;

                if (liveBadge) {
                    liveBadge.classList.remove('offline');
                    liveBadge.innerHTML = '<span class="plo-v2-live-dot"></span> LIVE';
                }

                const playlists = [];
                let activeItemIds = [];
                const hasActivePresentation = !!pres?.item?.uuid;

                if (pres?.playlist?.uuid) {
                    playlists.push({ uuid: pres.playlist.uuid, name: pres.playlist.name || '', branch: 'presentation' });
                    if (pres?.item?.uuid) activeItemIds.push(pres.item.uuid);
                }
                if (ann?.playlist?.uuid) {
                    if (!playlists.find(p => p.uuid === ann.playlist.uuid)) {
                        playlists.push({ uuid: ann.playlist.uuid, name: ann.playlist.name || '', branch: 'announcements' });
                    }
                    if (ann?.item?.uuid && !hasActivePresentation && !activeItemIds.includes(ann.item.uuid)) {
                        activeItemIds.push(ann.item.uuid);
                    }
                }

                if (!playlists.length) {
                    if (!container.querySelector('.pl-slide-header, .plo-item, .plo-v2-item')) {
                        container.innerHTML = '<div class="pp-offline"><div class="pp-offline-icon">📋</div><div>Geen actieve playlist</div></div>';
                    }
                    return;
                }

                const fetches = playlists.map(pl =>
                    fetch(`${baseUrl}/v1/playlist/${pl.uuid}`, { headers: { 'Accept': 'application/json' } })
                        .then(r => r.json())
                        .then(data => ({ ...data, branch: pl.branch, playlistName: pl.name, activeItemIds }))
                );

                Promise.all(fetches)
                    .then(results => {
                        this._renderPlaylistOverview(container, results);
                    })
                    .catch(() => {
                        if (!container.querySelector('.pl-slide-header, .plo-item, .plo-v2-item')) {
                            container.innerHTML = '<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>Fout bij ophalen playlist</div></div>';
                        }
                    });
            })
            .catch(() => {
                if (liveBadge) {
                    liveBadge.classList.add('offline');
                    liveBadge.innerHTML = '<span class="plo-v2-live-dot"></span> OFFLINE';
                }
                if (!container.querySelector('.pl-slide-header, .plo-item, .plo-v2-item')) {
                    container.innerHTML = '<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>ProPresenter offline</div></div>';
                }
            });
    },

    _renderPlaylistOverview(container, playlists) {
        let html = '';
        let totalItems = 0;
        let activeItemName = '—';

        playlists.forEach((playlist) => {
            const items = playlist.data?.items || playlist.items || [];
            items.forEach((item) => {
                const isHeader = item.type === 'header';
                const itemName = item.id?.name || item.name || '';
                const itemUuid = isHeader ? null : (item.id?.uuid || item.uuid || '');
                const isActive = itemUuid && playlist.activeItemIds?.includes(itemUuid);
                const headerColor = isHeader && item.header_color
                    ? `rgba(${Math.round(item.header_color.red * 255)}, ${Math.round(item.header_color.green * 255)}, ${Math.round(item.header_color.blue * 255)}, 0.3)`
                    : 'rgba(255,255,255,0.05)';

                if (isHeader) {
                    html += `<div class="plo-v2-header-label" style="border-left: 3px solid ${headerColor}; padding-left: 10px;">${setlistModule.escapeHtml(itemName)}</div>`;
                } else {
                    totalItems++;
                    const presUuid = item.presentation_info?.presentation_uuid || item.target_uuid || '';
                    if (isActive) activeItemName = itemName;

                    let slideCounterHtml = '';
                    if (isActive && presUuid && this._playlistOverviewSlidesData && this._playlistOverviewLastPresUuid === presUuid) {
                        const currentIdx = (this._proPresenterCurrentSlideIdx ?? 0) + 1;
                        slideCounterHtml = `<span class="plo-v2-slide-counter" data-counter-uuid="${presUuid}">${currentIdx}/${this._playlistOverviewSlidesData.length}</span>`;
                    } else {
                        slideCounterHtml = `<span class="plo-v2-slide-counter" data-counter-uuid="${presUuid}" style="${isActive ? '' : 'display:none;'}"></span>`;
                    }

                    html += `
                    <div class="plo-v2-item${isActive ? ' active' : ''}"
                         data-pres-uuid="${presUuid}">
                        <div class="plo-v2-item-left">
                            <span class="plo-v2-item-name">${setlistModule.escapeHtml(itemName)}</span>
                        </div>
                        <div class="plo-v2-item-right">
                            ${isActive ? '<span class="plo-v2-now-live">NOW LIVE</span>' : ''}
                            ${slideCounterHtml}
                        </div>
                    </div>`;
                }
            });
        });

        if (!html) html = '<div class="pp-loading">Geen items in playlist</div>';
        container.innerHTML = html;

        const widgetCard = container.closest('.widget-card');
        if (widgetCard) {
            const countEl = widgetCard.querySelector('#plo-v2-item-count');
            const activeEl = widgetCard.querySelector('#plo-v2-active-name');
            const titleEl = widgetCard.querySelector('.plo-v2-title');
            if (countEl) countEl.textContent = `${totalItems} ITEMS`;
            if (activeEl) activeEl.textContent = `ACTIVE: ${activeItemName}`;
            if (titleEl && playlists[0]?.playlistName) titleEl.textContent = playlists[0].playlistName;
        }

        const activeItem = container.querySelector('.plo-v2-item.active');
        if (activeItem) {
            requestAnimationFrame(() => {
                activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        }
    },

    _triggerPlaylistItem(playlistUuid, itemIndex, el) {
        if (el) {
            el.classList.remove('pp-triggered');
            void el.offsetWidth;
            el.classList.add('pp-triggered');
            setTimeout(() => el.classList.remove('pp-triggered'), 350);
        }
        const baseUrl = this._getProPresenterBaseUrl();
        fetch(`${baseUrl}/v1/playlist/${playlistUuid}/${itemIndex}/trigger`, { method: 'GET' })
            .then(() => { setTimeout(() => this._loadPlaylistOverview(), 150); })
            .catch(err => console.error('[PLO] Error triggering playlist item:', err));
    },

    _triggerClear(type, btn) {
        if (btn) {
            btn.classList.add('active-flash');
            setTimeout(() => btn.classList.remove('active-flash'), 400);
        }
        const baseUrl = this._getProPresenterBaseUrl();
        let endpoint = `/v1/clear/all`;
        if (type === 'slide') endpoint = `/v1/clear/slide`;
        else if (type === 'timer') endpoint = `/v1/clear/timer`;
        else if (type === 'message') endpoint = `/v1/clear/message`;
        else if (type === 'stage') endpoint = `/v1/clear/stage`;
        else if (type === 'props') endpoint = `/v1/clear/props`;
        else if (type === 'background') endpoint = `/v1/clear/background`;
        fetch(`${baseUrl}${endpoint}`, { method: 'GET' })
            .catch(err => console.error('[PLO] Error clearing:', err));
    },

    _loadPlaylistOverviewSlides(baseUrl, activePresUuid, activeSlideIdx) {
        if (!activePresUuid) {
            const slidesContainer = document.getElementById('playlist-overview-slides');
            if (slidesContainer) slidesContainer.innerHTML = '<div class="pp-offline">Geen actieve slides</div>';
            return;
        }

        if (this._playlistOverviewLastPresUuid === activePresUuid && this._playlistOverviewSlidesData) {
            this._renderPlaylistOverviewSlides(activeSlideIdx);
            return;
        }

        this._playlistOverviewLastPresUuid = activePresUuid;

        fetch(`${baseUrl}/v1/presentation/${activePresUuid}`, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(data => {
                const groups = data?.presentation?.groups || [];
                const slides = [];
                let globalSlideIndex = 0;
                groups.forEach(group => {
                    const groupSlides = group.slides || [];
                    groupSlides.forEach((slide) => {
                        slides.push({
                            uuid: activePresUuid,
                            slideIndex: globalSlideIndex,
                            label: slide.label || String(globalSlideIndex + 1),
                            groupName: group.name,
                            groupColor: group.color,
                            image: slide.image || slide.thumb_url || slide.thumbnail || null
                        });
                        globalSlideIndex++;
                    });
                });

                this._playlistOverviewSlidesData = slides;
                this._renderPlaylistOverviewSlides(activeSlideIdx);

                document.querySelectorAll('.widget-card[data-widget-id="playlist-overview"] .plo-v2-slide-counter').forEach(el => {
                    if (el.dataset.counterUuid === activePresUuid && el.closest('.plo-v2-item.active')) {
                        el.textContent = `${(activeSlideIdx ?? 0) + 1}/${slides.length}`;
                    }
                });
            })
            .catch(() => {
                this._playlistOverviewLastPresUuid = null;
                this._playlistOverviewSlidesData = null;
            });
    },

    _renderPlaylistOverviewSlides(activeSlideIdx) {
        const slidesContainer = document.getElementById('playlist-overview-slides');
        if (!slidesContainer || !this._playlistOverviewSlidesData) return;

        const baseUrl = this._getProPresenterBaseUrl();
        let html = '';

        this._playlistOverviewSlidesData.forEach(slide => {
            const isActive = slide.slideIndex === activeSlideIdx;
            const activeClass = isActive ? ' active' : '';

            let groupStyle = '';
            if (slide.groupColor) {
                const r = Math.round((slide.groupColor.red || 0) * 255);
                const g = Math.round((slide.groupColor.green || 0) * 255);
                const b = Math.round((slide.groupColor.blue || 0) * 255);
                groupStyle = `background: rgb(${r}, ${g}, ${b}); color: ${this._getContrastYIQ(r, g, b)};`;
            } else {
                groupStyle = `background: var(--ichtus-orange); color: white;`;
            }

            let thumbUrl = `${baseUrl}/v1/presentation/${slide.uuid}/thumbnail/${slide.slideIndex}`;
            if (slide.image) {
                if (slide.image.startsWith('data:')) thumbUrl = slide.image;
                else if (slide.image.startsWith('http')) thumbUrl = slide.image;
                else if (slide.image.startsWith('/')) thumbUrl = baseUrl + slide.image;
                else thumbUrl = 'data:image/jpeg;base64,' + slide.image;
            }

            const groupBadge = slide.groupName ? `<div class="plo-slide-group-badge" style="${groupStyle}">${slide.groupName}</div>` : '';

            html += `<div class="plo-slide-card${activeClass}" 
                          data-slide-index="${slide.slideIndex}"
                          onclick="dashboardModule._triggerPlaylistSlide('${slide.uuid}', ${slide.slideIndex}, this)">
                <div class="plo-slide-num">${slide.slideIndex + 1}</div>
                ${groupBadge}
                <img class="plo-slide-thumb" src="${thumbUrl}" onerror="this.style.opacity=0" loading="lazy" />
                <div class="plo-slide-checkerboard"></div>
            </div>`;
        });

        slidesContainer.innerHTML = html;

        document.querySelectorAll('.widget-card[data-widget-id="playlist-overview"]').forEach(widget => {
            const counterEl = widget.querySelector(`.plo-v2-slide-counter[data-counter-uuid="${this._playlistOverviewLastPresUuid}"]`);
            if (counterEl) counterEl.textContent = `${(activeSlideIdx ?? 0) + 1}/${this._playlistOverviewSlidesData.length}`;
        });

        const activeCard = slidesContainer.querySelector('.plo-slide-card.active');
        if (activeCard) activeCard.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    },

    _getContrastYIQ(r, g, b) {
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000' : '#fff';
    }
};
