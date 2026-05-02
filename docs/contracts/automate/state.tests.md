# automate/state.tests Contract

## Overview

Unit-test suite for `src/automate/state.js`. Verifies the shared state surface
(`blsi.Automate.State`) used by the automate module family — phase enum
constants, storage key constants, read/write helpers, and the
`chrome.storage.onChanged`-backed cache.

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

### `onChanged listener`
Verifies the `chrome.storage.onChanged` listener that keeps the cache in sync
across contexts.
- A cross-context write to `KEYS.idle` updates the cached idle phase.
- A same-value `onChanged` event leaves the cache unchanged (no spurious churn).
- A cross-context write to `KEYS.tab_switch_by_tab` updates the per-tab map.
- A non-object `newValue` for the per-tab map (e.g. `undefined` after a clear)
  resets the cache to an empty map.
- `area !== 'session'` is filtered — non-session changes do not touch the cache.

### `_reset`
- Clears `_idle_cache` and the per-tab map.
- Does NOT call `chrome.storage.session.set`.

## Edge cases covered

- Non-string / non-number arguments to all write helpers are silently rejected
  (`Promise<false>` resolution).
- `'off'`-on-absent-key path is a no-op so the storage layer doesn't churn on
  redundant clears.
- Same-value `onChanged` events leave the cache untouched.
- Non-object `newValue` for the per-tab map is tolerated.

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

26 tests in 6 describe groups.
