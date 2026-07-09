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

// Storage keys for chrome.storage.session
const STORAGE_KEYS = {
  SETLIST: 'lastExtractedSetlist',
  DATE: 'lastServiceDate',
  ROSTER: 'lastExtractedRoster'
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
 * Detect SPA tabs — match by URL patterns. Returns an array of tab objects.
 * In MV3, tab.url is reliable for tabs matching the extension's host_permissions
 * (now includes localhost + 127.0.0.1).
 */
function findSpaTabs(senderTabId) {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      const spaTabs = tabs.filter(tab => {
        const url = (tab.url || '').toLowerCase();
        const isSpa = url.includes('ichtus_spa') ||
                      url.includes('localhost') ||
                      url.includes('127.0.0.1');
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

/** Forward extracted data to all open SPA tabs */
async function forwardToSpaTabs(senderTabId, type, data, date) {
  const spaTabs = await findSpaTabs(senderTabId);
  console.log('[BG] Forwarding', type, 'to', spaTabs.length, 'SPA tabs');

  if (spaTabs.length === 0) {
    console.log('[BG] No SPA tabs found — data cached for later retrieval');
    return;
  }

  const message = { type, data };
  if (date) message.date = date;

  const results = await Promise.allSettled(
    spaTabs.map(tab => sendWithRetry(tab.id, message))
  );
  const succeeded = results.filter(r => r.value === true).length;
  if (succeeded < spaTabs.length) {
    console.warn('[BG] Delivered to', succeeded, '/', spaTabs.length, 'SPA tabs');
  }
}

// ───── Message handler ─────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── Setlist extracted ──
  if (message.type === 'SETLIST_EXTRACTED') {
    console.log('[BG] Received SETLIST_EXTRACTED, length:', message.data?.length);

    inMemSetlist = message.data;
    inMemDate = message.date || null;

    // Persist in chrome.storage.session for retrieval after SW restart
    persistToSession(STORAGE_KEYS.SETLIST, message.data);
    persistToSession(STORAGE_KEYS.DATE, message.date || null);

    // Forward to SPA tabs (fire-and-forget, no await needed for response)
    const senderTabId = sender.tab?.id;
    forwardToSpaTabs(senderTabId, 'SETLIST_RECEIVED', message.data, message.date);

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
      sendResponse({ data: inMemSetlist, date: inMemDate });
      return; // synchronous response, no need to keep channel open
    }
    // Service worker restarted — recover from session storage
    const _recoverSetlist = async () => {
      const [setlist, date] = await Promise.all([
        readFromSession(STORAGE_KEYS.SETLIST),
        readFromSession(STORAGE_KEYS.DATE)
      ]);
      if (setlist) {
        console.log('[BG] GET_LAST_SETLIST — recovered from session storage');
        inMemSetlist = setlist;
        inMemDate = date;
        sendResponse({ data: setlist, date });
      } else {
        sendResponse({ data: null, date: null });
      }
    };
    _recoverSetlist();
    return true; // keep channel open for async response
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
});
