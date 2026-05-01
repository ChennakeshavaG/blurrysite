# automate/state.tests Contract

## Overview

Unit-test suite for `src/automate/state.js`. Verifies the shared state surface
(`blsi.Automate.State`) used by the automate module family — phase enum
constants, storage key constants, read/write helpers, the `chrome.storage.onChanged`-
backed cache, and the multi-subscriber `on_change` registry.

The suite reloads the module per test via `jest.resetModules()` + `require()` so
each test starts from a clean cache. It uses the `chrome.storage` and
`chrome.storage.onChanged` mocks set up in `tests/setup.js`. The shared
`global._fireStorageChanged(changes, area)` helper fires captured listeners.

## Describe groups

### `PHASES + KEYS shape`
Asserts the public constants are correct + immutable.
- `PHASES.idle` exposes the three `chrome.idle.IdleState` literals.
- `PHASES.tab_switch` exposes `off / armed / fired`.
- `KEYS` exposes the four `chrome.storage.session` key names.
- The exported `State`, `PHASES`, `PHASES.idle`, `PHASES.tab_switch`, and `KEYS`
  are all frozen.

### `read defaults`
Default values when nothing has been written.
- `read_idle()` → `'active'` before any write.
- `read_tab_switch(tab_id)` → `'off'` for unknown tab.
- `read_tab_switch(non_number)` → `'off'` for `string`, `null`, `undefined`.
- `read_all_tab_switch()` → `{}`.

### `write_idle`
- Successful write returns `true`, updates cache synchronously, calls
  `chrome.storage.session.set` with `{[KEYS.idle]: phase}`.
- Idempotency: writing the same value twice → second call returns `false`,
  no second storage write.
- Non-string input → no-op (returns `false`).

### `write_tab_switch`
- Successful write returns `true`, cache reflects new phase, `read_all_tab_switch`
  shows the entry.
- Writing `'off'` strips the entry from the cached map (so the map stays small).
- Writing `'off'` to a tab that has no entry is a no-op (no storage write).
- Idempotency: same phase twice → second call returns `false`, no second storage write.
- Non-number `tab_id` → no-op.
- Non-string `phase` → no-op.
- Two tabs maintained independently.
- The storage payload always replaces the entire map under `KEYS.tab_switch_by_tab`.
- `clear_tab_switch(tab_id)` behaves identically to `write_tab_switch(tab_id, 'off')`.

### `on_change subscribers`
Verifies the multi-subscriber registry and the `chrome.storage.onChanged` listener.
- A real cache transition for `KEYS.idle` fires every subscriber with
  `(key, oldValue, newValue)`.
- A "transition" where `newValue` equals the cached value does NOT fire.
- A real cache transition for `KEYS.tab_switch_by_tab` fires subscribers with the
  new map.
- `area !== 'session'` is filtered — non-session changes do not fire subscribers.
- Multiple subscribers all fire on a single transition.
- An exception thrown by one subscriber does not block other subscribers.
- The unsubscribe function removes only that subscriber.
- Passing a non-function to `on_change` returns a no-op unsubscribe (does not throw).

### `_reset`
- Clears `_idle_cache`, the per-tab map, and the subscriber registry.
- Does NOT call `chrome.storage.session.set`.
- After `_reset`, previously-registered listeners no longer fire.

## Edge cases covered

- Non-string / non-number arguments to all write helpers are silently rejected
  (`Promise<false>` resolution).
- `'off'`-on-absent-key path is a no-op so the storage layer doesn't churn on
  redundant clears.
- Multiple subscribers + one throwing — registry remains healthy.
- Same-value transitions don't fire subscribers (matches contract: real
  transitions only).

## Known gaps

- No test for the asynchronous `_hydrate()` path — relies on the default
  `chrome.storage.session.get` mock returning `{}`. A future test could stub
  `get` to return seeded values and assert `read_idle()` / `read_all_tab_switch()`
  reflect them after a microtask.
- No test for racing writes (cache update ordering when two `write_idle()` calls
  resolve out of order). Acceptable — `chrome.storage.session.set` is sequenced
  by the runtime.
- No test for `chrome` being entirely undefined (in-memory-only fallback). The
  jsdom + setup.js environment always provides the stub; the fallback path is
  exercised manually only.

## Test count

29 tests in 6 describe groups.
