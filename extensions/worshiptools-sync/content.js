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

/**
 * Pure collection: scan the current page's RolLen block and return
 * `{name, role, avatar_url}` records. NO alerts, NO messaging to the
 * background — caller decides what to do with the result.
 *
 * Returns:
 *   { found: true,  entries: [...], declinedCount: N }
 *   { found: false, error: 'no-rollen-section' | 'crash', message: '...' }
 *
 * Declined users are filtered out (red avatar border OR title="Declined"
 * badge). The "Persoon toevoegen" placeholder row is also skipped.
 */
function collectRosterEntries() {
    try {
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
            return { found: false, error: 'no-rollen-section' };
        }

        const entries = [];
        let declinedCount = 0; // aggregate across all role sections
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
                    declinedCount++;
                    return;
                }

                // Try to extract avatar URL from the profile picture
                let avatarUrl = '';
                const img = item.querySelector('img[alt="Profile Picture"]');
                if (img && img.src) {
                    avatarUrl = img.src;
                }

                entries.push({ name, role, avatar_url: avatarUrl });
            });
            if (skippedDeclined > 0) {
                console.log(`[WT→SPA] Filtered out ${skippedDeclined} declined role(s) for "${role}".`);
            }
        });

        return { found: true, entries, declinedCount };
    } catch (err) {
        console.error('[WT→SPA] CRASH in collectRosterEntries:', err);
        return { found: false, error: 'crash', declinedCount: 0, message: err?.message || String(err) };
    }
}

/**
 * User-facing single-team roster scrape. Shows a confirmation alert and
 * sends ONE message to the background. Backs onto `collectRosterEntries()`.
 */
/**
 * Module-level cache that holds the most recent setlist extraction.
 * `extractSetlist` writes here on every successful run so that other
 * entry points (e.g. `runAllTeamsSync`) can read the song count
 * without re-running the DOM scan.
 *
 * Shape: { items: string[], structured: Array<{number?,name}>, date: string|null }
 */
let __lastSetlistResult = null;

function extractRoster() {
    const result = collectRosterEntries();

    if (!result.found) {
        if (result.error === 'no-rollen-section') {
            alert('❌ Could not find the "Rollen" / "Roles" section on this page.');
        } else {
            alert('❌ Error in extractRoster:\n' + (result.message || 'onbekend') +
                  '\n\nCheck the browser console (F12) for full details.');
        }
        return;
    }

    const { entries: roster, declinedCount: totalDeclined } = result;
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
            emitProgress('log', { msg: 'Setlist: geen elements gevonden op pagina' });
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

        // Extract the service date BEFORE we cache the result, so
        // __lastSetlistResult can include it without a TDZ error.
        const serviceDate = extractDate();

        // WorshipTools uses `D`-prefixed numbers (e.g. D000, D131) as
        // dienst-items: they're structural dividers in the order of
        // service, NOT real songs. The schema needs them so the SPA
        // can render the bucket structure, but the popup operator
        // only wants to know how many of these are REAL songs.
        //
        // See: splitSongNumber() decoupled from song count here.
        const songCount = finalStructured.filter(function (s) {
            if (!s.number) return true;            // no code → treat as song
            return s.number !== 'D000'; // divider placeholder is exactly D000
        }).length;

        // Cache the extraction result for runAllTeamsSync to read later.
        // This MUST run after `serviceDate` is declared (see fix history).
        // `items` keeps dividers in the payload; `songCount` is what
        // gets shown to the operator.
        __lastSetlistResult = {
            items: finalItems,
            structured: finalStructured,
            songCount: songCount,
            date: serviceDate
        };

        // Mirror the cache onto a DOM attribute so the page console can
        // inspect it from the MAIN world WITHOUT needing a <script>
        // injection (WorshipTools' CSP blocks unsafe-inline).
        //   page console: JSON.parse(document.documentElement.dataset.wtDbg)
        try {
            document.documentElement.dataset.wtDbg = JSON.stringify(__lastSetlistResult);
        } catch (e) {
            // dataset write rarely fails; just ignore if it does.
        }

        const finalOutput = finalItems.join('\n');
        console.log('[WT→SPA] Final items after cleaning:', finalItems.length, finalItems.slice(0, 5));
        console.log('[WT→SPA] Structured items:', finalStructured.slice(0, 5));

        if (finalOutput.length > 0) {
            // 1. Copy to clipboard (non-blocking)
            navigator.clipboard.writeText(finalOutput).catch(err => {
                console.warn('[WT→SPA] Clipboard write failed:', err);
            });

            // 2. serviceDate is already in scope — was hoisted out of
            //    this block to keep __lastSetlistResult valid.

            // 3. Show success message — include structured count info
            const preview = finalItems.slice(0, 5).join(', ');
            const more = finalItems.length > 5 ? ` +${finalItems.length - 5} more` : '';
            const numberedCount = finalStructured.filter(s => s.number).length;
            const numberInfo = numberedCount > 0 ? ` | ${numberedCount} met nummer` : '';
            console.log(`✅ ${finalItems.length} items extracted. First: ${preview}${more}${numberInfo}`);
            emitProgress('log', { msg: 'Setlist: ' + finalItems.length + ' items, datum: ' + serviceDate });

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
            emitProgress('log', { msg: 'Setlist: niets bruikbaars na filteren (' + rawElements.length + ' ruwe elementen)' });
        }
    } catch (err) {
        console.error('[WT→SPA] CRASH in extractSetlist:', err);
        emitProgress('log', { msg: 'Setlist mislukt: ' + (err?.message || String(err)) });
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
 * Find the team-switcher button whose .group-name matches the target
 * and click it. After the click, wait for the role section to repopulate
 * (Worship Leader / Vocalist / etc. labels appear in the DOM).
 *
 * Returns:
 *   { ok: true,  source: 'clicked' | 'already-selected' }
 *   { ok: false, reason: 'no-button' | 'no-roles-after-switch' }
 */
async function ensureCorrectTeam(targetTeamName) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // The team-switcher renders as a Bootstrap list-group-item-action button
    // with a nested .group-name div containing the team label as plain text.
    // We match on EXACT text (trimmed) to avoid partial hits like
    // "Worship Team Beheer" or "Worship Team Backup".
    const groupNames = document.querySelectorAll(
        'button.list-group-item-action .group-name, [class*="list-group-item-action"] .group-name'
    );
    let targetBtn = null;
    groupNames.forEach(el => {
        if ((el.textContent || '').trim() === targetTeamName) {
            // The click target is the enclosing button — not the inner div.
            targetBtn = el.closest('button') || el.closest('[role="button"]') || el;
        }
    });

    if (!targetBtn) {
        // No button matched \u2014 the page might already be on the right team,
        // OR this view doesn't expose a team switcher at all (e.g. service
        // detail page after a deep link). Either way we should NOT block the
        // scrape; let the function calling us continue.
        console.log('[WT→SPA] Team-switcher button for "' + targetTeamName + '" niet gevonden \u2014 ga verder.');
        return { ok: true, source: 'already-selected' };
    }

    // Avoid re-clicking if the button is already marked as the currently
    // active selection (Bootstrap-Vue usually sets aria-current="true" or
    // a `active` class on the active list-group-item).
    const isActive =
        targetBtn.classList.contains('active') ||
        targetBtn.getAttribute('aria-current') === 'true' ||
        targetBtn.getAttribute('aria-pressed') === 'true';

    if (isActive) {
        console.log('[WT→SPA] Team "' + targetTeamName + '" is al actief \u2014 geen klik nodig.');
        return { ok: true, source: 'already-selected' };
    }

    console.log('[WT→SPA] Klikken op team "' + targetTeamName + '" \u2026');
    targetBtn.click();

    // Wait until role labels re-populate. WorshipTools' Vue re-renders the
    // .col-12.mb-2 > div spans once the team data loads; the default labels
    // include "Worship Leader", "Vocalist", "Piano", etc. We match any of
    // those \u2014 cheap, robust, no team-name guessing needed.
    const startedAt = Date.now();
    const ROLE_HINT = /Worship Leader|Vocalist|Piano|Drums|Guitar|Saxophone|Bass|Beamer|Stream|Audio|Media/i;
    while (Date.now() - startedAt < 6000) {
        const labels = [...document.querySelectorAll(
            '[data-v-402dfe80] .col-12.mb-2 > div, [data-v-402dfe80] .card-section-title ~ * .col-12.mb-2 > div'
        )].map(el => (el.textContent || '').trim());
        if (labels.some(t => ROLE_HINT.test(t))) {
            console.log('[WT→SPA] Team geladen \u2014 rollen zichtbaar na', Date.now() - startedAt, 'ms');
            // Small settle pause so any XHR-fetched fields (avatars, etc.) finish.
            await sleep(400);
            return { ok: true, source: 'clicked' };
        }
        await sleep(180);
    }

    console.warn('[WT→SPA] Rollen niet verschenen binnen 6s na team-klik \u2014 extract gaat toch door.');
    return { ok: false, reason: 'no-roles-after-switch' };
}

/**
 * Run the full weekly sync: team-switch \u2192 setlist \u2192 roster.
 *
 * Why sequence (not parallel): both `extractSetlist` and `extractRoster`
 * call `chrome.runtime.sendMessage` and both trigger `alert()` on completion.
 * Running them in parallel would race both the popup alerts and the
 * background message handler. The roster send happens AFTER the setlist
 * ack so the SPA tab receives both events in predictable order:
 * SETLIST_RECEIVED \u2192 ROSTER_RECEIVED.
 *
 * UI feedback: button shows busy state while running, then final alert.
 */
/**
 * Extract a stable user-UUID from a WorshipTools avatar URL of the form
 *   https://storage.googleapis.com/we-data/users/{UUID}/avatar/...
 * Returns the UUID string or null if the URL doesn't match. UUID is the
 * stable identity for merging one person across multiple team views.
 */
function extractUuidFromAvatar(avatarUrl) {
    if (!avatarUrl) return null;
    const m = String(avatarUrl).match(/\/users\/([^/]+)\/avatar\//);
    return m ? m[1] : null;
}

/**
 * Read every team-switcher button visible on the page and return the
 * team labels in stable document order. Used by the all-teams sync flow
 * to know which teams to iterate through without spamming the user.
 */
function listAllTeamNames() {
    const seen = new Set();
    const out = [];
    document.querySelectorAll(
        'button.list-group-item-action .group-name, ' +
        '[class*="list-group-item-action"] .group-name'
    ).forEach(el => {
        const name = (el.textContent || '').trim();
        if (name && !seen.has(name)) {
            seen.add(name);
            out.push(name);
        }
    });
    return out;
}

/**
 * Run a full-org roster sync: click through every team-switcher on the
 * page, collect who's in each role on each team, deduplicate by UUID,
 * then send ONE aggregated message to the background / SPA.
 *
 * Setlist is extracted ONCE at the start (it doesn't depend on the team
 * view \u2014 it's the same setlist for the same service across teams).
 *
 * UX:
 *   - Single "Sync data" button does the whole job at once.
 *   - Per-team work happens silently: no alerts from collectRosterEntries.
 *   - At the end, ONE summary alert shows the totals (teams scanned,
 *     unique people, total role-assignments). The downstream SPA gets a
 *     single ROSTER_EXTRACTED event with the merged roster.
 *
 * Why merge:
 *   - One person can hold multiple roles across teams (Rafael = Worship
 *     Leader AND Piano in your data). Merging yields one record per person
 *     with `roles: [...]` so the SPA can show them in a single card.
 *   - UUID is the stable key. Falls back to display name when avatar_url
 *     is missing (empty rows don't have a UUID).
 */
async function runAllTeamsSync(opts) {
    // opts.onProgress(msg) is an optional callback the popup passes so it
    // can show progress in its output area. If omitted (e.g. called from
    // DevTools console) we just console.log.
    const onProgress = (opts && typeof opts.onProgress === 'function')
        ? opts.onProgress
        : (msg) => console.log('[WT→SPA] runAllTeamsSync:', msg);

    // Module-level latch replaces the old DOM-buttons dataset.busy guard.
    if (runAllTeamsSync._busy) return;
    runAllTeamsSync._busy = true;
    onProgress('Starten…');

    try {
        // 1. Setlist is per-service, not per-team \u2014 capture once.
        // skipSetlist option: when only roster sync is requested, skip setlist extraction.
        if (!opts || !opts.skipSetlist) {
            extractSetlist();
        }
        // Pull the song count from the cached extraction: dividers (D-prefix)
        // are excluded so the popup doesn't double-count structure items.
        const setlistCount = (__lastSetlistResult && typeof __lastSetlistResult.songCount === 'number')
            ? __lastSetlistResult.songCount
            : ((__lastSetlistResult && __lastSetlistResult.items) ? __lastSetlistResult.items.length : 0);

        // 2. Discover all teams.
        const teamNames = listAllTeamNames();
        if (teamNames.length === 0) {
            emitProgress('complete', { ok: false, summary: { reason: 'no-team-switcher' } });
            onProgress('Geen team-switcher gevonden op deze pagina.');
            return;
        }
        console.log('[WT→SPA] runAllTeamsSync: found teams:', teamNames);

        // 3. For each team: switch, wait for the RolLen to populate,
        //    silently collect entries.
        const allEntries = []; // flat array of {name, role, avatar_url, team}
        // Skip team views aimed at younger audiences — these
        // teams have their own rosters and roles (Kids Worship,
        // Kinderdienst, Jeugd, etc.) that aren’t part of the
        // regular worship-team workflow. Pattern matches the
        // whole word so unrelated names like "Worship Team"
        // aren’t accidentally skipped.
        const SKIP_KIDS_PATTERN = /\b(kids|kinder|jeugd|children|youth|junior|tween)\b/i;
        let skippedTeams = 0;

        for (let i = 0; i < teamNames.length; i++) {
            const team = teamNames[i];
            if (SKIP_KIDS_PATTERN.test(team)) {
                console.log('[WT→SPA] runAllTeamsSync: skipping kids-team:', team);
                skippedTeams++;
                continue;
            }
            onProgress(`Team ${i + 1}/${teamNames.length}: ${team}`);
            const teamResult = await ensureCorrectTeam(team);
            if (!teamResult.ok) {
                console.warn('[WT→SPA] runAllTeamsSync: skipping team', team, teamResult.reason);
                continue;
            }
            const result = collectRosterEntries();
            if (!result.found) {
                console.warn('[WT→SPA] runAllTeamsSync: no RolLen on team', team);
                continue;
            }
            // Stamp each entry with the team it came from \u2014 helps the SPA
            // group/filter results later.
            result.entries.forEach(e => allEntries.push({ ...e, team }));
            console.log('[WT→SPA] Team', team, '\u2192', result.entries.length, 'rol-toewijzingen');
        }

        if (allEntries.length === 0) {
            emitProgress('complete', { ok: false, summary: { reason: 'no-roster', teamsScanned: teamNames.length, people: 0, assignments: 0 } });
            onProgress('Geen rollen gevonden in ' + teamNames.length + ' teams.');
            return;
        }

        // 4. Merge by UUID first, then by display name as fallback.
        const byPerson = new Map();
        for (const e of allEntries) {
            const uuid = extractUuidFromAvatar(e.avatar_url);
            const key = uuid || ('name:' + e.name.toLowerCase());
            let entry = byPerson.get(key);
            if (!entry) {
                entry = {
                    uuid,
                    name: e.name,
                    avatar_url: e.avatar_url || '',
                    byRole: new Map()
                };
                byPerson.set(key, entry);
            }
            if (!entry.uuid && uuid) entry.uuid = uuid;
            if (!entry.byRole.has(e.role)) entry.byRole.set(e.role, new Set());
            entry.byRole.get(e.role).add(e.team);
        }

        // Flatten back to {name, role} so Stage Builder's existing listener
        // (which reads r.role as a singular string) still works.
        const merged = [];
        for (const p of byPerson.values()) {
            for (const [role, teams] of p.byRole.entries()) {
                merged.push({
                    name: p.name,
                    role,
                    avatar_url: p.avatar_url,
                    uuid: p.uuid || null,
                    teams: [...teams].sort()
                });
            }
        }
        merged.sort(function (a, b) {
            const n = a.name.localeCompare(b.name, 'nl');
            return n !== 0 ? n : a.role.localeCompare(b.role, 'nl');
        });

        const uniquePeople = byPerson.size;
        const totalAssignments = merged.length;

        console.log('[WT→SPA] org-wide roster merged:',
                    teamNames.length, 'teams,',
                    uniquePeople, 'unique people,',
                    totalAssignments, 'role-assignments');

        // 6. ONE combined message + ONE summary alert.
        chrome.runtime.sendMessage({
            type: 'ROSTER_EXTRACTED',
            data: merged,
            scope: 'org-wide',
            teams_scanned: teamNames.length
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[WT→SPA] Background error:', chrome.runtime.lastError.message);
            } else {
                console.log('[WT→SPA] org-wide roster ack:', response);
            }
        });

        // Preview: 6 unique person names so the alert doesn't repeat
        // the same person for every role they hold.
        const uniquePeopleArr = [...new Set(merged.map(p => p.name))];
        void uniquePeopleArr; // reserved for future expanded summary

        emitProgress('complete', {
            ok: true,
            summary: {
                teamsScanned: teamNames.length,
                skippedTeams: skippedTeams,
                people: uniquePeople,
                assignments: totalAssignments,
                songs: setlistCount
            }
        });
        onProgress('Org-roster verzameld: ' + uniquePeople + ' personen, ' + totalAssignments + ' rol-toewijzingen.');
    } catch (err) {
        console.error('[WT→SPA] runAllTeamsSync failed:', err);
        emitProgress('complete', { ok: false, summary: { reason: 'error', error: String(err?.message || err) } });
        onProgress('Sync mislukt: ' + (err?.message || String(err)));
    } finally {
        runAllTeamsSync._busy = false;
        onProgress('Klaar.');
    }
}

// ============================================================================
//  POPUP INTEGRATION  (replaces the previous on-page button setup)
// ============================================================================
//
//  Earlier versions injected buttons directly into the WorshipTools
//  page. We moved the UI to the extension popup (popup.html/popup.js)
//  so the page stays clean. The popup talks to this content script
//  through ONE message type:
//
//    WT_START_SYNC   — triggers runAllTeamsSync() through the popup's
//                       Sync data button. Validation lives inside
//                       runAllTeamsSync (no DOM pre-scan needed) so
//                       the popup can show the Sync button as soon
//                       as the tab URL looks like WT — no refresh
//                       required to warm-inject the content script.
//
//  We deliberately do NOT inject anything into the page DOM anymore.
// ============================================================================

// scanCurrentPage() used to power the popup pre-scan. We removed it:
// the popup now shows the Sync button based on the URL alone, and
// runAllTeamsSync() owns all real validation (it reports missing
// elements through WT_SYNC_PROGRESS → renderResultCard).
// See: popup.js renderActiveTab().

/**
 * Fire a progress event back to the popup (and console) for user-
 * facing status updates while runAllTeamsSync is in flight.
 *
 * Popup listens via chrome.runtime.onMessage; content scripts can
 * SEND to runtime (broadcast) which the popup receives too.
 */
function emitProgress(phase, payload) {
    try {
        chrome.runtime.sendMessage({ type: 'WT_SYNC_PROGRESS', phase: phase, payload: payload || {} },
            function () { void chrome.runtime.lastError; });
    } catch (_) { /* popup may be closed — ignore */ }
}

// Wrapper that forwards both console.log + popup updates so the
// popup UI reflects the same status messages we already produce.
function reportProgress(msg) {
    console.log('[WT→SPA] runAllTeamsSync:', msg);
    emitProgress('log', { msg: msg });
}

// Replace the local helper inside runAllTeamsSync so it broadcasts
// to the popup. We patch by monkey-patching the original closure
// once here, after the function definition is parsed.
// Note: runAllTeamsSync is hoisted to the top of the module, so we
// can reach it here.
(function patchRunAllTeamsSync() {
    var original = runAllTeamsSync;
    // We rebuild the function so its `onProgress` defaults to the
    // popup-aware reporter above. Calling it without args from
    // console still works (falls through to console.log).
    runAllTeamsSync = function (opts) {
        if (!opts || typeof opts.onProgress !== 'function') {
            opts = Object.assign({}, opts || {}, { onProgress: reportProgress });
        }
        return original.call(this, opts);
    };
})();// ======================================================================
//  DEV-ONLY DEBUG HOOK — page-console inspector (CSP-safe).
// ======================================================================
//
//  Why no inline <script>: WorshipTools sets a strict `script-src` that
//  does not include 'unsafe-inline'. Injecting a <script> node and
//  assigning textContent is blocked. So we don't try.
//
//  Instead the cache is mirrored onto a DOM attribute that BOTH worlds
//  can read directly: `document.documentElement.dataset.wtDbg`. After
//  every sync, `extractSetlist()` updates this attribute (see above).
//
//  Usage in WorshipTools page DevTools console (no async, no setup):
//      const dbg = JSON.parse(document.documentElement.dataset.wtDbg || 'null');
//      console.table(dbg.structured.map(s => ({ code: s.number || '(geen)', title: s.name.slice(0, 50) })));
//      dbg.songCount           // number of real songs (D000 excluded)
//      dbg.date                // service date
//
//  ISOLATED-world content-script callers keep using `__wtDebug()` as a
//  synchronous helper (defined just below).
// ======================================================================

// ISOLATED-world debug helper for content-script callers.
Object.defineProperty(window, '__wtDebug', {
    value: function (mode) {
        var r = __lastSetlistResult;
        if (!r) return null;
        if (mode === 'divider') {
            return r.structured.filter(function (s) {
                return s.number === 'D000';
            });
        }
        if (mode === 'songs') {
            return r.structured.filter(function (s) {
                return !s.number || s.number !== 'D000';
            });
        }
        return r;
    },
    writable: false,
    enumerable: false,
    configurable: false
});

// Content-script message bridge: popup → content script.
// Both handlers MUST return true to keep the response channel
// open (popups disconnect quickly, so async responses would
// otherwise arrive after the channel closes).
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'WT_START_SYNC') {
        emitProgress('start', {});
        runAllTeamsSync({ onProgress: reportProgress })
            .then(function () {
                emitProgress('done', { ok: true });
                sendResponse({ ok: true });
            })
            .catch(function (err) {
                console.error('[WT→SPA] runAllTeamsSync failed:', err);
                emitProgress('done', { ok: false, error: String(err && err.message || err) });
                sendResponse({ ok: false, error: String(err && err.message || err) });
            });
        return true;
    }

    return false; // not one of ours
});

// ======================================================================
//  IN-PAGE FLOATING SYNC BUTTON + OVERLAY (For PWA app windows & tabs)
// ======================================================================
function injectFloatingSyncButton() {
    if (document.getElementById('ichtus-floating-sync-btn')) return;
    if (!/\/app\/account\/[^/]+\/service\/[^/?#]+/i.test(location.href)) return;

    const CSS = `
        @keyframes ichtusFadeIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes ichtusPulse { 0%,100% { box-shadow: 0 4px 14px rgba(255,107,0,0.35); } 50% { box-shadow: 0 4px 20px rgba(255,107,0,0.55); } }

        #ichtus-floating-sync-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            width: 52px;
            height: 52px;
            border-radius: 14px;
            border: none;
            outline: none;
            cursor: pointer;
            background: transparent;
            box-shadow: none;
            transition: transform 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: visible;
        }
        #ichtus-floating-sync-btn::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: #ff6b00;
            opacity: 0.6;
            z-index: -1;
            animation: ichtus-beacon 2s cubic-bezier(0, 0, 0.2, 1) infinite;
            pointer-events: none;
        }
        @keyframes ichtus-beacon {
            0% { transform: scale(1); opacity: 0.7; }
            70% { transform: scale(1.45); opacity: 0; }
            100% { transform: scale(1.45); opacity: 0; }
        }
        #ichtus-floating-sync-btn[data-sync-state="syncing"]::after {
            animation: ichtus-beacon 0.8s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        #ichtus-floating-sync-btn:hover {
            transform: scale(1.08);
            box-shadow: none;
        }
        #ichtus-floating-sync-btn img {
            width: 48px;
            height: 48px;
            pointer-events: none;
        }

        /* ── Overlay backdrop ── */
        #ichtus-sync-overlay {
            position: fixed;
            inset: 0;
            z-index: 999998;
            background: rgba(0,0,0,0.55);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            display: flex;
            align-items: flex-end;
            justify-content: flex-end;
            padding: 24px;
            animation: ichtusFadeIn 0.22s ease-out;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }

        /* ── Panel ── */
        #ichtus-sync-panel {
            width: 360px;
            max-height: calc(100vh - 100px);
            background: linear-gradient(145deg, #1e1e1e 0%, #141414 100%);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 16px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .ichtus-panel-header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 16px 18px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .ichtus-panel-header img {
            width: 28px;
            height: 28px;
            border-radius: 6px;
        }
        .ichtus-panel-header h2 {
            flex: 1;
            font-size: 15px;
            font-weight: 700;
            color: #f9f9f7;
            margin: 0;
        }
        .ichtus-panel-close {
            background: none;
            border: none;
            color: #9ca3af;
            font-size: 20px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 6px;
            line-height: 1;
            transition: all 0.15s;
        }
        .ichtus-panel-close:hover { color: #f9f9f7; background: rgba(255,255,255,0.1); }

        .ichtus-panel-body {
            padding: 14px 18px;
            overflow-y: auto;
            flex: 1;
            color: #d1d5db;
            font-size: 13px;
            line-height: 1.5;
        }

        /* ── Section blocks ── */
        .ichtus-sync-section {
            margin-bottom: 16px;
        }
        .ichtus-sync-section-label {
            font-size: 10px;
            font-weight: 700;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 8px;
        }

        /* ── Checkbox rows ── */
        .ichtus-check-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            border-radius: 9px;
            border: 1px solid rgba(255,255,255,0.08);
            background: rgba(255,255,255,0.03);
            margin-bottom: 6px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .ichtus-check-row:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); }
        .ichtus-check-row input[type=checkbox] {
            accent-color: #ff6b00;
            width: 16px;
            height: 16px;
            cursor: pointer;
            flex-shrink: 0;
        }
        .ichtus-check-label { flex: 1; font-size: 13px; color: #f9f9f7; }
        .ichtus-check-meta { font-size: 11px; color: #6b7280; }

        /* ── Song list ── */
        .ichtus-song-list {
            max-height: 160px;
            overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 9px;
            background: rgba(0,0,0,0.25);
        }
        .ichtus-song-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            font-size: 12px;
            color: #d1d5db;
            border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .ichtus-song-item:last-child { border-bottom: none; }
        .ichtus-song-num {
            font-family: 'SF Mono','Cascadia Code','Consolas',monospace;
            font-size: 10px;
            font-weight: 700;
            color: #ff6b00;
            background: rgba(255,107,0,0.12);
            padding: 2px 6px;
            border-radius: 4px;
            flex-shrink: 0;
            min-width: 36px;
            text-align: center;
        }
        .ichtus-song-num.empty { color: #4b5563; background: rgba(255,255,255,0.04); }
        .ichtus-song-divider {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            font-size: 10px;
            color: #4b5563;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }
        .ichtus-song-divider::before,
        .ichtus-song-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: rgba(255,255,255,0.06);
        }

        .ichtus-empty-msg {
            color: #4b5563;
            font-size: 12px;
            padding: 8px 0;
            font-style: italic;
        }

        /* ── Team chips ── */
        .ichtus-team-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .ichtus-team-chip {
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.04);
            color: #9ca3af;
        }

        /* ── Sync button ── */
        .ichtus-sync-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 10px;
            background: linear-gradient(135deg, #ff6b00 0%, #e05500 100%);
            color: #fff;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.18s;
            margin-top: 4px;
        }
        .ichtus-sync-btn:hover:not(:disabled) {
            box-shadow: 0 4px 16px rgba(255,107,0,0.4);
            transform: translateY(-1px);
        }
        .ichtus-sync-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        .ichtus-sync-btn.syncing {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        }

        /* ── Status line ── */
        .ichtus-sync-status {
            padding: 10px 18px 14px;
            border-top: 1px solid rgba(255,255,255,0.06);
            font-size: 11px;
            color: #6b7280;
            min-height: 38px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .ichtus-sync-status .dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .ichtus-sync-status .dot.ok { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
        .ichtus-sync-status .dot.busy { background: #3b82f6; box-shadow: 0 0 6px #3b82f6; animation: ichtusPulse 1s infinite; }
        .ichtus-sync-status .dot.err { background: #ef4444; box-shadow: 0 0 6px #ef4444; }
        .ichtus-sync-status .dot.idle { background: #4b5563; }
    `;

    // Inject stylesheet
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // ── Floating button ──
    const btn = document.createElement('button');
    btn.id = 'ichtus-floating-sync-btn';
    btn.title = 'Ichtus Sync';
    const logo = document.createElement('img');
    logo.src = 'data:image/png;base64,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';
    logo.alt = 'Ichtus';
    btn.appendChild(logo);
    document.body.appendChild(btn);

    // ── Overlay + panel ──
    function openOverlay() {
        if (document.getElementById('ichtus-sync-overlay')) return;
        btn.style.display = 'none';

        // Pre-scan: extract setlist + discover teams
        extractSetlist();
        const setlist = window.__lastSetlistResult || null;
        const teams = listAllTeamNames();

        // Build overlay
        const overlay = document.createElement('div');
        overlay.id = 'ichtus-sync-overlay';

        const panel = document.createElement('div');
        panel.id = 'ichtus-sync-panel';

        // ── Header ──
        panel.innerHTML = `
            <div class="ichtus-panel-header">
                <img src="data:image/png;base64,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" alt="Ichtus">
                <h2>Ichtus Sync</h2>
                <button class="ichtus-panel-close" id="ichtus-close-overlay">&times;</button>
            </div>
            <div class="ichtus-panel-body" id="ichtus-panel-body"></div>
            <div class="ichtus-sync-status" id="ichtus-sync-status">
                <span class="dot idle"></span>
                <span>Klaar om te synchroniseren</span>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // ── Close handlers ──
        document.getElementById('ichtus-close-overlay').onclick = closeOverlay;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', escHandler); }
        });

        // ── Body content ──
        const body = document.getElementById('ichtus-panel-body');

        // 1. Sync scope checkboxes
        let html = `
            <div class="ichtus-sync-section">
                <div class="ichtus-sync-section-label">Wat synchroniseren?</div>
                <label class="ichtus-check-row">
                    <input type="checkbox" id="ichtus-sync-setlist" checked>
                    <span class="ichtus-check-label">🎶 Setlist / Liederen</span>
                    <span class="ichtus-check-meta">${setlist ? setlist.songCount + ' lied' + (setlist.songCount !== 1 ? 'eren' : '') : 'geen'}</span>
                </label>
                <label class="ichtus-check-row">
                    <input type="checkbox" id="ichtus-sync-roster" checked>
                    <span class="ichtus-check-label">👥 Team / Roster</span>
                    <span class="ichtus-check-meta">${teams.length} team${teams.length !== 1 ? 's' : ''}</span>
                </label>
            </div>
        `;

        // 2. Song list
        if (setlist && setlist.structured && setlist.structured.length > 0) {
            html += `
                <div class="ichtus-sync-section">
                    <div class="ichtus-sync-section-label">Liederen op deze dienst</div>
                    <div class="ichtus-song-list">
            `;
            let prevWasDivider = false;
            setlist.structured.forEach((song) => {
                const isDivider = song.number && /^D\d+$/.test(song.number) && song.number !== 'D000';
                if (isDivider) {
                    if (!prevWasDivider) {
                        html += `<div class="ichtus-song-divider">${song.name || 'Onderdeel'}</div>`;
                    }
                    prevWasDivider = true;
                } else {
                    prevWasDivider = false;
                    const numClass = song.number ? '' : ' empty';
                    html += `
                        <div class="ichtus-song-item">
                            <span class="ichtus-song-num${numClass}">${song.number || '—'}</span>
                            <span>${song.name}</span>
                        </div>
                    `;
                }
            });
            html += `</div></div>`;
        } else {
            html += `
                <div class="ichtus-sync-section">
                    <div class="ichtus-sync-section-label">Liederen</div>
                    <div class="ichtus-empty-msg">Geen setlist gevonden op deze pagina.</div>
                </div>
            `;
        }

        // 3. Teams found
        if (teams.length > 0) {
            html += `
                <div class="ichtus-sync-section">
                    <div class="ichtus-sync-section-label">Gevonden teams</div>
                    <div class="ichtus-team-chips">
                        ${teams.map(t => `<span class="ichtus-team-chip">${t}</span>`).join('')}
                    </div>
                </div>
            `;
        }

        // 4. Sync button
        html += `
            <button class="ichtus-sync-btn" id="ichtus-do-sync">🔄 Synchroniseren</button>
        `;

        body.innerHTML = html;

        // ── Sync action ──
        document.getElementById('ichtus-do-sync').onclick = async () => {
            const doSetlist = document.getElementById('ichtus-sync-setlist').checked;
            const doRoster = document.getElementById('ichtus-sync-roster').checked;
            if (!doSetlist && !doRoster) return;

            const syncBtn = document.getElementById('ichtus-do-sync');
            const statusEl = document.getElementById('ichtus-sync-status');
            syncBtn.disabled = true;
            syncBtn.classList.add('syncing');
            syncBtn.innerHTML = '⏳ Synchroniseren...';
            statusEl.innerHTML = '<span class="dot busy"></span><span>Bezig met synchroniseren...</span>';

            try {
                if (doSetlist && doRoster) {
                    // Full sync: setlist + roster together
                    await runAllTeamsSync({
                        onProgress: (msg) => {
                            console.log('[WT→SPA] Sync:', msg);
                            statusEl.innerHTML = `<span class="dot busy"></span><span>${msg}</span>`;
                        }
                    });
                } else if (doSetlist) {
                    // Setlist only
                    extractSetlist();
                    statusEl.innerHTML = '<span class="dot ok"></span><span>✅ Setlist gesynchroniseerd!</span>';
                } else if (doRoster) {
                    // Roster only (teams)
                    await runAllTeamsSync({
                        skipSetlist: true,
                        onProgress: (msg) => {
                            console.log('[WT→SPA] Sync:', msg);
                            statusEl.innerHTML = `<span class="dot busy"></span><span>${msg}</span>`;
                        }
                    });
                }

                syncBtn.innerHTML = '✅ Gesynchroniseerd!';
                syncBtn.classList.remove('syncing');
                if (!statusEl.querySelector('.ok') && !statusEl.querySelector('.err')) {
                    statusEl.innerHTML = '<span class="dot ok"></span><span>✅ Alles gesynchroniseerd!</span>';
                }
                setTimeout(() => {
                    syncBtn.disabled = false;
                    syncBtn.innerHTML = '🔄 Synchroniseren';
                    statusEl.innerHTML = '<span class="dot idle"></span><span>Klaar om opnieuw te synchroniseren</span>';
                }, 3000);
            } catch (err) {
                console.error('[WT→SPA] Sync error:', err);
                syncBtn.innerHTML = '❌ Mislukt';
                syncBtn.classList.remove('syncing');
                statusEl.innerHTML = `<span class="dot err"></span><span>Sync mislukt: ${err?.message || 'onbekend'}</span>`;
                setTimeout(() => {
                    syncBtn.disabled = false;
                    syncBtn.innerHTML = '🔄 Synchroniseren';
                    statusEl.innerHTML = '<span class="dot idle"></span><span>Klaar om opnieuw te proberen</span>';
                }, 4000);
            }
        };
    }

    function closeOverlay() {
        const overlay = document.getElementById('ichtus-sync-overlay');
        if (overlay) overlay.remove();
        btn.style.display = '';
    }

    btn.onclick = openOverlay;
}

setInterval(() => {
    if (/\/app\/account\/[^/]+\/service\/[^/?#]+/i.test(location.href)) {
        injectFloatingSyncButton();
    } else {
        const existing = document.getElementById('ichtus-floating-sync-btn');
        if (existing) existing.remove();
        const overlay = document.getElementById('ichtus-sync-overlay');
        if (overlay) overlay.remove();
    }
}, 1000);

