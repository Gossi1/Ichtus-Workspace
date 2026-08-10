/**
 * DashboardTimer — Service Timer and Countdown widget
 * Spread into dashboardModule: { ...DashboardTimer, ... }
 */
const DashboardTimer = {
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
                if (days > 0) displayStr += `${days}d `;
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
        if (!val) { alert('Voer een geldige datum en tijd in.'); return; }
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
            { label: 'Tijd aanpassen', icon: '⏳', action: () => {
                const settingsPanel = card.querySelector('#countdown-settings-panel');
                if (settingsPanel) { settingsPanel.classList.remove('hidden'); card.dataset.settingsToggled = 'true'; }
            }},
            { label: 'Widget verwijderen', icon: '×', action: () => {
                if (confirm('Weet je zeker dat je deze widget wilt verwijderen?')) this.deleteWidget(card);
            }, danger: true }
        ];

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dashboard-context-menu-item' + (item.danger ? ' danger' : '');
            div.innerHTML = `<span>${item.icon}</span> ${item.label}`;
            div.addEventListener('click', (ev) => { ev.stopPropagation(); this.closeDashboardContextMenu(); item.action(); });
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
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    },

    closeDashboardContextMenu() {
        document.querySelectorAll('.dashboard-context-menu').forEach(el => el.remove());
    },
};
