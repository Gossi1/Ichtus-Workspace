# v2.1.0 — Stagebuilder X32, extension auto-update, agenda WYSIWYG

> Builds on v2.0.0 with production-ready X32 Stagebuilder features,
> a self-updating Chrome extension, and polish across the board.

## Headline

* **Stagebuilder — X32 console integration.** Connect to a Behringer X32 via
  the OSC bridge (mic-iem-server, port 3002), poll all 100 library slots,
  and auto-suggest presets per roster member using first-name + role heuristics.
  Drag-and-drop override any slot/channel; push individual or bulk (Recall All)
  to the X32 over OSC.

* **Auto Assign button** — one-click reset: wipes all manual slot/channel
  overrides and persisted mappings, then re-runs role-based channel rules
  (WL → CH 1/4, gitaar → CH 10, bas → CH 8, vocalisten → CH 1-3, rest →
  roster-volgorde) + slot auto-suggest in one shot.

* **Auto-update Chrome extension.** The WorshipTools Sync extension (v1.2)
  checks GitHub for new releases every hour. A badge `!` appears on the icon
  when an update is available; click the icon to open the releases page.
  The extension popup also has a **Git Pull** button that calls the server's
  `/api/update` endpoint — pull the latest code without leaving the browser.

## Stagebuilder

* Glassmorphism status bar redesign: translucent pill for connection telemetry,
  segmented button group for Connect/Poll/Disconnect, accent buttons for Auto
  Assign (amber) and Recall All (blue gradient).
* `recallAll()` / `pushAll()` — batch push every recall-ready row
  (slot + channel assigned) in one POST to the OSC bridge.
* `autoAssignAll()` — destructive reset + re-apply of all rules
  (see Headline). Synchronous, always enabled, preserves migration flag.
* Role-locked rows (drums, piano, keys, synth, organ): dropdown replaced with
  read-only state block so operators cannot accidentally overcommit fixed
  instrument channels.
* Cross-row WL detection: if the same person appears as both "Worship Leader"
  and "Piano" in the roster, the WL row gets CH 4 (WL+instrument) instead
  of CH 1 (WL only-singing).
* Channel-usage histogram logged on every `_assignChannelsByRole()` run.
* AbortController management per fetch — cleanup() cancels all in-flight
  requests, no stale state leaks across view switches.
* One-time migration of old localStorage channel entries → role-based rules.
* Roster fingerprinting: identical arrays (same service re-navigation) skip
  re-render for free performance.

## Chrome Extension (v1.2)

* Auto-update from GitHub: `fetchLatestRelease()`, semver comparison,
  `chrome.action` badge + tooltip update. Checks every hour via
  `chrome.alarms`.
* Extension popup (`popup.html`/`popup.js`): dark-themed UI showing:
  - Extension version + update status (from GitHub)
  - Server connection tester
  - **Git Pull** button — runs `git fetch origin && git pull` via
    `POST /api/update`, shows real-time output
  - Quick links to GitHub releases + `chrome://extensions`
* Dynamic SPA bridge injection: `background.js` detects SPA tabs on any
  IP:port (not just listed ports) via URL/title patterns and injects
  `spa-bridge.js` on the fly using `chrome.scripting.executeScript`.
  Session-storage guard prevents double injection.
* Bridge status indicator in setlist view: green/orange dot on the
  WorshipTools card shows whether `data-ichtus-bridge` is detected.
* Song-number extraction: `content.js` recognises patterns like `O586`
  / `D013` and treats them as structured song references.
* Robust error handling: try/catch wrappers around `extractSetlist()`,
  `parseSongNumber()`, bridge message handlers.

## Agenda

* WYSIWYG position tracking: real-time X/Y coordinates displayed during
  drag of the agenda text overlay on the exported PNG.
* Position persistence through localStorage, restored on page load.

## Server

* `POST /api/update` endpoint in `server.py`: runs `git fetch origin`
  followed by `git pull` via subprocess (30s timeout per command),
  returns JSON with stdout/stderr output + exit code.
* `exit_code` calculation uses `max(fetch_code, pull_code)` for correct
  error propagation.

## Files changed since v2.0.0

See the diff at: `https://github.com/Gossi1/Ichtus-Workspace/compare/v2.0.0...v2.1.0`
