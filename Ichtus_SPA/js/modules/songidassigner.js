/* ============================================================
   SONG ID ASSIGNER MODULE — integrated into Ichtus Workspace SPA
   "Jij kiest de letter, de app kiest het nummer."
   - Library lives in song-id-assigner/library-ids.json
   - Saved/loaded via the local server.py API
   - Import comes from the WorshipTools extension (CustomEvent
     'worshiptools-library', dispatched by spa-bridge.js)
   ============================================================ */

const songidassignerModule = (() => {
    'use strict';

    // ── State ───────────────────────────────────────────────────
    const state = {
        songs: [],              // [{ uid, id, prefix, number, title, artist }]
        pendingImport: [],      // parsed lines awaiting confirmation
        cachedPendingFromExt: [], // queue replayed from extension once the assigner signals ready
        currentFile: 'library-ids.json',
        _initialized: false
    };

    let _uidSeq = 0;
    function newUid() {
        _uidSeq += 1;
        return 's' + _uidSeq + '-' + Date.now().toString(36);
    }
    function ensureUid(s) {
        if (!s) return s;
        if (!s.uid) s.uid = newUid();
        delete s.source;
        return s;
    }

    // ── DOM helper (sa- prefixed) ──────────────────────────────
    const $ = id => document.getElementById('sa-' + id);

    function el(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstElementChild;
    }

    // ── Parsing ────────────────────────────────────────────────
    const PREFIX_RE = /^([A-Za-z]{1,4})\s*(\d{1,4}[A-Za-z]?)(?:\s|-|\.|$)(.*)$/;

    function parseLine(line, extra) {
        const text = String(line || '').trim();
        if (!text) return null;
        const m = text.match(PREFIX_RE);
        if (m && m[1] && m[2]) {
            const prefix = m[1];
            const number = m[2];
            const rest = (m[3] || '').trim();
            const parsed = { prefix, number, id: prefix + number, title: rest || text };
            if (extra && extra.artist) parsed.artist = extra.artist;
            return parsed;
        }
        const parsed = { title: text };
        if (extra && extra.artist) parsed.artist = extra.artist;
        return parsed;
    }

    // ── Numbering ──────────────────────────────────────────────
    function songsForPrefix(prefix) {
        return state.songs.filter(s => s.prefix === prefix);
    }

    function maxNumberFor(prefix) {
        let max = 0;
        for (const s of songsForPrefix(prefix)) {
            const n = parseInt(s.number, 10);
            if (!isNaN(n) && n > max) max = n;
        }
        return max;
    }

    function formatFor(prefix) {
        const existing = songsForPrefix(prefix).map(s => s.number).filter(Boolean);
        if (existing.length === 0) return { width: 3, pad: true };
        const hasPad = existing.some(n => n.length > 1 && n.startsWith('0'));
        const maxLen = Math.min(Math.max(...existing.map(n => n.length)), 3);
        return { width: Math.max(hasPad ? maxLen : 1, 1), pad: hasPad };
    }

    function formatNumber(prefix, num) {
        const fmt = formatFor(prefix);
        const s = String(num);
        return fmt.pad ? s.padStart(fmt.width, '0') : s;
    }

    function nextNumberFor(prefix) {
        let candidate = maxNumberFor(prefix) + 1;
        const taken = new Set(songsForPrefix(prefix).map(s => s.number));
        while (taken.has(formatNumber(prefix, candidate))) {
            candidate++;
        }
        return candidate;
    }

    // ── Duplicate checks ───────────────────────────────────────
    function normalizeTitle(t) {
        return String(t || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
    }

    function songHasTitle(s, norm) {
        return !!s.title && normalizeTitle(s.title) === norm;
    }

    function findSongByTitle(norm, excludeUid, artist) {
        return state.songs.find(s => {
            if (s.uid === excludeUid) return false;
            if (!songHasTitle(s, norm)) return false;
            if (artist && s.artist && s.artist !== artist) return false;
            return true;
        });
    }

    function canonicalId(prefix, number) {
        const num = String(number || '');
        if (/[A-Za-z]/.test(num)) return prefix + num;
        return prefix + formatNumber(prefix, parseInt(num, 10) || 0);
    }

    function findSongById(id) {
        return state.songs.find(s => s.id === id);
    }

    function findDuplicates(prefix, number, title, excludeUid, artist) {
        const issues = [];
        const normalized = normalizeTitle(title);
        const id = canonicalId(prefix, number);
        if (state.songs.some(s => s.id === id)) {
            issues.push('ID ' + id + ' bestaat al');
        }
        if (normalized) {
            const same = findSongByTitle(normalized, excludeUid, artist);
            if (same) {
                issues.push('"' + same.title + '" staat al in de bibliotheek als ' + (same.id || 'zonder ID'));
            }
        }
        return issues;
    }

    // ── Import classifier ──────────────────────────────────────
    function classifyImport(p, ctx) {
        const norm = normalizeTitle(p.title);
        const batchKey = norm + (p.artist ? '\x00' + p.artist.toLowerCase() : '');
        const prev = ctx.seenTitles.get(batchKey);
        if (p.prefix && p.number) {
            const id = canonicalId(p.prefix, p.number);
            const existing = ctx.seenIds.get(id) || findSongById(id);
            if (existing) {
                if (songHasTitle(existing, norm)) {
                    return { bucket: 'dupe', reason: '"' + p.title + '" staat al aan ID ' + existing.id + ' gekoppeld' };
                }
                return { bucket: 'dupe', reason: 'ID ' + existing.id + ' is al in gebruik voor "' + (existing.title || '?') + '" — titel "' + p.title + '" zou een tweede rij met hetzelfde ID veroorzaken' };
            }
            // Same title exists at a DIFFERENT ID — not necessarily a dupe;
            // let the user decide (e.g. "Abba" at H005 vs D083).
            const titleSong = findSongByTitle(norm, null, p.artist) ||
                [...ctx.seenIds.values()].find(s => songHasTitle(s, norm));
            if (titleSong) {
                return { bucket: 'maybe', reason: '"' + p.title + '" bestaat al als ' + titleSong.id + ' — zelfde titel, ander ID. Is dit een dubbel?' };
            }
            if (prev) return { bucket: 'dupe', reason: 'komt al voor in deze import als ' + prev };
            if (!ctx.seenTitles.has(batchKey)) ctx.seenTitles.set(batchKey, id);
            return { bucket: 'withId', id };
        }
        // No ID — same title exists in library. Could be a translation
        // or a different song. Ask the user.
        const libSame = findSongByTitle(norm, null, p.artist) ||
            [...ctx.seenIds.values()].find(s => songHasTitle(s, norm));
        if (libSame) {
            return { bucket: 'maybe', reason: '"' + libSame.title + '" staat al in de bibliotheek als ' + (libSame.id || 'zonder ID') + ' — zelfde titel. Is dit een dubbel?' };
        }
        if (prev) return { bucket: 'dupe', reason: 'komt al voor in deze import als ' + prev };
        if (!ctx.seenTitles.has(batchKey)) ctx.seenTitles.set(batchKey, p.title);
        return { bucket: 'noId' };
    }

    // ── UI Renderers ───────────────────────────────────────────
    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function renderStats() {
        const totalEl = $('stat-total');
        const noidEl = $('stat-noid');
        const prefixEl = $('stat-prefixes');
        const chipsEl = $('stat-chips');
        const countEl = $('lib-count');
        if (!totalEl) return; // module not visible yet

        totalEl.textContent = state.songs.length;
        const noIdCount = state.songs.filter(s => !s.prefix || !s.number).length;
        noidEl.textContent = noIdCount;
        const prefixes = {};
        state.songs.forEach(s => { if (s.prefix) prefixes[s.prefix] = (prefixes[s.prefix] || 0) + 1; });
        const keys = Object.keys(prefixes).sort();
        prefixEl.textContent = keys.length;
        chipsEl.innerHTML = keys.map(k =>
            `<span class="sa-chip">${escapeHtml(k)} &middot; ${escapeHtml(String(prefixes[k]))}</span>`).join('') || '<span class="sa-chip" style="opacity:.5">&mdash;</span>';
        countEl.textContent = state.songs.length;
    }

    function renderPrefixList() {
        const prefixes = [...new Set(state.songs.map(s => s.prefix).filter(Boolean))].sort();
        const dl = $('prefix-list');
        if (!dl) return;
        dl.innerHTML = '';
        prefixes.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            dl.appendChild(opt);
        });
    }

    function renderTable() {
        const searchEl = $('search-input');
        const tbody = $('song-tbody');
        const listEl = $('noid-list');
        if (!tbody || !listEl) return; // not visible

        const q = (searchEl ? searchEl.value : '').toLowerCase();
        const hasId = state.songs.filter(s => s.prefix && s.number);
        const noIdSongs = state.songs.filter(s => !s.prefix || !s.number);
        const matches = s => !q || s.title.toLowerCase().includes(q) ||
            (s.id && s.id.toLowerCase().includes(q)) ||
            (s.artist || '').toLowerCase().includes(q);

        // LEFT column: songs WITH an ID
        const rows = hasId.filter(matches).sort((a, b) => {
            if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
            return (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0);
        });
        tbody.innerHTML = '';
        rows.forEach(s => {
            tbody.appendChild(el(`
                <tr>
                    <td class="sa-id-cell" data-uid="${s.uid}" title="Klik om ID aan te passen">${escapeHtml(s.id)}</td>
                    <td>
                        <div class="sa-song-title">${escapeHtml(s.title)}</div>
                    </td>
                    <td class="sa-artist-cell">${escapeHtml(s.artist || '\u2014')}</td>
                    <td class="sa-row-actions">
                        <button class="sa-btn sa-btn-danger sa-btn-mini" data-del="${s.uid}">\u2715</button>
                    </td>
                </tr>`));
        });
        tbody.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => removeSong(btn.dataset.del));
        });
        tbody.querySelectorAll('.sa-id-cell[data-uid]').forEach(cell => {
            cell.addEventListener('click', () => startEditId(cell));
        });
        const withIdCountEl = $('lib-with-id-count');
        const emptyHintEl = $('empty-hint');
        if (withIdCountEl) withIdCountEl.textContent = rows.length;
        if (emptyHintEl) emptyHintEl.classList.toggle('hidden', hasId.length > 0);

        // RIGHT column: songs WITHOUT an ID
        const noIdFiltered = noIdSongs.filter(matches).sort((a, b) => a.title.localeCompare(b.title));
        listEl.innerHTML = '';
        if (noIdSongs.length === 0) {
            listEl.innerHTML = '<div class="sa-noid-empty">\ud83c\udf89 Alle liederen hebben een ID</div>';
        } else if (noIdFiltered.length === 0) {
            listEl.innerHTML = '<div class="sa-noid-empty">Geen resultaten voor deze zoekopdracht</div>';
        } else {
            noIdFiltered.forEach(s => {
                listEl.appendChild(el(`
                    <div class="sa-noid-row" data-uid="${s.uid}">
                        <div class="sa-noid-row-main">
                            <div class="sa-noid-title">${escapeHtml(s.title)}</div>
                            <div class="sa-noid-sub">${escapeHtml(s.artist || '\u2014')}</div>
                        </div>
                        <input type="text" class="sa-noid-letter" maxlength="4" placeholder="D/H/OK" list="sa-prefix-list" autocomplete="off" title="ID letter, bijv. D, H, OK">
                        <input type="text" class="sa-noid-number" maxlength="6" placeholder="nr" autocomplete="off" title="Nummer + optioneel letter (bijv. 080 of 080E)">
                        <button class="sa-btn sa-btn-accent sa-btn-mini noid-go">Ken toe</button>
                        <button class="sa-btn sa-btn-danger sa-btn-mini" data-del2="${s.uid}">\u2715</button>
                    </div>`));
            });
            listEl.querySelectorAll('[data-del2]').forEach(btn => {
                btn.addEventListener('click', () => removeSong(btn.dataset.del2));
            });
            listEl.querySelectorAll('.sa-noid-row').forEach((rowEl, i) => {
                const song = noIdFiltered[i];
                const letterInput = rowEl.querySelector('.sa-noid-letter');
                const numberInput = rowEl.querySelector('.sa-noid-number');
                const updateNoidPreview = () => {
                    const pfx = letterInput.value.trim().toUpperCase();
                    if (pfx && /^[A-Z]{1,4}$/.test(pfx)) {
                        numberInput.placeholder = String(formatNumber(pfx, nextNumberFor(pfx)));
                    } else {
                        numberInput.placeholder = 'nr';
                    }
                };
                letterInput.addEventListener('input', updateNoidPreview);
                updateNoidPreview();
                const doAssign = () => assignIdToSong(song, letterInput.value.trim().toUpperCase(), numberInput.value.trim());
                rowEl.querySelector('.noid-go').addEventListener('click', doAssign);
                const onEnter = e => { if (e.key === 'Enter') doAssign(); };
                letterInput.addEventListener('keydown', onEnter);
                numberInput.addEventListener('keydown', onEnter);
            });
        }
        const noidCountEl = $('lib-noid-count');
        if (noidCountEl) noidCountEl.textContent = noIdFiltered.length;
    }

    function renderAll() {
        renderStats();
        renderPrefixList();
        renderGaps();
        renderTable();
    }

    function setStatus(msg, kind) {
        const elm = $('status-pill');
        if (!elm) return;
        elm.textContent = msg;
        elm.className = 'sa-status-pill' + (kind ? ' ' + kind : '');
        if (kind === 'ok') setTimeout(() => { elm.textContent = '\u2014'; elm.className = 'sa-status-pill'; }, 2500);
    }

    // ── Assign ID ──────────────────────────────────────────────
    function assignIdToSong(song, prefix, manualNumber) {
        if (!song) return;
        if (song.id) {
            setStatus('\u26a0\ufe0f "' + song.title + '" heeft al een ID (' + song.id + ')', 'err');
            return;
        }
        if (!prefix) { setStatus('\u26a0\ufe0f Kies een letter (bijv. D, H, OK)', 'err'); return; }
        if (!/^[A-Z]{1,4}$/.test(prefix)) {
            setStatus('\u26a0\ufe0f Letter: 1\u20134 letters (bijv. D, H, O, OK, K, LvK)', 'err');
            return;
        }
        const normalized = normalizeTitle(song.title);
        const existingByTitle = findSongByTitle(normalized, song.uid, song.artist);
        if (existingByTitle) {
            setStatus('\u26a0\ufe0f "' + song.title + '" bestaat al als ' + (existingByTitle.id || 'zonder ID'), 'err');
            return;
        }
        let number;
        let manualNumberFormatted;
        if (manualNumber) {
            const trimmed = manualNumber.trim();
            const parsed = parseInt(trimmed, 10);
            if (!isNaN(parsed) && parsed >= 1 && String(parsed) === trimmed) {
                manualNumberFormatted = formatNumber(prefix, parsed);
                number = parsed;
            } else {
                manualNumberFormatted = trimmed;
                number = parsed || 0;
            }
            const taken = state.songs.some(s => s.prefix === prefix && s.number === manualNumberFormatted);
            if (taken) {
                const existing = state.songs.find(s => s.prefix === prefix && s.number === manualNumberFormatted);
                if (!confirm(prefix + manualNumberFormatted + ' is al in gebruik (\u201c' + (existing ? existing.title : '') + '\u201d). Toch opslaan?')) {
                    setStatus('\u26a0\ufe0f Annulering — ' + prefix + manualNumberFormatted + ' niet opgeslagen', 'err');
                    return;
                }
            }
        } else {
            number = nextNumberFor(prefix);
        }
        const id = prefix + (manualNumberFormatted || formatNumber(prefix, number));
        const issues = findDuplicates(prefix, number, song.title, song.uid, song.artist);
        if (issues.length > 0) {
            if (!confirm(issues[0] + '. Toch opslaan?')) {
                setStatus('\u26a0\ufe0f Annulering', 'err');
                return;
            }
        }
        song.prefix = prefix;
        song.number = manualNumberFormatted || formatNumber(prefix, number);
        song.id = id;
        renderAll();
        saveLibrary();
        setStatus('\u2705 ' + id + ' toegekend aan "' + song.title + '"', 'ok');
    }

    // ── Remove song ────────────────────────────────────────────
    function removeSong(uid) {
        const idx = state.songs.findIndex(s => s.uid === uid);
        if (idx === -1) return;
        const s = state.songs[idx];
        const label = s.id ? ' (' + s.id + ')' : ' (zonder ID)';
        if (!confirm('Verwijder "' + s.title + '"' + label + '?')) return;
        state.songs.splice(idx, 1);
        renderAll();
        saveLibrary();
    }

    // ── Inline ID edit ─────────────────────────────────────────
    function startEditId(cell) {
        const uid = cell.dataset.uid;
        const song = state.songs.find(s => s.uid === uid);
        if (!song) return;
        const currentId = song.id || '';
        cell.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sa-id-cell-input';
        input.value = currentId;
        input.maxLength = 10;
        input.title = 'Nieuw ID (bijv. D039, OK149)';
        cell.appendChild(input);
        input.focus();
        input.select();
        const finish = () => saveEditId(cell, input, uid);
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); finish(); }
            if (e.key === 'Escape') { cell.textContent = currentId; }
        });
    }

    function saveEditId(cell, input, uid) {
        const song = state.songs.find(s => s.uid === uid);
        if (!song) return;
        const raw = input.value.trim();
        if (!raw) {
            cell.textContent = song.id || '';
            setStatus('\u26a0\ufe0f ID mag niet leeg zijn', 'err');
            return;
        }
        const parsed = parseLine(raw);
        if (!parsed || !parsed.prefix || !parsed.number) {
            cell.textContent = song.id || '';
            setStatus('\u26a0\ufe0f Ongeldig ID-formaat — gebruik bijv. D039, OK149', 'err');
            return;
        }
        const newId = parsed.id;
        const existing = state.songs.find(s => s.uid !== uid && s.id === newId);
        if (existing) {
            if (!confirm(newId + ' is al in gebruik (\u201c' + existing.title + '\u201d). Toch opslaan?')) {
                cell.textContent = song.id || '';
                setStatus('\u26a0\ufe0f Annulering — ID niet gewijzigd', 'err');
                return;
            }
        }
        song.prefix = parsed.prefix;
        song.number = parsed.number;
        song.id = newId;
        cell.textContent = newId;
        renderStats();
        renderPrefixList();
        saveLibrary();
        setStatus('\u2705 ID gewijzigd naar ' + newId, 'ok');
    }

    // ── Import preview ─────────────────────────────────────────
    function showImportPreview(parsedList) {
        const preview = $('import-preview');
        const list = $('import-preview-list');
        if (!preview || !list) return;
        state.pendingImport = parsedList;
        list.innerHTML = '';
        const prevResult = $('import-result');
        if (prevResult) { prevResult.classList.add('hidden'); prevResult.innerHTML = ''; }

        const buckets = { withId: [], noId: [], dupe: [], maybe: [] };
        const ctx = { seenTitles: new Map(), seenIds: new Map() };
        parsedList.forEach(p => {
            if (!p) return;
            const cls = classifyImport(p, ctx);
            if (cls.bucket === 'withId') {
                ctx.seenIds.set(cls.id, { id: cls.id, title: p.title });
                buckets.withId.push(p);
            } else if (cls.bucket === 'dupe') {
                buckets.dupe.push({ p, reason: cls.reason });
            } else if (cls.bucket === 'maybe') {
                buckets.maybe.push({ p, reason: cls.reason });
            } else {
                buckets[cls.bucket].push(p);
            }
        });

        const renderItem = (p, reason) => {
            const artistPart = p.artist ? ` — <span class="sa-imp-artist">${escapeHtml(p.artist)}</span>` : '';
            const idLabel = p.id ? escapeHtml(p.id) : '<span class="sa-imp-no-id">(geen ID)</span>';
            const reasonPart = reason ? `<span class="sa-imp-dupe">${escapeHtml(reason)}</span>` : '';
            return el(`<div class="sa-imp-line">
                <span class="sa-imp-id">${idLabel}</span>
                <span>${escapeHtml(p.title)}${artistPart}</span>
                ${reasonPart}
            </div>`);
        };

        const col = (title, clsName, items, render) => {
            const c = el(`<div class="sa-imp-col sa-imp-col-${clsName}">
                <h4 class="sa-imp-col-title">${title} <span class="sa-count-badge">${items.length}</span></h4>
            </div>`);
            const body = el('<div class="sa-imp-col-body"></div>');
            if (items.length === 0) body.appendChild(el('<div class="sa-imp-col-empty">\u2014</div>'));
            else items.forEach(i => body.appendChild(render(i)));
            c.appendChild(body);
            return c;
        };

        // "Maybe" column — two checkboxes per item: Overslaan / Toevoegen.
        // Default: nothing checked → skip. They are mutually exclusive.
        const maybeCol = el(`<div class="sa-imp-col sa-imp-col-maybe">
            <h4 class="sa-imp-col-title">\u2753 Mogelijk dubbel <span class="sa-count-badge">${buckets.maybe.length}</span></h4>
            <div class="sa-imp-maybe-hint">Niets aangevinkt = overslaan. Kies er een per lied.</div>
        </div>`);
        const maybeBody = el('<div class="sa-imp-col-body"></div>');
        if (buckets.maybe.length === 0) {
            maybeBody.appendChild(el('<div class="sa-imp-col-empty">\u2014</div>'));
        } else {
            buckets.maybe.forEach(item => {
                const artistPart = item.p.artist ? ` — <span class="sa-imp-artist">${escapeHtml(item.p.artist)}</span>` : '';
                const idLabel = item.p.id ? escapeHtml(item.p.id) : '<span class="sa-imp-no-id">(geen ID)</span>';
                const row = el(`<div class="sa-imp-line sa-imp-maybe-line" data-maybe="1">
                    <div class="sa-imp-maybe-info">
                        <span class="sa-imp-id">${idLabel}</span>
                        <span>${escapeHtml(item.p.title)}${artistPart}</span>
                        <div class="sa-imp-maybe-reason">${escapeHtml(item.reason)}</div>
                    </div>
                    <label class="sa-imp-check-label sa-imp-check-skip" title="Overslaan">
                        <input type="checkbox" class="sa-imp-check sa-maybe-skip-cb">
                        <span>Overslaan</span>
                    </label>
                    <label class="sa-imp-check-label sa-imp-check-add" title="Toevoegen aan bibliotheek">
                        <input type="checkbox" class="sa-imp-check sa-maybe-add-cb">
                        <span>Toevoegen</span>
                    </label>
                </div>`);
                const skipCb = row.querySelector('.sa-maybe-skip-cb');
                const addCb = row.querySelector('.sa-maybe-add-cb');
                skipCb.addEventListener('change', () => { if (skipCb.checked) addCb.checked = false; });
                addCb.addEventListener('change', () => { if (addCb.checked) skipCb.checked = false; });
                maybeBody.appendChild(row);
            });
            // Bulk actions
            const actions = el(`<div class="sa-imp-maybe-actions">
                <button class="sa-btn sa-btn-accent sa-btn-mini sa-maybe-add-all">Alles toevoegen</button>
                <button class="sa-btn sa-btn-secondary sa-btn-mini sa-maybe-skip-all">Alles overslaan</button>
            </div>`);
            actions.querySelector('.sa-maybe-add-all').addEventListener('click', () => {
                maybeBody.querySelectorAll('.sa-imp-maybe-line').forEach(row => {
                    row.querySelector('.sa-maybe-add-cb').checked = true;
                    row.querySelector('.sa-maybe-skip-cb').checked = false;
                });
            });
            actions.querySelector('.sa-maybe-skip-all').addEventListener('click', () => {
                maybeBody.querySelectorAll('.sa-imp-maybe-line').forEach(row => {
                    row.querySelector('.sa-maybe-skip-cb').checked = false;
                    row.querySelector('.sa-maybe-add-cb').checked = false;
                });
            });
            maybeBody.appendChild(actions);
        }
        maybeCol.appendChild(maybeBody);

        list.appendChild(col('\ud83c\udfb5 Met ID', 'withid', buckets.withId, p => renderItem(p)));
        list.appendChild(col('\u2753 Zonder ID', 'noid', buckets.noId, p => renderItem(p)));
        list.appendChild(col('\u26a0\ufe0f Dubbele', 'dupe', buckets.dupe, i => renderItem(i.p, i.reason)));
        list.appendChild(maybeCol);

        preview.classList.remove('hidden');
    }

    function confirmImport() {
        let added = 0, skipped = 0, noId = 0;
        const skippedList = [];
        const ctx = { seenTitles: new Map(), seenIds: new Map() };

        // Read which "maybe" items the user decided to add (checked "Toevoegen")
        const previewList = $('import-preview-list');
        const maybeCol = previewList ? previewList.querySelector('.sa-imp-col-maybe') : null;
        const maybeLines = maybeCol ? [...maybeCol.querySelectorAll('.sa-imp-maybe-line')] : [];
        const maybeCheckedFlags = maybeLines.map(line => line.querySelector('.sa-maybe-add-cb')?.checked === true);

        let maybeIdx = 0;
        for (const p of state.pendingImport) {
            if (!p) continue;
            const cls = classifyImport(p, ctx);
            if (cls.bucket === 'dupe') {
                skipped++;
                skippedList.push({ id: p.id, title: p.title, artist: p.artist, reason: cls.reason });
                continue;
            }
            if (cls.bucket === 'maybe') {
                // Only add if the user checked the box
                if (maybeCheckedFlags[maybeIdx]) {
                    if (p.prefix && p.number) {
                        const number = formatNumber(p.prefix, parseInt(p.number, 10));
                        const song = { uid: newUid(), id: p.prefix + number, prefix: p.prefix, number, title: p.title, artist: p.artist || '' };
                        state.songs.push(song);
                        ctx.seenIds.set(song.id, song);
                    } else {
                        state.songs.push({ uid: newUid(), id: '', prefix: '', number: '', title: p.title, artist: p.artist || '' });
                        noId++;
                    }
                    added++;
                } else {
                    skipped++;
                    skippedList.push({ id: p.id, title: p.title, artist: p.artist, reason: cls.reason });
                }
                maybeIdx++;
                continue;
            }
            if (cls.bucket === 'noId') {
                state.songs.push({ uid: newUid(), id: '', prefix: '', number: '', title: p.title, artist: p.artist || '' });
                noId++;
                added++;
                continue;
            }
            const number = formatNumber(p.prefix, parseInt(p.number, 10));
            const song = { uid: newUid(), id: p.prefix + number, prefix: p.prefix, number, title: p.title, artist: p.artist || '' };
            state.songs.push(song);
            ctx.seenIds.set(song.id, song);
            added++;
        }
        state.pendingImport = [];
        const previewEl = $('import-preview');
        if (previewEl) previewEl.classList.add('hidden');
        renderAll();
        saveLibrary();
        showImportResult(added, noId, skippedList);
        const noIdNote = noId > 0 ? ' (' + noId + ' zonder ID — ken later een letter toe)' : '';
        setStatus('\u2705 Import: ' + added + ' toegevoegd' + noIdNote + ', ' + skipped + ' overgeslagen', 'ok');
    }

    function showImportResult(added, noId, skippedList) {
        const box = $('import-result');
        if (!box) return;
        const skipped = skippedList || [];
        if (skipped.length === 0) {
            box.classList.add('hidden');
            box.innerHTML = '';
            return;
        }
        const parts = [];
        parts.push('\u2705 ' + added + ' toegevoegd');
        if (noId > 0) parts.push(noId + ' zonder ID');
        if (skipped.length > 0) parts.push('\u26a0\ufe0f ' + skipped.length + ' overgeslagen');
        const header = `<div class="sa-ir-header">${parts.join(' \u00b7 ')}</div>`;
        const skippedRows = skipped.map(s => {
            const idLabel = s.id ? escapeHtml(s.id) : '<span class="sa-imp-no-id">(geen ID)</span>';
            const artistPart = s.artist ? ` — <span class="sa-imp-artist">${escapeHtml(s.artist)}</span>` : '';
            return `<div class="sa-ir-line">
                <span class="sa-imp-id">${idLabel}</span>
                <span class="sa-ir-title">${escapeHtml(s.title)}${artistPart}</span>
                <span class="sa-ir-reason">${escapeHtml(s.reason || 'onbekende reden')}</span>
            </div>`;
        }).join('');
        const skippedSection = skipped.length > 0
            ? `<div class="sa-ir-section sa-ir-section-skipped">\u26a0\ufe0f Overgeslagen — zie waarom:</div><div class="sa-ir-list">${skippedRows}</div>`
            : '';
        box.innerHTML =
            header + skippedSection +
            `<button class="sa-btn sa-btn-secondary sa-btn-mini" id="sa-btn-dismiss-import-result">OK</button>`;
        box.classList.remove('hidden');
        const dismiss = box.querySelector('#sa-btn-dismiss-import-result');
        if (dismiss) dismiss.addEventListener('click', () => box.classList.add('hidden'));
    }

    // ── Library config (adaptive path) ────────────────────────
    let _libraryConfig = { libraryPath: '', resolvedPath: '', fileExists: false };

    async function loadLibraryConfig() {
        try {
            const resp = await fetch('/api/library/config');
            const json = await resp.json();
            if (json.success) {
                _libraryConfig = json;
                renderPathDisplay();
                return json;
            }
        } catch (e) { /* first run, no config yet */ }
        _libraryConfig = { libraryPath: '', resolvedPath: '', fileExists: false };
        renderPathDisplay();
        return _libraryConfig;
    }

    async function setLibraryPath(filePath) {
        try {
            const resp = await fetch('/api/library/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ libraryPath: filePath })
            });
            const json = await resp.json();
            if (json.success) {
                _libraryConfig = { libraryPath: json.libraryPath, resolvedPath: json.libraryPath, fileExists: true };
                renderPathDisplay();
                setStatus('\u2705 Bibliotheek gekoppeld aan ' + filePath.split(/[\\/]/).pop(), 'ok');
                return true;
            } else {
                setStatus('\u274c ' + (json.error || 'Kon pad niet opslaan'), 'err');
                return false;
            }
        } catch (e) {
            setStatus('\u274c Server niet bereikbaar', 'err');
            return false;
        }
    }

    function renderPathDisplay() {
        const el = $('file-path');
        const changeBtn = $('btn-change-path');
        const setupHint = $('setup-hint');
        if (!el) return;

        // Always show the button so the user can set/change the location
        if (changeBtn) changeBtn.classList.remove('hidden');

        if (_libraryConfig.libraryPath) {
            // Show friendly path: just filename + parent folder
            let display = _libraryConfig.libraryPath;
            try {
                const parts = display.replace(/\\/g, '/').split('/');
                const fileName = parts.pop();
                const parentFolder = parts.pop() || '';
                display = parentFolder + '/' + fileName;
            } catch (_) { /* keep full path */ }
            el.textContent = display;
            el.title = _libraryConfig.libraryPath;
            el.classList.remove('sa-path-unset');
            changeBtn.textContent = '\ud83d\udd04 Wijzig locatie';
            changeBtn.classList.remove('sa-btn-accent');
            changeBtn.classList.add('sa-btn-secondary');
            if (setupHint) setupHint.classList.add('hidden');
        } else {
            el.textContent = 'Nog niet ingesteld — kies een bestand';
            el.title = '';
            el.classList.add('sa-path-unset');
            changeBtn.textContent = '\ud83d\udcc2 Kies opslaglocatie';
            changeBtn.classList.add('sa-btn-accent');
            changeBtn.classList.remove('sa-btn-secondary');
            if (setupHint) setupHint.classList.remove('hidden');
        }
    }

    function handlePickLibraryLocation() {
        // Build a small inline form so the user can paste/type the path
        // directly — no need for a file picker (browsers can't read the
        // full path from it).
        const existing = $('path-input-form');
        if (existing) { existing.remove(); return; }

        const form = el(`<div class="sa-path-input-form" id="sa-path-input-form">
            <input type="text" class="sa-path-input" id="sa-path-input"
                   placeholder="C:\\Users\\jouw-naam\\OneDrive\\Ichtus\\library-ids.json"
                   value="${escapeHtml(_libraryConfig.libraryPath || '')}">
            <div class="sa-path-input-btns">
                <button class="sa-btn sa-btn-accent sa-btn-mini" id="sa-path-save-btn">Opslaan</button>
                <button class="sa-btn sa-btn-secondary sa-btn-mini" id="sa-path-cancel-btn">Annuleren</button>
            </div>
        </div>`);

        // Insert after the path bar
        const pathBar = document.querySelector('.sa-path-bar');
        if (pathBar && pathBar.parentNode) {
            pathBar.parentNode.insertBefore(form, pathBar.nextSibling);
        } else {
            $('view-songidassigner')?.prepend(form);
        }

        const input = $('path-input');
        input?.focus();
        input?.select();

        $('path-save-btn')?.addEventListener('click', async () => {
            const raw = input?.value.trim();
            if (!raw) { setStatus('\u26a0\ufe0f Voer een pad in', 'err'); return; }
            form.remove();
            const saved = await setLibraryPath(raw);
            if (saved) {
                await loadLibrary();
            }
        });

        $('path-cancel-btn')?.addEventListener('click', () => form.remove());

        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') $('path-save-btn')?.click();
            if (e.key === 'Escape') form.remove();
        });
    }

    // ── Save / Load via server ─────────────────────────────────
    async function saveLibrary() {
        const payload = {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            songs: state.songs,
            file: state.currentFile
        };
        try {
            const resp = await fetch('/api/library/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await resp.json().catch(() => ({}));
            if (json.success) {
                setStatus('\ud83d\udcbe Opgeslagen ' + state.songs.length + ' liederen', 'ok');
            } else {
                setStatus('\u274c Opslaan mislukt', 'err');
            }
        } catch (e) {
            setStatus('\u274c Server niet bereikbaar — start server.py', 'err');
        }
    }

    async function loadLibrary(file) {
        try {
            // If a custom path is configured, always use it (no ?file= override)
            // so the server reads from the configured location.
            const useConfigured = _libraryConfig.libraryPath;
            const url = (!useConfigured && file)
                ? '/api/library/load?file=' + encodeURIComponent(file)
                : '/api/library/load';
            const resp = await fetch(url);
            const json = await resp.json();
            if (json && json.library && Array.isArray(json.library.songs)) {
                state.songs = json.library.songs.map(ensureUid);
                if (json.file) state.currentFile = json.file;
            }
        } catch (e) { /* fresh start */ }
        renderAll();
        updateFileFooter();
    }

    function handleOpenFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                const data = JSON.parse(ev.target.result);
                const songs = data.songs || [];
                state.songs = songs.map(ensureUid);
                state.currentFile = file.name;
                renderAll();
                updateFileFooter();
                setStatus('\ud83d\udcc2 ' + file.name + ' geopend (' + state.songs.length + ' liederen)', 'ok');
            } catch (err) {
                setStatus('\u274c Ongeldig JSON-bestand: ' + err.message, 'err');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    function updateFileFooter() {
        const el = $('footer-file');
        if (!el) return;
        if (_libraryConfig.libraryPath) {
            const parts = _libraryConfig.libraryPath.replace(/\\/g, '/').split('/');
            el.textContent = parts.pop() || state.currentFile;
            el.title = _libraryConfig.libraryPath;
        } else {
            el.textContent = state.currentFile;
            el.title = '';
        }
    }

    // ── File import (.txt / .csv / .json) ──────────────────────
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            const text = ev.target.result;
            let parsed = [];
            if (file.name.toLowerCase().endsWith('.json')) {
                try {
                    const data = JSON.parse(text);
                    const songs = data.songs || data.library?.songs || [];
                    parsed = songs.map(s => {
                        if (s.number && s.name) return parseLine(s.number + ' ' + s.name, { artist: s.artist });
                        if (s.id && s.title) return { id: s.id, prefix: s.prefix, number: s.number, title: s.title, artist: s.artist };
                        if (s.title) return parseLine(s.title, { artist: s.artist });
                        return null;
                    }).filter(Boolean);
                } catch (err) {
                    setStatus('\u274c Ongeldig JSON-bestand: ' + err.message, 'err');
                    return;
                }
            } else {
                parsed = text.split('\n').map(parseLine).filter(Boolean);
            }
            if (parsed.length === 0) {
                setStatus('\u26a0\ufe0f Bestand bevatte geen herkenbare liederegels', 'err');
                return;
            }
            showImportPreview(parsed);
            setStatus('\ud83d\udce5 ' + parsed.length + ' liederen geladen uit ' + file.name, 'ok');
            const preview = $('import-preview');
            if (preview) preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    // ── WorshipTools bridge ────────────────────────────────────
    function onLibraryEvent(e) {
        const songs = e.detail?.songs || e.detail?.library || null;
        const raw = e.detail?.data || null;
        console.log('[SongID] worshiptools-library event, songs:', songs?.length, 'raw:', !!raw);
        let parsed = [];
        if (Array.isArray(songs)) {
            parsed = songs.map(s => {
                if (typeof s === 'string') return parseLine(s);
                if (s.number && s.name) return parseLine(s.number + ' ' + s.name, { artist: s.artist });
                return parseLine(s.title || s.name || '', { artist: s.artist });
            }).filter(Boolean);
        } else if (typeof raw === 'string') {
            parsed = raw.split('\n').map(parseLine).filter(Boolean);
        }
        if (parsed.length === 0) {
            setStatus('\u26a0\ufe0f Lege import ontvangen van extensie', 'err');
            return;
        }
        showImportPreview(parsed);
        setStatus('\ud83d\udce5 ' + parsed.length + ' liederen ontvangen van WorshipTools', 'ok');
        const preview = $('import-preview');
        if (preview) preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ── Pending-IDs queue from the WorshipTools Sync extension ─
    //
    // The extension looks at the setlist against our local library and
    // tells us which songs have no internal ID yet. Each item is either:
    //   • { code: 'O638',     title: 'Tienduizend redenen' }  (had a WT code)
    //   • { code: null,       title: 'Throne Room Song'    }  (no WT code — orphan)
    //
    // We feed them through parseLine() so they enter the existing
    // import pipeline. classifyImport() then automatically buckets them:
    //   • 'withId' → ID-clash-free, ready to import with new ID
    //   • 'noId'   → truly new, user picks a prefix + auto-number
    //   • 'dupe'   → already in the library (visible but won't be added on confirm)
    //   • 'maybe'  → title collision at a different ID (user decides)
    function onPendingSongsEvent(e) {
        const songs = (e.detail && e.detail.songs) || [];
        console.log('[SongID] worshiptools-pending-songs event, count:', songs.length);

        if (!songs.length) {
            // Empty queue — usually means everything got assigned. Don't
            // touch pendingImport (the user might still be reviewing),
            // but show a friendly status so they know things cleared.
            setStatus('\u2705 Geen openstaande IDs meer', 'ok');
            return;
        }

        // Map extension payload → parseLine-compatible lines.
        const parsedList = songs.map(s => {
            const title = s.title || s.name || '';
            if (s.code && title) {
                return parseLine(s.code + ' ' + title);
            }
            return parseLine(title);
        }).filter(Boolean);

        if (parsedList.length === 0) {
            setStatus('\u26a0\ufe0f Lege import ontvangen van extensie', 'err');
            return;
        }

        // Replace any previous pendingImport — the extension's queue is
        // authoritative (single source of truth for what IDs are open).
        showImportPreview(parsedList);
        const dateNote = e.detail && e.detail.date ? ' (dienst ' + e.detail.date + ')' : '';
        setStatus('\ud83d\udce5 ' + parsedList.length + ' openstaande IDs ontvangen' + dateNote + ' — controleer en importeer', 'ok');
        const preview = $('import-preview');
        if (preview) preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ── Gap detection ──────────────────────────────────────────
    function detectGaps() {
        const gaps = {};
        const byPrefix = {};
        state.songs.forEach(s => {
            if (!s.prefix || !s.number) return;
            if (!byPrefix[s.prefix]) byPrefix[s.prefix] = [];
            const n = parseInt(s.number, 10);
            if (!isNaN(n)) byPrefix[s.prefix].push(n);
        });
        const SKIP_PREFIXES = new Set(['O', 'OK']);
        for (const prefix of Object.keys(byPrefix).sort()) {
            if (SKIP_PREFIXES.has(prefix)) continue;
            const nums = [...new Set(byPrefix[prefix])].sort((a, b) => a - b);
            if (nums.length < 2) continue;
            const min = nums[0];
            const max = nums[nums.length - 1];
            const taken = new Set(nums);
            const missing = [];
            for (let i = min + 1; i < max; i++) {
                if (!taken.has(i)) missing.push(i);
            }
            if (missing.length > 0) gaps[prefix] = missing;
        }
        return gaps;
    }

    function renderGaps() {
        const container = $('gaps-container');
        const toggleBtn = $('gaps-toggle');
        const body = $('gaps-body');
        if (!container || !body) return;

        const gaps = detectGaps();
        const totalGaps = Object.values(gaps).reduce((sum, arr) => sum + arr.length, 0);
        const prefixCount = Object.keys(gaps).length;

        const badgeEl = $('gaps-badge');
        if (badgeEl) badgeEl.textContent = totalGaps;

        if (totalGaps === 0) {
            container.classList.add('hidden');
            return;
        }
        container.classList.remove('hidden');

        body.innerHTML = '';
        for (const prefix of Object.keys(gaps).sort()) {
            const nums = gaps[prefix];
            const group = el(`<div class="sa-gap-group"></div>`);
            group.appendChild(el(`<span class="sa-gap-prefix">${escapeHtml(prefix)}</span>`));
            const numsEl = el('<span class="sa-gap-nums"></span>');
            nums.forEach(n => {
                const chip = el(`<span class="sa-gap-chip" title="Klik om te kopiëren" data-copy="${escapeHtml(prefix)}${String(n).padStart(3, '0')}">${String(n).padStart(3, '0')}</span>`);
                chip.addEventListener('click', () => {
                    navigator.clipboard.writeText(chip.dataset.copy).catch(() => {});
                    chip.classList.add('sa-gap-copied');
                    setTimeout(() => chip.classList.remove('sa-gap-copied'), 600);
                });
                numsEl.appendChild(chip);
            });
            group.appendChild(numsEl);
            body.appendChild(group);
        }

        if (toggleBtn) {
            toggleBtn.onclick = () => {
                const collapsed = body.classList.toggle('sa-gap-collapsed');
                toggleBtn.textContent = collapsed ? `\u25B6 ${prefixCount} prefixen, ${totalGaps} gaten` : `\u25BC Gaten sluiten`;
            };
            toggleBtn.textContent = `\u25BC Gaten sluiten`;
        }
    }

    // ── Init (called by router) ────────────────────────────────
    function init() {
        if (state._initialized) {
            // Already bound — just refresh if needed
            renderAll();
            return;
        }
        state._initialized = true;

        $('btn-save')?.addEventListener('click', saveLibrary);
        $('btn-toggle-paste')?.addEventListener('click', () => $('paste-box')?.classList.toggle('hidden'));
        $('btn-import-file')?.addEventListener('click', () => $('file-input')?.click());
        $('file-input')?.addEventListener('change', handleFileSelect);
        $('btn-parse-paste')?.addEventListener('click', () => {
            const input = $('paste-input');
            if (!input) return;
            const lines = input.value.split('\n');
            const parsed = lines.map(parseLine).filter(Boolean);
            if (parsed.length === 0) { setStatus('\u26a0\ufe0f Niets te importeren', 'err'); return; }
            showImportPreview(parsed);
            $('paste-box')?.classList.add('hidden');
        });
        $('btn-confirm-import')?.addEventListener('click', confirmImport);
        $('btn-cancel-import')?.addEventListener('click', () => {
            state.pendingImport = [];
            $('import-preview')?.classList.add('hidden');
        });
        $('btn-wait-wt')?.addEventListener('click', () => {
            setStatus('\u23f3 Wachten op extensie — open WorshipTools en klik "Extract Song Library"', '');
        });
        $('search-input')?.addEventListener('input', renderTable);
        $('btn-open-file')?.addEventListener('click', () => $('open-file-input')?.click());
        $('open-file-input')?.addEventListener('change', handleOpenFile);
        $('btn-change-path')?.addEventListener('click', handlePickLibraryLocation);

        // Extension bridge
        document.addEventListener('worshiptools-library', onLibraryEvent);
        document.addEventListener('worshiptools-pending-songs', onPendingSongsEvent);

        // WebSocket broadcasts from server hub
        document.addEventListener('ws:wt:library', (e) => {
            const d = e.detail || {};
            if (d.songs || d.data) {
                console.log('[SongID] ws:wt:library received, songs:', d.songs?.length || 0);
                onLibraryEvent({ detail: { data: d.data, songs: d.songs } });
            }
        });

        // Load config first, then library
        loadLibraryConfig().then(() => {
            return loadLibrary(state.currentFile);
        }).then(() => {
            document.dispatchEvent(new CustomEvent('ichtus-library-ready'));
            // Signal that the assigner is ready to receive cached pending
            // songs from the extension's bridge. The bridge replays any
            // cached queue through this event so the import preview
            // populates the moment the operator opens the assigner.
            document.dispatchEvent(new CustomEvent('ichtus-assigner-ready'));
        });
    }

    function cleanup() {
        // No persistent timers to stop — module is purely event-driven
    }

    // ── Public API ─────────────────────────────────────────────
    return {
        init,
        cleanup,
        // Expose for testing / external tooling
        _parseLine: parseLine,
        _classifyImport: classifyImport,
        _state: state
    };
})();

// Make globally available for router
window.songidassignerModule = songidassignerModule;
