# shortcut_label Contract

## Overview

`blsi.ShortcutLabel` is a pure utility module that converts stored chord objects (`{ code, mods }`) into human-readable display strings and canonical conflict-detection keys. It is platform-aware: Mac renders Unicode glyphs (`⌘⇧⌥⌃`) concatenated without separators; Windows/Linux spells out modifier names joined by `+`. It also exposes a curated list of browser-reserved chords (`RESERVED`) used by the capture UI to show warnings — not a deny list; users can override any reserved chord. The module has no DOM access, no storage access, and no side effects beyond a one-time platform detection read at module load.

## Public API

### codeLabel(code)

**What**: Converts a `KeyboardEvent.code` string into a human-readable key label.

**Params**:
- `code` (string) — A `KeyboardEvent.code` value (physical key, layout-independent). Examples: `'KeyB'`, `'Digit3'`, `'ArrowUp'`, `'F5'`, `'NumpadEnter'`.

**Returns**: `string` — The display label from `CODE_TO_LABEL` if the code is mapped; otherwise the raw code string itself (fallback). Never returns empty for a non-empty `code`.

**Side effects**: None.

**Handles**:
- Known letters (`KeyA`–`KeyZ`) → uppercase letter (`'A'`–`'Z'`).
- Known digits (`Digit0`–`Digit9`) → digit character (`'0'`–`'9'`).
- Symbol keys → their printed character (e.g. `Minus` → `'-'`, `Slash` → `'/'`).
- Editing keys → labeled strings or Unicode (e.g. `Backspace` → `'⌫'`, `Delete` → `'Del'`).
- Arrow keys → Unicode arrows (`'↑'`, `'↓'`, `'←'`, `'→'`).
- Function keys → `'F1'`–`'F12'`.
- Numpad keys → `'Num0'`–`'Num9'`, `'Num+'`, `'Num-'`, `'Num*'`, `'Num/'`, `'Num.'`, `'Num⏎'`.
- Unknown code (not in `CODE_TO_LABEL`) → the raw `code` string is returned as-is.

---

### modLabel(mod)

**What**: Converts a modifier key name into its platform-appropriate display string.

**Params**:
- `mod` (string) — One of `'Alt'`, `'Control'`, `'Meta'`, `'Shift'`.

**Returns**: `string` — On Mac: Unicode glyph (`'⌥'`, `'⌃'`, `'⌘'`, `'⇧'`). On Windows/Linux: spelled-out name (`'Alt'`, `'Ctrl'`, `'Win'`, `'Shift'`). For any unknown modifier string, returns the string itself as fallback (both Mac and Win paths use `|| mod`).

**Side effects**: None.

**Handles**:
- `'Alt'` → `'⌥'` (Mac) or `'Alt'` (Win/Linux).
- `'Control'` → `'⌃'` (Mac) or `'Ctrl'` (Win/Linux).
- `'Meta'` → `'⌘'` (Mac) or `'Win'` (Win/Linux).
- `'Shift'` → `'⇧'` (Mac) or `'Shift'` (Win/Linux).
- Unknown modifier → raw string (fallback passthrough).

---

### chordLabel(chord)

**What**: Renders a single chord object as a platform-appropriate human-readable display string.

**Params**:
- `chord` (object) — A chord in the shape `{ code: string, mods: string[] }`. `mods` is an array of modifier names; order within the array does not affect output (internally sorted by display order).

**Returns**: `string` — On Mac: modifier glyphs concatenated with the key label, no separator (e.g. `'⌥⇧B'`). On Windows/Linux: modifier names and key label joined by `'+'` (e.g. `'Alt+Shift+B'`). Returns `''` (empty string) if `chord` is falsy or `chord.code` is not a string.

**Side effects**: None.

**Handles**:
- `chord` is `null`, `undefined`, or lacks a string `code` → returns `''`.
- `chord.mods` is not an array or is absent → treated as `[]` (no modifiers); only the key label is rendered.
- Modifiers within `mods` are sorted by display order (`Control` → `Alt` → `Shift` → `Meta`) regardless of the input array order, so `{ code: 'KeyB', mods: ['Shift', 'Alt'] }` and `{ code: 'KeyB', mods: ['Alt', 'Shift'] }` produce the same label.
- Unknown modifier strings are passed through `modLabel` which returns them as-is.
- Unknown code strings are passed through `codeLabel` which returns them as-is.

---

### bindingLabel(binding)

**What**: Renders a full binding (an ordered array of chords representing a key sequence) as a single display string.

**Params**:
- `binding` (Array) — An array of chord objects `{ code, mods }`. Phase 1 always has exactly one entry. Phase 2 multi-chord sequences (e.g. `[{code:'KeyG'}, {code:'KeyI'}]`) render as space-separated chord labels.

**Returns**: `string` — Chord labels joined by a single space. Single chord: same as `chordLabel`. Empty or non-array input → `''`.

**Side effects**: None.

**Handles**:
- `binding` is not an array → returns `''`.
- `binding` is an empty array → returns `''`.
- Individual chord objects that fail `chordLabel` validation → `chordLabel` returns `''` for those entries, so they appear as empty strings in the join. In practice this only occurs for malformed entries.

---

### chordKey(chord)

**What**: Produces a canonical string key for a chord, suitable for conflict-detection map lookups and equality comparisons. Two chords with the same logical modifiers and code always produce the same key regardless of modifier order in the input.

**Params**:
- `chord` (object) — A chord in the shape `{ code: string, mods: string[] }`.

**Returns**: `string` — Format: `"<sorted mods joined by '+'>|<code>"`. Examples: `"Alt+Shift|KeyB"`, `"Control|KeyT"`, `"|F5"` (no mods → empty string before `|`). Returns `''` if `chord` is falsy or `chord.code` is not a string.

**Side effects**: None.

**Handles**:
- `chord` is falsy or `chord.code` is not a string → returns `''`.
- `chord.mods` is not an array → treated as `[]`; key is `"|<code>"`.
- Modifiers are sorted alphabetically (not by display order) — `['Shift', 'Alt']` and `['Alt', 'Shift']` both produce `"Alt+Shift|KeyB"`. This is intentional: `chordKey` is used for identity/conflict detection, not rendering.
- `RESERVED` entries use the same format: `'Control|KeyT'`, `'Control+Shift|KeyT'`, `'|F5'`.

---

### bindingKey(binding)

**What**: Produces a canonical string key for a full multi-chord binding, for conflict-detection across sequences.

**Params**:
- `binding` (Array) — An array of chord objects.

**Returns**: `string` — Chord keys joined by a single space. For a single-chord binding, equals `chordKey(binding[0])`. Returns `''` if `binding` is not an array.

**Side effects**: None.

**Handles**:
- `binding` is not an array → returns `''`.
- Empty array → returns `''` (all chord keys are empty strings joined by spaces, but `.map` over empty array = `[]` → `join(' ')` = `''`).
- Malformed chord entries within a valid array → `chordKey` returns `''` for those; they appear as empty-string segments in the join.

---

### isReserved(chord)

**What**: Returns whether a chord is in the browser/OS reserved chord list for the current platform.

**Params**:
- `chord` (object) — A chord in the shape `{ code: string, mods: string[] }`.

**Returns**: `boolean` — `true` if `lookup(chord)` returns a non-null entry; `false` otherwise.

**Side effects**: None.

**Handles**:
- Delegates entirely to `lookup(chord)` and coerces the result to boolean.
- Platform filtering is applied: `'mac'` entries only match on Mac; `'win'` entries only match on non-Mac; `'any'` entries always match.
- Not a deny list — the capture UI uses this for warning display only; saving a reserved chord is always allowed.

---

### lookup(chord)

**What**: Finds the first `RESERVED` entry matching a chord on the current platform and returns its metadata.

**Params**:
- `chord` (object) — A chord in the shape `{ code: string, mods: string[] }`.

**Returns**: `{ label: string } | null` — `{ label }` if a matching reserved entry is found for the current platform; `null` if no match.

**Side effects**: None.

**Handles**:
- Computes `chordKey(chord)` first; if the key is empty (malformed chord), no entry can match → returns `null`.
- Iterates `RESERVED` in order; returns on first match (no two entries share the same key+platform combination).
- Platform filtering:
  - `platform === 'any'` → always matches regardless of `IS_MAC`.
  - `platform === 'mac'` → matches only when `IS_MAC === true`.
  - `platform === 'win'` → matches only when `IS_MAC === false`.

---

## Constants / Data

### IS_MAC

`boolean` — Computed once at module load by testing `navigator.platform` or `navigator.userAgent` against `/Mac|iPhone|iPad|iPod/i`. `false` if `navigator` is unavailable (e.g. service worker context) — the detection is wrapped in a try/catch. Used by `modLabel`, `chordLabel`, `lookup`, and `isReserved` to branch between Mac and Windows/Linux rendering.

---

### CODE_TO_LABEL

`Object` (frozen) — A map from `KeyboardEvent.code` strings to human-readable label strings. Covers:
- Letters: `KeyA`–`KeyZ` → `'A'`–`'Z'`.
- Digits: `Digit0`–`Digit9` → `'0'`–`'9'`.
- Symbols: `Minus`, `Equal`, `BracketLeft`, `BracketRight`, `Semicolon`, `Quote`, `Comma`, `Period`, `Slash`, `Backquote`, `Backslash`, `IntlBackslash`, `IntlRo`, `IntlYen`.
- Editing: `Enter`, `Escape`, `Tab`, `Space`, `Backspace` (`'⌫'`), `Delete` (`'Del'`), `Insert` (`'Ins'`).
- Navigation: `ArrowUp` (`'↑'`), `ArrowDown` (`'↓'`), `ArrowLeft` (`'←'`), `ArrowRight` (`'→'`), `Home`, `End`, `PageUp` (`'PgUp'`), `PageDown` (`'PgDn'`).
- Function keys: `F1`–`F12`.
- Numpad: `Numpad0`–`Numpad9`, `NumpadAdd` (`'Num+'`), `NumpadSubtract` (`'Num-'`), `NumpadMultiply` (`'Num*'`), `NumpadDivide` (`'Num/'`), `NumpadDecimal` (`'Num.'`), `NumpadEnter` (`'Num⏎'`).

Any code absent from the map falls back to the raw `code` string in `codeLabel`.

---

### RESERVED

`Array` (frozen) — A curated list of ~14 chord entries that browsers or the host OS typically intercept before extension keydown handlers run. Each entry has the shape:

```js
{ key: string, label: string, platform: 'any' | 'mac' | 'win' }
```

- `key`: the canonical chord key string in the same format as `chordKey()` (e.g. `'Control|KeyT'`, `'|F5'`, `'Meta|KeyQ'`).
- `label`: a short human-readable description (e.g. `'New tab'`, `'Quit application'`).
- `platform`: `'any'` matches all platforms; `'mac'` matches Mac only; `'win'` matches Windows/Linux only.

Current entries (as of implementation):

| key | label | platform |
|---|---|---|
| `Control\|KeyT` | New tab | any |
| `Control\|KeyN` | New window | any |
| `Control\|KeyW` | Close tab | any |
| `Control\|Tab` | Next tab | any |
| `Control+Shift\|KeyT` | Reopen closed tab | any |
| `Control+Shift\|KeyN` | Incognito window | any |
| `\|F5` | Reload | any |
| `\|F11` | Fullscreen | any |
| `\|F12` | DevTools | any |
| `Alt\|F4` | Close window | win |
| `Meta\|KeyQ` | Quit application | mac |
| `Meta\|KeyW` | Close window | mac |
| `Meta\|KeyM` | Minimize window | mac |
| `Meta\|KeyH` | Hide application | mac |

This is a hint list only — not a deny list. The capture UI shows a warning when `isReserved` returns `true` but always permits saving.

---

## Internal Helpers (not exported)

### sortModsForDisplay(mods)

Orders the `mods` array for rendering according to `MOD_ORDER = ['Control', 'Alt', 'Shift', 'Meta']`. Returns a new array containing only recognized modifiers in that canonical display order. Unknown modifier strings in `mods` are dropped by the filter (they appear in the raw `code` position via the `|| mod` fallback in `modLabel`).

---

## Invariants

- `IS_MAC` is determined once at module load; it never changes for the lifetime of the page.
- `chordKey` is the canonical identity function for chords. Two chords are logically identical if and only if their `chordKey` outputs are equal (same physical key, same set of modifiers regardless of order).
- `chordLabel` and `chordKey` use different sort orders for modifiers: `chordLabel` sorts by display convention (`Control → Alt → Shift → Meta`); `chordKey` sorts alphabetically. Both orders are consistent and deterministic.
- `CODE_TO_LABEL` and `RESERVED` are frozen — never mutated at runtime.
- All public functions are pure — no mutations, no I/O, no exceptions propagate to callers.
- `isReserved` is warning-only. No public API in this module refuses to process or return a value for reserved chords.
- The module depends only on `blsi` namespace for load-order tracking (it uses no `blsi.*` methods internally beyond the namespace assignment at the end). It must load after `constants.js` so `blsi` exists, but it reads nothing from `blsi.*` at module body time.
