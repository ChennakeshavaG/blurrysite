# automate/visibility.tests Contract

## Overview

Unit-test suite for `src/automate/visibility.js`. Verifies the per-tab Page
Lifecycle observer (`blsi.Automate.Visibility`) — listener registration on
`document` and `window`, the `armed` / `fired` derivation from
`document.visibilityState` + `document.hasFocus()`, init re-binding when
`tab_id` changes, and the `clear_tab_switch` write on destroy.

The suite reloads `state.js` and then `visibility.js` per test
(`jest.resetModules()` + require). It manipulates `document.visibilityState`
via `Object.defineProperty(document, 'visibilityState', { value, configurable })`
and `document.hasFocus` via `Object.defineProperty(document, 'hasFocus', { value: () => bool })`.
Events are dispatched via `document.dispatchEvent(new Event('visibilitychange'))`
and `window.dispatchEvent(new Event('focus'/'blur'))`.

## Describe groups

### `init`
- `init({tab_id: 1})` on a visible+focused tab does NOT write to State
  (absence === armed). `State.read_tab_switch(1)` reports `'off'`.
- `init({tab_id: 1})` on a hidden tab seeds the `fired` entry.
- `init` without a numeric `tab_id` is a no-op (no listener registered, no
  storage write).
- Re-init with the same `tab_id` does not duplicate listeners (idempotent).
- Re-init with a different `tab_id` calls `destroy()` first (clears prior tab's
  entry) then attaches fresh listeners.

### `phase derivation`
- `visibilityState === 'hidden'` → `fired`.
- `visibilityState === 'visible'` AND `document.hasFocus() === true` → `armed`.
- `visibilityState === 'visible'` AND `document.hasFocus() === false` → `fired`.
- A `visibilitychange` event reflecting `'hidden'` causes a `write_tab_switch(id, 'fired')`.
- A `window.blur` event causes a `write_tab_switch(id, 'fired')`.
- A `window.focus` event after blur strips the entry (back to absent === armed).
- Same-phase events are absorbed (idempotency at the State layer).

### `destroy`
- `destroy()` on a `fired` tab strips the entry from the per-tab map (one write
  with the smaller map).
- `destroy()` on an `armed` (absent) tab does NOT issue a storage write — the
  underlying `write_tab_switch('off', tab)` is idempotent for absent entries.
- `destroy()` removes all three event listeners — events after destroy do not
  write.

## Edge cases covered

- Init without a `tab_id` is silently rejected.
- Re-init with the same id avoids listener duplication.
- Re-init with a different id cleans up the old id's entry.
- jsdom default `visibilityState` is `'visible'`; tests override before init.

## Known gaps

- No test for an environment where `document` is undefined (the module guards
  but we cannot easily simulate it under jsdom).
- No test for cross-window-blur write storms (write absorption is verified at
  `state` layer; visibility relies on `state`'s idempotency).

## Test count

13 tests in 3 describe groups.
