# Ichtus X32 Preset Loader

A small browser-based tool for loading channel presets onto a Behringer
X32 mixer over OSC (UDP port 10023). Lives in its own folder so it can
be deployed, started, and torn down independently from the main SPA.

```
x32/
├── index.html      ← form: 32 channels × slot + raw OSC box
├── server.js       ← tiny express + osc-js HTTP-to-UDP bridge
├── package.json    ← dependencies (express, cors, osc)
└── README.md
```

## Quick start

```bash
cd x32
npm install
node server.js
```

Then open <http://localhost:3002> in your browser.

The form ships with the X32's factory IP `192.168.1.50`. If you've
changed it under **Setup → Network** on the console, just edit the
field at the top of the page — the value persists in `localStorage`.

## What it does

For every one of the 32 input channels you can:

1. Pick a **preset slot** (0–99) — this is the index you've used
   when saving to the X32's library (`Setup → Library → CHANNEL →
   save`).
2. Pick a **category** — `CHANNEL` for full strip recall, or one of
   `EQ` / `GATE` / `DYNA` for partial-strip recalls.
3. Type an optional **preset name** (used by the `/presets/load`
   fallback so the console can match by name too).
4. Hit **Laad preset** — the bridge fires **two** OSC messages:

   ```
   /ch/<NN>/lib/load ,i <slot>           ← direct library recall
   /presets/load ,siss <name> <cat> <slot> <dest>
   ```

   Both are sent because firmware support differs across X32 versions;
   the one the console doesn't recognise is silently dropped, the
   other applies the preset.

There's also a **Raw OSC-opdracht** card for ADVANCED use — type any
OSC address + arg list (JSON) and blast it through the same bridge.

## Ports & network

| Component | Local port / protocol |
|-----------|----------------------|
| Browser → Bridge | HTTP `127.0.0.1:3002` |
| Bridge → X32 | UDP `192.168.1.50:10023` (configurable in the UI) |

The bridge listens on `127.0.0.1` only — there is no authentication.
If you need remote access (someone's laptop in the auditorium), tunnel
through SSH or run behind a reverse proxy with a real auth layer.

The X32 listens on UDP `10023` for control commands and emits state
back on UDP `10024`. This tool sends only; if you also want to read
state (e.g. current fader values) you'll need an OSC listener too —
out of scope for this v1.

## OSC command reference

The two recall commands are the user-facing surface; these are the
most useful raw commands for daily operation:

| Want to: | Address | Args |
|----------|---------|------|
| Mute channel | `/ch/NN/mute` | `,i 1` |
| Unmute | `/ch/NN/mute` | `,i 0` |
| Set fader to unity (0 dB) | `/ch/NN/mix/fader` | `,f 0.75` |
| Set fader to a level (0..1) | `/ch/NN/mix/fader` | `,f <value>` |
| Rename channel | `/ch/NN/config/name` | `,s "Lead Vox"` |
| Set preamp gain (+/- dB) | `/ch/NN/preamp/trim` | `,f <value>` |
| Engage 48 V phantom | `/ch/NN/preamp/phantom` | `,i 1` |
| Subscribe to state feed | `/xremote` | *(no args)* |

`NN` is the channel number, **zero-padded to two digits**: `/ch/01`
…, `/ch/32`. The X32 is strict about this.

## Caveats

* **Firmware support is the wild card.** Some X32 firmware builds
  silently ignore one of the two recall patterns. Send both, watch
  the console screen for the library-recall confirmation, and if it
  didn't apply, try the raw `/load` command with arguments in a
  different order — the manual has a section titled *"Library slot
  messages"* with the dispatch table.
* **No acknowledgement.** The bridge fires UDP packets; there is no
  confirmation round-trip. The HUD toast is **"we sent it"**, not
  *"the preset loaded"*. The status dot tells you the bridge is up;
  the activity log shows what you tried; the operator's eyes on the
  X32 confirm the actual result.
* **Presets live on the X32.** This tool doesn't store or back up
  the preset contents — it's a recall remote. Back up the X32's
  `LIBRARY` folder to USB like you already do for scenes.
* **One X32 per IP.** The pool caches one osc-js client per IP. If
  you alternate between a primary and a backup X32, switch the IP in
  the input box — the pool creates the new client on demand and
  keeps the old one warm until the page closes.

## Where the bridge lives in the project

It's intentionally separate from `mic-iem-server/` because:

1. The mic-iem server is Express on port 3001 with Firebase Admin SDK
   and listens on a different concern (WorshipTools roster sync).
2. The X32 bridge is **dependency-light** so a sound engineer can
   run it on a laptop without setting up Firebase credentials.

If you ever want the bridge to write recall logs to Firestore (e.g.
for an audit trail of "which channel got which preset for which
service"), copy `serviceAccountKey.json` next to `server.js` and
follow the pattern in `../mic-iem-server/server.js`.
