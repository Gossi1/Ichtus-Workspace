/* ============================================
   Ichtus Extension Popup
   Single job: detect a WorshipTools service page on the active tab,
   show a Sync data button that triggers content.js's runAllTeamsSync.
   ============================================ */

const extVersionEl = document.getElementById('ext-version');
const wtContent = document.getElementById('wt-content');
const linkExt = document.getElementById('open-chrome-ext');

// ---- Render the extension version badge from the manifest ----
(function showVersion() {
    try {
        const manifest = chrome.runtime.getManifest();
        extVersionEl.textContent = 'v' + (manifest.version || '?');
    } catch (_) {}
})();

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function classifyWorshiptoolsUrl(url) {
    // Returns one of:
    //   { kind: 'service' }        → /app/account/{uuid}/service/{uuid} → sync enabled
    //   { kind: 'wt-not-service' } → on worshiptools.com but not a service page → sync disabled
    //   { kind: 'none' }           → not on worshiptools.com at all           → hidden
    if (typeof url !== 'string') return { kind: 'none' };
    if (!/worshiptools\.com\//i.test(url)) return { kind: 'none' };
    if (/\/app\/account\/[^/]+\/service\/[^/?#]+/i.test(url)) return { kind: 'service', url };
    return { kind: 'wt-not-service', url };
}

function renderWTMissing(scan) {
    let detail = '';
    if (scan && scan.isWorshiptoolsPage === false) {
        detail = '<div class="wt-empty" style="margin-top:6px;">'
               + 'Open een dienstpagina op planning.worshiptools.com om data te kunnen syncen.'
               + '</div>';
    } else if (scan && scan.error) {
        detail = '<div class="wt-empty" style="margin-top:6px;color:var(--red);">'
               + 'Fout bij scannen: ' + escapeHtml(scan.error)
               + '</div>';
    } else if (scan && scan.isWorshiptoolsPage && scan.detected === undefined) {
        // URL pointed at WT but the content script didn't return a
        // "detected" block — typically means it isn't injected yet.
        detail = '<div class="wt-empty" style="margin-top:6px;color:var(--red);">'
               + 'Content-script niet geladen — ververs de pagina.'
               + '</div>';
    }
    wtContent.innerHTML =
          '<div class="status-row">'
        +   '<span class="status-dot offline"></span>'
        +   '<span>Geen elementen gevonden</span>'
        + '</div>'
        + detail;
}

function renderWTDetected() {
    // Minimal banner — status dot + the Sync button. We don't depend
    // on a DOM pre-scan; the content script tells us what it found
    // (or didn't find) once Sync actually runs.
    wtContent.innerHTML =
          '<div class="status-row">'
        +   '<span class="status-dot online"></span>'
        +   '<span style="font-weight:600;">WorshipTools actief — dienstpagina</span>'
        + '</div>'
        + '<button class="btn btn-primary" id="btn-wt-sync" style="margin-top:10px;">'
        +   '<span id="wt-btn-icon">⏵</span>'
        +   '<span id="wt-btn-text">Sync data</span>'
        + '</button>'
        + '<div class="output-area" id="wt-output"></div>';

    document.getElementById('btn-wt-sync').addEventListener('click', handleWTSync);
}

function renderWTOnAccount() {
    // On WorshipTools but not on a /service/{uuid} page (e.g. the
    // account dashboard, song library, settings page). Show the Sync
    // button disabled so the user knows WHY it isn't actionable, plus
    // a hint pointing them to the right page.
    wtContent.innerHTML =
          '<div class="status-row">'
        +   '<span class="status-dot warning"></span>'
        +   '<span style="font-weight:600;">WorshipTools actief</span>'
        + '</div>'
        + '<div class="wt-empty" style="margin-top:6px;">'
        +   'Open een <code>/app/account/&hellip;/service/&hellip;</code> pagina om te syncen.'
        + '</div>'
        + '<button class="btn btn-primary" id="btn-wt-sync" disabled '
        +     'title="Open eerst een dienstpagina" style="margin-top:10px;">'
        +   '<span id="wt-btn-icon">⏵</span>'
        +   '<span id="wt-btn-text">Sync data</span>'
        + '</button>'
        + '<div class="output-area" id="wt-output"></div>';

    const btn = document.getElementById('btn-wt-sync');
    btn.addEventListener('click', function () {
        appendWTOutput('Open eerst een dienstpagina voordat je kunt syncen.', 'error');
    });
}

function appendWTOutput(text, cls) {
    const area = document.getElementById('wt-output');
    if (!area) return;
    const line = document.createElement('div');
    line.textContent = text;
    if (cls) line.className = cls;
    area.appendChild(line);
    area.scrollTop = area.scrollHeight;
}

async function renderActiveTab() {
    // Three URL states drive the UI:
    //   1) /app/account/<uuid>/service/<uuid>  → Sync enabled (green dot)
    //   2) worshiptools.com, but other page    → Sync visible, disabled (orange dot)
    //   3) anything else                      → no Sync UI (red dot)
    // No DOM pre-scan: we never depend on the content script being
    // warm-injected before showing the Sync button.
    let tab;
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs && tabs[0];
    } catch (_) {
        tab = null;
    }
    if (!tab || !tab.id) { renderWTMissing({}); return; }

    const cls = classifyWorshiptoolsUrl(tab.url || '');
    if (cls.kind === 'service') {
        renderWTDetected();
    } else if (cls.kind === 'wt-not-service') {
        renderWTOnAccount();
    } else {
        renderWTMissing({ isWorshiptoolsPage: false });
    }
}

async function handleWTSync() {
    const btn = document.getElementById('btn-wt-sync');
    const icon = document.getElementById('wt-btn-icon');
    const text = document.getElementById('wt-btn-text');
    if (!btn || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    icon.textContent = '⏳';
    text.textContent = 'Synchroniseren…';
    btn.classList.add('wt-syncing');

    const out = document.getElementById('wt-output');
    if (out) out.innerHTML = '';
    appendWTOutput('Sync gestart…');

    let tab;
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs && tabs[0];
    } catch (_) {}
    if (!tab || !tab.id) {
        appendWTOutput('Geen actieve tab gevonden.', 'error');
        resetWTSyncButton(btn, icon, text);
        return;
    }

    let reply = null;
    let injectedOnDemand = false;
    try {
        try {
            reply = await chrome.tabs.sendMessage(tab.id, { type: 'WT_START_SYNC' });
        } catch (err) {
            const msg = (err && err.message) || String(err);
            const noReceiver = msg.includes('Receiving end does not exist')
                             || msg.includes('Could not establish connection');
            if (!noReceiver) {
                appendWTOutput('❌ Communicatie met content-script mislukt: ' + msg, 'error');
                return;
            }
            // No receiver: the page was open before the (new) content script
            // got injected (extension reload / update / first install on an
            // already-open tab). Inject it on demand, then retry once.
            try {
                appendWTOutput('Content-script niet aanwezig — injecteren…');
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                // Give the script a moment to register its onMessage listener
                await new Promise(r => setTimeout(r, 120));
                injectedOnDemand = true;
                reply = await chrome.tabs.sendMessage(tab.id, { type: 'WT_START_SYNC' });
            } catch (injectErr) {
                const reason = (injectErr && injectErr.message) || String(injectErr);
                appendWTOutput('⚠ Kon content-script niet injecten op deze pagina.', 'error');
                appendWTOutput('Oorzaak: ' + reason, 'error');
                appendWTOutput('Vernieuw de pagina (F5) en probeer opnieuw.', 'error');
                appendWTRetryButton(handleWTSync);
                return;
            }
        }

        if (reply && reply.ok) {
            const note = injectedOnDemand ? ' (na auto-inject)' : '';
            appendWTOutput('✅ Sync voltooid' + note + '.');
        } else if (reply) {
            appendWTOutput('❌ Sync mislukt: ' + (reply && reply.error || 'onbekend'), 'error');
        }
    } finally {
        resetWTSyncButton(btn, icon, text);
    }
}

// Adds a "Probeer opnieuw" button as the last line in the output area.
// Clicking it removes itself and re-runs the supplied action.
function appendWTRetryButton(action) {
    const area = document.getElementById('wt-output');
    if (!area) return;
    const wrap = document.createElement('div');
    wrap.className = 'wt-retry-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn wt-retry-btn';
    btn.textContent = 'Probeer opnieuw';
    btn.addEventListener('click', function () {
        wrap.remove();
        action();
    });
    wrap.appendChild(btn);
    area.appendChild(wrap);
    area.scrollTop = area.scrollHeight;
}

function resetWTSyncButton(btn, icon, text) {
    if (!btn) return;
    btn.dataset.busy = '0';
    btn.disabled = false;
    btn.classList.remove('wt-syncing');
    icon.textContent = '⏵';
    text.textContent = 'Sync data';
}

// ---- Progress broadcasts from content script while runAllTeamsSync runs ----
chrome.runtime.onMessage.addListener(function (message) {
    if (!message) return;
    if (message.type === 'WT_SYNC_PROGRESS') {
        if (message.phase === 'complete') {
            renderResultCard(message.payload || {});
            return;
        }
        const out = document.getElementById('wt-output');
        if (!out) return;
        if (message.phase === 'log' && message.payload && message.payload.msg) {
        appendWTOutput(message.payload.msg);
    } else if (message.phase === 'start') {
        appendWTOutput('Teams aan’ het laden…');
    } else if (message.phase === 'done') {
        if (message.payload && message.payload.ok) {
            appendWTOutput('✅ Klaar.', 'success');
        } else {
            appendWTOutput('❌ ' + (message.payload && message.payload.error || 'mislukt'), 'error');
        }
    }
        return;
    }

    // Pending-IDs queue updated (from background.js after UNMATCHED_SONGS
    // or ID_ASSIGNED). Re-render the queue.
    if (message.type === 'PENDING_SONGS_UPDATED') {
        const songs = (message.payload && message.payload.songs) || [];
        renderPendingSongs(songs);
        return;
    }
});

/**
 * Replace the output area with a polished summary card showing the
 * numbers from the sync. Called when the content script sends a
 * `phase: 'complete'` broadcast.
 *
 * The card adapts to the payload shape:
 *   ok: true  -> green-bordered stats card: teams / people / assignments.
 *   ok: false -> red-bordered error card with a single message.
 */
function renderResultCard(payload) {
    const out = document.getElementById('wt-output');
    if (!out) return;

    if (!payload.ok) {
        const reasonText = payload.summary
            ? ({ 'no-team-switcher': 'Geen team-switcher op deze pagina.',
                 'no-roster':         'Geen rollen gevonden in de gescande teams.',
                 'error':             payload.summary.error || 'Onbekende fout.' })[payload.summary.reason] || 'Sync mislukt.'
            : 'Sync mislukt.';
        out.innerHTML =
              '<div class="result-card error">'
            +   '<div class="result-headline">'
            +     '<span class="result-glyph">⚠</span>'
            +     '<span class="result-title">Sync mislukt</span>'
            +   '</div>'
            +   '<div class="result-detail">' + escapeHtml(reasonText) + '</div>'
            + '</div>';
        return;
    }

    const s = payload.summary || {};
    const teams = s.teamsScanned || 0;
    const skipped = s.skippedTeams || 0;
    const people = s.people || 0;
    const assignments = s.assignments || 0;
    const songs = s.songs || 0;
    const skippedLine = skipped > 0
        ? '<div class="result-row">'
          +   '<span class="result-key">Overgeslagen (kids/jeugd):</span>'
          +   '<span class="result-val">' + skipped + '</span>'
          + '</div>'
        : '';

    out.innerHTML =
          '<div class="result-card success">'
        +   '<div class="result-headline">'
        +     '<span class="result-glyph">✅</span>'
        +     '<span class="result-title">Sync voltooid</span>'
        +   '</div>'
        +   '<div class="result-grid">'
        +     '<div class="result-stat">'
        +       '<div class="result-stat-num">' + teams + '</div>'
        +       '<div class="result-stat-label">teams</div>'
        +     '</div>'
        +     '<div class="result-stat">'
        +       '<div class="result-stat-num">' + people + '</div>'
        +       '<div class="result-stat-label">personen</div>'
        +     '</div>'
        +     '<div class="result-stat">'
        +       '<div class="result-stat-num">' + assignments + '</div>'
        +       '<div class="result-stat-label">rol-toewijzingen</div>'
        +     '</div>'
        +     '<div class="result-stat">'
        +       '<div class="result-stat-num">' + songs + '</div>'
        +       '<div class="result-stat-label">liedjes</div>'
        +     '</div>'
        +   '</div>'
        +   skippedLine
        + '</div>';
}

if (linkExt) {
    linkExt.addEventListener('click', function (e) {
        e.preventDefault();
        chrome.tabs.create({ url: 'chrome://extensions' });
    });
}

// ───── Pending ID queue (id assigner) ─────
//
// Render the list of WT songs that the SPA couldn't auto-match after
// the last sync. Each chip sends OPEN_ASSIGNER_FOR_SONG to whichever
// SPA tab is open, so the assigner UI can pick it up.

const pendingSection = document.getElementById('pending-section');
const pendingCountEl = document.getElementById('pending-count');
const pendingListEl  = document.getElementById('pending-list');
const pendingClearAllBtn = document.getElementById('btn-pending-clear-all');

function renderPendingSongs(songs) {
    if (!pendingSection || !pendingListEl || !pendingCountEl) return;
    const list = Array.isArray(songs) ? songs : [];
    if (!list.length) {
        pendingSection.classList.add('hidden');
        pendingListEl.innerHTML = '';
        pendingCountEl.textContent = '0';
        if (pendingClearAllBtn) pendingClearAllBtn.classList.add('hidden');
        return;
    }
    pendingSection.classList.remove('hidden');
    pendingCountEl.textContent = String(list.length);
    pendingListEl.innerHTML = list.map(songChipHtml).join('');
    // The chip button itself = open in SPA. The inner × button = remove.
    // Stop propagation on × so it never bubbles up to the chip click.
    for (const chipBtn of pendingListEl.querySelectorAll('.pending-chip')) {
        chipBtn.addEventListener('click', onPendingChipClick);
    }
    for (const delBtn of pendingListEl.querySelectorAll('.pending-chip-delete')) {
        delBtn.addEventListener('click', onPendingDeleteClick);
    }
    if (pendingClearAllBtn) pendingClearAllBtn.classList.remove('hidden');
}

function songChipHtml(s) {
    const hasCode = !!(s.code && String(s.code).trim());
    const code = hasCode ? escapeHtml(s.code) : '—';
    const title = escapeHtml(s.title || '(geen titel)');
    const key = s.key ? '<span class="pending-chip-key">' + escapeHtml(s.key) + '</span>' : '';
    // Orphan = no WT code (extension-side orphan-sweep surfaced it).
    // Use a dashed border + em-dash code badge so it's visually distinct
    // from coded items that came from the SPA's UNMATCHED_SONGS.
    const chipClass = hasCode ? 'pending-chip' : 'pending-chip pending-chip-orphan';
    const orphanHint = hasCode ? '' : ' <span class="pending-chip-hint">geen WT-code</span>';
    const orphanTitle = hasCode
        ? 'Wijs een interne ID toe in de SPA'
        : 'Liedje zonder WT-code — wijs handmatig een ID toe in de SPA';
    // The × button lives INSIDE the chip but stops propagation so clicking
    // it doesn't trigger the chip's own click handler (which opens the SPA).
    const deleteBtn = '<button type="button" class="pending-chip-delete" '
        + 'title="Verwijder uit de queue (alsof toegewezen)" aria-label="Verwijder">'
        + '\u00d7</button>';
    return ''
        + '<button class="' + chipClass + '" type="button" '
        +       'data-code="' + escapeHtml(s.code || '') + '" '
        +       'data-title="' + title + '" '
        + ((s.key) ? 'data-key="' + escapeHtml(s.key) + '" ' : '')
        +       'title="' + orphanTitle + '">'
        +   '<span class="pending-chip-code">' + code + '</span>'
        +   '<span class="pending-chip-title">' + title + orphanHint + '</span>'
        +   key
        +   deleteBtn
        + '</button>';
}

async function onPendingChipClick(e) {
    const btn = e.currentTarget;
    const code = btn.dataset.code;
    const title = btn.dataset.title;
    const key = btn.dataset.key || null;
    if (!code) return;
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="pending-chip-code">' + escapeHtml(code) + '</span>'
                  + '<span class="pending-chip-title">Openen in SPA…</span>';
    try {
        const reply = await chrome.runtime.sendMessage({
            type: 'OPEN_ASSIGNER_FOR_SONG',
            payload: { code, title, key }
        });
        if (reply && reply.success) {
            btn.innerHTML = '<span class="pending-chip-code">' + escapeHtml(code) + '</span>'
                          + '<span class="pending-chip-title">Doorgestuurd ✓</span>';
        } else {
            btn.disabled = false;
            btn.innerHTML = oldHtml;
            const reason = (reply && reply.error === 'no-spa-tab')
                ? 'Geen SPA-tabblad open. Open Ichtus SPA en probeer opnieuw.'
                : 'Doorsturen mislukt (' + ((reply && reply.error) || 'onbekend') + ').';
            appendWTOutput('❌ ' + reason, 'error');
        }
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
        appendWTOutput('❌ Communicatie met background mislukt: ' + (err && err.message || err), 'error');
    }
}

async function fetchPendingSongs() {
    try {
        const reply = await chrome.runtime.sendMessage({ type: 'GET_PENDING_SONGS' });
        const songs = (reply && reply.songs) || [];
        renderPendingSongs(songs);
    } catch (_) {
        // background SW may be cold-starting — show empty queue
        renderPendingSongs([]);
    }
}

// ───── Pending queue management from the popup ─────
//
// Per-chip × → remove just that one item from the queue (treated as
// "user handled it"). Global "Wis alles" → clear the entire queue.
// Both go through ID_ASSIGNED, which is the same code path the SPA
// uses when it assigns a song; the extension just decides to remove
// the entry locally with an internal_id marker that signals
// "operator-side dismissal" so the SPA doesn't try to re-add it.

async function onPendingDeleteClick(e) {
    e.stopPropagation();   // don't bubble to the chip (which would open SPA)
    const delBtn = e.currentTarget;
    const chipBtn = delBtn.closest('.pending-chip');
    if (!chipBtn) return;
    const code = chipBtn.dataset.code || '';
    const title = chipBtn.dataset.title || '';

    delBtn.disabled = true;
    try {
        await chrome.runtime.sendMessage({
            type: 'ID_ASSIGNED',
            payload: {
                code: code || title,   // fall back to title for no-code orphans (pendingKeyOf matches on title for them)
                internal_id: 'POPUP-DISMISSED'
            }
        });
        // PENDING_SONGS_UPDATED broadcast will re-render the queue.
    } catch (err) {
        delBtn.disabled = false;
        appendWTOutput('❌ Verwijderen mislukt: ' + (err && err.message || err), 'error');
    }
}

async function onClearAllPendingClick() {
    if (!pendingClearAllBtn) return;
    const codes = Array.from(pendingListEl.querySelectorAll('.pending-chip'))
        .map(b => b.dataset.code || b.dataset.title || '');
    if (!codes.length) return;
    pendingClearAllBtn.disabled = true;
    const oldLabel = pendingClearAllBtn.textContent;
    pendingClearAllBtn.textContent = 'Wissen…';
    try {
        const reply = await chrome.runtime.sendMessage({
            type: 'CLEAR_PENDING',
            payload: { codes }
        });
        if (reply && reply.success) {
            pendingClearAllBtn.textContent = '✓ Gewist (' + (reply.removed || codes.length) + ')';
            setTimeout(() => {
                if (pendingClearAllBtn) {
                    pendingClearAllBtn.textContent = oldLabel;
                    pendingClearAllBtn.disabled = false;
                }
            }, 1200);
        } else {
            pendingClearAllBtn.disabled = false;
            pendingClearAllBtn.textContent = oldLabel;
            appendWTOutput('❌ Wissen mislukt: ' + ((reply && reply.error) || 'onbekend'), 'error');
        }
    } catch (err) {
        pendingClearAllBtn.disabled = false;
        pendingClearAllBtn.textContent = oldLabel;
        appendWTOutput('❌ Communicatie met background mislukt: ' + (err && err.message || err), 'error');
    }
}

if (pendingClearAllBtn) {
    pendingClearAllBtn.addEventListener('click', onClearAllPendingClick);
}

// ---- Kick off ----
renderActiveTab();
fetchPendingSongs();
