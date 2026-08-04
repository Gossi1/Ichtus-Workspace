/* ============================================================
   SONG ID ASSIGNER — core logic
   "Jij kiest de letter, de app kiest het nummer."
   - Library lives in song-id-assigner/library-ids.json
   - Saved/loaded via the local server.py API
   - Import comes from the WorshipTools extension (CustomEvent
     'worshiptools-library', dispatched by spa-bridge.js)
   ============================================================ */

(function () {
    'use strict';

    const state = {
        songs: [],          // [{ uid, id, prefix, number, title, artist }]
        pendingImport: [],  // parsed lines awaiting confirmation
        currentFile: 'library-ids.json'  // active JSON file
    };

    // Every song gets a uid so rows WITHOUT an ID can still be found for
    // delete / assign. Persisted via the server; regenerated for legacy
    // entries that lack one.
    let _uidSeq = 0;
    function newUid() {
        _uidSeq += 1;
        return 's' + _uidSeq + '-' + Date.now().toString(36);
    }
    function ensureUid(s) {
        if (!s) return s;
        if (!s.uid) s.uid = newUid();
        delete s.source; // 'bron' is weg — legacy veld opschonen bij het laden
        return s;
    }

    // ----------------------------------------------------------
    //  PARSING — prefix + number from a song title
    // ----------------------------------------------------------
    // "D044 Great I Am"  -> { prefix: "D", number: "044", title: "Great I Am", id: "D044" }
    // "LvK 9 ..."        -> { prefix: "LvK", number: "9", ... }
    // "Great I Am"       -> { title: "Great I Am" } (no id)
    const PREFIX_RE = /^([A-Za-z]{1,4})\s*(\d{1,4}[A-Za-z]?)(?:\s|-|\.|$)(.*)$/;

    function parseLine(line, extra) {
        const text = String(line || '').trim();
        if (!text) return null;
        const m = text.match(PREFIX_RE);
        if (m && m[1] && m[2]) {
            const prefix = m[1]; // keep original case ("LvK", "D")
            const number = m[2];
            const rest = (m[3] || '').trim();
            const parsed = {
                prefix,
                number,
                id: prefix + number,
                title: rest || text
            };
            if (extra && extra.artist) parsed.artist = extra.artist;
            return parsed;
        }
        const parsed = { title: text };
        if (extra && extra.artist) parsed.artist = extra.artist;
        return parsed;
    }

    // ----------------------------------------------------------
    //  NUMBERING — "hoogste + 1", keep per-prefix number format
    // ----------------------------------------------------------
    function songsForPrefix(prefix) {
        return state.songs.filter(s => s.prefix === prefix);
    }

    /** Highest number used for a prefix (0 if none) */
    function maxNumberFor(prefix) {
        let max = 0;
        for (const s of songsForPrefix(prefix)) {
            const n = parseInt(s.number, 10);
            if (!isNaN(n) && n > max) max = n;
        }
        return max;
    }

    /**
     * Detect the number format a prefix already uses, so new numbers
     * match: "D044" -> 3 digits zero-padded; "LvK 9" -> no padding.
     * Falls back to 3-digit padding for a brand-new prefix.
     */
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

    /**
     * Next free number for a prefix = highest + 1, skipping any
     * number whose full ID is already taken.
     */
    function nextNumberFor(prefix) {
        let candidate = maxNumberFor(prefix) + 1;
        const taken = new Set(songsForPrefix(prefix).map(s => s.number));
        while (taken.has(formatNumber(prefix, candidate))) {
            candidate++;
        }
        return candidate;
    }

    // ----------------------------------------------------------
    //  DUPLICATE CHECK — same song (normalized title) or same ID
    // ----------------------------------------------------------
    function normalizeTitle(t) {
        return String(t || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
    }

    /** True if the song's (single) title matches the normalized title. */
    function songHasTitle(s, norm) {
        return !!s.title && normalizeTitle(s.title) === norm;
    }

    /** First library song whose title matches (optionally excluding a uid).
     *  If artist is provided and both songs have an artist, only match when they
     *  are the same — so "Holy Spirit" by Bryan Torwalt ≠ "Holy Spirit" by LaRue. */
    function findSongByTitle(norm, excludeUid, artist) {
        return state.songs.find(s => {
            if (s.uid === excludeUid) return false;
            if (!songHasTitle(s, norm)) return false;
            // If both have an artist and they differ, it's a different song
            if (artist && s.artist && s.artist !== artist) return false;
            return true;
        });
    }

    /** Canonical ID (prefix + per-prefix formatted number), e.g. "D044" for D+44. */
    function canonicalId(prefix, number) {
        const num = String(number || '');
        // If number contains a letter suffix (e.g. "080E"), keep it as-is
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

        // Same ID already used?
        if (state.songs.some(s => s.id === id)) {
            issues.push('ID ' + id + ' bestaat al');
        }
        // Same song (by title + artist) already in library?
        if (normalized) {
            const same = findSongByTitle(normalized, excludeUid, artist);
            if (same) {
                issues.push('"' + same.title + '" staat al in de bibliotheek als ' + (same.id || 'zonder ID'));
            }
        }
        return issues;
    }

    // ----------------------------------------------------------
    //  UI
    // ----------------------------------------------------------
    const $ = id => document.getElementById(id);

    function el(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstElementChild;
    }

    function renderStats() {
        $('stat-total').textContent = state.songs.length;
        const noIdCount = state.songs.filter(s => !s.prefix || !s.number).length;
        $('stat-noid').textContent = noIdCount;
        const prefixes = {};
        state.songs.forEach(s => { if (s.prefix) prefixes[s.prefix] = (prefixes[s.prefix] || 0) + 1; });
        const keys = Object.keys(prefixes).sort();
        $('stat-prefixes').textContent = keys.length;
        $('stat-chips').innerHTML = keys.map(k =>
            `<span class="chip">${escapeHtml(k)} &middot; ${escapeHtml(String(prefixes[k]))}</span>`).join('') || '<span class="chip" style="opacity:.5">&mdash;</span>';
        $('lib-count').textContent = state.songs.length;
    }

    function renderPrefixList() {
        const prefixes = [...new Set(state.songs.map(s => s.prefix).filter(Boolean))].sort();
        const dl = $('prefix-list');
        dl.innerHTML = '';
        prefixes.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            dl.appendChild(opt);
        });
    }

    function renderTable() {
        const q = ($('search-input').value || '').toLowerCase();
        const hasId = state.songs.filter(s => s.prefix && s.number);
        const noIdSongs = state.songs.filter(s => !s.prefix || !s.number);
        const matches = s => !q || s.title.toLowerCase().includes(q) ||
            (s.id && s.id.toLowerCase().includes(q)) ||
            (s.artist || '').toLowerCase().includes(q);

        // -- LEFT column: songs WITH an ID (table) --
        const rows = hasId.filter(matches).sort((a, b) => {
            if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
            return (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0);
        });
        const tbody = $('song-tbody');
        tbody.innerHTML = '';
        rows.forEach(s => {
            tbody.appendChild(el(`
                <tr>
                    <td class="id-cell" data-uid="${s.uid}" title="Klik om ID aan te passen">${escapeHtml(s.id)}</td>
                    <td>
                        <div class="song-title">${escapeHtml(s.title)}</div>
                    </td>
                    <td class="artist-cell">${escapeHtml(s.artist || '\u2014')}</td>
                    <td class="row-actions">
                        <button class="btn btn-danger btn-mini" data-del="${s.uid}">\u2715</button>
                    </td>
                </tr>`));
        });
        tbody.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => removeSong(btn.dataset.del));
        });
        tbody.querySelectorAll('.id-cell[data-uid]').forEach(cell => {
            cell.addEventListener('click', () => startEditId(cell));
        });
        // Badge shows the FILTERED rows so it matches what's visible during a search.
        $('lib-with-id-count').textContent = rows.length;
        $('empty-hint').classList.toggle('hidden', hasId.length > 0);

        // -- RIGHT column: songs WITHOUT an ID (assign list) --
        const noIdFiltered = noIdSongs.filter(matches).sort((a, b) => a.title.localeCompare(b.title));
        const listEl = $('noid-list');
        listEl.innerHTML = '';
        if (noIdSongs.length === 0) {
            listEl.innerHTML = '<div class="noid-empty">\ud83c\udf89 Alle liederen hebben een ID</div>';
        } else if (noIdFiltered.length === 0) {
            listEl.innerHTML = '<div class="noid-empty">Geen resultaten voor deze zoekopdracht</div>';
        } else {
            noIdFiltered.forEach(s => {
                listEl.appendChild(el(`
                    <div class="noid-row" data-uid="${s.uid}">
                        <div class="noid-row-main">
                            <div class="noid-title">${escapeHtml(s.title)}</div>
                            <div class="noid-sub">${escapeHtml(s.artist || '\u2014')}</div>
                        </div>
                        <input type="text" class="noid-letter" maxlength="4" placeholder="D/H/OK" list="prefix-list" autocomplete="off" title="ID letter, bijv. D, H, OK">
                        <input type="text" class="noid-number" maxlength="6" placeholder="nr" autocomplete="off" title="Nummer + optioneel letter (bijv. 080 of 080E)">
                        <button class="btn btn-accent btn-mini noid-go">Ken toe</button>
                        <button class="btn btn-danger btn-mini" data-del2="${s.uid}">\u2715</button>
                    </div>`));
            });
            listEl.querySelectorAll('[data-del2]').forEach(btn => {
                btn.addEventListener('click', () => removeSong(btn.dataset.del2));
            });
            listEl.querySelectorAll('.noid-row').forEach((rowEl, i) => {
                const song = noIdFiltered[i];
                const letterInput = rowEl.querySelector('.noid-letter');
                const numberInput = rowEl.querySelector('.noid-number');
                // Auto-fill number placeholder when prefix changes
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
        // Badge shows the FILTERED rows so it matches what's visible during a search.
        $('lib-noid-count').textContent = noIdFiltered.length;
    }

    /**
     * Assign an ID to a stored song that has none yet (right column).
     * The operator picks the letter; the app picks the next free number,
     * OR the operator can type a specific number to use instead.
     */
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
        // Same song already has an ID somewhere? Then don't create a second.
        const normalized = normalizeTitle(song.title);
        const existingByTitle = findSongByTitle(normalized, song.uid, song.artist);
        if (existingByTitle) {
            setStatus('\u26a0\ufe0f "' + song.title + '" bestaat al als ' + (existingByTitle.id || 'zonder ID'), 'err');
            return;
        }
        // Determine number: manual input or auto highest +1
        let number;
        let manualNumberFormatted;
        if (manualNumber) {
            // Accept any non-empty value as the number (letters allowed)
            const trimmed = manualNumber.trim();
            // Try numeric first for auto-formatting
            const parsed = parseInt(trimmed, 10);
            if (!isNaN(parsed) && parsed >= 1 && String(parsed) === trimmed) {
                // Pure numeric input — use formatNumber
                manualNumberFormatted = formatNumber(prefix, parsed);
                number = parsed;
            } else {
                // Non-numeric or mixed input (e.g. "039", "A", "12a") — use as-is
                manualNumberFormatted = trimmed;
                number = parsed || 0;
            }
            const taken = state.songs.some(s => s.prefix === prefix && s.number === manualNumberFormatted);
            if (taken) {
                const existing = state.songs.find(s => s.prefix === prefix && s.number === manualNumberFormatted);
                if (!confirm(prefix + manualNumberFormatted + ' is al in gebruik (\u201c' + (existing ? existing.title : '') + '\u201d). Toch opslaan?')) {
                    setStatus('\u26a0\ufe0f Annulering \u2014 ' + prefix + manualNumberFormatted + ' niet opgeslagen', 'err');
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

    function renderAll() {
        renderStats();
        renderPrefixList();
        renderTable();
    }

    function setStatus(msg, kind) {
        const elm = $('save-status');
        elm.textContent = msg;
        elm.className = 'header-status' + (kind ? ' ' + kind : '');
        if (kind === 'ok') setTimeout(() => { elm.textContent = '\u2014'; elm.className = 'header-status'; }, 2500);
    }

    function escapeHtml(t) {
        const d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    // ----------------------------------------------------------
    //  REMOVE SONG
    // ----------------------------------------------------------
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

    function startEditId(cell) {
        const uid = cell.dataset.uid;
        const song = state.songs.find(s => s.uid === uid);
        if (!song) return;
        const currentId = song.id || '';
        cell.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'id-cell-input';
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
            // Empty — remove ID
            cell.textContent = song.id || '';
            setStatus('\u26a0\ufe0f ID mag niet leeg zijn', 'err');
            return;
        }
        const parsed = parseLine(raw);
        if (!parsed || !parsed.prefix || !parsed.number) {
            cell.textContent = song.id || '';
            setStatus('\u26a0\ufe0f Ongeldig ID-formaat \u2014 gebruik bijv. D039, OK149', 'err');
            return;
        }
        const newPrefix = parsed.prefix;
        const newNumber = parsed.number;
        const newId = parsed.id;
        // Check if this ID is already taken by another song
        const existing = state.songs.find(s => s.uid !== uid && s.id === newId);
        if (existing) {
            if (!confirm(newId + ' is al in gebruik (\u201c' + existing.title + '\u201d). Toch opslaan?')) {
                cell.textContent = song.id || '';
                setStatus('\u26a0\ufe0f Annulering \u2014 ID niet gewijzigd', 'err');
                return;
            }
        }
        // Update the song
        song.prefix = newPrefix;
        song.number = newNumber;
        song.id = newId;
        cell.textContent = newId;
        renderStats();
        renderPrefixList();
        saveLibrary();
        setStatus('\u2705 ID gewijzigd naar ' + newId, 'ok');
    }

    // ----------------------------------------------------------
    //  IMPORT (from extension event)
    // ----------------------------------------------------------
    /**
     * Classify one parsed import item into a bucket:
     *   'withId' -> has a brand-new prefix+number, no conflict anywhere -- goes
     *              to the left column. BOTH the ID and the title must be free
     *              for this; any conflict (same ID or same title) is a 'dupe'.
     *   'noId'   -> no ID yet AND no title conflict -- stored for later
     *              assignment (right column).
     *   'dupe'   -> any of: same ID + same title; same ID + different title
     *              (would create a duplicate-ID row); same title under another
     *              ID; same (title, artist) seen earlier in this batch.
     * ctx = { seenTitles: Map, seenIds: Map } is shared across the batch so
     * batch-internal duplicates AND same-title-different-artist entries are
     * both caught correctly.
     */
    function classifyImport(p, ctx) {
        const norm = normalizeTitle(p.title);
        // Use title+artist as batch-dedup key so same-title different-artist
        // songs (e.g. "Holy Spirit" by two artists) are both accepted.
        const batchKey = norm + (p.artist ? '\x00' + p.artist.toLowerCase() : '');
        const prev = ctx.seenTitles.get(batchKey);
        if (p.prefix && p.number) {
            const id = canonicalId(p.prefix, p.number);
            // Existing song with this ID (batch claim first, then library -- the
            // batch claim shadows the library so repeated translations in one
            // batch are seen as dupes instead of stacking alt entries).
            const existing = ctx.seenIds.get(id) || findSongById(id);
            if (existing) {
                // Dupe rule: BOTH the ID and the title must agree before we accept
                // this as a clean re-import. Either conflict -> dupe, so two songs
                // never end up sharing an ID and a title can never be silently
                // claimed under a second ID.
                if (songHasTitle(existing, norm)) {
                    return { bucket: 'dupe', reason: '"' + p.title + '" staat al aan ID ' + existing.id + ' gekoppeld' };
                }
                return { bucket: 'dupe', reason: 'ID ' + existing.id + ' is al in gebruik voor "' + (existing.title || '?') + '" \u2014 titel "' + p.title + '" zou een tweede rij met hetzelfde ID veroorzaken' };
            }
            // New ID -- but this title already exists somewhere (lib or batch)?
            // Use findSongByTitle with artist so same-title different-artist
            // songs (e.g. "Holy Spirit" by two artists) are not flagged as dupes.
            const titleSong = findSongByTitle(norm, null, p.artist) ||
                [...ctx.seenIds.values()].find(s => songHasTitle(s, norm));
            if (titleSong) {
                return { bucket: 'dupe', reason: '"' + p.title + '" bestaat al als ' + titleSong.id };
            }
            if (prev) return { bucket: 'dupe', reason: 'komt al voor in deze import als ' + prev };
            if (!ctx.seenTitles.has(batchKey)) ctx.seenTitles.set(batchKey, id);
            return { bucket: 'withId', id };
        }
        // No ID yet -- check the library by title, then batch.
        const libSame = findSongByTitle(norm, null, p.artist) ||
            [...ctx.seenIds.values()].find(s => songHasTitle(s, norm));
        if (libSame) {
            return { bucket: 'dupe', reason: '"' + libSame.title + '" staat al in de bibliotheek als ' + (libSame.id || 'zonder ID') };
        }
        if (prev) return { bucket: 'dupe', reason: 'komt al voor in deze import als ' + prev };
        if (!ctx.seenTitles.has(batchKey)) ctx.seenTitles.set(batchKey, p.title);
        return { bucket: 'noId' };
    }

    function showImportPreview(parsedList) {
        const preview = $('import-preview');
        const list = $('import-preview-list');
        state.pendingImport = parsedList;
        list.innerHTML = '';
        // A fresh import supersedes the previous result panel.
        const prevResult = $('import-result');
        if (prevResult) { prevResult.classList.add('hidden'); prevResult.innerHTML = ''; }

        // Bucket every item once so the preview shows the same split the
        // import will apply: met ID / zonder ID / dubbele.
        const buckets = { withId: [], noId: [], dupe: [] };
        const ctx = { seenTitles: new Map(), seenIds: new Map() };
        parsedList.forEach(p => {
            if (!p) return;
            const cls = classifyImport(p, ctx);
            if (cls.bucket === 'withId') {
                ctx.seenIds.set(cls.id, { id: cls.id, title: p.title });
                buckets.withId.push(p);
            } else if (cls.bucket === 'dupe') {
                buckets.dupe.push({ p, reason: cls.reason });
            } else {
                buckets[cls.bucket].push(p);
            }
        });

        const renderItem = (p, reason) => {
            const artistPart = p.artist ? ` \u2014 <span class="imp-artist">${escapeHtml(p.artist)}</span>` : '';
            const idLabel = p.id ? escapeHtml(p.id) : '<span class="imp-no-id">(geen ID)</span>';
            const reasonPart = reason ? `<span class="imp-dupe">${escapeHtml(reason)}</span>` : '';
            return el(`<div class="imp-line">
                <span class="imp-id">${idLabel}</span>
                <span>${escapeHtml(p.title)}${artistPart}</span>
                ${reasonPart}
            </div>`);
        };

        const col = (title, clsName, items, render) => {
            const c = el(`<div class="imp-col imp-col-${clsName}">
                <h4 class="imp-col-title">${title} <span class="count-badge">${items.length}</span></h4>
            </div>`);
            const body = el('<div class="imp-col-body"></div>');
            if (items.length === 0) body.appendChild(el('<div class="imp-col-empty">\u2014</div>'));
            else items.forEach(i => body.appendChild(render(i)));
            c.appendChild(body);
            return c;
        };

        list.appendChild(col('\ud83c\udfb5 Met ID', 'withid', buckets.withId, p => renderItem(p)));
        list.appendChild(col('\u2753 Zonder ID', 'noid', buckets.noId, p => renderItem(p)));
        list.appendChild(col('\u26a0\ufe0f Dubbele', 'dupe', buckets.dupe, i => renderItem(i.p, i.reason)));

        preview.classList.remove('hidden');
    }

    function confirmImport() {
        let added = 0, skipped = 0, noId = 0;
        const skippedList = [];   // [{ id, title, artist, reason }]
        // Same classifier + ctx as the preview, so what you see is what gets added.
        const ctx = { seenTitles: new Map(), seenIds: new Map() };
        for (const p of state.pendingImport) {
            if (!p) continue;
            const cls = classifyImport(p, ctx);
            if (cls.bucket === 'dupe') {
                skipped++;
                skippedList.push({ id: p.id, title: p.title, artist: p.artist, reason: cls.reason });
                continue;
            }
            if (cls.bucket === 'noId') {
                state.songs.push({ uid: newUid(), id: '', prefix: '', number: '', title: p.title, artist: p.artist || '' });
                noId++;
                added++;
                continue;
            }
            // withId
            const number = formatNumber(p.prefix, parseInt(p.number, 10));
            const song = { uid: newUid(), id: p.prefix + number, prefix: p.prefix, number, title: p.title, artist: p.artist || '' };
            state.songs.push(song);
            ctx.seenIds.set(song.id, song);
            added++;
        }
        state.pendingImport = [];
        $('import-preview').classList.add('hidden');
        renderAll();
        saveLibrary();
        showImportResult(added, noId, skippedList);
        const noIdNote = noId > 0 ? ' (' + noId + ' zonder ID \u2014 ken later een letter toe)' : '';
        setStatus('\u2705 Import: ' + added + ' toegevoegd' + noIdNote + ', ' + skipped + ' overgeslagen', 'ok');
    }

    /**
     * Show a result panel after an import: what was added and which songs
     * were skipped and why -- so nothing disappears silently.
     */
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
        const header = `<div class="ir-header">${parts.join(' \u00b7 ')}</div>`;
        const skippedRows = skipped.map(s => {
            const idLabel = s.id ? escapeHtml(s.id) : '<span class="imp-no-id">(geen ID)</span>';
            const artistPart = s.artist ? ` \u2014 <span class="imp-artist">${escapeHtml(s.artist)}</span>` : '';
            return `<div class="ir-line">
                <span class="imp-id">${idLabel}</span>
                <span class="ir-title">${escapeHtml(s.title)}${artistPart}</span>
                <span class="ir-reason">${escapeHtml(s.reason || 'onbekende reden')}</span>
            </div>`;
        }).join('');
        const skippedSection = skipped.length > 0
            ? `<div class="ir-section ir-section-skipped">\u26a0\ufe0f Overgeslagen \u2014 zie waarom:</div><div class="ir-list">${skippedRows}</div>`
            : '';
        box.innerHTML =
            header + skippedSection +
            `<button class="btn btn-secondary btn-mini" id="btn-dismiss-import-result">OK</button>`;
        box.classList.remove('hidden');
        const dismiss = box.querySelector('#btn-dismiss-import-result');
        if (dismiss) dismiss.addEventListener('click', () => box.classList.add('hidden'));
    }

    // ----------------------------------------------------------
    //  SAVE / LOAD via local server
    // ----------------------------------------------------------
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
            setStatus('\u274c Server niet bereikbaar \u2014 start server.py', 'err');
        }
    }

    async function loadLibrary(file) {
        try {
            const url = file ? '/api/library/load?file=' + encodeURIComponent(file) : '/api/library/load';
            const resp = await fetch(url);
            const json = await resp.json();
            if (json && json.library && Array.isArray(json.library.songs)) {
                state.songs = json.library.songs.map(ensureUid);
                if (json.file) state.currentFile = json.file;
            }
        } catch (e) {
            // No file yet -- fresh start
        }
        renderAll();
        updateFileFooter();
    }

    // ----------------------------------------------------------
    //  OPEN LIBRARY FILE — pick a .json from disk, load it in
    // ----------------------------------------------------------
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
        if (el) el.textContent = state.currentFile;
    }

    // ----------------------------------------------------------
    //  BRIDGE -- listen for WorshipTools library import
    // ----------------------------------------------------------
    function onLibraryEvent(e) {
        const songs = e.detail?.songs || e.detail?.library || null;
        const raw = e.detail?.data || null;
        console.log('[SongID] worshiptools-library event, songs:', songs?.length, 'raw:', !!raw);
        let parsed = [];
        if (Array.isArray(songs)) {
            // Structured songs from the extension: { number: "OK149", name: "Ja Is Ja", artist?: "Marcel Zimmer" }
            parsed = songs.map(s => {
                if (typeof s === 'string') return parseLine(s);
                if (s.number && s.name) return parseLine(s.number + ' ' + s.name, { artist: s.artist });
                // No number parsed by the extension (mixed-case prefix, plain title):
                // still pass the artist so no metadata is lost in the import.
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
        $('import-preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ----------------------------------------------------------
    //  FILE IMPORT
    //  Read a .txt/.csv or .json file from disk and feed it through
    //  the same parse -> preview pipeline as the paste button, so the
    //  operator sees all the numbers before committing.
    // ----------------------------------------------------------
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (ev) {
            const text = ev.target.result;
            let parsed = [];

            if (file.name.toLowerCase().endsWith('.json')) {
                // Two JSON shapes supported:
                // 1) WorshipTools extension: { songs: [{ number:"OK149", name:"...", artist?"..." }] }
                // 2) Library JSON: { songs: [{ id, prefix, number, title, artist }] }
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
                // .txt / .csv -- one song per line, same format as paste
                parsed = text.split('\n').map(parseLine).filter(Boolean);
            }

            if (parsed.length === 0) {
                setStatus('\u26a0\ufe0f Bestand bevatte geen herkenbare liederegels', 'err');
                return;
            }
            showImportPreview(parsed);
            setStatus('\ud83d\udce5 ' + parsed.length + ' liederen geladen uit ' + file.name, 'ok');
            $('import-preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Reset input so re-selecting the same file fires again
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    // ----------------------------------------------------------
    //  INIT
    // ----------------------------------------------------------
    function init() {
        $('btn-save').addEventListener('click', saveLibrary);
        $('btn-toggle-paste').addEventListener('click', () => $('paste-box').classList.toggle('hidden'));
        $('btn-import-file').addEventListener('click', () => $('file-input').click());
        $('file-input').addEventListener('change', handleFileSelect);
        $('btn-parse-paste').addEventListener('click', () => {
            const lines = $('paste-input').value.split('\n');
            const parsed = lines.map(parseLine).filter(Boolean);
            if (parsed.length === 0) { setStatus('\u26a0\ufe0f Niets te importeren', 'err'); return; }
            showImportPreview(parsed);
            $('paste-box').classList.add('hidden');
        });
        $('btn-confirm-import').addEventListener('click', confirmImport);
        $('btn-cancel-import').addEventListener('click', () => {
            state.pendingImport = [];
            $('import-preview').classList.add('hidden');
        });
        $('btn-wait-wt').addEventListener('click', () => {
            setStatus('\u23f3 Wachten op extensie \u2014 open WorshipTools en klik "Extract Song Library"', '');
        });
        $('search-input').addEventListener('input', renderTable);

        // File selector
        $('btn-open-file').addEventListener('click', () => $('open-file-input').click());
        $('open-file-input').addEventListener('change', handleOpenFile);

        // Extension bridge: the app signals readiness once, then the bridge
        // (spa-bridge.js, isolated content script) re-dispatches any cached
        // library it holds. Listener stays for live pushes.
        document.addEventListener('worshiptools-library', onLibraryEvent);

        loadLibrary(state.currentFile).then(() => {
            document.dispatchEvent(new CustomEvent('ichtus-library-ready'));
        });
    }

    // Public mini-API -- lets tests/tooling classify import lines without DOM.
    if (typeof window !== 'undefined') {
        window.SongIDAssigner = { parseLine, classifyImport };
    }

    document.addEventListener('DOMContentLoaded', init);
})();
