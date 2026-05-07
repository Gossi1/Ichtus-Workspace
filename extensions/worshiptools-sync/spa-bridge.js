/**
 * SPA Bridge Content Script
 * Runs on Ichtus SPA pages. Receives messages from the background script
 * and dispatches a CustomEvent into the page DOM for the SPA module.
 *
 * Timing fix: we cache the latest setlist and wait for the SPA to signal
 * 'ichtus-setlist-ready' before dispatching. This prevents the race
 * condition where the event fires before setlistModule has set up its listener.
 */

let cachedSetlist = null;
let cachedDate = null;

function dispatchSetlist(data, date) {
  console.log('[BRIDGE] Dispatching worshiptools-setlist, length:', data?.length, 'date:', date);
  if (!date) {
    console.warn('[BRIDGE] WARNING: dispatching without date!');
  }
  const event = new CustomEvent('worshiptools-setlist', {
    detail: { setlist: data, date: date },
    bubbles: true,
    composed: true
  });
  document.dispatchEvent(event);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETLIST_RECEIVED' && message.data) {
    console.log('[BRIDGE] Received SETLIST_RECEIVED from background, length:', message.data?.length);
    cachedSetlist = message.data;
    cachedDate = message.date || null;
    dispatchSetlist(message.data, cachedDate);
    sendResponse({ received: true });
  }
  return true;
});

// On load, request any previously extracted setlist from the background script.
// We dispatch immediately (belt-and-suspenders) AND cache it, because the SPA
// listener might already be ready, or will catch the re-dispatch via
// 'ichtus-setlist-ready'. The dedup in receiveSetlist() prevents double-processing.
chrome.runtime.sendMessage({ type: 'GET_LAST_SETLIST' }, (response) => {
  console.log('[BRIDGE] GET_LAST_SETLIST response — has data?', !!(response && response.data));
  if (response && response.data) {
    cachedSetlist = response.data;
    cachedDate = response.date || null;
    dispatchSetlist(response.data, cachedDate);
  }
});

// Listen for the SPA page to signal it is ready to receive data.
// This fires every time the user navigates to the Setlist view.
document.addEventListener('ichtus-setlist-ready', () => {
  console.log('[BRIDGE] Heard ichtus-setlist-ready — has cache?', !!cachedSetlist);
  if (cachedSetlist) {
    dispatchSetlist(cachedSetlist, cachedDate);
  }
});
