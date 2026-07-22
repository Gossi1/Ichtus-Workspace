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

function extractRoster() {
    try {
        console.log('[WT→SPA] extractRoster() called — scanning page...');

        // Find the "Rollen" / "Roles" heading
        const headings = document.querySelectorAll('.card-section-title');
        let rolesContainer = null;
        for (const h of headings) {
            const text = h.textContent.trim();
            if (text === 'Rollen' || text === 'Roles') {
                rolesContainer = h.closest('.col') || h.parentElement;
                break;
            }
        }

        if (!rolesContainer) {
            console.warn('[WT→SPA] Could not find "Rollen" / "Roles" section');
            alert('❌ Could not find the "Rollen" / "Roles" section on this page.');
            return;
        }

        const roster = [];
        let totalDeclined = 0; // aggregate across all role sections for the success alert
        // Each role section is a .pb-3 div within the roles container
        const roleSections = rolesContainer.querySelectorAll('.pb-3');

        roleSections.forEach(section => {
            // Get the role name
            const roleEl = section.querySelector('.col-12.mb-2 div, .col-12.mb-2');
            if (!roleEl) return;
            const role = roleEl.textContent.trim();
            if (!role) return;

            // Find all people assigned to this role
            const personItems = section.querySelectorAll('.list-group-item');
            let skippedDeclined = 0;
            personItems.forEach(item => {
                // Get the person's name
                const nameSpan = item.querySelector('.user-name span');
                const name = nameSpan ? nameSpan.textContent.trim() : '';
                if (!name || name === 'Persoon toevoegen') return; // skip "Add Person" button row

                // Skip people who have DECLINED the assignment. WorshipTools
                // marks declined users with a red border on the avatar
                // wrapper (`border-danger`) AND exposes a `title="Declined"`
                // attribute on the status badge — we check both so the
                // filter survives any CSS-class rename.
                if (
                    item.querySelector('.outer.profile-pic.border-danger') ||
                    item.querySelector('[title="Declined"]')
                ) {
                    console.log('[WT→SPA] Skipping declined:', name);
                    skippedDeclined++;
                    totalDeclined++;
                    return;
                }

                // Try to extract avatar URL from the profile picture
                let avatarUrl = '';
                const img = item.querySelector('img[alt="Profile Picture"]');
                if (img && img.src) {
                    avatarUrl = img.src;
                }

                roster.push({ name, role, avatar_url: avatarUrl });
            });
            if (skippedDeclined > 0) {
                console.log(`[WT→SPA] Filtered out ${skippedDeclined} declined role(s) for "${role}".`);
            }
        });

        console.log('[WT→SPA] Roster extracted:', roster.length, 'assignments', roster);

        // Compute plural once now that totalDeclined is final — the same
        // inflection is needed by both the empty-roster alert and the success
        // message so we don't repeat the ternary.
        const plural = totalDeclined === 1 ? '' : 'en';

        if (roster.length === 0) {
            if (totalDeclined > 0) {
                alert(`⚠️ Alle ${totalDeclined} rol-toewijzing${plural} waren declined — geen teamleden beschikbaar voor deze dienst.`);
            } else {
                alert('⚠️ Geen teamleden gevonden in de Rollen sectie.');
            }
            return;
        }

        const names = [...new Set(roster.map(r => r.name))];
        const preview = names.slice(0, 5).join(', ');
        const more = names.length > 5 ? ` +${names.length - 5} meer` : '';
        const declinedSuffix = totalDeclined > 0 ? ` · ${totalDeclined} declined rol-toewijzing${plural} gefilterd` : '';
        alert(`✅ ${roster.length} rol-toewijzingen gevonden (${names.length} personen): ${preview}${more}${declinedSuffix}\n\nOpen Ichtus SPA → Dashboard om de mic toewijzing te zien.`);

        chrome.runtime.sendMessage({
            type: 'ROSTER_EXTRACTED',
            data: roster
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[WT→SPA] Background error:', chrome.runtime.lastError.message);
            } else {
                console.log('[WT→SPA] Background acknowledged:', response);
            }
        });
    } catch (err) {
        console.error('[WT→SPA] CRASH in extractRoster:', err);
        alert('❌ Error in extractRoster:\n' + (err?.message || String(err)) + '\n\nCheck the browser console (F12) for full details.');
    }
}

/**
 * Parse a potential song number from the start of a song name.
 * Song numbers follow patterns like "O586", "D013", "LvK 9", "Ps 150", etc.
 * Returns { number, name } or { name } if no number is detected.
 * Wrapped in try/catch so a single rogue line never crashes the extraction.
 */
function parseSongNumber(line) {
    try {
        if (typeof line !== 'string') return { name: String(line || '') };
        // Match patterns: 1-3 uppercase letters followed by digits (optionally separated by space)
        // e.g. O586, D143, LvK 9, Ps 150, ELB 838
        const numberMatch = line.match(/^([A-Z]{1,3}\s*\d{1,4})\s+(.+)/);
        if (numberMatch) {
            return {
                number: numberMatch[1].replace(/\s+/g, ' ').trim(),
                name: numberMatch[2].trim()
            };
        }
        // Also try digit-only prefix like "01 Amazing Grace"
        const digitMatch = line.match(/^(\d{2,4})\s+(.+)/);
        if (digitMatch) {
            return {
                number: digitMatch[1],
                name: digitMatch[2].trim()
            };
        }
        return { name: line };
    } catch (e) {
        console.warn('[WT→SPA] parseSongNumber error for line:', line, e);
        return { name: String(line || '') };
    }
}

function extractSetlist() {
    try {
        console.log('[WT→SPA] extractSetlist() called — scanning page...');

        // Song names are always in <h3> inside .song-description.
        // Notes live in <div class="notes"> — we skip those by targeting h3 directly.
        const songNameElements = [];
        document.querySelectorAll('.song-description h3').forEach(h3 => {
            songNameElements.push(h3);
        });

        // Fallback: other standalone song-title selectors for different page layouts
        const otherElements = document.querySelectorAll('.item-name, .song-title, .planning-item-name, .wt-song-name, .planning-song-name');

        const rawElements = [...songNameElements, ...otherElements];
        console.log('[WT→SPA] Elements collected — song-description h3:', songNameElements.length, ', other:', otherElements.length, ', total:', rawElements.length);

        if (rawElements.length === 0) {
            console.warn('[WT→SPA] No elements found on page.');
            alert("No items found. The page structure may have changed. Try refreshing the page or check the console for details.");
            return;
        }

        // 1. Convert to array and get raw text
        const rawLines = rawElements
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

            return cleaned.trim();
        });

        // 3. Final Deduplication and Length Filter
        const seen = new Set();
        const finalItems = [];
        processed.forEach(line => {
            if (line.length > 5 && !/^[A-G][b#]?$/.test(line) && !seen.has(line)) {
                seen.add(line);
                finalItems.push(line);
            }
        });

        // Build structured array AFTER filtering so indices align perfectly
        const finalStructured = finalItems.map(line => parseSongNumber(line));

        const finalOutput = finalItems.join('\n');
        console.log('[WT→SPA] Final items after cleaning:', finalItems.length, finalItems.slice(0, 5));
        console.log('[WT→SPA] Structured items:', finalStructured.slice(0, 5));

        if (finalOutput.length > 0) {
            // 1. Copy to clipboard (non-blocking)
            navigator.clipboard.writeText(finalOutput).catch(err => {
                console.warn('[WT→SPA] Clipboard write failed:', err);
            });

            // 2. Extract the service date from the page
            const serviceDate = extractDate();

            // 3. Show success message — include structured count info
            const preview = finalItems.slice(0, 5).join(', ');
            const more = finalItems.length > 5 ? ` +${finalItems.length - 5} more` : '';
            const numberedCount = finalStructured.filter(s => s.number).length;
            const numberInfo = numberedCount > 0 ? ` | ${numberedCount} met nummer` : '';
            console.log(`✅ ${finalItems.length} items extracted. First: ${preview}${more}${numberInfo}`);
            alert(`✅ Success! ${finalItems.length} items extracted and copied to clipboard.\n📅 Date: ${serviceDate}\n\nOpen Ichtus SPA → Setlist view to see them.`);

            // 4. Send structured data alongside the plain text
            chrome.runtime.sendMessage({
                type: 'SETLIST_EXTRACTED',
                data: finalOutput,
                structured: finalStructured,  // [{ number?, name }]
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

    // Check if roster button already exists
    if (document.getElementById('pro-roster-btn')) return;

    const rosterBtn = document.createElement('button');
    rosterBtn.id = 'pro-roster-btn';
    rosterBtn.innerText = "Extract Roster";
    rosterBtn.style = `
        position: fixed; 
        top: 70px; 
        right: 80px; 
        z-index: 99999; 
        padding: 12px 20px; 
        background: #2196F3; 
        color: white; 
        border: none; 
        border-radius: 8px; 
        font-weight: bold; 
        cursor: pointer; 
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    `;
    rosterBtn.onclick = extractRoster;
    document.body.appendChild(rosterBtn);
}

// 1. Initial injection attempt
injectSyncButton();

// 2. Use MutationObserver to handle page navigation within WorshipTools
const observer = new MutationObserver(() => {
    injectSyncButton();
});

observer.observe(document.body, { childList: true, subtree: true });
