# automate/manager.tests Contract

## Overview

Unit-test suite for `src/automate/manager.js`. Verifies the automate
orchestrator (`blsi.Automate.Manager`) — init/destroy lifecycle, Overlay
show/hide reactions to live state, master-switch gate, URL-change
re-evaluation, bootstrap evaluation on init.

The suite reloads `state.js`, `overlay.js`, `storage_model.js`, and
`manager.js` per test via `jest.resetModules()` + `require()` so each
test starts from a clean closure (uninitialized Manager, empty caches).

## Describe groups

### `init / destroy`
- `init` without `get_host_url` is a silent no-op (Manager cannot operate
  without a host source).
- `init` with valid params wires the storage subscriber. Default model
  (no automate triggers enabled) leaves the Overlay hidden.
- `destroy` hides the Overlay + flips `_initialized` so subsequent
  storage events do not flip the Overlay back on. Idempotent on uninit.
- `init` twice rebinds cleanly (calls `destroy` internally before
  re-binding) — no duplicate state.

### `Overlay control`
- Shows the Overlay when `automate_blur_active` becomes true via a
  tab_switch transition (`State.write_tab_switch + storage onChanged`).
- Hides the Overlay when `automate_blur_active` flips back to false on
  tab focus return.
- Master switch off (`global_default_settings.enabled === false`) keeps
  the Overlay hidden even when an automate trigger fires.
- Idle phase change (`State.write_idle('idle') + storage onChanged`)
  triggers Manager re-evaluation and Overlay show.

### `on_url_change`
- After SPA navigation, calling `Manager.on_url_change(host, url)`
  re-evaluates against the new path. With a wildcard rule
  `example.com/admin/*` disabling tab_switch, navigating from
  `/dashboard` to `/admin/users` flips the Overlay off.
- Calling `on_url_change` before `init` is a no-op.

### `transition toasts`
- Manager seeds tracking on `init` without firing toasts (so users aren't
  alerted about pre-existing state when a tab opens). Verified by writing
  `tab_switch[7]='fired'` to State *before* `Manager.init` and asserting
  `blsi.Toast.show` was not called during init's first `_evaluate`.
- Idle toast fires on transition `'active' → 'idle'` (storage event).
- Tab-switch toast fires on transition `'off' → 'fired'` (storage event).
- Idle toast still fires when manual blur is already active —
  manual blur and automate triggers are independent (Overlay layers on top).
- Master switch off (`global_default_settings.enabled === false`)
  suppresses all toasts even when triggers fire.
- Master switch flipped off **mid-share** dismisses the persistent
  screen-share toast: with `_last_ss_blurring === true`, an `enabled=false`
  storage change must call `blsi.Toast.dismiss()` (the falling-edge cleanup
  in `_fire_toasts` is unreachable on the `master_off` path, and the
  toast's own auto-dismiss is suppressed by `persistent: true`).
- `ss_stop_actions` callback is invoked when the screen-share toast fires;
  resulting actions are passed to `blsi.Toast.show`.
- Idle toast is **persistent info-only when `blsi.idle_toast_duration_seconds === 0`**: `Toast.show(msg, undefined, undefined, { persistent: true })` — no duration, no actions.
- Idle toast honors `blsi.idle_toast_duration_seconds` when `> 0`: switches to a transient toast `Toast.show(msg, N*1000)` (N seconds, no actions, no opts).
- Tab-switch toast is a **3s info notification**: `Toast.show(msg, 3000)` — no actions, no opts.
- Idle persistent toast auto-dismisses on the falling edge: when idle phase returns to `'active'` after firing, Manager calls `blsi.Toast.dismiss()`.
- Idle toast is **skipped while screen-share is active** — the rising-edge fire is gated on `!ss_blurring` so SS's actionable toast keeps the slot.

Tests stub `blsi.Toast = { show, dismiss, clearIfTransient }` per-spec; Manager calls `blsi.Toast.show` exclusively (no `Shortcuts.showToast` ever).

### `init bootstrap evaluation`
- `init` runs an immediate `_evaluate` so a tab opened mid-share with
  `automate.screen_share.enabled` and a non-sharing-tab id paints the
  Overlay correctly without waiting for a storage event.

## Edge cases covered

- Master switch off short-circuits before `resolve_automate` is called.
- Manager's storage subscriber is single-slot — re-binding via `init`
  replaces the previous registration (no duplicate fires).
- Storage subscriber cannot be removed (`Model.on_automate_change` has
  no unsubscribe API). Manager relies on the `_initialized` guard to
  silently ignore post-`destroy` events.
- `_get_host_url` returning `{ host: undefined }` — Manager skips
  silently rather than crashing (covered implicitly by the
  default-model bootstrap test).

## Known gaps

- No test for two-Manager-init race conditions (a contrived scenario;
  production code calls `init` exactly once at startup).
- No test for `Model.on_automate_change` warning when re-bound (warns
  on console.warn — covered by `storage_model.tests.md`).
- No test for `Overlay.show()` failing because `document.body` is
  absent — the overlay primitive itself silently no-ops in that case
  (covered by `overlay.tests.md`).

## Test count

21 tests in 5 describe groups.

## jsdom-specific notes

- Storage mocks come from `tests/setup.js`. The `_fireStorageChanged`
  helper dispatches to all registered listeners — both the State
  module's listener (which updates `_idle_cache` /
  `_tab_switch_cache`) and the Model's listener (which calls
  `_on_automate_change`).
- `freshLoad` in this suite resets and re-requires the whole automate
  module chain (constants → url_matcher → state → overlay →
  storage_model → manager) so each test has a clean blsi tree.
