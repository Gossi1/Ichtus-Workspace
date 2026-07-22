/**
 * SPA Bridge Content Script
 * Runs on Ichtus SPA pages. Receives messages from the background script
 * and dispatches a CustomEvent into the page DOM for the SPA module.
 *
 * Timing fix: we cache the latest setlist and wait for the SPA to signal
 * 'ichtus-setlist-ready' before dispatching. This prevents the race
 * condition where the event fires before setlistModule has set up its listener.
 *
 * Bridge status signal: we set a data-ichtus-bridge attribute on <html> so the
 * SPA's setlist module can detect whether the content script is running.
 *   - 'loaded'  = content script injected, waiting for data
 *   - 'active'  = at least one data dispatch has occurred
 *   - (absent)  = bridge not running
 */

let cachedSetlist = null;
let cachedDate = null;
let cachedRoster = null;
let cachedStructured = null;

/** Update the bridge status attribute on <html>.
 *  Falls back to localStorage if the DOM attribute is restricted. */
function updateBridgeStatus(status) {
  try {
    document.documentElement.dataset.ichtusBridge = status;
  } catch (e) {
    // Fallback: use localStorage if DOM attr is restricted
    console.warn('[BRIDGE] DOM attr failed, using localStorage fallback:', e?.message);
    try { localStorage.setItem('__ichtusBridge', status); } catch (_) {}
  }
}

// Signal that the bridge is loaded and listening (safe init)
try {
  updateBridgeStatus('loaded');
} catch (e) {
  console.warn('[BRIDGE] Top-level init failed:', e?.message);
}

function dispatchSetlist(data, date, structured) {
  console.log('[BRIDGE] Dispatching worshiptools-setlist, length:', data?.length, 'date:', date, 'structured:', structured?.length || 0);
  if (!date) {
    console.warn('[BRIDGE] WARNING: dispatching without date!');
  }
  updateBridgeStatus('active');
  const event = new CustomEvent('worshiptools-setlist', {
    detail: { setlist: data, date: date, structured: structured },
    bubbles: true,
    composed: true
  });
  document.dispatchEvent(event);
}

function dispatchRoster(data) {
  console.log('[BRIDGE] Dispatching worshiptools-roster, assignments:', data?.length);
  updateBridgeStatus('active');
  const event = new CustomEvent('worshiptools-roster', {
    detail: { roster: data },
    bubbles: true,
    composed: true
  });
  document.dispatchEvent(event);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // BRIDGE_PING is used by background.js to check if the bridge is already
  // injected in this tab (dynamic injection fallback). Respond immediately.
  if (message.type === 'BRIDGE_PING') {
    sendResponse({ bridge: true });
    return true;
  }

  if (message.type === 'SETLIST_RECEIVED' && message.data) {
    console.log('[BRIDGE] Received SETLIST_RECEIVED from background, length:', message.data?.length, 'structured:', message.structured?.length || 0);
    cachedSetlist = message.data;
    cachedDate = message.date || null;
    cachedStructured = message.structured || null;
    dispatchSetlist(message.data, cachedDate, cachedStructured);
    sendResponse({ received: true });
  }
  if (message.type === 'ROSTER_RECEIVED' && message.data) {
    console.log('[BRIDGE] Received ROSTER_RECEIVED from background, assignments:', message.data?.length);
    cachedRoster = message.data;
    dispatchRoster(message.data);
    sendResponse({ received: true });
  }
  return true;
});

// On load, request any previously extracted setlist from the background script.
// We dispatch immediately (belt-and-suspenders) AND cache it, because the SPA
// listener might already be ready, or will catch the re-dispatch via
// 'ichtus-setlist-ready'. The dedup in receiveSetlist() prevents double-processing.
chrome.runtime.sendMessage({ type: 'GET_LAST_SETLIST' }, (response) => {
  console.log('[BRIDGE] GET_LAST_SETLIST response — has data?', !!(response && response.data), 'has structured?', !!(response && response.structured));
  if (response && response.data) {
    cachedSetlist = response.data;
    cachedDate = response.date || null;
    cachedStructured = response.structured || null;
    dispatchSetlist(response.data, cachedDate, cachedStructured);
  }
});

// Request any previously extracted roster from the background script.
chrome.runtime.sendMessage({ type: 'GET_LAST_ROSTER' }, (response) => {
  console.log('[BRIDGE] GET_LAST_ROSTER response — has data?', !!(response && response.data));
  if (response && response.data) {
    cachedRoster = response.data;
    dispatchRoster(response.data);
  }
});

// Listen for the SPA page to signal it is ready to receive data.
// This fires every time the user navigates to the Setlist or Stage Builder view.
document.addEventListener('ichtus-setlist-ready', () => {
  console.log('[BRIDGE] Heard ichtus-setlist-ready — has cache?', !!cachedSetlist);
  if (cachedSetlist) {
    dispatchSetlist(cachedSetlist, cachedDate, cachedStructured);
  }
});

document.addEventListener('ichtus-stagebuilder-ready', () => {
  console.log('[BRIDGE] Heard ichtus-stagebuilder-ready — has roster cache?', !!cachedRoster);
  if (cachedRoster) {
    dispatchRoster(cachedRoster);
  }
});
