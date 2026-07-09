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

        // Logical position of the agenda-group in 1920px-coordinate
        // space. Driven by appState so cross-laptop persistence via
        // saveAgenda() carries the operator's chosen place. Fall back to
        // 110/290 so users upgrading from a pre-positioning localStorage
        // blob get the same starting layout they had before.
        if (typeof appState.agenda.logicalX !== 'number') {
            appState.agenda.logicalX = 110;
        }
        if (typeof appState.agenda.logicalY !== 'number') {
            appState.agenda.logicalY = 290;
        }

        // Restore saved image
        const savedImage = localStorage.getItem('ichtus_template');
        if (savedImage) {
            this.img.src = savedImage;
            if (status) status.innerText = __('agenda_template_restored');
        }

        // Wire up the editable X/Y position inputs. They drive
        // appState.agenda.logicalX/Y directly (which then becomes
        // style.left/top via updateElementPercentPosition), so what
        // the operator types here is exactly what shows up in the PNG
        // export. Falls through silently if the markup hasn't been
        // updated yet so older HTML doesn't crash.
        const inputX = document.getElementById('input-x');
        const inputY = document.getElementById('input-y');
        if (inputX) {
            inputX.value = appState.agenda.logicalX;
            inputX.addEventListener('input', () => {
                const v = parseInt(inputX.value, 10);
                appState.agenda.logicalX = Number.isFinite(v) ? v : 0;
                this.updateElementPercentPosition();
                saveAgenda();
            });
        }
        if (inputY) {
            inputY.value = appState.agenda.logicalY;
            inputY.addEventListener('input', () => {
                const v = parseInt(inputY.value, 10);
                appState.agenda.logicalY = Number.isFinite(v) ? v : 0;
                this.updateElementPercentPosition();
                saveAgenda();
            });
        }

        // Mirror the logical position into the legacy text-only display
        // when the new X/Y inputs aren't present. With the inputs in
        // place this text is replaced by the editable controls.
        if (pxDisplay && !inputX && !inputY) {
            pxDisplay.innerText = `Positie: X=${appState.agenda.logicalX}, Y=${appState.agenda.logicalY}`;
        }

        // Position the agenda-group: convert the logical px position to
        // a CSS percentage of the canvas's intrinsic dimensions, then
        // let applyScaleForCanvas() handle the visual scale. The
        // percentage anchor means the group sits at the SAME
        // proportional spot regardless of how big the canvas is
        // rendered on screen.
        this.updateElementPercentPosition();

        // Make the agenda-group scale to fit the displayed canvas. Without
        // this, the columns (font-size 34px + 25px gap + nowrap) total
        // ~1065px wide for 6 typical events and the rightmost portion is
        // clipped by `#container`'s `overflow: hidden` once CSS scales the
        // 1920px canvas down to its ~768-800px display width. Pure scale
        // now -- no translate() nudge -- because percent positioning makes
        // the visual position proportional to the logical position
        // directly (WYSIWYG; what you see here matches the PNG export).
        this.applyScaleForCanvas();

        // Image load handler
        this.img.onload = () => {
            if (!canvas || !ctx) return;
            canvas.width = 1920;
            canvas.height = this.img.height * (1920 / this.img.width);
            ctx.drawImage(this.img, 0, 0, canvas.width, canvas.height);

            // Re-anchor the agenda-group's percent-based left/top against
            // the REAL nativeHeight now that the image has loaded (so
            // non-1080-tall templates like 16:10 at 1200px get the
            // correct vertical percentage, not the pre-load 1080 fallback
            // used when this.img.height was still 0).
            this.updateElementPercentPosition();

            // Re-scale the agenda-group now that the canvas has its
            // intrinsic 1920px width; offsetWidth updates from the prior
            // (likely empty/placeholder) value to the new display width.
            this.applyScaleForCanvas();
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

        // Keep the agenda-group scaled to fit the displayed canvas as the
        // user resizes the browser window (canvas.offsetWidth changes).
        window.addEventListener('resize', () => this.applyScaleForCanvas());

        this.initialized = true;
    },

    /**
     * Scale the agenda-group so its logical 1920px-coordinate layout fits
     * inside the visually-scaled canvas. Scale = canvas.offsetWidth / 1920,
     * so a 768px-wide display yields scale = 0.4 — making a 1065px-wide
     * logical group render at ~426px and stay inside `#container` instead
     * of being clipped by `overflow: hidden`. `transform-origin: top left`
     * is set in CSS so the group's own top-left corner is the anchor; the
     * default (110, 290) pixel offsets land at the visually equivalent
     * position within the rendered image.
     *
     * Called from init() (initial draw), img.onload (canvas dimensions
     * change), and on window resize. Idempotent and safe to re-run.
     */
    applyScaleForCanvas() {
        const canvas = document.getElementById('canvas');
        const agendaGroup = document.getElementById('agenda-group');
        if (!canvas || !agendaGroup) return;
        const displayW = canvas.offsetWidth;
        if (!displayW) return;
        const scale = displayW / 1920;
        // Pure scale: percent positioning on style.left/top (set by
        // updateElementPercentPosition) carries the WYSIWYG relationship
        // between logicalX/Y and the on-screen position. A previous
        // revision used `translate(0px, -210px) scale(N)` to visually
        // nudge the text up the template, but that workaround is no
        // longer needed once the agenda-group's left/top are expressed as
        // percentage of the canvas's intrinsic dimensions -- WYSIWYG is
        // achieved by direct logical-to-pixel mapping, so pure `scale(N)`
        // (no translate) is correct here.
        agendaGroup.style.transform = `scale(${scale})`;
    },

    /**
     * Convert the persisted logicalX/Y (intrinsic-canvas px) to CSS
     * percentage, then write them to style.left/top. Anchors the
     * agenda-group at the SAME proportional spot regardless of how the
     * browser has scaled the canvas for display, so dragging the group
     * (which stores native px back into appState.agenda.logicalX/Y)
     * immediately moves it visually without any rect math, and the PNG
     * export can read logicalX/Y directly without undoing a transform.
     *
     * Falls back to 1920x1080 dims when the image hasn't loaded yet so
     * the first paint sits at the user's stored coordinates; the
     * onload handler re-runs this method with the REAL nativeHeight so
     * non-1080-tall templates (e.g. 16:10 at 1200px) re-anchor their
     * percentages correctly.
     */
    updateElementPercentPosition() {
        const agendaGroup = document.getElementById('agenda-group');
        if (!agendaGroup) return;
        const logicalX = appState.agenda.logicalX;
        const logicalY = appState.agenda.logicalY;
        const nativeWidth = 1920;
        const nativeHeight = (this.img && this.img.height)
            ? this.img.height * (nativeWidth / this.img.width)
            : 1080;
        const pctX = (logicalX / nativeWidth)  * 100;
        const pctY = (logicalY / nativeHeight) * 100;
        agendaGroup.style.left = pctX + '%';
        agendaGroup.style.top  = pctY + '%';
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

        // Read the PNG draw position straight from the persisted
        // logical coordinates (the same numbers the X/Y input shows the
        // operator and that drag updates). With percent-based
        // style.left/top + pure scale (no translate() nudge), the visual
        // on-screen position is exactly logicalX/Y * scale, so when
        // scaled back to intrinsic px we land at logicalX/Y + the
        // agenda-group's own padding. WYSIWYG: what the operator sees
        // moving while they drag is what the PNG export will draw.
        const x = appState.agenda.logicalX + paddingLeft;
        const y = appState.agenda.logicalY + paddingTop;

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
        const inputXEl = document.getElementById('input-x');
        const inputYEl = document.getElementById('input-y');
        const pxDisplayEl = document.getElementById('px-display');

        // applyScaleForCanvas() sets `el.style.transform = scale(N)`,
        // where N = canvas.offsetWidth / 1920. Visual-to-logical must
        // divide the same factor so the persisted logical pixel stays
        // in the 1920px-coordinate space (i.e. the same space
        // downloadImage() reads back when rendering the PNG AND the
        // same space the X/Y input shows the operator). Without this
        // division, the drag would only operate on the visually-scaled
        // pixel delta and the agenda-group would visually drift as the
        // user drags.
        const currentScale = () => {
            const canvas = document.getElementById('canvas');
            if (!canvas || !canvas.offsetWidth) return 1;
            return canvas.offsetWidth / 1920;
        };

        const nativeHeightForDrag = () => (agendaModule.img && agendaModule.img.height)
            ? agendaModule.img.height * (1920 / agendaModule.img.width)
            : 1080;

        const startDrag = (clientX, clientY) => {
            dragging = true;
            // Visual feedback during drag (opacity 0.85 on .column via
            // the `#view-agenda #agenda-group.dragging .column` rule).
            // The standalone toggles this class; the SPA's makeDraggable
            // dropped it -- restoring here so the operator sees the
            // dragged state.
            el.classList.add('dragging');
            const scale = currentScale();
            shiftX = (clientX - el.getBoundingClientRect().left) / scale;
            shiftY = (clientY - el.getBoundingClientRect().top) / scale;
        };

        const drag = (clientX, clientY) => {
            if (!dragging) return;
            const scale = currentScale();
            const rect = document.getElementById('container').getBoundingClientRect();
            let x = Math.round((clientX - rect.left) / scale - shiftX);
            let y = Math.round((clientY - rect.top) / scale - shiftY);

            // Clamp to the canvas's intrinsic bounds so a wild drag
            // can't park the group off-canvas. The right/bottom clamps
            // leave about 50 / 30 px of breathing room so the user can
            // still see the bottom-right corner of the group.
            const nativeWidth = 1920;
            const h = nativeHeightForDrag();
            x = Math.max(0, Math.min(x, nativeWidth - 50));
            y = Math.max(0, Math.min(y, h - 30));

            // Persist to appState so downloadImage() and the X/Y inputs
            // see the same value, then mirror to DOM (percent anchor via
            // updateElementPercentPosition + the live X/Y input fields).
            // No localStorage write on every mousemove: chunked drag can
            // fire dozens of px-per-second; the stop handler is the
            // single canonical save point (the X/Y input "input" handler
            // handles the keystroke case separately).
            appState.agenda.logicalX = x;
            appState.agenda.logicalY = y;
            agendaModule.updateElementPercentPosition();
            if (inputXEl) inputXEl.value = x;
            if (inputYEl) inputYEl.value = y;
            if (pxDisplayEl && !inputXEl && !inputYEl) {
                pxDisplayEl.innerText = `Positie: X=${x}, Y=${y}`;
            }
        };

        const stopDrag = () => {
            // Cleanup FIRST (and unconditionally) so a throw bubbling out
            // of saveAgenda() below cannot strand the drag handler in a
            // half-state: a throw previously skipped both
            // `el.classList.remove('dragging')` (cursor stuck at
            // 'grabbing', columns stuck at opacity 0.85) and the four
            // removeEventListener calls (next mousedown then compounded
            // a fresh pair of mousemove/mouseup listeners on top of
            // the un-removed pair until reload). removeEventListener is
            // idempotent against unregistered listeners, so the always-
            // run path is safe even on re-entry (a stray second stopDrag
            // after the first has already cleaned up).
            el.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup',   onMouseUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend',  onTouchUp);

            // Nothing to persist if we weren't actually dragging (the
            // cleanup above already did its job on a re-entry).
            if (!dragging) return;
            dragging = false;

            // Persist at the canonical stop point (not on every
            // mousemove; the keystroke "input" handler is a separate
            // path that already persists on its own). Wrapped in
            // try/catch so a localStorage quota throw (or any other
            // save failure) is absorbed rather than bubbling up the
            // browser's mouseup handler chain.
            try {
                saveAgenda();
            } catch (e) {
                console.warn('saveAgenda failed at drag stop:', e);
            }
        };

        const onMouseMove = (e) => drag(e.clientX, e.clientY);
        const onMouseUp   = () => stopDrag();
        const onTouchMove = (ev) => {
            drag(ev.touches[0].clientX, ev.touches[0].clientY);
            ev.preventDefault();
        };
        const onTouchUp   = () => stopDrag();

        el.onmousedown = (e) => {
            if (e.target.contentEditable === 'true') return;
            startDrag(e.clientX, e.clientY);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup',   onMouseUp);
        };

        // Touch support
        el.ontouchstart = (e) => {
            if (e.target.isContentEditable) return;
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend',  onTouchUp);
            e.preventDefault();
        };
    }
};

// Auto-initialize when view is shown - handled by router
