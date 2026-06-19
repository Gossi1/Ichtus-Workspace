const dashboardModule = {
    initialized: false,
    _lastView: null,
    timerInterval: null,
    timerStartTime: null,
    timerRunning: false,
    draggedEl: null,
    _defaultWidgetIds: ['quicklinks', 'servicetimer', 'status', 'propresenter', 'playlist-overview', 'mic-iem-monitor'],
    _editMode: false,
    _widgetInstance: 0,

    _resizeHandler: null,
    // ProPresenter state
    _proPresenterInterval: null,
    _proPresenterFastInterval: null,
    _proPresenterLastIndex: -1,
    _proPresenterLastPresentationUuid: null,
    _proPresenterLastSlideCount: 0,

    // ProPresenter Playlist slide tracking
    _proPresenterPlaylistSlideCheckInterval: null,
    _proPresenterPlaylistLastUuid: null,
    _proPresenterPlaylistCheckInterval: null,
    _proPresenterPlaylistIndex: null,
    _playlistAutoScroll: true,
    _hasPlaylistData: false,
    _isApplyingLayout: false,

    // ===============================
    //  INIT
    // ===============================
    init() {
        // Sla ProPresenter WebSocket wachtwoord op in localStorage (niet in de code)
        if (!localStorage.getItem('ichtus_pp_ws_password')) {
            const pwd = prompt('Voer het ProPresenter netwerk wachtwoord in voor WebSocket connectie:');
            if (pwd) localStorage.setItem('ichtus_pp_ws_password', pwd);
        }
        if (this.initialized && this._lastView === 'dashboard') return;
        this.initialized = true;
        this._lastView = 'dashboard';

        this.setupDragAndDrop();
        this.setupTimer();
        this.setupCountdown();
        this._migrateProPresenterSpan();
        this._migratePlaylistCache();
        this._initMicMonitor();
        this._initRosterListener();

        const activeLayout = this.getActiveLayoutName();
        this.applyLayout(activeLayout);

        localStorage.removeItem('ichtus_dashboard_collapsed');
        this._updateRowHeight();
        this._restoreWidgetSizes();
        this._expandWidgetToGridHeight();
        this.initLayoutSelector();
        this._initDropdownCloseListener();
        if (document.querySelector('.widget-card[data-widget-id="propresenter"], .widget-card[data-widget-id="propresenter-playlist"], .widget-card[data-widget-id="playlist-overview"]')) {
            this._startProPresenterPolling();
        }            if (document.querySelector('.widget-card[data-widget-id="propresenter-playlist"]')) {
                this._loadProPresenterPlaylist();
                this._startPlaylistChangeDetection();
                this._startPlaylistSlideTracking();
            }
        if (document.querySelector('.widget-card[data-widget-id="playlist-overview"]')) {
            this._startPlaylistOverviewPolling();
            this._loadPlaylistOverview();
        }

        this._resizeHandler = () => {
            if (document.getElementById('view-dashboard')?.classList.contains('active')) {
                this._updateRowHeight();
                this._restoreWidgetPositions();
                if (this._editMode) this._createGridOverlay();
            }
        };
        window.addEventListener('resize', this._resizeHandler);
    },

    // ===============================
    //  GRID SYSTEM (occupancy map)
    // ===============================
    COL_COUNT: 36,
    GAP_PX: 12,

    /**
     * Calculate grid metrics from the DOM element.
     * Returns { colWidth, rowHeight, maxRows, totalCols, gap } or null.
     * Row height = colWidth + gap (square cells).
     */
    _getGridMetrics() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return null;
        const rect = grid.getBoundingClientRect();
        const colWidth = (rect.width - this.GAP_PX * (this.COL_COUNT - 1)) / this.COL_COUNT;
        const rowHeight = colWidth + this.GAP_PX;
        const maxRows = Math.max(1, Math.floor(rect.height / rowHeight)) + 1;
        return { colWidth, rowHeight, maxRows, totalCols: this.COL_COUNT, gap: this.GAP_PX };
    },

    _getDefaultRowSpan(widgetId) {
        const defaults = { quicklinks: 3, servicetimer: 4, status: 4, propresenter: 8, 'propresenter-playlist': 8, 'playlist-overview': 10, servicecountdown: 4, 'mic-iem-monitor': 6 };
        return defaults[widgetId] || 3;
    },

    /**
     * Build a 2D boolean occupancy map [row][col] from all widgets currently in the DOM.
     * Excludes the widget being dragged (this.draggedEl).
     */
    _buildOccupancyMap(maxRows, excludeEl) {
        const map = Array.from({ length: maxRows }, () => new Array(this.COL_COUNT).fill(false));
        const metrics = this._getGridMetrics();
        if (!metrics) return map;
        const { rowHeight } = metrics;

        document.querySelectorAll('#widget-grid .widget-card').forEach(card => {
            if (card === excludeEl) return;
            const col = parseInt(card.style.gridColumnStart) || 1;
            const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId);
            const row = parseInt(card.style.gridRowStart) || 1;
            
            let rowSpan = parseInt(card.dataset.widgetRowSpan);
            if (!rowSpan) {
                const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
                rowSpan = Math.max(1, Math.ceil(minH / rowHeight));
            }

            for (let r = row - 1; r < Math.min(row - 1 + rowSpan, maxRows); r++) {
                const rowArr = map[r];
                if (!rowArr) continue;
                for (let c = col - 1; c < Math.min(col - 1 + span, this.COL_COUNT); c++) {
                    rowArr[c] = true;
                }
            }
        });
        return map;
    },

    /**
     * Find the nearest free grid cell for a widget of the given size.
     * Uses BFS outward from the preferred position.
     * Returns { col, row } (1-indexed grid coordinates).
     */
    _findFreeSpot(colSpan, rowSpan, preferredCol, preferredRow) {
        const metrics = this._getGridMetrics();
        if (!metrics) return { col: 1, row: 1 };
        const { maxRows, totalCols } = metrics;
        const map = this._buildOccupancyMap(maxRows, this.draggedEl);

        const maxCol = totalCols - colSpan;
        const maxRow = maxRows - rowSpan;
        const startCol = Math.min(Math.max(0, preferredCol - 1), maxCol);
        const startRow = Math.min(Math.max(0, preferredRow - 1), maxRow);

        // BFS outward from preferred position
        const visited = new Set();
        const queue = [[startCol, startRow]];
        visited.add(`${startCol},${startRow}`);
        let head = 0;

        while (head < queue.length) {
            const [c, r] = queue[head++];
            if (this._rectFits(map, c + 1, r + 1, colSpan, rowSpan, metrics)) {
                return { col: c + 1, row: r + 1 };
            }
            for (const [nc, nr] of [[c + 1, r], [c, r + 1], [c - 1, r], [c, r - 1]]) {
                const key = `${nc},${nr}`;
                if (!visited.has(key) && nc >= 0 && nc <= maxCol && nr >= 0 && nr <= maxRow) {
                    visited.add(key);
                    queue.push([nc, nr]);
                }
            }
        }

        // No free spot within viewport — place below
        return { col: 1, row: maxRows };
    },

    /**
     * Check if a rectangle fits in the occupancy map without overlapping.
     * @param {boolean[][]} map - Occupancy map
     * @param {number} col - Start column (1-indexed)
     * @param {number} row - Start row (1-indexed)
     * @param {number} colSpan - Column span
     * @param {number} rowSpan - Row span
     * @param {object} metrics - Grid metrics { totalCols, maxRows }
     * @returns {boolean}
     */
    _rectFits(map, col, row, colSpan, rowSpan, metrics) {
        const c = col - 1;
        const r = row - 1;
        if (c < 0 || r < 0 || c + colSpan > metrics.totalCols || r + rowSpan > metrics.maxRows) return false;
        for (let rr = r; rr < r + rowSpan; rr++) {
            const rowArr = map[rr];
            if (!rowArr) return false;
            for (let cc = c; cc < c + colSpan; cc++) {
                if (rowArr[cc]) return false;
            }
        }
        return true;
    },

    /**
     * Convert cursor coordinates to the nearest grid cell (col, row), both 1-indexed.
     */
    _cursorToGrid(clientX, clientY) {
        const grid = document.getElementById('widget-grid');
        if (!grid) return null;
        const metrics = this._getGridMetrics();
        if (!metrics) return null;
        const rect = grid.getBoundingClientRect();
        const { colWidth, rowHeight } = metrics;
        const col = Math.max(1, Math.min(this.COL_COUNT, Math.floor((clientX - rect.left) / (colWidth + this.GAP_PX)) + 1));
        const row = Math.max(1, Math.floor((clientY - rect.top) / rowHeight) + 1);
        return { col, row };
    },

    /**
     * Set CSS grid properties on a widget card.
     */
    _applyWidgetGrid(card, col, row, span, rowSpan) {
        card.style.gridColumn = `${col} / span ${span}`;
        card.dataset.widgetSpan = String(span);
        const actualRowSpan = rowSpan || parseInt(card.dataset.widgetRowSpan) || this._getDefaultRowSpan(card.dataset.widgetId);
        card.style.gridRow = `${row} / span ${actualRowSpan}`;
        card.dataset.widgetRowSpan = String(actualRowSpan);
        card.style.height = '';
        card.style.minHeight = '';
    },

    // ===============================
    //  DRAG & DROP
    // ===============================
    setupDragAndDrop() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;

        // Create / reuse drop indicator
        let indicator = grid.querySelector('.widget-drop-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'widget-drop-indicator';
            indicator.style.display = 'none';
            grid.appendChild(indicator);
        }

        grid.addEventListener('dragstart', (e) => {
            if (!this._editMode) { e.preventDefault(); return; }
            if (e.target.closest('.widget-resize-handle')) { e.preventDefault(); return; }
            const card = e.target.closest('.widget-card');
            if (!card) return;
            this.draggedEl = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.widgetId || '');
            // PP-TRACE snapshot
            this._dragStartState = {
                widgetId: card.dataset.widgetId,
                col: parseInt(card.style.gridColumnStart) || 1,
                row: parseInt(card.style.gridRowStart) || 1,
                span: parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId),
                rowSpan: parseInt(card.dataset.widgetRowSpan) || this._getDefaultRowSpan(card.dataset.widgetId),
                savedPositions: (() => { try { return JSON.parse(localStorage.getItem('ichtus_dashboard_widget_positions') || '{}'); } catch(e) { return {}; } })(),
                savedSizes: (() => { try { return JSON.parse(localStorage.getItem('ichtus_dashboard_widget_sizes') || '{}'); } catch(e) { return {}; } })()
            };
            console.log('[PP-TRACE] dragstart →', this._dragStartState);
        });

        grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this.draggedEl) return;
            const pos = this._cursorToGrid(e.clientX, e.clientY);
            if (!pos) return;
            const metrics = this._getGridMetrics();
            if (!metrics) return;
            const { colWidth, rowHeight } = metrics;

            // Calculate the widget's full footprint for the indicator
            const card = this.draggedEl;
            const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId);
            let rowSpan = parseInt(card.dataset.widgetRowSpan);
            if (!rowSpan) {
                const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
                rowSpan = Math.max(1, Math.ceil(minH / rowHeight));
            }
            const capRowSpan = Math.min(rowSpan, Math.max(1, metrics.maxRows - 2));

            indicator.style.display = 'block';
            indicator.style.left = ((pos.col - 1) * (colWidth + this.GAP_PX)) + 'px';
            indicator.style.top = ((pos.row - 1) * rowHeight) + 'px';
            indicator.style.width = (span * colWidth + (span - 1) * this.GAP_PX) + 'px';
            indicator.style.height = (capRowSpan * rowHeight - this.GAP_PX) + 'px';
            indicator.style.borderRadius = '8px';
            indicator.style.background = 'rgba(244,121,32,0.12)';
            indicator.style.border = '2px dashed var(--ichtus-orange, #f47920)';
            console.log('[PP-DRAG-DEBUG] dragover → pos:', pos, '| span:', span, 'rowSpan:', rowSpan, 'capRowSpan:', capRowSpan, '| indicator at col', pos.col, 'row', pos.row);
        });

        grid.addEventListener('drop', (e) => { e.preventDefault(); });

        grid.addEventListener('dragend', (e) => {
            const card = this.draggedEl || e.target.closest('.widget-card');
            if (card) {
                card.classList.remove('dragging');
                const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId);
                let rowSpan = parseInt(card.dataset.widgetRowSpan);
                if (!rowSpan) {
                    const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
                    rowSpan = metrics ? Math.max(1, Math.ceil(minH / metrics.rowHeight)) : 1;
                }
                const metrics = this._getGridMetrics();
                const cursorPos = this._cursorToGrid(e.clientX, e.clientY);
                // Temporarily set draggedEl back so _buildOccupancyMap excludes this card
                this.draggedEl = card;
                // Cap rowSpan during findFreeSpot so a full-height widget can be placed at other rows
                const capRowSpan = Math.min(rowSpan, Math.max(1, (metrics ? metrics.maxRows : 15) - 2));
                const free = this._findFreeSpot(span, capRowSpan, cursorPos?.col || 1, cursorPos?.row || 1);
                this.draggedEl = null;
                this._applyWidgetGrid(card, free.col, free.row, span, rowSpan);
                console.log('[PP-TRACE] dragend → after _applyWidgetGrid | cursor:', cursorPos, '| free:', free, '| old:', this._dragStartState ? {col: this._dragStartState.col, row: this._dragStartState.row} : 'N/A', '| applied: {col:', parseInt(card.style.gridColumnStart), 'row:', parseInt(card.style.gridRowStart), '} | span:', span, 'rowSpan:', rowSpan, 'capRowSpan:', capRowSpan);
                this._saveWidgetPositions();
                this._expandWidgetToGridHeight();
                delete this._dragStartState;
            } else {
                this.draggedEl = null;
            }
            indicator.style.display = 'none';
        });
    },

    // ===============================
    //  RESIZE
    // ===============================
    _initResizeHandle(el) {
        const handle = el.querySelector('.widget-resize-handle');
        if (!handle) return;

        const onPointerDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startY = e.clientY;
            const grid = document.getElementById('widget-grid');
            if (!grid) return;

            const metrics = this._getGridMetrics();
            if (!metrics) return;
            const { rowHeight, maxRows } = metrics;

            const currentSpan = parseInt(el.dataset.widgetSpan) || this._getDefaultSpan(el.dataset.widgetId);
            const currentRowSpan = parseInt(el.dataset.widgetRowSpan) || this._getDefaultRowSpan(el.dataset.widgetId);
            const initCol = parseInt(el.style.gridColumnStart) || 1;
            const startRow = parseInt(el.style.gridRowStart) || 1;
            const maxRowsAvail = maxRows - startRow + 1;

            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'nwse-resize';

            const onMove = (moveE) => {
                const dx = moveE.clientX - startX;
                const spanDelta = Math.round(dx / rowHeight);
                let newSpan = Math.max(1, Math.min(currentSpan + spanDelta, this.COL_COUNT));

                const dy = moveE.clientY - startY;
                const rowDelta = Math.round(dy / rowHeight);
                let newRowSpan = Math.max(1, Math.min(currentRowSpan + rowDelta, maxRowsAvail));

                const isGrowingWider = dx > 0;
                const isGrowingTaller = dy > 0;

                if (isGrowingWider || isGrowingTaller) {
                    const metrics2 = this._getGridMetrics();
                    if (metrics2) {
                        const map = this._buildOccupancyMap(metrics2.maxRows, el);
                        const startRow2 = parseInt(el.style.gridRowStart) || 1;
                        if (isGrowingWider) {
                            const oldSpan = parseInt(el.dataset.widgetSpan) || 1;
                            while (newSpan > oldSpan && !this._rectFits(map, initCol, startRow2, newSpan, newRowSpan, metrics2)) {
                                newSpan--;
                            }
                        }
                        if (isGrowingTaller) {
                            const oldRowSpan = parseInt(el.dataset.widgetRowSpan) || 1;
                            while (newRowSpan > oldRowSpan && newRowSpan > 1) {
                                if (this._rectFits(map, initCol, startRow2, newSpan, newRowSpan, metrics2)) break;
                                newRowSpan--;
                            }
                        }
                    }
                }

                el.style.gridColumn = `${initCol} / span ${newSpan}`;
                el.dataset.widgetSpan = String(newSpan);
                el.style.gridRow = `${startRow} / span ${newRowSpan}`;
                el.dataset.widgetRowSpan = String(newRowSpan);
                el.style.height = '';
                el.style.minHeight = '';
            };

            const onUp = () => {
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                this._saveWidgetSizes();
                const widgetId = el.dataset.widgetId;
                if (widgetId === 'propresenter' || widgetId === 'propresenter-playlist' || widgetId === 'playlist-overview') {
                    this._expandWidgetToGridHeight();
                }
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        };

        handle.addEventListener('pointerdown', onPointerDown);
    },

    _saveWidgetSizes() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;
        const sizes = {};
        grid.querySelectorAll('.widget-card').forEach(card => {
            const id = card.dataset.widgetId;
            if (!id) return;
            const span = parseInt(card.dataset.widgetSpan);
            const rowSpan = parseInt(card.dataset.widgetRowSpan) || this._getDefaultRowSpan(id);
            const saved = {};
            if (span && span > 0 && span !== this._getDefaultSpan(id)) saved.span = span;
            if (rowSpan && rowSpan > 0 && rowSpan !== this._getDefaultRowSpan(id)) saved.rowSpan = rowSpan;
            if (Object.keys(saved).length > 0) sizes[id] = saved;
        });
        try { localStorage.setItem('ichtus_dashboard_widget_sizes', JSON.stringify(sizes)); } catch (e) {}
    },

    _restoreWidgetSizes() {
        try {
            const saved = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_sizes') || '{}');
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (!id) return;
                const data = saved[id];
                let span, rowSpan;
                if (typeof data === 'object' && data !== null) {
                    span = data.span ? Math.max(1, Math.min(36, parseInt(data.span) || 18)) : this._getDefaultSpan(id);
                    if (data.rowSpan) {
                        rowSpan = Math.max(1, parseInt(data.rowSpan));
                    } else if (data.height) {
                        const m = this._getGridMetrics();
                        const rH = m ? m.rowHeight : 42;
                        rowSpan = Math.max(1, Math.round(parseInt(data.height) / rH));
                    } else {
                        rowSpan = this._getDefaultRowSpan(id);
                    }
                } else if (data) {
                    span = Math.max(1, Math.min(36, parseInt(data) || 18));
                    rowSpan = this._getDefaultRowSpan(id);
                } else {
                    span = this._getDefaultSpan(id);
                    rowSpan = this._getDefaultRowSpan(id);
                }

                card.style.gridColumn = `${parseInt(card.style.gridColumnStart) || 'auto'} / span ${span}`;
                card.dataset.widgetSpan = String(span);
                
                const rowStart = parseInt(card.style.gridRowStart) || 1;
                card.style.gridRow = `${rowStart} / span ${rowSpan}`;
                card.dataset.widgetRowSpan = String(rowSpan);

                card.style.height = '';
                card.style.minHeight = '';
            });
        } catch (e) {}
    },

    _getDefaultSpan(widgetId) {
        const defaults = { quicklinks: 12, servicetimer: 18, status: 18, propresenter: 24, 'propresenter-playlist': 24, 'playlist-overview': 24, servicecountdown: 18, 'mic-iem-monitor': 18 };
        return defaults[widgetId] || 6;
    },

    _getDefaultHeight(widgetId) {
        const defaults = { quicklinks: 140, servicetimer: 200, status: 200, propresenter: 320, 'propresenter-playlist': 320, 'playlist-overview': 480, servicecountdown: 200, 'mic-iem-monitor': 320 };
        return defaults[widgetId] || 140;
    },

    /**
     * Expand ProPresenter widget(s) to fill all available grid rows.
     * This ensures the slides container takes full advantage of grid real estate.
     */
    _expandWidgetToGridHeight() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;
        const metrics = this._getGridMetrics();
        if (!metrics) return;
        const { maxRows } = metrics;

        grid.querySelectorAll('.widget-card[data-widget-id="propresenter"], .widget-card[data-widget-id="propresenter-playlist"], .widget-card[data-widget-id="playlist-overview"]').forEach(card => {
            const rowStart = parseInt(card.style.gridRowStart) || 1;
            const rowsAvail = Math.max(1, maxRows - rowStart + 1);

            card.style.gridRow = `${rowStart} / span ${rowsAvail}`;
            card.dataset.widgetRowSpan = String(rowsAvail);
            card.style.height = '';
            card.style.minHeight = '';
        });
    },

    // Upgrade old propresenter span by clearing saved sizes (now 24)
    _migrateProPresenterSpan() {
        // Only run once to upgrade old propresenter span (was 18, now 24)
        try {
            if (localStorage.getItem('ichtus_pp_span_migrated')) return;
            ['ichtus_dashboard_widget_sizes', 'ichtus_dashboard_widget_positions'].forEach(key => {
                const saved = JSON.parse(localStorage.getItem(key) || '{}');
                if (saved.propresenter) {
                    delete saved.propresenter;
                    localStorage.setItem(key, JSON.stringify(saved));
                }
            });
            localStorage.setItem('ichtus_pp_span_migrated', '1');
        } catch(e) {}
    },

    // Clear old playlist cache that still contains pp-slide-text HTML
    _migratePlaylistCache() {
        try {
            if (localStorage.getItem('ichtus_pp_cache_notext')) return;
            localStorage.removeItem('ichtus_pp_playlist_cache');
            localStorage.setItem('ichtus_pp_cache_notext', '1');
        } catch(e) {}
    },

    // ===============================
    //  SAVE / RESTORE POSITIONS
    // ===============================
    _saveWidgetPositions() {
        try {
            const order = [];
            const positions = {};
            document.querySelectorAll('#widget-grid .widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (!id) return;
                order.push(id);
                positions[id] = {
                    col: parseInt(card.style.gridColumnStart) || 1,
                    row: parseInt(card.style.gridRowStart) || 1,
                    span: parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(id),
                    rowSpan: parseInt(card.dataset.widgetRowSpan) || this._getDefaultRowSpan(id)
                };
            });
            localStorage.setItem('ichtus_dashboard_widget_order', JSON.stringify(order));
            localStorage.setItem('ichtus_dashboard_widget_positions', JSON.stringify(positions));

            if (!this._isApplyingLayout) {
                const activeLayout = this.getActiveLayoutName();
                if (activeLayout && activeLayout !== '__default__') {
                    const layouts = this.loadLayouts();
                    layouts[activeLayout] = this.getCurrentState();
                    this.saveLayouts(layouts);
                }
            }
        } catch (e) {}
    },

    saveWidgetOrder() { this._saveWidgetPositions(); },

    restoreWidgetOrder() {
        try {
            const order = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_order'));
            if (!Array.isArray(order)) return;
            const grid = document.getElementById('widget-grid');
            if (!grid) return;

            // Remove any widget cards that are NOT in the saved order
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (id && !order.includes(id)) {
                    card.remove();
                }
            });

            order.forEach(id => {
                const card = grid.querySelector(`[data-widget-id="${id}"]`);
                if (card) grid.appendChild(card);
            });
        } catch (e) {}
    },

    _restoreWidgetPositions() {
        try {
            let positions = {};
            const activeLayout = this.getActiveLayoutName();
            if (activeLayout === '__default__') {
                positions = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_positions') || '{}');
            } else {
                const layouts = this.loadLayouts();
                if (layouts[activeLayout] && layouts[activeLayout].positions) {
                    positions = layouts[activeLayout].positions;
                }
            }

            const metrics = this._getGridMetrics();
            const maxRow = metrics ? metrics.maxRows : 20;
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            let fallbackCol = 1;
            let fallbackRow = 1;
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                const pos = positions[id];
                if (pos) {
                    const row = Math.min(pos.row, maxRow);
                    const span = pos.span || this._getDefaultSpan(id);
                    const rowSpan = pos.rowSpan || this._getDefaultRowSpan(id);
                    card.style.gridColumn = `${pos.col || 1} / span ${span}`;
                    card.style.gridRow = `${row} / span ${rowSpan}`;
                    card.dataset.widgetSpan = String(span);
                    card.dataset.widgetRowSpan = String(rowSpan);
                } else {
                    // No saved position — assign a default so _buildOccupancyMap sees explicit gridColumnStart
                    const span = this._getDefaultSpan(id);
                    const rowSpan = this._getDefaultRowSpan(id);
                    if (fallbackCol + span > this.COL_COUNT + 1) {
                        fallbackCol = 1;
                        fallbackRow++;
                    }
                    card.style.gridColumn = `${fallbackCol} / span ${span}`;
                    card.style.gridRow = `${Math.min(fallbackRow, maxRow)} / span ${rowSpan}`;
                    card.dataset.widgetSpan = String(span);
                    card.dataset.widgetRowSpan = String(rowSpan);
                    fallbackCol += span;
                }
                card.style.height = '';
                card.style.minHeight = '';
            });
        } catch (e) {}
    },

    restoreCollapsed() {
        // No longer used — collapsed state is removed in init()
    },

    _ensureSavedWidgets() {
        try {
            const saved = localStorage.getItem('ichtus_dashboard_widget_order');
            if (!saved) return;
            const order = JSON.parse(saved);
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            const existing = [...grid.querySelectorAll('.widget-card')].map(el => el.dataset.widgetId);
            order.forEach(id => {
                if (!existing.includes(id)) {
                    const html = this.getWidgetTemplate(id);
                    if (html) {
                        const wrapper = document.createElement('div');
                        wrapper.innerHTML = html;
                        const card = wrapper.firstElementChild;
                        if (card) {
                            grid.appendChild(card);
                            if (id === 'propresenter' || id === 'propresenter-playlist' || id === 'playlist-overview') this._startProPresenterPolling();
                            if (id === 'propresenter-playlist') {
                                this._loadProPresenterPlaylist();
                                this._startPlaylistChangeDetection();
                                this._startPlaylistSlideTracking();
                            }
                            if (id === 'playlist-overview') {
                                this._startPlaylistOverviewPolling();
                            }
                            if (id === 'servicecountdown') this.setupCountdown();
                        }
                    }
                }
            });
        } catch (e) {}
    },

    // ===============================
    //  ROW HEIGHT HELPERS
    // ===============================
    _getRowStep() {
        const metrics = this._getGridMetrics();
        return metrics ? metrics.rowHeight : 152;
    },

    _updateRowHeight() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;
        const metrics = this._getGridMetrics();
        if (!metrics) return;
        grid.style.gridAutoRows = metrics.colWidth + 'px';
    },

    /**
     * Draw a grid overlay on the widget grid showing cell boundaries.
     * Only visible in edit mode.
     */
    _createGridOverlay() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;
        let overlay = grid.querySelector('.widget-grid-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'widget-grid-overlay';
            const canvas = document.createElement('canvas');
            overlay.appendChild(canvas);
            grid.appendChild(overlay);
        }
        const canvas = overlay.querySelector('canvas');
        if (!canvas) return;

        const metrics = this._getGridMetrics();
        if (!metrics) return;
        const { colWidth, rowHeight, maxRows, totalCols, gap } = metrics;

        const gridRect = grid.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = gridRect.width * dpr;
        canvas.height = gridRect.height * dpr;
        canvas.style.width = gridRect.width + 'px';
        canvas.style.height = gridRect.height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, gridRect.width, gridRect.height);

        // Draw cell boundaries
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;

        for (let r = 0; r < maxRows; r++) {
            for (let c = 0; c < totalCols; c++) {
                const x = c * (colWidth + gap);
                const y = r * rowHeight;
                ctx.strokeRect(x, y, colWidth, rowHeight - gap);
            }
        }

        // Update visibility based on edit mode
        overlay.classList.toggle('visible', this._editMode);
    },

    _getMaxVisibleRow() {
        const metrics = this._getGridMetrics();
        return metrics ? metrics.maxRows : 10;
    },

    // ===============================
    //  TIMER
    // ===============================
    setupTimer() {
        const startBtn = document.getElementById('dash-timer-start');
        const stopBtn = document.getElementById('dash-timer-stop');
        const resetBtn = document.getElementById('dash-timer-reset');

        if (startBtn) {
            startBtn.addEventListener('click', () => {
                this.timerRunning = true;
                this.timerStartTime = Date.now();
                startBtn.disabled = true;
                stopBtn.disabled = false;
                this.timerInterval = setInterval(() => {
                    const elapsed = Date.now() - this.timerStartTime;
                    const display = document.getElementById('dash-timer-display');
                    if (display) display.textContent = this.formatTime(elapsed);
                }, 100);
            });
        }
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.timerRunning = false;
                clearInterval(this.timerInterval);
                this.timerInterval = null;
                stopBtn.disabled = true;
                startBtn.disabled = false;
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.timerRunning = false;
                clearInterval(this.timerInterval);
                this.timerInterval = null;
                this.timerStartTime = null;
                startBtn.disabled = false;
                stopBtn.disabled = true;
                const display = document.getElementById('dash-timer-display');
                if (display) display.textContent = '00:00:00';
            });
        }
    },

    formatTime(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    },

    setupCountdown() {
        if (this._countdownInterval) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }

        const updateDisplay = () => {
            const cards = document.querySelectorAll('.widget-card[data-widget-id="servicecountdown"]');
            if (cards.length === 0) {
                if (this._countdownInterval) {
                    clearInterval(this._countdownInterval);
                    this._countdownInterval = null;
                }
                return;
            }

            const targetStr = localStorage.getItem('ichtus_countdown_target');
            cards.forEach(card => {
                if (!card.dataset.hasContextmenu) {
                    card.dataset.hasContextmenu = "true";
                    card.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        this.showCountdownContextMenu(e, card);
                    });
                }

                const displayEl = card.querySelector('#countdown-display');
                const labelsEl = card.querySelector('.countdown-labels');
                const infoEl = card.querySelector('#countdown-target-info');
                const inputEl = card.querySelector('#countdown-target-input');
                const settingsPanel = card.querySelector('#countdown-settings-panel');

                if (!targetStr) {
                    if (displayEl) {
                        displayEl.textContent = '--:--:--';
                        displayEl.classList.add('no-target');
                    }
                    if (labelsEl) labelsEl.style.opacity = '0.3';
                    if (infoEl) infoEl.textContent = 'Geen dienst gepland';
                    if (settingsPanel && !card.dataset.settingsToggled) {
                        settingsPanel.classList.remove('hidden');
                    }
                    return;
                }

                const targetDate = new Date(targetStr);
                const now = new Date();
                const diffMs = targetDate - now;

                if (infoEl) {
                    if (!isNaN(targetDate.getTime())) {
                        const options = { weekday: 'long', day: 'numeric', month: 'long' };
                        const datePart = targetDate.toLocaleDateString('nl-NL', options);
                        const timePart = targetDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
                        const capitalizedDate = datePart.charAt(0).toUpperCase() + datePart.slice(1);
                        infoEl.textContent = `${capitalizedDate} om ${timePart}`;
                    } else {
                        infoEl.textContent = 'Ongeldige datum';
                    }
                }

                if (diffMs <= 0) {
                    if (displayEl) {
                        displayEl.textContent = '00:00:00';
                        displayEl.classList.add('finished');
                    }
                    if (labelsEl) labelsEl.style.opacity = '1';
                    return;
                }

                if (displayEl) displayEl.classList.remove('no-target', 'finished');
                if (labelsEl) labelsEl.style.opacity = '1';

                const totalSec = Math.floor(diffMs / 1000);
                const days = Math.floor(totalSec / 86400);
                const hours = Math.floor((totalSec % 86400) / 3600);
                const minutes = Math.floor((totalSec % 3600) / 60);
                const seconds = totalSec % 60;

                let displayStr = '';
                if (days > 0) {
                    displayStr += `${days}d `;
                }
                displayStr += `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

                if (displayEl) displayEl.textContent = displayStr;
                
                if (inputEl && !inputEl.value) {
                    const tzOffset = targetDate.getTimezoneOffset() * 60000;
                    const localISOTime = (new Date(targetDate - tzOffset)).toISOString().slice(0, 16);
                    inputEl.value = localISOTime;
                }
            });
        };

        updateDisplay();
        // No-op while the dashboard isn't on screen: stops the per-second
        // DOM walk against every servicecountdown widget from running forever
        // when the user is on agenda/checklist/analytics/etc.
        this._countdownInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            updateDisplay();
        }, 1000);
    },

    toggleCountdownSettings(btn) {
        const card = btn.closest('.widget-card');
        if (!card) return;
        const panel = card.querySelector('#countdown-settings-panel');
        if (!panel) return;
        
        const isHidden = panel.classList.contains('hidden');
        if (isHidden) {
            panel.classList.remove('hidden');
            card.dataset.settingsToggled = 'true';
        } else {
            panel.classList.add('hidden');
            card.removeAttribute('data-settings-toggled');
        }
    },

    saveCountdownTarget(btn) {
        const card = btn.closest('.widget-card');
        if (!card) return;
        const inputEl = card.querySelector('#countdown-target-input');
        if (!inputEl) return;

        const val = inputEl.value;
        if (!val) {
            alert('Voer een geldige datum en tijd in.');
            return;
        }

        localStorage.setItem('ichtus_countdown_target', val);
        
        const panel = card.querySelector('#countdown-settings-panel');
        if (panel) {
            panel.classList.add('hidden');
            card.removeAttribute('data-settings-toggled');
        }

        this.setupCountdown();
    },

    cancelCountdownSettings(btn) {
        const card = btn.closest('.widget-card');
        if (!card) return;
        const panel = card.querySelector('#countdown-settings-panel');
        if (panel) {
            panel.classList.add('hidden');
            card.removeAttribute('data-settings-toggled');
        }
    },

    showCountdownContextMenu(e, card) {
        this.closeDashboardContextMenu();

        const menu = document.createElement('div');
        menu.className = 'dashboard-context-menu';
        menu.style.display = 'flex';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';

        const items = [
            { 
                label: 'Tijd aanpassen', 
                icon: '⏳', 
                action: () => {
                    const settingsPanel = card.querySelector('#countdown-settings-panel');
                    if (settingsPanel) {
                        settingsPanel.classList.remove('hidden');
                        card.dataset.settingsToggled = 'true';
                    }
                } 
            },
            {
                label: 'Widget verwijderen',
                icon: '×',
                action: () => {
                    if (confirm('Weet je zeker dat je deze widget wilt verwijderen?')) {
                        this.deleteWidget(card);
                    }
                },
                danger: true
            }
        ];

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dashboard-context-menu-item' + (item.danger ? ' danger' : '');
            div.innerHTML = `<span>${item.icon}</span> ${item.label}`;
            div.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.closeDashboardContextMenu();
                item.action();
            });
            menu.appendChild(div);
        });

        document.body.appendChild(menu);

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';

        const closeMenu = (ev) => {
            if (!ev.target.closest('.dashboard-context-menu')) {
                this.closeDashboardContextMenu();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    },

    closeDashboardContextMenu() {
        document.querySelectorAll('.dashboard-context-menu').forEach(el => el.remove());
    },

    // ===============================
    //  LAYOUT MANAGEMENT
    // ===============================
    initLayoutSelector() {
        this.populateLayoutSelector();
    },

    loadLayouts() {
        try { return JSON.parse(localStorage.getItem('ichtus_dashboard_layouts') || '{}'); } catch (e) { return {}; }
    },

    saveLayouts(layouts) {
        try { localStorage.setItem('ichtus_dashboard_layouts', JSON.stringify(layouts)); } catch (e) {}
    },

    getActiveLayoutName() {
        return localStorage.getItem('ichtus_active_layout') || '__default__';
    },

    setActiveLayoutName(name) {
        localStorage.setItem('ichtus_active_layout', name);
    },

    populateLayoutSelector() {
        const optionsContainer = document.getElementById('custom-select-options');
        if (!optionsContainer) return;
        optionsContainer.innerHTML = '';

        const defaultOpt = document.createElement('div');
        defaultOpt.className = 'custom-option';
        defaultOpt.setAttribute('data-value', '__default__');
        defaultOpt.textContent = i18n.t('dashboard_layout_default') || 'Default';
        defaultOpt.addEventListener('click', () => this.selectCustomOption(defaultOpt));
        optionsContainer.appendChild(defaultOpt);

        const layouts = this.loadLayouts();
        const activeName = this.getActiveLayoutName();
        Object.keys(layouts).forEach(name => {
            const opt = document.createElement('div');
            opt.className = 'custom-option';
            opt.setAttribute('data-value', name);
            opt.textContent = name + (name === activeName ? ' ' + (i18n.t('dashboard_layout_active') || '(active)') : '');
            opt.addEventListener('click', () => this.selectCustomOption(opt));
            optionsContainer.appendChild(opt);
        });

        const addNewOpt = document.createElement('div');
        addNewOpt.className = 'custom-option';
        addNewOpt.setAttribute('data-value', '__new__');
        addNewOpt.textContent = '＋ Nieuw dashboard...';
        addNewOpt.addEventListener('click', () => this.selectCustomOption(addNewOpt));
        optionsContainer.appendChild(addNewOpt);

        const triggerText = document.getElementById('custom-select-text');
        if (triggerText) {
            triggerText.textContent = activeName === '__default__' ? (i18n.t('dashboard_layout_default') || 'Default') : activeName;
        }
    },

    getCurrentState() {
        const order = [];
        const positions = {};
        document.querySelectorAll('#widget-grid .widget-card').forEach(card => {
            const id = card.dataset.widgetId;
            if (!id) return;
            order.push(id);
            positions[id] = {
                col: parseInt(card.style.gridColumnStart) || 1,
                row: parseInt(card.style.gridRowStart) || 1,
                span: parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(id),
                rowSpan: parseInt(card.dataset.widgetRowSpan) || this._getDefaultRowSpan(id)
            };
        });
        const sizes = {};
        try { const s = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_sizes') || '{}'); Object.assign(sizes, s); } catch (e) {}
        return { order, positions, sizes };
    },

    applyLayout(layoutName) {
        this._isApplyingLayout = true;
        const layouts = this.loadLayouts();
        
        let state = null;
        if (layoutName !== '__default__') {
            state = layouts[layoutName];
        } else {
            // Load default layout state from localStorage if it exists
            try {
                const order = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_order'));
                const positions = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_positions') || '{}');
                const sizes = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_sizes') || '{}');
                if (Array.isArray(order)) {
                    state = { order, positions, sizes };
                }
            } catch (e) {}
        }

        const grid = document.getElementById('widget-grid');
        if (!grid) {
            this._isApplyingLayout = false;
            return;
        }

        if (state) {
            const targetOrder = state.order || [];

            // Remove any widget cards that are NOT in the target order
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (id && !targetOrder.includes(id)) {
                    card.remove();
                }
            });

            // Reorder or recreate widgets
            targetOrder.forEach(id => {
                const card = grid.querySelector(`[data-widget-id="${id}"]`);
                if (card) grid.appendChild(card);
                else {
                    const html = this.getWidgetTemplate(id);
                    if (html) {
                        const wrapper = document.createElement('div');
                        wrapper.innerHTML = html;
                        const newCard = wrapper.firstElementChild;
                        if (newCard) grid.appendChild(newCard);
                    }
                }
            });

            // Apply positions
            if (state.positions) {
                const metrics = this._getGridMetrics();
                const maxRow = metrics ? metrics.maxRows : 20;
                grid.querySelectorAll('.widget-card').forEach(card => {
                    const id = card.dataset.widgetId;
                    const pos = state.positions[id];
                    if (pos) {
                        const row = Math.min(pos.row, maxRow);
                        const span = pos.span || this._getDefaultSpan(id);
                        const rowSpan = pos.rowSpan || this._getDefaultRowSpan(id);
                        card.style.gridColumn = `${pos.col || 1} / span ${span}`;
                        card.style.gridRow = `${row} / span ${rowSpan}`;
                        card.dataset.widgetSpan = String(span);
                        card.dataset.widgetRowSpan = String(rowSpan);
                    }
                });
            }

            // Apply sizes
            if (state.sizes) {
                try { localStorage.setItem('ichtus_dashboard_widget_sizes', JSON.stringify(state.sizes)); } catch (e) {}
                this._restoreWidgetSizes();
            }
        } else {
            // Fallback for default layout if no saved state exists yet:
            // Just restore all hardcoded/default widgets in their initial state.
            const defaultWidgetIds = ['quicklinks', 'servicetimer', 'status'];
            defaultWidgetIds.forEach(id => {
                const card = grid.querySelector(`[data-widget-id="${id}"]`);
                if (!card) {
                    const html = this.getWidgetTemplate(id);
                    if (html) {
                        const wrapper = document.createElement('div');
                        wrapper.innerHTML = html;
                        const newCard = wrapper.firstElementChild;
                        if (newCard) grid.appendChild(newCard);
                    }
                }
            });
            // Reset grid column / row styles to default span
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                const span = this._getDefaultSpan(id);
                const rowSpan = this._getDefaultRowSpan(id);
                card.style.gridColumn = `span ${span}`;
                card.style.gridRow = `span ${rowSpan}`;
                card.dataset.widgetSpan = String(span);
                card.dataset.widgetRowSpan = String(rowSpan);
            });
        }

        // Reset style dimensions and heights to default card styling
        grid.querySelectorAll('.widget-card').forEach(card => {
            card.style.height = '';
            card.style.minHeight = '';
        });

        this._saveWidgetPositions();
        this.setActiveLayoutName(layoutName);
        this._isApplyingLayout = false;

        this.populateLayoutSelector();
        document.querySelectorAll('#widget-grid .widget-body').forEach(b => { b.style.display = ''; });
    },

    switchLayout(layoutName) {
        if (layoutName === '__new__') {
            this.createNewLayout();
            const triggerText = document.getElementById('custom-select-text');
            if (triggerText) {
                const activeName = this.getActiveLayoutName();
                triggerText.textContent = activeName === '__default__' ? (i18n.t('dashboard_layout_default') || 'Default') : activeName;
            }
            return;
        }
        this.applyLayout(layoutName);
        const triggerText = document.getElementById('custom-select-text');
        if (triggerText) {
            const activeName = this.getActiveLayoutName();
            triggerText.textContent = activeName === '__default__' ? (i18n.t('dashboard_layout_default') || 'Default') : activeName;
        }
    },

    toggleCustomDropdown() {
        const options = document.getElementById('custom-select-options');
        const container = document.querySelector('.custom-select-container');
        if (!options) return;
        options.classList.toggle('show');
        if (container) container.classList.toggle('open', options.classList.contains('show'));
    },

    selectCustomOption(element) {
        const value = element.getAttribute('data-value');
        const text = element.textContent;
        document.getElementById('custom-select-text').textContent = text;
        document.getElementById('custom-select-options').classList.remove('show');
        const container = document.querySelector('.custom-select-container');
        if (container) container.classList.remove('open');
        this.switchLayout(value);
    },
    _initDropdownCloseListener() {
        if (this._dropdownCloseListenerAdded) return;
        this._dropdownCloseListenerAdded = true;
        window.addEventListener('click', (e) => {
            const container = document.querySelector('.custom-select-container');
            if (container && !container.contains(e.target)) {
                const options = document.getElementById('custom-select-options');
                if (options) {
                    options.classList.remove('show');
                    container.classList.remove('open');
                }
            }
        });
    },


    // ===============================
    //  EDIT MODE
    // ===============================
    toggleEditMode() {
        this._editMode = !this._editMode;
        const grid = document.getElementById('widget-grid');
        const addBtn = document.getElementById('dash-add-widget-btn');
        const editBtn = document.querySelector('.dash-edit-btn');

        if (grid) grid.classList.toggle('edit-mode', this._editMode);
        if (addBtn) addBtn.style.display = this._editMode ? 'block' : 'none';
        if (editBtn) editBtn.classList.toggle('active', this._editMode);
        this._createGridOverlay();

        document.querySelectorAll('#widget-grid .widget-card').forEach(card => {
            // Remove old handles
            card.querySelectorAll('.widget-delete-btn, .widget-resize-handle').forEach(el => el.remove());
            if (this._editMode) {
                const delBtn = document.createElement('button');
                delBtn.className = 'widget-delete-btn';
                delBtn.innerHTML = '×';
                delBtn.title = 'Delete widget';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteWidget(card);
                });
                const header = card.querySelector('.widget-header');
                if (header) header.appendChild(delBtn);
                else card.appendChild(delBtn);

                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'widget-resize-handle';
                card.appendChild(resizeHandle);
                this._initResizeHandle(card);
            }
        });
    },

    // ===============================
    //  WIDGET MANAGEMENT
    // ===============================
    deleteWidget(card) {
        this.showConfirmModal('Remove this widget?', () => {
            const wasProPresenter = card.dataset.widgetId === 'propresenter' || card.dataset.widgetId === 'propresenter-playlist' || card.dataset.widgetId === 'playlist-overview';
            card.remove();
            this.setupDragAndDrop();
            this.saveWidgetOrder();
            if (!document.querySelector('.widget-card[data-widget-id="propresenter"], .widget-card[data-widget-id="propresenter-playlist"], .widget-card[data-widget-id="playlist-overview"]')) {
                this._stopProPresenterPolling();
            }
            if (!document.querySelector('.widget-card[data-widget-id="propresenter-playlist"]')) {
                this._stopPlaylistChangeDetection();
                this._stopPlaylistSlideTracking();
            }
            if (!document.querySelector('.widget-card[data-widget-id="playlist-overview"]')) {
                this._stopPlaylistOverviewPolling();
            }
            if (card.dataset.widgetId === 'mic-iem-monitor' && this._micUnsubscribe) {
                this._micUnsubscribe();
                this._micUnsubscribe = null;
            }
        });
    },

    showConfirmModal(message, onConfirm) {
        document.querySelectorAll('.dash-confirm-backdrop, .dash-confirm-modal').forEach(el => el.remove());
        const backdrop = document.createElement('div');
        backdrop.className = 'dash-confirm-backdrop';
        const modal = document.createElement('div');
        modal.className = 'dash-confirm-modal';
        const msgEl = document.createElement('p');
        msgEl.textContent = message;
        const btnRow = document.createElement('div');
        btnRow.className = 'dash-confirm-buttons';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'dash-confirm-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => { backdrop.remove(); modal.remove(); });
        const okBtn = document.createElement('button');
        okBtn.className = 'dash-confirm-ok';
        okBtn.textContent = 'Remove';
        okBtn.addEventListener('click', () => { backdrop.remove(); modal.remove(); onConfirm(); });
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        modal.appendChild(msgEl);
        modal.appendChild(btnRow);
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
        backdrop.addEventListener('click', () => { backdrop.remove(); modal.remove(); });
    },

    addWidget() {
        let picker = document.getElementById('widget-picker');
        if (picker) { picker.remove(); return; }

        const addBtn = document.getElementById('dash-add-widget-btn');
        const grid = document.getElementById('widget-grid');
        if (!addBtn || !grid) return;

        picker = document.createElement('div');
        picker.id = 'widget-picker';
        picker.className = 'widget-picker';

        const items = [
            { id: 'quicklinks', icon: '🔗', label: 'Quick Links' },
            { id: 'servicetimer', icon: '⏱', label: 'Service Timer' },
            { id: 'status', icon: '📊', label: 'Workspace Status' },
            { id: 'propresenter', icon: '🖥', label: 'ProPresenter Presentation' },
            { id: 'propresenter-playlist', icon: '📋', label: 'ProPresenter Playlist' },
            { id: 'servicecountdown', icon: '⏳', label: 'Service Countdown' },
            { id: 'playlist-overview', icon: '📄', label: 'Playlist Overzicht' },
            { id: 'mic-iem-monitor', icon: '🎤', label: 'Mic & IEM Monitor' }
        ];

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'widget-picker-item';
            btn.innerHTML = `<span class="widget-picker-icon">${item.icon}</span> ${item.label}`;
            btn.addEventListener('click', () => {
                picker.remove();
                this.insertWidget(item.id);
            });
            picker.appendChild(btn);
        });

        const btnRect = addBtn.getBoundingClientRect();
        picker.style.position = 'fixed';
        picker.style.top = (btnRect.bottom + 4) + 'px';
        picker.style.left = btnRect.left + 'px';
        document.body.appendChild(picker);

        const closePicker = (e) => {
            if (!picker.contains(e.target) && e.target !== addBtn) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        };
        setTimeout(() => document.addEventListener('click', closePicker), 0);
    },

    // ===============================
    //  WIDGET TEMPLATES
    // ===============================
    getWidgetTemplate(widgetId) {
        switch (widgetId) {
            case 'quicklinks':
                return `<div class="widget-card" draggable="true" data-widget-id="quicklinks">
                    <div class="widget-header"><h3 class="widget-title">Quick Links</h3></div>
                    <div class="widget-body">
                        <div class="quick-links">
                            <a href="#" onclick="router.navigate('agenda')">📅 Agenda</a>
                            <a href="#" onclick="router.navigate('checklist')">✅ Checklist</a>
                            <a href="#" onclick="router.navigate('patchbay')">🔌 Patchbay</a>
                            <a href="#" onclick="router.navigate('setlist')">🎵 Setlist</a>
                            <a href="#" onclick="router.navigate('ndi')">📡 NDI</a>
                            <a href="#" onclick="router.navigate('settings')">⚙ Settings</a>
                        </div>
                    </div>
                </div>`;
            case 'servicetimer':
                return `<div class="widget-card" draggable="true" data-widget-id="servicetimer">
                    <div class="widget-header"><h3 class="widget-title">Service Timer</h3></div>
                    <div class="widget-body">
                        <div class="timer-widget">
                            <div id="dash-timer-display" class="dash-timer-display">00:00:00</div>
                            <div class="timer-controls">
                                <button id="dash-timer-start" class="btn">Start</button>
                                <button id="dash-timer-stop" class="btn" disabled>Stop</button>
                                <button id="dash-timer-reset" class="btn">Reset</button>
                            </div>
                        </div>
                    </div>
                </div>`;
            case 'status':
                return `<div class="widget-card" draggable="true" data-widget-id="status">
                    <div class="widget-header"><h3 class="widget-title">Workspace Status</h3></div>
                    <div class="widget-body">
                        <div class="status-list">
                            <div class="status-item"><span class="status-label">ProPresenter:</span><span class="status-value" id="status-propresenter">-</span></div>
                            <div class="status-item"><span class="status-label">NDI:</span><span class="status-value" id="status-ndi">-</span></div>
                            <div class="status-item"><span class="status-label">Firebase:</span><span class="status-value" id="status-firebase">-</span></div>
                        </div>
                    </div>
                </div>`;
            case 'propresenter':
                return `<div class="widget-card" draggable="true" data-widget-id="propresenter">
                    <div class="widget-header"><h3 class="widget-title"></h3><button class="pp-layout-toggle" onclick="dashboardModule._toggleSlidesLayout(this)" title="Toggle slides layout">⊞</button></div>
                    <div class="widget-body widget-propresenter" id="propresenter-slides-container">
                        <div class="pp-loading">Loading slides…</div>
                    </div>
                </div>`;
            case 'propresenter-playlist':
                const autoscrollPref = (() => { try { return localStorage.getItem('ichtus_pp_autoscroll'); } catch(e) { return null; } })();
                const autoscrollActive = autoscrollPref === null || autoscrollPref === '1';
                return `<div class="widget-card" draggable="true" data-widget-id="propresenter-playlist">
                    <div class="widget-header"><h3 class="widget-title"></h3><div class="pp-settings-wrap"><button class="pp-settings-btn" onclick="dashboardModule._togglePlaylistSettingsDropdown(event)" title="Playlist instellingen">⚙</button><div class="pp-settings-dropdown"><button class="pp-layout-toggle" onclick="dashboardModule._togglePlaylistLayout(this)" title="Toggle layout">⊞ Weergave</button><button class="pp-refresh-btn" onclick="dashboardModule._refreshPlaylist(this)" title="Refresh playlist">↻ Verversen</button><button class="pp-autoscroll-btn${autoscrollActive ? ' active' : ''}" onclick="dashboardModule._toggleAutoScroll(this)" title="${autoscrollActive ? 'Auto-scroll naar actieve slide' : 'Auto-scroll uit'}">◎ Auto-scroll</button></div></div></div>
                    <div class="widget-body widget-propresenter" id="propresenter-playlist-container">
                        <div class="pp-loading">Loading playlist…</div>
                    </div>
                </div>`;
            case 'playlist-overview':
                return `<div class="widget-card" draggable="true" data-widget-id="playlist-overview">
                    <div class="widget-header">
                        <h3 class="widget-title">ProPresenter Control</h3>
                        <button class="pp-refresh-btn" onclick="dashboardModule._refreshPlaylistOverview(this)" title="Vernieuwen">↻</button>
                    </div>
                    <div class="widget-body plo-control-body">
                        <!-- 1. Toolbar -->
                        <div class="plo-toolbar">
                            <button class="plo-tool-btn active" onclick="dashboardModule._triggerClear('slide', this)" title="Clear Slide">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                            </button>
                            <button class="plo-tool-btn" onclick="dashboardModule._triggerClear('timer', this)" title="Clear Timer">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            </button>
                            <button class="plo-tool-btn" onclick="dashboardModule._triggerClear('message', this)" title="Clear Message">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                            </button>
                            <button class="plo-tool-btn" onclick="dashboardModule._triggerClear('stage', this)" title="Clear Stage">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button class="plo-tool-btn" onclick="dashboardModule._triggerClear('props', this)" title="Clear Props">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                            </button>
                            <button class="plo-tool-btn" onclick="dashboardModule._triggerClear('background', this)" title="Clear Background">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                            </button>
                            <button class="plo-tool-btn lightning" onclick="dashboardModule._triggerClear('all', this)" title="Clear All">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                            </button>
                        </div>
                        
                        <!-- 2. Playlist Section -->
                        <div class="plo-section-title">PLAYLIST</div>
                        <div id="playlist-overview-container">
                            <div class="pp-loading">Laden…</div>
                        </div>

                        <!-- 3. Slides Section -->
                        <div class="plo-section-title">SLIDES</div>
                        <div id="playlist-overview-slides-container">
                            <div id="playlist-overview-slides" class="plo-slides-scroll">
                                <div class="pp-loading">Geen actieve slides</div>
                            </div>
                        </div>
                    </div>
                </div>`;
            case 'servicecountdown':
                return `<div class="widget-card" draggable="true" data-widget-id="servicecountdown">
                    <div class="widget-body">
                        <div class="countdown-widget">
                            <div class="countdown-labels" style="opacity: 1;">
                                <span class="countdown-target-info" id="countdown-target-info">Geen dienst gepland</span>
                            </div>
                            <div class="countdown-display heading-font" id="countdown-display">00:00:00</div>
                            <div class="countdown-settings hidden" id="countdown-settings-panel">
                                <input type="datetime-local" id="countdown-target-input" class="countdown-input">
                                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; width: 100%;">
                                    <button class="btn-save" onclick="dashboardModule.saveCountdownTarget(this)" style="flex: 1;">Opslaan</button>
                                    <button class="btn-cancel" onclick="dashboardModule.cancelCountdownSettings(this)" style="flex: 1; background: var(--border-light, #444); color: var(--text-main, #fff); border: none; border-radius: 6px; cursor: pointer; font-weight: 600; padding: 0.5rem; font-size: 0.9rem; transition: opacity 0.2s ease;">Annuleren</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;
            case 'mic-iem-monitor':
                return `<div class="widget-card" draggable="true" data-widget-id="mic-iem-monitor">
                    <div class="widget-body">
                        <div id="mic-monitor-grid" class="mic-monitor-grid">
                            <div class="pp-loading">Laden…</div>
                        </div>
                    </div>
                </div>`;
            default:
                return null;
        }
    },

    /**
     * Find the first available row for a new widget (simple top-down scan).
     */
    _getNewWidgetPosition(widgetId) {
        const span = this._getDefaultSpan(widgetId);
        const rowSpan = this._getDefaultRowSpan(widgetId);
        return this._findFreeSpot(span, rowSpan, 1, 1);
    },

    /**
     * Add a widget to the dashboard via the + button.
     */
    insertWidget(widgetId) {
        const template = this.getWidgetTemplate(widgetId);
        if (!template) return;

        const grid = document.getElementById('widget-grid');
        if (!grid) return;

        // Check capacity
        const metrics = this._getGridMetrics();
        if (metrics) {
            const allRows = [];
            grid.querySelectorAll('.widget-card').forEach(card => {
                const startRow = parseInt(card.style.gridRowStart) || 1;
                let rowSpan = parseInt(card.dataset.widgetRowSpan);
                if (!rowSpan) {
                    const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
                    rowSpan = Math.max(1, Math.ceil(minH / metrics.rowHeight));
                }
                allRows.push(startRow + rowSpan - 1);
            });
            const maxOccupiedRow = allRows.length > 0 ? Math.max(...allRows) : 0;
            if (maxOccupiedRow >= metrics.maxRows) {
                // Grid is full — still add but warn
                console.warn('Dashboard grid is full. Widget may overflow.');
            }
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = template;
        const card = wrapper.firstElementChild;
        if (!card) return;

        const span = this._getDefaultSpan(widgetId);
        const rowSpan = this._getDefaultRowSpan(widgetId);
        const pos = this._getNewWidgetPosition(widgetId);
        this._applyWidgetGrid(card, pos.col, pos.row, span, rowSpan);

        grid.appendChild(card);

        // Initialize widget-specific functionality
        if (widgetId === 'servicetimer') this.setupTimer();
        if (widgetId === 'servicecountdown') this.setupCountdown();
        if (widgetId === 'propresenter' || widgetId === 'propresenter-playlist' || widgetId === 'playlist-overview') this._startProPresenterPolling();
        if (widgetId === 'propresenter-playlist') {
            this._loadProPresenterPlaylist();
            this._startPlaylistChangeDetection();
            this._startPlaylistSlideTracking();
        }
        if (widgetId === 'playlist-overview') {
            this._startPlaylistOverviewPolling();
        }

        // Add edit-mode controls if edit mode is active
        if (this._editMode) {
            const delBtn = document.createElement('button');
            delBtn.className = 'widget-delete-btn';
            delBtn.innerHTML = '×';
            delBtn.title = 'Delete widget';
            delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteWidget(card); });
            const header = card.querySelector('.widget-header');
            if (header) header.appendChild(delBtn);
            else card.appendChild(delBtn);

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'widget-resize-handle';
            card.appendChild(resizeHandle);
            this._initResizeHandle(card);
        }

        this.setupDragAndDrop();
        this.saveWidgetOrder();
    },

    // ===============================
    //  MIC & IEM MONITOR
    // ===============================

    /** Hardware config cache */
    _micLocalCache: null,
    _micUnsubscribe: null,

    /**
     * Initialize the Mic Monitor: start Firestore listener.
     */
    _initMicMonitor() {
        if (typeof firebase === 'undefined' || !firebase.database) {
            // Geen Realtime Database – probeer Firestore
            this._initMicMonitorFirestore();
            return;
        }
        // Use Realtime Database if available
        try {
            const ref = firebase.database().ref('/mic_monitor/live_status');
            this._micUnsubscribe = ref.on('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    this._micLocalCache = data;
                    this._renderMicCardsDOM(data);
                }
            });
        } catch (e) {
            console.warn('[MIC] Realtime Database failed, trying Firestore:', e.message);
            this._initMicMonitorFirestore();
        }
    },

    /**
     * Fallback: use Firestore onSnapshot for real-time mic data.
     */
    _initMicMonitorFirestore() {
        if (typeof firebase === 'undefined' || !firebase.firestore) {
            console.warn('[MIC] No Firebase available');
            return;
        }
        try {
            this._micUnsubscribe = firebase.firestore().collection('mic_monitor').doc('live_status')
                .onSnapshot((doc) => {
                    if (doc.exists) {
                        const data = doc.data();
                        const channels = data.channels || [];
                        this._micLocalCache = channels;
                        this._renderMicCardsDOM(channels);
                    }
                }, (err) => {
                    console.warn('[MIC] Firestore listener error:', err.message);
                });
        } catch (e) {
            console.warn('[MIC] Firestore init failed:', e.message);
        }
    },

    /**
     * Render the 4 mic cards as 3D flip cards into the grid container.
     * Click a card to flip it and edit IEM Pack / Frequency on the back.
     */
    _renderMicCardsDOM(channels) {
        const gridContainer = document.getElementById('mic-monitor-grid');
        if (!gridContainer) return;

        // Don't overwrite DOM if any card is currently flipped (user is editing)
        if (gridContainer.querySelector('.mic-flip-card.flipped')) return;

        if (!channels || channels.length === 0) {
            gridContainer.innerHTML = '<div class="pp-loading">Geen data…</div>';
            return;
        }

        const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23444"><circle cx="12" cy="12" r="12"/></svg>`;

        gridContainer.innerHTML = channels.map(mic => {
            const micLabel = mic.name || 'Unassigned / Standby';
            return `<div class="mic-flip-card" data-mic-id="${mic.mic_id}" onclick="dashboardModule._flipMicCard(${mic.mic_id})">
                <div class="mic-flip-inner">
                    <!-- FRONT FACE -->
                     <div class="mic-flip-front mic-card">
                         <div class="mic-card-photo" style="background-image: url(${mic.avatar_url || fallbackSvg});">
                             <span class="mic-badge">MIC ${mic.mic_id}</span>
                         </div>
                         <div class="mic-card-info">
                             <div class="mic-name">${micLabel}</div>
                             <div class="mic-iem">${mic.iem_pack}</div>
                             <div class="mic-frequency">${mic.frequency}</div>
                         </div>
                     </div>
                    <!-- BACK FACE -->
                    <div class="mic-flip-back">
                        <div class="mic-card-header">
                            <span class="mic-label">CONFIG MIC ${mic.mic_id}</span>
                        </div>
                        <div class="mic-edit-fields">
                            <div class="mic-edit-row">
                                <label>IEM Pack</label>
                                <input type="text" class="mic-input edit-iem" value="${mic.iem_pack}" placeholder="IEM Pack ${mic.mic_id}" onclick="event.stopPropagation()">
                            </div>
                            <div class="mic-edit-row">
                                <label>RF Frequentie</label>
                                <input type="text" class="mic-input edit-freq" value="${mic.frequency}" placeholder="000.000 MHz" onclick="event.stopPropagation()">
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    /**
     * Flip a mic card between front (info) and back (edit).
     * When flipping back to front, save edited hardware fields to Firestore.
     */
    _flipMicCard(micId) {
        const flipCard = document.querySelector(`#mic-monitor-grid .mic-flip-card[data-mic-id="${micId}"]`);
        if (!flipCard) return;
        
        const isCurrentlyFlipped = flipCard.classList.contains('flipped');
        
        if (isCurrentlyFlipped) {
            // Flipping BACK to front: save edits from the back face
            const iemPack = flipCard.querySelector('.edit-iem')?.value?.trim() || '';
            const frequency = flipCard.querySelector('.edit-freq')?.value?.trim() || '';
            
            // Update local cache
            if (!this._micLocalCache || !Array.isArray(this._micLocalCache)) return;
            const channel = this._micLocalCache.find(c => c.mic_id === micId);
            if (!channel) return;
            
            // Only save if values actually changed
            const changed = channel.iem_pack !== iemPack || channel.frequency !== frequency;
            channel.iem_pack = iemPack;
            channel.frequency = frequency;
            
            // Write to Firestore in background (only if changed)
            if (changed) {
                this._writeMicAssignmentsToFirestore(this._micLocalCache, 'hardware');
            }
            
            // Update front face in-place (preserves flip animation)
            const frontIem = flipCard.querySelector('.mic-flip-front .mic-iem');
            const frontFreq = flipCard.querySelector('.mic-flip-front .mic-frequency');
            if (frontIem) frontIem.textContent = iemPack;
            if (frontFreq) frontFreq.textContent = frequency;
            
            // Flip back
            flipCard.classList.remove('flipped');
        } else {
            // Flipping TO back: just show edit fields
            flipCard.classList.add('flipped');
        }
    },
// ===============================
    //  ROSTER → MIC AUTO-ASSIGNMENT
    // ===============================

    /**
     * Initialize the roster listener from the WorshipTools extension.
     * When roster data arrives, apply AV Stage Business Rules and write to Firestore.
     */
    _initRosterListener() {
        if (this._rosterListenerAdded) return;
        this._rosterListenerAdded = true;
        document.addEventListener('worshiptools-roster', (e) => {
            const roster = e.detail?.roster;
            if (!roster || !Array.isArray(roster)) return;
            console.log('[MIC] Received roster from extension:', roster.length, 'assignments');
            this._processRoster(roster);
        });
    },

    /**
     * Apply AV Stage Business Rules to roster data and write mic assignments.
     *
     * Rules:
     * - Worship Leader → Mic 1 (unless also on Piano → then WL skipped for mic)
     * - Vocalists → remaining mics (2, 3, 4)
     * - If WL is also on Piano, they get NO mic, and Vocalists start from Mic 1
     */
    /**
     * Extract the first name from a full name. E.g. "Rafael Barendse" → "Rafael".
     */
    _getFirstName(fullName) {
        if (!fullName) return '';
        return fullName.trim().split(' ')[0];
    },

    _processRoster(roster) {
        // Group by person: collect all roles per person + avatar URLs
        const personRoles = {};
        const personAvatars = {};
        roster.forEach(entry => {
            const firstName = this._getFirstName(entry.name);
            if (!personRoles[firstName]) {
                personRoles[firstName] = new Set();
            }
            personRoles[firstName].add(entry.role);
            if (entry.avatar_url && !personAvatars[firstName]) {
                personAvatars[firstName] = entry.avatar_url;
            }
        });

        // Determine WL and vocalists
        let wlName = null;
        const vocalists = [];

        for (const [name, roles] of Object.entries(personRoles)) {
            const rolesLower = new Set();
            roles.forEach(r => rolesLower.add(r.toLowerCase()));

            if (rolesLower.has('worship leader')) {
                wlName = name;
            }
            if (rolesLower.has('vocalist')) {
                vocalists.push(name);
            }
        }

        console.log('[MIC] WL:', wlName, '| Vocalists:', vocalists);

        // Apply AV Stage Business Rules
        const assignments = [];
        let micIndex = 1;

        // Rule: Worship Leader gets Mic 1 UNLESS also on Piano
        if (wlName) {
            const wlRoles = personRoles[wlName];
            const wlRolesLower = new Set();
            wlRoles.forEach(r => wlRolesLower.add(r.toLowerCase()));

            if (!wlRolesLower.has('piano')) {
                assignments.push({ mic_id: micIndex, name: wlName });
                micIndex++;
            } else {
                console.log('[MIC] WL', wlName, 'also on Piano — skipping mic assignment');
            }
        }

        // Vocalists get remaining mics
        vocalists.forEach(name => {
            if (name !== wlName && micIndex <= 4) {
                assignments.push({ mic_id: micIndex, name });
                micIndex++;
            }
        });

        console.log('[MIC] Final assignments:', assignments);

        // Build 4-channel array for Firestore
        const channels = [];
        for (let i = 1; i <= 4; i++) {
            const assigned = assignments.find(a => a.mic_id === i);
            channels.push({
                mic_id: i,
                name: assigned ? assigned.name : 'Unassigned / Standby',
                iem_pack: 'IEM Pack ' + i,
                frequency: '',
                active: !!assigned,
                avatar_url: assigned ? (personAvatars[assigned.name] || '') : ''
            });
        }

        // Write to Firestore
        this._writeMicAssignmentsToFirestore(channels);
    },

    /**
     * Write mic assignments to Firestore. Tries Firestore first, then Realtime Database.
     */
    _writeMicAssignmentsToFirestore(channels, context) {
        if (typeof firebase === 'undefined') {
            console.warn('[MIC] No Firebase available — cannot write assignments');
            this.showStatus('❓ Geen Firebase verbinding', 'error');
            return;
        }

        const isHardwareSave = context === 'hardware';
        const label = isHardwareSave ? 'Mic configuratie' : 'Mic toewijzing';
        const activeCount = channels.filter(c => c.active).length;

        // Try Firestore first
        if (firebase.firestore) {
            try {
                firebase.firestore().collection('mic_monitor').doc('live_status').set({
                    channels: channels,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true }).then(() => {
                    console.log('[MIC]', label, 'written to Firestore');
                    this.showStatus('✅ ' + label + ' opgeslagen (' + (isHardwareSave ? channels.length + ' kanalen' : activeCount + ' actief') + ')', 'success');
                }).catch(err => {
                    console.error('[MIC] Firestore write failed:', err);
                    this.showStatus('❓ Opslaan mislukt: ' + err.message, 'error');
                });
            } catch (e) {
                console.error('[MIC] Firestore write error:', e);
            }
        } else if (firebase.database) {
            // Fallback to Realtime Database
            try {
                firebase.database().ref('/mic_monitor/live_status').set(channels).then(() => {
                    console.log('[MIC]', label, 'written to RTDB');
                    this.showStatus('✅ ' + label + ' opgeslagen (' + (isHardwareSave ? channels.length + ' kanalen' : activeCount + ' actief') + ')', 'success');
                }).catch(err => {
                    console.error('[MIC] RTDB write failed:', err);
                    this.showStatus('❓ Opslaan mislukt: ' + err.message, 'error');
                });
            } catch (e) {
                console.error('[MIC] RTDB write error:', e);
            }
        }
    },



    // ===============================
    //  LAYOUT SAVE / DELETE / RENAME
    // ===============================
    saveCurrentLayout() {
        const activeName = this.getActiveLayoutName();
        if (activeName !== '__default__') {
            const layouts = this.loadLayouts();
            layouts[activeName] = this.getCurrentState();
            this.saveLayouts(layouts);
            this.populateLayoutSelector();
            return;
        }
        const name = prompt(i18n.t('dashboard_layout_save_prompt') || 'Save layout as:');
        if (!name || !name.trim()) return;
        const layouts = this.loadLayouts();
        layouts[name.trim()] = this.getCurrentState();
        this.saveLayouts(layouts);
        this.setActiveLayoutName(name.trim());
        this.populateLayoutSelector();
    },

    deleteLayout(name) {
        const layouts = this.loadLayouts();
        delete layouts[name];
        this.saveLayouts(layouts);
        if (this.getActiveLayoutName() === name) {
            this.setActiveLayoutName('__default__');
            this.applyLayout('__default__');
        }
        this.populateLayoutSelector();
    },

    renameLayout(oldName, newName) {
        if (!newName || !newName.trim()) return false;
        const trimmed = newName.trim();
        const layouts = this.loadLayouts();
        if (layouts[trimmed] && trimmed !== oldName) return false;
        layouts[trimmed] = layouts[oldName];
        delete layouts[oldName];
        this.saveLayouts(layouts);
        if (this.getActiveLayoutName() === oldName) this.setActiveLayoutName(trimmed);
        this.populateLayoutSelector();
        return true;
    },

    manageLayout() {
        let modal = document.querySelector('.layout-manage-modal');
        if (modal) { modal.remove(); return; }

        modal = document.createElement('div');
        modal.className = 'layout-manage-modal';
        const content = document.createElement('div');
        content.className = 'layout-manage-content';

        const title = document.createElement('h3');
        title.textContent = i18n.t('dashboard_layout_manage') || 'Manage Layouts';
        content.appendChild(title);

        const layouts = this.loadLayouts();
        const list = document.createElement('ul');
        list.className = 'layout-manage-list';

        if (Object.keys(layouts).length === 0) {
            const empty = document.createElement('li');
            empty.textContent = i18n.t('dashboard_layout_no_layouts') || 'No saved layouts yet';
            empty.style.color = 'var(--text-secondary)';
            empty.style.padding = '1rem';
            list.appendChild(empty);
        } else {
            Object.keys(layouts).forEach(name => {
                const item = document.createElement('li');
                item.className = 'layout-manage-item';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'layout-name';
                nameSpan.textContent = name;
                
                const actions = document.createElement('div');
                actions.className = 'layout-actions';
                
                const renameBtn = document.createElement('button');
                renameBtn.className = 'rename-btn';
                renameBtn.textContent = '✎';
                renameBtn.title = i18n.t('dashboard_layout_rename') || 'Rename';
                renameBtn.addEventListener('click', () => {
                    const newName = prompt(i18n.t('dashboard_layout_rename_prompt') || 'Rename layout to:', name);
                    if (newName && this.renameLayout(name, newName)) {
                        modal.remove();
                        this.manageLayout();
                    }
                });
                
                const duplicateBtn = document.createElement('button');
                duplicateBtn.className = 'duplicate-btn';
                duplicateBtn.textContent = '📋';
                duplicateBtn.title = i18n.t('dashboard_layout_duplicate') || 'Duplicate';
                duplicateBtn.addEventListener('click', () => {
                    this.duplicateLayout(name);
                    modal.remove();
                    this.manageLayout();
                });
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.textContent = '×';
                deleteBtn.title = i18n.t('dashboard_layout_delete') || 'Delete';
                deleteBtn.addEventListener('click', () => {
                    if (confirm(`Delete layout "${name}"?`)) {
                        this.deleteLayout(name);
                        modal.remove();
                        this.manageLayout();
                    }
                });
                
                actions.appendChild(renameBtn);
                actions.appendChild(duplicateBtn);
                actions.appendChild(deleteBtn);
                item.appendChild(nameSpan);
                item.appendChild(actions);
                list.appendChild(item);
            });
        }
        content.appendChild(list);

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'layout-manage-global-actions';
        actionsContainer.style.display = 'flex';
        actionsContainer.style.gap = '0.5rem';
        actionsContainer.style.marginTop = '1rem';
        actionsContainer.style.justifyContent = 'center';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'layout-manage-close';
        saveBtn.textContent = '💾 Opslaan';
        saveBtn.style.margin = '0';
        saveBtn.addEventListener('click', () => {
            this.saveCurrentLayout();
            modal.remove();
            this.manageLayout();
        });

        const newBtn = document.createElement('button');
        newBtn.className = 'layout-manage-close';
        newBtn.textContent = '＋ Nieuw';
        newBtn.style.margin = '0';
        newBtn.addEventListener('click', () => {
            this.createNewLayout();
            modal.remove();
            this.manageLayout();
        });

        actionsContainer.appendChild(saveBtn);
        actionsContainer.appendChild(newBtn);
        content.appendChild(actionsContainer);

        // Divider & Cloud synchronization section
        const cloudHr = document.createElement('hr');
        cloudHr.style.cssText = 'border: 0; border-top: 1px solid var(--border-light); margin: 1rem 0;';
        content.appendChild(cloudHr);

        const cloudTitle = document.createElement('h4');
        cloudTitle.textContent = 'Cloud Synchronisatie';
        cloudTitle.style.cssText = 'color: var(--text-main); font-size: 0.9rem; font-weight: 500; margin: 0 0 0.5rem 0; text-align: center;';
        content.appendChild(cloudTitle);

        const cloudActions = document.createElement('div');
        cloudActions.style.cssText = 'display: flex; gap: 0.5rem; justify-content: center;';

        const cloudSaveBtn = document.createElement('button');
        cloudSaveBtn.className = 'layout-manage-close';
        cloudSaveBtn.textContent = '☁️ Cloud Opslaan';
        cloudSaveBtn.style.margin = '0';
        cloudSaveBtn.addEventListener('click', async () => {
            const success = await this.saveToCloud();
            if (success) modal.remove();
        });

        const cloudLoadBtn = document.createElement('button');
        cloudLoadBtn.className = 'layout-manage-close';
        cloudLoadBtn.textContent = '📂 Cloud Laden';
        cloudLoadBtn.style.margin = '0';
        cloudLoadBtn.addEventListener('click', async () => {
            const success = await this.loadFromCloud();
            if (success) modal.remove();
        });

        cloudActions.appendChild(cloudSaveBtn);
        cloudActions.appendChild(cloudLoadBtn);
        content.appendChild(cloudActions);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'layout-manage-close';
        closeBtn.textContent = i18n.t('dashboard_layout_close') || 'Close';
        closeBtn.addEventListener('click', () => modal.remove());
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    },

    createNewLayout(name) {
        if (!name) {
            name = prompt(i18n.t('dashboard_layout_new_prompt') || 'Naam voor het nieuwe dashboard:');
        }
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        if (trimmed === '__default__') {
            alert('Deze naam is gereserveerd.');
            return;
        }
        const layouts = this.loadLayouts();
        if (layouts[trimmed]) {
            alert('Er bestaat al een dashboard met deze naam.');
            return;
        }
        layouts[trimmed] = this.getCurrentState();
        this.saveLayouts(layouts);
        this.setActiveLayoutName(trimmed);
        this.applyLayout(trimmed);
        
        this.populateLayoutSelector();
    },

    duplicateLayout(layoutName) {
        if (!layoutName) layoutName = this.getActiveLayoutName();
        const newName = prompt(i18n.t('dashboard_layout_duplicate_prompt') || 'Naam voor het gedupliceerde dashboard:', `${layoutName} (Kopie)`);
        if (!newName || !newName.trim()) return;
        const trimmed = newName.trim();
        if (trimmed === '__default__') {
            alert('Deze naam is gereserveerd.');
            return;
        }
        const layouts = this.loadLayouts();
        if (layouts[trimmed]) {
            alert('Er bestaat al een dashboard met deze naam.');
            return;
        }
        const sourceState = layoutName === '__default__' ? this.getCurrentState() : layouts[layoutName];
        layouts[trimmed] = JSON.parse(JSON.stringify(sourceState));
        this.saveLayouts(layouts);
        this.setActiveLayoutName(trimmed);
        this.applyLayout(trimmed);
        
        this.populateLayoutSelector();
    },

    async saveToCloud() {
        if (typeof useFirebase === 'undefined' || !useFirebase || typeof db === 'undefined' || !db) {
            this.showStatus('☁️ Geen Firebase verbinding', 'error');
            return false;
        }
        try {
            // First save locally to ensure consistency
            this._saveWidgetPositions();

            const layouts = this.loadLayouts();
            const activeLayout = this.getActiveLayoutName();
            
            // Get default layout state
            let defaultOrder = [];
            let defaultPositions = {};
            try {
                defaultOrder = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_order') || '[]');
                defaultPositions = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_positions') || '{}');
            } catch (e) {}

            // Get widget sizes
            let sizes = {};
            try {
                sizes = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_sizes') || '{}');
            } catch (e) {}

            // Get countdown target
            const countdownTarget = localStorage.getItem('ichtus_countdown_target');

            // Save to Firestore
            await db.collection('dashboard').doc('state').set({
                layouts: layouts,
                activeLayout: activeLayout,
                defaultLayout: {
                    order: defaultOrder,
                    positions: defaultPositions
                },
                sizes: sizes,
                countdownTarget: countdownTarget || '',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : 'anonymous'
            }, { merge: true });

            this.showStatus('☁️ Dashboard opgeslagen in Cloud ✓', 'success');
            return true;
        } catch (e) {
            console.error('Cloud save failed:', e);
            this.showStatus('☁️ Cloud opslag mislukt: ' + e.message, 'error');
            return false;
        }
    },

    async loadFromCloud() {
        if (typeof useFirebase === 'undefined' || !useFirebase || typeof db === 'undefined' || !db) {
            this.showStatus('☁️ Geen Firebase verbinding', 'error');
            return false;
        }
        try {
            const doc = await db.collection('dashboard').doc('state').get();
            if (doc.exists) {
                const data = doc.data();
                
                // Confirm before overwriting local data
                const confirmed = confirm('Dit vervangt al je lokale dashboard instellingen en layouts door de cloud versie. Doorgaan?');
                if (!confirmed) {
                    this.showStatus('☁️ Laden geannuleerd', 'info');
                    return false;
                }

                // Restore layouts
                if (data.layouts) {
                    this.saveLayouts(data.layouts);
                }

                // Restore active layout name
                if (data.activeLayout) {
                    this.setActiveLayoutName(data.activeLayout);
                }

                // Restore default layout
                if (data.defaultLayout) {
                    if (data.defaultLayout.order) {
                        localStorage.setItem('ichtus_dashboard_widget_order', JSON.stringify(data.defaultLayout.order));
                    }
                    if (data.defaultLayout.positions) {
                        localStorage.setItem('ichtus_dashboard_widget_positions', JSON.stringify(data.defaultLayout.positions));
                    }
                }

                // Restore widget sizes
                if (data.sizes) {
                    localStorage.setItem('ichtus_dashboard_widget_sizes', JSON.stringify(data.sizes));
                }

                // Restore countdown target
                if (data.countdownTarget) {
                    localStorage.setItem('ichtus_countdown_target', data.countdownTarget);
                }

                // Apply active layout and reload view
                const active = this.getActiveLayoutName();
                this.applyLayout(active);
                
                // Re-setup countdown in case it changed
                if (typeof this.setupCountdown === 'function') {
                    this.setupCountdown();
                }

                this.showStatus('☁️ Dashboard geladen uit Cloud ✓', 'success');
                return true;
            } else {
                this.showStatus('☁️ Nog geen cloud dashboard data gevonden', 'info');
                return false;
            }
        } catch (e) {
            console.error('Cloud load failed:', e);
            this.showStatus('☁️ Cloud laden mislukt: ' + e.message, 'error');
            return false;
        }
    },

    showStatus(msg, type) {
        // Create a temporary toast notification styled beautifully
        const toast = document.createElement('div');
        toast.className = 'dashboard-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(42, 42, 42, 0.95);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10001;
            border: 1px solid var(--ichtus-orange, #f47920);
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            pointer-events: none;
            transition: opacity 0.3s ease;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        
        // Simple fade out
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    },

    // ===============================
    //  PROPRESENTER POLLING
    // ===============================
    _getProPresenterBaseUrl() {
        let ip = '127.0.0.1', port = '50001';
        // Priority 1: centrale settings (alleen als expliciet opgeslagen door gebruiker)
        if (typeof settingsModule !== 'undefined' && settingsModule.settings && settingsModule.settings.proPresenterIp) {
            ip = settingsModule.settings.proPresenterIp;
            port = settingsModule.settings.proPresenterPort || port;
        } else {
            // Priority 2: legacy setlistProIp (voor gebruikers die IP in Setlist pagina hebben ingesteld)
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
        const url = `http://${ip}:${port}`;
        return url;
    },

    _fetchProPresenterSlides(widgetEl) {
        const baseUrl = this._getProPresenterBaseUrl();
        // Fetch slides + current slide index in parallel
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
                    // XML fallback
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
                // Update title: playlist name, or fallback to presentation name
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
        // Update widget title with playlist name
        const titleEl = widgetEl.querySelector('.widget-title');
        if (titleEl && playlistName) {
            titleEl.textContent = `Playlist "${playlistName}"`;
        }
        const baseUrl = this._getProPresenterBaseUrl();
        // Build thumbnail URL. PP7 uses /v1/presentation/{uuid}/thumbnail/{idx}
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
        // Apply saved slides layout preference (list or grid)
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
        // Visual feedback: briefly highlight the clicked thumbnail
        document.querySelectorAll('.pp-slide-item[data-slide-index="' + index + '"]').forEach(el => {
            el.classList.remove('pp-triggered');
            void el.offsetWidth; // force reflow to restart animation on rapid clicks
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
                // Detect presentation change (new song in playlist)
                const presentationChanged = uuid && uuid !== this._proPresenterLastPresentationUuid;
                if (presentationChanged) {
                    this._proPresenterLastPresentationUuid = uuid;
                    // Full refresh: re-fetch slides and title
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

    _startProPresenterPolling() {
        this._stopProPresenterPolling();
        this._updateAllProPresenterWidgets();
        // Skip both ProPresenter polls while the dashboard is hidden.
        // The 500 ms fast interval is the heaviest single wake-up in the app.
        this._proPresenterInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            this._updateAllProPresenterWidgets();
        }, 15000);
        this._proPresenterFastInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            this._updateAllProPresenterIndexes();
        }, 500);
    },

    _stopProPresenterPolling() {
        if (this._proPresenterInterval) { clearInterval(this._proPresenterInterval); this._proPresenterInterval = null; }
        if (this._proPresenterFastInterval) { clearInterval(this._proPresenterFastInterval); this._proPresenterFastInterval = null; }
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
    //  Shows all slides from all presentations in the active playlist.
    //  Loads once when dashboard opens; auto-refreshes when playlist changes.
    // ===============================

    /** Lightweight 2s poll: only checks if ANY active playlist UUID changed. */
    _startPlaylistChangeDetection() {
        this._stopPlaylistChangeDetection();
        // NIET resetten: _proPresenterPlaylistLastUuid kan al gezet zijn door cache restore
        const baseUrl = this._getProPresenterBaseUrl();
        // Skip the playlist-change fetch when the dashboard is not active:
        // the network round-trip + state-diff otherwise fires every tick.
        this._proPresenterPlaylistCheckInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
                .then(r => r.json())
                .then(data => {
                    const presUuid = data?.presentation?.playlist?.uuid || null;
                    const annUuid = data?.announcements?.playlist?.uuid || null;
                    const combinedKey = `${presUuid ?? ''}|${annUuid ?? ''}`;
                    // Skip if BOTH playlists are empty (e.g. after slide trigger)
                    if (!presUuid && !annUuid) {
                        return;
                    }
                    if (combinedKey === this._proPresenterPlaylistLastUuid) {
                        return;
                    }
                    // Reload als: (a) we al een eerdere UUID hadden, OF (b) we nog nooit playlist data hebben geladen
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

    /**
     * Lightweight 1s poll: updates the active slide indicator in playlist widgets
     * without re-fetching all presentations. Uses /v1/presentation/slide_index
     * to find which presentation + slide is currently on air.
     */
    _startPlaylistSlideTracking() {
        this._stopPlaylistSlideTracking();
        const baseUrl = this._getProPresenterBaseUrl();
        // Skip slide-index fetches when not on the dashboard.
        this._proPresenterPlaylistSlideCheckInterval = setInterval(() => {
            if (!router.isDashboardActive()) return;
            fetch(`${baseUrl}/v1/presentation/slide_index`, {
                headers: { 'Accept': 'application/json' }
            })
                .then(r => r.json())
                .then(data => {
                    const activePresUuid = data?.presentation_index?.presentation_id?.uuid || null;
                    const activeSlideIdx = data?.presentation_index?.index ?? 0;

                    // Update active slide in all playlist widgets
                    document.querySelectorAll('.widget-card[data-widget-id="propresenter-playlist"]').forEach(widget => {
                        const container = widget.querySelector('#propresenter-playlist-container');
                        if (!container) return;

                        // Remove active from all slides
                        container.querySelectorAll('.pp-slide-item.active').forEach(el => el.classList.remove('active'));

                        // Find and mark active slide
                        if (activePresUuid) {
                            const activeEl = container.querySelector(`.pp-slide-item[data-pl-uuid="${activePresUuid}"][data-pl-slide-index="${activeSlideIdx}"]`);
                            if (activeEl) {
                                activeEl.classList.add('active');
                                // Auto-scroll alleen als de toggle aan staat
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

                    // Update active item in all playlist overview widgets in real-time
                    document.querySelectorAll('.widget-card[data-widget-id="playlist-overview"]').forEach(widget => {
                        const container = widget.querySelector('#playlist-overview-container');
                        if (!container) return;

                        if (activePresUuid) {
                            const activeEl = container.querySelector(`.plo-item[data-pres-uuid="${activePresUuid}"]`);
                            if (activeEl && !activeEl.classList.contains('active')) {
                                // Remove active from all items first
                                container.querySelectorAll('.plo-item.active').forEach(el => el.classList.remove('active'));
                                activeEl.classList.add('active');
                                
                                // Auto-scroll active item into view
                                const rect = activeEl.getBoundingClientRect();
                                const containerRect = container.getBoundingClientRect();
                                if (rect.bottom > containerRect.bottom || rect.top < containerRect.top) {
                                    activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                }
                            }
                        }

                        // Load and render slides in the slides section in real-time
                        this._loadPlaylistOverviewSlides(baseUrl, activePresUuid, activeSlideIdx);
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
    //  WEBSOCKET PLAYLIST NAVIGATION
    //  Gebruikt ProPresenter WebSocket API om binnen de playlist te navigeren
    //  zonder de playlist context te verbreken.
    // ===============================

    /** Bouw WebSocket URL op basis van hetzelfde IP/poort als de REST API */
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

    /** Haal playlist index op uit /v1/playlist/active en cache hem */
    _getActivePlaylistIndex() {
        const baseUrl = this._getProPresenterBaseUrl();
        return fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(data => {
                // De playlist index zit in data.presentation.playlist.index (0-based)
                const idx = data?.presentation?.playlist?.index;
                if (idx !== undefined && idx !== null) {
                    this._proPresenterPlaylistIndex = idx;
                    return idx;
                }
                // Fallback: zoek index via /v1/playlist
                return fetch(`${baseUrl}/v1/playlist`, { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json())
                    .then(playlists => {
                        const activeUuid = data?.presentation?.playlist?.uuid;
                        const list = Array.isArray(playlists) ? playlists : (playlists?.playlists || []);
                        const found = list.findIndex(p => p.uuid === activeUuid);
                        if (found >= 0) {
                            this._proPresenterPlaylistIndex = found;
                        } else {
                            this._proPresenterPlaylistIndex = 0;
                        }
                        return this._proPresenterPlaylistIndex;
                    });
            })
            .catch(() => {
                // Fallback naar 0 als er geen actieve playlist is
                this._proPresenterPlaylistIndex = 0;
                return 0;
            });
    },

    /** Trigger een slide via WebSocket — blijft binnen de playlist context */
    _triggerViaWebSocket(uuid, slideIndex, el) {
        const slideIndexStr = String(slideIndex);
        const itemIndex = el ? parseInt(el.dataset.plItemIndex) : 0;

        // Eerst playlist index ophalen (gecached of via API)
        const usePlaylistIndex = (idx) => {
            const presentationPath = `${idx}:${itemIndex}`;

            // Wachtwoord ophalen uit localStorage
            const password = localStorage.getItem('ichtus_pp_ws_password') || '';
            if (!password) {
                console.warn('[WS] Geen wachtwoord in localStorage, sla eerst wachtwoord in via init()');
                // Fallback naar REST als er geen wachtwoord is
                const baseUrl = this._getProPresenterBaseUrl();
                fetch(`${baseUrl}/v1/presentation/${uuid}/trigger`, { method: 'GET' })
                    .then(() => {
                        setTimeout(() => {
                            fetch(`${baseUrl}/v1/presentation/active/${slideIndex}/trigger`, { method: 'GET' })
                                .catch(() => {});
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
                // Stap 1: Authenticeren
                ws.send(JSON.stringify({
                    action: 'authenticate',
                    protocol: 701,
                    password: password
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    // Als we een auth response krijgen, stuur dan de trigger
                    if (msg.action === 'authenticate' && !didAuth) {
                        didAuth = true;
                        // Stap 2: Trigger de slide binnen de playlist
                        ws.send(JSON.stringify({
                            action: 'presentationTriggerIndex',
                            slideIndex: slideIndexStr,
                            presentationPath: presentationPath
                        }));
                    }
                    // Als we een trigger response krijgen (of een andere response), sluit dan
                    if (msg.action === 'presentationTriggerIndex' && !didTrigger) {
                        didTrigger = true;
                        setTimeout(() => {
                            try { ws.close(); } catch(e) {}
                        }, 100);
                    }
                } catch(e) {}
            };

            // Timeout: na 2s sluiten als er nog niets gebeurd is
            setTimeout(() => {
                if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                    try { ws.close(); } catch(e) {}
                }
            }, 2000);

            ws.onerror = () => {
                // Fallback bij WebSocket fout: probeer via REST (focus + trigger)
                console.warn('[WS] WebSocket error, falling back to REST');
                const baseUrl = this._getProPresenterBaseUrl();
                fetch(`${baseUrl}/v1/presentation/${uuid}/trigger`, { method: 'GET' })
                    .then(() => {
                        setTimeout(() => {
                            fetch(`${baseUrl}/v1/presentation/active/${slideIndex}/trigger`, { method: 'GET' })
                                .catch(() => {});
                        }, 150);
                    })
                    .catch(() => {});
            };

            ws.onclose = () => {};
        };

        // Gebruik gecached playlist index of haal hem op
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

    _loadProPresenterPlaylist() {
        document.querySelectorAll('.widget-card[data-widget-id="propresenter-playlist"]').forEach(el => {
            this._fetchProPresenterPlaylist(el);
            // Herstel auto-scroll voorkeur
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
        this._hasPlaylistData = false; // reset bij elke fetch, pas true na succesvolle render
        const baseUrl = this._getProPresenterBaseUrl();
        const container = widgetEl.querySelector('#propresenter-playlist-container') || widgetEl.querySelector('.widget-body') || widgetEl;

        // Step 1: Get active playlist info (both presentation AND announcements branches)
        fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(activeData => {

                const pres = activeData?.presentation;
                const ann = activeData?.announcements;

                // Collect ALL active playlists (both branches)
                const playlists = [];
                const currentItemIds = [];

                if (pres?.playlist?.uuid) {
                    playlists.push({ uuid: pres.playlist.uuid, name: pres.playlist.name || '', branch: 'presentation' });
                    if (pres?.item?.uuid) currentItemIds.push(pres.item.uuid);
                }
                if (ann?.playlist?.uuid) {
                    // Don't add duplicate if it's the same playlist as presentation
                    if (!playlists.find(p => p.uuid === ann.playlist.uuid)) {
                        playlists.push({ uuid: ann.playlist.uuid, name: ann.playlist.name || '', branch: 'announcements' });
                    }
                    if (ann?.item?.uuid && !currentItemIds.includes(ann.item.uuid)) {
                        currentItemIds.push(ann.item.uuid);
                    }
                }
                const titleEl = widgetEl.querySelector('.widget-title');

                if (!playlists.length) {
                    // Hebben we eerder al slides geladen? Zo ja, behoud de huidige inhoud.
                    if (this._hasPlaylistData) {
                        return;
                    }
                    // Bij een F5 refresh is _hasPlaylistData false, maar kunnen we nog herstellen uit localStorage cache
                    const cached = localStorage.getItem('ichtus_pp_playlist_cache');
                    if (cached) {
                        try {
                            const cacheData = JSON.parse(cached);
                            if (cacheData.html) {
                                container.innerHTML = cacheData.html.replace(/<div class="pp-group-badge">\s*Group\s*<\/div>\s*/gi, '');
                                this._hasPlaylistData = true;
                                // Herstel ook de UUID's zodat change detection blijft werken
                                if (cacheData.uuid && !this._proPresenterPlaylistLastUuid) {
                                    this._proPresenterPlaylistLastUuid = cacheData.uuid;
                                }
                                // Herstel de widget titel (playlist naam) — uit cache
                                if (cacheData.title) {
                                    const titleEl = widgetEl.querySelector('.widget-title');
                                    if (titleEl) {
                                        titleEl.textContent = cacheData.title;
                                    }
                                } else {
                                }
                                // Herstel layout voorkeur (grid/single)
                                try {
                                    const layoutPref = localStorage.getItem('ichtus_pp_playlist_layout');
                                    if (layoutPref === 'grid') {
                                        container.classList.add('pp-grid-layout');
                                    } else {
                                        container.classList.remove('pp-grid-layout');
                                    }
                                } catch (e) {}
                                return;
                            }
                        } catch(e) {
                            // Oude formaat (plain HTML), probeer alsnog
                            container.innerHTML = cached;
                            this._hasPlaylistData = true;
                            return;
                        }
                    }
                    // Geen cache en geen data — pas nu de titel leegmaken
                    if (titleEl) {
                        titleEl.textContent = '';
                    }
                    container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">📋</div><div>No active playlist</div></div>`;
                    return;
                }

                // We hebben playlists — nu pas de titel instellen (NA de early-return en cache checks)
                const titleNames = playlists.map(p => p.name).filter(Boolean);
                const uniqueNames = [...new Set(titleNames)];
                if (titleEl) {
                    const newTitle = `Playlist: ${uniqueNames.join(', ')}`;
                    titleEl.textContent = newTitle;
                }

                // Step 2: Fetch all unique playlists + slide index in parallel
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

                        // Combine items from all playlists (presentation first, then announcements)
                        let combinedItems = [];
                        let alreadySeenUuids = new Set();

                        // Sort playlists: presentation first, then announcements
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

                        // Step 3: Fetch all presentations' slides in parallel
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

                        Promise.all(presentationPromises)
                            .then(presentationResults => {

                                // Build flat list of ALL slides from ALL playlists
                                const allSlides = [];
                                let foundActive = false;

                                combinedItems.forEach(item => {
                                    if (item.type === 'header') {
                                        const color = item.header_color
                                            ? `rgba(${Math.round(item.header_color.red * 255)}, ${Math.round(item.header_color.green * 255)}, ${Math.round(item.header_color.blue * 255)}, 0.3)`
                                            : 'rgba(255,255,255,0.05)';
                                        allSlides.push({
                                            type: 'header',
                                            name: item.id?.name || '',
                                            color,
                                            isActive: currentItemIds.includes(item.id?.uuid)
                                        });
                                    } else if (item.type === 'presentation') {
                                        const result = presentationResults.find(r => r.uuid === item.presentation_info?.presentation_uuid);
                                        const slides = result?.slides || [];
                                        const isActiveItem = currentItemIds.includes(item.id?.uuid);

                                        // Voeg presentation naam header toe boven de slides
                                        if (slides.length > 0) {
                                            allSlides.push({
                                                type: 'presentation-header',
                                                name: item.id?.name || '',
                                                isActive: isActiveItem
                                            });
                                        }

                                        // Bouw een lookup voor groepsnamen per slide index
                                        const resultGroups = result?.groups || [];
                                        let globalSlideIdx = 0;
                                        const groupFirstSlides = new Set(); // set van global slide indices die de eerste in hun groep zijn
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
                                            // Bepaal de beste thumbnail URL
                                            let bestUrl = null;
                                            if (slide?.image && slide.image.startsWith('data:')) {
                                                bestUrl = slide.image;
                                            } else if (slide?.image && (slide.image.startsWith('http://') || slide.image.startsWith('https://'))) {
                                                bestUrl = slide.image;
                                            } else if (slide?.image && slide.image.startsWith('/')) {
                                                bestUrl = baseUrl + slide.image;
                                            } else if (slide?.image) {
                                                bestUrl = 'data:image/jpeg;base64,' + slide.image;
                                            } else if (slide?.thumb_url) {
                                                bestUrl = slide.thumb_url;
                                            } else if (slide?.thumbnail) {
                                                bestUrl = slide.thumbnail;
                                            } else if (slide?.image_url) {
                                                bestUrl = slide.image_url;
                                            }
                                            // Vind groepsnaam — alleen voor de eerste slide van elke groep
                                            let groupName = null;
                                            if (groupFirstSlides.has(slideIdx)) {
                                                // Zoek welke groep bij deze slideIdx hoort
                                                let cursor = 0;
                                                for (const g of resultGroups) {
                                                    const gSlides = g.slides || [];
                                                    if (cursor === slideIdx && gSlides.length > 0) {
                                                        const rawName = g.name || '';
                                                        // Skip default 'Group' name — geen badge tonen
                                                        groupName = (rawName.toLowerCase() === 'group') ? null : rawName;
                                                        break;
                                                    }
                                                    cursor += gSlides.length;
                                                }
                                            } else {
                                            }
                                                            allSlides.push({
                                                type: 'slide',
                                                uuid: item.presentation_info.presentation_uuid,
                                                itemIndex: item.id?.index ?? 0,
                                                slideIndex: slideIdx,
                                                label: slide.label || item.id?.name || '',
                                                isActive,
                                                thumbUrl: bestUrl,
                                                groupName
                                            });
                                        });
                                    }
                                });


                                this._renderPlaylistSlides(container, allSlides, baseUrl);
                                this._hasPlaylistData = true;

                                // Zet _proPresenterPlaylistLastUuid met de actuele UUID's, zodat change detection blijft werken
                                // Ook na eerste load (voordat de change detection poll de UUID heeft kunnen zetten)
                                const activeCombinedKey = playlists.map(p => p.uuid).join('|');
                                if (activeCombinedKey) {
                                    this._proPresenterPlaylistLastUuid = activeCombinedKey;
                                }

                                // Cache de gerenderde HTML + UUID's + titel in localStorage voor herstel na F5
                                try {
                                    const titleEl = widgetEl.querySelector('.widget-title');
                                    const cachedTitle = titleEl ? titleEl.textContent : '';
                                    const cacheData = JSON.stringify({
                                        html: container.innerHTML,
                                        uuid: this._proPresenterPlaylistLastUuid || '',
                                        title: cachedTitle
                                    });
                                    localStorage.setItem('ichtus_pp_playlist_cache', cacheData);

                                } catch(e) {}

                                // Apply saved layout preference (single-per-row or 2×2 grid)
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
                            })
                            .catch(() => {
                                container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>Failed to load presentations</div></div>`;
                            });
                    })
                    .catch(() => {
                        container.innerHTML = `<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>Failed to load playlist items</div></div>`;
                    });
            })
            .catch(err => {
                // Probeer eerst cache te herstellen voordat we offline tonen
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
                            return;
                        }
                    } catch(e) {
                        // Oude formaat, probeer gewoon titel te herstellen
                    }
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
        allSlides.forEach((item, idx) => {
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

        // Scroll active slide into view — alleen als auto-scroll aan staat
        if (this._playlistAutoScroll) {
            const activeEl = container.querySelector('.pp-slide-item.active');
            if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    _triggerPlaylistSlide(uuid, slideIndex, el) {
        // Visual feedback on the clicked element
        if (el) {
            el.classList.remove('pp-triggered');
            void el.offsetWidth;
            el.classList.add('pp-triggered');
            setTimeout(() => el.classList.remove('pp-triggered'), 350);
        }

        // Via WebSocket: presentationTriggerIndex navigeert binnen de playlist context
        // Hierdoor blijft /v1/playlist/active gewoon werken
        this._triggerViaWebSocket(uuid, slideIndex, el);
    },

    _togglePlaylistSettingsDropdown(event) {
        event.stopPropagation();
        const btn = event.currentTarget;
        if (!btn) return;
        const wrap = btn.closest('.pp-settings-wrap');
        const dropdown = wrap ? wrap.querySelector('.pp-settings-dropdown') : null;
        if (!dropdown) return;
        
        // Close all other settings dropdowns
        document.querySelectorAll('.pp-settings-dropdown.show').forEach(el => {
            if (el !== dropdown) el.classList.remove('show');
        });
        
        dropdown.classList.toggle('show');
        btn.classList.toggle('active', dropdown.classList.contains('show'));
        
        // Close on outside click
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

        // ===============================
    //  PLAYLIST OVERVIEW WIDGET
    //  Shows the full playlist structure: presentation names, headers,
    //  and announcements without individual slides.
    // ===============================

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
        // Skip the overview re-render when the user is on a different view.
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

        fetch(`${baseUrl}/v1/playlist/active`, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(activeData => {
                console.log('[PLO] activeData FULL:', JSON.stringify(activeData).substring(0, 3000));
                console.log('[PLO] pres keys:', Object.keys(activeData?.presentation || {}), '| ann keys:', Object.keys(activeData?.announcements || {}));
                const pres = activeData?.presentation;
                const ann = activeData?.announcements;

                const playlists = [];
                let activeItemIds = [];

                if (pres?.playlist?.uuid) {
                    playlists.push({ uuid: pres.playlist.uuid, name: pres.playlist.name || '', branch: 'presentation' });
                    if (pres?.item?.uuid) activeItemIds.push(pres.item.uuid);
                }
                if (ann?.playlist?.uuid) {
                    if (!playlists.find(p => p.uuid === ann.playlist.uuid)) {
                        playlists.push({ uuid: ann.playlist.uuid, name: ann.playlist.name || '', branch: 'announcements' });
                    }
                    if (ann?.item?.uuid && !activeItemIds.includes(ann.item.uuid)) {
                        activeItemIds.push(ann.item.uuid);
                    }
                }

                if (!playlists.length) {
                    // Skip if content already rendered (prevents overwriting during temporary empty state, e.g. after slide trigger)
                    if (!container.querySelector('.pl-slide-header, .plo-item')) {
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
                        const titleEl = widgetEl.querySelector('.widget-title');
                        if (titleEl && results[0]?.playlistName) {
                            titleEl.textContent = `Playlist: ${results[0].playlistName}`;
                        }
                    })
                    .catch(() => {
                        if (!container.querySelector('.pl-slide-header, .plo-item')) {
                            container.innerHTML = '<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>Fout bij ophalen playlist</div></div>';
                        }
                    });
            })
            .catch(() => {
                if (!container.querySelector('.pl-slide-header, .plo-item')) {
                    container.innerHTML = '<div class="pp-offline"><div class="pp-offline-icon">⚠️</div><div>ProPresenter offline</div></div>';
                }
            });
    },

    _renderPlaylistOverview(container, playlists) {
        let html = '';

        playlists.forEach((playlist, pi) => {
            const items = playlist.data?.items || playlist.items || [];
            
            if (pi === 0) {
                const totalPresentations = items.filter(i => i.type !== 'header').length;
                html += `
                <div class="plo-playlist-header-card">
                    <div class="plo-playlist-name">${setlistModule.escapeHtml(playlist.playlistName)}</div>
                    <div class="plo-playlist-meta">${totalPresentations} presentaties</div>
                </div>
                <div class="plo-items-list">
                `;
            } else {
                html += '<div class="plo-divider"></div>';
            }

            items.forEach((item, index) => {
                const isHeader = item.type === 'header';
                const itemName = item.id?.name || item.name || '';
                const itemUuid = isHeader
                    ? null
                    : (item.id?.uuid || item.uuid || '');
                const isActive = itemUuid && playlist.activeItemIds?.includes(itemUuid);
                const headerColor = isHeader && item.header_color
                    ? `rgba(${Math.round(item.header_color.red * 255)}, ${Math.round(item.header_color.green * 255)}, ${Math.round(item.header_color.blue * 255)}, 0.3)`
                    : 'rgba(255,255,255,0.05)';

                if (isHeader) {
                    html += `</div>
                    <div class="pl-slide-header" style="border-left: 4px solid ${headerColor}; background: ${headerColor.replace('0.3', '0.08')};">
                        <span class="pl-header-label">${setlistModule.escapeHtml(itemName)}</span>
                    </div>
                    <div class="plo-items-list">`;
                } else {
                    const presUuid = item.presentation_info?.presentation_uuid || '';
                    
                    let slideCountText = 'Laden...';
                    if (item.type === 'media') {
                        slideCountText = 'Media';
                    } else if (presUuid) {
                        if (this._slideCountCache && this._slideCountCache[presUuid] !== undefined) {
                            slideCountText = `${this._slideCountCache[presUuid]} slides`;
                        } else {
                            slideCountText = 'presentatie';
                            const baseUrl = this._getProPresenterBaseUrl();
                            if (!this._slideCountCache) this._slideCountCache = {};
                            fetch(`${baseUrl}/v1/presentation/${presUuid}`)
                                .then(r => r.json())
                                .then(data => {
                                    const count = (data?.presentation?.groups || []).flatMap(g => g.slides || []).length;
                                    this._slideCountCache[presUuid] = count;
                                    const metaEl = container.querySelector(`.plo-item[data-pres-uuid="${presUuid}"] .plo-item-meta`);
                                    if (metaEl) metaEl.textContent = `${count} slides`;
                                })
                                .catch(() => {});
                        }
                    }

                    html += `
                    <div class="plo-item${isActive ? ' active' : ''}" 
                         data-pres-uuid="${presUuid}" 
                         onclick="dashboardModule._triggerPlaylistItem('${playlist.uuid}', ${index}, this)">
                        <div class="plo-item-details">
                            <div class="plo-item-title">${setlistModule.escapeHtml(itemName)}</div>
                            <div class="plo-item-meta">${slideCountText}</div>
                        </div>
                        ${isActive ? '<div class="plo-active-dot"></div>' : ''}
                    </div>`;
                }
            });
            
            if (pi === playlists.length - 1) {
                html += `</div>`;
            }
        });

        if (!html) {
            html = '<div class="pp-loading">Geen items in playlist</div>';
        }

        container.innerHTML = html;

        // Auto-scroll naar actieve presentatie
        const activeItem = container.querySelector('.plo-item.active');
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
            .then(() => {
                setTimeout(() => this._loadPlaylistOverview(), 150);
            })
            .catch(err => {
                console.error('[PLO] Error triggering playlist item:', err);
            });
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
                    groupSlides.forEach((slide, idx) => {
                        let label = slide.label || String(globalSlideIndex + 1);
                        
                        slides.push({
                            uuid: activePresUuid,
                            slideIndex: globalSlideIndex,
                            label: label,
                            groupName: group.name,
                            groupColor: group.color,
                            image: slide.image || slide.thumb_url || slide.thumbnail || null
                        });
                        globalSlideIndex++;
                    });
                });

                this._playlistOverviewSlidesData = slides;
                this._renderPlaylistOverviewSlides(activeSlideIdx);
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
                if (slide.image.startsWith('data:')) {
                    thumbUrl = slide.image;
                } else if (slide.image.startsWith('http')) {
                      thumbUrl = slide.image;
                } else if (slide.image.startsWith('/')) {
                    thumbUrl = baseUrl + slide.image;
                } else {
                    thumbUrl = 'data:image/jpeg;base64,' + slide.image;
                }
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

        const activeCard = slidesContainer.querySelector('.plo-slide-card.active');
        if (activeCard) {
            activeCard.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
    },

    _getContrastYIQ(r, g, b) {
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000' : '#fff';
    },

    syncState() {}
};
