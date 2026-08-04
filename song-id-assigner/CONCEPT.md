# Song ID Assigner — Concept Plan (v2)

*New standalone app, lives at the repo root next to `Ichtus_SPA/`, served by the existing `server.py`.*

---

## 1. Goal (corrected)

An **ID bookkeeper**. Most songs in our library already have an ID — a letter prefix +
number (`D044`, `H101`, `O586`, `OK001`, `K012`). The app's job:

1. **Import** the song list and learn which IDs already exist (per prefix).
2. When adding a **new song**, the user picks the **letter** — the app computes the
   **next free number** for that prefix.
3. Save the whole library as a JSON file on the laptop.

This is *not* a criteria/rule engine. The user decides the letter; the app only decides
the number, based on what's already in the library.

## 2. Import

The app reads a song list where most entries already contain an ID in the title, e.g.:

```
D044 Great I Am
H101 Vaste Rots van mijn behoud
OK001 Love Came Down
```

The app parses prefix + number from each line (same pattern `parseSongNumber` in the
extension already uses: `D`, `H`, `O`, `OK`, `K`, `Ps`, `LvK`, `ELB` …).

Import options:
- **File import** (CSV / JSON / pasted text) — always works, primary path
- **ProPresenter "Songs" library** (reuse the API calls `setlist.js` already makes) — optional, later
- Songs without an ID are imported too — they simply get an ID when added via step 3

## 3. Adding a song → "you pick the letter, the app picks the number"

The core screen:

```
Song title:  [Vaste Rots van mijn behoud      ]
ID letter:   [H ▾]        (dropdown of known prefixes: D, H, O, OK, K…)
→ App shows:  Next free:  H104
[Add to library]
```

Numbering rule:
- For the chosen prefix, find the **highest number already in the library** → suggest
  **highest + 1** (`H103` → `H104`).
- If the prefix is new (no songs yet) → start at `1` (`K001` or `K1`, depending on format).
- Unknown prefixes can be typed in by hand too (e.g. a brand-new `T` group).

Open question (needs your answer): *exactly* "highest + 1", or fill gaps first?
I assumed highest + 1.

## 4. Output — JSON file

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-04T15:00:00Z",
  "songs": [
    { "id": "D044", "prefix": "D", "number": "044", "title": "Great I Am", "artist": "Jonas Myrin" },
    { "id": "H104", "prefix": "H", "number": "104", "title": "Vaste Rots van mijn behoud", "artist": "" }
  ]
}
```

Note: a `uid` is generated at runtime by `ensureUid()` in the app (used for DOM
targeting in delete/edit handlers) but is **not** persisted in the file —
it's regenerated on every load. Likewise the older `altTitles` field has been
retired: each translated title (NL↔EN pair, etc.) is now its own row in the
library rather than an alternative identity on the same row.

## 5. Saving files on the laptop (PWA question)

| Way | How | Catch |
|-----|-----|-------|
| ⭐ **Via existing `server.py`** | One tiny endpoint writes/reads the JSON on disk | Needs the local server running (you already run it) |
| **File System Access API** | Browser-native `showSaveFilePicker()` — Chrome/Edge only | Permission click per save |
| **Plain download** | `<a download>` blob | Goes to Downloads; read-back is manual |

**Recommended: server-side via `server.py`** — most reliable, and the app can reload the
same file later.

## 6. Tech & folder layout

- New folder at repo root: `song-id-assigner/`
  - `index.html`, `css/style.css`, `js/app.js` — plain HTML/CSS/JS, no build step
  - `manifest.json` + icon → installable PWA
  - `library-ids.json` — generated data file (gitignored)
- `server.py`: `POST /api/library/save` + `GET /api/library/load`
- URL: `http://localhost:8080/song-id-assigner/`

## 7. Open questions before building

1. **"Next" = highest + 1, or fill gaps first?** (I assume highest + 1.)
2. **Number format:** keep it consistent per prefix (`D044` = 3 digits, but `LvK 9` has
   no padding) — new numbers should match what the prefix already uses?
3. **Import:** file/paste first — does ProPresenter pull matter for v1?
4. **Who uses it:** just you on this laptop, or others too?

---

*Status: concept v2. Nothing built yet — waiting for answers.*
