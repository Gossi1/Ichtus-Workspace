/* ============================================
   AGENDA MODULE
   Agenda Maker functionality for SPA
   ============================================ */

const agendaModule = {
    img: new Image(),
    initialized: false,

    init() {
        // Skip if already initialized for this view
        if (this.initialized && this._lastView === 'agenda') return;
        this._lastView = 'agenda';

        const canvas = document.getElementById('canvas');
        const ctx = canvas ? canvas.getContext('2d') : null;
        const agendaGroup = document.getElementById('agenda-group');
        const pxDisplay = document.getElementById('px-display');
        const status = document.getElementById('status');
        const fileInput = document.getElementById('fileInput');

        // Default position from hoodletter.js config
        const DEFAULT_X = 110;
        const DEFAULT_Y = 290;

        // Restore saved image
        const savedImage = localStorage.getItem('ichtus_template');
        if (savedImage) {
            this.img.src = savedImage;
            if (status) status.innerText = __('agenda_template_restored');
        }

        // Use DEFAULT values from config (not saved position)
        if (agendaGroup) {
            agendaGroup.style.left = DEFAULT_X + 'px';
            agendaGroup.style.top = DEFAULT_Y + 'px';
        }
        if (pxDisplay) {
            pxDisplay.innerText = `Positie: X=${DEFAULT_X}, Y=${DEFAULT_Y}`;
        }

        // Image load handler
        this.img.onload = () => {
            if (!canvas || !ctx) return;
            canvas.width = 1920;
            canvas.height = this.img.height * (1920 / this.img.width);
            ctx.drawImage(this.img, 0, 0, canvas.width, canvas.height);
        };

        // File input handler
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.img.src = ev.target.result;
                    try {
                        localStorage.setItem('ichtus_template', ev.target.result);
                    } catch (err) {
                        console.warn(__('agenda_image_too_large'));
                    }
                };
                reader.readAsDataURL(e.target.files[0]);
            });
        }

        // Restore form values from appState (single source of truth owned by
        // state.js). Defaults match the appState.agenda defaults so the box
        // is never in an undefined state. Preference changes are then wired
        // to dedicated handlers (onHideSpeakersChange / onCustomLabelInput)
        // so each user edit mutates appState + saves once — render() itself
        // never writes localStorage.
        const hideSpeakersInput = document.getElementById('hideSpeakers');
        const customLabelInput = document.getElementById('customLabel');
        if (hideSpeakersInput) {
            hideSpeakersInput.checked = appState.agenda.hideSpeakers !== false;
            hideSpeakersInput.addEventListener('change', () => this.onHideSpeakersChange());
        }
        if (customLabelInput && typeof appState.agenda.customLabel === 'string') {
            customLabelInput.value = appState.agenda.customLabel;
        }
        if (customLabelInput) {
            customLabelInput.addEventListener('input', () => this.onCustomLabelInput());
        }

        // Make draggable
        this.makeDraggable(agendaGroup);

        // Auto-fetch on init
        this.fetchTockify();

        this.initialized = true;
    },

    changeWeek(direction) {
        appState.agenda.weekOffset += direction;
        const weekLabel = document.getElementById('week-label');
        if (weekLabel) {
            weekLabel.innerText = appState.agenda.weekOffset === 0 ? __('agenda_this_week') : `${__('agenda_week')} ${appState.agenda.weekOffset}`;
        }
        saveAgenda();
        this.fetchTockify();
    },

    async fetchTockify() {
        const status = document.getElementById('status');
        const icsUrl = 'https://tockify.com/api/feeds/ics/ichtus';
        // CORS proxies — server-side proxy first (most reliable), then public proxies as fallback
        const corsProxies = [
            '/api/tockify/ics',  // Server-side proxy (no CORS needed)
            'https://corsproxy.io/?' + encodeURIComponent(icsUrl),
            'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(icsUrl),
            'https://api.allorigins.win/raw?url=' + encodeURIComponent(icsUrl)
        ];
        const PROXY_TIMEOUT = 6000; // 6s per proxy attempt
        
        if (status) status.innerText = __('agenda_fetching');
        
        try {
            // Debug: check ICAL is loaded
            if (typeof ICAL === 'undefined') {
                throw new Error('ICAL library not loaded!');
            }
            if (typeof ICAL.parse !== 'function') {
                throw new Error('ICAL.parse not defined!');
            }
            
            // Try each CORS proxy until one succeeds
            let icsData = null;
            for (const proxyUrl of corsProxies) {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT);
                    const response = await fetch(proxyUrl, { signal: controller.signal });
                    clearTimeout(timeout);
                    if (!response.ok) continue;
                    icsData = await response.text();
                    if (icsData && icsData.includes('BEGIN:VCALENDAR')) break;
                    icsData = null;
                } catch (e) {
                    continue; // Try next proxy
                }
            }
            if (!icsData) {
                throw new Error('Kon agenda niet ophalen — alle proxies faalden.');
            }
            
            if (status) status.innerText = `ICS ontvangen (${icsData.length} bytes), parseren...`;
            
            const jcalData = ICAL.parse(icsData);
            const comp = new ICAL.Component(jcalData);
            const vevents = comp.getAllSubcomponents('vevent');
            
            if (status) status.innerText = `${vevents.length} ${__('agenda_events_found')}`;

            const now = new Date();
            const limit = new Date(now);
            limit.setMonth(now.getMonth() + 1);

            let day = now.getDay();
            let diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const start = new Date(now);
            start.setDate(diff + (appState.agenda.weekOffset * 7));
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);

            // Hidden/swapped flags come from appState — populated by state.js
            // loadState() (with legacy-key migration on first run).
            const hiddenEvents = Array.isArray(appState.agenda.hiddenEvents) ? appState.agenda.hiddenEvents : [];
            const swappedEvents = Array.isArray(appState.agenda.swappedEvents) ? appState.agenda.swappedEvents : [];

            appState.agenda.allEvents = [];

            vevents.forEach((vevent) => {
                const e = new ICAL.Event(vevent);
                const s = e.startDate.toJSDate();
                if (s >= start && s <= end && s <= limit) {
                    const evtId = e.summary.replace(/[^a-zA-Z0-9]/g, '').substring(0, 15) + s.getTime();
                    appState.agenda.allEvents.push({
                        id: evtId,
                        visible: !hiddenEvents.includes(evtId),
                        isOverridden: swappedEvents.includes(evtId),
                        date: s,
                        dateStr: (() => {
                            const dayName = s.toLocaleDateString(i18n.getLocale(), { weekday: 'short' }).replace('.', '');
                            const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
                            const month = s.toLocaleDateString(i18n.getLocale(), { month: 'short' }).replace('.', '');
                            return `${capitalizedDay} ${s.getDate()} ${month}`;
                        })(),
                        timeStr: `${s.toLocaleTimeString(i18n.getLocale(), { hour:'2-digit', minute:'2-digit' })} - ${e.endDate.toJSDate().toLocaleTimeString(i18n.getLocale(), { hour:'2-digit', minute:'2-digit' })}`,
                        summary: e.summary
                    });
                }
            });

            appState.agenda.allEvents.sort((a, b) => a.date - b.date);
            this.render();

        } catch (err) {
            console.error('fetchTockify error:', err);
            if (status) {
                if (err.message.includes('ICAL')) {
                    status.innerText = __('agenda_ical_error') + err.message;
                } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Load failed')) {
                    status.innerText = __('agenda_network_error');
                } else if (err.message.includes('HTTP')) {
                    status.innerText = __('agenda_server_error') + err.message;
                } else {
                    status.innerText = __('agenda_error') + err.message;
                }
            }
        }
    },

    toggleEvent(id) {
        const event = appState.agenda.allEvents.find(e => e.id === id);
        if (event) {
            event.visible = !event.visible;
            appState.agenda.hiddenEvents = appState.agenda.allEvents
                .filter(e => !e.visible)
                .map(e => e.id);
            saveAgenda();
        }
        this.render();
    },

    manualSwap(id) {
        const event = appState.agenda.allEvents.find(e => e.id === id);
        if (event) {
            event.isOverridden = !event.isOverridden;
            appState.agenda.swappedEvents = appState.agenda.allEvents
                .filter(e => e.isOverridden)
                .map(e => e.id);
            saveAgenda();
        }
        this.render();
    },

    // User-input handlers — each owns its own appState mutation + saveAgenda
    // call so saveAgenda() never fires from render() (which can run many
    // times in a row, e.g. on every keystroke if wired to oninput).
    onHideSpeakersChange() {
        const hideSpeakersEl = document.getElementById('hideSpeakers');
        if (!hideSpeakersEl) return;
        appState.agenda.hideSpeakers = hideSpeakersEl.checked;
        saveAgenda();
        this.render();
    },

    onCustomLabelInput() {
        const customLabelEl = document.getElementById('customLabel');
        if (!customLabelEl) return;
        appState.agenda.customLabel = customLabelEl.value;
        saveAgenda();
        this.render();
    },

    render() {
        const status = document.getElementById('status');
        const agendaGroup = document.getElementById('agenda-group');
        const hideSpeakersEl = document.getElementById('hideSpeakers');
        const customLabelEl = document.getElementById('customLabel');
        const hideSpeakers = hideSpeakersEl ? hideSpeakersEl.checked : (appState.agenda.hideSpeakers !== false);
        const customLabel = customLabelEl ? customLabelEl.value : (appState.agenda.customLabel || 'Dienst');

        // render() is purely re-rendering from appState + DOM. Preference
        // persistence lives in onHideSpeakersChange() / onCustomLabelInput()
        // so each user edit saves exactly once. No saveState() here.

        // Populate event-selector with toggle checkboxes
        const container = document.getElementById('event-selector');
        if (container) {
            container.innerHTML = '<strong>Zichtbaar (Klik op titel om te hernoemen):</strong>';

            appState.agenda.allEvents.forEach(e => {
                const isSunday = e.date.getDay() === 0;
                const hour = e.date.getHours();
                const minute = e.date.getMinutes();
                const timeVal = hour + (minute / 60);

                const excludedNames = ['Ichtus Kids', 'Ichtus Kids & Junior', 'Ichtus Kids & junior'];
                const isExcluded = excludedNames.some(name => e.summary.includes(name));

                let displayTitle = e.summary;
                const isTargetService = isSunday && (timeVal >= 9.5 && timeVal <= 10.5) && !isExcluded;

                if (e.isOverridden || (hideSpeakers && isTargetService)) {
                    displayTitle = customLabel;
                }

                e.currentDisplayTitle = displayTitle;

                const label = document.createElement('label');
                label.className = 'toggle-item';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = e.visible;
                checkbox.addEventListener('change', () => agendaModule.toggleEvent(e.id));
                const span = document.createElement('span');
                span.textContent = displayTitle;
                span.style.cursor = 'pointer';
                if (e.isOverridden) span.style.color = 'var(--ichtus-orange)';
                span.addEventListener('click', () => agendaModule.manualSwap(e.id));
                label.appendChild(checkbox);
                label.appendChild(span);
                container.appendChild(label);
            });
        }

        // Render visible events to columns. Column element refs are stashed
        // on `this` so downloadImage() can read innerText without re-querying
        // the DOM by id.
        const activeEvents = appState.agenda.allEvents.filter(e => e.visible);
        this.colDate = document.getElementById('col-date');
        const colPipe = document.getElementById('col-pipe');
        this.colTime = document.getElementById('col-time');
        this.colEvent = document.getElementById('col-event');

        if (activeEvents.length > 0) {
            let last = '';
            let fD = [], fP = [];

            activeEvents.forEach(e => {
                if (e.dateStr === last) {
                    fD.push('');
                    fP.push('|');
                } else {
                    fD.push(e.dateStr);
                    fP.push('|');
                    last = e.dateStr;
                }
            });

            if (this.colDate) this.colDate.innerText = fD.join('\n');
            if (colPipe) colPipe.innerText = fP.join('\n');
            if (this.colTime) this.colTime.innerText = activeEvents.map(e => e.timeStr).join('\n');
            if (this.colEvent) this.colEvent.innerText = activeEvents.map(e => '  ' + e.currentDisplayTitle).join('\n');

            [this.colDate, this.colTime, this.colEvent].forEach(col => {
                if (col) col.contentEditable = 'true';
            });

            if (agendaGroup) agendaGroup.style.display = 'flex';
            if (status) status.innerText = `${activeEvents.length} ${__('agenda_items_visible')}`;
        } else {
            if (agendaGroup) agendaGroup.style.display = 'none';
            if (status) status.innerText = __('agenda_no_items');
        }
    },

    downloadImage() {
        if (!this.img.src) return;

        // Column refs are stashed on `this` during render(). If the user
        // hits "Download PNG" before the first render() has run (e.g. ICS
        // fetch still resolving), look them up here so we don't crash.
        if (!this.colDate)  this.colDate  = document.getElementById('col-date');
        if (!this.colTime)  this.colTime  = document.getElementById('col-time');
        if (!this.colEvent) this.colEvent = document.getElementById('col-event');
        if (!this.colDate || !this.colTime || !this.colEvent) return;

        const canvas = document.getElementById('canvas');
        const agendaGroup = document.getElementById('agenda-group');
        const tC = document.createElement('canvas');
        const tX = tC.getContext('2d');

        tC.width = canvas.width;
        tC.height = canvas.height;
        tX.drawImage(this.img, 0, 0, canvas.width, canvas.height);

        const computedStyle = window.getComputedStyle(agendaGroup);
        const colStyle = window.getComputedStyle(agendaGroup.querySelector('.column'));

        const fontSize = parseInt(colStyle.fontSize);
        const paddingLeft = parseInt(computedStyle.paddingLeft);
        const paddingTop = parseInt(computedStyle.paddingTop);
        
        tX.font = `${fontSize}px IchtusFont`;
        tX.fillStyle = 'white';
        tX.textBaseline = 'top';

        const x = parseInt(agendaGroup.style.left) + paddingLeft;
        const y = parseInt(agendaGroup.style.top) + paddingTop;

        // Reuse the element refs cached on `this` by render() instead of
        // re-querying the DOM by id.
        const dates = this.colDate.innerText.split('\n');
        const times = this.colTime.innerText.split('\n');
        const events = this.colEvent.innerText.split('\n');

        let maxD = 0;
        dates.forEach(l => {
            if (l !== '') maxD = Math.max(maxD, tX.measureText(l).width);
        });

        const columnGap = 25;
        const LINE_HEIGHT = 1.6;

        dates.forEach((line, i) => {
            const rowY = y + (i * (fontSize * LINE_HEIGHT));

            if (line !== '') {
                tX.fillText(line, x + (maxD - tX.measureText(line).width), rowY);
            }

            tX.fillText('|', x + maxD + columnGap, rowY);

            const timeX = x + maxD + columnGap + tX.measureText('|').width + columnGap;
            tX.fillText(times[i], timeX, rowY);

            const eventX = timeX + tX.measureText(times[i]).width + columnGap;
            tX.fillText(events[i] || '', eventX, rowY);
        });

        const link = document.createElement('a');
        link.download = 'Ichtus_Agenda.png';
        link.href = tC.toDataURL('image/png');
        link.click();
    },

    makeDraggable(el) {
        if (!el) return;
        let dragging = false;
        let shiftX = 0, shiftY = 0;
        const pxDisplay = document.getElementById('px-display');

        const startDrag = (clientX, clientY) => {
            dragging = true;
            shiftX = clientX - el.getBoundingClientRect().left;
            shiftY = clientY - el.getBoundingClientRect().top;
        };

        const drag = (clientX, clientY) => {
            if (!dragging) return;
            const rect = document.getElementById('container').getBoundingClientRect();
            let x = Math.round(clientX - rect.left - shiftX);
            let y = Math.round(clientY - rect.top - shiftY);

            el.style.left = x + 'px';
            el.style.top = y + 'px';
            if (pxDisplay) pxDisplay.innerText = `Positie: X=${x}, Y=${y}`;
        };

        el.onmousedown = (e) => {
            if (e.target.contentEditable === 'true') return;
            startDrag(e.clientX, e.clientY);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        function onMouseMove(e) { drag(e.clientX, e.clientY); }
        function onMouseUp() {
            dragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        // Touch support
        el.ontouchstart = (e) => {
            if (e.target.isContentEditable) return;
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchUp);
            e.preventDefault();
        };

        function onTouchMove(ev) {
            drag(ev.touches[0].clientX, ev.touches[0].clientY);
            ev.preventDefault();
        }
        function onTouchUp() {
            dragging = false;
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchUp);
        }
    }
};

// Auto-initialize when view is shown - handled by router