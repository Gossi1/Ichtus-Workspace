// Dashboard Module for Ichtus Workspace SPA
const dashboardModule = {
    initialized: false,
    _lastView: null,
    timerInterval: null,
    timerStartTime: null,
    timerRunning: false,
    draggedEl: null,
    // Default widget order (fallback)
    _defaultWidgetIds: ['quicklinks', 'servicetimer', 'status', 'propresenter'],
    _editMode: false,
    _widgetInstance: 0,
    // Grid position data: { [widgetId]: { col: number, row: number, span: number } }
    _widgetPositions: {},
    // Row height step used during drag placement (min row ~60px + gap ~12px)
    init() {
        if (this.initialized && this._lastView === 'dashboard') return;
        this.initialized = true;
        this._lastView = 'dashboard';

        this.setupDragAndDrop();
        this.setupTimer();
    this.restoreWidgetOrder();
    this._ensureSavedWidgets();
    localStorage.removeItem('ichtus_dashboard_collapsed');
        this._restoreWidgetSizes();
        this._restoreWidgetPositions();
        this.initLayoutSelector();
        // Start ProPresenter polling if widget exists in the DOM
        if (document.querySelector('.widget-card[data-widget-id="propresenter"]')) {
            this._startProPresenterPolling();
        }

        // Re-clamp widget positions on window resize
        this._resizeHandler = () => {
            if (document.getElementById('view-dashboard')?.classList.contains('active')) {
                this._restoreWidgetPositions();
            }
        };
        window.addEventListener('resize', this._resizeHandler);
    },

    setupDragAndDrop() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;

        grid.addEventListener('dragstart', (e) => {
            // Don't start drag if the user is interacting with the resize handle
            if (e.target.closest('.widget-resize-handle')) return;
            const card = e.target.closest('.widget-card');
            if (!card) return;
            this.draggedEl = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.widgetId);
        });

        grid.addEventListener('dragend', (e) => {
            const card = e.target.closest('.widget-card');
            if (card) card.classList.remove('dragging');
            this.draggedEl = null;
            this._saveWidgetPositions();
        });

        grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this.draggedEl) return;

            const pos = this._calculateGridPosition(e.clientX, e.clientY);
            if (!pos) return;

            const card = this.draggedEl;
            const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(card.dataset.widgetId);
            const autoCol = this._findAutoPackCol(pos.row, span, pos.col);
            card.style.gridColumn = `${autoCol} / span ${span}`;
            card.style.gridRowStart = String(pos.row);
        });
    },

    // Calculate which grid cell (col, row) the cursor is over
_calculateGridPosition(clientX, clientY) {
    const grid = document.getElementById('widget-grid');
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();

    // Column calculation
    const COL_COUNT = 36;
    const gapPx = 12; // 0.75rem ≈ 12px
    const colWidth = (rect.width - gapPx * (COL_COUNT - 1)) / COL_COUNT;
    const rawCol = Math.round((clientX - rect.left) / (colWidth + gapPx));
    const col = Math.max(1, Math.min(COL_COUNT, rawCol));

    // Row calculation — fixed 152px step (140px row + 12px gap)
    const ROW_STEP = 152;
    let row = Math.round((clientY - rect.top) / ROW_STEP) || 1;
    row = Math.max(1, Math.min(this._getMaxVisibleRow(), row));

    return { col, row };
},

    // Auto-pack: find the first gap on the target row that fits the widget span,
    // preferring the gap nearest to the cursor column.
    _findAutoPackCol(targetRow, widgetSpan, cursorCol) {
        const grid = document.getElementById('widget-grid');
        if (!grid) return cursorCol;
        const COL_COUNT = 36;

        // Collect occupied column ranges on this row (exclude the dragged element)
        const occupied = [];
        grid.querySelectorAll('.widget-card').forEach(c => {
            if (c === this.draggedEl) return;
            const row = parseInt(c.style.gridRowStart);
            if (row === targetRow) {
                const col = parseInt(c.style.gridColumnStart) || 1;
                const span = parseInt(c.dataset.widgetSpan) || this._getDefaultSpan(c.dataset.widgetId);
                occupied.push({ start: col, end: col + span - 1 });
            }
        });

        occupied.sort((a, b) => a.start - b.start);

        // Find gaps between occupied ranges and pick the best one
        let current = 1;
        let bestCol = Math.min(cursorCol, COL_COUNT - widgetSpan + 1);
        let bestDist = Infinity;

        for (const occ of occupied) {
            const gapStart = current;
            const gapEnd = occ.start - 1;
            const gapSize = gapEnd - gapStart + 1;

            if (gapSize >= widgetSpan) {
                // Widget fits in this gap — try all valid start positions
                for (let s = gapStart; s <= gapEnd - widgetSpan + 1; s++) {
                    const mid = s + Math.floor(widgetSpan / 2);
                    const dist = Math.abs(mid - cursorCol);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCol = s;
                    }
                }
            }
            current = occ.end + 1;
        }

        // Gap after the last occupied widget
        if (current <= COL_COUNT) {
            const gapSize = COL_COUNT - current + 1;
            if (gapSize >= widgetSpan) {
                for (let s = current; s <= COL_COUNT - widgetSpan + 1; s++) {
                    const mid = s + Math.floor(widgetSpan / 2);
                    const dist = Math.abs(mid - cursorCol);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCol = s;
                    }
                }
            }
        }

        return Math.max(1, Math.min(bestCol, COL_COUNT - widgetSpan + 1));
    },

    // Return the number of grid rows that fit within the viewport (no scrolling)
    _getMaxVisibleRow() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return 8;
        const gridTop = grid.getBoundingClientRect().top;
        const availablePx = window.innerHeight - gridTop - 20;
        // Fixed row height: 140px row + 12px gap = 152px per row
        const ROW_STEP = 152;
        return Math.max(1, Math.floor((availablePx + 12) / ROW_STEP));
    },

    _saveWidgetPositions() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;
        const positions = {};
        const order = [];
        grid.querySelectorAll('.widget-card').forEach(card => {
            const id = card.dataset.widgetId;
            if (!id) return;
            order.push(id);
            const col = parseInt(card.style.gridColumnStart) || 1;
            const row = parseInt(card.style.gridRowStart) || 1;
            const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(id);
            positions[id] = { col, row, span };
        });
        this._widgetPositions = positions;
        try {
            localStorage.setItem('ichtus_dashboard_widget_positions', JSON.stringify(positions));
            localStorage.setItem('ichtus_dashboard_widget_order', JSON.stringify(order));
        } catch(e) {}
    },

    _restoreWidgetPositions() {
        try {
            const saved = localStorage.getItem('ichtus_dashboard_widget_positions');
            if (!saved) return;
            this._widgetPositions = JSON.parse(saved);
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            const maxRow = this._getMaxVisibleRow();
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (!id) return;
                const pos = this._widgetPositions[id];
                if (pos) {
                    const span = pos.span || parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(id);
                    const row = Math.min(pos.row, maxRow);
                    card.style.gridColumn = `${pos.col} / span ${span}`;
                    card.style.gridRowStart = String(row);
                }
            });
        } catch(e) {}
    },

    saveWidgetOrder() {
        // Delegates to _saveWidgetPositions which saves both positions and order
        this._saveWidgetPositions();
    },

    restoreWidgetOrder() {
        try {
            const saved = localStorage.getItem('ichtus_dashboard_widget_order');
            if (!saved) return;
            const order = JSON.parse(saved);
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            const cards = [...grid.querySelectorAll('.widget-card')];
            const map = new Map(cards.map(c => [c.dataset.widgetId, c]));
            order.forEach(id => {
                const card = map.get(id);
                if (card) grid.appendChild(card);
            });
        } catch(e) {}
    },

    restoreCollapsed() {
        try {
            const collapsed = JSON.parse(localStorage.getItem('ichtus_dashboard_collapsed') || '[]');
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            collapsed.forEach(id => {
                const card = grid.querySelector(`[data-widget-id="${id}"]`);
                if (card) {
                    const body = card.querySelector('.widget-body');
                    if (body) body.style.display = 'none';
                }
            });
        } catch(e) {}
    },

    /**
     * Ensure any widgets from saved order that are missing from DOM get rendered
     */
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
                            // Start polling for propresenter if needed
                            if (id === 'propresenter' && this._startProPresenterPolling) {
                                this._startProPresenterPolling();
                            }
                        }
                    }
                }
            });
        } catch(e) {}
    },

    setupTimer() {
        const display = document.getElementById('dash-timer-display');
        const startBtn = document.getElementById('dash-timer-start');
        const stopBtn = document.getElementById('dash-timer-stop');
        const resetBtn = document.getElementById('dash-timer-reset');
        if (!display || !startBtn || !stopBtn || !resetBtn) return;

        startBtn.addEventListener('click', () => {
            if (this.timerRunning) return;
            this.timerRunning = true;
            this.timerStartTime = Date.now() - (this.timerElapsed || 0);
            startBtn.disabled = true;
            stopBtn.disabled = false;
            this.timerInterval = setInterval(() => {
                const elapsed = Date.now() - this.timerStartTime;
                display.textContent = this.formatTime(elapsed);
                this.timerElapsed = elapsed;
            }, 100);
        });

        stopBtn.addEventListener('click', () => {
            if (!this.timerRunning) return;
            this.timerRunning = false;
            clearInterval(this.timerInterval);
            startBtn.disabled = false;
            stopBtn.disabled = true;
        });

        resetBtn.addEventListener('click', () => {
            this.timerRunning = false;
            clearInterval(this.timerInterval);
            this.timerElapsed = 0;
            display.textContent = '00:00:00';
            startBtn.disabled = false;
            stopBtn.disabled = true;
        });
    },

    formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    },


    /* --------------------------------------------------
       LAYOUT MANAGEMENT
       -------------------------------------------------- */

    initLayoutSelector() {
        const selector = document.getElementById('layout-selector');
        if (!selector) return;
        this.populateLayoutSelector();
    },

    loadLayouts() {
        try {
            const saved = localStorage.getItem('ichtus_dashboard_layouts');
            return saved ? JSON.parse(saved) : [];
        } catch(e) { return []; }
    },

    saveLayouts(layouts) {
        try { localStorage.setItem('ichtus_dashboard_layouts', JSON.stringify(layouts)); } catch(e) {}
    },

    getActiveLayoutName() {
        try { return localStorage.getItem('ichtus_dashboard_active_layout') || '__default__'; } catch(e) { return '__default__'; }
    },

    setActiveLayoutName(name) {
        try { localStorage.setItem('ichtus_dashboard_active_layout', name); } catch(e) {}
    },

    populateLayoutSelector() {
        const selector = document.getElementById('layout-selector');
        if (!selector) return;
        const layouts = this.loadLayouts();
        const activeName = this.getActiveLayoutName();
        selector.innerHTML = '';

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '__default__';
        defaultOpt.textContent = 'Default';
        selector.appendChild(defaultOpt);

        layouts.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.name;
            opt.textContent = l.name;
            selector.appendChild(opt);
        });

        selector.value = activeName;
    },

    getCurrentState() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return { order: [], collapsed: [], positions: {} };
        const order = [...grid.querySelectorAll('.widget-card')].map(el => el.dataset.widgetId);
        // Build positions from current DOM state
        const positions = {};
        grid.querySelectorAll('.widget-card').forEach(card => {
            const id = card.dataset.widgetId;
            if (!id) return;
            const col = parseInt(card.style.gridColumnStart) || 1;
            const row = parseInt(card.style.gridRowStart) || 1;
            const span = parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(id);
            positions[id] = { col, row, span };
        });
        try {
            const collapsed = JSON.parse(localStorage.getItem('ichtus_dashboard_collapsed') || '[]');
            return { order, collapsed, positions };
        } catch(e) { return { order, collapsed: [], positions }; }
    },

    applyLayout(layoutName) {
        const layouts = this.loadLayouts();
        let order, collapsed, positions;

        if (layoutName === '__default__') {
            order = this._defaultWidgetIds;
            collapsed = [];
            positions = {};
        } else {
            const layout = layouts.find(l => l.name === layoutName);
            if (!layout) return;
            order = layout.widgetOrder || this._defaultWidgetIds;
            collapsed = layout.collapsedWidgets || [];
            positions = layout.widgetPositions || {};
        }

        const grid = document.getElementById('widget-grid');
        if (grid) {
            const cards = [...grid.querySelectorAll('.widget-card')];
            const map = new Map(cards.map(c => [c.dataset.widgetId, c]));
            order.forEach(id => {
                const card = map.get(id);
                if (card) grid.appendChild(card);
            });

            // Apply widget positions with viewport clamping
            const maxRow = this._getMaxVisibleRow();
            cards.forEach(card => {
                const id = card.dataset.widgetId;
                if (!id) return;
                const pos = positions[id];
                if (pos) {
                    const span = pos.span || parseInt(card.dataset.widgetSpan) || this._getDefaultSpan(id);
                    const row = Math.min(pos.row, maxRow);
                    card.style.gridColumn = `${pos.col} / span ${span}`;
                    card.style.gridRowStart = String(row);
                }
            });
        }

        try {
            localStorage.setItem('ichtus_dashboard_widget_order', JSON.stringify(order));
            localStorage.setItem('ichtus_dashboard_widget_positions', JSON.stringify(positions));
        } catch(e) {}

        try {
            localStorage.setItem('ichtus_dashboard_collapsed', JSON.stringify(collapsed));
        } catch(e) {}

        if (grid) {
            grid.querySelectorAll('.widget-card').forEach(card => {
                const body = card.querySelector('.widget-body');
                const id = card.dataset.widgetId;
                if (!body) return;
                if (collapsed.includes(id)) {
                    body.style.display = 'none';
                } else {
                    body.style.display = '';
                }
            });
        }

        this.setActiveLayoutName(layoutName);
        this.populateLayoutSelector();
    },

    switchLayout(layoutName) {
        this.applyLayout(layoutName);
    },

    toggleEditMode() {
        this._editMode = !this._editMode;
        const addBtn = document.getElementById('dash-add-widget-btn');
        if (addBtn) {
            addBtn.style.display = this._editMode ? 'flex' : 'none';
        }
        // Toggle active state on edit button
        const editBtn = document.querySelector('.dash-edit-btn');
        if (editBtn) {
            editBtn.classList.toggle('active', this._editMode);
        }
        // Close picker when exiting edit mode
        if (!this._editMode) {
            const picker = document.querySelector('.widget-picker');
            if (picker) picker.remove();
        }
        const grid = document.getElementById('widget-grid');
        if (!grid) return;
        // Toggle .edit-mode class on grid for CSS
        grid.classList.toggle('edit-mode', this._editMode);
        grid.querySelectorAll('.widget-card').forEach(card => {
            if (this._editMode) {
                // Delete button - append directly to card
                if (!card.querySelector('.widget-delete-btn')) {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'widget-delete-btn';
                    delBtn.textContent = '−';
                    delBtn.title = 'Remove widget';
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.deleteWidget(card);
                    };
                    card.appendChild(delBtn);
                }
                // Resize handle
                if (!card.querySelector('.widget-resize-handle')) {
                    this._addResizeHandle(card);
                }
            } else {
                const delBtn = card.querySelector('.widget-delete-btn');
                if (delBtn) delBtn.remove();
                const handle = card.querySelector('.widget-resize-handle');
                if (handle) handle.remove();
            }
        });
    },

    _addResizeHandle(el) {
        const handle = document.createElement('div');
        handle.className = 'widget-resize-handle';
        handle.draggable = false;
        // Prevent native HTML5 drag on parent from firing
        handle.addEventListener('dragstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        el.appendChild(handle);
        this._initResizeHandle(el);
    },

    _initResizeHandle(el) {
        const handle = el.querySelector('.widget-resize-handle');
        if (!handle) return;

        const TOTAL_COLS = 36;
        const HEIGHT_STEP = 40; // snap height to increments of 40px
        const MIN_HEIGHT = 80;

        const onPointerDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startY = e.clientY;
            const grid = document.getElementById('widget-grid');
            if (!grid) return;

            // Column calculations
            const colCount = TOTAL_COLS;
            const gridWidth = grid.getBoundingClientRect().width;
            const gapPx = 24;
            const colWidth = (gridWidth - gapPx * (colCount - 1)) / colCount;

            // Current dimensions
            const currentWidth = el.getBoundingClientRect().width;
            const currentHeight = el.getBoundingClientRect().height;

            // Prevent text selection while dragging
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'nwse-resize';

            const onMove = (moveE) => {
                // Horizontal → column span
                const dx = moveE.clientX - startX;
                const targetWidth = currentWidth + dx;
                let newSpan = Math.max(1, Math.round(targetWidth / (colWidth + gapPx)));
                newSpan = Math.min(newSpan, colCount);
                el.style.gridColumn = `span ${newSpan}`;
                el.dataset.widgetSpan = String(newSpan);

                // Vertical → min-height
                const dy = moveE.clientY - startY;
                const targetHeight = currentHeight + dy;
                const snappedHeight = Math.max(MIN_HEIGHT, Math.round(targetHeight / HEIGHT_STEP) * HEIGHT_STEP);
                el.style.minHeight = snappedHeight + 'px';
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
            if (id) {
                const span = parseInt(card.dataset.widgetSpan);
                const height = parseInt(card.dataset.widgetHeight);
                const saved = {};
                if (span && span > 0 && span !== this._getDefaultSpan(id)) {
                    saved.span = span;
                }
                if (height && height > 0 && height !== this._getDefaultHeight(id)) {
                    saved.height = height;
                }
                if (Object.keys(saved).length > 0) {
                    sizes[id] = saved;
                }
            }
        });
        try {
            localStorage.setItem('ichtus_dashboard_widget_sizes', JSON.stringify(sizes));
        } catch(e) {}
    },

    _getDefaultSpan(widgetId) {
        const defaults = {
            quicklinks: 12,
            servicetimer: 18,
            status: 18,
            propresenter: 18
        };
        return defaults[widgetId] || 6;
    },

    _getDefaultHeight(widgetId) {
        const defaults = {
            quicklinks: 120,
            servicetimer: 140,
            status: 120,
            propresenter: 320
        };
        return defaults[widgetId] || 140;
    },

    _restoreWidgetSizes() {
        try {
            const saved = JSON.parse(localStorage.getItem('ichtus_dashboard_widget_sizes') || '{}');
            const grid = document.getElementById('widget-grid');
            if (!grid) return;
            grid.querySelectorAll('.widget-card').forEach(card => {
                const id = card.dataset.widgetId;
                if (!id) return;

                // Backward-compatible: old format stored just a number (span only)
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
                    card.style.minHeight = height + 'px';
                    card.dataset.widgetHeight = String(height);
                } else {
                    // Apply default minimum height for consistent initial sizing
                    const defaultH = this._getDefaultHeight(id);
                    card.style.minHeight = defaultH + 'px';
                    card.dataset.widgetHeight = String(defaultH);
                }
            });
        } catch(e) {}
    },

    deleteWidget(card) {
        this.showConfirmModal(
            'Remove this widget?',
            () => {
                const wasProPresenter = card.dataset.widgetId === 'propresenter';
                card.remove();
                this.setupDragAndDrop();
                this.saveWidgetOrder();
                // Stop ProPresenter polling if no more propresenter widgets exist
                if (wasProPresenter && !document.querySelector('.widget-card[data-widget-id="propresenter"]')) {
                    this._stopProPresenterPolling();
                }
            }
        );
    },

    showConfirmModal(message, onConfirm) {
        // Remove any existing confirm modal
        document.querySelectorAll('.dash-confirm-backdrop, .dash-confirm-modal').forEach(el => el.remove());

        const backdrop = document.createElement('div');
        backdrop.className = 'dash-confirm-backdrop';

        const modal = document.createElement('div');
        modal.className = 'dash-confirm-modal';

        const msgEl = document.createElement('p');
        msgEl.textContent = message;

        const btnRow = document.createElement('div');
        btnRow.className = 'dash-confirm-buttons';

        const close = () => {
            backdrop.remove();
            modal.remove();
            document.removeEventListener('keydown', onKey);
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'dash-confirm-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = close;

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'dash-confirm-ok';
        confirmBtn.textContent = 'Remove';
        confirmBtn.onclick = () => {
            close();
            onConfirm();
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        modal.appendChild(msgEl);
        modal.appendChild(btnRow);
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        // Close on backdrop click
        backdrop.onclick = close;

        // Close on Escape key
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);

        // Auto-focus Cancel button (safer default)
        cancelBtn.focus();
    },

    addWidget() {
        const existing = document.querySelector('.widget-picker');
        if (existing) {
            existing.remove();
            return;
        }
        const btn = document.getElementById('dash-add-widget-btn');
        const picker = document.createElement('div');
        picker.className = 'widget-picker';
        const widgets = [
            { id: 'quicklinks', icon: '\ud83d\udcc5', name: 'Quick Links' },
            { id: 'servicetimer', icon: '\u23f1\ufe0f', name: 'Service Timer' },
            { id: 'status', icon: '\ud83d\udcca', name: 'Workspace Status' },
            { id: 'propresenter', icon: '\ud83d\udcfd\ufe0f', name: 'ProPresenter Slides' }
        ];
        widgets.forEach(w => {
            const item = document.createElement('button');
            item.className = 'widget-picker-item';
            item.innerHTML = '<span class="widget-picker-icon">' + w.icon + '</span><span>' + w.name + '</span>';
            item.onclick = (e) => { e.stopPropagation(); this.insertWidget(w.id); };
            picker.appendChild(item);
        });
        document.body.appendChild(picker);
        requestAnimationFrame(() => {
            const rect = btn.getBoundingClientRect();
            picker.style.left = Math.max(8, rect.left) + 'px';
            picker.style.top = (rect.bottom + 4) + 'px';
        });
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!picker.contains(e.target) && e.target !== btn) {
                    picker.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 0);
    },

    /* --------------------------------------------------
       PROPRESENTER SLIDES POLLING
       -------------------------------------------------- */

    _proPresenterInterval: null,
    _proPresenterFastInterval: null,
    _proPresenterLastIndex: -1,

    _getProPresenterBaseUrl() {
        const saved = localStorage.getItem('setlistProIp') || '100.113.22.22:51253';
        const parts = saved.split(':');
        const ip = parts[0] || '100.113.22.22';
        const port = parts[1] || '51253';
        return `http://${ip}:${port}/v1`;
    },

    // Shared helper: parse slide index from ProPresenter API response
    _parseSlideIndex(responseText) {
        const text = responseText.trim();
        if (text.startsWith('{')) {
            try {
                const json = JSON.parse(text);
                return json.index ?? json.slide_index ?? json.currentIndex ?? json.currentSlideIndex ?? json.presentation_index?.index ?? 0;
            } catch (e) {
                return 0;
            }
        }
        return parseInt(text) || 0;
    },

    async _fetchProPresenterSlides(widgetEl) {
        const container = widgetEl.querySelector('.pp-slides-container');
        const statusDot = widgetEl.querySelector('.pp-status-dot');
        const presName = widgetEl.querySelector('.pp-pres-name');
        const slideCount = widgetEl.querySelector('.pp-slide-count');

        if (!container) return;

        const baseUrl = this._getProPresenterBaseUrl();

        try {
            // Fetch active presentation
            const presResp = await fetch(`${baseUrl}/presentation/active`, {
                signal: AbortSignal.timeout(3000)
            });
            if (!presResp.ok) throw new Error(`HTTP ${presResp.status}`);
            const presData = await presResp.json();

            // Fetch current slide index
            const idxResp = await fetch(`${baseUrl}/presentation/slide_index`, {
                signal: AbortSignal.timeout(3000)
            });
            let currentIdx = 0;
            if (idxResp.ok) {
                currentIdx = this._parseSlideIndex(await idxResp.text());
            }

            // Also try to get slide index from presentation data as fallback
            const presCurrentIdx = presData.currentSlideIndex ?? presData.currentIndex ?? presData.slide_index ?? -1;
            if (presCurrentIdx >= 0 && currentIdx === 0) {
                currentIdx = presCurrentIdx;
            }

            // Mark online
            if (statusDot) {
                statusDot.className = 'pp-status-dot online';
            }

            // ProPresenter wraps the data in a 'presentation' key
            const presentation = presData.presentation || presData;
            const uuid = (presentation.id && presentation.id.uuid) || '';
            const groups = presentation.groups || [];

            // Flatten all slides from all groups into a flat array
            const slides = [];
            for (const group of groups) {
                if (group.slides && group.slides.length) {
                    for (const slide of group.slides) {
                        slides.push({
                            text: slide.text || '',
                            label: slide.label || group.name || '',
                            groupName: group.name || '',
                            groupColor: group.color || null
                        });
                    }
                }
            }

            if (presName) presName.textContent = presData.name || '';
            // Clamp currentIdx to valid range
            const clampedIdx = slides.length > 0 ? Math.max(0, Math.min(currentIdx, slides.length - 1)) : 0;
            if (slideCount) slideCount.textContent = slides.length > 0 ? `${clampedIdx + 1} / ${slides.length}` : '-- / --';

            // Render slides with clamped index
            this._renderSlides(container, baseUrl, uuid, slides, clampedIdx);
            // Sync fast poll tracker so it knows the current index
            this._proPresenterLastIndex = clampedIdx;

        } catch (err) {
            if (err.name === 'AbortError' || err.name === 'TimeoutError') return;
            // Show offline state
            if (statusDot) statusDot.className = 'pp-status-dot offline';
            if (presName) presName.textContent = 'ProPresenter offline';
            if (slideCount) slideCount.textContent = '-- / --';
            // Only show offline message if container is empty/loading
            if (!container.querySelector('.pp-slide-item') && !container.querySelector('.pp-offline')) {
                container.innerHTML = '<div class="pp-offline"><span class="pp-offline-icon">📽️</span>ProPresenter niet bereikbaar<br><small>Controleer IP/poort in Setlist instellingen</small></div>';
            }
        }
    },

    _renderSlides(container, baseUrl, uuid, slides, currentIdx) {
        let html = '';
        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];
            const thumbUrl = uuid ? `${baseUrl}/presentation/${uuid}/thumbnail/${i}` : '';
            const active = i === currentIdx ? ' active' : '';
            html += `<div class="pp-slide-item${active}" data-index="${i}" style="border-radius:8px;overflow:hidden;cursor:pointer;margin-bottom:4px">` +
                `<img class="pp-slide-thumb" src="${thumbUrl}" alt="Slide ${i+1}" loading="lazy" style="border-radius:6px;display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#222" onerror="this.classList.add('error'); this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 34%22%3E%3Crect fill=%22%2523333%22 width=%2260%22 height=%2234%22/%3E%3Ctext x=%2230%22 y=%2222%22 text-anchor=%22middle%22 fill=%22%2523666%22 font-size=%2212%22%3E${i+1}%3C/text%3E%3C/svg%3E'" onload="this.classList.remove('loading')">` +
            '</div>';
        }
        container.innerHTML = html || '<div class="pp-loading">Geen slides gevonden — open een presentatie in ProPresenter</div>';

        // Scroll active slide into view
        const activeEl = container.querySelector('.pp-slide-item.active');
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        // Click to trigger slide
        container.querySelectorAll('.pp-slide-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const index = item.dataset.index;
                if (index !== undefined && uuid) {
                    fetch(`${baseUrl}/presentation/${uuid}/${index}/trigger`, {
                        method: 'GET',
                        signal: AbortSignal.timeout(3000)
                    }).catch(() => {});
                }
            });
        });
    },

    // Fast index-only poll: only fetches the slide index and toggles the active class on existing slides
    async _pollProPresenterIndex(widgetEl) {
        const container = widgetEl.querySelector('.pp-slides-container');
        const slideCount = widgetEl.querySelector('.pp-slide-count');
        if (!container) return;

        // Only poll if slides are already rendered
        const slides = container.querySelectorAll('.pp-slide-item');
        if (slides.length === 0) return;

        const baseUrl = this._getProPresenterBaseUrl();

        try {
            const idxResp = await fetch(`${baseUrl}/presentation/slide_index`, {
                signal: AbortSignal.timeout(1000)
            });
            if (!idxResp.ok) return;

            const currentIdx = this._parseSlideIndex(await idxResp.text());

            // Only update if index changed
            if (currentIdx !== this._proPresenterLastIndex && currentIdx >= 0 && currentIdx < slides.length) {
                this._proPresenterLastIndex = currentIdx;

                // Toggle active class on existing DOM elements — instant, no re-render
                slides.forEach((el, i) => {
                    el.classList.toggle('active', i === currentIdx);
                });

                // Update slide count
                if (slideCount) {
                    slideCount.textContent = `${currentIdx + 1} / ${slides.length}`;
                }

                // Scroll active slide into view
                slides[currentIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        } catch (e) {
            // Silently fail — full poll will handle errors
        }
    },

    _updateAllProPresenterWidgets() {
        const widgets = document.querySelectorAll('.widget-card[data-widget-id="propresenter"]');
        widgets.forEach(el => this._fetchProPresenterSlides(el));
    },

    _updateAllProPresenterIndexes() {
        const widgets = document.querySelectorAll('.widget-card[data-widget-id="propresenter"]');
        widgets.forEach(el => this._pollProPresenterIndex(el));
    },

    _startProPresenterPolling() {
        if (this._proPresenterInterval) return; // Already polling
        // Do an immediate first fetch
        this._updateAllProPresenterWidgets();
        // Full data refresh every 15 seconds (catches presentation changes)
        this._proPresenterInterval = setInterval(() => {
            this._updateAllProPresenterWidgets();
        }, 15000);
        // Fast index-only poll every 500ms for instant slide switching
        this._proPresenterFastInterval = setInterval(() => {
            this._updateAllProPresenterIndexes();
        }, 500);
    },

    _stopProPresenterPolling() {
        if (this._proPresenterInterval) {
            clearInterval(this._proPresenterInterval);
            this._proPresenterInterval = null;
        }
        if (this._proPresenterFastInterval) {
            clearInterval(this._proPresenterFastInterval);
            this._proPresenterFastInterval = null;
        }
    },

    getWidgetTemplate(widgetId) {
        const templates = {
            quicklinks: '<div class="widget-card" draggable="true" data-widget-id="quicklinks">' +
                '<div class="widget-body">' +
                    '<div class="quick-links">' +
                        '<a href="#" class="quick-link" onclick="router.navigate(\'agenda\'); return false;">' +
                            '<span class="quick-icon">\ud83d\udcc5</span><span>Agenda</span>' +
                        '</a>' +
                        '<a href="#" class="quick-link" onclick="router.navigate(\'checklist\'); return false;">' +
                            '<span class="quick-icon">\u2705</span><span>Checklist</span>' +
                        '</a>' +
                        '<a href="#" class="quick-link" onclick="router.navigate(\'patchbay\'); return false;">' +
                            '<span class="quick-icon">\ud83d\udd0c</span><span>Patchbay</span>' +
                        '</a>' +
                        '<a href="#" class="quick-link" onclick="router.navigate(\'analytics\'); return false;">' +
                            '<span class="quick-icon">\ud83d\udcca</span><span>Analytics</span>' +
                        '</a>' +
                        '<a href="#" class="quick-link" onclick="router.navigate(\'setlist\'); return false;">' +
                            '<span class="quick-icon">\ud83c\udfb5</span><span>Setlist</span>' +
                        '</a>' +
                    '</div>' +
                '</div>' +
            '</div>',
            servicetimer: '<div class="widget-card" draggable="true" data-widget-id="servicetimer">' +
                '<div class="widget-body">' +
                    '<div class="timer-widget">' +
                        '<div id="dash-timer-display" class="dash-timer-display heading-font">00:00:00</div>' +
                        '<div class="timer-controls">' +
                            '<button id="dash-timer-start" class="timer-btn timer-start">Start</button>' +
                            '<button id="dash-timer-stop" class="timer-btn timer-stop" disabled>Stop</button>' +
                            '<button id="dash-timer-reset" class="timer-btn timer-reset">Reset</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>',

            status: '<div class="widget-card" draggable="true" data-widget-id="status">' +
                '<div class="widget-body">' +
                    '<div class="status-list">' +
                        '<div class="status-item"><span class="status-dot online"></span><span>Agenda Module</span></div>' +
                        '<div class="status-item"><span class="status-dot online"></span><span>Checklist Module</span></div>' +
                        '<div class="status-item"><span class="status-dot online"></span><span>Patchbay Module</span></div>' +
                        '<div class="status-item"><span class="status-dot online"></span><span>Analytics Module</span></div>' +
                        '<div class="status-item"><span class="status-dot online"></span><span>Setlist Module</span></div>' +
                    '</div>' +
                '</div>' +
            '</div>',

            propresenter: '<div class="widget-card widget-propresenter" draggable="true" data-widget-id="propresenter">' +
                '<div class="widget-body">' +
                        '<div class="pp-slides-container">' +
                            '<div class="pp-loading">Connecting to ProPresenter...</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        };
        return templates[widgetId];
    },

    _getNewWidgetPosition(widgetId) {
        // Find the lowest occupied row, then place below (within viewport)
        const grid = document.getElementById('widget-grid');
        const maxVisibleRow = this._getMaxVisibleRow();
        let maxOccupiedRow = 0;
        if (grid) {
            grid.querySelectorAll('.widget-card').forEach(card => {
                if (card.dataset.widgetId === widgetId) return;
                const row = parseInt(card.style.gridRowStart) || 1;
                maxOccupiedRow = Math.max(maxOccupiedRow, row);
            });
        }
        const row = Math.min(maxVisibleRow, maxOccupiedRow + 1);    // Auto-pack horizontally: find the leftmost available gap on the target row
    const autoCol = this._findAutoPackCol(row, this._getDefaultSpan(widgetId), 1);
    return { col: autoCol, row };
},

    insertWidget(widgetId) {
        const grid = document.getElementById('widget-grid');
        // Don't add if a widget with this data-widget-id already exists
        if (grid.querySelector(`[data-widget-id="${widgetId}"]`)) {
            const picker = document.querySelector('.widget-picker');
            if (picker) picker.remove();
            return;
        }

        // Check if there's room for another widget in the viewport
        const maxVisibleRow = this._getMaxVisibleRow();
        let maxOccupiedRow = 0;
        let totalWidgets = 0;
        grid.querySelectorAll('.widget-card').forEach(card => {
            const row = parseInt(card.style.gridRowStart) || 1;
            maxOccupiedRow = Math.max(maxOccupiedRow, row);
            totalWidgets++;
        });
        // If no more rows are visible, don't add
        if (maxOccupiedRow >= maxVisibleRow && totalWidgets > 0) {
            const msg = document.querySelector('.widget-picker-msg');
            if (!msg) {
                const picker = document.querySelector('.widget-picker');
                if (picker) {
                    const el = document.createElement('div');
                    el.className = 'widget-picker-msg';
                    el.textContent = 'Dashboard is full — remove a widget first';
                    el.style.cssText = 'padding:0.5rem 0.75rem;color:var(--ichtus-red,#e74c3c);font-size:0.8rem;border-top:1px solid var(--border-light,#333);';
                    picker.appendChild(el);
                    setTimeout(() => el.remove(), 2000);
                }
            }
            return;
        }

        const html = this.getWidgetTemplate(widgetId);
        if (!html) return;
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const el = temp.firstElementChild;
        
        // Position the new widget below all existing widgets
        const pos = this._getNewWidgetPosition(widgetId);
        const span = this._getDefaultSpan(widgetId);
        el.style.gridColumn = `${pos.col} / span ${span}`;
        el.style.gridRowStart = String(pos.row);
        el.dataset.widgetSpan = String(span);
        
        grid.appendChild(el);
        if (widgetId === 'servicetimer') {
            this.setupTimer();
        }
        if (widgetId === 'propresenter') {
            this._startProPresenterPolling();
        }
        this.setupDragAndDrop();
        const picker = document.querySelector('.widget-picker');
        if (picker) picker.remove();
        this._saveWidgetPositions();
        // If edit mode is active, add delete button and resize handle
        if (this._editMode) {
            // Delete button - append directly to card element
            if (!el.querySelector('.widget-delete-btn')) {
                const delBtn = document.createElement('button');
                delBtn.className = 'widget-delete-btn';
                delBtn.textContent = '−';
                delBtn.title = 'Remove widget';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteWidget(el);
                };
                el.appendChild(delBtn);
            }
            if (!el.querySelector('.widget-resize-handle')) {
                this._addResizeHandle(el);
            }
        }
    },

    saveCurrentLayout() {
        const layouts = this.loadLayouts();
        const activeName = this.getActiveLayoutName();

        // If a saved layout is active, update it directly
        if (activeName !== '__default__') {
            const existing = layouts.find(l => l.name === activeName);
            if (existing) {
                const state = this.getCurrentState();
                existing.widgetOrder = state.order;
                existing.collapsedWidgets = state.collapsed;
                existing.widgetPositions = state.positions;
                this.saveLayouts(layouts);
                return;
            }
        }

        // Ask for a name
        const name = prompt(i18n.t('dashboard_layout_save_prompt') || 'Save layout as:');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();

        // Check if name exists
        const existing = layouts.find(l => l.name === trimmed);
        if (existing) {
            const state = this.getCurrentState();
            existing.widgetOrder = state.order;
            existing.collapsedWidgets = state.collapsed;
            existing.widgetPositions = state.positions;
        } else {
            const state = this.getCurrentState();
            layouts.push({
                name: trimmed,
                widgetOrder: state.order,
                collapsedWidgets: state.collapsed,
                widgetPositions: state.positions
            });
        }

        this.saveLayouts(layouts);
        this.setActiveLayoutName(trimmed);
        this.populateLayoutSelector();
    },

    deleteLayout(name) {
        let layouts = this.loadLayouts();
        layouts = layouts.filter(l => l.name !== name);
        this.saveLayouts(layouts);

        // If deleted the active layout, switch to default
        if (this.getActiveLayoutName() === name) {
            this.setActiveLayoutName('__default__');
            this.applyLayout('__default__');
        } else {
            this.populateLayoutSelector();
        }
    },

    renameLayout(oldName, newName) {
        if (!newName || !newName.trim()) return;
        const trimmed = newName.trim();
        const layouts = this.loadLayouts();
        const layout = layouts.find(l => l.name === oldName);
        if (!layout) return;

        // Check if new name already exists (different from old name)
        if (trimmed !== oldName && layouts.some(l => l.name === trimmed)) return;

        layout.name = trimmed;
        this.saveLayouts(layouts);

        if (this.getActiveLayoutName() === oldName) {
            this.setActiveLayoutName(trimmed);
        }
        this.populateLayoutSelector();
    },

    manageLayout() {
        const layouts = this.loadLayouts();
        const activeName = this.getActiveLayoutName();

        // Remove any existing modal
        const existing = document.querySelector('.layout-manage-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'layout-manage-modal';
        modal.innerHTML = `
            <div class='layout-manage-content'>
                <h3>${i18n.t('dashboard_layout_manage')}</h3>
                <ul class='layout-manage-list'>
                    ${layouts.length === 0 ? `<li style='text-align:center;color:#888;padding:1rem;'>${i18n.t('dashboard_layout_no_layouts')}</li>` : layouts.map(l => `
                        <li class='layout-manage-item'>
                            <span class='layout-name'>${l.name}${l.name === activeName ? ` <span style="color:var(--ichtus-orange);font-size:0.75rem;">${i18n.t('dashboard_layout_active')}</span>` : ''}</span>
                            <div class='layout-actions'>
                                <button class='rename-btn' onclick="dashboardModule.renameLayoutPrompt('${l.name.replace(/'/g, "\\'")}')" title='${i18n.t('dashboard_layout_rename')}'>✏</button>
                                <button class='delete-btn' onclick="dashboardModule.deleteLayout('${l.name.replace(/'/g, "\\'")}')" title='${i18n.t('dashboard_layout_delete')}'>🗑</button>
                            </div>
                        </li>
                    `).join('')}
                </ul>
                <button class='layout-manage-close' onclick="this.closest('.layout-manage-modal').remove()">${i18n.t('dashboard_layout_close')}</button>
            </div>
        `;
        document.body.appendChild(modal);

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    },

    renameLayoutPrompt(oldName) {
        const newName = prompt(i18n.t('dashboard_layout_rename_prompt') || 'Rename layout:', oldName);
        if (!newName || !newName.trim() || newName.trim() === oldName) return;
        this.renameLayout(oldName, newName.trim());
        // Refresh the manage modal
        this.manageLayout();
    },

    syncState(updates) {
        // TODO: implement cross-module state sync (e.g. push timer state, notes, etc.)
    }
};
