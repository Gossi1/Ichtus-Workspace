const dashboardModule = {
    initialized: false,
    _lastView: null,
    timerInterval: null,
    timerStartTime: null,
    timerRunning: false,
    draggedEl: null,
    _defaultWidgetIds: ['quicklinks', 'servicetimer', 'status', 'propresenter'],
    _editMode: false,
    _widgetInstance: 0,

    _resizeHandler: null,
    // ProPresenter state
    _proPresenterInterval: null,
    _proPresenterFastInterval: null,
    _proPresenterLastIndex: -1,
    _proPresenterLastPresentationUuid: null,
    _proPresenterSlideCount: 0,

    // ===============================
    //  INIT
    // ===============================
    init() {
        if (this.initialized && this._lastView === 'dashboard') return;
        this.initialized = true;
        this._lastView = 'dashboard';

        this.setupDragAndDrop();
        this.setupTimer();
        this._migrateProPresenterSpan();
        this.restoreWidgetOrder();
        this._ensureSavedWidgets();
        localStorage.removeItem('ichtus_dashboard_collapsed');
        this._updateRowHeight();
        this._restoreWidgetSizes();
        this._restoreWidgetPositions();
        this.initLayoutSelector();
        if (document.querySelector('.widget-card[data-widget-id="propresenter"], .widget-card[data-widget-id="propresenter-playlist"]')) {
            this._startProPresenterPolling();
        }

        this._resizeHandler = () => {
            if (document.getElementById('view-dashboard')?.classList.contains('active')) {
                this._updateRowHeight();
                this._restoreWidgetPositions();
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
        const maxRows = Math.max(1, Math.floor(rect.height / rowHeight));
        return { colWidth, rowHeight, maxRows, totalCols: this.COL_COUNT, gap: this.GAP_PX };
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
            const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
            const rowSpan = Math.max(1, Math.ceil(minH / rowHeight));

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
    _applyWidgetGrid(card, col, row, span) {
        card.style.gridColumn = `${col} / span ${span}`;
        card.style.gridRowStart = String(row);
        card.dataset.widgetSpan = String(span);
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
            if (e.target.closest('.widget-resize-handle')) { e.preventDefault(); return; }
            const card = e.target.closest('.widget-card');
            if (!card) return;
            this.draggedEl = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.widgetId || '');
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
            const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
            const rowSpan = Math.max(1, Math.ceil(minH / rowHeight));

            indicator.style.display = 'block';
            indicator.style.left = ((pos.col - 1) * (colWidth + this.GAP_PX)) + 'px';
            indicator.style.top = ((pos.row - 1) * rowHeight) + 'px';
            indicator.style.width = (span * colWidth + (span - 1) * this.GAP_PX) + 'px';
            indicator.style.height = (rowSpan * rowHeight - this.GAP_PX) + 'px';
            indicator.style.borderRadius = '8px';
            indicator.style.background = 'rgba(244,121,32,0.12)';
            indicator.style.border = '2px dashed var(--ichtus-orange, #f47920)';
        });

        grid.addEventListener('drop', (e) => { e.preventDefault(); });

        grid.addEventListener('dragend', (e) => {
            const card = this.draggedEl || e.target.closest('.widget-card');
            if (card) {
                card.classList.remove('dragging');
                const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId);
                const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
                const metrics = this._getGridMetrics();
                const rowSpan = metrics ? Math.max(1, Math.ceil(minH / metrics.rowHeight)) : 1;
                const cursorPos = this._cursorToGrid(e.clientX, e.clientY);
                // Temporarily set draggedEl back so _buildOccupancyMap excludes this card
                this.draggedEl = card;
                const free = this._findFreeSpot(span, rowSpan, cursorPos?.col || 1, cursorPos?.row || 1);
                this.draggedEl = null;
                this._applyWidgetGrid(card, free.col, free.row, span);
                this._saveWidgetPositions();
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

        const TOTAL_COLS = this.COL_COUNT;
        const HEIGHT_STEP = 40;
        const MIN_HEIGHT = 80;

        const onPointerDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startY = e.clientY;
            const grid = document.getElementById('widget-grid');
            if (!grid) return;

            const gridWidth = grid.getBoundingClientRect().width;
            const gapPx = this.GAP_PX * 2; // 24px gap for resize calculation consistency
            const colWidth = (gridWidth - gapPx * (TOTAL_COLS - 1)) / TOTAL_COLS;

            const currentWidth = el.getBoundingClientRect().width;
            const currentHeight = el.getBoundingClientRect().height;
            // Preserve the initial grid column start so onMove doesn't reset it to 'auto' (col 1)
            const initCol = parseInt(el.style.gridColumnStart) || 1;

            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'nwse-resize';

            const onMove = (moveE) => {
                const dx = moveE.clientX - startX;
                const targetWidth = currentWidth + dx;
                let newSpan = Math.max(1, Math.round(targetWidth / (colWidth + gapPx)));
                newSpan = Math.min(newSpan, TOTAL_COLS);

                const dy = moveE.clientY - startY;
                const targetHeight = currentHeight + dy;
                let snappedHeight = Math.max(MIN_HEIGHT, Math.round(targetHeight / HEIGHT_STEP) * HEIGHT_STEP);

                // Occupancy check — clamp span/height to avoid overlapping neighbors
                // Only run the expensive check when the widget is actually growing.
                // Use dx/dy to detect direction without DOM reads (avoids layout thrashing).
                const isGrowingWider = dx > 0;
                const isGrowingTaller = dy > 0;

                if (isGrowingWider || isGrowingTaller) {
                    const metrics = this._getGridMetrics();
                    if (metrics) {
                        const map = this._buildOccupancyMap(metrics.maxRows, el);
                        const startCol = parseInt(el.style.gridColumnStart) || 1;
                        const startRow = parseInt(el.style.gridRowStart) || 1;
                        // Clamp span (only if growing wider)
                        if (isGrowingWider) {
                            const oldSpan = parseInt(el.dataset.widgetSpan) || 1;
                            let proposedRowSpan = Math.max(1, Math.ceil(snappedHeight / metrics.rowHeight));
                            while (newSpan > oldSpan && !this._rectFits(map, startCol, startRow, newSpan, proposedRowSpan, metrics)) {
                                newSpan--;
                            }
                        }
                        // Clamp height (only if growing taller)
                        if (isGrowingTaller) {
                            const oldHeight = parseInt(el.dataset.widgetHeight) || parseInt(el.style.height) || MIN_HEIGHT;
                            while (snappedHeight > oldHeight) {
                                const proposedRowSpan = Math.max(1, Math.ceil(snappedHeight / metrics.rowHeight));
                                if (this._rectFits(map, startCol, startRow, newSpan, proposedRowSpan, metrics)) break;
                                snappedHeight -= HEIGHT_STEP;
                            }
                        }
                    }
                }

                el.style.gridColumn = `${initCol} / span ${newSpan}`;
                el.dataset.widgetSpan = String(newSpan);
                el.style.height = snappedHeight + 'px';
                el.style.minHeight = '';
                el.dataset.widgetHeight = String(snappedHeight);
            };

            const onUp = () => {
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
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
            const height = parseInt(card.dataset.widgetHeight);
            const saved = {};
            if (span && span > 0 && span !== this._getDefaultSpan(id)) saved.span = span;
            if (height && height > 0 && height !== this._getDefaultHeight(id)) saved.height = height;
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
                let span, height;
                if (typeof data === 'object' && data !== null) {
                    span = data.span ? Math.max(1, Math.min(36, parseInt(data.span) || 18)) : this._getDefaultSpan(id);
                    height = data.height ? Math.max(60, parseInt(data.height) || 0) : 0;
                } else if (data) {
                    span = Math.max(1, Math.min(36, parseInt(data) || 18));
                    height = 0;
                } else {
                    span = this._getDefaultSpan(id);
                    height = 0;
                }
                card.style.gridColumn = `span ${span}`;
                card.dataset.widgetSpan = String(span);
                if (height > 0) {
                    card.style.height = height + 'px';
                    card.style.minHeight = '';
                    card.dataset.widgetHeight = String(height);
                } else {
                    const defaultH = this._getDefaultHeight(id);
                    card.style.height = defaultH + 'px';
                    card.style.minHeight = '';
                    card.dataset.widgetHeight = String(defaultH);
                }
                const m = this._getGridMetrics();
                if (m) {
                    const row = parseInt(card.style.gridRowStart) || 1;
                    const rowsAvail = m.maxRows - row + 1;
                    const maxH = rowsAvail * m.rowHeight - m.gap;
                    const curH = parseInt(card.style.height) || 0;
                    if (maxH > 0 && curH > maxH) {
                        const clamped = Math.max(120, maxH);
                        card.style.height = clamped + 'px';
                        card.style.minHeight = '';
                        card.dataset.widgetHeight = String(clamped);
                    }
                }
            });
        } catch (e) {}
    },

    _getDefaultSpan(widgetId) {
        const defaults = { quicklinks: 12, servicetimer: 18, status: 18, propresenter: 24, 'propresenter-playlist': 24 };
        return defaults[widgetId] || 6;
    },

    _getDefaultHeight(widgetId) {
        const defaults = { quicklinks: 140, servicetimer: 200, status: 200, propresenter: 320, 'propresenter-playlist': 320 };
        return defaults[widgetId] || 140;
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
                    span: parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(id)
                };
            });
            localStorage.setItem('ichtus_dashboard_widget_order', JSON.stringify(order));
            localStorage.setItem('ichtus_dashboard_widget_positions', JSON.stringify(positions));

        } catch (e) {}
    },

    saveWidgetOrder() { this._saveWidgetPositions(); },

    restoreWidgetOrder() {
        try {
            const order = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_order'));
            if (!Array.isArray(order)) return;
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            order.forEach(id => {
                const card = grid.querySelector(`[data-widget-id="${id}"]`);
                if (card) grid.appendChild(card);
            });
        } catch (e) {}
    },

    _restoreWidgetPositions() {
        try {
            const positions = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_positions') || '{}');
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
                    card.style.gridColumn = `${pos.col || 1} / span ${pos.span || this._getDefaultSpan(id)}`;
                    card.style.gridRowStart = String(row);
                    card.dataset.widgetSpan = String(pos.span || this._getDefaultSpan(id));
                } else {
                    // No saved position — assign a default so _buildOccupancyMap sees explicit gridColumnStart
                    const span = this._getDefaultSpan(id);
                    if (fallbackCol + span > this.COL_COUNT + 1) {
                        fallbackCol = 1;
                        fallbackRow++;
                    }
                    card.style.gridColumn = `${fallbackCol} / span ${span}`;
                    card.style.gridRowStart = String(Math.min(fallbackRow, maxRow));
                    card.dataset.widgetSpan = String(span);
                    fallbackCol += span;
                }
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
                            if (id === 'propresenter' || id === 'propresenter-playlist') this._startProPresenterPolling();
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
        const sel = document.getElementById('layout-selector');
        if (!sel) return;
        sel.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '__default__';
        defaultOpt.textContent = i18n.t('dashboard_layout_default') || 'Default';
        sel.appendChild(defaultOpt);
        const layouts = this.loadLayouts();
        const activeName = this.getActiveLayoutName();
        Object.keys(layouts).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name + (name === activeName ? ' ' + (i18n.t('dashboard_layout_active') || '(active)') : '');
            sel.appendChild(opt);
        });
        sel.value = activeName;
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
                height: parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(id)
            };
        });
        const sizes = {};
        try { const s = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_sizes') || '{}'); Object.assign(sizes, s); } catch (e) {}
        return { order, positions, sizes };
    },

    applyLayout(layoutName) {
        const layouts = this.loadLayouts();
        const state = layoutName === '__default__' ? null : layouts[layoutName];
        const grid = document.getElementById('widget-grid');
        if (!grid) return;

        if (state && state.order) {
            state.order.forEach(id => {
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
        }

        if (state && state.positions) {
            const metrics = this._getGridMetrics();
            const maxRow = metrics ? metrics.maxRows : 20;
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                const pos = state.positions[id];
                if (pos) {
                    const row = Math.min(pos.row, maxRow);
                    card.style.gridColumn = `${pos.col || 1} / span ${pos.span || this._getDefaultSpan(id)}`;
                    card.style.gridRowStart = String(row);
                    card.dataset.widgetSpan = String(pos.span || this._getDefaultSpan(id));
                    if (pos.height) {
                        card.style.height = pos.height + 'px';
                        card.style.minHeight = '';
                        card.dataset.widgetHeight = String(pos.height);
                    }
                }
            });
        }

        if (state && state.sizes) {
            try { localStorage.setItem('ichtus_dashboard_widget_sizes', JSON.stringify(state.sizes)); } catch (e) {}
            this._restoreWidgetSizes();
        }

        this._saveWidgetPositions();
        this.setActiveLayoutName(layoutName);
        this.populateLayoutSelector();
        document.querySelectorAll('#widget-grid .widget-body').forEach(b => { b.style.display = ''; });
    },

    switchLayout(layoutName) { this.applyLayout(layoutName); },

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
            const wasProPresenter = card.dataset.widgetId === 'propresenter' || card.dataset.widgetId === 'propresenter-playlist';
            card.remove();
            this.setupDragAndDrop();
            this.saveWidgetOrder();
            if (wasProPresenter && !document.querySelector('.widget-card[data-widget-id="propresenter"], .widget-card[data-widget-id="propresenter-playlist"]')) {
                this._stopProPresenterPolling();
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
            { id: 'propresenter-playlist', icon: '📋', label: 'ProPresenter Playlist' }
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
                return `<div class="widget-card" draggable="true" data-widget-id="propresenter-playlist">
                    <div class="widget-header"><h3 class="widget-title"></h3><button class="pp-layout-toggle" onclick="dashboardModule._toggleSlidesLayout(this)" title="Toggle slides layout">⊞</button></div>
                    <div class="widget-body widget-propresenter" id="propresenter-slides-container">
                        <div class="pp-loading">Loading slides…</div>
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
        const height = this._getDefaultHeight(widgetId);
        const metrics = this._getGridMetrics();
        const rowSpan = metrics ? Math.max(1, Math.ceil(height / metrics.rowHeight)) : 1;
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
                const minH = parseInt(card.style.height) || parseInt(card.dataset.widgetHeight) || this._getDefaultHeight(card.dataset.widgetId);
                const thisSpan = Math.max(1, Math.ceil(minH / metrics.rowHeight));
                allRows.push(startRow + thisSpan - 1);
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
        const pos = this._getNewWidgetPosition(widgetId);
        this._applyWidgetGrid(card, pos.col, pos.row, span);

        let defaultH = this._getDefaultHeight(widgetId);
        const m = this._getGridMetrics();
        if (m) {
            const rowsAvail = m.maxRows - pos.row + 1;
            const maxH = rowsAvail * metrics.rowHeight - metrics.gap;
            if (maxH > 0 && defaultH > maxH) defaultH = Math.max(120, maxH);
        }
        card.style.height = defaultH + 'px';
        card.style.minHeight = '';
        card.dataset.widgetHeight = String(defaultH);

        grid.appendChild(card);

        // Initialize widget-specific functionality
        if (widgetId === 'servicetimer') this.setupTimer();
        if (widgetId === 'propresenter' || widgetId === 'propresenter-playlist') this._startProPresenterPolling();

        // Add edit-mode controls if edit mode is active
        if (this._editMode) {
            const delBtn = document.createElement('button');
            delBtn.className = 'widget-delete-btn';
            delBtn.innerHTML = '×';
            delBtn.title = 'Delete widget';
            delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteWidget(card); });
            const header = card.querySelector('.widget-header');
            if (header) header.appendChild(delBtn);

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'widget-resize-handle';
            card.appendChild(resizeHandle);
            this._initResizeHandle(card);
        }

        this.setupDragAndDrop();
        this.saveWidgetOrder();
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
                actions.appendChild(deleteBtn);
                item.appendChild(nameSpan);
                item.appendChild(actions);
                list.appendChild(item);
            });
        }
        content.appendChild(list);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'layout-manage-close';
        closeBtn.textContent = i18n.t('dashboard_layout_close') || 'Close';
        closeBtn.addEventListener('click', () => modal.remove());
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    },

    // ===============================
    //  PROPRESENTER POLLING
    // ===============================
    _getProPresenterBaseUrl() {
        let ip = localStorage.getItem('setlistProIp') || '127.0.0.1';
        let port = localStorage.getItem('setlistProPort') || '50001';
        // setlist.js stores IP+port combined like "100.113.22.22:51253".
        // If the IP contains a colon, split it.
        if (ip.includes(':')) {
            const parts = ip.split(':');
            ip = parts[0];
            port = parts[1] || port;
        }
        const url = `http://${ip}:${port}`;
        console.log('[PP-DEBUG] baseUrl:', url, '(ip:', ip, 'port:', port, ')');
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
                        const playlistName = playlistData?.presentation?.playlist?.name;
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
        console.log('[PP-DEBUG] _renderSlides: slides.length=', slides.length, 'currentIdx=', currentIdx, 'uuid=', uuid);
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
        document.querySelectorAll('.widget-card[data-widget-id="propresenter"], .widget-card[data-widget-id="propresenter-playlist"]').forEach(el => this._fetchProPresenterSlides(el));
    },

    _updateAllProPresenterIndexes() {
        document.querySelectorAll('.widget-card[data-widget-id="propresenter"], .widget-card[data-widget-id="propresenter-playlist"]').forEach(el => this._pollProPresenterIndex(el));
    },

    _startProPresenterPolling() {
        this._stopProPresenterPolling();
        this._updateAllProPresenterWidgets();
        this._proPresenterInterval = setInterval(() => this._updateAllProPresenterWidgets(), 15000);
        this._proPresenterFastInterval = setInterval(() => this._updateAllProPresenterIndexes(), 500);
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

    syncState() {}
};
