# automate/idle.tests Contract

## Overview

Unit-test suite for `src/automate/idle.js`. Verifies the background-only
OS-level idle observer (`blsi.Automate.Idle`) — listener registration on
`chrome.idle.onStateChanged`, threshold seeding from `blsi_model`, hot-update
via `chrome.storage.onChanged`, clamping behaviour, and the relay into
`State.write_idle()`.

The suite reloads `state.js` and then `idle.js` per test (`jest.resetModules()`
+ require). It captures the registered idle listener via
`chrome.idle.onStateChanged.addListener.mockImplementation(fn => { capturedFn = fn })`.
It captures the `chrome.storage.onChanged` listener via the same
`_onChangedListeners` mechanism in `tests/setup.js`.

## Describe groups

### `init / destroy`
- `init()` registers a `chrome.idle.onStateChanged` listener.
- `init()` registers a `chrome.storage.onChanged` listener.
- `init()` is idempotent — second call is a no-op (no double-register).
- `init()` calls `chrome.storage.local.get('blsi_model', ...)` to seed the threshold.
- `init()` calls `chrome.idle.queryState(threshold, ...)` to seed the initial phase.
- `init()` is a no-op when `chrome.idle` is unavailable.
- `destroy()` removes both listeners.

### `idle state relay`
- When the idle listener fires with `'idle'`, calls `State.write_idle('idle')`.
- When the idle listener fires with `'locked'`, calls `State.write_idle('locked')`.
- When the idle listener fires with `'active'`, calls `State.write_idle('active')`.
- Non-string / unknown state values are ignored (no write).
- `getCurrentPhase()` reflects the most recent fired state.

### `setThreshold`
- Calls `chrome.idle.setDetectionInterval(seconds)` with the clamped value.
- Clamps below 15s up to 15s.
- Clamps above 3600s down to 3600s.
- Logs a `console.warn` when clamping occurs.
- Non-finite / non-number input is silently rejected.

### `model-driven hot update`
- A `blsi_model` change with a new `automate.settings.idle.value` updates the
  threshold via `setDetectionInterval`.
- Hot update converts `unit: 'min'` to seconds.
- Hot update accepts `unit: 'sec'` directly.
- A model change with no automate.idle change leaves the threshold untouched
  (no extra `setDetectionInterval` call).

## Edge cases covered

- `chrome.idle` unavailable → `init` is a no-op (graceful degrade).
- Unknown `state` strings (anything other than `active`/`idle`/`locked`) are ignored.
- Threshold clamping below floor (15s) and above ceiling (3600s).
- Storage onChanged for non-`blsi_model` keys is ignored.
- Storage onChanged for non-`local` areas is ignored.

## Known gaps

- No test for the `_seed_phase_from_query` callback flow with a non-string
  reply. `chrome.idle.queryState` is well-defined in real Chrome.
- No test for racing two near-simultaneous `setThreshold` calls. The chrome
  runtime sequences these.

## Test count

19 tests in 4 describe groups.
