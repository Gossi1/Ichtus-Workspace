# Implementation Plan — Per-Channel X32 Library Preset Recall

> Status: **draft — awaiting operator input on the four integer library slot
> IDs the desk currently holds**.

## 1. Goal

The Stage Builder's "Push Coordinates to X32" button must trigger
**`/ch/<N>/lib/load ,i <slot>`** on the X32 console for every occupied spot.
Each spot carries its own integer library-slot number chosen by the operator
at the gear-icon "Stage Settings" card. This replaces the current
information-only 4-value `preset` enum (`drums / guitar / keys / vocal`).

It must handle the multi-spot musician case: a worship leader who also plays
keys occupies two spots, each of which must recall a different library slot
(the WL-mic EQ chain and the piano EQ chain respectively).

## 2. Why per-spot, not per-role

The current code mixes role (canonical type) with role alias (planner
variants) in `autoPlotRoster()` to **route cards to spots** at extraction
time. That part stays. The recall question is orthogonal: two slots with the
same canonical role may need different DSP chains in the desk's library
(vocalist 1 ≠ vocalist 2; WL-piano ≠ bass-piano via stage piano rack).
Therefore the integer lives **per spot**, not per role enum, not in a static
server table.

## 3. Data model

### 3.1 DOM spot

```
data-hw-ch       = "<channel>"   (existing, integer 1–32)
data-lib-slot    = "<slot>"      (new,      integer 0–99)
```

### 3.2 Channel-card row (gear-icon modal)

```js
{
  id: 'sb-ch-<ts>-<idx>',
  ch: '7',            // existing — channel number
  label: 'Vox 1',     // existing — display label
  preset: 'vocal',    // existing — informational only (UI icon)
  libSlot: 47,        // NEW — integer for X32 recall
}
```

### 3.3 Outbound packet from commitLayout()

```js
{
  channel: 7,                   // existing
  channelRaw: '7',
  name: 'John',
  role: 'Vocalist',
  preset: 'vocal',              // existing, kept for the toast/UI
  spot: 'sb-spot-vox1',
  position: { left: '120px', top: '40px' },
  librarySlot: 47,              // NEW — drives X32 recall
}
```

## 4. Multi-role / multi-spot handling

A worship leader whose WT roster string is `Lead Vocal / Keys` is dropped by
`autoPlotRoster()` into the **instrument-first** spot (Keys), freeing vocal
slots for actual singers. The WL then occupies **2 spots** (one Vocalist,
one Keyboardist slot) — currently this is the same person on two slots.

Each spot already carries its own `data-hw-ch` and will now also carry its
own `data-lib-slot`. The loop in `commitLayout()` already iterates
`.sb-drop-spot.sb-occupied` and emits one packet per spot. So a WL-pianist
triggers **2 OSC recalls**, one to his mic channel with his vocal EQ chain
and one to his piano channel with the piano EQ chain. No new logic for this
case — the existing per-spot iteration suffices.

The same pattern for WL-guitarist. The current "instrument-first" preference
is unaffected.

## 5. Phase 1 — SPA surface (`stagebuilder.js`)

### 5.1 `renderChannelRows()` — add the 5th column

Insert `cell-libslot` between `cell-icon-select` and `cell-action`:

```html
<div class="cell-libslot">
    <input type="number"
           class="sb-mini-input lib-num"
           value="<r.libSlot>"
           min="0" max="99"
           data-field="libSlot"
           data-id="<r.id>"
           title="X32 channel-library slot 0–99">
</div>
```

### 5.2 `_bindChannelFieldEvents()` input listener branch

```js
if (field === 'libSlot') {
    let v = parseInt(t.value, 10);
    if (!Number.isFinite(v) || v < 0)  v = 0;
    if (v > 99)                          v = 99;
    row.libSlot = v;
    const idx   = self.channelRows.indexOf(row);
    const spots = document.querySelectorAll('#view-stagebuilder .sb-drop-spot');
    spots[idx]?.setAttribute('data-lib-slot', String(v));
    self._saveChannelRowsToStorage();
}
```

### 5.3 Persistence path

These three helpers from the earlier reload-revert fix all need the new
field mirrored in the same way the existing `ch`/`label` fields are:

* `_saveChannelRowsToStorage()` — automatic since it JSON.stringify-overwrites
  the rows array; just ensure the field is an integer before the write.
* `_loadChannelRowsFromStorage()` — coerce `r.libSlot` to a finite integer
  on the way back in (defensive against future schema drift).
* `_ensureChannelRows()` first-time seed — pull `spot.dataset.libSlot` if
  present, else 0.
* `_restoreChannelRowsToDom()` — on reload, also push `row.libSlot` to
  `spot.dataset.libSlot` (idempotent with the live input handler).

### 5.4 `commitLayout()` — emit library slot per packet

```js
const librarySlot = parseInt(spot.getAttribute('data-lib-slot'), 10) || 0;
packets.push({ channel, channelRaw, name, role, preset, spot, position,
               librarySlot });
```

Keep the existing `Number.isFinite(p.channel)` filter. The new
`Number.isFinite(p.librarySlot) && p.librarySlot >= 0 && p.librarySlot <= 99`
filter pairs with it on the server side.

### 5.5 Replacement of the void CustomEvent

```js
// OLD — fires into nothing
window.dispatchEvent(new CustomEvent('stagebuilder-layout', { ... }));

// NEW
let x32Result = { ok: false, count: 0 };
try {
    const r = await fetch('http://127.0.0.1:3001/api/stagebuilder-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packets: validPackets }),
    });
    x32Result = await r.json().catch(() => ({ ok: false }));
} catch (e) {
    console.warn('  [StageBuilder] X32 bridge offline:', e.message);
}

if (validPackets.length === 0) {
    this.showToast('Stage plot empty! Stel spots en personeel in voordat je pusht.', 'error');
} else if (x32Result.ok) {
    this.showToast(`X32: ${x32Result.count} library recalls geladen!`, 'success');
} else {
    this.showToast(`Layout gebouwd (${validPackets.length} kanalen) — X32 bridge niet bereikbaar.`, 'error');
}
```

### 5.6 CSS nudge (`style.css`)

```css
#view-stagebuilder .sb-compact-row .cell-libslot {
    width: 64px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
}
#view-stagebuilder .sb-compact-row .lib-num {
    width: 52px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}
```

### 5.7 Modal caption (`index.html`)

Single line above the channel-card list to set operator expectation:

```html
<p class="sb-config-help">Kies per kanaal het library-slot nummer dat je
op de X32 hebt opgeslagen (Setup → Library → save).</p>
```

## 6. Phase 2 — Server bridge (`mic-iem-server/server.js`)

### 6.1 New imports at top

```js
import { createSocket } from 'dgram';
```

### 6.2 Module-scope UDP client and target

```js
const X32 = { ip: process.env.X32_IP || '127.0.0.1', port: 10023 };
const udpClient = createSocket('udp4');
udpClient.on('error', err => console.warn('  [OSC] UDP client error:', err.message));
```

### 6.3 OSC encoder for `/ch/<N>/lib/load ,i <slot>`

Small, sufficient encoder for one path shape; no external OSC package
required:

```js
function oscLoadLibrarySlot(channel, slot) {
    const path = `/ch/${channel}/lib/load`;
    // OSC string + null-term + 4-byte align + ',' 'i' type + null + slot int32
    const buf = Buffer.alloc(64);
    let off = 0;
    buf.write(path, off, 'ascii'); off += path.length;
    // pad to 4-byte boundary for type tag
    const typeStart = off + (4 - (off % 4));
    buf.write(',', typeStart, 'ascii'); buf.write('i', typeStart + 1, 'ascii');
    off = typeStart + 4;
    buf.writeInt32BE(slot, off);
    return buf.subarray(0, off + 4);
}
```

### 6.4 POST `/api/stagebuilder-layout`

```js
app.post('/api/stagebuilder-layout', async (req, res) => {
    const packets = Array.isArray(req.body?.packets) ? req.body.packets : [];
    const log = [];
    for (const p of packets) {
        if (!Number.isFinite(p.channel) || p.channel < 1 || p.channel > 32) continue;
        if (!Number.isFinite(p.librarySlot) || p.librarySlot < 0 || p.librarySlot > 99) continue;
        const msg = oscLoadLibrarySlot(p.channel, p.librarySlot);
        await new Promise(resolve =>
            udpClient.send(msg, 0, msg.length, X32.port, X32.ip, resolve));
        log.push(`CH ${p.channel}\u2192lib ${p.librarySlot}${p.name ? ` (${p.name})` : ''}`);
    }
    if (log.length === 0) {
        return res.status(400).json({ ok: false, error: 'No valid packets' });
    }
    console.log('  [OSC] Library recalls sent:', log.join(', '));
    res.json({ ok: true, count: log.length, recalls: log });
});
```

## 7. Phase 3 — Dispatch path (already covered in §5.5)

The SPA dispatch lives in `commitLayout()` directly. The button's onclick
handler (`sb-btn-push`) is already wired. The only edit there is the swap
from `dispatchEvent` to `fetch` and the conditional toast text.

## 8. Phase 4 — Testing

| Layer            | Verification                                                              |
| ---------------- | ------------------------------------------------------------------------- |
| UI persistence   | Type `47` in a card row, reload, observe still `47`. Uses the earlier `_restoreChannelRowsToDom()` path. |
| HTTP endpoint    | `curl -d '{"packets":[{"channel":7,"librarySlot":47,"name":"Vox 1"}]}' http://127.0.0.1:3001/api/stagebuilder-layout -H 'content-type: application/json'` returns `{ ok: true, count: 1, recalls: ["CH 7→lib 47 (Vox 1)"] }`. |
| OSC on the wire  | Wireshark filter `udp.port == 10023`. Expect `/ch/07/lib/load ,i 0000002F` per packet. |
| Desk response    | With `X32_IP` set to your desk, push and observe EQ/gate/dynamics on the strip change to the chain stored in slot 47. |
| WL-pianist       | Place WL into Lead Vocal (CH 4, libSlot 12) and Keys (CH 9, libSlot 8). Push. Observe vocal mic EQ on CH 4 and piano EQ on CH 9. |
| Bridge offline   | Stop `mic-iem-server`. Push → toast says "X32 bridge niet bereikbaar", no exception. |
| Invalid clamp    | Type `9999` in lib-slot input → clamped to `99` in the live card; UI feedback immediate. |
| Empty push       | No occupied spots → toast "Stage plot empty!", no HTTP request fired. |

## 9. Files touched

| File                                   | Δ (est.) | Purpose                                                              |
| -------------------------------------- | -------- | -------------------------------------------------------------------- |
| `Ichtus_SPA/js/modules/stagebuilder.js` | ~30 lines | New column input, persistence path, packet field, fetch swap, toast change |
| `Ichtus_SPA/css/style.css`             | ~6 lines  | `.cell-libslot` column width + number-input tabular-nums             |
| `Ichtus_SPA/index.html`                | ~6 lines  | Modal caption (operator hint)                                         |
| `mic-iem-server/server.js`             | ~70 lines | UDP client, OSC encoder, POST route, env config                       |
| `README.md`                            | ~10 lines | Document `X32_IP` env var + desktop workflow (upload library slot first) |
| `implementation_plan.md`               | this file | Plan-as-code, edit & commit                                           |

**Total**: ~120 lines added across 6 files, zero new npm dependencies
(uses built-in `dgram`).

## 10. Sequence diagram

```
operator                SPA stagebuilder.js                 mic-iem-server             X32 (UDP 10023)
   |                          |                                  |                          |
   |-- drags cards onto X32 spots                      |          |                          |
   |-- opens gear-icon Stage Settings                            |                          |
   |-- types CH 9, slot 8 in Keys row                            |                          |
   |-- types CH 4, slot 12 in Vox 2 row                          |                          |
   |                          |                                  |                          |
   |-- clicks "Push Coordinates to X32"                          |                          |
   |                          |                                  |                          |
   |                          |-- builds 2 packets             |                          |
   |                          |   {ch:4, slot:12, ...}         |                          |
   |                          |   {ch:9, slot:8,  ...}         |                          |
   |                          |                                  |                          |
   |                          |-- POST /api/stagebuilder-layout |                          |
   |                          |   body: { packets: [...] }      |                          |
   |                          |                                  |                          |
   |                          |                                  |-- UDP /ch/04/lib/load,i 12 |
   |                          |                                  |                          |-- EQ chain #12 on CH 4
   |                          |                                  |                          |
   |                          |                                  |-- UDP /ch/09/lib/load,i  8 |
   |                          |                                  |                          |-- EQ chain #8 on CH 9
   |                          |                                  |                          |
   |                          |                                  |-- {ok:true, count:2}     |
   |                          |                                  |                          |
   |                          |<-- HTTP 200 OK ------------------|                          |
   |                          |                                  |                          |
   |<-- toast "X32: 2 library recalls geladen!" -----------------|                          |
```

## 11. Out of scope (intentional followups)

* **Confirmation readback** — Send `GET /ch/N/lib/<slot>/name` and display
  the human label in the toast for sanity. Adds latency.
* **Heartbeat / desk-offline detection** — UDP is fire-and-forget; we'd
  need a periodic ping or X32-specific heartbeat.
* **HTTPS** — Plain HTTP between SPA and `mic-iem-server` is fine for the
  in-house LAN; TLS would matter if the SPA ever serves off-host.
* **Browser-side OSC bypass** — If the SPA can reach the X32 directly
  (no server hop), `chrome.sockets.udp` from the worshiptools-sync
  extension could carry the recall without the server, removing the HTTP
  hop.

## 12. Open questions for operator

* What integer library slot number are your four DAW-chain templates
  saved at on the X32? (e.g. `drums=47`, `vocals=12`, `keys=8`,
  `gtr=15`.) These constants live in the operator's mental model and
  in the manual card UI, **not** in code — code only forwards whatever
  integer is typed.
* Default for empty slots: send the integer as-is (default 0, harmless
  on most X32 firmware — recalls "Factory" chain) or skip silently?
  Plan defaults to "skip" via `Number.isFinite(p.librarySlot) &&
  p.librarySlot >= 0 && p.librarySlot <= 99` filter.

## 13. Roll-out

1. Phase 1 (SPA surface) first — observable in the gear-icon modal, no
   network impact. Easy to test in isolation.
2. Phase 2 (server) second — run mic-iem-server with `X32_IP` env, poke
   it via `curl`. Confirms OSC bytes on Wireshark.
3. Phase 3 (SPA dispatch swap) — wires the two halves together. Final
   end-to-end test.
4. README and any operator runbook updates.
