# shortcut_reserved Test Contract

## Overview

Unit tests for the reserved chord API that lives on `blsi.ShortcutLabel` (formerly a separate `src/shortcut_reserved.js` module; now merged into `src/shortcut_label.js`).

The reserved API lets the settings UI warn users when they try to bind a chord already claimed by the browser or OS.

Public API tested:
- `blsi.ShortcutLabel.RESERVED` — frozen array of `{ key, label, platform }` entries.
- `blsi.ShortcutLabel.isReserved(chord)` — returns `true` if the chord matches a reserved entry for the current platform.
- `blsi.ShortcutLabel.lookup(chord)` — returns the matching `{ label }` entry or `null`.
- `blsi.ShortcutLabel.IS_MAC` — boolean used by platform-conditional entries.

The module is loaded by `tests/setup.js`; no per-file load guard is needed.

---

## Setup & Teardown

- No `beforeEach` / `afterEach` hooks in this file.
- `IS_MAC` is computed once at module load from `navigator.platform`; tests branch on it where platform-conditional entries are exercised.
- `jest.clearAllMocks()` runs globally between tests via `tests/setup.js`.

---

## Test Groups

### blsi.ShortcutLabel reserved API (top-level exposure)

- `RESERVED, isReserved, lookup exposed on blsi.ShortcutLabel` — `isReserved` and `lookup` are functions; `RESERVED` is an array.

### Specific known-reserved chords

- `Ctrl+T is reserved — lookup returns label matching /tab/i` — `lookup({ code:'KeyT', mods:['Control'] })` returns a non-null entry whose `label` matches the pattern `/tab/i`.

### Cross-platform reserved chords (test.each)

Each of the following is asserted `isReserved(chord) === true` on all platforms (`platform: 'any'` entries):

| Label | Chord |
|---|---|
| `Ctrl+N` | `{ code:'KeyN', mods:['Control'] }` |
| `Ctrl+W` | `{ code:'KeyW', mods:['Control'] }` |
| `Ctrl+Tab` | `{ code:'Tab', mods:['Control'] }` |
| `Ctrl+Shift+T` | `{ code:'KeyT', mods:['Control','Shift'] }` |
| `Ctrl+Shift+N` | `{ code:'KeyN', mods:['Control','Shift'] }` |
| `F5` | `{ code:'F5', mods:[] }` |
| `F11` | `{ code:'F11', mods:[] }` |
| `F12` | `{ code:'F12', mods:[] }` |

### Non-reserved chords

- `custom bindings are not reserved` — `{code:'KeyB', mods:['Alt','Shift']}` and `{code:'KeyK', mods:['Control','Shift']}` both return `false`.
- `lookup returns null for non-reserved chords` — `{code:'KeyQ', mods:['Alt','Shift']}` returns `null`.

### Defensive / null input guards

- `isReserved(null) returns false without throwing` — no exception; returns `false`.
- `lookup(undefined) returns null without throwing` — no exception; returns `null`.

### Mod-order agnosticism

- `mod-order agnostic: [Shift, Control] treated same as [Control, Shift]` — `isReserved` produces the same boolean regardless of the order mods appear in the input array.

### Platform-conditional entry

- `platform-conditional entry: Meta+Q fires only on Mac` — when `IS_MAC` is `true`, `{code:'KeyQ', mods:['Meta']}` is reserved; when `IS_MAC` is `false`, it is not.

### Immutability

- `RESERVED entries are frozen` — `Object.isFrozen(blsi.ShortcutLabel.RESERVED)` is `true`.

---

## Edge Cases Covered

- `Ctrl+Shift+T` (reopen tab) and `Ctrl+Shift+N` (incognito) both covered as cross-platform reserved.
- Function keys without modifiers (`F5`, `F11`, `F12`) treated as reserved.
- `isReserved` is mod-order agnostic — normalisation happens internally.
- `Meta+Q` (Quit on Mac) exercises platform-conditional filtering.
- Null and undefined inputs handled gracefully by both `isReserved` and `lookup`.

---

## Coverage Gaps

The test file itself annotates the following missing coverage (preserved here verbatim):

- No test that each `RESERVED` entry has the required shape `{ key, label, platform }` — structural validation of the array contents.
- Only 8 of the 13+ `RESERVED` entries are exercised by positive `isReserved` tests; the remainder go untested.
- No dedicated test for `isReserved(null)` and `isReserved(undefined)` as distinct cases — only `null` is tested; `undefined` is only tested via `lookup`.
- No test for `lookup(null)` — only `lookup(undefined)` is tested.
- No test for a `platform: 'win'`-only entry to verify it is NOT reserved on Mac (the inverse of the Mac+Q test).
- No test verifying that the `RESERVED` array is non-empty (length > 0).
- No test for a chord that partially matches a reserved entry (e.g. same code, different mods) returning `false` — confirming that both code and mods must match.
