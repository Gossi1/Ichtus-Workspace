function parseDutchDate(text) {
    // Already in dd-mm-yyyy format? Pass through.
    const ddmmyyyy = text.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/);
    if (ddmmyyyy) return ddmmyyyy[1] + '-' + ddmmyyyy[2] + '-' + ddmmyyyy[3];

    // Try to parse Dutch dates like "zondag 3 mei 2026", "3 mei, 2026"
    const match = text.match(/(\d{1,2})\s*,?\s+([a-zéû]+)\s*,?\s+(\d{4})/i);
    if (match) {
        const day = parseInt(match[1], 10);
        const monthNames = {
            'januari': 1, 'februari': 2, 'maart': 3, 'april': 4,
            'mei': 5, 'juni': 6, 'juli': 7, 'augustus': 8,
            'september': 9, 'oktober': 10, 'november': 11, 'december': 12
        };
        const month = monthNames[match[2].toLowerCase()];
        const year = parseInt(match[3], 10);
        if (month) {
            const dd = String(day).padStart(2, '0');
            const mm = String(month).padStart(2, '0');
            return `${dd}-${mm}-${year}`;
        }
    }
    return null;
}

function formatDateDDMMYYYY(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

function extractDate() {
    // Try multiple selectors where WorshipTools might show the service date
    const dateSelectors = [
        '.typed-service-time',
        '.planning-header__date',
        '.service-date',
        '.planning-date',
        '[data-testid="planning-date"]',
        '.header-subtitle',
        '.page-header__subtitle'
    ];
    for (const sel of dateSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim()) {
            let text = el.innerText.trim();
            // Strip time portion if present, e.g. "zondag 3 mei 2026 - 10:00"
            text = text.replace(/\s*[-–]\s*\d{1,2}:\d{2}.*/, '').trim();
            const parsed = parseDutchDate(text);
            if (parsed) {
                console.log('[WT→SPA] Found date via selector:', sel, '→', parsed);
                return parsed;
            }
        }
    }
    console.warn('[WT→SPA] No date found via selectors, trying header fallback...');
    // Fallback: look for a date pattern in h1/h2 text
    const headers = document.querySelectorAll('h1, h2, .page-title, .planning-title');
    for (const h of headers) {
        const text = h.innerText;
        // Match patterns like "March 15, 2024", "15 maart 2024", "15/03/2024", etc.
        const dateMatch = text.match(/([A-Za-z]{3,}\s+\d{1,2}[,.]?\s*\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            const parsed = parseDutchDate(dateMatch[1].trim());
            if (parsed) {
                console.log('[WT→SPA] Found date via header regex:', parsed);
                return parsed;
            }
        }
    }
    // Last fallback: today
    const today = formatDateDDMMYYYY(new Date());
    console.warn('[WT→SPA] No date found, falling back to today:', today);
    return today;
}

function extractSetlist() {
    try {
        console.log('[WT→SPA] extractSetlist() called — scanning page...');
        const selector = '.song-description [data-v-3dc57186], .item-name, .song-title, .planning-item-name, .wt-song-name, .planning-song-name';
        const rawElements = document.querySelectorAll(selector);
        console.log('[WT→SPA] Selector matched', rawElements.length, 'elements');

        if (rawElements.length === 0) {
            console.warn('[WT→SPA] No elements matched selector:', selector);
            alert("No items found. The page structure may have changed. Try refreshing the page or check the console for details.");
            return;
        }

        // 1. Convert to array and get raw text
        const rawLines = Array.from(rawElements)
            .map(el => {
                if (!el || typeof el.innerText !== 'string') {
                    console.warn('[WT→SPA] Element without innerText:', el);
                    return '';
                }
                return el.innerText.trim();
            })
            .filter(text => text.length > 0);

        console.log('[WT→SPA] Raw lines extracted:', rawLines.length, rawLines.slice(0, 3));

        // 2. Process and Clean
        const processed = rawLines.map(line => {
            let cleaned = line;

            // A. Remove durations (e.g., 7:28, 0:00)
            cleaned = cleaned.replace(/\d{1,2}:\d{2}/g, '');

            // B. Remove trailing musical keys (e.g., "Song Name A" becomes "Song Name")
            cleaned = cleaned.replace(/\s+[A-G][b#]?\s*$/, '');

            // C. Remove specific conversational fragments found in your list
            const fragments = ["hebben we", "na de preek", "als het goed is", "reserve", "terug naar"];
            fragments.forEach(frag => {
                if (cleaned.toLowerCase().includes(frag)) cleaned = "";
            });

            return cleaned.trim();
        });

        // 3. Final Deduplication and Length Filter
        const finalItems = [...new Set(processed)].filter(line => {
            return line.length > 5 &&
                   !/^[A-G][b#]?$/.test(line);
        });

        const finalOutput = finalItems.join('\n');
        console.log('[WT→SPA] Final items after cleaning:', finalItems.length, finalItems.slice(0, 5));

        if (finalOutput.length > 0) {
            // 1. Copy to clipboard (non-blocking)
            navigator.clipboard.writeText(finalOutput).catch(err => {
                console.warn('[WT→SPA] Clipboard write failed:', err);
            });

            // 2. Extract the service date from the page
            const serviceDate = extractDate();

            // 3. Show success message
            const preview = finalItems.slice(0, 5).join(', ');
            const more = finalItems.length > 5 ? ` +${finalItems.length - 5} more` : '';
            console.log(`✅ ${finalItems.length} items extracted. First: ${preview}${more}`);
            alert(`✅ Success! ${finalItems.length} items extracted and copied to clipboard.\n📅 Date: ${serviceDate}\n\nOpen Ichtus SPA → Setlist view to see them.`);

            // 4. Send date along with setlist
            chrome.runtime.sendMessage({
                type: 'SETLIST_EXTRACTED',
                data: finalOutput,
                date: serviceDate
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[WT→SPA] Background error:', chrome.runtime.lastError.message);
                } else {
                    console.log('[WT→SPA] Background acknowledged:', response);
                }
            });
        } else {
            console.warn('[WT→SPA] All items were filtered out. Raw lines:', rawLines);
            alert("No valid items found after filtering. Raw elements found: " + rawElements.length + ". Check console for details.");
        }
    } catch (err) {
        console.error('[WT→SPA] CRASH in extractSetlist:', err);
        alert('❌ Error in extractSetlist:\n' + (err?.message || String(err)) + '\n\nCheck the browser console (F12) for full details.');
    }
}

/**
 * Function to create and inject the orange button
 */
function injectSyncButton() {
    // Check if the button already exists to prevent duplicates
    if (document.getElementById('pro-sync-btn')) return;

    const syncBtn = document.createElement('button');
    syncBtn.id = 'pro-sync-btn';
    syncBtn.innerText = "Extract Setlist";
    // Styling matches your app's branding
    syncBtn.style = `
        position: fixed; 
        top: 20px; 
        right: 80px; 
        z-index: 99999; 
        padding: 12px 20px; 
        background: #f47920; 
        color: white; 
        border: none; 
        border-radius: 8px; 
        font-weight: bold; 
        cursor: pointer; 
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    `;
    syncBtn.onclick = extractSetlist;
    document.body.appendChild(syncBtn);
}

// 1. Initial injection attempt
injectSyncButton();

// 2. Use MutationObserver to handle page navigation within WorshipTools
const observer = new MutationObserver(() => {
    injectSyncButton();
});

observer.observe(document.body, { childList: true, subtree: true });
