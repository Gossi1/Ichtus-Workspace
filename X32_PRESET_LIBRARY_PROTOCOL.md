# Behringer X32 Preset/Library System — OSC Protocol Reference

> **Source:** Reverse-engineered from the [companion-module-behringer-x32](https://github.com/bitfocus/companion-module-behringer-x32) Companion module by Bitfocus.
>
> This document explains exactly how the X32/M32 digital mixer's **Library/Preset system** works over OSC, including data discovery, metadata polling, preset loading commands, scope control, and edge cases. Use this as a reference to implement preset/library functionality in your own application.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Library Types](#2-library-types)
3. [Data Discovery (Polling Metadata)](#3-data-discovery-polling-metadata)
4. [State Caching](#4-state-caching)
5. [Preset Loading Commands](#5-preset-loading-commands)
6. [Scope Bitmasks (Selective Loading)](#6-scope-bitmasks-selective-loading)
7. [Target Channel Resolution](#7-target-channel-resolution)
8. [Full Action Flow: "Load Channel Preset"](#8-full-action-flow-load-channel-preset)
9. [Effects Presets](#9-effects-presets)
10. [AES/DP48 Presets](#10-aesdp48-presets)
11. [Routing Presets (Broken/WIP)](#11-routing-presets-brokenwip)
12. [Connection & Subscription Notes](#12-connection--subscription-notes)
13. [Error Handling & Safety](#13-error-handling--safety)

---

## 1. Overview

The X32 stores presets in what it calls **"Libraries"**. Each library is a set of up to **100 numbered slots** (001–100). Each slot can either be:

- **Empty** — no data stored (`hasdata = 0`)
- **Occupied** — contains a preset (`hasdata = 1`) with an optional user-assigned name

The mixer communicates over **OSC (Open Sound Control)** using the `osc` npm package. All preset-related commands use the `/load` OSC address.

### Key OSC Ports

| Purpose | Port | Notes |
|---|---|---|
| `/xremote` (subscription pings) | **10023** | Keeps the mixer streaming state |
| `/load` commands | **10023** | Commands to load presets |
| General OSC queries | **10023** | Querying OSC paths for data |
| State change events | **10023** | Mixer pushes changes here when using `/xremote` |

> **Important:** Commands and `/xremote` pings use the **same port** (10023). The module sends commands on port 10023 while also running `/xremote` on the same port so that it receives change events for its own commands.

---

## 2. Library Types

The X32 has **4 library types**, each identified by a short string key:

| Key | Library | Slot Count | Purpose |
|---|---|---|---|
| `ch` | Channel Presets | 100 | Channel strip settings (EQ, dynamics, gate, sends, config, headamp) |
| `fx` | Effects Presets | 100 | FX processor configurations |
| `r` | Routing Presets | 100 | Routing/scene configurations **(broken on modern firmware)** |
| `mon` | Monitor/AES Presets | 100 | AES/DP48 monitor presets |

### OSC Path Pattern

All library metadata lives under the same path structure:

```
/-libs/{libraryKey}/{slotNumber}/hasdata
/-libs/{libraryKey}/{slotNumber}/name
```

Where:
- `{libraryKey}` is one of `ch`, `fx`, `r`, `mon`
- `{slotNumber}` is a **3-digit zero-padded** string from `001` to `100`

**Examples:**
- `/-libs/ch/001/hasdata` → integer (0 or 1)
- `/-libs/ch/001/name` → string (user-assigned name)
- `/-libs/fx/042/hasdata` → integer (0 or 1)
- `/-libs/mon/007/name` → string

---

## 3. Data Discovery (Polling Metadata)

### When It Happens

Right after the module successfully syncs with the mixer (receives a `/xinfo` response), it triggers a **full metadata poll** of all library slots:

> **Source:** `src/main.ts` — `loadPresetData()`

```typescript
private loadPresetData(): void {
  const options = [...Array(100).keys()].map((x) => `${x + 1}`.padStart(3, '0'))
  options.forEach((option) => {
    ;['ch', 'fx', 'r', 'mon'].forEach((lib) => {
      this.queueEnsureLoaded(`/-libs/${lib}/${option}/hasdata`)
      this.queueEnsureLoaded(`/-libs/${lib}/${option}/name`)
    })
  })
}
```

This results in **800 OSC requests**:
- 100 slots × 4 libraries × 2 paths each (hasdata + name)

### Request Queue Strategy

The requests don't fire all at once. They use a **concurrency-limited queue** with timeout:

> **Source:** `src/main.ts`

```typescript
private readonly requestQueue: PQueue = new PQueue({
  concurrency: 20,   // 20 parallel requests max
  timeout: 500,       // 500ms timeout per request
})
```

**Request lifecycle:**

1. A request is added via `queueEnsureLoaded(path)`
2. It checks if a request for that path is already **in-flight** — if so, it's skipped
3. It checks if the data is **already cached** in state — if so, it's skipped
4. It sends an OSC query: `{ address: path, args: [] }` (empty args = "give me the value")
5. It awaits a response. When the mixer responds, the OSC message handler stores the value:
   ```typescript
   this.x32State.set(message.address, args)
   ```
6. The in-flight request promise is resolved:
   ```typescript
   if (this.inFlightRequests[message.address]) {
     this.inFlightRequests[message.address]()
     delete this.inFlightRequests[message.address]
   }
   ```
7. If the request times out (>500ms), it's rejected with an error, and the slot is left as "unknown"

### Metadata Format

When queried, the X32 responds with OSC arguments:

**`/-libs/ch/001/hasdata`** returns:
```json
[{ "type": "i", "value": 1 }]   // preset exists
[{ "type": "i", "value": 0 }]   // slot empty
```

**`/-libs/ch/001/name`** returns:
```json
[{ "type": "s", "value": "Vocal Lead" }]   // named preset
[{ "type": "s", "value": "" }]              // unnamed or empty
```

### Lazy Loading (Subscription)

When a user configures an action (e.g., "Load channel preset" with a specific preset number), the module also ensures the relevant metadata is loaded on subscribe:

> **Source:** `src/actions/presets.ts`

```typescript
subscribe: (evt) => {
  props.ensureLoaded(`/-libs/ch/${padNumber(evt.options.preset, 3)}/hasdata`)
  props.ensureLoaded('/-stat/selidx')
}
```

This means if a preset slot's metadata wasn't loaded during the initial bulk poll, it gets loaded when someone configures an action targeting it.

---

## 4. State Caching

### Data Store

All OSC responses are cached in a `Map<string, osc.MetaArgument[]>`:

> **Source:** `src/state.ts`

```typescript
export class X32State {
  private readonly data: Map<string, osc.MetaArgument[]>

  public get(path: string): osc.MetaArgument[] | undefined {
    return this.data.get(path)
  }
  public set(path: string, data: osc.MetaArgument[]): void {
    this.data.set(path, data)
  }
}
```

### Building Dropdown Choices

The cached data is used to present preset choices in the UI:

> **Source:** `src/choices.ts` — `GetPresetsChoices()`

```typescript
export function GetPresetsChoices(lib: 'ch' | 'fx' | 'r' | 'mon', state: X32State): DropdownChoice<number>[] {
  const options = [...Array(100).keys()]
  return options.map((i) => {
    const option = i + 1

    const hasDataState = state.get(`/-libs/${lib}/${option}/hasdata`)
    const hasDataValue = hasDataState && hasDataState[0]?.type === 'i' && hasDataState[0].value === 1
    if (hasDataValue) {
      const nameState = state.get(`/-libs/${lib}/${option}/name`)
      const nameValue = nameState && nameState[0]?.type === 's' ? nameState[0].value : undefined
      return {
        id: option,
        label:
          nameValue && nameValue.trim().length > 0
            ? `${padNumber(option, 3)} (${nameValue})`
            : `${padNumber(option, 3)}`,
      }
    } else {
      return {
        id: option,
        label: `${padNumber(option, 3)} (No data)`,
      }
    }
  })
}
```

**Resulting dropdown entries:**
- `001 (Vocal Lead)` — occupied slot with a name
- `002` — occupied slot with empty name
- `003 (No data)` — empty slot (or data not yet loaded)
- ...up to `100`

---

## 5. Preset Loading Commands

### The `/load` OSC Command

All preset loading is done via the `/load` OSC address. The command uses different **type tags** to distinguish between library types.

#### Channel Presets (`libchan`)

> **OSC:** `/load` with arguments:
> ```typescript
> props.sendOsc('/load', [
>   { type: 's', value: 'libchan' },     // type tag
>   { type: 'i', value: preset - 1 },     // preset index (0-based!)
>   { type: 'i', value: selectedChannel }, // target channel number
>   { type: 'i', value: scopeBits },       // scope bitmask
> ])
> ```

| Arg | Type | Description |
|---|---|---|
| 1 | string (`s`) | Type tag: `'libchan'` |
| 2 | integer (`i`) | **0-based** preset index (001 → 0, 002 → 1, ..., 100 → 99) |
| 3 | integer (`i`) | **Target channel number** (0–71, see [Target Channel Resolution](#7-target-channel-resolution)) |
| 4 | integer (`i`) | **Scope bitmask** (which sections to load, see [Scope Bitmasks](#6-scope-bitmasks)) |

#### Effects Presets (`libfx`)

> **OSC:** Same pattern but with `'libfx'` and no scope:
> ```typescript
> props.sendOsc('/load', [
>   { type: 's', value: 'libfx' },
>   { type: 'i', value: preset - 1 },
>   { type: 'i', value: channel },        // FX slot number (0-7)
> ])
> ```

| Arg | Type | Description |
|---|---|---|
| 1 | string (`s`) | Type tag: `'libfx'` |
| 2 | integer (`i`) | **0-based** preset index |
| 3 | integer (`i`) | Target FX slot (0–7) |

#### AES/DP48 Presets (`libmon`)

> **OSC:**
> ```typescript
> props.sendOsc('/load', [
>   { type: 's', value: 'libmon' },
>   { type: 'i', value: preset - 1 },
> ])
> ```

| Arg | Type | Description |
|---|---|---|
| 1 | string (`s`) | Type tag: `'libmon'` |
| 2 | integer (`i`) | **0-based** preset index |

---

## 6. Scope Bitmasks (Selective Loading)

For **channel presets**, the X32 supports selectively loading only certain sections of a preset. This is controlled via a **bitmask** (integer) where each bit corresponds to a section.

### Bit Positions

> **Source:** `src/actions/presets.ts`

```typescript
const scopeBits = [
  !!action.options.sends,  // bit 5 (MSB)
  !!action.options.eq,      // bit 4
  !!action.options.dyn,     // bit 3
  !!action.options.gate,    // bit 2
  !!action.options.config,  // bit 1
  !!action.options.ha,      // bit 0 (LSB)
].reduce<number>((acc, cur) => (acc << 1) | (cur ? 1 : 0), 0)
```

| Bit | Section | Description |
|---|---|---|
| 5 (MSB, 0x20) | Sends | Channel sends to buses |
| 4 (0x10) | EQ | Equalizer settings |
| 3 (0x08) | Dynamics | Compressor settings |
| 2 (0x04) | Gate | Gate/expander settings |
| 1 (0x02) | Config | Channel config (name, color, etc.) |
| 0 (LSB, 0x01) | Headamp | Preamplifier settings (gain, phantom, etc.) |

**Examples:**
- Load everything: `0b111111` = 63
- Load EQ only: `0b010000` = 16
- Load EQ + Dynamics: `0b011000` = 24
- Load everything except headamp: `0b111110` = 62

The Companion module builds this mask from checkbox options:
```typescript
{
  id: 'ha',
  type: 'checkbox',
  label: 'Load headamp data',
  default: true,
},
{
  id: 'config',
  type: 'checkbox',
  label: 'Load configuration data',
  default: true,
},
{
  id: 'gate',
  type: 'checkbox',
  label: 'Load gate data',
  default: true,
},
{
  id: 'dyn',
  type: 'checkbox',
  label: 'Load compressor data',
  default: true,
},
{
  id: 'eq',
  type: 'checkbox',
  label: 'Load equalizer data',
  default: true,
},
{
  id: 'sends',
  type: 'checkbox',
  label: 'Load sends data',
  default: true,
},
```

---

## 7. Target Channel Resolution

When loading a channel preset, you need to specify which mixer channel to load it into. The Companion module supports two modes:

### Mode 1: Explicit Channel

The user selects a specific channel from a dropdown. The text ref is parsed to a channel number:

> **Source:** `src/actions/presets.ts`

```typescript
if (action.options.channel !== 'selected') {
  const channelRef = parseRefToPaths(action.options.channel, selectChoicesParseOptions)
  if (channelRef?.selectNumber === undefined) return
  selectedChannel = channelRef.selectNumber
}
```

**Channel numbers (`selectNumber`):**

| Range | Channels | Values |
|---|---|---|
| 0–31 | Input Channels 1–32 | 0–31 |
| 32–39 | Aux In 1–8 | 32–39 |
| 40–47 | FX Returns 1L–8R | 40–47 |
| 48–63 | Mix Buses 1–16 | 48–63 |
| 64–69 | Matrix 1–6 | 64–69 |
| 70 | Main Stereo | 70 |
| 71 | Main Mono | 71 |

### Mode 2: Selected Channel

The user selects `"selected"` and the module reads the currently selected channel from the mixer's state:

> **Source:** `src/actions/presets.ts`

```typescript
const selected = props.state.get('/-stat/selidx')
selectedChannel = selected && selected[0].type === 'i' ? selected[0]?.value : 0
```

This reads the OSC path `/-stat/selidx`, which returns the channel number currently selected on the console (the one with the lit "SELECT" button).

### Safety Check

Before loading, the module validates that the preset slot actually has data:

```typescript
const hasDataState = props.state.get(`/-libs/ch/${padNumber(preset, 3)}/hasdata`)
const hasDataValue = hasDataState && hasDataState[0]?.type === 'i' && hasDataState[0].value === 1
if (!hasDataValue) {
  return // silently abort — don't load empty slots
}
```

---

## 8. Full Action Flow: "Load Channel Preset"

Here's the complete flow from user action to OSC command:

```
User presses a Companion button configured with "Load channel preset"
  │
  ├─ Determine target channel
  │   ├─ If specified: parseRefToPaths(channelRef) → selectNumber
  │   └─ If "selected": read /-stat/selidx from state cache
  │
  ├─ Validate preset exists
  │   ├─ Read /-libs/ch/{NNN}/hasdata from state cache
  │   └─ If not present or hasdata ≠ 1: ABORT (no-op)
  │
  ├─ Build scope bitmask
  │   └─ Convert 6 checkboxes (ha/config/gate/dyn/eq/sends) → 6-bit integer
  │
  └─ Send OSC command to port 10023
      └─ /load [s:"libchan", i:{preset-1}, i:{channelNumber}, i:{scopeBits}]
```

---

## 9. Effects Presets

Effects presets work similarly but with less complexity (no scope bitmask, no "selected channel" option).

### OSC Command

```
/load [s:"libfx", i:{preset-1}, i:{channel}]
```

Where `channel` is the FX slot (0–7 for FX1–FX8).

### Data Discovery

Same as channel presets but with `fx` as the library key:

```
/-libs/fx/{NNN}/hasdata
/-libs/fx/{NNN}/name
```

### User Interface

The user selects:
1. A preset (from the `fx` library dropdown)
2. A target FX slot (1–8)

### Action Flow

```typescript
callback: (action): void => {
  // Validate preset exists
  const hasDataState = props.state.get(`/-libs/fx/${padNumber(preset, 3)}/hasdata`)
  const hasDataValue = hasDataState && hasDataState[0]?.type === 'i' && hasDataState[0].value === 1
  if (!hasDataValue) return

  // Resolve target (support for -1 = selected channel, though not exposed in UI)
  let channel = action.options.channel
  if (channel == -1) {
    const selected = props.state.get('/-stat/selidx')
    channel = selected && selected[0].type === 'i' ? selected[0]?.value : 0
  }

  // Send command
  props.sendOsc('/load', [
    { type: 's', value: 'libfx' },
    { type: 'i', value: preset - 1 },
    { type: 'i', value: channel },
  ])
}
```

---

## 10. AES/DP48 Presets

AES/DP48 (monitor mix) presets are the simplest — no scope and no target channel.

### OSC Command

```
/load [s:"libmon", i:{preset-1}]
```

### Data Discovery

Uses the `mon` library key:

```
/-libs/mon/{NNN}/hasdata
/-libs/mon/{NNN}/name
```

### Action Flow

```typescript
callback: (action): void => {
  // Validate preset exists
  const hasDataState = props.state.get(`/-libs/mon/${paddedPreset}/hasdata`)
  const hasDataValue = hasDataState && hasDataState[0]?.type === 'i' && hasDataState[0].value === 1
  if (!hasDataValue) return

  // Send command
  props.sendOsc('/load', [
    { type: 's', value: 'libmon' },
    { type: 'i', value: preset - 1 },
  ])
}
```

---

## 11. Routing Presets (Broken/WIP)

Routing presets use the `r` library key and the `'librout'` type tag, but **this functionality is currently broken** on modern X32 firmware.

> **Source:** `src/actions/presets.ts` — commented out code with extensive notes

### The Problem

The expected OSC command would be:

```
/load [s:"librout", i:{preset-1}, i:{scopeBits}]
```

But the X32 responds with:

```
/load [s:"librout", i:1]
```

This appears to be a "success" response (1 = success), but **nothing actually changes** on the console. The investigation concluded:

1. **Behringer changed things** when they introduced User Routing — the OSC command wasn't updated accordingly
2. The response ignores the scope bits we send and always defaults to 0
3. **X32-Edit** doesn't use the `/load` command for routing — it loads each routing config property individually (e.g., `/config/routing` commands). Loading a routing preset triggers ~24 separate OSC commands setting each channel's routing manually
4. **Mixing Station** also doesn't have this feature working

### Scope Bits (would-be)

| Bit | Section |
|---|---|
| 7 | CH (Channel In Routing) |
| 6 | AES (AES50 Out Routing) |
| 5 | CARD (Card Out Routing) |
| 4 | XLR (XLR Out Routing) |
| 3 | OUT (Out Patch) |
| 2 | AUX (Aux Patch) |
| 1 | P16 (P16 Patch) |
| 0 | USER (User Slots) |

### Workaround

If you need routing preset functionality, you would need to implement it yourself by:
1. Reading each routing config path individually
2. Saving the values
3. Restoring them on demand by sending each path as a separate OSC command

---

## 12. Connection & Subscription Notes

### Connection Lifecycle

```
Module starts
  │
  ├─ Opens UDP port on 0.0.0.0:0 (random local port)
  ├─ Sets remote to {config.host}:10023
  │
  ├─ On 'ready':
  │   ├─ Sends /xremote (starts subscription ping)
  │   ├─ Starts heartbeat (sends /xremote every 1500ms)
  │   ├─ Sends /subscribe for tape state updates (every 5000ms)
  │   └─ Starts sync interval (sends /xinfo every 2000ms until response received)
  │
  ├─ On /xinfo response:
  │   ├─ Stops sync interval
  │   ├─ Calls loadVariablesData() — loads all variable OSC paths
  │   └─ Calls loadPresetData() — loads all 800 library metadata paths
  │
  └─ On error:
      └─ Reconnects after 2000ms delay
```

### Keep-Alive

```typescript
// Heartbeat — keeps the mixer streaming state changes
this.heartbeat = setInterval(() => this.pulse(), 1500)

// Subscription renewal — resubscribe every 5 seconds
// The mixer requires resubscription at least every 10 seconds
this.subscribeInterval = setInterval(() => this.subscribeForUpdates(), 5000)
```

### Port 10023 Strategy

Commands use **port 10023** — the same port used for `/xremote` status subscriptions. This is deliberate:

> **Note:** "We send commands on a different port than we run /xremote on, so that we get change events for what we send. Otherwise we can have no confirmation that a command was accepted."

However, looking at the code, both `sendOsc` and the heartbeat use the same `osc` UDPPort instance (which is bound to port 10023). The comment seems to indicate that the module originally considered two ports but settled on one. The key insight is that by using port 10023 for both commands and status, the mixer automatically pushes back the new state values after a command, confirming it was applied.

---

## 13. Error Handling & Safety

### Validation Before Loading

Every preset load action **verifies the preset exists** before sending the `/load` command:

```typescript
const hasDataState = props.state.get(`/-libs/ch/${padNumber(preset, 3)}/hasdata`)
const hasDataValue = hasDataState && hasDataState[0]?.type === 'i' && hasDataState[0].value === 1
if (!hasDataValue) {
  return // Silent abort — don't send invalid commands
}
```

This prevents sending a `/load` command for empty slots, which could cause undefined behavior.

### Request Timeouts

All OSC queries have a **500ms timeout**. If a request doesn't get a response in time:
```typescript
.catch((e: unknown) => {
  delete this.inFlightRequests[path]
  this.log('error', `Request failed for "${path}": (${e})`)
})
```

The slot will remain as "uncached" in state.

### Duplicate Request Prevention

The request queue checks both:
1. **Already in-flight**: If a request for the same path is pending, skip
2. **Already cached**: If data already exists in state, skip

```typescript
if (this.inFlightRequests[path]) {
  this.log('debug', `Ignoring request "${path}" as one in flight`)
  return
}
if (this.x32State.get(path)) {
  this.log('debug', `Ignoring request "${path}" as data is already loaded`)
  return
}
```

### User Warning

> *"Load channel preset either into specified channel or into selected channel. **Use at own risk.** (Maybe don't accidently press during a show?)"*

The module authors explicitly warn that loading presets can be disruptive during a live performance, as it will overwrite the current channel strip settings.

---

## Summary of All OSC Paths

### Query Paths (Polling)

| OSC Path | Response Type | Description |
|---|---|---|
| `/-libs/{ch,fx,r,mon}/{001-100}/hasdata` | int (0 or 1) | Whether a preset exists in the slot |
| `/-libs/{ch,fx,r,mon}/{001-100}/name` | string | User-assigned name of the preset |
| `/-stat/selidx` | int | Currently selected channel number |

### Command Paths

| OSC Path | Arguments | Description |
|---|---|---|
| `/load` | `[s:"libchan", i:presetIdx, i:channelNum, i:scopeBits]` | Load a channel preset |
| `/load` | `[s:"libfx", i:presetIdx, i:fxSlot]` | Load an effects preset |
| `/load` | `[s:"libmon", i:presetIdx]` | Load an AES/DP48 preset |
| `/load` | `[s:"librout", i:presetIdx, i:scopeBits]` | Load a routing preset **(broken)** |

### Type Tags

| Type Tag String | Library |
|---|---|
| `libchan` | Channel presets |
| `libfx` | Effects presets |
| `libmon` | AES/DP48 monitor presets |
| `librout` | Routing presets **(broken)** |

---

## Implementation Checklist

To recreate this functionality in your own app:

1. ✅ **OSC Connection**: Open a UDP socket to `{mixerIP}:10023`
2. ✅ **Sync**: Send `/xinfo` and wait for the response
3. ✅ **Heartbeat**: Send `/xremote` every ~1500ms to keep the mixer streaming state
4. ✅ **Poll Metadata**: Query all 800 `/-libs/*/NNN/hasdata` and `/-libs/*/NNN/name` paths
5. ✅ **Build UI Choices**: For each library, show 100 slots with names where data exists
6. ✅ **Send Load**: When user triggers, validate exists, build scope mask, send `/load`
7. ✅ **Handle Timeouts**: Use a queue with concurrency limit and timeout per request
8. ✅ **Cache State**: Cache OSC responses locally to avoid redundant queries
