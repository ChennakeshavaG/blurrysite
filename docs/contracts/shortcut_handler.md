# shortcut_handler Contract

## Overview

Pure keyboard matcher. Matches user-configurable shortcuts against `KeyboardEvent` and fires action callbacks. All action metadata (labels, default bindings, `chrome.commands` ids) lives in `action_registry.js` — this module only matches events. Toast rendering is delegated to `blsi.Toast` (see `docs/contracts/toast.md`). Phase 1 only matches single-chord bindings (`binding.length === 1`); multi-chord bindings are silently skipped with a logger warning.

## Module State

| Variable | Description |
|---|---|
| `activeKeydownListener` | `Function\|null` — bound keydown handler (for cleanup) |
| `activeBlurListener` | `Function\|null` — bound window blur handler (for cleanup) |
| `_isPickerActive` | `boolean` — whether picker is active (controls Escape behavior) |
| `registeredShortcuts` | `Array<{actionId, code, mods, bindingKey}>` — normalized single-chord shortcuts |
| `registeredCallbacks` | `Object` — `{ ACTION_ID: fn, onExitPicker: fn }` |
| `FIRE_TOKEN` | `globalThis.__blsiShortcutFire` — shared monotonic fire token for dedup |

## Public API

### init(shortcuts, callbacks)

**What**: Registers keyboard listeners and builds the normalized shortcut list. Calls `destroy()` first — safe to call multiple times.
**Params**:
- `shortcuts` (object) — `{ 'action-id': { binding: [{code, mods}] } }` (kebab-case action ids)
- `callbacks` (object) — `{ 'action-id': fn, onExitPicker: fn }`
**Returns**: `void`
**Side effects**:
- Registers `document.addEventListener('keydown', onKeyDown, true)` (capture phase)
- Registers `window.addEventListener('blur', onWindowBlur)`
- Builds `registeredShortcuts` array (multi-chord bindings skipped with logger warning)
- On match: calls `blsi.Toast.show("Blurry Site — <label>", 3000)` for the matched action — short 3s feedback toast.
**Handles**: Multi-chord bindings (`binding.length > 1`) → warned and skipped; invalid entry shapes → skipped; null/undefined shortcuts → no-op; missing `blsi.Toast` → fire/preventDefault still happen, only the toast is skipped.

**Early-exit guards in `onKeyDown`** (checked in order):
1. `event.repeat` — key held down
2. `event.isComposing` — IME composition in progress
3. `event.key === 'Dead'` — combining dead key
4. `event.key === 'Process'` — IME processing
5. `event.key === 'Unidentified'` — browser couldn't identify key
6. `event.getModifierState('AltGraph')` — AltGr / right-Alt on European keyboards (would cause false positive with `Alt+Ctrl` combos)
7. `event.code === 'Escape'` — special-cased: fires `onExitPicker` if picker active; never dispatched to bound shortcuts
8. `blsi.modifier_codes.has(event.code)` — pure-modifier keydown; wait for primary key

### destroy()

**What**: Removes all listeners, clears shortcut/callback registrations, asks `blsi.Toast` to drop any non-persistent live toast.
**Params**: none
**Returns**: `void`
**Side effects**: Removes keydown (capture) and blur listeners; clears `registeredShortcuts`, `registeredCallbacks`; calls `blsi.Toast.clearIfTransient()` so persistent toasts (e.g. screen-share) survive teardown.
**Handles**: Idempotent — no-op if already destroyed; missing `blsi.Toast` is tolerated.

### _setPickerActive(v)

**What**: Updates the picker-active flag for Escape key handling.
**Params**: `v` (boolean)
**Returns**: `void`
**Side effects**: Sets `_isPickerActive = !!v`
**Called by**: `content_script.setPickerActive()` — always call through that helper, never directly.

### _getFireToken()

**What**: Returns the shared fire-token object for dedup between the JS shortcut path and `chrome.commands` relays.
**Params**: none
**Returns**: `globalThis.__blsiShortcutFire` — `{ [actionId]: number }` map of last fire timestamps
**Note**: The fire token is stamped by `content_script.handleMessage` (NOT here) to avoid stamping before the callback re-enters `handleMessage`. `content_script.handleMessage` uses a 500ms window to drop duplicate chrome.commands relays.

## Internal Functions

### modsFromEvent(event)

**What**: Extracts the normalized modifier set from a KeyboardEvent.
**Returns**: `string[]` — sorted subset of `['Alt', 'Control', 'Meta', 'Shift']`
**Critical**: Reads from `event.altKey/ctrlKey/metaKey/shiftKey` — side-agnostic (folds AltLeft/AltRight together). Array is pre-sorted because pushes are in alphabetical order.

### sameModSet(a, b)

**What**: Compares two sorted modifier arrays for equality.
**Returns**: `boolean`

## Invariants

- All listeners registered at **capture phase** (`addEventListener(_, _, true)`) — fires before target/bubble handlers so `preventDefault()` is effective for links and buttons.
- `Escape` NEVER dispatches to a bound shortcut — only to `onExitPicker`.
- `FIRE_TOKEN` is stamped by `handleMessage`, NOT inside `onKeyDown` — avoids self-dedup where the fresh stamp would cause the message handler to drop its own call.
- Toast rendering is delegated to `blsi.Toast` — this module owns no toast DOM, no toast lifecycle. See `docs/contracts/toast.md` for the toast surface.
- `_isPickerActive` is updated only through `_setPickerActive()` — always called via `content_script.setPickerActive()`.
- Multi-chord bindings (`binding.length > 1`) are reserved for Phase 2 — silently skipped in Phase 1 with a logger warning.
