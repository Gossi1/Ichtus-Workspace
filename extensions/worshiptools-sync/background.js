/**
 * Background Script for WorshipTools to Ichtus SPA Bridge
 * Relays setlist extraction messages from WorshipTools tabs to Ichtus SPA tabs.
 *
 * IMPORTANT MV3 NOTES
 * ===================
 * - Service workers can be terminated by Chrome at any time (~30s idle).
 *   All in-memory variables are LOST on restart. We use chrome.storage.session
 *   (which survives SW restarts) to persist the latest extracted data.
 * - chrome.tabs.sendMessage to an SPA tab requires the content script
 *   (spa-bridge.js) to be already injected. Use promise.catch() to detect
 *   when the bridge isn't ready yet, and retry with a small delay.
 * - tab.url is populated for all tabs when the extension declares the
 *   "tabs" permission AND the host_permissions match the tab URL.
 *   We now include *://localhost/* and *://127.0.0.1/* in host_permissions
 *   so localhost SPA tabs are correctly detected.
 */

// In-memory cache (fast path — survives only while the SW is alive)
let inMemSetlist = null;
let inMemDate = null;
let inMemRoster = null;
let inMemStructured = null;
let inMemLibrary = null;

// Storage keys for chrome.storage.session
const STORAGE_KEYS = {
  SETLIST: 'lastExtractedSetlist',
  DATE: 'lastServiceDate',
  ROSTER: 'lastExtractedRoster',
  LIBRARY: 'lastExtractedLibrary'
};

/** Persist data to chrome.storage.session so it survives SW restarts */
async function persistToSession(key, value) {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (err) {
    console.warn('[BG] session.set failed for', key, err?.message);
  }
}

/** Read data from chrome.storage.session */
async function readFromSession(key) {
  try {
    const result = await chrome.storage.session.get(key);
    return result[key] ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Detect SPA tabs — match by URL patterns AND page title. Returns an array
 * of tab objects that look like the Ichtus Workspace SPA.
 *
 * In MV3, tab.url is populated for tabs matching the extension's
 * host_permissions. For file:// URLs we also check the page title as a
 * fallback, because file:// tabs sometimes return undefined for tab.url
 * when the extension doesn't have the "Allow access to file URLs" toggle
 * enabled — but title detection lets us catch that case and warn.
 */
function findSpaTabs(senderTabId) {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      const spaTabs = tabs.filter(tab => {
        const url = (tab.url || '').toLowerCase();
        const title = (tab.title || '').toLowerCase();
        const isSpa =
          // URL contains Ichtus-related path
          url.includes('ichtus_spa') ||
          url.includes('ichtus') ||
          url.includes('localhost') ||
          url.includes('127.0.0.1') ||
          // For file:// tabs without URL match, check page title
          title.includes('ichtus') ||
          title.includes('workspace');
        return isSpa && tab.id !== senderTabId;
      });
      resolve(spaTabs);
    });
  });
}

/**
 * Send a message to a specific tab, with optional retry on failure.
 * The retry helps with a race condition where spa-bridge.js hasn't
 * finished loading yet when the first sendMessage fires.
 */
async function sendWithRetry(tabId, message, maxRetries = 3, delayMs = 500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      console.log('[BG] Tab', tabId, 'received OK (attempt', attempt + ')');
      return true;
    } catch (err) {
      if (attempt < maxRetries) {
        console.log('[BG] Tab', tabId, 'attempt', attempt, 'failed — retrying in', delayMs + 'ms', err?.message);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.warn('[BG] Tab', tabId, 'all', maxRetries, 'attempts failed — content script not injected?', err?.message);
        return false;
      }
    }
  }
  return false;
}

/**
 * Forward extracted data to all open SPA tabs. If no SPA tabs are found
 * on the first try, schedule up to {@code maxRetries} re-attempts at
 * {@code intervalMs} intervals. This covers the race where the user
 * extracts the setlist before the SPA tab has finished loading.
 *
 * Cancellation: if forwardToSpaTabs is called again for the same {@code type}
 * while a retry chain is still running, the old chain is cancelled
 * (via the per-type timer reference in {@code _forwardRetryTimers}).
 * This prevents duplicate deliveries when the user clicks Extract twice.
 */
const _forwardRetryTimers = {};

async function forwardToSpaTabs(senderTabId, type, data, date, structured, maxRetries = 6, intervalMs = 2000) {
  // Cancel any pending retry for the same type (dedup)
  if (_forwardRetryTimers[type]) {
    clearTimeout(_forwardRetryTimers[type]);
    delete _forwardRetryTimers[type];
  }

  const message = { type, data };
  if (date) message.date = date;
  if (structured) message.structured = structured;

  async function attempt(remaining) {
    const spaTabs = await findSpaTabs(senderTabId);
    console.log('[BG] Forwarding', type, '— found', spaTabs.length, 'SPA tabs (retries left:', remaining, ')');

    if (spaTabs.length > 0) {
      const results = await Promise.allSettled(
        spaTabs.map(tab => sendWithRetry(tab.id, message))
      );
      const succeeded = results.filter(r => r.value === true).length;
      if (succeeded < spaTabs.length) {
        console.warn('[BG] Delivered to', succeeded, '/', spaTabs.length, 'SPA tabs');
      }
      return;
    }

    if (remaining > 0) {
      console.log('[BG] No SPA tabs found — retrying in', intervalMs + 'ms');
      _forwardRetryTimers[type] = setTimeout(() => {
        delete _forwardRetryTimers[type];
        attempt(remaining - 1);
      }, intervalMs);
    } else {
      console.warn('[BG] No SPA tabs found after all retries — data cached for retrieval via ichtus-setlist-ready');
    }
  }

  attempt(maxRetries);
}

// ───── Dynamic SPA bridge injection ─────
//
// For dev servers on non-standard ports (e.g. localhost:8080), the
// content_scripts match patterns in manifest.json may not cover every
// port the operator uses. We watch for new tabs whose URL or title
// suggests they are the Ichtus SPA, and inject spa-bridge.js dynamically
// if it isn't already running.
//
// This is a belt-and-suspenders fallback: pages whose port IS in the
// manifest will get the bridge via Chrome's built-in injection (faster),
// while pages on unexpected ports get it here.
//
const SPA_PATTERNS = [
  /\/Ichtus_SPA(\/|$)/i,
  /localhost:\d+\/Ichtus_SPA/i,
  /127\.0\.0\.1:\d+\/Ichtus_SPA/i,
  /\d+\.\d+\.\d+\.\d+:\d+\/Ichtus_SPA/i,  // any IP:port
  /ichtus.*workspace/i
];

function looksLikeSpaTab(tab) {
  if (!tab || !tab.id) return false;
  const url = (tab.url || '');
  const title = (tab.title || '');
  return SPA_PATTERNS.some(p => p.test(url) || p.test(title));
}

async function ensureBridgeInjected(tabId) {
  // Session-storage guard: prevents double-injection into the same tab
  // across rapid reloads or races where the ping fails but the bridge
  // finishes loading between the try and the catch. The flag is stored
  // per tabId and cleaned up when the tab closes (the background SW
  // forgets it on restart, which is fine because onUpdated re-checks).
  const guardKey = `bridgeInjected_${tabId}`;
  const guard = await readFromSession(guardKey);
  if (guard) {
    return; // already injected in this session
  }

  try {
    // Check if bridge is already present by sending a ping
    await chrome.tabs.sendMessage(tabId, { type: 'BRIDGE_PING' });
    await persistToSession(guardKey, true);
    return;
  } catch (_) {
    // Not injected — inject it now
    console.log('[BG] Injecting spa-bridge.js into tab', tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['spa-bridge.js']
      });
      await persistToSession(guardKey, true);
      console.log('[BG] spa-bridge.js injected OK into tab', tabId);
    } catch (injErr) {
      console.warn('[BG] Could not inject spa-bridge.js into tab', tabId, injErr?.message);
    }
  }
}

// Watch for new/updated tabs that might be the Ichtus SPA
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && looksLikeSpaTab(tab)) {
    console.log('[BG] Tab appears to be Ichtus SPA:', tab.url || tab.title);
    ensureBridgeInjected(tabId);
  }
});

// Also check existing tabs on startup (service worker may have restarted)
chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    if (tab.url && looksLikeSpaTab(tab) && tab.id) {
      console.log('[BG] Found existing SPA tab on startup:', tab.url || tab.title);
      ensureBridgeInjected(tab.id);
    }
  }
});

// ───── Static action metadata ─────
//
// Update notifications were removed: the extension is unpacked / loaded
// from disk, so the operator already updates via git pull + chrome://
// extensions → 🔄. We just keep the action title static and clear any
// stale badge that might be left over from a previous build.
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
    chrome.action.setTitle({
      title: 'WorshipTools Sync (v' + (chrome.runtime.getManifest().version || '?') + ')'
    });
  } catch (_) {}
});

// ───── Pending unmatched songs (id assigner queue) ─────
//
// Flow:
//   1. SPA receives SETLIST_RECEIVED from us, runs its song-library
//      lookup, and finds some WT items with no matching internal ID.
//   2. SPA sends UNMATCHED_SONGS back to us (chrome.runtime.sendMessage
//      from a SPA tab; lands in this listener).
//   3. We merge into session storage (deduped by WT code) and
//      broadcast PENDING_SONGS_UPDATED to the popup.
//   4. Popup shows the queue and lets the operator click a chip to
//      send OPEN_ASSIGNER_FOR_SONG back to the SPA, which opens
//      its assigner UI with the WT song data prefilled.
//   5. When the SPA finishes assigning, it sends ID_ASSIGNED and we
//      remove that entry from the queue, broadcasting again so the
//      popup updates live.
//
let inMemPendingSongs = [];        // [{ code, title, key?, addedAt }]
const PENDING_KEY = 'pendingUnmatchedSongs';

async function loadPendingSongs() {
    if (inMemPendingSongs.length) return inMemPendingSongs;
    inMemPendingSongs = await readFromSession(PENDING_KEY) || [];
    return inMemPendingSongs;
}

async function savePendingSongs() {
    await persistToSession(PENDING_KEY, inMemPendingSongs);
}

// Dedupe key: a coded item is identified by its WT code.
// An uncoded item (songs that show up in the setlist with no
// "O638"/"D131" prefix at all, e.g. "Throne Room Song") can't use
// `code` because every such item would collapse to the same key.
// For those, fall back to the title so each unique title is one entry.
function pendingKeyOf(s) {
    if (s.code) return 'code:' + String(s.code).toLowerCase();
    const t = String(s.title || '').trim().toLowerCase();
    return t ? 'title:' + t : null;
}

async function mergePendingSongs(newSongs) {
    if (!Array.isArray(newSongs)) return [];
    const incoming = newSongs
        .filter(s => s && (s.code || s.title || s.name))
        .map(s => ({
            code: s.code ? String(s.code) : null,
            title: String(s.title || s.name || ''),
            key: s.key ? String(s.key) : null,
            noCode: !s.code,
            source: s.source || (s.code ? 'spa' : 'extension'),
            addedAt: Date.now()
        }))
        .filter(s => pendingKeyOf(s));
    const existingKeys = new Set(inMemPendingSongs.map(pendingKeyOf));
    const fresh = incoming.filter(s => !existingKeys.has(pendingKeyOf(s)));
    inMemPendingSongs = inMemPendingSongs.concat(fresh);
    await savePendingSongs();
    return fresh;
}

// Remove a single pending entry. `codeOrKey` may be either the WT
// code (e.g. "O638") or, for orphan items (code: null), the song
// title. Match is case-insensitive on both fields to maximize chance
// of hitting the right entry when the popup sends whatever it has on
// the chip's data attributes.
async function removePendingSong(codeOrKey) {
    const before = inMemPendingSongs.length;
    const needle = String(codeOrKey || '').toLowerCase().trim();
    if (!needle) return false;
    inMemPendingSongs = inMemPendingSongs.filter(s => {
        const code = String(s.code || '').toLowerCase();
        const title = String(s.title || '').toLowerCase();
        return code !== needle && title !== needle;
    });
    if (inMemPendingSongs.length !== before) {
        await savePendingSongs();
        return true;
    }
    return false;
}

function broadcastPendingSongs() {
    try {
        chrome.runtime.sendMessage({
            type: 'PENDING_SONGS_UPDATED',
            payload: { songs: inMemPendingSongs }
        });
    } catch (_) {
        // popup not open — ignore (popup pulls via GET_PENDING_SONGS on init)
    }
}

// Forward the current pending-IDs queue to every open SPA tab so the
// SPA-side ID assigner can:
//   - show a banner: "Er wachten 3 liedjes op een ID — bekijk ze"
//   - light up its own badge in the tab title
//   - pre-populate its filters when the user opens the assigner
//
// We send the FULL queue every time (not just deltas) so the SPA can
// reconcile its own internal state from this single source of truth.
async function forwardPendingSongsToSpaTabs() {
    try {
        const spaTabs = await findSpaTabs();
        if (!spaTabs.length) {
            console.log('[BG] PENDING_SONGS_FOR_ASSIGNER — no SPA tabs open');
            return;
        }
        const msg = {
            type: 'PENDING_SONGS_FOR_ASSIGNER',
            payload: {
                songs: inMemPendingSongs || [],
                serviceDate: inMemDate || null
            }
        };
        const results = await Promise.allSettled(
            spaTabs.map(tab => sendWithRetry(tab.id, msg))
        );
        const ok = results.filter(r => r.value === true).length;
        console.log('[BG] PENDING_SONGS_FOR_ASSIGNER delivered to',
                    ok, '/', spaTabs.length, 'SPA tab(s)');
    } catch (err) {
        console.warn('[BG] forwardPendingSongsToSpaTabs failed:', err && err.message || err);
    }
}

// One call to fan out a queue change everywhere it needs to be seen:
//   1. popup (broadcast)
//   2. toolbar badge + desktop notification (chrome.action / chrome.notifications)
//   3. every open SPA tab (chrome.tabs.sendMessage via forwardPendingSongsToSpaTabs)
async function notifyPendingChange() {
    broadcastPendingSongs();
    reflectPendingOnChromeUi();
    // SPA tab push is async; don't block the message handler.
    forwardPendingSongsToSpaTabs().catch(err =>
        console.warn('[BG] notifyPendingChange SPA push failed:', err && err.message || err));
}

// ───── Orphan sweep ─────
//
// Some WT setlist items have NO code at all (no "O638", no "D131"
// prefix), e.g. an MC speaking cue or a custom label like
// "Throne Room Song". These items can NEVER be looked up by code,
// so a code-based library match on the SPA side skips them entirely —
// they would never appear in UNMATCHED_SONGS, even if they need an
// ID assignment.
//
// We sweep the latest structured setlist for any item without a code
// and surface it as a pending entry. The 4-second delay gives the SPA
// time to send UNMATCHED_SONGS first so we don't double-add anything
// that was already reported. De-dup happens in mergePendingSongs().
let _orphanSweepTimer = null;

function scheduleOrphanSweep() {
    if (_orphanSweepTimer) {
        clearTimeout(_orphanSweepTimer);
    }
    _orphanSweepTimer = setTimeout(() => {
        _orphanSweepTimer = null;
        runOrphanSweep().catch(err =>
            console.warn('[BG] orphan sweep failed:', err && err.message || err));
    }, 4000);
}

async function runOrphanSweep() {
    if (!Array.isArray(inMemStructured) || inMemStructured.length === 0) return;

    // Find setlist items without a code. Treat both null AND empty/whitespace
    // as "no code" so we catch edge cases like "  " or "Throne Room Song".
    const orphans = inMemStructured
        .filter(s => s && (!s.number || !String(s.number).trim()))
        .map(s => ({
            code: null,
            title: s.name || s.title || '',
            key: s.key || null
        }))
        .filter(s => s.title);   // need at least a title to surface

    if (!orphans.length) {
        console.log('[BG] orphan sweep — no code-less items found');
        return;
    }

    await loadPendingSongs();
    const fresh = await mergePendingSongs(
        orphans.map(o => Object.assign({}, o, { source: 'extension-orphan-sweep' }))
    );
    console.log('[BG] orphan sweep — found:', orphans.length,
                'fresh additions:', fresh.length,
                'total:', inMemPendingSongs.length);

    if (fresh.length > 0) {
        notifyPendingChange();
    }
}

// When the queue changes, mirror the count to the toolbar and pop a
// desktop notification if it just grew. Quietly clears both when empty.
function reflectPendingOnChromeUi() {
    const count = inMemPendingSongs.length;
    // Toolbar badge: orange circle with the count, plain empty string
    // when nothing is pending.
    try {
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
        chrome.action.setBadgeBackgroundColor({ color: '#f47920' });
    } catch (_) {}

    if (count === 0) {
        clearPendingNotification();
        return;
    }
    // Only fire a NEW notification when we just transitioned from 0
    // to >0. Otherwise (e.g. SPA confirmed one ID_ASSIGNED and added
    // another), the badge updates silently — we don't spam the user.
    const id = 'pending-songs-notification';
    try {
        chrome.notifications.getAll((active) => {
            const exists = active && Object.prototype.hasOwnProperty.call(active, id);
            if (!exists) {
                chrome.notifications.create(id, {
                    type: 'basic',
                    iconUrl: 'icons/icon-128.png',
                    title: count === 1
                        ? '1 liedje wacht op een ID'
                        : count + ' liedjes wachten op een ID',
                    message: 'Open de WorshipTools Sync-extensie om ze toe te wijzen.',
                    priority: 1
                });
            }
        });
    } catch (_) {}
}

function clearPendingNotification() {
    try {
        chrome.notifications.clear('pending-songs-notification');
    } catch (_) {}
}

// Notification click → focus the popup. chrome.action.openPopup()
// requires user-gesture in some Chrome versions, so we fall back to
// focusing the extension window if that API isn't available.
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId !== 'pending-songs-notification') return;
    chrome.notifications.clear(notificationId);
    try {
        if (chrome.action && typeof chrome.action.openPopup === 'function') {
            chrome.action.openPopup().catch(() => focusExtensionWindow());
        } else {
            focusExtensionWindow();
        }
    } catch (_) {
        focusExtensionWindow();
    }
});

function focusExtensionWindow() {
    try {
        chrome.windows.getAll({ populate: false }, (wins) => {
            for (const w of wins) {
                if (w && w.focused === false) {
                    chrome.windows.update(w.id, { focused: true });
                }
            }
        });
    } catch (_) {}
}

// ───── Message handler ─────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

  // ── Setlist extracted ──
  if (message.type === 'SETLIST_EXTRACTED') {
    console.log('[BG] Received SETLIST_EXTRACTED, length:', message.data?.length, 'structured:', message.structured?.length || 0);

    inMemSetlist = message.data;
    inMemDate = message.date || null;

    // Persist structured song data alongside the plain text
    if (message.structured) {
      inMemStructured = message.structured;
      persistToSession('lastStructuredSetlist', message.structured);
      scheduleOrphanSweep();
    }

    // Persist in chrome.storage.session for retrieval after SW restart
    persistToSession(STORAGE_KEYS.SETLIST, message.data);
    persistToSession(STORAGE_KEYS.DATE, message.date || null);

    // Forward to SPA tabs (fire-and-forget, no await needed for response)
    const senderTabId = sender.tab?.id;
    forwardToSpaTabs(senderTabId, 'SETLIST_RECEIVED', message.data, message.date, message.structured);

    sendResponse({ success: true });
    return true;
  }

  // ── Roster extracted ──
  if (message.type === 'ROSTER_EXTRACTED') {
    console.log('[BG] Received ROSTER_EXTRACTED, assignments:', message.data?.length);

    inMemRoster = message.data;

    // Persist in chrome.storage.session for retrieval after SW restart
    persistToSession(STORAGE_KEYS.ROSTER, message.data);

    // Forward to SPA tabs
    const senderTabId = sender.tab?.id;
    forwardToSpaTabs(senderTabId, 'ROSTER_RECEIVED', message.data);

    sendResponse({ success: true });
    return true;
  }

  // ── Retrieve last setlist ──
  if (message.type === 'GET_LAST_SETLIST') {
    console.log('[BG] GET_LAST_SETLIST — inMem:', !!inMemSetlist);
    if (inMemSetlist) {
      sendResponse({ data: inMemSetlist, date: inMemDate, structured: inMemStructured });
      return; // synchronous response, no need to keep channel open
    }
    // Service worker restarted — recover from session storage
    const _recoverSetlist = async () => {
      const [setlist, date, structured] = await Promise.all([
        readFromSession(STORAGE_KEYS.SETLIST),
        readFromSession(STORAGE_KEYS.DATE),
        readFromSession('lastStructuredSetlist')
      ]);
      if (setlist) {
        console.log('[BG] GET_LAST_SETLIST — recovered from session storage');
        inMemSetlist = setlist;
        inMemDate = date;
        inMemStructured = structured;
        sendResponse({ data: setlist, date, structured });
      } else {
        sendResponse({ data: null, date: null, structured: null });
      }
    };
    _recoverSetlist();
    return true; // keep channel open for async response
  }

  // ── Song library extracted (Song ID Assigner) ──
  if (message.type === 'LIBRARY_EXTRACTED') {
    console.log('[BG] Received LIBRARY_EXTRACTED, songs:', message.songs?.length, 'count:', message.count);

    inMemLibrary = {
      data: message.data || null,
      songs: message.songs || null
    };
    persistToSession(STORAGE_KEYS.LIBRARY, inMemLibrary);

    const senderTabId = sender.tab?.id;
    forwardToSpaTabs(senderTabId, 'LIBRARY_RECEIVED', message.data, null, message.songs);

    sendResponse({ success: true });
    return true;
  }

  // ── Retrieve last library ──
  if (message.type === 'GET_LAST_LIBRARY') {
    console.log('[BG] GET_LAST_LIBRARY — inMem:', !!inMemLibrary);
    if (inMemLibrary) {
      sendResponse({ data: inMemLibrary.data, songs: inMemLibrary.songs });
      return;
    }
    const _recoverLibrary = async () => {
      const lib = await readFromSession(STORAGE_KEYS.LIBRARY);
      if (lib) {
        console.log('[BG] GET_LAST_LIBRARY — recovered from session storage');
        inMemLibrary = lib;
        sendResponse({ data: lib.data, songs: lib.songs });
      } else {
        sendResponse({ data: null, songs: null });
      }
    };
    _recoverLibrary();
    return true;
  }

  // ── Retrieve last roster ──
  if (message.type === 'GET_LAST_ROSTER') {
    console.log('[BG] GET_LAST_ROSTER — inMem:', !!inMemRoster);
    if (inMemRoster) {
      sendResponse({ data: inMemRoster });
      return; // synchronous response, no need to keep channel open
    }
    // Service worker restarted — recover from session storage
    const _recoverRoster = async () => {
      const roster = await readFromSession(STORAGE_KEYS.ROSTER);
      if (roster) {
        console.log('[BG] GET_LAST_ROSTER — recovered from session storage');
        inMemRoster = roster;
        sendResponse({ data: roster });
      } else {
        sendResponse({ data: null });
      }
    };
    _recoverRoster();
    return true; // keep channel open for async response
  }

  // ── Pending ID queue (id assigner) ──
  // The SPA ran its song-library lookup against the most recent
  // SETLIST_RECEIVED and is reporting which WT items have no internal ID.
  if (message.type === 'UNMATCHED_SONGS') {
    (async () => {
      const payload = message.payload || {};
      await loadPendingSongs();
      const fresh = await mergePendingSongs(payload.songs || []);
      console.log('[BG] UNMATCHED_SONGS — fresh:', fresh.length,
                  'total now:', inMemPendingSongs.length);
      // Fan out to popup, toolbar/notifications, and every open SPA tab.
      // Notification idempotency is handled inside the targeted helpers.
      notifyPendingChange();
    })();
    sendResponse({ success: true });
    return true;
  }

  // The SPA finished assigning one song in its UI. Drop it from the queue.
  if (message.type === 'ID_ASSIGNED') {
    (async () => {
      const payload = message.payload || {};
      if (!payload || !payload.code) {
        sendResponse({ success: false, error: 'missing code' });
        return;
      }
      await loadPendingSongs();
      const removed = await removePendingSong(payload.code);
      console.log('[BG] ID_ASSIGNED — code:', payload.code, 'removed:', removed,
                  'remaining:', inMemPendingSongs.length);
      notifyPendingChange();
      sendResponse({ success: true, removed });
    })();
    return true;
  }

  // Popup asks for the current queue on init (the broadcasted
  // PENDING_SONGS_UPDATED event only reaches popups already open).
  // The message is sent in three flavours:
  //   - GET_PENDING_SONGS    → returns the full queue
  //   - OPEN_ASSIGNER_FOR_SONG → forwards to open SPA tab
  //   - CLEAR_PENDING          → bulk dismiss (popup's "Wis alles")
  if (message.type === 'CLEAR_PENDING') {
    (async () => {
      const codes = (message.payload && message.payload.codes) || [];
      await loadPendingSongs();
      const before = inMemPendingSongs.length;
      if (!codes.length) {
        // No explicit codes → clear EVERYTHING (operator gesture).
        inMemPendingSongs = [];
      } else {
        // Drop matching entries. pendingKeyOf matches on code for coded
        // items and on title for orphans, so we accept either or both.
        const wanted = new Set(codes.map(c => String(c).toLowerCase()));
        inMemPendingSongs = inMemPendingSongs.filter(s => {
            const k = (s.code || '').toLowerCase();
            const t = (s.title || '').toLowerCase();
            return !wanted.has(k) && !wanted.has(t);
        });
      }
      const removed = before - inMemPendingSongs.length;
      await savePendingSongs();
      console.log('[BG] CLEAR_PENDING — removed:', removed,
                  'remaining:', inMemPendingSongs.length);
      notifyPendingChange();
      sendResponse({ success: true, removed });
    })();
    return true;
  }

  if (message.type === 'GET_PENDING_SONGS') {
    (async () => {
      await loadPendingSongs();
      sendResponse({ songs: inMemPendingSongs });
    })();
    return true;
  }

  if (message.type === 'OPEN_ASSIGNER_FOR_SONG') {
    (async () => {
      const payload = message.payload || {};
      const spaTabs = await findSpaTabs();
      if (spaTabs.length === 0) {
        sendResponse({ success: false, error: 'no-spa-tab' });
        return;
      }
      const ok = await sendWithRetry(spaTabs[0].id, {
        type: 'OPEN_ASSIGNER_FOR_SONG',
        payload: payload
      });
      sendResponse({ success: ok, targetTabId: spaTabs[0].id });
    })();
    return true;
  }
});

// ───── SW startup hydration ─────
// Service workers are torn down + restarted by Chrome at any time.
// When we wake up, mirror the stored pending queue onto the toolbar badge
// and the desktop notification (create only if not already active).
// Runs once per activation, fire-and-forget.
(async () => {
  try {
    await loadPendingSongs();
    // Fan out the (possibly-restored) queue to popup, toolbar badge,
    // and every open SPA tab. sendWithRetry handles SPA tabs that are
    // still booting; no need to wait for them to come up.
    await notifyPendingChange();
    // Also schedule an orphan sweep: the previous sync may have left
    // code-less items in inMemStructured that the SPA never surfaced.
    if (Array.isArray(inMemStructured) && inMemStructured.length > 0) {
      scheduleOrphanSweep();
    }
  } catch (_) {}
})();
