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

// ───── Auto-update from GitHub ─────
//
// Periodically checks the GitHub releases page and notifies the operator
// when a new version is available. Since unpacked extensions can't modify
// their own files, the update is manual (git pull / re-download), but the
// detection + notification is fully automatic via the extension icon.
//
// Flow:
//   1. On install / startup: schedule an alarm and check immediately
//   2. Alarm fires → fetch latest release tag from GitHub API
//   3. Compare versions (semver) → if newer, set badge "!" + tooltip
//   4. Operator hovers icon → sees "Update: vX.Y.Z beschikbaar" tooltip
//   5. Operator clicks icon → opens GitHub releases page in new tab
//
const UPDATE_CONFIG = {
  GITHUB_REPO: 'Gossi1/Ichtus-Workspace',
  CURRENT_VERSION: chrome.runtime.getManifest().version || '1.0',
  ALARM_NAME: 'extension-update-check',
  CHECK_INTERVAL_MINUTES: 60,  // once per hour
  STORAGE_KEY_LATEST: 'latestAvailableVersion',
  STORAGE_KEY_RELEASE_URL: 'latestReleaseUrl',
  STORAGE_KEY_LAST_CHECK: 'lastUpdateCheck',
};

/** Parse a semver string like "v1.2.3" or "1.2.3" into a comparable tuple */
function parseVersion(v) {
  if (!v) return [0, 0, 0];
  const cleaned = String(v).replace(/^v/i, '');
  const parts = cleaned.split('.').map(n => parseInt(n, 10));
  while (parts.length < 3) parts.push(0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Compare two version tuples: returns >0 if a is newer, <0 if older, 0 if equal */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Fetch the latest release info from GitHub API */
async function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${UPDATE_CONFIG.GITHUB_REPO}/releases/latest`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Ichtus-Extension' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      console.log('[UPDATE] GitHub API returned', resp.status, '- skipping check');
      return null;
    }
    const data = await resp.json();
    return {
      version: (data.tag_name || '').replace(/^v/i, ''),
      url: data.html_url || ''
    };
  } catch (err) {
    clearTimeout(timeout);
    console.log('[UPDATE] GitHub fetch failed:', err?.message);
    return null;
  }
}

/** Check for updates and update badge/tooltip if a newer version exists */
async function checkForUpdate() {
  const release = await fetchLatestRelease();
  if (!release || !release.version) {
    return;
  }

  const current = parseVersion(UPDATE_CONFIG.CURRENT_VERSION);
  const latest = parseVersion(release.version);
  const comparison = compareVersions(latest, current);

  await persistToSession(UPDATE_CONFIG.STORAGE_KEY_LAST_CHECK, Date.now());

  try {
    if (comparison <= 0) {
      // Up to date — clear any stale badge + color
      await persistToSession(UPDATE_CONFIG.STORAGE_KEY_LATEST, null);
      await persistToSession(UPDATE_CONFIG.STORAGE_KEY_RELEASE_URL, null);
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
      chrome.action.setTitle({ title: 'Ichtus Extensie — up-to-date (v' + UPDATE_CONFIG.CURRENT_VERSION + ')' });
    } else {
      // New version available!
      console.log('[UPDATE] New version available:', release.version, '(current:', UPDATE_CONFIG.CURRENT_VERSION + ')');
      await persistToSession(UPDATE_CONFIG.STORAGE_KEY_LATEST, release.version);
      await persistToSession(UPDATE_CONFIG.STORAGE_KEY_RELEASE_URL, release.url);
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f47920' });
      chrome.action.setTitle({ title: '📦 Update v' + release.version + ' beschikbaar! (huidig: v' + UPDATE_CONFIG.CURRENT_VERSION + ')' });
    }
  } catch (_) {}
}

// Schedule periodic update checks using chrome.alarms (persists across SW restarts)
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.alarms.get(UPDATE_CONFIG.ALARM_NAME);
    if (!existing) {
      await chrome.alarms.create(UPDATE_CONFIG.ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: UPDATE_CONFIG.CHECK_INTERVAL_MINUTES
      });
    }
  } catch (_) {}

  // Run the first check immediately
  checkForUpdate();
});

// Listen for alarm fires
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_CONFIG.ALARM_NAME) {
    checkForUpdate();
  }
});

// ───── Message handler ─────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── Setlist extracted ──
  if (message.type === 'SETLIST_EXTRACTED') {
    console.log('[BG] Received SETLIST_EXTRACTED, length:', message.data?.length, 'structured:', message.structured?.length || 0);

    inMemSetlist = message.data;
    inMemDate = message.date || null;

    // Persist structured song data alongside the plain text
    if (message.structured) {
      inMemStructured = message.structured;
      persistToSession('lastStructuredSetlist', message.structured);
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
