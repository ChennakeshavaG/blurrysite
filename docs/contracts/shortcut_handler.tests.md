# shortcut_handler Test Contract

## Overview

Tests for `src/shortcut_handler.js` (`blsi.Shortcuts`, v2 matcher). The module
listens for `keydown` events on `document` and dispatches registered callbacks when
a matching chord is pressed. Tests verify happy-path dispatch for all default
bindings, modifier matching semantics (exact set, side-agnostic), early-return guards
for noisy key events, Escape routing to the picker-exit callback, fire-token
exposure, and lifecycle (destroy / re-init / edge input handling).

Unlike other test files this one has no stub fallback — `loadShortcutHandler()`
throws if `shortcut_handler.js` is absent, making the real file mandatory.

## Setup & Teardown

- `beforeAll`: calls `loadShortcutHandler()` which `require()`s the real file; throws
  if the file does not exist (no inline stub).
- `afterEach`: calls `blsi.Shortcuts.destroy()` to remove the document listener
  between tests.
- `fireKeyDown(opts)` helper: constructs and dispatches a `KeyboardEvent('keydown')`
  on `document` with configurable `key`, `code`, modifier booleans, `repeat`,
  `isComposing`, and an optional `altGraph` override that sets
  `event.getModifierState = fn` returning true for `'AltGraph'`.
- `DEFAULT_SHORTCUTS` constant: mirrors the action-registry defaults —
  `TOGGLE_BLUR_ALL → KeyB`, `TOGGLE_PICKER → KeyP`, `CLEAR_ALL → KeyU`, all with
  `mods: ['Alt', 'Shift']`.

## Test Groups

### match

- `fires TOGGLE_BLUR_ALL on Alt+Shift+B` — callback receives exactly one call when Alt+Shift+B is fired.
- `fires TOGGLE_PICKER on Alt+Shift+P` — callback receives exactly one call when Alt+Shift+P is fired.
- `fires CLEAR_ALL on Alt+Shift+U` — callback receives exactly one call when Alt+Shift+U is fired.
- `supports Ctrl+Shift+K (single modifier class + shift)` — custom binding with `mods: ['Control', 'Shift']` fires correctly.
- `supports Meta+1 on Mac (metaKey)` — custom binding with `mods: ['Meta']` on `Digit1` fires correctly.
- `side-agnostic: AltRight fires the same binding as AltLeft` — `altKey: true` (regardless of physical side) matches the `'Alt'` mod; callback fires.
- `different chords fire different callbacks` — firing KeyB calls only `blur` callback; firing KeyP calls only `picker` callback; KeyU (unfired) callback is not called.

### no match

- `does not fire when required mod is missing` — Alt without Shift on KeyB: callback not called.
- `does not fire when an extra mod is present` — Alt+Shift+Ctrl on KeyB: extra modifier causes no match; callback not called.
- `does not fire when code does not match` — Alt+Shift on KeyC when binding is KeyB: callback not called.

### early-return guards

- `ignores repeat keydowns` — `repeat: true` prevents dispatch even on exact chord match.
- `ignores events during IME composition` — `isComposing: true` prevents dispatch.
- `ignores Dead key events` — `key: 'Dead'` is an early return.
- `ignores Process key events (IME)` — `key: 'Process'` is an early return.
- `ignores Unidentified key events` — `key: 'Unidentified'` is an early return.
- `ignores AltGraph events (European AltGr)` — when `getModifierState('AltGraph')` returns `true`, event is treated as AltGr composition and discarded.
- `ignores pure modifier keydowns (waits for non-modifier)` — pressing `Alt` then `Shift` alone (without a non-modifier key) does not fire any callback.

### Escape key

- `fires onExitPicker when picker is active` — after `_setPickerActive(true)`, `Escape` keydown fires the `onExitPicker` callback exactly once.
- `does NOT fire onExitPicker when picker is inactive` — after `_setPickerActive(false)`, `Escape` keydown does not call `onExitPicker`.
- `Escape does not dispatch to shortcut bindings` — even if a custom binding is registered for `Escape`, it is never fired (Escape is reserved for picker exit only).

### fire token

- `_getFireToken returns the shared globalThis map` — `blsi.Shortcuts._getFireToken()` returns the same reference as `globalThis.__blsiShortcutFire`.
- `matcher does not stamp the token (stamping moved to content_script)` — after a matched keypress fires a callback, `globalThis.__blsiShortcutFire['TOGGLE_BLUR_ALL']` is unchanged from its pre-keypress value (token stamping responsibility is in `content_script.js`).

### lifecycle

- `destroy removes listeners so shortcuts stop firing` — after `destroy()`, firing Alt+Shift+B does not invoke the registered callback.
- `re-calling init replaces previous listener` — second `init()` call replaces the first; only the second callback fires; the first callback is never called.
- `handles empty shortcuts object gracefully` — `init({}, {})` does not throw.
- `handles null shortcuts gracefully` — `init(null, {})` does not throw.
- `multi-chord bindings (length > 1) are skipped (phase 2)` — a binding with two chords (`[{code:'KeyG'}, {code:'KeyI'}]`) does not fire on a single keydown matching the first chord (phase-2 sequence matching not yet implemented).

## Edge Cases Covered

- Side-agnostic modifier matching: `altKey`, `ctrlKey`, `metaKey`, `shiftKey` booleans are used; `AltLeft` vs `AltRight` distinction is invisible to the matcher.
- AltGr detection: European keyboards that set `getModifierState('AltGraph')` are filtered out before modifier matching to prevent false positives.
- IME and dead-key filtering: `isComposing`, `key === 'Dead'`, `key === 'Process'`, `key === 'Unidentified'` all short-circuit before any chord comparison.
- Repeat suppression: held keys do not retrigger callbacks.
- Escape is a hard-reserved key for the picker-exit path and can never be bound to a custom action.
- Fire token is exposed for content_script dedup but the matcher itself no longer stamps it — avoids double-execution when both the JS keydown path and the `chrome.commands` relay fire for the same keypress.
- Multi-chord bindings are recognized as a phase-2 feature and are explicitly skipped (no partial-match firing).
- `null` and empty-object shortcuts input are accepted without error.

## Coverage Gaps

- No test that `event.defaultPrevented === true` after a matched shortcut fires (expected: `preventDefault()` is called on the matched event).
- `showToast()` is a public method with timer-based auto-dismiss logic that is entirely untested.
- No test for calling `destroy()` while a `showToast` animation/timer is still pending — potential timer leak risk.
- No test for `init()` called with a binding whose `chord.mods` is `undefined` (defensive path for malformed binding objects).
- No integration test confirming that `chrome.commands` relay stamping plus the JS keydown path together produce exactly one callback invocation — requires content_script involvement.
