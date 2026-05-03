# shortcut_handler Contract

## Overview

Pure keyboard matcher + toast renderer. Matches user-configurable shortcuts against `KeyboardEvent` and fires action callbacks. All action metadata (labels, default bindings, `chrome.commands` ids) lives in `action_registry.js` — this module only matches events and renders toasts. Phase 1 only matches single-chord bindings (`binding.length === 1`); multi-chord bindings are silently skipped with a logger warning.

## Module State

| Variable | Description |
|---|---|
| `activeKeydownListener` | `Function\|null` — bound keydown handler (for cleanup) |
| `activeBlurListener` | `Function\|null` — bound window blur handler (for cleanup) |
| `currentToastEl` | `HTMLElement\|null` — current toast element |
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
**Handles**: Multi-chord bindings (`binding.length > 1`) → warned and skipped; invalid entry shapes → skipped; null/undefined shortcuts → no-op.

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

**What**: Removes all listeners, clears shortcut/callback registrations, removes current non-persistent toast.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Removes keydown (capture) and blur listeners; clears `registeredShortcuts`, `registeredCallbacks`; removes `currentToastEl` from DOM only if it is not persistent (persistent toasts survive `destroy()` so they are preserved across `init()` re-initialization cycles triggered by storage changes).  
**Handles**: Idempotent — no-op if already destroyed.

### showToast(text, duration?, actions?, opts?)

**What**: Shows a floating notification toast at the bottom of the page.  
**Params**:
- `text` (string) — main message text
- `duration` (number, optional) — milliseconds before auto-dismiss (default: 15000)
- `actions` (Array<{label, onClick, variant?, tooltip?}>, optional) — action buttons in a second row. `tooltip` sets `data-tooltip` on the button (CSS `::after` pseudo-element tooltip via `content.css`, not native `title` — immune to viewport overlay interference).
- `opts` ({persistent?: boolean}, optional) — when `persistent` is truthy: skips the auto-dismiss timer (toast stays until user clicks close or an action button) and blocks replacement by subsequent non-persistent toasts.  
**Returns**: `void`  
**Side effects**:
- Removes and replaces any existing non-persistent toast (one at a time)
- A persistent toast cannot be replaced by another `showToast` call — the new call is silently dropped
- Appends `<div class="bl-si-toast" role="status" aria-live="polite">` to `document.body`
- Close button `aria-label` is resolved via `chrome.i18n.getMessage('aria_toast_dismiss')` with English fallback `'Dismiss'`
- `actions` with `variant: 'warn'` renders with amber styling  
**Handles**: Replaces existing non-persistent toast synchronously; action items with missing `label` or non-function `onClick` are skipped; `chrome.runtime.getURL` guarded for test environments.

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

### dismissToast()

**What**: Dismisses the current toast (including persistent toasts). No-op if no toast is showing.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Delegates to `_dismissToast(currentToastEl)` — animates out and removes.

### _dismissToast(toast)

**What**: Animates out and removes a toast element.  
**Side effects**: Adds `bl-si-toast--exiting` class, removes after 250ms; clears `currentToastEl` if it matched.

## Invariants

- All listeners registered at **capture phase** (`addEventListener(_, _, true)`) — fires before target/bubble handlers so `preventDefault()` is effective for links and buttons.
- `Escape` NEVER dispatches to a bound shortcut — only to `onExitPicker`.
- `FIRE_TOKEN` is stamped by `handleMessage`, NOT inside `onKeyDown` — avoids self-dedup where the fresh stamp would cause the message handler to drop its own call.
- Only one toast visible at a time — `showToast` replaces existing toast synchronously, unless the current toast is persistent (replacement silently dropped).
- `_isPickerActive` is updated only through `_setPickerActive()` — always called via `content_script.setPickerActive()`.
- Multi-chord bindings (`binding.length > 1`) are reserved for Phase 2 — silently skipped in Phase 1 with a logger warning.
