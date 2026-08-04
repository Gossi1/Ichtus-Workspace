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
        // Match patterns: 1-4 letters (mixed case: "LvK", "Ps", "ELB") followed
        // by digits (optionally separated by space) — e.g. O586, D143, LvK 9,
        // Ps 150, ELB 838. Mixed-case prefixes are common in Dutch hymn books,
        // so [A-Za-z] (not just [A-Z]) keeps them structured and artist-tagged.
        const numberMatch = line.match(/^([A-Za-z]{1,4}\s*\d{1,4})\s+(.+)/);
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

/**
 * Extract a song title's text, EXCLUDING only the key/chord badge.
 * WorshipTools renders the song key (e.g. "D", "Am") in a separate badge
 * element INSIDE the title heading:
 *
 *   <h3> D044 Great I Am <div class="ml-1 medium"> D </div></h3>
 *
 * Reading innerText directly would merge the badge's key into the name
 * (and later confuse the "Am" in "Great I Am" for an A-minor chord).
 * We clone the node and delete ONLY the known badge element(s) — no
 * content-based heuristics, so a real word like "Am" inside the title
 * is never touched. Falls back to the raw innerText if cloning fails.
 */
function extractTitleText(el) {
    if (!el || typeof el.innerText !== 'string') return '';
    try {
        const clone = el.cloneNode(true);
        // Known key-badge classes — drop regardless of internal structure.
        // .ml-1.medium is the current WorshipTools badge; .cue-key is a
        // defensive alias for a possible class rename.
        clone.querySelectorAll('.ml-1.medium, .cue-key').forEach(n => n.remove());
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (e) {
        return (el.innerText || '').trim();
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

        // 1. Convert to array and get raw text — title text only, with the
        //    key/chord badge element excluded (extractTitleText).
        const rawLines = rawElements
            .map(el => extractTitleText(el))
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

        // WorshipTools plans sometimes include an end-of-service placeholder
        // item (e.g. "D000 - Setlist eind"). It is NOT a song, and everything
        // AFTER it is not part of the service either — stop collecting there.
        // Matches "Setlist eind", "Setlist einde", "D000 - Setlist eind", ...
        const END_OF_SETLIST = /setlist\s*eind/i;
        const endIdx = processed.findIndex(line => END_OF_SETLIST.test(line));
        if (endIdx >= 0) {
            console.log(`[WT→SPA] "Setlist eind" placeholder at index ${endIdx} — truncating setlist before it.`);
        }
        const effectiveLines = endIdx >= 0 ? processed.slice(0, endIdx) : processed;

        effectiveLines.forEach(line => {
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
 * Extract the FULL song library from WorshipTools' song list page
 * (not a setlist — the library/"Liederen" overview). Returns lines
 * like "D044 Great I Am" and sends them to the Song ID Assigner app.
 *
 * WT's song list DOM uses the same .song-description h3 title pattern
 * as the planning page; we add broader fallbacks so it keeps working
 * if the layout changes. Everything is deduped and IDs (D, H, O, OK,
 * K, LvK, Ps, ELB …) are preserved as-is — assigning NEW numbers is
 * the job of the app, not the extension.
 */
function extractLibrary() {
    try {
        console.log('[WT→SPA] extractLibrary() called — scanning song library page...');

        // WorshipTools song library rows look like:
        //   <div> <div class="name">OK149 Ja Is Ja</div>
        //         <div class="small">Marcel Zimmer</div> </div>
        // The title lives in .name (with the ID prefix), the artist in the
        // sibling .small. We collect .name elements and read .small from
        // their parent so the app can store the artist too.
        const titleSelectors = [
            '.song-description h3',
            '.cue-title h3',
            '.song-title',
            '.item-name',
            '.planning-item-name',
            '.wt-song-name',
            '.planning-song-name',
            '.library-song-name',
            '.song-list .song-title',
            '.song-list .name',
            '.library-list .name',
            '.name',
            'h3.song-title',
            'h4.song-title'
        ];

        const elements = [];
        const seenEls = new Set();
        for (const sel of titleSelectors) {
            document.querySelectorAll(sel).forEach(el => {
                if (!seenEls.has(el)) {
                    seenEls.add(el);
                    elements.push(el);
                }
            });
        }

        // Fallback: if the known selectors matched almost nothing (a few
        // stray elements is suspicious — the layout may have changed), also
        // scan any leaf-ish h3/h4 so we never return a partial library.
        if (elements.length < 5) {
            document.querySelectorAll('h3, h4').forEach(el => {
                const text = (el.textContent || '').trim();
                if (text && text.length > 1 && text.length < 120 && !seenEls.has(el)) {
                    seenEls.add(el);
                    elements.push(el);
                }
            });
        }

        console.log('[WT→SPA] Library title elements found:', elements.length);
        if (elements.length === 0) {
            alert('❌ Geen liederen gevonden. Ga naar de Liederen/Library-pagina in WorshipTools en probeer opnieuw.');
            return;
        }

        // UI chrome words that are NOT songs but can match the loose .name
        // selector (column headers, empty states, buttons).
        const UI_WORDS = new Set([
            'naam', 'name', 'titel', 'title', 'artiest', 'artist', 'lied', 'song',
            'toevoegen', 'add', 'zoeken', 'search', 'filter', 'sorteren', 'sort',
            'geen liederen', 'no songs', 'resultaten', 'results', 'loading', 'laden'
        ]);

        const structured = [];
        const seen = new Set();
        for (const el of elements) {
            const text = extractTitleText(el);
            if (!text) continue;
            const cleaned = text.replace(/\d{1,2}:\d{2}/g, '').trim();
            if (cleaned.length < 2 || UI_WORDS.has(cleaned.toLowerCase())) continue;

            // Read artist BEFORE dedup so same-title different-artist songs
            // are both extracted (e.g. "Holy Spirit" by Bryan Torwalt vs.
            // "Holy Spirit" by LaRue Howard).
            let artist = '';
            try {
                let row = el.parentElement;
                while (row && !row.querySelector('.small')) {
                    row = row.parentElement;
                }
                const small = row ? row.querySelector('.small') : null;
                if (small) {
                    artist = (small.textContent || '').trim();
                    if (artist.length >= 80) artist = '';
                }
            } catch (_) { /* best-effort */ }

            // Dedup by title+artist so two songs with the same name but
            // different artists are both kept.
            const dedupKey = cleaned + (artist ? '\x00' + artist.toLowerCase() : '');
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            const s = parseSongNumber(cleaned);
            if (artist) s.artist = artist;
            structured.push(s);
        }

        const lines = structured.map(s => (s.number ? s.number + ' ' : '') + s.name);
        const output = lines.join('\n');
        console.log('[WT→SPA] Library extracted:', lines.length, 'songs — first:', lines.slice(0, 3));

        if (lines.length === 0) {
            alert('❌ Niets bruikbaars gevonden op deze pagina.');
            return;
        }

        navigator.clipboard.writeText(output).catch(() => {});
        alert(`✅ ${lines.length} liederen geëxtraheerd (naar klembord + app).\n\nOpen de Song ID Assigner app om te importeren.`);

        chrome.runtime.sendMessage({
            type: 'LIBRARY_EXTRACTED',
            data: output,          // plain lines, e.g. "OK149 Ja Is Ja"
            songs: structured,     // [{ number?, name, artist? }]
            count: lines.length
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[WT→SPA] Background ack failed:', chrome.runtime.lastError.message);
            }
        });
    } catch (err) {
        console.error('[WT→SPA] CRASH in extractLibrary:', err);
        alert('❌ Fout in extractLibrary:\n' + (err?.message || String(err)));
    }
}

/**
 * Function to create and inject the orange buttons
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

    // Check if library button already exists
    if (document.getElementById('pro-library-btn')) return;

    const libraryBtn = document.createElement('button');
    libraryBtn.id = 'pro-library-btn';
    libraryBtn.innerText = "Extract Song Library";
    libraryBtn.style = `
        position: fixed; 
        top: 120px; 
        right: 80px; 
        z-index: 99999; 
        padding: 12px 20px; 
        background: #34d399; 
        color: #06281c; 
        border: none; 
        border-radius: 8px; 
        font-weight: bold; 
        cursor: pointer; 
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    `;
    libraryBtn.onclick = extractLibrary;
    document.body.appendChild(libraryBtn);
}

// 1. Initial injection attempt
injectSyncButton();

// 2. Use MutationObserver to handle page navigation within WorshipTools
const observer = new MutationObserver(() => {
    injectSyncButton();
});

observer.observe(document.body, { childList: true, subtree: true });
