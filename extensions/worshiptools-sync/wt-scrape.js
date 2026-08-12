/* =============================================================================
 * wt-scrape.js  —  optional dev/snippet helper for the WorshipTools extension
 *
 *  WHAT THIS IS
 *    A self-contained scrape routine extracted from the conversation around
 *    extensions/worshiptools-sync/. It is NOT referenced from manifest.json
 *    and is NOT auto-loaded into any WorshipTools tab. It exists so you can
 *    paste it into Chrome DevTools (or run it as a Snippet, or drop it into
 *    a <script> in the popup) when you want to debug the data model.
 *
 *    NOTE: this file lives inside the extension folder but is NOT loaded
 *    by any content_script (manifest.json doesn't mention it). Keep it
 *    that way — the underscore-prefix convention from the original
 *    filename is NOT valid in Chrome MV3 (Chrome reserves _* names for
 *    its own internals and will refuse to load the whole extension if
 *    any file in the folder starts with `_`).
 *
 *  WHY IT EXISTS
 *    On a cold reload the WorshipTools page sometimes loads with the WRONG
 *    team context (`Ichtus Beheer` instead of `Ichtus Muziek Team`), which
 *    makes the roster and order-of-service selectors return empty results.
 *    This file gives you three things in one place:
 *      1. `WT.ensureCorrectTeam(teamName)`  — finds & clicks the team-switcher
 *      2. `WT.clickAllTabsAndWait()`        — activates every <role="tab">
 *      3. `WT.snapshotService()`            — reads the now-stable DOM
 *
 *  HOW TO USE
 *      Open the WorshipTools service page.
 *      Open DevTools → Sources → Snippets (or just paste into the console).
 *      Paste the entire contents of this file, then run:
 *
 *          await WT.runFullScrape('Ichtus Muziek Team')
 *          // or, if the page is already on the right team:
 *          WT.snapshotService()
 *
 *  EMITTED PAYLOAD
 *      {
 *        ok:        Boolean,
 *        reason:    String | undefined,   // 'wrong-team' | 'no-tabs' | 'no-scope' | ok
 *        scrapedAt: ISOString,
 *        url:       currentLocationHref,
 *        team:      String | null,
 *        meta:      { dateText, typeText, serviceTimes[] },
 *        teamRoles: [{ role, people: [{ name, uuid, status }] }, ...],
 *        orderOfService: [{ code, title, key, lengthText }]
 *      }
 * ============================================================================= */

(function () {
  'use strict';

  // Guard against double-injection (e.g. pasted twice in the same console).
  if (window.__WT_SCRAPE_LOADED__) {
    console.warn('[wt-scrape] already loaded — window.WT is unchanged.');
    return;
  }
  window.__WT_SCRAPE_LOADED__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --------------------------------------------------------------------------
  // 1. TEAM SWITCHER
  //    WorshipTools exposes a team-switcher as a button or anchor that
  //    contains the team name as plain text. We scan buttons/anchors/role-
  //    buttons, find the first exact-match clickable element, and click it.
  //
  //    Returns:
  //      { ok: true,  team: '<name>' }
  //      { ok: false, reason: 'wrong-team' | 'multiple-matches',
  //        candidates: [..text snippets..] }
  // --------------------------------------------------------------------------
  async function ensureCorrectTeam(teamName) {
    const scanClickables = () =>
      [
        ...document.querySelectorAll(
          'button, a, [role="button"], [role="menuitem"]'
        ),
      ];

    const exactMatch = scanClickables().find(
      (el) => (el.textContent || '').trim() === teamName
    );

    if (exactMatch) {
      exactMatch.click();
      await sleep(700);
      return { ok: true, team: teamName };
    }

    // Nothing matched — return sample of candidate names so you can pick the
    // right one or fix the selector. First 10 unique non-empty strings.
    const candidates = [
      ...new Set(
        scanClickables()
          .map((el) => (el.textContent || '').trim())
          .filter((t) => t && t.length < 80)
      ),
    ].slice(0, 10);

    return { ok: false, reason: 'wrong-team', candidates };
  }

  // --------------------------------------------------------------------------
  // 2. TAB ACTIVATION
  //    Click every <role="tab"> that is not currently selected, then wait
  //    for the linked Bootstrap-Vue panel to mount children. Returns the
  //    number of tabs that we activated.
  // --------------------------------------------------------------------------
  async function clickAllTabsAndWait({ maxWaitPerTabMs = 4000 } = {}) {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    let activated = 0;

    for (const tab of tabs) {
      const label = tab.textContent?.trim() || tab.id || '(unnamed tab)';
      const isSelected = tab.getAttribute('aria-selected') === 'true';

      if (!isSelected) {
        try {
          tab.click();
          activated += 1;
        } catch (err) {
          console.warn('[wt-scrape] tab click failed:', label, err);
          continue;
        }
      }

      // Map tab.id  "__BVID__1731__BV_tab_button__"  →  "__BVID__1731"
      const panelId = tab.id?.replace(/__BV_tab_button__$/, '');
      const panel = panelId && document.getElementById(panelId);
      if (!panel) {
        await sleep(120);
        continue;
      }

      // Wait until panel is visible and populated, or timeout.
      const start = Date.now();
      while (Date.now() - start < maxWaitPerTabMs) {
        const ready =
          panel.getAttribute('aria-hidden') === 'false' &&
          panel.querySelectorAll('*').length > 0;
        if (ready) break;
        await sleep(120);
      }

      // Small settle-pause so any Vue transitions have time to finish.
      await sleep(280);
    }

    return { ok: true, activated, total: tabs.length };
  }

  // --------------------------------------------------------------------------
  // 3. DOM SNAPSHOT
  //    Reads the three known Vue scopes from the conversation:
  //      data-v-1b9912ea  → service meta (date/type/times)
  //      data-v-3dc57186  → order-of-service cue rows
  //      data-v-402dfe80  → roster (role + people)
  //    Emits a plain JSON-ready object.
  // --------------------------------------------------------------------------
  function snapshotService({ detectedTeam = null } = {}) {
    const root = document;

    // ---- meta (very defensive — many of these selectors may change) ----
    const meta = (() => {
      const dateText = root.querySelector('.font-weight-bold.large-text')
        ?.textContent?.trim() || null;
      const typeText = root.querySelector('.badge-warning + div')
        ?.textContent?.trim() || null;
      const serviceTimes = [
        ...root.querySelectorAll('h2.typed-service-time'),
      ].map((e) => e.textContent.trim());
      return { dateText, typeText, serviceTimes };
    })();

    // ---- team roles + people (data-v-402dfe80) ----
    const teamRoles = [
      ...root.querySelectorAll('[data-v-402dfe80] .col-12.mb-2 > div'),
    ]
      .map((roleEl) => {
        if (!roleEl) return null;
        const role = roleEl.textContent.trim();
        // Walk up to the wrapping row, then collect its list-group-items.
        const row = roleEl.closest('.row') || roleEl.parentElement;
        const people = [...row.querySelectorAll('.list-group-item')]
          .map((li) => {
            const name = li.querySelector('.user-name span:last-child')
              ?.textContent?.trim();
            if (!name) return null;

            const img = li.querySelector('img[src*="we-data/users"]');
            const uuid = img?.src.match(/users\/([^/]+)\//)?.[1] ?? null;

            const status =
              li.querySelector('.border-success') != null
                ? 'Accepted'
                : li.querySelector('.border-danger') != null
                ? 'Declined'
                : li.querySelector('.border-secondary') != null
                ? 'NotYetResponded'
                : 'Empty';

            return { name, uuid, status };
          })
          .filter(Boolean);
        return { role, people };
      })
      .filter(Boolean);

    // ---- order of service (data-v-3dc57186) ----
    const orderOfService = [
      ...root.querySelectorAll(
        '[data-v-3dc57186] tbody tr.draggable-item'
      ),
    ]
      .map((tr) => {
        const cueTitle = tr
          .querySelector('.cue-title h3')
          ?.textContent?.trim();
        if (!cueTitle) return null;

        const timeText =
          tr.querySelector('td.time')?.textContent?.trim() || null;
        const key =
          tr.querySelector('.medium')?.textContent?.trim() || null;

        // Titles look like "O638  Prijs Adonai" — peel off the leading
        // letter+digit code so we keep it as a separate field.
        const codeMatch = cueTitle.match(/^([A-Z]\d+)\s+(.*)$/);
        const code = codeMatch ? codeMatch[1] : null;
        const title = codeMatch ? codeMatch[2] : cueTitle;

        return { code, title, key, lengthText: timeText };
      })
      .filter(Boolean);

    return {
      ok: true,
      scrapedAt: new Date().toISOString(),
      url: location.href,
      team: detectedTeam,
      meta,
      teamRoles,
      orderOfService,
    };
  }

  // --------------------------------------------------------------------------
  // 4. ONE-SHOT ENTRY POINT
  //    Tries team selection → tab activation → scrape. Returns a single
  //    object with a top-level `ok` so the caller can branch on it.
  // --------------------------------------------------------------------------
  async function runFullScrape(teamName /* optional */) {
    const log = (...args) => console.info('[wt-scrape]', ...args);

    // If a team name was supplied, try to switch to it first.
    if (teamName) {
      const teamResult = await ensureCorrectTeam(teamName);
      if (!teamResult.ok) {
        return {
          ok: false,
          reason: 'wrong-team',
          message: `Kon team "${teamName}" niet vinden. Mogelijke kandidaten: ` +
            teamResult.candidates.join(' | '),
          candidates: teamResult.candidates,
        };
      }
      log('team selected:', teamResult.team);
    }

    // Activate all tabs so any lazy-mounted content is in the DOM.
    const tabResult = await clickAllTabsAndWait();
    log('tabs activated:', tabResult.activated, 'of', tabResult.total);

    // Quick sanity check: if the roster scope is still empty, surface that
    // as a clear failure rather than letting the JSON dump silently be `[]`.
    if (document.querySelectorAll('[data-v-402dfe80]').length === 0) {
      return {
        ok: false,
        reason: 'no-scope',
        message:
          'Geen data-v-402dfe80 nodes gevonden. Pagina is waarschijnlijk ' +
          'op een andere view (geen dienst) of het juiste team is nog ' +
          'niet geselecteerd.',
      };
    }

    // Wait half a second so any post-tab-fetched XHRs settle into the DOM.
    await sleep(500);

    return snapshotService({ detectedTeam: teamName || null });
  }

  // --------------------------------------------------------------------------
  // EXPORTS
  // --------------------------------------------------------------------------
  window.WT = {
    ensureCorrectTeam,
    clickAllTabsAndWait,
    snapshotService,
    runFullScrape,
  };

  console.info(
    '%c[wt-scrape] loaded — try: await WT.runFullScrape("Ichtus Muziek Team")',
    'color:#3B82F6;font-weight:bold'
  );
})();
