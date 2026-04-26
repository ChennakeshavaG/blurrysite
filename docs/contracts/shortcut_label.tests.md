# shortcut_label Test Contract

## Overview

Unit tests for `src/shortcut_label.js` (`blsi.ShortcutLabel`). The module provides platform-aware human-readable rendering of keyboard shortcuts and canonical key forms for conflict detection.

Public API tested:
- `codeLabel(code)` — maps `KeyboardEvent.code` strings to display strings.
- `modLabel(mod)` — maps modifier name to platform-aware glyph or text.
- `chordLabel(chord)` — renders a full `{ code, mods }` chord for display.
- `bindingLabel(binding)` — renders an array of chords (multi-chord binding).
- `chordKey(chord)` — returns a canonical string for conflict detection.
- `bindingKey(binding)` — canonical form for a multi-chord binding.
- `IS_MAC` — boolean set at module load from `navigator.platform`.

The module is loaded by `tests/setup.js`; no per-file load guard is needed.

---

## Setup & Teardown

- No `beforeEach` / `afterEach` hooks in this file.
- `IS_MAC` is computed once at module load from `navigator.platform`; tests branch on it rather than forcing a value.
- `jest.clearAllMocks()` runs globally between tests via `tests/setup.js`.

---

## Test Groups

### blsi.ShortcutLabel (top-level exposure)

- `is exposed as blsi.ShortcutLabel` — the namespace exists; `codeLabel`, `modLabel`, `chordLabel`, `bindingLabel`, `chordKey`, `bindingKey` are all `'function'`.

### codeLabel

- `letters: KeyA → "A", KeyZ → "Z"` — letter codes strip the `Key` prefix.
- `digits: Digit0 → "0", Digit9 → "9"` — digit codes strip the `Digit` prefix.
- `symbols: Minus, Equal, BracketLeft, Slash` — map to `-`, `=`, `[`, `/`.
- `named keys: Enter, Escape, Tab, Space` — map to `'Enter'`, `'Esc'`, `'Tab'`, `'Space'`.
- `arrow keys: Unicode glyphs` — `ArrowUp→'↑'`, `ArrowDown→'↓'`, `ArrowLeft→'←'`, `ArrowRight→'→'`.
- `function keys: F1..F12` — `F1→'F1'`, `F12→'F12'` (pass-through).
- `numpad: NumpadEnter` — maps to `'Num⏎'`.
- `unknown code falls back to the code string` — `'MediaTrackNext'` returns `'MediaTrackNext'`.

### modLabel and chord rendering — platform-aware

- `modLabel returns something for each core modifier` — `'Alt'`, `'Control'`, `'Shift'`, `'Meta'` each return a truthy value.
- `chordLabel: Alt+Shift+B renders as expected for the active platform` — on Mac: `'⌥⇧B'`; on Windows/Linux: `'Alt+Shift+B'`.
- `chordLabel: single modifier chord` — `{code:'KeyK', mods:['Control']}` → Mac: `'⌃K'`; other: `'Ctrl+K'`.
- `chordLabel: empty mods renders just the code` — `{code:'Enter', mods:[]}` → `'Enter'`.
- `chordLabel: handles missing input gracefully` — `null` → `''`; `{}` (no code, no mods) → `''`.

### bindingLabel

- `single-chord binding matches chordLabel` — `bindingLabel([chord])` equals `chordLabel(chord)`.
- `multi-chord binding is space-separated` — two-chord binding produces a string with exactly 2 space-separated segments.
- `empty binding returns empty string` — `[]` and `null` both return `''`.

### chordKey — canonical form for conflict detection

- `produces identical keys regardless of input mod order` — `['Alt','Shift']` and `['Shift','Alt']` yield the same `chordKey`.
- `distinguishes different codes` — `{code:'KeyB', mods:['Alt']}` and `{code:'KeyC', mods:['Alt']}` produce different keys.
- `distinguishes different mod sets` — `{code:'KeyB', mods:['Alt']}` and `{code:'KeyB', mods:['Alt','Shift']}` produce different keys.
- `format is "<sorted mods joined by +>|<code>"` — `{code:'KeyB', mods:['Shift','Alt']}` → `'Alt+Shift|KeyB'` (mods sorted alphabetically).

### bindingKey — canonical form for multi-chord conflict detection

- `joins chord keys with a space` — two-chord binding `[{code:'KeyG', mods:['Alt']}, {code:'KeyI', mods:['Alt']}]` → `'Alt|KeyG Alt|KeyI'`.
- `empty array → empty string` — `[]` returns `''`.

---

## Edge Cases Covered

- `chordLabel(null)` and `chordLabel({})` must return `''` without throwing.
- `bindingLabel([])` and `bindingLabel(null)` must return `''` without throwing.
- `bindingKey([])` returns `''`.
- Mod order is normalised before forming `chordKey` — callers need not sort mods.
- Unknown key code falls back to the raw code string rather than throwing.
- Platform branch (`IS_MAC`) tested in-situ without forcing a module reload.

---

## Coverage Gaps

The test file itself annotates the following missing coverage (preserved here verbatim):

- `modLabel` is only asserted `toBeTruthy()` — no assertion on the exact glyph (`⌘⇧⌥⌃`) for Mac or exact spelled-out text (`Ctrl`/`Shift`/`Alt`/`Win`) for Windows/Linux.
- No test that `chordLabel` respects a stable mod display order (`sortModsForDisplay` contract) — e.g. `Ctrl` before `Shift` before `Alt` on non-Mac.
- Only `NumpadEnter` is tested from the numpad table; `Numpad0`–`Numpad9`, `NumpadAdd`, `NumpadSubtract`, `NumpadMultiply`, `NumpadDivide`, `NumpadDecimal` have no coverage.
- No test for an unknown/unsupported modifier string (e.g. `'Hyper'`) passed to `modLabel()` — fallback behaviour is unspecified.
- The 7 `codeLabel` describe tests are structurally identical and could be collapsed into a single `test.each` table (noted as optimisation, not a missing behaviour).
- `distinguishes different codes` and `distinguishes different mod sets` are structurally redundant — both assert `not.toBe` on `chordKey`; could be a single `test.each`.
