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
        extractSetlist();
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
