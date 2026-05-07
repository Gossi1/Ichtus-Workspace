/**
 * Background Script for WorshipTools to Ichtus SPA Bridge
 * Relays setlist extraction messages from WorshipTools tabs to Ichtus SPA tabs.
 */

// Store the latest extracted setlist in memory
let lastExtractedSetlist = null;
let lastServiceDate = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETLIST_EXTRACTED') {
    console.log('[BG] Received SETLIST_EXTRACTED, length:', message.data?.length);
    lastExtractedSetlist = message.data;
    lastServiceDate = message.date || null;
    console.log('[BG] Service date received:', lastServiceDate);
    if (!lastServiceDate) {
      console.warn('[BG] WARNING: No date received from content script!');
    }

    // Forward to all SPA tabs
    chrome.tabs.query({}, (tabs) => {
      let spaTabs = 0;
      tabs.forEach(tab => {
        const url = tab.url || '';
        const isSpa = url.includes('Ichtus_SPA') ||
                      url.includes('localhost') ||
                      url.includes('127.0.0.1');

        if (isSpa && tab.id !== sender.tab?.id) {
          spaTabs++;
          console.log('[BG] Forwarding to tab', tab.id, url);
          chrome.tabs.sendMessage(tab.id, {
            type: 'SETLIST_RECEIVED',
            data: message.data,
            date: message.date
          }).then(() => {
            console.log('[BG] Tab', tab.id, 'received OK');
          }).catch((err) => {
            console.warn('[BG] Tab', tab.id, 'failed — content script not injected?', err?.message);
          });
        }
      });
      console.log('[BG] Found', spaTabs, 'SPA tabs out of', tabs.length, 'total');
    });

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_LAST_SETLIST') {
    console.log('[BG] GET_LAST_SETLIST — has data?', !!lastExtractedSetlist);
    sendResponse({ data: lastExtractedSetlist, date: lastServiceDate });
    return true;
  }
});
