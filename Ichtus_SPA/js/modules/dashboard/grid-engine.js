/**
 * DashboardGridEngine — Grid system, drag & drop, resize, collision math
 * Provides the core 20px-snap grid logic for the dashboard.
 * Spread into dashboardModule: { ...DashboardGridEngine, ... }
 */
const DashboardGridEngine = {
    // ===============================
    //  GRID SYSTEM (occupancy map)
    // ===============================
    COL_COUNT: 36,
    GAP_PX: 12,

    _getGridMetrics() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return null;
        const rect = grid.getBoundingClientRect();
        const colWidth = (rect.width - this.GAP_PX * (this.COL_COUNT - 1)) / this.COL_COUNT;
        const rowHeight = colWidth + this.GAP_PX;
        const maxRows = Math.max(1, Math.floor(rect.height / rowHeight));
        return { colWidth, rowHeight, maxRows, totalCols: this.COL_COUNT, gap: this.GAP_PX };
    },

    _getDefaultRowSpan(widgetId) {
        const defaults = { quicklinks: 3, servicetimer: 4, status: 4, propresenter: 8, 'propresenter-playlist': 8, 'playlist-overview': 10, servicecountdown: 4, 'mic-iem-monitor': 6 };
        return defaults[widgetId] || 3;
    },

    _getDefaultSpan(widgetId) {
        const defaults = { quicklinks: 12, servicetimer: 18, status: 18, propresenter: 24, 'propresenter-playlist': 24, 'playlist-overview': 24, servicecountdown: 18, 'mic-iem-monitor': 18 };
        return defaults[widgetId] || 6;
    },

    _getDefaultHeight(widgetId) {
        const defaults = { quicklinks: 140, servicetimer: 200, status: 200, propresenter: 320, 'propresenter-playlist': 320, 'playlist-overview': 480, servicecountdown: 200, 'mic-iem-monitor': 320 };
        return defaults[widgetId] || 140;
    },

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

    _findFreeSpot(colSpan, rowSpan, preferredCol, preferredRow) {
        const metrics = this._getGridMetrics();
        if (!metrics) return { col: 1, row: 1 };
        const { maxRows, totalCols } = metrics;
        const map = this._buildOccupancyMap(maxRows, this.draggedEl);
        const maxCol = totalCols - colSpan;
        const maxRow = maxRows - rowSpan;
        const startCol = Math.min(Math.max(0, preferredCol - 1), maxCol);
        const startRow = Math.min(Math.max(0, preferredRow - 1), maxRow);
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
        return { col: 1, row: maxRows };
    },

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
        if (grid.dataset.dragInitialized === 'true') return;
        grid.dataset.dragInitialized = 'true';

        const oldIndicator = grid.querySelector('.widget-drop-indicator');
        if (oldIndicator) oldIndicator.remove();

        grid.addEventListener('mousedown', (e) => {
            if (!this._editMode) return;
            if (e.target.closest('.widget-resize-handle')) return;
            if (e.target.closest('.widget-delete-btn')) return;
            if (e.target.closest('.widget-zoom-control')) return;

            const card = e.target.closest('.widget-card');
            if (!card) return;
            const header = e.target.closest('.widget-header');
            if (!header) return;

            e.preventDefault();

            const startX = e.clientX;
            const startY = e.clientY;
            const initCol = parseInt(card.style.gridColumnStart) || 1;
            const initRow = parseInt(card.style.gridRowStart) || 1;
            const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId);
            const rowSpan = parseInt(card.dataset.widgetRowSpan) || this._getDefaultRowSpan(card.dataset.widgetId);

            card.classList.add('interacting');
            this.draggedEl = card;

            const STEP = 32;

            const onMove = (moveE) => {
                const dx = moveE.clientX - startX;
                const dy = moveE.clientY - startY;
                const colDelta = Math.round(dx / STEP);
                const rowDelta = Math.round(dy / STEP);

                const metrics = this._getGridMetrics();
                const maxCol = metrics ? metrics.totalCols - span + 1 : this.COL_COUNT;
                const maxRow = metrics ? metrics.maxRows - rowSpan + 1 : 100;
                let newCol = Math.max(1, Math.min(maxCol, initCol + colDelta));
                let newRow = Math.max(1, Math.min(maxRow, initRow + rowDelta));

                if (!this._wouldCollide(newCol, newRow, span, rowSpan, card)) {
                    card.style.gridColumn = `${newCol} / span ${span}`;
                    card.style.gridRow = `${newRow} / span ${rowSpan}`;
                } else if (!this._wouldCollide(newCol, parseInt(card.style.gridRowStart) || 1, span, rowSpan, card)) {
                    card.style.gridColumn = `${newCol} / span ${span}`;
                } else if (!this._wouldCollide(parseInt(card.style.gridColumnStart) || 1, newRow, span, rowSpan, card)) {
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

    _wouldCollide(testCol, testRow, span, rowSpan, excludeEl) {
        const grid = document.getElementById('widget-grid');
        if (!grid) return false;
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
                let newSpan = Math.max(1, Math.min(currentSpan + spanDelta, this.COL_COUNT - initCol + 1));

                const dy = moveE.clientY - startY;
                const rowDelta = Math.round(dy / colWidth);
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

                const metrics = this._getGridMetrics();
                if (metrics) {
                    span = Math.min(span, metrics.totalCols);
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

    _migrateProPresenterSpan() {
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
        } catch (e) {}
    },

    _migratePlaylistCache() {
        try {
            if (localStorage.getItem('ichtus_pp_cache_notext')) return;
            localStorage.removeItem('ichtus_pp_playlist_cache');
            localStorage.setItem('ichtus_pp_cache_notext', '1');
        } catch (e) {}
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
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (id && !order.includes(id)) card.remove();
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

    _createGridOverlay() { /* CSS-based now */ },

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
        const zoomContainer = card.querySelector('.widget-content-zoom');
        if (zoomContainer) {
            zoomContainer.style.transform = `scale(${newScale})`;
            zoomContainer.style.width = `${(1 / newScale) * 100}%`;
            zoomContainer.style.height = `${(1 / newScale) * 100}%`;
        }
        const label = card.querySelector('.zoom-label');
        if (label) label.textContent = `${Math.round(newScale * 100)}%`;
        this.saveWidgetOrder();
    },
};
