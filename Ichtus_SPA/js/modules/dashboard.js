// Dashboard Module for Ichtus Workspace SPA
const dashboardModule = {
    initialized: false,
    _lastView: null,
    timerInterval: null,
    timerStartTime: null,
    timerRunning: false,
    draggedEl: null,

    init() {
        if (this.initialized && this._lastView === 'dashboard') return;
        this.initialized = true;
        this._lastView = 'dashboard';

        this.setupDragAndDrop();
        this.setupTimer();
        this.restoreNotes();
        this.restoreWidgetOrder();
        this.restoreCollapsed();
    },

    setupDragAndDrop() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;

        grid.addEventListener('dragstart', (e) => {
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
            this.saveWidgetOrder();
        });

        grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterEl = this.getDragAfterElement(grid, e.clientX, e.clientY);
            if (this.draggedEl) {
                if (afterEl) {
                    grid.insertBefore(this.draggedEl, afterEl);
                } else {
                    grid.appendChild(this.draggedEl);
                }
            }
        });
    },

    getDragAfterElement(container, x, y) {
        const draggableElements = [...container.querySelectorAll('.widget-card:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offsetX = x - box.left - box.width / 2;
            const offsetY = y - box.top - box.height / 2;
            const dist = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
            if (dist < closest.dist) {
                return { offset: dist, element: child };
            }
            return closest;
        }, { dist: Number.POSITIVE_INFINITY }).element;
    },

    saveWidgetOrder() {
        const grid = document.getElementById('widget-grid');
        if (!grid) return;
        const order = [...grid.querySelectorAll('.widget-card')].map(el => el.dataset.widgetId);
        try { localStorage.setItem('ichtus_dashboard_widget_order', JSON.stringify(order)); } catch(e) {}
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

    toggleWidget(btn) {
        const card = btn.closest('.widget-card');
        const body = card.querySelector('.widget-body');
        if (!body) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? '' : 'none';
        btn.textContent = isHidden ? '−' : '+';
        try {
            const collapsed = JSON.parse(localStorage.getItem('ichtus_dashboard_collapsed') || '[]');
            const id = card.dataset.widgetId;
            if (isHidden) {
                const idx = collapsed.indexOf(id);
                if (idx > -1) collapsed.splice(idx, 1);
            } else {
                if (!collapsed.includes(id)) collapsed.push(id);
            }
            localStorage.setItem('ichtus_dashboard_collapsed', JSON.stringify(collapsed));
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
                    const btn = card.querySelector('.widget-toggle');
                    if (body) body.style.display = 'none';
                    if (btn) btn.textContent = '+';
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

    restoreNotes() {
        const textarea = document.getElementById('dash-notes');
        if (!textarea) return;
        try {
            const saved = localStorage.getItem('ichtus_dashboard_notes');
            if (saved) textarea.value = saved;
        } catch(e) {}
        textarea.addEventListener('input', () => {
            try { localStorage.setItem('ichtus_dashboard_notes', textarea.value); } catch(e) {}
        });
    },

    syncState(updates) {
        // TODO: implement cross-module state sync (e.g. push timer state, notes, etc.)
    }
};
