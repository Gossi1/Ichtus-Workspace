# v2.0.0 — Firebase auto-load + cleanup sweep

> Supersedes v1.2.4 — closes the gap previously caused by
> server.py `current_version` lagging behind the v1.2.4 tag on origin.

## Headline

* **Firebase auto-load.** Drop your web-app config into
  `Ichtus_SPA/firebase-config.txt` (gitignored) and the browser loads it
  automatically on refresh — no setup modal, no in-browser form required.
  `firebase-init.js` resolves from 4 sources in priority order:
  1. `localStorage.firebaseConfig` (pasted through the in-browser modal)
  2. `window.FIREBASE_CONFIG` (server-injected from `firebase-api-key.txt`)
  3. **`Ichtus_SPA/firebase-config.txt`** (NEW — auto-loaded at runtime)
  4. `FIREBASE_CONFIG` (bundled placeholder)
  Drop-in files accept JSON or key:value lines, matching `server.py`'s parser.

* **v2.0 reflects the natural break point:** from this release, the
  in-browser setup-screen flow is opt-in rather than the default deploy
  path. Users who want zero-touch local setups can now skip it entirely.

## Major UX

* **Glassmorphism UI redesign across dashboard / checklist / role-selector
  / preset-select / analytics / agenda views**, plus glass-edge CSS
  tuneups rolled in as the design stabilised.
* Dynamic look tracking with configurable `lookDurations`
* Mic & IEM Monitor dashboard widget, real-time status + edit mode
* Playlist overview promoted into a ProPresenter Control Center widget
* Playlist settings dropdown behind a gear button
* Layout selector uses a custom CSS chevron dropdown

## Quality

* Cleanup sweep:
  * Dead-code removal across `agenda`, `checklist`, `dashboard`, `ndi`,
    `settings`, `patchbay` (per-module audit with bindEvents wiring
    awareness — zero false positives).
  * `source.html` (+757 lines) and `Ichtus_SPA/firebase-config.example.txt`
    deleted.
  * Patchbay audio-state attributes removed.
  * `settings.js#setupFirebase` + duplicate NDI-module extension removed.
* Hardcoded glass-edge values mirror the `source.html` settings design.
* Role-selector buttons correctly centered inside the dark backdrop.
* Checklist view defaults to block layout when admin sidebar is closed.
* Setlist extraction filters user notes out — only the first span per
  `.song-description` is taken (no more accidental note passthrough).
* WorshipTools setlist extraction: lowercase songcode detection +
  Dutch note-fragment exclusion.
* Settings CSS rules restored + select width fixed to match `source.html`.

## Documentation

* `README.md` — Quick Start, Project Structure and the
  🔐 Firebase Configuration section rewritten to document the 4-source
  priority + the new drop-in path.
* `Ichtus_SPA/FEATURES.md` — new per-module Firestore-collection map +
  4-source auto-load chain table + `LocalStorage.firebaseConfig` bullet.

## Files changed since v1.2.4

See the diff at: `https://github.com/Gossi1/Ichtus-Workspace/compare/v1.2.4...v2.0.0`
