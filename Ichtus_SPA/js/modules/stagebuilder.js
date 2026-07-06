/* ===========================================
   STAGE BUILDER MODULE — Roster → X32 Channel Recaller
   ---------------------------------------------------------------
   Workflow:
     1. The worshiptools-sync Chrome extension extracts the
        planning roster from WorshipTools and dispatches a
        CustomEvent('worshiptools-roster') into the page DOM.
     2. Each roster assignment becomes a row in a table:
            Name | Role | Preset (auto-suggested) | Channel | Push
        The Preset column is a dropdown over all populated X32
        slots; pre-selected to the auto-suggested slot IF the
        X32 OSC bridge has populated the slot list (i.e. after
        Connect + Poll). Till then, the dropdown is disabled.
     3. Each row's Push button fires the Companion-style
        libchan-recall via the OSC bridge:

            OSC:     /load [s:"libchan", i:slot_idx, i:channel_idx, i:63]
            Bridge:  POST http://127.0.0.1:3002/api/load-channel-preset
                     body = {ip, channel (1-32), slot (0-99)}

     Per-row state (channel + slot override) is keyed in
     localStorage as `ichtus.sb.assign.{name}|{role}` so an
     operator's setup persists across reloads mid-service.

   Companion-style feature preservation:
     - "Use at own risk" — known-empty slots are blocked with
       a clear toast rather than pushed blindly.
     - Empty-slot case is matched against the X32 firmware's
       silent-drop behaviour by reading `hasdata` from the
       polled slot map.
   ============================================ */

const stagebuilderModule = {
    initialized: false,

    // -------- Roster state (WorshipTools) --------
    roster: [],                  // raw WorshipTools roster entries
    rosterStatus: 'waiting',     // 'waiting' | 'received' | 'empty'
    rosterRows: [],              // [{id,name,role,slug,slot,channel,autoSlot,status,...}]

    // -------- Timers / guards --------
    _toastTimer: null,
    _ipSaveTimer: null,
    _scrubToastTimer: null,
    _x32BridgeFetchInFlight: false,
    _x32ConnectInFlight: false,
    _pushAllInFlight: false,     // gates batched pushAll(); single-row pushRow uses _x32BridgeFetchInFlight
    _x32PendingFetches: [],      // [{ctrl,label}] — per-call AbortControllers

    // -------- X32 OSC bridge --------
    _x32BridgeEndpoint: 'http://127.0.0.1:3002/api/load-channel-preset',
    _x32PresetDiscoveryEndpoint: 'http://127.0.0.1:3002/api/x32-presets',
    DEFAULT_X32_IP: '192.168.180.198',

    _x32SessionConnected: false,
    _x32DiscoveredPresets: null,
    _x32LastPolled: null,

    // -------- Roster listener bookkeeping --------
    __sbRosterBound: false,
    __rosterHandler: null,
    __sbKeyBound: false,

    // Set of every first-name token in the current roster. Used by
    // _scoreMatch() to penalize cross-roster matches — a preset whose
    // name contains ANOTHER roster's first name is more likely bound
    // to the wrong person. Reset on every rebuild.
    _allFirstNames: null,
    _sbDebug: true,     // [SB] console output is ON by default; toggle via _setSbDebug(false)

    // -------- Locked-role keywords --------
    // Roles whose preset + channel the operator cannot override from
    // this view — they show read-only state blocks (auto-detected
    // preset, auto-assigned channel). Default set: drums + piano/keys
    // family, because those slots are typically 1:1 with a fixed mic
    // or instrument, not a per-service operator choice. The operator
    // can still see the auto-detected X32 slot for transparency, but
    // the dropdown is replaced with a label block. Edit this list to
    // expand/contract the locked set; the diagnose dump reflects it.
    _lockedRoleKeywords: [
        'drum', 'drums',
        'piano', 'key', 'keys', 'keyboard', 'keyboards', 'synth', 'synthesizer', 'organ'
    ],

    // -------- Role-keyword heuristics --------
    // Map of role-substring (lowercased, after diacritic-strip) to the
    // set of keywords that should match the preset name. Lookup logic:
    //   for each roleToken in _tokenize(role):
    //       if roleToken in _roleKeywordMap:
    //           for kw in map[roleToken]:
    //               if presetName contains kw: +20 (and break the loop)
    _roleKeywordMap: {
        'vocal':     ['vox', 'vocal', 'mic', 'zang', 'sing'],
        'vox':       ['vox', 'vocal', 'zang'],
        'zang':      ['vox', 'vocal', 'zang'],
        'sing':      ['vox', 'vocal', 'zang'],
        'lead':      ['lead'],
        'keys':      ['keys', 'piano', 'keyboard'],
        'piano':     ['keys', 'piano', 'keyboard'],
        'keyboard':  ['keys', 'piano', 'keyboard'],
        'drum':      ['drum', 'drums', 'kick'],
        'drums':     ['drum', 'drums', 'kick'],
        'gtr':       ['gtr', 'guitar', 'git', 'acc'],
        'guitar':    ['gtr', 'guitar', 'ag', 'eg', 'git', 'acc'],
        // "Gitaar" is the Dutch word for guitar; the abbreviated
        // "Git" is the common prefix used in Dutch church X32
        // preset names (e.g. "Git Tom", "Git_Tom_Smith"). Adding
        // the gitaar role token + the "git" keyword lets auto-suggest
        // fire the role-keyword bonus when a roster role of "Gitaar"
        // or "Guitarist" matches a preset name containing "git" —
        // combined with the first-name match (+100) this gives a
        // strong signal for the typical "Git {name}" preset layout.
        // The "acc" keyword covers the "Acc Git {name}" layout
        // (Acc = acoustic guitar prefix in the operator's X32).
        'gitaar':    ['gtr', 'guitar', 'ag', 'eg', 'git', 'acc'],
        'acoustic':  ['ac', 'acoustic', 'ag', 'acc'],
        'elektro':   ['electric', 'eg'],
        'electric':  ['electric', 'eg'],
        'bass':      ['bass']
    },

    // ------------------------------------------------------------------
    //  LIFECYCLE — init / cleanup
    // ------------------------------------------------------------------

    init() {
        // Honor the localStorage override ONCE at init so the
        // operator's persisted preference (set via _setSbDebug or
        // directly via `localStorage['ichtus.sb.debug'] = '0'`)
        // actually takes effect on first view entry. Without this,
        // the field initializer's `true` default would override the
        // persisted `'0'` until the operator explicitly calls
        // _setSbDebug(false) at runtime.
        try {
            if (localStorage.getItem('ichtus.sb.debug') === '0') this._sbDebug = false;
        } catch (_) { /* private mode */ }
        // One-time migration: strip auto-saved channels from old
        // localStorage entries. Earlier revisions persisted the
        // channel alongside the slot, which made it indistinguishable
        // from an operator override. The new role-based rules need
        // to re-apply on every rebuild, so we clear the channel
        // field (keep slot) the first time the new code runs.
        this._migrateChannelOverrides();
        this._sbDebugLog('init() re-entry=' + this.initialized +
            ', rosterStatus=' + this.rosterStatus +
            ', userDisconnected=' + this._isUserDisconnected() +
            ', autoConnect will fire on next line');
        // Re-init on revisit. Re-render view state (bindings stay alive
        // from the first init, so listeners don't double-attach).
        if (this.initialized) {
            this._renderRosterOrEmpty();
            this._renderConnectionBadge();
            // Auto-Connect + Auto-Poll on re-entry too — the operator
            // expects the view to rehydrate to a connected state when
            // they navigate back, not require a manual click.
            this.refreshSessionStatus({ autoConnect: true });
            return;
        }
        this.initialized = true;

        if (!this.__sbKeyBound) {
            // Escape-binding kept for future expansions (e.g. settings drawer).
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
            });
            this.__sbKeyBound = true;
        }

        this._scrubStaleStorage();
        this._bindStatusBar();
        this._bindRosterListener();
        this._renderRosterOrEmpty();
        this._renderConnectionBadge();
        this._signalStageBuilderReady();
        // Auto-Connect + Auto-Poll on view entry. refreshSessionStatus
        // reports current bridge state; if disconnected, opts.autoConnect
        // triggers an in-background connect (which itself triggers a
        // poll on success). The result: opening Stage Builder lights
        // up the roster table with auto-suggested presets and requires
        // zero clicks from the operator.
        this.refreshSessionStatus({ autoConnect: true });
    },

    cleanup() {
        if (this._toastTimer)   { clearTimeout(this._toastTimer);   this._toastTimer   = null; }
        if (this._ipSaveTimer)   { clearTimeout(this._ipSaveTimer);   this._ipSaveTimer   = null; }
        if (this._scrubToastTimer){ clearTimeout(this._scrubToastTimer); this._scrubToastTimer = null; }
        // Cancel pending X32 fetches so a late response can't paint stale
        // state on the next view's init.
        this._x32AbortAll();
        this._x32ConnectInFlight = false;
        this._x32BridgeFetchInFlight = false;
        // Tear down the roster listener — otherwise a later re-init
        // would receive a stale CustomEvent from the bridge's cached roster.
        this._tearDownRosterListener();
        this.initialized = false;
        this.__sbKeyBound = false;
    },

    _signalStageBuilderReady() {
        // The spa-bridge listens for this and re-dispatches the cached
        // roster — same idiom as setlistModule's ichtus-setlist-ready.
        document.dispatchEvent(new CustomEvent('ichtus-stagebuilder-ready', {
            bubbles: true, composed: true
        }));
    },

    _scrubStaleStorage() {
        // Wipe keys the previous gear/library modals wrote. Best-effort
        // wipe with one-time ack'd notice — see prior review feedback
        // for the rationale (firestore-synced mappings would be lost
        // silently otherwise).
        const ackKey = 'ichtus.stageBuilder._scrubNoticeAck';
        let alreadyAcked = false;
        try { alreadyAcked = localStorage.getItem(ackKey) === '1'; } catch (_) {}
        const stale = [
            'ichtus.stageBuilder.channels',         // gear-icon channel-editor
            'ichtus.stageBuilder.x32LibraryRows',   // Library Map editor
            'ichtus.stageBuilder.presetFilter'      // 3-card preset filter
        ];
        let removedCount = 0;
        for (const k of stale) {
            try {
                if (localStorage.getItem(k) != null) {
                    localStorage.removeItem(k);
                    removedCount++;
                }
            } catch (_) { /* storage disabled */ }
        }
        if (removedCount > 0 && !alreadyAcked) {
            try { localStorage.setItem(ackKey, '1'); } catch (_) {}
            const n = removedCount;
            const self = this;
            this._scrubToastTimer = setTimeout(function () {
                self._scrubToastTimer = null;
                if (!self.initialized) return;
                self.showToast(
                    'Oud opgeschoond: ' + n + ' verlaten LocalStorage-key' + (n === 1 ? '' : 's') +
                    ' verwijderd (kanaal-editor + Library Map-editor + filter hoorden bij de oude flow).',
                    'success'
                );
            }, 600);
        }
    },

    // ------------------------------------------------------------------
    //  PER-CALL ABORTCONTROLLER MANAGEMENT
    //  Each fetch creates its own controller so concurrent calls don't
    //  abort each other; cleanup() walks the list and aborts all.
    // ------------------------------------------------------------------

    _x32AddPending(label) {
        if (typeof AbortController === 'undefined') return null;
        const ctrl = new AbortController();
        this._x32PendingFetches.push({ ctrl: ctrl, label: label || 'x32' });
        return ctrl;
    },

    _x32RemovePending(ctrl) {
        if (!ctrl) return;
        const i = this._x32PendingFetches.findIndex(p => p.ctrl === ctrl);
        if (i >= 0) this._x32PendingFetches.splice(i, 1);
    },

    _x32AbortAll() {
        while (this._x32PendingFetches.length) {
            const p = this._x32PendingFetches.pop();
            try { p.ctrl.abort(); } catch (_) {}
        }
    },

    // ------------------------------------------------------------------
    //  ROSTER LISTENER (CustomEvent from worshiptools-sync/spa-bridge.js)
    // ------------------------------------------------------------------

    _bindRosterListener() {
        if (this.__sbRosterBound) return;
        this.__sbRosterBound = true;
        this.__rosterHandler = (e) => {
            const detail = (e && e.detail) || {};
            const data = Array.isArray(detail.roster) ? detail.roster : [];
            this._onRosterReceived(data);
        };
        document.addEventListener('worshiptools-roster', this.__rosterHandler);
    },

    _tearDownRosterListener() {
        if (!this.__sbRosterBound) return;
        if (this.__rosterHandler) {
            document.removeEventListener('worshiptools-roster', this.__rosterHandler);
        }
        this.__sbRosterBound = false;
        this.__rosterHandler = null;
    },

    _onRosterReceived(data) {
        // Defensive shape validation: roster entries must have a name
        // (WorshipTools declines are filtered upstream by content.js).
        const clean = (Array.isArray(data) ? data : []).filter(function (r) {
            return r && typeof r === 'object' &&
                   typeof r.name === 'string' && r.name.trim().length > 0;
        });
        // Fingerprint signature — re-render only if changed.
        // (The bridge dispatches roster on each page navigation; sometimes
        //  identical arrays arrive. Skip render in that case for free perf.)
        const fp = clean.map(function (r) { return (r.name||'') + '\u0001' + (r.role||''); }).join('\u0002');
        if (fp === this._lastRosterFp && this.rosterRows.length > 0) return;
        this._lastRosterFp = fp;

        this.roster = clean;
        this.rosterStatus = clean.length > 0 ? 'received' : 'empty';
        this._rebuildRows();
        this._sbDebugLog('roster received: ' + clean.length + ' entries' +
            (clean.length > 0 ? ' — sample: [' + this.rosterRows.slice(0, 3).map(function (r) {
                return r.name + '/' + r.role;
            }).join(', ') + ']' : ''));
        this._renderRosterOrEmpty();
        if (this.rosterStatus === 'received') {
            this.showToast(
                'Roster ontvangen: ' + this.rosterRows.length + ' toewijzingen geladen uit WorshipTools.',
                'success'
            );
        }
    },

    _rosterSlug(name, role) {
        const n = (this._normalizeName(name) || 'unnamed');
        const r = (this._normalizeName(role) || 'nole');
        return n + '|' + r;
    },

    _loadRowMapping(slug) {
        try {
            const raw = localStorage.getItem('ichtus.sb.assign.' + slug);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') return null;
            const slot = (Number.isInteger(obj.slot) && obj.slot >= 0 && obj.slot <= 99)
                ? obj.slot : null;
            const ch = (Number.isInteger(obj.channel) && obj.channel >= 1 && obj.channel <= 32)
                ? obj.channel : null;
            return { slot: slot, channel: ch };
        } catch (_) { return null; }
    },

    _saveRowMapping(slug, slot, channel) {
        // Full save — used by rowChange (operator override). The
        // channel here is genuinely operator-set, so it should
        // persist and block the role-based rules on next rebuild.
        try {
            const payload = { ts: Date.now() };
            if (slot != null) payload.slot = slot;
            if (channel != null) payload.channel = channel;
            localStorage.setItem('ichtus.sb.assign.' + slug, JSON.stringify(payload));
        } catch (_) { /* private mode — silently no-op */ }
    },

    _saveSlotMapping(slug, slot) {
        // Slot-only save — used by _autoSuggestPending. Preserves
        // any existing channel entry (set by rowChange) so the
        // operator's manual channel override survives the auto-
        // suggest re-save. The role-based rules will re-derive the
        // channel for rows that don't have a stored override.
        try {
            const existing = this._loadRowMapping(slug) || {};
            const payload = { ts: Date.now() };
            if (slot != null) payload.slot = slot;
            if (existing.channel != null) payload.channel = existing.channel;
            localStorage.setItem('ichtus.sb.assign.' + slug, JSON.stringify(payload));
        } catch (_) { /* private mode — silently no-op */ }
    },

    _rebuildRows() {
        if (!this.roster || this.roster.length === 0) {
            this.rosterRows = [];
            this._allFirstNames = null;
            return;
        }
        // Channel defaulting:
        //  - If the operator has manually set one (localStorage), use it.
        //  - Otherwise leave the channel null and let _assignChannelsByRole
        //    apply the role-based rules (WL only-singing → 1, WL+keys → 4,
        //    guitarist+vocalist → 5, other vocalists → 1-3, fallback
        //    roster order). Rows that still end up null after the
        //    rules (e.g. idx >= 32, past the X32's 32-input limit)
        //    show "—" in the channel block.
        this.rosterRows = this.roster.map(function (entry, idx) {
            const slug = stagebuilderModule._rosterSlug(entry.name, entry.role);
            const restored = stagebuilderModule._loadRowMapping(slug) || { slot: null, channel: null };
            // Id-based DOM id — sanitize the slug so it's HTML-safe and
            // unique even when the same name has two role assignments.
            const safeSlug = slug.replace(/[^a-z0-9]/g, '');
            // Locked roles (drums / piano / keys / synth / organ)
            // expose read-only state blocks instead of <select>
            // dropdowns — see _isLockedRole + _renderRow branch.
            return {
                id: 'row-' + idx + '-' + safeSlug.slice(0, 32),
                name: String(entry.name).trim(),
                role: String(entry.role || '').trim(),
                avatar: entry.avatar_url || '',
                slug: slug,
                slot: restored.slot,
                channel: restored.channel, // null = let role rules decide
                autoSlot: null,
                locked: stagebuilderModule._isLockedRole(entry.role),
                status: 'idle',  // 'idle' | 'pushing' | 'ok' | 'err'
                lastPushedAt: null,
                lastPushedSummary: ''
            };
        });
        // Apply role-based channel rules to rows without an operator
        // override. Runs after the map (so all rows exist) and before
        // _autoSuggestPending (so the slot auto-suggest sees the
        // final channels for any conflict-detection it does).
        this._assignChannelsByRole();

        // Pre-compute the roster-wide first-name set BEFORE auto-suggest
        // so _scoreMatch can penalize cross-roster matches. (Earlier
        // revisions had a self-penalty bug: when the row's slot was
        // still null, the row's own first-name got counted as a
        // "cross" offender, depressing the score by 40 for what was
        // actually the right slot. The new approach compares against
        // every other row's first-name only.)
        this._buildAllFirstNames();
        // Run auto-suggest for null-slot rows only.
        this._autoSuggestPending();
    },

    _buildAllFirstNames() {
        // Collect every first-name token across the roster. Used by
        // _scoreMatch to detect cross-roster collisions. Rebuilding
        // this on every roster change is O(N) and cheap (N ≤ ~25).
        const set = new Set();
        for (const r of this.rosterRows) {
            const fnTokens = this._tokenize(r.name);
            if (fnTokens.length > 0) set.add(fnTokens[0]);
        }
        this._allFirstNames = set;
    },

    _isLockedRole(role) {
        // Substring match on the normalized role name. Returns true
        // when the role is in the locked set (drums / piano / keys /
        // synth / organ). Empty / null roles are NOT locked — a
        // blank role falls through to the editable path.
        const norm = this._normalizeName(role);
        if (!norm) return false;
        for (const kw of this._lockedRoleKeywords) {
            if (norm.indexOf(kw) !== -1) return true;
        }
        return false;
    },

    _matchesAny(s, keywords) {
        // Small helper: substring match against any of the keywords.
        // Returns false for empty / null input so the caller doesn't
        // have to guard separately.
        if (!s) return false;
        for (const kw of keywords) {
            if (s.indexOf(kw) !== -1) return true;
        }
        return false;
    },

    _detectRoles(role) {
        // Role-detection helper for the channel assignment rules.
        // Returns a flat object of booleans so the caller can branch
        // on any combination (e.g. "WL AND pianist", "guitarist
        // AND vocalist", etc.). All checks are substring matches on
        // the NFD-normalized role name.
        const norm = this._normalizeName(role);
        return {
            isWL:        this._matchesAny(norm, ['worship leader', 'worshipleider', 'worship leider', 'wl']),
            isVocalist:  this._matchesAny(norm, ['vocal', 'vox', 'zang', 'singer', 'sing']),
            isPianist:   this._matchesAny(norm, ['piano', 'key', 'keys', 'keyboard', 'synth', 'organ']),
            isGuitarist: this._matchesAny(norm, ['guitar', 'gtr', 'gitaar']),
            isBassist:   this._matchesAny(norm, ['bass']),
            isDrummer:   this._matchesAny(norm, ['drum', 'drums'])
        };
    },

    _assignChannelsByRole() {
        // Role-based channel assignment per the operator's spec.
        // Priority order (5 passes):
        //   1. WL rules (special — overrides piano/drum blank):
        //      - WL with any instrument → CH 4
        //      - WL only-singing (no instrument) → CH 1
        //   2. Guitarist → CH 10 (any guitarist, regardless of vocalist)
        //   2b. Bassist → CH 8 (any bassist, regardless of vocalist)
        //   3. Other vocalists → CH 1, 2, 3 in order, skipping taken
        //   4. Everyone else → roster order (idx+1, skipping taken)
        // Piano/drum rows (non-WL) get a blank channel — the
        // keyboard/drum inputs are on separate X32 channels that
        // this table doesn't track. WL rows are special: even if
        // the WL plays piano or drums, the WL's vocal-mic channel
        // is assigned per the WL rules above.
        // Rows with an operator-set channel (from localStorage) are
        // skipped entirely — the operator's manual override always
        // wins.
        if (!this.rosterRows || this.rosterRows.length === 0) return;
        // `self` alias for closures (tryAssign + the cross-row
        // detection loop). Declared FIRST so the instrumentNames
        // Set builder below can call self._detectRoles /
        // self._normalizeName. Earlier revisions declared `self`
        // AFTER the Set builder, which threw a ReferenceError
        // ("Cannot access 'self' before initialization") and
        // silently killed the entire _assignChannelsByRole
        // function — leaving every row with row.channel == null
        // and the channel column rendering the disabled "—"
        // select. The order matters.
        const self = this;
        // Mark channels already taken (by operator overrides on
        // the first pass — they have row.channel set from localStorage).
        const taken = new Set();
        for (const row of this.rosterRows) {
            if (row.channel != null) taken.add(row.channel);
        }
        // Build a set of FULL normalized names for everyone in
        // the roster who has an instrument role. A WL row whose
        // person also has a separate instrument row (e.g.
        // "Worship Leader" + "Piano" for the same person)
        // should be treated as WL+instrument → CH 4. Without
        // this cross-row check, the WL row would only see its
        // own role string ("Worship Leader") and incorrectly
        // fall through to the CH 1 branch. Keyed on the FULL
        // normalized name (not the first-name token) so two
        // roster entries that share a first name — common in
        // church rosters, e.g. "John Smith" + "John Doe" — are
        // not conflated. Earlier revisions used the first-name
        // token here, which would false-positive a second
        // John's WL row to CH 4 just because the first John
        // plays piano.
        const instrumentNames = new Set();
        for (const row of this.rosterRows) {
            const dr = self._detectRoles(row.role);
            if (dr.isPianist || dr.isGuitarist || dr.isBassist || dr.isDrummer) {
                const normName = self._normalizeName(row.name);
                if (normName) instrumentNames.add(normName);
            }
        }
        // tryAssign: claim ch for row if not already taken. Updates
        // the taken set so subsequent rows in the same / later
        // pass can skip over it.
        const tryAssign = function (row, ch) {
            if (taken.has(ch)) return false;
            row.channel = ch;
            taken.add(ch);
            return true;
        };
        // Pass 1: WL rules (special — no piano/drum skip).
        //   WL with any instrument (pianist / guitarist / bassist
        //   / drummer) → CH 4. WL only-singing (no instrument)
        //   → CH 1. The WL is implicitly a vocalist (that's the
        //   role), so the "only-singing" check does NOT require
        //   isVocalist — a role string like "Worship Leader" or
        //   "WL" alone should still match. Non-WL rows are
        //   skipped here and handled by the later passes.
        //   "Instrument" is matched on EITHER the row's own
        //   role string OR a cross-row check: if the same
        //   person's first name appears in any other roster
        //   row with an instrument role, this WL row counts
        //   as WL+instrument (e.g. "Worship Leader" + "Piano"
        //   for Rafael → WL row gets CH 4, Piano row stays
        //   blank per the piano/drum skip in passes 2-4).
        for (const row of this.rosterRows) {
            if (row.channel != null) continue;
            const r = self._detectRoles(row.role);
            if (!r.isWL) continue; // non-WL handled by later passes
            const ownFull = self._normalizeName(row.name);
            const hasInstrumentRow = ownFull && instrumentNames.has(ownFull);
            if (r.isPianist || r.isGuitarist || r.isBassist || r.isDrummer ||
                hasInstrumentRow) {
                tryAssign(row, 4);
            } else {
                tryAssign(row, 1);
            }
        }
        // Pass 2: Guitarist → CH 10 (per the operator's spec
        // "the guitar channel should be 10"). Applies to ALL
        // guitarists regardless of vocalist status — a
        // guitarist-only row and a guitarist+vocalist row both
        // land on CH 10. Earlier revisions used the narrower
        // `isGuitarist && isVocalist` rule (→ CH 5); the new
        // spec broadens it to any guitarist. If CH 10 is
        // already taken (e.g. by a prior pass or operator
        // override), tryAssign returns false and the row falls
        // through to Pass 3 / Pass 4.
        // Piano/drum rows are still skipped — they get a blank
        // channel per the operator's spec ("disable the channel
        // selection for piano and drum. i dont want a channel
        // selected there").
        for (const row of this.rosterRows) {
            if (row.channel != null) continue;
            const r = self._detectRoles(row.role);
            if (r.isPianist || r.isDrummer) continue; // blank per spec
            if (r.isGuitarist) tryAssign(row, 10);
        }
        // Pass 2b: Bassist → CH 8 (per the operator's spec
        // "the Bass guitar is always on ch 8"). Applies to ALL
        // bassists regardless of vocalist status — a
        // bassist-only row and a bassist+vocalist row both
        // land on CH 8. If CH 8 is already taken (e.g. by a
        // prior pass or operator override), tryAssign returns
        // false and the row falls through to Pass 3 / Pass 4.
        // Piano/drum rows are still skipped (blank per spec).
        for (const row of this.rosterRows) {
            if (row.channel != null) continue;
            const r = self._detectRoles(row.role);
            if (r.isPianist || r.isDrummer) continue; // blank per spec
            if (r.isBassist) tryAssign(row, 8);
        }
        // Pass 3: Other vocalists → CH 1, 2, 3 in order, skipping
        // taken. (WL-only-singing already claimed CH 1 in pass 1,
        // so the first non-WL vocalist will go to CH 2 if WL is
        // present, otherwise CH 1.) Piano/drum rows are skipped
        // (blank channel per spec).
        for (const row of this.rosterRows) {
            if (row.channel != null) continue;
            const r = self._detectRoles(row.role);
            if (r.isPianist || r.isDrummer) continue; // blank per spec
            if (r.isVocalist) {
                for (const ch of [1, 2, 3]) {
                    if (tryAssign(row, ch)) break;
                }
            }
        }
        // Pass 4: Everyone else → roster order (idx+1, skipping taken,
        // up to idx 31 — past that the X32 has no input strip).
        // Piano/drum rows are skipped (blank channel per spec).
        for (let i = 0; i < this.rosterRows.length; i++) {
            const row = this.rosterRows[i];
            if (row.channel != null) continue;
            if (i >= 32) continue;
            const r = self._detectRoles(row.role);
            if (r.isPianist || r.isDrummer) continue; // blank per spec
            for (let ch = i + 1; ch <= 32; ch++) {
                if (tryAssign(row, ch)) break;
            }
        }
        // [SB] summary: log the channel-usage histogram so the
        // operator can verify the rules fired correctly.
        const hist = {};
        for (const row of this.rosterRows) {
            if (row.channel != null) {
                hist[row.channel] = (hist[row.channel] || 0) + 1;
            }
        }
        const histStr = Object.keys(hist)
            .sort(function (a, b) { return Number(a) - Number(b); })
            .map(function (ch) { return 'CH ' + String(ch).padStart(2, '0') + '×' + hist[ch]; })
            .join(' ');
        this._sbDebugLog('role-based channels: ' +
            this.rosterRows.length + ' rows → ' +
            Object.keys(hist).length + ' channels used [' + histStr + ']');
    },

    _migrateChannelOverrides() {
        // One-time migration: strip the `channel` field from any
        // pre-existing `ichtus.sb.assign.*` entries. Earlier
        // revisions wrote the channel alongside the slot in
        // _autoSuggestPending, which made it indistinguishable
        // from an operator-set override. The new role-based rules
        // need to re-apply on every rebuild, so we clear the
        // channel field (keep slot + ts) the first time the new
        // code runs. Gated by a flag so the work is idempotent.
        const flagKey = 'ichtus.sb.roleBasedChannels.v1';
        try {
            if (localStorage.getItem(flagKey) === '1') return;
        } catch (_) { return; }
        let cleared = 0;
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (!k || k.indexOf('ichtus.sb.assign.') !== 0) continue;
                try {
                    const raw = localStorage.getItem(k);
                    if (!raw) continue;
                    const obj = JSON.parse(raw);
                    if (obj && typeof obj === 'object' && obj.channel != null) {
                        delete obj.channel;
                        localStorage.setItem(k, JSON.stringify(obj));
                        cleared++;
                    }
                } catch (_) { /* skip malformed entries */ }
            }
        } catch (_) { /* storage disabled — abort */ }
        try { localStorage.setItem(flagKey, '1'); } catch (_) {}
        if (cleared > 0) {
            console.log('[SB] Migration: cleared ' + cleared +
                ' auto-saved channels — role-based rules now apply on every rebuild');
            const self = this;
            setTimeout(function () {
                if (!self.initialized) return;
                self.showToast(
                    'Kanaal-toewijzing: ' + cleared + ' oude kanalen vrijgemaakt — ' +
                    'nieuwe regels (piano/drum → blanco, WL alleen zang → CH 1, WL met instrument → CH 4, gitaar → CH 10, bas → CH 8, overige → roster-volgorde) actief.',
                    'success'
                );
            }, 2000);
        }
    },

    _buildOccupiedSlots() {
        // Only slots with hasdata=true are auto-suggest candidates. Empty
        // slots are still selectable via the dropdown (and the bridge
        // will reject with a clear error if operator fires into them).
        const presets = this._x32DiscoveredPresets;
        if (!presets) return [];
        const out = [];
        for (let slot = 0; slot < 100; slot++) {
            const key = String(slot + 1).padStart(3, '0');
            const info = presets[key];
            if (info && info.hasdata) {
                out.push({
                    slot: slot,
                    name: (info.name || '').trim()
                });
            }
        }
        return out;
    },

    _autoSuggestPending() {
        const presets = this._buildOccupiedSlots();
        if (presets.length === 0) return;
        // Greedy assignment: highest-scoring (row, slot) wins, then
        // ties broken by lower slot index. Once a row OR slot is bound,
        // both skip subsequent iterations.
        // `let` (NOT `const`) — reassigned by the filter line below.
        // Earlier revisions used `const` here and the function
        // threw "TypeError: Assignment to constant variable" on
        // every run, which is why auto-detect silently did nothing.
        let candidates = [];
        for (const row of this.rosterRows) {
            if (row.slot != null) continue; // operator set this — keep sticky
            for (const p of presets) {
                candidates.push({ row: row, slot: p, score: this._scoreMatch(row, p) });
            }
        }
        // Drop zero/negative scores — auto-suggest should only fire when
        // there's a real signal.
        candidates = candidates.filter(function (c) { return c.score >= 20; });
        candidates.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            // Prefer lower slot index on tie; among same score, prefer the
            // first roster row.
            if (a.slot.slot !== b.slot.slot) return a.slot.slot - b.slot.slot;
            return 0;
        });
        const boundSlots = new Set(this.rosterRows
            .filter(function (r) { return r.slot != null; })
            .map(function (r) { return r.slot; }));
        const matches = []; // collected for the [SB] log + toast at the end
        for (const c of candidates) {
            if (c.row.slot != null) continue;
            if (boundSlots.has(c.slot.slot)) continue;
            c.row.slot = c.slot.slot;
            c.row.autoSlot = c.slot.slot;
            boundSlots.add(c.slot.slot);
            matches.push({
                rowName: c.row.name,
                role: c.row.role,
                slot: c.slot.slot,
                slotName: c.slot.name,
                score: c.score
            });
        }
        // Persist auto-suggest results so future re-init keeps them.
        // Use _saveSlotMapping (not _saveRowMapping) so the channel
        // field is preserved as-is — the role-based rules in
        // _assignChannelsByRole will re-apply on the next rebuild,
        // and any operator-set channel override (from rowChange) is
        // left untouched.
        for (const r of this.rosterRows) {
            this._saveSlotMapping(r.slug, r.slot);
        }
        // Build the [SB] summary + on-screen toast. The toast is the
        // most important one for the operator — it surfaces
        // auto-suggest feedback in the UI even when the dev console
        // isn't open. If everything matched, the green "N presets
        // ontdekt" toast from pollX32Presets already conveys that,
        // so we stay quiet here to avoid double-toasting.
        const matched = this.rosterRows.filter(function (r) {
            return r.autoSlot != null;
        });
        const unmatched = this.rosterRows.filter(function (r) {
            return r.slot == null;
        });
        this._sbDebugLog('auto-suggest complete: ' +
            matched.length + '/' + this.rosterRows.length + ' rows auto-assigned' +
            (matches.length > 0 ? ' — ' + matches.map(function (m) {
                return m.rowName + ' → #' + String(m.slot + 1).padStart(3, '0') +
                    ' "' + m.slotName + '" (score ' + m.score + ')';
            }).join('; ') : '') +
            (unmatched.length > 0 ? ' — UNMATCHED: [' + unmatched.map(function (r) {
                return r.name + '/' + (r.role || '—');
            }).join(', ') + '] (no X32 slot name contained the roster name)' : ''));
        if (this.rosterRows.length > 0 && unmatched.length > 0) {
            this.showToast(
                'Auto-suggest: ' + matched.length + '/' + this.rosterRows.length +
                ' herkend — ' + unmatched.length +
                ' zonder match (controleer of X32-slot-namen de teamled-namen bevatten).',
                unmatched.length === this.rosterRows.length ? 'error' : 'success'
            );
        }
    },

    _scoreMatch(row, preset) {
        // Threshold-driven fit score. Returns 0 if the preset name is
        // empty (don't auto-suggest to bare-but-occupied slots — they
        // are still selectable manually).
        const slotName = this._normalizeName(preset.name);
        if (!slotName) return 0;
        const rowNameTokens = this._tokenize(row.name);
        const slotTokens = slotName.split(/[^a-z0-9]+/).filter(function (t) { return t.length > 0; });
        if (rowNameTokens.length === 0) return 0;
        const roleNorm = this._normalizeName(row.role);

        let score = 0;

        // Strongest: roster first-name token is in preset name.
        const firstName = rowNameTokens[0];
        if (firstName && slotName.indexOf(firstName) >= 0) score += 100;

        // Last-name token (skip if equal to first).
        const lastName = rowNameTokens[rowNameTokens.length - 1];
        if (lastName && lastName !== firstName && lastName.length > 1 &&
            slotName.indexOf(lastName) >= 0) score += 50;

        // Role-keyword heuristic — only if role is non-trivial.
        if (roleNorm) {
            const roleTokens = roleNorm.split(/[^a-z0-9]+/).filter(function (t) { return t.length > 0; });
            let roleMatched = false;
            for (let i = 0; i < roleTokens.length && !roleMatched; i++) {
                const kwArr = this._roleKeywordMap[roleTokens[i]];
                if (kwArr) {
                    for (const kw of kwArr) {
                        if (slotName.indexOf(kw) >= 0) { score += 20; roleMatched = true; break; }
                    }
                }
            }
        }

        // Weaker: any other roster name token (>=4 chars) appears in slot.
        // Skipped for short names to avoid bogus collisions on first names.
        for (let i = 1; i < rowNameTokens.length - 1; i++) {
            const tok = rowNameTokens[i];
            if (tok && tok.length >= 4 && slotName.indexOf(tok) >= 0) {
                score += 15;
                break;
            }
        }

        // Fuzzy Levenshtein fallback (catches typos & near-matches).
        let foundFuzzy = false;
        for (const a of rowNameTokens) {
            if (a.length < 3) continue;
            for (const b of slotTokens) {
                if (this._levenshtein(a, b) <= 1) { foundFuzzy = true; break; }
            }
            if (foundFuzzy) break;
        }
        if (foundFuzzy) score += 25;

        // Penalty: slot name includes ANOTHER roster's first name —
        // reduces false-binding to someone else's mic. Skip the row's
        // OWN first-name so the score isn't penalised when scoring
        // against its own match.
        if (this._allFirstNames && rowNameTokens.length > 0) {
            const ownFirst = rowNameTokens[0];
            for (const other of this._allFirstNames) {
                if (other === ownFirst) continue;
                if (slotName.indexOf(other) >= 0) {
                    score -= 40;
                    break;
                }
            }
        }

        return score;
    },

    _normalizeName(s) {
        if (s == null) return '';
        try {
            return String(s).normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();
        } catch (_) {
            return String(s).toLowerCase().trim();
        }
    },

    _tokenize(s) {
        return this._normalizeName(s).split(/[^a-z0-9]+/).filter(function (t) {
            return t && t.length > 0;
        });
    },

    _levenshtein(a, b) {
        if (a === b) return 0;
        const la = a.length, lb = b.length;
        if (la === 0) return lb;
        if (lb === 0) return la;
        const prev = new Array(lb + 1);
        const curr = new Array(lb + 1);
        for (let j = 0; j <= lb; j++) prev[j] = j;
        for (let i = 1; i <= la; i++) {
            curr[0] = i;
            for (let j = 1; j <= lb; j++) {
                const c = (a.charAt(i - 1) === b.charAt(j - 1)) ? 0 : 1;
                curr[j] = Math.min(
                    prev[j] + 1,        // deletion
                    curr[j - 1] + 1,    // insertion
                    prev[j - 1] + c     // substitution
                );
            }
            // swap rows
            for (let j = 0; j <= lb; j++) {
                prev[j] = curr[j];
                curr[j] = 0;
            }
        }
        return prev[lb];
    },

    // ------------------------------------------------------------------
    //  STATUS BAR (X32 IP + connect-state pill + Connect/Poll/Disconnect)
    // ------------------------------------------------------------------

    _bindStatusBar() {
        const input = document.getElementById('sb-x32-ip-input');
        if (!input) return;
        if (input.dataset.sbBound === '1') return;
        input.dataset.sbBound = '1';
        input.value = this._getX32Ip();
        if (input.placeholder !== this.DEFAULT_X32_IP) {
            input.placeholder = this.DEFAULT_X32_IP;
        }
        const self = this;
        input.addEventListener('input', function () {
            const v = (input.value || '').trim();
            if (self._ipSaveTimer) { clearTimeout(self._ipSaveTimer); self._ipSaveTimer = null; }
            if (!v) {
                try { localStorage.removeItem('x32:x32ip'); } catch (_) {}
                self._renderRosterOrEmpty();
                return;
            }
            if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
                self._renderRosterOrEmpty();
                return;
            }
            self._ipSaveTimer = setTimeout(function () {
                try { localStorage.setItem('x32:x32ip', v); } catch (_) {}
                self._renderRosterOrEmpty();
            }, 250);
        });
        input.addEventListener('blur', function () { self._renderRosterOrEmpty(); });
    },

    _getX32Ip() {
        try {
            const stored = localStorage.getItem('x32:x32ip');
            if (typeof stored === 'string' && stored.trim()) return stored.trim();
        } catch (_) {}
        return this.DEFAULT_X32_IP;
    },

    async connectToX32(opts) {
        // `opts.silent`: suppress the success toast. The auto-connect
        // path on view entry sets this so the operator — who didn't
        // ask for a connect — isn't spammed with a confirmation.
        // The connection-badge flip is enough visual feedback, and the
        // status bar's "Verbonden met …" line carries the IP + occupancy.
        // The error toast still fires (actionable: operator needs to
        // know the bridge is unreachable).
        const silent = !!(opts && opts.silent);
        // A manual Connect (silent === false) clears the disconnect-
        // intent flag so future view re-entries auto-connect again. A
        // silent (auto) connect leaves the flag alone — the operator
        // never asked for that, so we don't pretend they did.
        if (!silent) this._setUserDisconnectedFlag(false);
        if (this._x32ConnectInFlight) {
            this._setStatus('Bezig met verbinden…');
            return;
        }
        this._x32ConnectInFlight = true;
        this._setStatus('Verbinden met X32…');
        const ip = this._getX32Ip();
        const ctrl = this._x32AddPending('connect');
        try {
            const r = await fetch(this._x32PresetDiscoveryEndpoint + '/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip }),
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || ('HTTP ' + r.status));
            }
            const data = await r.json();
            this._x32SessionConnected = true;
            const occ = (data && data.occupiedSlots != null) ? data.occupiedSlots : '?';
            this._setStatus('✓ Verbonden met ' + ip + ' (' + occ + '/100 slots bezet) — presets worden geladen…');
            this._renderConnectionBadge();
            this._renderRosterOrEmpty();
            this._sbDebugLog('connectToX32 OK: ip=' + ip + ', occupied=' + occ + ', silent=' + silent);
            if (!silent) {
                this.showToast('Verbonden met X32 (' + ip + ')', 'success');
            }
            await this.pollX32Presets();
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            this._x32SessionConnected = false;
            this._x32DiscoveredPresets = null;
            this._setStatus('✗ Verbinding mislukt: ' + err.message);
            this._renderConnectionBadge();
            this._renderRosterOrEmpty();
            this.showToast('X32 verbinding mislukt: ' + err.message, 'error');
            this._sbDebugLog('connectToX32 FAILED: ' + err.message);
        } finally {
            this._x32ConnectInFlight = false;
            this._x32RemovePending(ctrl);
        }
    },

    async pollX32Presets() {
        this._setStatus('Presets ophalen van X32…');
        const ctrl = this._x32AddPending('poll');
        try {
            const r = await fetch(this._x32PresetDiscoveryEndpoint + '/poll', {
                method: 'POST',
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || ('HTTP ' + r.status));
            }
            const data = await r.json();
            this._x32DiscoveredPresets = (data && data.presets) || {};
            this._x32LastPolled = (data && data.lastPolled) || null;
            const occ = (data && data.occupied) || 0;
            const ts = this._x32LastPolled
                ? new Date(this._x32LastPolled).toLocaleTimeString('nl-NL')
                : '';
            this._setStatus(
                '✓ ' + occ + '/100 slots bezet' +
                (ts ? ' (laatst: ' + ts + ')' : '')
            );
            this._renderConnectionBadge();
            // Refresh row state — re-run auto-suggest for null-slot rows.
            this._buildAllFirstNames();
            this._autoSuggestPending();
            this._renderRosterOrEmpty();
            const occupiedSlots = Object.entries(this._x32DiscoveredPresets || {})
                .filter(function (e) { return e[1] && e[1].hasdata; });
            this._sbDebugLog('pollX32Presets OK: occupied=' + occupiedSlots.length + '/100' +
                (occupiedSlots.length > 0 ? ' — sample: [' + occupiedSlots.slice(0, 5).map(function (e) {
                    return e[0] + '="' + (e[1].name || '(naamloos)') + '"';
                }).join(', ') + ']' : ' (NO occupied slots on X32 — auto-suggest will match nothing)'));
            if (occ === 0) {
                this.showToast(
                    'Geen presets gevonden op de X32 — sla ze eerst op via Setup → Library.',
                    'error'
                );
            } else {
                this.showToast(occ + ' presets ontdekt op X32', 'success');
            }
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            this._setStatus('✗ Pollen mislukt: ' + err.message);
            this.showToast('X32 poll mislukt: ' + err.message, 'error');
        } finally {
            this._x32RemovePending(ctrl);
        }
    },

    async disconnectFromX32() {
        const ctrl = this._x32AddPending('disconnect');
        try {
            await fetch(this._x32PresetDiscoveryEndpoint + '/disconnect', {
                method: 'POST',
                signal: ctrl ? ctrl.signal : undefined
            });
        } catch (err) {
            if (err && err.name !== 'AbortError') {
                // Bridge offline is fine; just clear local state.
            }
        } finally {
            this._x32RemovePending(ctrl);
        }
        this._x32SessionConnected = false;
        this._x32DiscoveredPresets = null;
        this._x32LastPolled = null;
        this._allFirstNames = null;
        // Persist the operator's intent to be disconnected so a future
        // view re-entry doesn't silently re-connect. Cleared on the
        // next manual Connect (see connectToX32). Tied to localStorage
        // rather than a module field because cleanup() resets module
        // state — the operator's disconnect-intent should survive
        // navigation away and back.
        this._setUserDisconnectedFlag(true);
        // Drop auto-suggested slots so the dropdowns revert to the
        // "Poll X32 om presets te laden..." disabled state. Operator
        // manual assigns also cleared? No — they're keyed in
        // localStorage and respected on reconnect; we just don't
        // surface them till the next poll.
        for (const row of this.rosterRows) {
            if (row.slot === row.autoSlot) {
                row.slot = null;
                row.autoSlot = null;
            }
        }
        this._setStatus('Losgekoppeld');
        this._renderConnectionBadge();
        this._renderRosterOrEmpty();
        this.showToast('Losgekoppeld van X32', 'success');
    },

    /**
     * Pull current session state. Used on view entry so an already-
     * connected bridge lights up the rows without operator re-click.
     *
     * `opts.autoConnect`: when true AND the status check comes back
     * disconnected, fire `connectToX32({ silent: true })` so the
     * operator doesn't have to click Connect themselves. The manual
     * refresh button (sb-btn-refresh-status) calls WITHOUT this flag,
     * so a "just check" click never triggers a connect.
     */
    async refreshSessionStatus(opts) {
        const autoConnect = !!(opts && opts.autoConnect);
        const ctrl = this._x32AddPending('status');
        try {
            const r = await fetch(this._x32PresetDiscoveryEndpoint + '/status', {
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!r.ok) {
                this._x32SessionConnected = false;
                this._x32DiscoveredPresets = null;
                this._renderConnectionBadge();
                this._renderRosterOrEmpty();
                this._sbDebugLog('status check !ok: HTTP ' + r.status + ' — autoConnect=' + autoConnect);
                this._maybeAutoConnect(autoConnect);
                return;
            }
            const data = await r.json();
            this._x32SessionConnected = !!(data && data.connected);
            if (this._x32SessionConnected) {
                // Use a SEPARATE AbortController for the inner preset
                // fetch. Sharing the outer ctrl.signal would mean the
                // outer finally's _x32RemovePending(ctrl) aborts the
                // still-in-flight inner request, leaving
                // _x32DiscoveredPresets stale. See review #2.
                const innerCtrl = this._x32AddPending('status-presets');
                try {
                    const pr = await fetch(this._x32PresetDiscoveryEndpoint, {
                        signal: innerCtrl ? innerCtrl.signal : undefined
                    });
                    if (pr.ok) {
                        const pd = await pr.json();
                        this._x32DiscoveredPresets = (pd && pd.presets) || {};
                        this._x32LastPolled = (pd && pd.lastPolled) || null;
                    }
                } finally {
                    this._x32RemovePending(innerCtrl);
                }
                this._buildAllFirstNames();
                this._autoSuggestPending();
            }
            this._renderConnectionBadge();
            this._renderRosterOrEmpty();
            this._sbDebugLog('status check OK: connected=' + this._x32SessionConnected +
                ', presets cache=' + (this._x32DiscoveredPresets ?
                    Object.keys(this._x32DiscoveredPresets).length + ' slot entries (incl. empty)' :
                    'empty') +
                ', autoConnect=' + autoConnect);
            this._maybeAutoConnect(autoConnect);
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            // Bridge offline — keep current state to avoid hip-flips
            // on transient wifi blips.
            this._sbDebugLog('status check FAILED: ' + err.message +
                ' — autoConnect NOT fired (bridge offline). Click Connect manually.');
        } finally {
            this._x32RemovePending(ctrl);
        }
    },

    /**
     * Auto-connect helper — fires only when refreshSessionStatus was
     * called with opts.autoConnect AND we're not already connected
     * AND a connect isn't already in flight. Used by the
     * init/re-entry paths so the operator doesn't need to click
     * Connect; the manual refresh button (no opts) skips this.
     */
    _maybeAutoConnect(autoConnect) {
        if (!autoConnect) return;
        if (this._x32SessionConnected) return;
        if (this._x32ConnectInFlight) return;
        // Respect an explicit prior Disconnect: the operator walked
        // away from a connected session and clicked Disconnect, so
        // they don't want the next view re-entry to silently reconnect.
        // They can always click Connect themselves when ready.
        if (this._isUserDisconnected()) return;
        // Suppress the success toast — the connection-badge flip to
        // "Verbonden" is enough visual confirmation. The error toast
        // still fires (actionable: operator needs to know the bridge
        // is unreachable).
        this.connectToX32({ silent: true });
    },

    _renderConnectionBadge() {
        const badge = document.getElementById('sb-x32-connection-badge');
        const text = document.getElementById('sb-x32-connection-text');
        const meta = document.getElementById('sb-x32-connection-meta');
        if (!badge || !text) return;
        if (this._x32SessionConnected) {
            badge.className = 'sb-conn-badge connected';
            text.textContent = 'Verbonden';
            const occ = (this._x32DiscoveredPresets
                ? Object.values(this._x32DiscoveredPresets).filter(function (p) { return p && p.hasdata; }).length
                : 0);
            const ts = this._x32LastPolled
                ? 'laatst: ' + new Date(this._x32LastPolled).toLocaleTimeString('nl-NL')
                : '';
            const occStr = occ + '/' + 100 + ' slots';
            if (meta) meta.textContent = ts ? (occStr + ' · ' + ts) : occStr;
        } else {
            badge.className = 'sb-conn-badge disconnected';
            text.textContent = 'Niet verbonden';
            if (meta) meta.textContent = 'klik Connect om te koppelen';
        }
    },

    _setStatus(text) {
        const meta = document.getElementById('sb-x32-connection-meta');
        if (meta) meta.textContent = text;
    },

    // ------------------------------------------------------------------
    //  RENDERERS — roster table (per-musician rows)
    // ------------------------------------------------------------------

    _renderRosterOrEmpty() {
        const body = document.getElementById('sb-roster-table-body');
        const empty = document.getElementById('sb-roster-empty');
        if (!body || !empty) return;
        this._updateRosterMeta();

        if (this.rosterStatus === 'waiting' || this.rosterRows.length === 0 && this.rosterStatus === 'empty') {
            this._renderEmptyState(empty);
            body.innerHTML = '';
            return;
        }
        empty.style.display = 'none';

        const hasPoll = !!this._x32DiscoveredPresets;
        // Detect slot conflicts (multiple rows on same slot) so we can
        // mark them amber.
        const slotCounts = {};
        for (const row of this.rosterRows) {
            if (row.slot != null) slotCounts[row.slot] = (slotCounts[row.slot] || 0) + 1;
        }
        const rowsHtml = this.rosterRows.map(function (row) {
            return stagebuilderModule._renderRow(row, hasPoll, (slotCounts[row.slot] || 0) > 1);
        });
        body.innerHTML = rowsHtml.join('');
    },

    _renderEmptyState(empty) {
        empty.style.display = '';
        if (this.rosterStatus === 'waiting') {
            empty.innerHTML =
                '<div class="sb-roster-empty-icon">' +
                '   <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                '       <circle cx="12" cy="12" r="9"/>' +
                '       <path d="M12 7v5l3 2"/>' +
                '   </svg>' +
                '</div>' +
                '<div class="sb-roster-empty-title">Wachten op WorshipTools</div>' +
                '<p class="sb-roster-empty-hint">' +
                '   Open <strong>Planning</strong> in WorshipTools en klik op de blauwe knop <strong>Extract Roster</strong>.' +
                '   De lijst verschijnt automatisch hier.' +
                '</p>';
            return;
        }
        // rosterStatus === 'empty'
        empty.innerHTML =
            '<div class="sb-roster-empty-icon">' +
            '   <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '       <line x1="8" y1="6" x2="21" y2="6"/>' +
            '       <line x1="8" y1="12" x2="21" y2="12"/>' +
            '       <line x1="8" y1="18" x2="21" y2="18"/>' +
            '       <circle cx="4" cy="6" r="1"/>' +
            '       <circle cx="4" cy="12" r="1"/>' +
            '       <circle cx="4" cy="18" r="1"/>' +
            '   </svg>' +
            '</div>' +
            '<div class="sb-roster-empty-title">Geen teamleden geladen</div>' +
            '<p class="sb-roster-empty-hint">Deze dienst heeft geen rol-toewijzingen.' +
            '   Als dit onverwacht is, open WorshipTools Planning en klik opnieuw <strong>Extract Roster</strong>.</p>';
    },

    _updateRosterMeta() {
        const meta = document.getElementById('sb-roster-meta');
        if (!meta) return;
        const ip = this._getX32Ip();
        if (this.rosterStatus === 'received' && this.rosterRows.length > 0) {
            const total = this.rosterRows.length;
            const filled = this.rosterRows.filter(function (r) {
                return r.slot != null && r.channel != null;
            }).length;
            const pollState = this._x32DiscoveredPresets ? 'gepolld' : 'wacht op Poll';
            meta.textContent = total + ' toewijzingen · ' +
                filled + '/' + total + ' recall-klaar · ' + pollState + ' · console ' + ip;
        } else if (this.rosterStatus === 'empty') {
            meta.textContent = '0 toewijzingen · open WorshipTools → Extract Roster · console ' + ip;
        } else {
            meta.textContent = 'wachten op roster uit WorshipTools… · console ' + ip;
        }
        // Sync the Recall All button's (N) badge with the current
        // ready count. Cheap O(N) scan; roster size is bounded by
        // a typical service (≤ ~25). Idempotent — safe to call
        // from every render path.
        this._refreshRecallAllButton();
    },

    _renderRow(row, hasPoll, hasConflict) {
        const idAttr = ' data-row-id="' + this.escapeAttr(row.id) + '"';
        const baseRowClass =
            row.status === 'ok'  ? ' class="sb-pushed-ok"' :
            row.status === 'err' ? ' class="sb-pushed-err"' : '';

        // Auto-suggest hint (only when poll has run AND a slot landed).
        // For locked roles, the slot can ONLY be auto-suggested (no
        // override possible), so the "handmatig" override case is
        // unreachable — only the "auto" hint fires.
        const isAutoOriginal = hasPoll && row.autoSlot != null && row.slot === row.autoSlot;
        const isAutoOverridden = row.slot != null && row.autoSlot != null && row.slot !== row.autoSlot;
        const hintHtml = isAutoOriginal
            ? '<div class="sb-row-auto-hint">auto-suggest</div>'
            : (isAutoOverridden
                ? '<div class="sb-row-auto-hint sb-auto-override">handmatig (auto was #' + String(row.autoSlot + 1).padStart(3, '0') + ')</div>'
                : '');

        const nameCell = '<td>' +
            '<div class="sb-row-name">' + this.escapeHtml(row.name) + '</div>' +
            hintHtml +
            '</td>';

        const roleCell = '<td><span class="sb-row-role">' + this.escapeHtml(row.role || '—') + '</span></td>';

        // Locked roles (drums / piano / keys / synth / organ) get
        // read-only state blocks — the operator can SEE the auto-
        // detected preset + auto-assigned channel but cannot change
        // them. Everyone else gets an editable <select> dropdown.
        const slotCell   = '<td>' + (row.locked
            ? this._renderSlotLabel(row, hasPoll, hasConflict)
            : this._renderSlotSelect(row, hasPoll, hasConflict)) + '</td>';
        const channelCell = '<td>' + (row.locked
            ? this._renderChannelLabel(row)
            : this._renderChannelSelect(row)) + '</td>';

        // Push button enabled iff a slot was assigned AND the
        // row has a channel. Channel is auto-assigned by roster
        // order (idx+1) up to idx 31, so past the 32nd row it
        // stays null — the Push button is disabled there until
        // the roster is trimmed or a second X32 scene is used.
        const canPush = (row.slot != null) &&
                        (row.channel != null) &&
                        hasPoll &&
                        (row.status !== 'pushing');
        const btnText =
            row.status === 'pushing' ? 'Bezig…' :
            row.status === 'ok'      ? '✓ Recall' :
            row.status === 'err'     ? '✗ Probeer' :
                                       'Recall';
        const btnClass = 'sb-row-push' +
            (row.status === 'pushing' ? ' sb-row-push--pushing' :
             row.status === 'ok'      ? ' sb-row-push--ok' :
             row.status === 'err'     ? ' sb-row-push--err' : '');
        const pushCell = '<td>' +
            '<button type="button" class="' + btnClass + '"' +
            idAttr +
            (canPush ? '' : ' disabled') +
            ' onclick="stagebuilderModule.pushRow(\'' + this.escapeAttr(row.id) + '\')">' +
            btnText +
            '</button></td>';

        return '<tr' + idAttr + baseRowClass + '>' +
            nameCell + roleCell + slotCell + channelCell + pushCell +
            '</tr>';
    },

    _renderSlotLabel(row, hasPoll, hasConflict) {
        // Read-only state display. The operator can SEE the
        // auto-suggested slot (state set by _autoSuggestPending
        // after a successful X32 poll) but cannot change it from
        // this view. Three states:
        //   - waiting: no poll yet
        //   - empty:   poll ran but auto-suggest didn't match
        //   - filled:  matched, show slot number + name + auto badge
        if (!hasPoll) {
            return '<div class="sb-row-slot-block sb-row-slot-block--waiting">' +
                '<span class="sb-row-slot-block__hint">Wacht op Poll…</span>' +
                '</div>';
        }
        if (row.slot == null) {
            return '<div class="sb-row-slot-block sb-row-slot-block--empty">' +
                '<span class="sb-row-slot-block__placeholder">— geen match —</span>' +
                '</div>';
        }
        const presets = this._x32DiscoveredPresets || {};
        const k = String(row.slot + 1).padStart(3, '0');
        const info = presets[k];
        const name = (info && info.name) ? String(info.name).trim() : '';
        const isEmpty = info && info.hasdata === false;
        const isAuto = row.autoSlot != null && row.slot === row.autoSlot;
        const extraClass = hasConflict ? ' sb-conflict-amber' : '';
        return '<div class="sb-row-slot-block' + extraClass + '">' +
            '<span class="sb-row-slot-block__num">' + k + '</span>' +
            (name ?
                '<span class="sb-row-slot-block__name">' + this.escapeHtml(name) + (isEmpty ? ' <em>(leeg)</em>' : '') + '</span>' :
                '<span class="sb-row-slot-block__name">(naamloos)</span>') +
            (isAuto ? '<span class="sb-row-slot-block__auto">auto</span>' : '') +
            '</div>';
    },

    _renderChannelLabel(row) {
        // Read-only state display for locked roles (drums / piano /
        // keys / synth / organ). The channel is auto-assigned by
        // roster order in _rebuildRows (capped at 32). The block
        // just shows the state — the operator can re-order the
        // roster in WorshipTools to change the mapping.
        if (row.channel == null) {
            return '<div class="sb-row-channel-block sb-row-channel-block--empty">—</div>';
        }
        return '<div class="sb-row-channel-block">CH ' +
            String(row.channel).padStart(2, '0') + '</div>';
    },

    _renderSlotSelect(row, hasPoll, hasConflict) {
        // Editable preset dropdown for non-locked roles. Until the
        // X32 has been polled, render the same waiting block the
        // locked branch uses (the operator has no list to pick from
        // yet — surfacing an empty <select> would be confusing).
        if (!hasPoll) {
            return '<div class="sb-row-slot-block sb-row-slot-block--waiting">' +
                '<span class="sb-row-slot-block__hint">Wacht op Poll…</span>' +
                '</div>';
        }
        const presets = this._x32DiscoveredPresets || {};
        let optionsHtml = '<option value="">— geen preset —</option>';
        // Iterate every slot the X32 reports. The 1-based slot key
        // matches the X32's /libslot indexing (1..100). Empty slots
        // are still listed (with "(leeg)" suffix) so the operator
        // can intentionally aim at them if they want; the bridge
        // rejects empties with a clear toast at Push time.
        for (let i = 0; i < 100; i++) {
            const k = String(i + 1).padStart(3, '0');
            const info = presets[k];
            if (!info) continue;
            const isEmpty = info.hasdata === false;
            const name = (info.name || '').trim() || ('(slot ' + k + ')');
            const selected = (row.slot === i) ? ' selected' : '';
            const label = k + ' · ' + name + (isEmpty ? ' (leeg)' : '');
            optionsHtml += '<option value="' + i + '"' + selected + '>' +
                this.escapeHtml(label) + '</option>';
        }
        const extraClass = hasConflict ? ' sb-conflict-amber' : '';
        return '<select class="sb-row-slot' + extraClass + '"' +
            ' data-row-id="' + this.escapeAttr(row.id) + '"' +
            ' onchange="stagebuilderModule.rowChange(\'' + this.escapeAttr(row.id) +
            '\', \'slot\', this.value)">' + optionsHtml + '</select>';
    },

    _renderChannelSelect(row) {
        // Editable channel dropdown for non-locked roles. Channels
        // 1..32 mirror the X32's input strips. The selected value
        // is the row's current channel assignment (auto-assigned by
        // roster order in _rebuildRows, or restored from a previous
        // operator override via localStorage). Rows past idx 31
        // (the 32nd entry) have row.channel = null — the X32 has
        // only 32 input strips. In that case we render a disabled
        // "—" placeholder as the selected option so the operator
        // doesn't see a misleading "CH 01" by default. The select
        // is also disabled in this state — the canPush gate at the
        // row level also disables Push until the channel is set.
        if (row.channel == null) {
            return '<select class="sb-row-channel" disabled>' +
                '<option selected>—</option>' +
                '</select>';
        }
        let optionsHtml = '';
        for (let ch = 1; ch <= 32; ch++) {
            const selected = (row.channel === ch) ? ' selected' : '';
            const label = 'CH ' + String(ch).padStart(2, '0');
            optionsHtml += '<option value="' + ch + '"' + selected + '>' + label + '</option>';
        }
        return '<select class="sb-row-channel"' +
            ' data-row-id="' + this.escapeAttr(row.id) + '"' +
            ' onchange="stagebuilderModule.rowChange(\'' + this.escapeAttr(row.id) +
            '\', \'channel\', this.value)">' + optionsHtml + '</select>';
    },

    rowChange(rowId, field, value) {
        // <select onchange="…"> handler. Updates row.slot or
        // row.channel in place, persists to localStorage, and
        // re-renders so the conflict-amber indicator (for slot
        // collisions) and the Push-button enabled state stay
        // current. Locked roles never expose the dropdown, but
        // the safety check below keeps this defensive — if a
        // future UI change ever wires an editable control on a
        // locked row, the write is still rejected.
        const row = this.rosterRows.find(function (r) { return r.id === rowId; });
        if (!row || row.locked) return;
        if (field === 'slot') {
            if (value === '' || value == null) {
                row.slot = null;
            } else {
                const n = parseInt(value, 10);
                row.slot = (Number.isInteger(n) && n >= 0 && n <= 99) ? n : null;
            }
            // Manual override clears the auto-suggest "auto" badge —
            // the next render will flip isAutoOriginal off and
            // isAutoOverridden on, showing the "handmatig (auto was
            // #XXX)" hint instead.
            this._saveRowMapping(row.slug, row.slot, row.channel);
        } else if (field === 'channel') {
            const n = parseInt(value, 10);
            row.channel = (Number.isInteger(n) && n >= 1 && n <= 32) ? n : null;
            this._saveRowMapping(row.slug, row.slot, row.channel);
        } else {
            return;
        }
        this._renderRosterOrEmpty();
    },

    async pushRow(rowId, opts) {
        // `opts.silent`: suppress the per-row success/failure toast.
        // Used by pushAll() so a 7-row batch doesn't fire 7 toasts —
        // the batch shows ONE summary toast at the end instead.
        // The visual row status (pushing / ok / err) still flips
        // so the operator sees live progress in the table.
        const silent = !!(opts && opts.silent);
        const row = this.rosterRows.find(function (r) { return r.id === rowId; });
        if (!row) return;
        if (row.slot == null || row.channel == null) {
            if (!silent) {
                this.showToast(
                    'Kies eerst een kanaal én een preset voor ' + row.name + '.',
                    'error'
                );
            }
            return;
        }
        if (!this._x32DiscoveredPresets) {
            if (!silent) this.showToast('X32 niet gepolld — klik Poll.', 'error');
            return;
        }
        const slotKey = String(row.slot + 1).padStart(3, '0');
        const info = this._x32DiscoveredPresets[slotKey] || null;
        if (info && info.hasdata === false) {
            if (!silent) this.showToast('Slot ' + slotKey + ' is leeg op de X32 — recall geannuleerd.', 'error');
            return;
        }
        if (this._x32BridgeFetchInFlight) {
            if (!silent) this.showToast('Push al bezig — wacht even.', 'error');
            return;
        }

        row.status = 'pushing';
        this._renderRosterOrEmpty();

        this._x32BridgeFetchInFlight = true;
        const ip = this._getX32Ip();
        const ctrl = this._x32AddPending('recall');
        try {
            const r = await fetch(this._x32BridgeEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: ip, channel: row.channel, slot: row.slot }),
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!r.ok) {
                const errData = await r.json().catch(function () { return {}; });
                throw new Error(errData.error || ('HTTP ' + r.status));
            }
            const baseName = (info && info.name) ? String(info.name).trim() : '';
            row.status = 'ok';
            row.lastPushedAt = Date.now();
            row.lastPushedSummary = slotKey + ' · ' + baseName;
            const self = this;
            setTimeout(function () {
                if (row.status === 'ok') {
                    row.status = 'idle';
                    self._renderRosterOrEmpty();
                }
            }, 2400);
            if (!silent) {
                this.showToast(
                    '✓ ' + row.name + ' → CH ' + String(row.channel).padStart(2, '0') +
                    ' met preset ' + slotKey + (baseName ? ' (' + baseName + ')' : '') + ' @ ' + ip,
                    'success'
                );
            }
            console.log('[SB] Recall row', row.id, { ip: ip, channel: row.channel, slot: row.slot });
            this._renderRosterOrEmpty();
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            row.status = 'err';
            if (!silent) this.showToast('✗ Recall mislukt voor ' + row.name + ': ' + err.message, 'error');
            console.error('[SB] Recall failed', err);
            const self = this;
            setTimeout(function () {
                if (row.status === 'err') {
                    row.status = 'idle';
                    self._renderRosterOrEmpty();
                }
            }, 2400);
            this._renderRosterOrEmpty();
        } finally {
            this._x32BridgeFetchInFlight = false;
            this._x32RemovePending(ctrl);
        }
    },

    /**
     * Batched "Recall All" — iterates every row that has a slot +
     * channel assigned and a polled X32 preset list, and fires a
     * recall for each one in sequence. Runs through the same
     * _x32BridgeFetchInFlight gate as a single pushRow, so a
     * simultaneous manual recall can't race against the batch.
     *
     * Gated by a SEPARATE flag (_pushAllInFlight) so a user who
     * clicks a single row's Recall button mid-batch isn't blocked
     * by the batch lock — they just queue up in the bridge gate
     * behind whichever row is currently in flight.
     *
     * Each row is pushed via pushRow({ silent: true }) so the
     * batch produces ONE summary toast at the end, not one toast
     * per row. Row status still flips per-row so the operator
     * sees live progress (pushing → ok/err) in the table.
     *
     * Edge case: rows that conflict (multiple rows on the same
     * X32 slot) are still pushed — the X32 will only honor the
     * last one, and the operator can see the conflict in the
     * amber indicator + the summary toast's ok/err counts.
     */
    async pushAll() {
        if (this._pushAllInFlight) {
            this.showToast('Recall All is al bezig — wacht even.', 'error');
            return;
        }
        if (!this._x32DiscoveredPresets) {
            this.showToast('X32 niet gepolld — klik Poll eerst.', 'error');
            return;
        }
        // Eligible rows: have BOTH a slot and a channel. Locked-role
        // rows (drums / piano / keys) ARE eligible — they have
        // auto-assigned channels via _assignChannelsByRole. The X32
        // will simply not have a preset on their slot if the operator
        // didn't save one, and the bridge will reject with a clear
        // error (counted as 'err' in the summary).
        const ready = this.rosterRows.filter(function (r) {
            return r.slot != null && r.channel != null;
        });
        if (ready.length === 0) {
            this.showToast(
                'Geen recall-klare rijen — wijs eerst presets + kanalen toe.',
                'error'
            );
            this._refreshRecallAllButton();
            return;
        }
        this._pushAllInFlight = true;
        this._refreshRecallAllButton();
        const self = this;
        const summary = { ok: 0, err: 0, total: ready.length, skipped: 0 };
        const startTs = Date.now();
        // Update the button label as we go so the operator sees
        // "Recalling 3/7…" live. Done via textContent so we don't
        // fight any CSS class transitions on the button.
        const btn = document.getElementById('sb-x32-recall-all');
        const baseLabel = 'Recall All';
        const setProgress = function (i, total) {
            if (!btn) return;
            btn.textContent = 'Recalling ' + (i + 1) + '/' + total + '…';
        };
        for (let i = 0; i < ready.length; i++) {
            const row = ready[i];
            setProgress(i, ready.length);
            const statusBefore = row.status;
            try {
                await this.pushRow(row.id, { silent: true });
                // pushRow flips row.status to 'ok' or 'err' on
                // completion; 'idle' means the row was rejected
                // (e.g. hasdata=false slot). Treat 'idle' as
                // skipped so the summary distinguishes it from
                // 'ok' / 'err'.
                if (row.status === 'ok') summary.ok++;
                else if (row.status === 'err') summary.err++;
                else summary.skipped++;
            } catch (_) {
                // pushRow swallows its own errors (logs to console,
                // flips row.status). The catch here is a defensive
                // belt — a thrown AbortError or unexpected
                // exception should still let the batch continue.
                summary.err++;
            }
            // Small delay between rows so we don't hammer the
            // bridge. 80ms is empirically enough to avoid OSC
            // /libchan drops on the X32 when firing 7 recalls in
            // a row; shorter (e.g. 0ms) can produce silent
            // round-trip loss on the X32's part. Last row skips
            // the delay — no point waiting once the work is done.
            if (i < ready.length - 1) {
                await new Promise(function (resolve) { setTimeout(resolve, 80); });
            }
        }
        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
        this._pushAllInFlight = false;
        this._refreshRecallAllButton();
        const parts = [];
        parts.push(summary.ok + '/' + summary.total + ' ok');
        if (summary.err > 0) parts.push(summary.err + ' mislukt');
        if (summary.skipped > 0) parts.push(summary.skipped + ' overgeslagen');
        parts.push(elapsed + 's');
        const variant = summary.err > 0 ? 'error' : 'success';
        this.showToast('Recall All klaar: ' + parts.join(' · '), variant);
        // Keep the silent flag from leaking: the per-row pushRow
        // calls also set row.lastPushedAt / lastPushedSummary, so
        // the diagnose dump will reflect the batch. console.group
        // gives the operator a clean log of which rows hit which
        // status without needing to re-run _diagnose.
        console.log('[SB] Recall All complete', {
            duration: elapsed + 's',
            ok: summary.ok,
            err: summary.err,
            skipped: summary.skipped,
            total: summary.total,
            rows: ready.map(function (r) { return r.name + ' / ' + r.role + ' → ' + r.status; })
        });
    },

    /**
     * Refresh the Recall All button — counts recall-ready rows and
     * sets the (N/M) badge + dynamic title. Called from
     * _updateRosterMeta (so any roster / poll change reflects in
     * the count) and from pushAll (so the button label can flip
     * to "Recalling N/M…" during the batch and back to the
     * count when the batch finishes).
     *
     * The button is ALWAYS enabled — never disabled when 0 rows
     * are ready. Rationale: the operator's intent is "send
     * whatever IS ready". A disabled button reads as "broken"
     * when the roster is partially filled. The (N/M) badge
     * + dynamic title explain the state; clicking with 0 ready
     * shows a helpful toast via pushAll's existing 0-ready
     * branch ("Geen recall-klare rijen — wijs eerst presets +
     * kanalen toe.").
     */
    _refreshRecallAllButton() {
        const btn = document.getElementById('sb-x32-recall-all');
        const countEl = document.getElementById('sb-x32-recall-all-count');
        if (!btn || !countEl) return;
        if (this._pushAllInFlight) {
            // pushAll is mutating the label directly with
            // "Recalling N/M…" — leave it alone. The button
            // is disabled at the top of pushAll and re-enabled
            // in _refreshRecallAllButton at the end. So nothing
            // to do here except skip the count update.
            return;
        }
        const ready = this.rosterRows.filter(function (r) {
            return r.slot != null && r.channel != null;
        });
        const readyCount = ready.length;
        const totalCount = this.rosterRows.length;
        btn.textContent = 'Recall All';
        // Show "Recall All (N)" when no roster yet, or
        // "Recall All (N/M)" when there's a roster — the
        // fraction makes it obvious how many are still
        // missing preset/channel without forcing the
        // operator to count rows in the table.
        countEl.textContent = totalCount > 0
            ? '(' + readyCount + '/' + totalCount + ')'
            : '(' + readyCount + ')';
        // Always enabled — clicking with 0 ready shows a
        // helpful toast via pushAll. The dynamic title
        // explains what will happen so the operator isn't
        // surprised.
        btn.disabled = false;
        if (readyCount === 0) {
            btn.title = totalCount > 0
                ? 'Geen recall-klare rijen (' + totalCount + ' totaal) — wijs presets en kanalen toe. Klik om de status te controleren.'
                : 'Geen roster geladen — wacht op WorshipTools of klik om te verversen.';
        } else {
            const missing = totalCount - readyCount;
            btn.title = 'Stuur ' + readyCount + ' recall' + (readyCount === 1 ? '' : 's') +
                ' naar de X32' + (missing > 0 ? ' (' + missing + ' rij' + (missing === 1 ? '' : 'en') + ' nog niet klaar)' : '') + '.';
        }
    },

    // ------------------------------------------------------------------
    //  HELPERS — toast, escape utilities
    // ------------------------------------------------------------------

    showToast(msg, variant /* 'success' | 'error' */) {
        const toast = document.getElementById('sb-hud-alert');
        const text = document.getElementById('sb-hud-message');
        if (!toast || !text) return;
        text.textContent = msg;
        toast.classList.remove('sb-toast-error');
        if (variant === 'error') toast.classList.add('sb-toast-error');
        toast.classList.add('sb-toast-active');
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () {
            toast.classList.remove('sb-toast-active');
        }, 3500);
    },

    escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = (s == null) ? '' : String(s);
        return div.innerHTML;
    },

    escapeAttr(s) {
        return this.escapeHtml(s).replace(/"/g, '&quot;');
    },

    // -------- Disconnect-intent persistence --------
    // When the operator clicks Disconnect, we want the next view
    // re-entry to NOT auto-reconnect. Stash the intent in localStorage
    // so it survives view navigations + page reloads. Manual Connect
    // clears it. Auto-connect (silent) leaves it alone — the operator
    // never asked for that, so we don't pretend they did.

    _setUserDisconnectedFlag(value) {
        try {
            if (value) {
                localStorage.setItem('ichtus.sb.userDisconnected', '1');
            } else {
                localStorage.removeItem('ichtus.sb.userDisconnected');
            }
        } catch (_) { /* private mode — silently no-op */ }
    },

    _isUserDisconnected() {
        try {
            return localStorage.getItem('ichtus.sb.userDisconnected') === '1';
        } catch (_) { return false; }
    },

    // -------- Debug logging --------
    // `_sbDebugLog` is the single funnel for [SB] console output. By
    // default it only logs high-level events (init/roster/status/
    // connect/poll/auto-suggest summary) — enough to see the chain
    // end-to-end without spamming the console. When verbose mode is
    // enabled (via `_setSbDebug(true)` or
    // `localStorage['ichtus.sb.debug'] = '1'`, then reload), the
    // per-row scoring in `_scoreMatch` also logs every (row, slot)
    // pair so the operator can see WHY a specific name didn't match.
    _sbDebugLog(msg) {
        // Gated on `this._sbDebug` so the operator can silence the
        // high-level [SB] events at runtime via
        // `stagebuilderModule._setSbDebug(false)` or by setting
        // `localStorage['ichtus.sb.debug'] = '0'` and reloading. The
        // diagnose function below still works regardless of this flag
        // because it logs via `console.group` directly.
        if (!this._sbDebug) return;
        try { console.log('[SB] ' + msg); } catch (_) { /* no console */ }
    },

    _setSbDebug(on) {
        this._sbDebug = !!on;
        try {
            if (on) localStorage.setItem('ichtus.sb.debug', '1');
            else    localStorage.removeItem('ichtus.sb.debug');
        } catch (_) {}
        console.log('[SB] verbose debug = ' + this._sbDebug +
            ' — call stagebuilderModule._diagnose() from the dev console to dump the full state.');
    },

    /**
     * Print the full Stage Builder state to the console. Use from
     * devtools when auto-detection is misbehaving:
     *   > stagebuilderModule._diagnose()
     * Returns the same data so it can be inspected programmatically.
     */
    _diagnose() {
        const occ = (this._x32DiscoveredPresets || {});
        const occupied = Object.entries(occ)
            .filter(function (e) { return e[1] && e[1].hasdata; })
            .map(function (e) { return e[0] + '="' + (e[1].name || '(naamloos)') + '"'; });
        const grouped = {
            'Connection': {
                'session connected': this._x32SessionConnected,
                'connect in flight': this._x32ConnectInFlight,
                'bridge fetch in flight': this._x32BridgeFetchInFlight,
                'X32 IP': this._getX32Ip(),
                'user disconnected (intent)': this._isUserDisconnected()
            },
            'Roster': {
                'rosterStatus': this.rosterStatus,
                'rosterRows count': this.rosterRows.length,
                'roster raw count': (this.roster || []).length,
                'roster sample (first 3)': (this.roster || []).slice(0, 3).map(function (r) {
                    return r.name + ' / ' + (r.role || '—');
                })
            },
            'Presets (X32)': {
                'cached presets total': Object.keys(occ).length,
                'occupied (hasdata=true)': occupied.length,
                'lastPolled': this._x32LastPolled,
                'first 10 occupied': occupied.slice(0, 10)
            },
            'Per-row state': this.rosterRows.map(function (r) {
                return {
                    name: r.name,
                    role: r.role,
                    slot: r.slot == null ? '—' : '#' + String(r.slot + 1).padStart(3, '0'),
                    autoSlot: r.autoSlot == null ? '—' : '#' + String(r.autoSlot + 1).padStart(3, '0'),
                    channel: r.channel == null ? '—' : 'CH ' + String(r.channel).padStart(2, '0'),
                    status: r.status
                };
            }),
            'Auto-suggest internals': {
                '_allFirstNames (every roster first-name)': this._allFirstNames ?
                    Array.from(this._allFirstNames) : null,
                'localStorage mapping keys': (function () {
                    const out = [];
                    try {
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            if (k && k.indexOf('ichtus.sb.assign.') === 0) out.push(k);
                        }
                    } catch (_) {}
                    return out;
                })()
            }
        };
        try {
            console.group('[SB] DIAGNOSE — stage builder state dump');
            for (const [section, data] of Object.entries(grouped)) {
                console.groupCollapsed(section);
                console.log(data);
                console.groupEnd();
            }
            console.groupEnd();
        } catch (_) { /* no console */ }
        return grouped;
    }
};

// Expose for inline onclick handlers in the rendered HTML above.
window.stagebuilderModule = stagebuilderModule;
