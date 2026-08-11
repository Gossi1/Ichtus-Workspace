const dashboardModule = {
    initialized: false,
    _lastView: null,
    timerInterval: null,
    timerStartTime: null,
    timerRunning: false,
    draggedEl: null,
    _defaultWidgetIds: ['propresenter-playlist', 'playlist-overview', 'mic-iem-monitor'],
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
        this._migrateProPresenterSpan();
        this._migratePlaylistCache();
        try { this._initMicMonitor(); } catch (e) { console.warn('[DASHBOARD] Mic monitor init failed:', e); }
        try { this._initRosterListener(); } catch (e) { console.warn('[DASHBOARD] Roster listener init failed:', e); }

        const activeLayout = this.getActiveLayoutName();
        this.applyLayout(activeLayout);

        localStorage.removeItem('ichtus_dashboard_collapsed');
        this._updateRowHeight();
        this._restoreWidgetSizes();
        this._restoreWidgetZoom();
        this.initLayoutSelector();
        this._initDropdownCloseListener();

        // Start ProPresenter polling — wrapped in try/catch so network errors don't break init
        try {
            if (document.querySelector('.widget-card[data-widget-id="propresenter-playlist"], .widget-card[data-widget-id="playlist-overview"]')) {
                this._startProPresenterPolling();
            }
        } catch (e) { console.warn('[DASHBOARD] ProPresenter polling start failed:', e); }

        try {
            if (document.querySelector('.widget-card[data-widget-id="propresenter-playlist"]')) {
                this._loadProPresenterPlaylist();
                this._startPlaylistChangeDetection();
                this._startPlaylistSlideTracking();
            }
        } catch (e) { console.warn('[DASHBOARD] ProPresenter playlist init failed:', e); }

        try {
            if (document.querySelector('.widget-card[data-widget-id="playlist-overview"]')) {
                this._startPlaylistOverviewPolling();
                this._loadPlaylistOverview();
                this._startPlaylistSlideTracking();
            }
        } catch (e) { console.warn('[DASHBOARD] Playlist overview init failed:', e); }

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
        // With grid-template-columns: 1fr, each column fills 1/36 of the container
        const colWidth = (rect.width - this.GAP_PX * (this.COL_COUNT - 1)) / this.COL_COUNT;
        const rowHeight = colWidth + this.GAP_PX;
        const maxRows = Math.max(1, Math.floor(rect.height / rowHeight));
        return { colWidth, rowHeight, maxRows, totalCols: this.COL_COUNT, gap: this.GAP_PX };
    },

    _getDefaultRowSpan(widgetId) {
        return 7; // Universal: 140px (7 × 20px grid rows)
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

        // Prevent adding multiple event listeners
        if (grid.dataset.dragInitialized === 'true') return;
        grid.dataset.dragInitialized = 'true';

        // Remove old drop indicator if exists
        const oldIndicator = grid.querySelector('.widget-drop-indicator');
        if (oldIndicator) oldIndicator.remove();

        // Use mousedown/mousemove/mouseup for direct widget movement (no preview indicator)
        grid.addEventListener('mousedown', (e) => {
            if (!this._editMode) return;
            if (e.target.closest('.widget-resize-handle')) return;
            if (e.target.closest('.resizer')) return;
            if (e.target.closest('.btn-delete')) return;
            if (e.target.closest('[data-action]')) return;
            
            const card = e.target.closest('.widget-card');
            if (!card) return;
            // In edit mode, drag initiates from the overlay; in normal mode, from the header
            const overlay = e.target.closest('.edit-overlay');
            const header = e.target.closest('.widget-header');
            if (!overlay && !header) return;

            e.preventDefault();
            
            const startX = e.clientX;
            const startY = e.clientY;
            const initCol = parseInt(card.style.gridColumnStart) || 1;
            const initRow = parseInt(card.style.gridRowStart) || 1;
            const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId);
            const rowSpan = parseInt(card.dataset.widgetRowSpan) || this._getDefaultRowSpan(card.dataset.widgetId);

            card.classList.add('interacting');
            this.draggedEl = card;

            const onMove = (moveE) => {
                const dx = moveE.clientX - startX;
                const dy = moveE.clientY - startY;

                // Use dynamic step from actual grid metrics instead of hardcoded 32px
                const metrics = this._getGridMetrics();
                const STEP = metrics ? metrics.colWidth + metrics.gap : 32;

                const colDelta = Math.round(dx / STEP);
                const rowDelta = Math.round(dy / STEP);

                const maxCol = metrics ? metrics.totalCols - span + 1 : this.COL_COUNT;
                const maxRow = metrics ? metrics.maxRows - rowSpan + 1 : 100;
                let newCol = Math.max(1, Math.min(maxCol, initCol + colDelta));
                let newRow = Math.max(1, Math.min(maxRow, initRow + rowDelta));

                // Try diagonal move
                if (!this._wouldCollide(newCol, newRow, span, rowSpan, card)) {
                    card.style.gridColumn = `${newCol} / span ${span}`;
                    card.style.gridRow = `${newRow} / span ${rowSpan}`;
                }
                // Slide horizontally along wall
                else if (!this._wouldCollide(newCol, parseInt(card.style.gridRowStart) || 1, span, rowSpan, card)) {
                    card.style.gridColumn = `${newCol} / span ${span}`;
                }
                // Slide vertically along wall
                else if (!this._wouldCollide(parseInt(card.style.gridColumnStart) || 1, newRow, span, rowSpan, card)) {
                    card.style.gridRow = `${newRow} / span ${rowSpan}`;
                }
            };

            const onUp = () => {
                card.classList.remove('interacting');
                this.draggedEl = null;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                this._saveWidgetPositions();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },

    /**
     * Check if a widget placement would collide with other widgets.
     */
    _wouldCollide(testCol, testRow, span, rowSpan, excludeEl) {
        const grid = document.getElementById('widget-grid');
        if (!grid) return false;

        // Boundary check: widget must stay within grid
        const metrics = this._getGridMetrics();
        if (metrics) {
            if (testCol < 1 || testCol + span - 1 > metrics.totalCols || testRow < 1 || testRow + rowSpan - 1 > metrics.maxRows) {
                return true;
            }
        }

        const cards = Array.from(grid.querySelectorAll('.widget-card')).filter(c => c !== excludeEl);

        const testRect = { left: testCol, right: testCol + span, top: testRow, bottom: testRow + rowSpan };

        for (const other of cards) {
            const col = parseInt(other.style.gridColumnStart) || 1;
            const row = parseInt(other.style.gridRowStart) || 1;
            const s = parseInt(other.dataset.widgetSpan) || 1;
            const rs = parseInt(other.dataset.widgetRowSpan) || 1;

            const otherRect = { left: col, right: col + s, top: row, bottom: row + rs };

            if (testRect.left < otherRect.right && testRect.right > otherRect.left &&
                testRect.top < otherRect.bottom && testRect.bottom > otherRect.top) {
                return true;
            }
        }
        return false;
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
            const { colWidth, rowHeight, maxRows } = metrics;

            const currentSpan = parseInt(el.dataset.widgetSpan) || this._getDefaultSpan(el.dataset.widgetId);
            const currentRowSpan = parseInt(el.dataset.widgetRowSpan) || this._getDefaultRowSpan(el.dataset.widgetId);
            const initCol = parseInt(el.style.gridColumnStart) || 1;
            const startRow = parseInt(el.style.gridRowStart) || 1;
            const maxRowsAvail = maxRows - startRow + 1;

            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'se-resize';
            el.classList.add('interacting');

            const onMove = (moveE) => {
                const dx = moveE.clientX - startX;
                const spanDelta = Math.round(dx / colWidth);
                let newSpan = Math.max(7, Math.min(currentSpan + spanDelta, this.COL_COUNT - initCol + 1));

                const dy = moveE.clientY - startY;
                const rowDelta = Math.round(dy / colWidth);
                let newRowSpan = Math.max(4, Math.min(currentRowSpan + rowDelta, maxRowsAvail));

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
                el.classList.remove('interacting');
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                this._saveWidgetSizes();
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

                // Clamp to grid bounds
                const metrics = this._getGridMetrics();
                if (metrics) {
                    span = Math.min(span, metrics.totalCols);
                    const rowStart = parseInt(card.style.gridColumnStart) || 1;
                    // Note: gridRowStart is set by the grid layout, use getPropertyValue for accurate reading
                    const rs = parseInt(card.style.gridRowStart) || 1;
                    rowSpan = Math.min(rowSpan, Math.max(1, metrics.maxRows - rs + 1));
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
        return 14; // Universal: 280px (14 × 20px grid columns)
    },

    _getDefaultHeight(widgetId) {
        const m = this._getGridMetrics();
        return this._getDefaultRowSpan(widgetId) * (m ? m.rowHeight : 32);
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
                    const span = Math.min(pos.span || this._getDefaultSpan(id), this.COL_COUNT);
                    const maxRowSpan = Math.max(1, maxRow - row + 1);
                    const rowSpan = Math.min(pos.rowSpan || this._getDefaultRowSpan(id), maxRowSpan);
                    card.style.gridColumn = `${pos.col || 1} / span ${span}`;
                    card.style.gridRow = `${row} / span ${rowSpan}`;
                    card.dataset.widgetSpan = String(span);
                    card.dataset.widgetRowSpan = String(rowSpan);
                } else {
                    // No saved position — assign a default so _buildOccupancyMap sees explicit gridColumnStart
                    const span = this._getDefaultSpan(id);
                    const fallbackMaxRowSpan = Math.max(1, maxRow - Math.min(fallbackRow, maxRow) + 1);
                    const rowSpan = Math.min(this._getDefaultRowSpan(id), fallbackMaxRowSpan);
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
                            try {
                                if (id === 'propresenter' || id === 'propresenter-playlist' || id === 'playlist-overview') this._startProPresenterPolling();
                                if (id === 'propresenter-playlist') {
                                    this._loadProPresenterPlaylist();
                                    this._startPlaylistChangeDetection();
                                    this._startPlaylistSlideTracking();
                                }
                                if (id === 'playlist-overview') {
                                    this._startPlaylistOverviewPolling();
                                    this._startPlaylistSlideTracking();
                                }

                            } catch (e) { console.warn('[DASHBOARD] Widget init for', id, 'failed:', e); }
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
     * Grid overlay is now CSS-based (dot-grid background on .edit-mode).
     * This method is kept for API compatibility but is a no-op.
     */
    _createGridOverlay() {
        // Grid background is handled by CSS: .widget-grid.edit-mode
    },

    _getMaxVisibleRow() {
        const metrics = this._getGridMetrics();
        return metrics ? metrics.maxRows : 10;
    },

    // ===============================
    //  WIDGET ZOOM
    // ===============================
    changeWidgetZoom(widgetId, delta, e) {
        if (e) e.stopPropagation();
        const card = document.querySelector(`[data-widget-id="${widgetId}"]`);
        if (!card) return;

        let currentScale = parseFloat(card.dataset.widgetZoom) || 1;
        let newScale = Math.min(2.0, Math.max(0.5, Math.round((currentScale + delta) * 10) / 10));

        card.dataset.widgetZoom = newScale;

        this._applyZoom(card, newScale);
        this._saveWidgetZoom();
    },

    resetWidgetZoom(widgetId, e) {
        if (e) e.stopPropagation();
        const card = document.querySelector(`[data-widget-id="${widgetId}"]`);
        if (!card) return;

        card.dataset.widgetZoom = 1;
        this._applyZoom(card, 1);
        this._saveWidgetZoom();
    },

    _applyZoom(card, scale) {
        const inner = card.querySelector('.widget-body-inner');
        if (inner) {
            inner.style.transform = `scale(${scale})`;
            inner.style.transformOrigin = 'top left';
            inner.style.width = `${(1 / scale) * 100}%`;
            inner.style.height = `${(1 / scale) * 100}%`;
        }

        const label = card.querySelector('.zoom-label');
        if (label) {
            label.textContent = `${Math.round(scale * 100)}%`;
        }
    },

    _saveWidgetZoom() {
        try {
            const zooms = {};
            document.querySelectorAll('#widget-grid .widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (!id) return;
                const zoom = parseFloat(card.dataset.widgetZoom);
                if (zoom && zoom !== 1) zooms[id] = zoom;
            });
            localStorage.setItem('ichtus_dashboard_widget_zoom', JSON.stringify(zooms));
        } catch (e) {}
    },

    _restoreWidgetZoom() {
        try {
            const zooms = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_zoom') || '{}');
            document.querySelectorAll('#widget-grid .widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (!id) return;
                const scale = zooms[id];
                if (scale && scale !== 1) {
                    card.dataset.widgetZoom = scale;
                    this._applyZoom(card, scale);
                }
            });
        } catch (e) {}
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
        const zooms = {};
        try { const z = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_zoom') || '{}'); Object.assign(zooms, z); } catch (e) {}
        return { order, positions, sizes, zooms };
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

            // Apply zooms
            if (state.zooms) {
                try { localStorage.setItem('ichtus_dashboard_widget_zoom', JSON.stringify(state.zooms)); } catch (e) {}
            }
            this._restoreWidgetZoom();
        } else {
            // Fallback for default layout if no saved state exists yet:
            // Just restore all hardcoded/default widgets in their initial state.
            const defaultWidgetIds = ['propresenter-playlist', 'playlist-overview', 'mic-iem-monitor'];
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
        const dropdown = document.getElementById('dashboardDropdown');
        if (dropdown) dropdown.classList.toggle('open');
    },

    selectCustomOption(element) {
        const value = element.getAttribute('data-value');
        const text = element.textContent;
        document.getElementById('custom-select-text').textContent = text;
        
        const options = document.querySelectorAll('.custom-dropdown .dropdown-option');
        options.forEach(opt => opt.classList.remove('selected'));
        element.classList.add('selected');
        
        const dropdown = document.getElementById('dashboardDropdown');
        if (dropdown) dropdown.classList.remove('open');
        this.switchLayout(value);
    },

    toggleHeader() {
        const wrapper = document.getElementById('headerWrapper');
        const toggleBtn = document.getElementById('headerToggleBtn');
        if (!wrapper) return;
        const isCollapsed = wrapper.classList.toggle('collapsed');
        if (toggleBtn) toggleBtn.textContent = isCollapsed ? '▼' : '▲';
    },

    _initDropdownCloseListener() {
        if (this._dropdownCloseListenerAdded) return;
        this._dropdownCloseListenerAdded = true;
        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('dashboardDropdown');
            if (dropdown && !dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
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
        if (editBtn) {
            editBtn.classList.toggle('active', this._editMode);
            editBtn.innerHTML = this._editMode ? '✔ Klaar' : '✏️ Bewerken';
        }
        document.body.classList.toggle('is-editing', this._editMode);
        this._createGridOverlay();

        document.querySelectorAll('#widget-grid .widget-card').forEach(card => {
            card.classList.toggle('editing', this._editMode);
            // Remove old handles and overlays
            card.querySelectorAll('.widget-delete-btn, .widget-resize-handle, .edit-overlay').forEach(el => el.remove());

            if (this._editMode) {
                this._applyEditOverlay(card);
            } else {
                // Normal mode: re-show header zoom controls
                card.querySelectorAll('.widget-zoom-control').forEach(el => el.style.display = '');
            }
        });
    },

    /**
     * Apply the edit overlay, resize handle, and hide header zoom for a single card.
     */
    _applyEditOverlay(card) {
        // Hide header zoom controls (they now live on overlay)
        card.querySelectorAll('.widget-zoom-control').forEach(el => el.style.display = 'none');

        const overlay = document.createElement('div');
        overlay.className = 'edit-overlay';

        const widgetId = card.dataset.widgetId || '';
        const title = card.querySelector('.widget-title')?.textContent || widgetId;
        const currentZoom = Math.round((parseFloat(card.dataset.widgetZoom) || 1) * 100);

        overlay.innerHTML = `
            <div class="overlay-top-left">
                <div class="widget-zoom-control overlay-zoom">
                    <button class="zoom-btn" data-action="zoom-out" title="Uitzoomen">-</button>
                    <span class="zoom-label" data-action="zoom-reset" title="Reset zoom">${currentZoom}%</span>
                    <button class="zoom-btn" data-action="zoom-in" title="Inzoomen">+</button>
                </div>
            </div>
            <div class="overlay-top-right">
                <button class="btn-delete" data-action="delete" title="Verwijder widget">🗑</button>
            </div>                    <div class="overlay-center">
                        <div class="overlay-title">${title.toUpperCase()}</div>
                        <div class="overlay-subtitle">Sleep om te verplaatsen</div>
                    </div>
                `;

        // Overlay event delegation
        overlay.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'delete') {
                e.stopPropagation();
                this.deleteWidget(card);
            } else if (action === 'zoom-in') {
                e.stopPropagation();
                this.changeWidgetZoom(widgetId, 0.1, e);
            } else if (action === 'zoom-out') {
                e.stopPropagation();
                this.changeWidgetZoom(widgetId, -0.1, e);
            } else if (action === 'zoom-reset') {
                e.stopPropagation();
                this.resetWidgetZoom(widgetId, e);
            }
        });

        card.appendChild(overlay);

        // Resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'widget-resize-handle';
        card.appendChild(resizeHandle);
        this._initResizeHandle(card);
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
            if (!document.querySelector('.widget-card[data-widget-id="propresenter-playlist"], .widget-card[data-widget-id="playlist-overview"]')) {
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
            { id: 'propresenter-playlist', icon: '📋', label: 'ProPresenter Playlist' },
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
            case 'propresenter-playlist':
                const autoscrollPref = (() => { try { return localStorage.getItem('ichtus_pp_autoscroll'); } catch(e) { return null; } })();
                const autoscrollActive = autoscrollPref === null || autoscrollPref === '1';
                return `<div class="widget-card" data-widget-id="propresenter-playlist">
                    <div class="widget-header"><div class="widget-title-wrapper"><div class="widget-zoom-control"><button class="zoom-btn" onclick="dashboardModule.changeWidgetZoom('propresenter-playlist', -0.1, event)" title="Uitzoomen">-</button><span class="zoom-label" onclick="dashboardModule.resetWidgetZoom('propresenter-playlist', event)" title="Reset zoom">100%</span><button class="zoom-btn" onclick="dashboardModule.changeWidgetZoom('propresenter-playlist', 0.1, event)" title="Inzoomen">+</button></div><h3 class="widget-title"></h3></div><div class="pp-settings-wrap"><button class="pp-settings-btn" onclick="dashboardModule._togglePlaylistSettingsDropdown(event)" title="Playlist instellingen">⚙</button><div class="pp-settings-dropdown"><button class="pp-layout-toggle" onclick="dashboardModule._togglePlaylistLayout(this)" title="Toggle layout">⊞ Weergave</button><button class="pp-refresh-btn" onclick="dashboardModule._refreshPlaylist(this)" title="Refresh playlist">↻ Verversen</button><button class="pp-autoscroll-btn${autoscrollActive ? ' active' : ''}" onclick="dashboardModule._toggleAutoScroll(this)" title="${autoscrollActive ? 'Auto-scroll naar actieve slide' : 'Auto-scroll uit'}">◎ Auto-scroll</button></div></div></div>
                    <div class="widget-body widget-propresenter" id="propresenter-playlist-container">
                        <div class="widget-body-inner"><div class="pp-loading">Loading playlist…</div></div>
                    </div>
                </div>`;
            case 'playlist-overview':
                return `<div class="widget-card" data-widget-id="playlist-overview">
                    <div class="widget-body plo-control-body">
                        <div class="widget-body-inner">
                            <div id="playlist-overview-container" class="plo-v2-playlist-list">
                                <div class="pp-loading">Laden…</div>
                            </div>

                            <div class="plo-v2-status-bar">
                                <span id="plo-v2-item-count" class="plo-v2-status-count">0 ITEMS</span>
                                <span id="plo-v2-active-name" class="plo-v2-status-active">ACTIVE: —</span>
                            </div>
                        </div>
                    </div>
                </div>`;
            case 'mic-iem-monitor':
                return `<div class="widget-card" data-widget-id="mic-iem-monitor">
                    <div class="widget-header"><div class="widget-title-wrapper"><div class="widget-zoom-control"><button class="zoom-btn" onclick="dashboardModule.changeWidgetZoom('mic-iem-monitor', -0.1, event)" title="Uitzoomen">-</button><span class="zoom-label" onclick="dashboardModule.resetWidgetZoom('mic-iem-monitor', event)" title="Reset zoom">100%</span><button class="zoom-btn" onclick="dashboardModule.changeWidgetZoom('mic-iem-monitor', 0.1, event)" title="Inzoomen">+</button></div><h3 class="widget-title">Mic & IEM Monitor</h3></div></div>
                    <div class="widget-body">
                        <div class="widget-body-inner">
                            <div id="mic-monitor-grid" class="mic-monitor-grid">
                                <div class="pp-loading">Laden…</div>
                            </div>
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
        try {
            if (widgetId === 'propresenter-playlist' || widgetId === 'playlist-overview') this._startProPresenterPolling();
            if (widgetId === 'propresenter-playlist') {
                this._loadProPresenterPlaylist();
                this._startPlaylistChangeDetection();
                this._startPlaylistSlideTracking();
            }
            if (widgetId === 'playlist-overview') {
                this._startPlaylistOverviewPolling();
                this._startPlaylistSlideTracking();
            }
        } catch (e) { console.warn('[DASHBOARD] Widget init for', widgetId, 'failed:', e); }

        // Add edit-mode overlay if edit mode is active
        if (this._editMode) {
            this._applyEditOverlay(card);
        }

        this.setupDragAndDrop();
        this.saveWidgetOrder();
    },

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


    syncState() {}
};

// ===============================
//  DELEGATION TO EXTRACTED MODULES
//  NOTE: This IIFE was moved to index.html (after all widget scripts load)
//  because dashboard.js loads BEFORE the widget modules, so window.dashboardWidgets
//  was undefined when this IIFE ran. See index.html for the binding code.
// ===============================
