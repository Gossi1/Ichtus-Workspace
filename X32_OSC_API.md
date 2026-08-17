# Behringer X32 / Midas M32 — OSC API Guide

> **Comprehensive reference** for sending commands to and receiving state from the Behringer X32 / Midas M32 digital mixers via OSC (Open Sound Control).
>
> Reverse-engineered and documented from the [companion-module-behringer-x32](https://github.com/bitfocus/companion-module-behringer-x32) Companion module source code.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Connection & Lifecycle](#2-connection--lifecycle)
3. [OSC Message Format](#3-osc-message-format)
4. [Channel & Source Reference System](#4-channel--source-reference-system)
5. [Fader Level Curve (dB ↔ Float)](#5-fader-level-curve-db--float)
6. [Pan Curve (dB ↔ Float)](#6-pan-curve-db--float)
7. [Trim & Headamp Gain Conversion](#7-trim--headamp-gain-conversion)
8. [Command: Mute / Unmute](#8-command-mute--unmute)
9. [Command: Fader Level](#9-command-fader-level)
10. [Command: Panning](#10-command-panning)
11. [Command: Channel Send (Input → Bus)](#11-command-channel-send-input--bus)
12. [Command: Bus Send (Bus → Matrix)](#12-command-bus-send-bus--matrix)
13. [Command: Labels & Colors](#13-command-labels--colors)
14. [Command: Inserts](#14-command-inserts)
15. [Command: Headamp Gain & Input Trim](#15-command-headamp-gain--input-trim)
16. [Command: Solo](#16-command-solo)
17. [Command: Talkback](#17-command-talkback)
18. [Command: Oscillator](#18-command-oscillator)
19. [Command: Monitor Level](#19-command-monitor-level)
20. [Command: Scene / Cue / Snippet Loading](#20-command-scene--cue--snippet-loading)
21. [Command: Preset / Library Loading](#21-command-preset--library-loading)
22. [Command: Routing](#22-command-routing)
23. [Command: Screen Navigation](#23-command-screen-navigation)
24. [Command: Fader Banks & Select](#24-command-fader-banks--select)
25. [Command: X-Live (SD Card Recording)](#25-command-x-live-sd-card-recording)
26. [Command: Tape Transport](#26-command-tape-transport)
27. [Command: System](#27-command-system)
28. [Command: Undo](#28-command-undo)
29. [Command: Markers](#29-command-markers)
30. [Fader Transitions & Easing](#30-fader-transitions--easing)
31. [State Variables (Readable State)](#31-state-variables-readable-state)
32. [Subscription & Keep-Alive](#32-subscription--keep-alive)
33. [Color Values Reference](#33-color-values-reference)
34. [Mute Group Values](#34-mute-group-values)
35. [Appendix: Full OSC Path Reference](#35-appendix-full-osc-path-reference)

---

## 1. Overview

The Behringer X32 / Midas M32 mixers expose a comprehensive OSC API over **UDP port 10023**. You can:

- **Send commands** to set fader levels, mute channels, change panning, load scenes, etc.
- **Receive state updates** (the mixer pushes changes back to you when `/xremote` is active)
- **Query state** by sending an empty OSC message to any path — the mixer responds with the current value

The protocol uses standard OSC message types:
- `i` — integer
- `f` — float (32-bit)
- `s` — string

### Key Facts

| Property | Value |
|---|---|
| **Port** | `10023` (TCP-like UDP) |
| **Protocol** | OSC over UDP |
| **Address format** | Slash-separated paths (`/ch/01/mix/fader`) |
| **Data types** | `i` (int), `f` (float), `s` (string) |
| **Channel range** | Channels 01–32, Aux 01–08, FX Return 01–08, Bus 01–16, Matrix 01–06, Main L/R, Main M |
| **Fader range** | `-90 dB` (mute) to `+10 dB`, sent as float `0.0` – `1.0` |

---

## 2. Connection & Lifecycle

```
1. Open UDP socket → 0.0.0.0:0 (random local port)
2. Set remote target → {mixer_ip}:10023
3. Send /xremote → mixer starts streaming state changes
4. Send /xinfo → wait for response → mixer is connected
5. Send /xremote every ~1500ms (heartbeat) to keep streaming
6. Poll /-stat/tape/etime via /subscribe every 5000ms
7. Load initial state by querying all paths you care about
```

### Connection Handshake

```
→ /xremote                          (empty args — start subscription)
→ /xinfo                            (query device info)
← /xinfo [s:"X32", s:"X32", s:"4.12", s:"0.0.0.0"]  (response)
  ↑ Once received: connection is GOOD
```

### Keep-Alive

```javascript
// Send every 1500ms
osc.send({ address: '/xremote', args: [] })

// Renew /subscribe every 5000ms (mixer requires renewal every 10s)
osc.send({
  address: '/subscribe',
  args: [
    { type: 's', value: '/-stat/tape/etime' },
    { type: 'i', value: 20 },
  ]
})
```

### Error Recovery

If the connection drops, the mixer will stop responding. Detect this by:
- No `/xinfo` response within ~5 seconds after sending
- Socket error event

On failure, close socket, wait ~2 seconds, and reconnect.

---

## 3. OSC Message Format

### Sending a Command (Set Value)

```javascript
osc.send({
  address: '/ch/01/mix/fader',
  args: [{ type: 'f', value: 0.75 }]  // set fader to 0 dB
})
```

### Querying Current State

Send an OSC message with **empty args** to any path. The mixer responds with the current value:

```javascript
// Query
osc.send({ address: '/ch/01/mix/fader', args: [] })

// Response received on the same socket
// { address: '/ch/01/mix/fader', args: [{ type: 'f', value: 0.75 }] }
```

### Receiving State Changes (with /xremote active)

When `/xremote` is active, the mixer pushes state changes automatically:

```javascript
osc.on('message', (msg) => {
  console.log(msg.address, msg.args)
  // '/ch/01/mix/on', [{ type: 'i', value: 1 }]
})
```

---

## 4. Channel & Source Reference System

The X32 uses a consistent path hierarchy for all channel types. Here is the complete reference:

### Path Templates

| Source | OSC Path Base | Count | Ref Syntax |
|---|---|---|---|
| **Input Channels** | `/ch/NN` | 32 | `ch1`–`ch32`, `channel1`–`channel32`, `in1`–`in32`, `c1`–`c32` |
| **Aux Inputs** | `/auxin/NN` | 8 | `aux1`–`aux8`, `a1`–`a8`, `out1`–`out8` |
| **FX Returns** | `/fxrtn/NN` | 8 | `fx1`–`fx8`, `f1`–`f8` |
| **Mix Buses** | `/bus/NN` | 16 | `bus1`–`bus16`, `b1`–`b16`, `mix1`–`mix16` |
| **Matrix** | `/mtx/NN` | 6 | `matrix1`–`matrix6`, `mat1`–`mat6`, `mtx1`–`mtx6`, `m1`–`m6` |
| **Main Stereo** | `/main/st` | 1 | `stereo`, `st`, `mainlr` |
| **Main Mono** | `/main/m` | 1 | `mono`, `mo`, `mon`, `mainmc` |
| **DCA Groups** | `/dca/N` | 8 | `dca1`–`dca8`, `d1`–`d8` |

### Channel Path Structure (e.g., Channel 01)

```
/ch/01/
├── config/
│   ├── name              → string   (scribble strip label)
│   └── color             → int      (0-15, see Color Values)
├── mix/
│   ├── on                → int      (0 = muted, 1 = unmuted)
│   ├── fader             → float    (0.0 = -90dB, 1.0 = +10dB)
│   ├── pan               → float    (0.0 = hard left, 0.5 = center, 1.0 = hard right)
│   └── /01/             → Bus send sub-paths (see Section 11)
│       ├── on            → int      (bus send mute)
│       ├── level         → float    (bus send level)
│       └── pan           → float    (bus send pan, odd buses only)
├── preamp/
│   └── trim              → float    (input trim, see Section 7)
├── insert/
│   ├── on                → int      (0 = off, 1 = on)
│   ├── pos               → int      (0 = pre, 1 = post)
│   └── sel               → int      (destination, see Section 14)
```

### Bus Path Structure (e.g., Bus 01)

```
/bus/01/
├── config/
│   ├── name              → string
│   └── color             → int
├── mix/
│   ├── on                → int
│   ├── fader             → float
│   ├── pan               → float
│   └── /01/             → Matrix send sub-paths
│       ├── on            → int      (matrix send mute)
│       ├── level         → float    (matrix send level)
│       └── pan           → float    (matrix send pan, odd matrices only)
├── insert/
│   ├── on                → int
│   ├── pos               → int
│   └── sel               → int
```

### Channel Number Mapping (Select Index)

Used by `/-stat/selidx` and `/load` commands:

| Select Index | Source |
|---|---|
| 0–31 | Channels 1–32 |
| 32–39 | Aux In 1–8 |
| 40–47 | FX Return 1L–8R |
| 48–63 | Mix Bus 1–16 |
| 64–69 | Matrix 1–6 |
| 70 | Main Stereo |
| 71 | Main Mono |

### Solo Number Mapping

| Solo # | Source | Solo # | Source |
|---|---|---|---|
| 01–32 | Channels 1–32 | 49–64 | Buses 1–16 |
| 33–40 | Aux In 1–8 | 65–70 | Matrix 1–6 |
| 41–48 | FX Return 1–8 | 71 | Main Stereo |
| | | 72 | Main Mono |
| | | 73–80 | DCA 1–8 |

---

## 5. Fader Level Curve (dB ↔ Float)

The X32 does **not** use a linear fader curve. It uses a multi-segment piecewise curve to approximate the perceived loudness scale of an analog fader.

### Float → dB Conversion

```javascript
function floatToDB(f) {
  if (f >= 0.5)       return f * 40 - 30     // +10 dB at f=1.0
  else if (f >= 0.25) return f * 80 - 50     // -10 dB at f=0.25
  else if (f >= 0.0625) return f * 160 - 70  // -60 dB at f=0.0625
  else if (f >= 0.0)  return f * 480 - 90    // -90 dB at f=0.0
  else                return -Infinity
}
```

### dB → Float Conversion

```javascript
function dbToFloat(d) {
  let f
  if (d < -60)       f = (d + 90) / 480
  else if (d < -30)  f = (d + 70) / 160
  else if (d < -10)  f = (d + 50) / 80
  else if (d <= 10)  f = (d + 30) / 40
  else               f = 1.0
  return f
}
```

### Key Reference Points

| dB | Float Value | Notes |
|---|---|---|
| +10 dB | `1.0` | Maximum |
| 0 dB | `0.75` | Unity gain |
| -10 dB | `0.25` | |
| -30 dB | `0.25` | (approx, same region) |
| -60 dB | `0.0625` | Nearly inaudible |
| -90 dB / -∞ | `0.0` | Full mute |
| -∞ (negative infinity) | `< 0.0` | Treated as -90 dB |

### Important Note

The X32 returns fader values as **raw floats** (0.0–1.0). When comparing or setting values, you must convert between dB and float using the curves above. A value of `-90` dB is conventionally used to represent "off" / "-∞".

---

## 6. Pan Curve (dB ↔ Float)

Pan is stored as a float from `0.0` to `1.0`:

| Position | Float | dB Equivalent |
|---|---|---|
| Hard Left | `0.0` | -50 (display) |
| Center | `0.5` | 0 |
| Hard Right | `1.0` | +50 (display) |

### Converting User-Facing Pan to Float

The user specifies pan as -50 to +50 (display units). To convert:

```javascript
// User value (-50 to +50) → OSC float (0.0 to 1.0)
function panToFloat(pan) {
  return pan / 100 + 0.5
}

// OSC float → User value
function floatToPan(f) {
  return f * 100 - 50
}
```

---

## 7. Trim & Headamp Gain Conversion

### Input Trim

Range: -18 to +18 dB, stored as float 0.0–1.0

```javascript
function trimToFloat(d) { return (d + 18) / 36 }   // -18 → 0.0, +18 → 1.0
function floatToTrim(f) { return f * 36 - 18 }       // 0.0 → -18, 1.0 → +18
```

### Headamp Gain

Range: -12 to +60 dB, stored as float 0.0–1.0

```javascript
function headampGainToFloat(d) { return (d + 12) / 72 }  // -12 → 0.0, +60 → 1.0
function floatToHeadampGain(f) { return f * 72 - 12 }     // 0.0 → -12, 1.0 → +60
```

### Headamp OSC Paths

```
/headamp/NNN/gain    → float (0.0–1.0)

Where NNN is:
  000–031  →  Local XLR 1–32   (offset: 0)
  032–063  →  AES50-A 1–32     (offset: 32)
  064–095  →  AES50-B 1–32     (offset: 64)
```

---

## 8. Command: Mute / Unmute

### Mute a Channel

```
/ch/NN/mix/on    int    0 = muted, 1 = unmuted
```

### OSC Path by Source

| Source | Mute Path |
|---|---|
| Channel N | `/ch/NN/mix/on` |
| Aux In N | `/auxin/NN/mix/on` |
| FX Return N | `/fxrtn/NN/mix/on` |
| Bus N | `/bus/NN/mix/on` |
| Matrix N | `/mtx/NN/mix/on` |
| Main Stereo | `/main/st/mix/on` |
| Main Mono | `/main/m/mix/on` |
| DCA N | `/dca/N/on` |

### Mute Group

```
/config/mute/N    int    1 = muted, 0 = unmuted   (N = 1–6)
```

> **Note:** Mute groups use opposite semantics from channel mute. `1` = group is **active/muted**, `0` = group is inactive. Channel mute uses `0` = muted, `1` = unmuted (this is "on" semantics).

### Channel Send Mute (Input → Bus)

```
/ch/NN/mix/BB/on    int    0 = send muted, 1 = send unmuted
```

Where `BB` = bus number (`01`–`16`).

**Example:** Mute channel 1's send to bus 3:
```
→ /ch/01/mix/03/on   i:0
```

### Bus Send Mute (Bus → Matrix)

```
/bus/NN/mix/MM/on    int    0 = send muted, 1 = send unmuted
```

Where `MM` = matrix number (`01`–`06`).

**Example:** Mute bus 5's send to matrix 2:
```
→ /bus/05/mix/02/on   i:0
```

---

## 9. Command: Fader Level

### Set Fader

```
/path/mix/fader    float    0.0 = -90dB, 0.75 = 0dB, 1.0 = +10dB
```

### OSC Path by Source

| Source | Fader Path |
|---|---|
| Channel N | `/ch/NN/mix/fader` |
| Aux In N | `/auxin/NN/mix/fader` |
| FX Return N | `/fxrtn/NN/mix/fader` |
| Bus N | `/bus/NN/mix/fader` |
| Matrix N | `/mtx/NN/mix/fader` |
| Main Stereo | `/main/st/mix/fader` |
| Main Mono | `/main/m/mix/fader` |
| DCA N | `/dca/N/fader` |

**Example:** Set channel 5 fader to -6 dB:
```
→ /ch/05/mix/fader   f:0.5875   (dbToFloat(-6))
```

### Relative Fader Adjustment

To adjust by a delta, you must:
1. Query the current value
2. Convert float → dB
3. Add delta in dB
4. Convert dB → float
5. Send the new value

```javascript
const currentFloat = state.get('/ch/01/mix/fader')[0].value
const currentDB = floatToDB(currentFloat)
const newDB = currentDB + delta
const newFloat = dbToFloat(newDB)
osc.send({ address: '/ch/01/mix/fader', args: [{ type: 'f', value: newFloat }] })
```

### Store & Restore Fader

Store saves the current level temporarily in memory (not sent to mixer):
```javascript
const currentDB = floatToDB(state.get('/ch/01/mix/fader')[0].value)
storedValue = currentDB  // save locally
```

Restore reads the stored value and sends it:
```javascript
osc.send({ address: '/ch/01/mix/fader', args: [{ type: 'f', value: dbToFloat(storedValue) }] })
```

---

## 10. Command: Panning

### Set Pan

```
/path/mix/pan    float    0.0 = hard left, 0.5 = center, 1.0 = hard right
```

### OSC Path by Source

| Source | Pan Path |
|---|---|
| Channel N | `/ch/NN/mix/pan` |
| Aux In N | `/auxin/NN/mix/pan` |
| FX Return N | `/fxrtn/NN/mix/pan` |
| Bus N | `/bus/NN/mix/pan` |
| Main Stereo | `/main/st/mix/pan` |

> **Note:** Matrix channels, Main Mono, and DCA groups do not have panning.

### Send Panning (Channel → Bus)

```
/ch/NN/mix/BB/pan    float    0.0–1.0 (only on odd buses)
```

### Send Panning (Bus → Matrix)

```
/bus/NN/mix/MM/pan    float    0.0–1.0 (only on odd matrices)
```

---

## 11. Command: Channel Send (Input → Bus)

### Set Send Level

```
/ch/NN/mix/BB/level    float    0.0 = -∞, 0.75 = 0dB, 1.0 = +10dB
```

Where `NN` = channel (01–32, or aux/fx return number), `BB` = bus (01–16).

**Example:** Set channel 3 send to bus 7 at -12 dB:
```
→ /ch/03/mix/07/level   f:0.375   (dbToFloat(-12))
```

### Set Send Mute

```
/ch/NN/mix/BB/on    int    0 = muted, 1 = unmuted
```

### Set Send Pan

```
/ch/NN/mix/BB/pan    float    0.0–1.0 (only available on odd-numbered buses)
```

---

## 12. Command: Bus Send (Bus → Matrix)

### Set Send Level

```
/bus/NN/mix/MM/level    float    0.0 = -∞, 0.75 = 0dB, 1.0 = +10dB
```

Where `NN` = bus (01–16), `MM` = matrix (01–06).

**Example:** Set bus 1 send to matrix 3 at 0 dB:
```
→ /bus/01/mix/03/level   f:0.75
```

### Set Send Mute

```
/bus/NN/mix/MM/on    int    0 = muted, 1 = unmuted
```

### Set Send Pan

```
/bus/NN/mix/MM/pan    float    0.0–1.0 (only available on odd-numbered matrices)
```

---

## 13. Command: Labels & Colors

### Set Channel Label (Scribble Strip)

```
/path/config/name    string
```

| Source | Label Path |
|---|---|
| Channel N | `/ch/NN/config/name` |
| Aux In N | `/auxin/NN/config/name` |
| FX Return N | `/fxrtn/NN/config/name` |
| Bus N | `/bus/NN/config/name` |
| Matrix N | `/mtx/NN/config/name` |
| Main Stereo | `/main/st/config/name` |
| Main Mono | `/main/m/config/name` |
| DCA N | `/dca/N/config/name` |

**Example:** Label channel 1 as "Vocals":
```
→ /ch/01/config/name   s:"Vocals"
```

### Set Channel Color

```
/path/config/color    int    (0–15, see Color Values table)
```

**Example:** Set channel 1 color to Red:
```
→ /ch/01/config/color   i:1
```

---

## 14. Command: Inserts

### Insert On/Off

```
/path/insert/on    int    0 = off, 1 = on
```

### Insert Position

```
/path/insert/pos    int    0 = pre-fader, 1 = post-fader
```

### Insert Destination

```
/path/insert/sel    int    (destination index)
```

| Value | Destination |
|---|---|
| 0 | OFF |
| 1–16 | FX1L–FX8R |
| 17–22 | AUX1–AUX6 |

**Applicable sources:** Channels, Main Stereo, Main Mono, Buses, Matrices (not Aux In or FX Returns).

---

## 15. Command: Headamp Gain & Input Trim

### Headamp Gain (Preamp)

```
/headamp/NNN/gain    float    0.0 = -12dB, 1.0 = +60dB
```

Where `NNN` is zero-padded:
- `000`–`031` → Local XLR 1–32
- `032`–`063` → AES50-A 1–32
- `064`–`095` → AES50-B 1–32

**Example:** Set Local XLR 1 gain to +24 dB:
```
→ /headamp/000/gain   f:0.5   (headampGainToFloat(24))
```

### Input Trim

```
/ch/NN/preamp/trim    float    0.0 = -18dB, 1.0 = +18dB
/auxin/NN/preamp/trim  float    0.0 = -18dB, 1.0 = +18dB
```

---

## 16. Command: Solo

### Solo On/Off

```
/-stat/solosw/NN    int    0 = off, 1 = on
```

Where `NN` = solo number (01–80, see Solo Number Mapping in Section 4).

**Example:** Solo channel 1:
```
→ /-stat/solosw/01   i:1
```

### Clear All Solos

```
/-action/clearsolo    int    1
```

### Solo Mono

```
/config/solo/mono    int    0 = off, 1 = on
```

### Solo Dim

```
/config/solo/dim    int    0 = off, 1 = on
```

### Solo Dim Attenuation

```
/config/solo/dimatt    float    (value / 40 + 1)
```

Display range: -40 to 0 dB. Conversion:
```javascript
function dimAttToFloat(d) { return d / 40 + 1 }   // -40 → 0.0, 0 → 1.0
```

---

## 17. Command: Talkback

### Talkback Talk (Momentary On/Off)

```
/-stat/talk/A    int    0 = off, 1 = on
/-stat/talk/B    int    0 = off, 1 = on
```

### Talkback Destination Map

```
/config/talk/A/destmap    int    (bitmask)
/config/talk/B/destmap    int    (bitmask)
```

The destination map is a **bitmask** where each bit represents a target:

| Bit | Mask | Destination |
|---|---|---|
| 0 | `1 << 0` | Bus 1 |
| 1 | `1 << 1` | Bus 2 |
| ... | ... | ... |
| 15 | `1 << 15` | Bus 16 |
| 16 | `1 << 16` | Main Stereo |
| 17 | `1 << 17` | Main Mono |

**To set a single destination without changing others**, read the current value, set/clear the bit, and write back:

```javascript
const current = state.get('/config/talk/A/destmap')[0].value
const newMap = current | (1 << busNumber)    // enable
const newMap = current & ~(1 << busNumber)   // disable
const newMap = current ^ (1 << busNumber)    // toggle
```

---

## 18. Command: Oscillator

### Enable/Disable

```
/-stat/osc/on    int    0 = off, 1 = on
```

### Set Destination

```
/config/osc/dest    int    (destination value)
```

| Value | Destination |
|---|---|
| 0–15 | Bus 1–16 |
| 16 | Main L |
| 17 | Main R |
| 18 | Main Stereo |
| 19 | Main Mono |
| 20–25 | Matrix 1–6 |

---

## 19. Command: Monitor Level

### Set Monitor Level

```
/config/solo/level    float    0.0 = -∞, 0.75 = 0dB, 1.0 = +10dB
```

Uses the same fader curve as all other faders (Section 5).

---

## 20. Command: Scene / Cue / Snippet Loading

### Load Scene

```
/-action/goscene    int    scene number (0–99)
```

### Load Cue

```
/-action/gocue    int    cue number (0–99)
```

### Load Snippet

```
/-action/gosnippet    int    snippet number (0–99)
```

### Go Command (Execute Highlighted Item)

Reads the current show control mode and highlighted position, then executes:

```javascript
const showControl = state.get('/-prefs/show_control')[0].value
// 0 = cue, 1 = scene, 2 = snippet
const currentPos = state.get('/-show/prepos/current')[0].value
osc.send({ address: `/-action/go${showControlName}`, args: [{ type: 'i', value: currentPos }] })
```

### Next / Previous Command

```
/-show/prepos/current    int    (increment or decrement by 1)
```

### Save Scene

```
/save    [s:"scene", i:sceneIndex, s:sceneName, s:sceneNote]
```

**Example:** Save scene 5 named "Band Set 1":
```
→ /save   s:"scene", i:5, s:"Band Set 1", s:"First set"
```

---

## 21. Command: Preset / Library Loading

> **See also:** [X32_PRESET_LIBRARY_PROTOCOL.md](./X32_PRESET_LIBRARY_PROTOCOL.md) for a detailed deep-dive.

### Load Channel Preset

```
/load    [s:"libchan", i:presetIndex, i:targetChannel, i:scopeBits]
```

| Arg | Type | Description |
|---|---|---|
| 1 | string | `"libchan"` |
| 2 | int | 0-based preset index (preset 1 = index 0) |
| 3 | int | Target channel number (0–71, see Select Index) |
| 4 | int | Scope bitmask (which sections to load) |

#### Scope Bitmask

| Bit | Value | Section |
|---|---|---|
| 0 (LSB) | `0x01` | Headamp (gain, phantom, etc.) |
| 1 | `0x02` | Config (name, color, etc.) |
| 2 | `0x04` | Gate |
| 3 | `0x08` | Dynamics (compressor) |
| 4 | `0x10` | EQ |
| 5 (MSB) | `0x20` | Sends |

**Load everything:** scope = `63` (0b111111)
**Load EQ only:** scope = `16` (0b010000)
**Load EQ + Dynamics:** scope = `24` (0b011000)

### Load FX Preset

```
/load    [s:"libfx", i:presetIndex, i:fxSlot]
```

| Arg | Type | Description |
|---|---|---|
| 1 | string | `"libfx"` |
| 2 | int | 0-based preset index |
| 3 | int | FX slot (0–7) |

### Load AES/DP48 Preset

```
/load    [s:"libmon", i:presetIndex]
```

### Query Preset Metadata

```
/-libs/ch/NNN/hasdata    int    0 = empty, 1 = has data
/-libs/ch/NNN/name       string (preset name)
```

Same pattern for `fx`, `r`, and `mon` libraries.

---

## 22. Command: Routing

### User Input Routing

```
/config/userrout/in/NN    int    source value (0 = OFF, up to ~164)
```

Where `NN` = destination channel (00–31).

### User Output Routing

```
/config/userrout/out/NN    int    source value (0 = OFF, up to ~220)
```

Where `NN` = destination output (00–47).

### Block Routing (Input)

```
/config/routing/IN/1-8     int    source block index
/config/routing/IN/9-16    int    source block index
/config/routing/IN/17-24   int    source block index
/config/routing/IN/25-32   int    source block index
/config/routing/PLAY/1-8   int    source block index  (play mode)
...
```

### Block Routing (AES50)

```
/config/routing/AES50A/1-8    int
/config/routing/AES50A/9-16   int
...
/config/routing/AES50B/1-8    int
...
```

### Block Routing (Card)

```
/config/routing/CARD/1-8    int
/config/routing/CARD/9-16   int
...
```

### Block Routing (XLR Output)

```
/config/routing/OUT/1-4     int
/config/routing/OUT/5-8     int
/config/routing/OUT/9-12    int
/config/routing/OUT/13-16   int
```

### Routing Mode Switch

```
/-config/routing/routswitch    int    0 = PLAY, 1 = RECORD
```

---

## 23. Command: Screen Navigation

### Set Active Screen

```
/-stat/screen/screen    int    screen ID
```

| Value | Screen |
|---|---|
| 0 | HOME |
| 1 | METERS |
| 2 | ROUTING |
| 3 | SETUP |
| 4 | LIBRARY |
| 5 | EFFECTS |
| 6 | MONITOR |
| 7 | USB RECORDER |
| 8 | SCENES |
| 9 | ASSIGN |

### Navigate to Page Within Screen

Each screen has sub-pages. First set the page, then switch to the screen:

**Channel screen pages:**
```
/-stat/screen/CHAN/page    int    0=HOME, 1=CONFIG, 2=GATE, 3=DYNAMICS, 4=EQ, 5=SENDS, 6=MAIN
/-stat/screen/screen       int    0
```

**Meter screen pages:**
```
/-stat/screen/METER/page   int    0=CHANNEL, 1=MIX BUS, 2=AUX/FX, 3=IN/OUT, 4=RTA, 5=AUTOMIX
/-stat/screen/screen       int    1
```

**Routing screen pages:**
```
/-stat/screen/ROUTE/page   int    0=INPUT, 1=AES-A, 2=AES-B, 3=CARD, 4=XLR, 5=PATCH OUT, 6=PATCH AUX, 7=PATCH P16, 8=PATCH USER
/-stat/screen/screen       int    2
```

**Setup screen pages:**
```
/-stat/screen/SETUP/page   int    0=GLOBAL, 1=CONFIG, 2=REMOTE, 3=NETWORK, 4=SCRIBBLE STRIPS, 5=PREAMPS, 6=CARD
/-stat/screen/screen       int    3
```

**Effects screen pages:**
```
/-stat/screen/FX/page      int    0=HOME, 1=FX1, 2=FX2, ... 8=FX8
/-stat/screen/screen       int    5
```

**Monitor screen pages:**
```
/-stat/screen/MON/page     int    0=MONITOR, 1=TALK A, 2=TALK B, 3=OSCILLATOR
/-stat/screen/screen       int    6
```

**Scene screen pages:**
```
/-stat/screen/SCENE/page   int    0=CUES, 1=SCENES, 2=SNIPPETS, 3=PARAMETER SAFE, 4=CHANNEL SAFE, 5=MIDI
/-stat/screen/screen       int    8
```

**Assign screen pages:**
```
/-stat/screen/ASSIGN/page  int    0=Home, 1=Set A, 2=Set B, 3=Set C
/-stat/screen/screen       int    9
```

### Mute Group Screen & Utility Screen

```
/-stat/screen/mutegrp    int    0 = off, 1 = on
/-stat/screen/utils      int    0 = off, 1 = on
```

---

## 24. Command: Fader Banks & Select

### Select a Channel

```
/-stat/selidx    int    channel select index (0–71)
```

### Channel Fader Bank (X32/M32 full-size)

```
/-stat/chfaderbank    int    0=CH1-16, 1=CH17-32, 2=AUX/FX, 3=BUS MASTERS
```

### Group Fader Bank (X32/M32 full-size)

```
/-stat/grpfaderbank    int    0=DCA1-8, 1=BUS1-8, 2=BUS9-16, 3=MATRIX/MAIN C
```

### Channel Fader Bank (X32 Compact / X32 Producer / M32R)

```
/-stat/chfaderbank    int    0=CH1-8, 1=CH9-16, 2=CH17-24, 3=CH25-32, 4=AUX/USB, 5=FX, 6=BUS1-8, 7=BUS9-16
```

### Group Fader Bank (X32 Compact / X32 Producer / M32R)

```
/-stat/grpfaderbank    int    0=DCA1-8, 1=BUS1-8, 2=BUS9-16, 3=MATRIX/MAIN C, 4=CH1-8, 5=CH9-16, 6=CH17-24, 7=CH25-32, 8=AUX/USB, 9=FX
```

### Bus Send Bank

```
/-stat/bussendbank    int    0=Bus1-4, 1=Bus5-8, 2=Bus9-12, 3=Bus13-16
```

### User Assign Bank

```
/-stat/userbank    int    0=Set A, 1=Set B, 2=Set C
```

### Sends on Fader / Fader Flip

```
/-stat/sendsonfader    int    0 = off, 1 = on
```

---

## 25. Command: X-Live (SD Card Recording)

### Transport State

```
/-stat/urec/state    int    0=Stop, 1=Pause, 2=Play, 3=Record
```

### Select Active SD Card

```
/-prefs/card/URECsdsel    int    0=SD1, 1=SD2
```

### Number of Recorded Tracks

```
/-prefs/card/URECtracks    int    0=32 tracks, 1=16 tracks, 2=8 tracks
```

### Playback Device

```
/-prefs/card/URECplayb    int    0=SD, 1=USB
```

### Format SD Card

```
/-action/formatcard    int    0=SD1, 1=SD2
```

### X-Live Routing

```
/-prefs/card/URECrout    int    0=Rec, 1=Play, 2=Auto
```

### Clear Alert

```
/-action/clearalert    int    1
```

### Set Position

```
/-action/setposition    int    position (0–86399999)
```

---

## 26. Command: Tape Transport

```
/-stat/tape/state    int    tape operation code
```

| Value | Operation |
|---|---|
| 0 | STOP |
| 1 | PLAY PAUSE |
| 2 | PLAY |
| 3 | RECORD PAUSE |
| 4 | RECORD |
| 5 | FAST FORWARD |
| 6 | REWIND |

### Tape Elapsed Time (State)

```
/-stat/tape/etime    int    elapsed time in seconds
```

---

## 27. Command: System

### Sync Console Clock

```
/-action/setclock    string    "YYYYMMddHHmmss"
```

**Example:** Set clock to current time:
```javascript
const now = new Date()
const ts = now.getFullYear()
  + String(now.getMonth()+1).padStart(2,'0')
  + String(now.getDate()).padStart(2,'0')
  + String(now.getHours()).padStart(2,'0')
  + String(now.getMinutes()).padStart(2,'0')
  + String(now.getSeconds()).padStart(2,'0')
osc.send({ address: '/-action/setclock', args: [{ type: 's', value: ts }] })
```

### Lock / Shutdown

```
/-stat/lock    int    0=Unlock, 1=Lock, 2=Shutdown
```

**Important:** To lock, first send `0` (unlock), then after 100ms send `1` (lock). This avoids the non-deterministic state when going directly from lock to shutdown or vice versa.

```javascript
osc.send({ address: '/-stat/lock', args: [{ type: 'i', value: 0 }] }) // unlock first
setTimeout(() => {
  osc.send({ address: '/-stat/lock', args: [{ type: 'i', value: 1 }] }) // then lock
}, 100)
```

---

## 28. Command: Undo

### Set Undo Checkpoint

```
/-action/undopt    int    1
```

Creates a checkpoint that can be returned to via undo. Only **one** undo step is stored.

### Execute Undo

```
/-action/doundo    int    1
```

Only works if a checkpoint has been set (check `/-undo/time` first — if empty, no undo available).

### Undo Time (State)

```
/-undo/time    string    time of last checkpoint, or "" if none
```

---

## 29. Command: Markers

### Add Marker (during X-Live recording)

```
/-action/addmarker    int    1
```

---

## 30. Fader Transitions & Easing

The X32 module supports smooth fader transitions with configurable easing curves.

### Fade Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `fadeDuration` | int | `0` | Duration in milliseconds (0 = instant) |
| `fadeAlgorithm` | string | `"linear"` | Easing algorithm |
| `fadeType` | string | `"ease-in"` | Curve direction (ignored for linear) |

### Available Easing Algorithms

- `linear`
- `quadratic`
- `cubic`
- `quartic`
- `quintic`
- `sinusoidal`
- `exponential`
- `circular`
- `elastic`
- `back`
- `bounce`

### Available Curve Types (for non-linear algorithms)

- `ease-in`
- `ease-out`
- `ease-in-out`

### How Transitions Work

1. Calculate the step count: `steps = ceil(fadeDuration / (1000 / fps))`
2. Generate an array of intermediate values using the easing function
3. Send each step as an OSC float message at the configured FPS (default 10 FPS)
4. If a new transition starts for the same path, the old one is replaced

### Canceling a Fade

To cancel an in-progress fade, run an "adjust fader level" with a delta of `0` — this stops the current transition and holds the fader at its current position.

### Configurable FPS

The framerate for fade updates can be configured (default: 10 FPS, range: 5–60):
```
config.fadeFps    int    5–60
```

---

## 31. State Variables (Readable State)

These are OSC paths that return current mixer state. Query them with empty args.

### Device Info

| Path | Type | Description |
|---|---|---|
| `/xinfo` | `[s, s, s, s]` | `[name, model, firmware, ip]` |

### Transport State

| Path | Type | Description |
|---|---|---|
| `/-stat/tape/state` | int | Tape state (0–6) |
| `/-stat/tape/etime` | int | Tape elapsed time (seconds) |
| `/-stat/urec/state` | int | X-Live state (0–3) |
| `/-stat/urec/etime` | int | X-Live elapsed time (ms) |
| `/-stat/urec/rtime` | int | X-Live remaining time (ms) |

### Selection & Solo

| Path | Type | Description |
|---|---|---|
| `/-stat/selidx` | int | Currently selected channel index (0–71) |
| `/-stat/solosw/NN` | int | Solo switch state for channel |
| `/-stat/solo` | int | Any solo active |
| `/-stat/sendsonfader` | int | Sends on fader state |
| `/-stat/chfaderbank` | int | Channel fader bank |
| `/-stat/grpfaderbank` | int | Group fader bank |
| `/-stat/bussendbank` | int | Bus send bank |
| `/-stat/userbank` | int | User assign bank |

### Screen State

| Path | Type | Description |
|---|---|---|
| `/-stat/screen/screen` | int | Active screen (0–9) |
| `/-stat/screen/CHAN/page` | int | Channel screen page |
| `/-stat/screen/METER/page` | int | Meter screen page |
| `/-stat/screen/ROUTE/page` | int | Routing screen page |
| `/-stat/screen/SETUP/page` | int | Setup screen page |
| `/-stat/screen/LIB/page` | int | Library screen page |
| `/-stat/screen/FX/page` | int | Effects screen page |
| `/-stat/screen/MON/page` | int | Monitor screen page |
| `/-stat/screen/USB/page` | int | USB screen page |
| `/-stat/screen/SCENE/page` | int | Scene screen page |
| `/-stat/screen/ASSIGN/page` | int | Assign screen page |
| `/-stat/screen/mutegrp` | int | Mute groups screen |
| `/-stat/screen/utils` | int | Utility screen |

### Talkback & Oscillator

| Path | Type | Description |
|---|---|---|
| `/-stat/talk/A` | int | Talkback A state |
| `/-stat/talk/B` | int | Talkback B state |
| `/-stat/osc/on` | int | Oscillator enabled |
| `/config/osc/dest` | int | Oscillator destination |

### Configuration

| Path | Type | Description |
|---|---|---|
| `/config/solo/mono` | int | Solo mono on/off |
| `/config/solo/dim` | int | Solo dim on/off |
| `/config/solo/dimatt` | float | Solo dim attenuation |
| `/config/solo/level` | float | Monitor level |
| `/-stat/lock` | int | Lock state |
| `/-prefs/show_control` | int | Show control mode (0=cue, 1=scene, 2=snippet) |
| `/-show/prepos/current` | int | Current highlighted position |
| `/-undo/time` | string | Last undo checkpoint time |

### Snapshot State

| Path | Type | Description |
|---|---|---|
| `/-snap/name` | string | Current snapshot name |
| `/-snap/index` | int | Current snapshot index |

### Channel/Source State (Example: Channel 01)

| Path | Type | Description |
|---|---|---|
| `/ch/01/config/name` | string | Channel label |
| `/ch/01/config/color` | int | Channel color (0–15) |
| `/ch/01/mix/on` | int | Mute state |
| `/ch/01/mix/fader` | float | Fader level |
| `/ch/01/mix/pan` | int | Pan position |
| `/ch/01/mix/BB/on` | int | Bus send mute |
| `/ch/01/mix/BB/level` | float | Bus send level |
| `/ch/01/mix/BB/pan` | float | Bus send pan |

---

## 32. Subscription & Keep-Alive

### /xremote (Required for State Streaming)

The X32 will **not** push state changes unless `/xremote` is active. Send it every ~1500ms:

```
→ /xremote    (no args)
```

Without this, you must manually query every path you care about.

### /subscribe (For Specific Paths)

To subscribe to specific paths with a timeout:

```
→ /subscribe    [s:"/-stat/tape/etime", i:20]
```

The second argument is the subscription timeout in seconds. After this time, the subscription expires unless renewed.

> **Important:** You must re-subscribe at least every 10 seconds. The module uses 5 seconds to be safe.

### Heartbeat Detection

If no `/xremote` response is received within ~5 seconds, consider the connection lost and attempt to reconnect.

---

## 33. Color Values Reference

| Value | Color | Value | Color (Inverted) |
|---|---|---|---|
| 0 | Off | 8 | Off Inverted |
| 1 | Red | 9 | Red Inverted |
| 2 | Green | 10 | Green Inverted |
| 3 | Yellow | 11 | Yellow Inverted |
| 4 | Blue | 12 | Blue Inverted |
| 5 | Magenta | 13 | Magenta Inverted |
| 6 | Cyan | 14 | Cyan Inverted |
| 7 | White | 15 | White Inverted |

---

## 34. Mute Group Values

| Group | OSC Path |
|---|---|
| Mute Group 1 | `/config/mute/1` |
| Mute Group 2 | `/config/mute/2` |
| Mute Group 3 | `/config/mute/3` |
| Mute Group 4 | `/config/mute/4` |
| Mute Group 5 | `/config/mute/5` |
| Mute Group 6 | `/config/mute/6` |

> **Note:** Mute group semantics are **inverted** from channel mute. `1` = group is active (channels muted), `0` = group inactive.

---

## 35. Appendix: Full OSC Path Reference

### System & Connection

| Path | Type | R/W | Description |
|---|---|---|---|
| `/xremote` | — | W | Enable state streaming (no args) |
| `/xinfo` | `[s,s,s,s]` | R | Device info response |
| `/subscribe` | `[s,i]` | W | Subscribe to path with timeout |
| `/load` | `[s,i,i,i]` | W | Load preset |
| `/save` | `[s,i,s,s]` | W | Save scene |

### Actions (Fire-and-Forget Commands)

| Path | Args | Description |
|---|---|---|
| `/-action/goscene` | `i` | Load scene by number |
| `/-action/gocue` | `i` | Load cue by number |
| `/-action/gosnippet` | `i` | Load snippet by number |
| `/-action/clearsolo` | `i:1` | Clear all solos |
| `/-action/setclock` | `s` | Sync console clock |
| `/-action/doundo` | `i:1` | Execute undo |
| `/-action/undopt` | `i:1` | Set undo checkpoint |
| `/-action/addmarker` | `i:1` | Add marker during recording |
| `/-action/formatcard` | `i` | Format SD card |
| `/-action/clearalert` | `i:1` | Clear X-Live alert |
| `/-action/setposition` | `i` | Set X-Live position |

### Channel Paths (per channel)

| Path | Type | Description |
|---|---|---|
| `/ch/NN/config/name` | string | Channel label |
| `/ch/NN/config/color` | int | Scribble strip color |
| `/ch/NN/mix/on` | int | Mute (0=off, 1=on) |
| `/ch/NN/mix/fader` | float | Fader level |
| `/ch/NN/mix/pan` | float | Pan position |
| `/ch/NN/mix/BB/on` | int | Bus send mute |
| `/ch/NN/mix/BB/level` | float | Bus send level |
| `/ch/NN/mix/BB/pan` | float | Bus send pan (odd buses) |
| `/ch/NN/preamp/trim` | float | Input trim |
| `/ch/NN/insert/on` | int | Insert on/off |
| `/ch/NN/insert/pos` | int | Insert position |
| `/ch/NN/insert/sel` | int | Insert destination |

### Aux In Paths

| Path | Type | Description |
|---|---|---|
| `/auxin/NN/config/name` | string | Label |
| `/auxin/NN/config/color` | int | Color |
| `/auxin/NN/mix/on` | int | Mute |
| `/auxin/NN/mix/fader` | float | Fader level |
| `/auxin/NN/mix/pan` | float | Pan |
| `/auxin/NN/mix/BB/on` | int | Bus send mute |
| `/auxin/NN/mix/BB/level` | float | Bus send level |
| `/auxin/NN/preamp/trim` | float | Trim |

### FX Return Paths

| Path | Type | Description |
|---|---|---|
| `/fxrtn/NN/config/name` | string | Label |
| `/fxrtn/NN/config/color` | int | Color |
| `/fxrtn/NN/mix/on` | int | Mute |
| `/fxrtn/NN/mix/fader` | float | Fader level |
| `/fxrtn/NN/mix/pan` | float | Pan |
| `/fxrtn/NN/mix/BB/on` | int | Bus send mute |
| `/fxrtn/NN/mix/BB/level` | float | Bus send level |

### Bus Paths

| Path | Type | Description |
|---|---|---|
| `/bus/NN/config/name` | string | Label |
| `/bus/NN/config/color` | int | Color |
| `/bus/NN/mix/on` | int | Mute |
| `/bus/NN/mix/fader` | float | Fader level |
| `/bus/NN/mix/pan` | float | Pan |
| `/bus/NN/mix/MM/on` | int | Matrix send mute |
| `/bus/NN/mix/MM/level` | float | Matrix send level |
| `/bus/NN/mix/MM/pan` | float | Matrix send pan (odd matrices) |
| `/bus/NN/insert/on` | int | Insert on/off |
| `/bus/NN/insert/pos` | int | Insert position |
| `/bus/NN/insert/sel` | int | Insert destination |

### Matrix Paths

| Path | Type | Description |
|---|---|---|
| `/mtx/NN/config/name` | string | Label |
| `/mtx/NN/config/color` | int | Color |
| `/mtx/NN/mix/on` | int | Mute |
| `/mtx/NN/mix/fader` | float | Fader level |
| `/mtx/NN/insert/on` | int | Insert on/off |
| `/mtx/NN/insert/pos` | int | Insert position |
| `/mtx/NN/insert/sel` | int | Insert destination |

### Main Paths

| Path | Type | Description |
|---|---|---|
| `/main/st/config/name` | string | Main Stereo label |
| `/main/st/config/color` | int | Main Stereo color |
| `/main/st/mix/on` | int | Main Stereo mute |
| `/main/st/mix/fader` | float | Main Stereo fader |
| `/main/st/mix/pan` | float | Main Stereo pan |
| `/main/st/insert/on` | int | Insert |
| `/main/st/insert/pos` | int | Insert position |
| `/main/st/insert/sel` | int | Insert destination |
| `/main/m/config/name` | string | Main Mono label |
| `/main/m/config/color` | int | Main Mono color |
| `/main/m/mix/on` | int | Main Mono mute |
| `/main/m/mix/fader` | float | Main Mono fader |
| `/main/m/insert/on` | int | Insert |
| `/main/m/insert/pos` | int | Insert position |
| `/main/m/insert/sel` | int | Insert destination |

### DCA Paths

| Path | Type | Description |
|---|---|---|
| `/dca/N/config/name` | string | Label |
| `/dca/N/config/color` | int | Color |
| `/dca/N/on` | int | Mute (note: no `/mix/` level) |
| `/dca/N/fader` | float | Fader level (note: no `/mix/` level) |

### Library Metadata

| Path | Type | Description |
|---|---|---|
| `/-libs/ch/NNN/hasdata` | int | Channel preset exists (0/1) |
| `/-libs/ch/NNN/name` | string | Channel preset name |
| `/-libs/fx/NNN/hasdata` | int | FX preset exists |
| `/-libs/fx/NNN/name` | string | FX preset name |
| `/-libs/mon/NNN/hasdata` | int | AES preset exists |
| `/-libs/mon/NNN/name` | string | AES preset name |
| `/-libs/r/NNN/hasdata` | int | Routing preset exists (**broken**) |
| `/-libs/r/NNN/name` | string | Routing preset name (**broken**) |

### User Routing

| Path | Type | Description |
|---|---|---|
| `/config/userrout/in/NN` | int | User input route for channel NN |
| `/config/userrout/out/NN` | int | User output route for output NN |

### Routing Blocks

| Path | Type | Description |
|---|---|---|
| `/config/routing/IN/BLOCK` | int | Input routing (RECORD mode) |
| `/config/routing/PLAY/BLOCK` | int | Input routing (PLAY mode) |
| `/config/routing/AUX` | int | Aux routing |
| `/config/routing/AES50A/BLOCK` | int | AES50-A routing |
| `/config/routing/AES50B/BLOCK` | int | AES50-B routing |
| `/config/routing/CARD/BLOCK` | int | Card routing |
| `/config/routing/OUT/BLOCK` | int | XLR output routing |
| `/-config/routing/routswitch` | int | Routing mode (0=PLAY, 1=RECORD) |

---

## Quick-Start Code Example

```javascript
const osc = require('osc')

const port = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: '192.168.1.100',
  remotePort: 10023,
  metadata: true,
})

port.on('ready', () => {
  console.log('Connected to X32')

  // Start subscription
  port.send({ address: '/xremote', args: [] })

  // Query device info
  port.send({ address: '/xinfo', args: [] })
})

port.on('message', (msg) => {
  console.log(`${msg.address}:`, msg.args)

  switch (msg.address) {
    case '/xinfo':
      console.log('Connected to:', msg.args[1]?.value)
      break
    case '/ch/01/mix/on':
      console.log('Ch 1 muted:', msg.args[0]?.value === 0)
      break
  }
})

// Keep heartbeat
setInterval(() => {
  port.send({ address: '/xremote', args: [] })
}, 1500)

// === COMMANDS ===

// Mute channel 1
port.send({ address: '/ch/01/mix/on', args: [{ type: 'i', value: 0 }] })

// Unmute channel 1
port.send({ address: '/ch/01/mix/on', args: [{ type: 'i', value: 1 }] })

// Set channel 1 fader to 0 dB
port.send({ address: '/ch/01/mix/fader', args: [{ type: 'f', value: 0.75 }] })

// Set channel 1 pan to hard right
port.send({ address: '/ch/01/mix/pan', args: [{ type: 'f', value: 1.0 }] })

// Set channel 1 send to bus 3 at -12 dB
port.send({ address: '/ch/01/mix/03/level', args: [{ type: 'f', value: 0.375 }] })

// Label channel 1
port.send({ address: '/ch/01/config/name', args: [{ type: 's', value: 'Vocals' }] })

// Set channel 1 color to Red
port.send({ address: '/ch/01/config/color', args: [{ type: 'i', value: 1 }] })

// Set headamp gain to +24 dB
port.send({ address: '/headamp/000/gain', args: [{ type: 'f', value: 0.5 }] })

// Load scene 3
port.send({ address: '/-action/goscene', args: [{ type: 'i', value: 3 }] })

// Load channel preset 5 into channel 1 (all sections)
port.send({ address: '/load', args: [
  { type: 's', value: 'libchan' },
  { type: 'i', value: 4 },    // 0-based: preset 5 = index 4
  { type: 'i', value: 0 },    // channel 1 = index 0
  { type: 'i', value: 63 },   // scope: all sections
] })

// Toggle solo on channel 1
port.send({ address: '/-stat/solosw/01', args: [{ type: 'i', value: 1 }] })

port.open()
```

---

*Document generated from the companion-module-behringer-x32 source code. For the full X32 OSC specification, see the official [X32-OSC.pdf](companion-module-behringer-x32-master/docs/X32-OSC.pdf) included in the module's docs folder.*
