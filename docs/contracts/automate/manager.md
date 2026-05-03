# automate/manager Contract

## Overview

Single owner of automate-driven Overlay show/hide AND automate transition toasts (idle / tab_switch / screen_share / skipped). The orchestrator for the automate side of the engine/automate split — `engine.js` does not react to live automate state.

Reacts to:
- `chrome.storage.session` changes (idle / tab_switch / screen_share / suppressed_tabs / suspended) via `blsi.Automate.State.on_session_change` — caches are guaranteed fresh before the callback fires (eliminates the race where Manager reads stale data from a separately-ordered onChanged listener).
- `chrome.storage.local` changes that may flip automate gates (popup edits to `automate.*.enabled`, `site_rules` mutations) via `blsi.Model.on_automate_change`.
- Suspended triggers (session-only, per-trigger) — `resolve_automate()` treats a suspended trigger as feature-off. Browser restart clears the session key and all triggers auto-resume.
- Explicit URL change notifications from `content_script` on SPA navigation (path-specific site rules can flip automate gates within the same host).

Reads `blsi.Model.resolve_automate(host, url, tab_id)` for the slim automate-decision snapshot. Never reads `blsi.Model.resolve()`. Never invokes engine APIs.

Loaded in CONTENT context only. Main-frame only at the call site (`content_script.init()` guards on `IS_MAIN_FRAME`).

Exposed as `blsi.Automate.Manager` (IIFE — no ES module syntax).

## Public API

### `init({ tab_id, get_host_url, ss_stop_actions?, idle_stop_actions?, tab_switch_stop_actions? })` → void

Wires the storage subscriber and runs an initial evaluation so the Overlay paints correctly on bootstrap (e.g., a tab opened mid-share immediately reflects the live screen-share record).

Params (single options object):
- `tab_id: number | null` — chrome tab id from `WHO_AM_I`. Required for per-tab automate suppression and the screen-share self-skip; pass `null` if unavailable (popup-style callers; degrades to host-level decisions).
- `get_host_url: () => { host: string, url: string }` — callback returning live values. Manager re-invokes on every evaluation so URL-change notifications don't need to thread the latest values through the call.
- `ss_stop_actions?: () => Promise<Array<{label, onClick, variant?}>>` — optional callback used by Manager when firing the screen-share toast. Builds the 3-button stop-share UI (per-tab / per-site-session / disable feature). Manager calls this lazily right before showing the toast so each click handler captures the *current* hostname / tab_id closure from content_script.
- `idle_stop_actions?: async () => Array<{label, onClick, variant?}>` — optional callback called when the idle toast fires. Returns action buttons for the idle toast (same shape as `ss_stop_actions`). When provided, Manager calls it async then passes the result to `showToast(msg, 5000, actions)`. If not provided or the callback rejects, falls back to `showToast(msg, 5000)` without actions.
- `tab_switch_stop_actions?: async () => Array<{label, onClick, variant?}>` — same pattern as `idle_stop_actions` but for the tab_switch toast.

Side effects:
- If already initialized, calls `destroy()` first (clean re-bind).
- Registers `_evaluate` as the `State.on_session_change` subscriber (session state changes — guaranteed-fresh caches).
- Registers `_evaluate` as the `Model.on_automate_change` subscriber (local model changes — automate gate toggles, site rules).
- Runs one immediate `_evaluate()` to paint the Overlay state.
- The first `_evaluate` seeds transition tracking (`_last_idle_phase`, `_last_tab_switch_phase`, `_last_ss_blurring`, `_last_skipped`) **without firing toasts**. This avoids alerting the user about state that already existed when the tab opened. Subsequent `_evaluate` calls compare against the seeded values and fire toasts on real transitions.

Edge cases:
- `get_host_url` missing → silent no-op (Manager cannot operate without a host source).
- `_get_host_url()` returns no host (e.g., during boot) → `_evaluate` skips silently.
- Master switch off (`global_default_settings.enabled === false`) → Manager treats it as "automate cannot fire" and hides the Overlay regardless of session state.

### `destroy()` → void

Tears down internal state and hides the Overlay. Idempotent — calling on an uninitialized Manager is a no-op.

Nulls `_idle_stop_actions` and `_tab_switch_stop_actions` (in addition to the existing `_ss_stop_actions` teardown).

Note: `State.on_session_change` and `Model.on_automate_change` are both single-slot with no unsubscribe API. `destroy()` cannot remove them; instead it sets `_initialized = false` so subsequent `_evaluate` calls early-return. Re-`init()` replaces the callbacks via the standard "single subscriber, replaces existing" pattern.

### `on_url_change(host, url)` → void

Notification hook for SPA navigation. `content_script` already detects URL changes (popstate, pushState wrap); rather than have Manager observe its own listeners, we let the orchestrator notify.

Manager re-evaluates by calling `_get_host_url()` (which returns the *current* values, post-navigation). The `host`/`url` arguments are accepted for symmetry and future direct-pass but are not used in step 2.

Edge cases:
- Manager not initialized → no-op.
- Same host/URL as previous → re-evaluation produces no Overlay state change (idempotent — Overlay.show / Overlay.hide are themselves idempotent).

### `_evaluate()` → void (test hook)

Forces a re-evaluation. Used by tests to assert behavior under arbitrary state mutations without depending on chrome.storage.onChanged plumbing. Production code should never call this directly.

### `_isActive()` → boolean (test hook)

Returns the last computed `automate_blur_active` value. Used by tests to assert Overlay state without inspecting the DOM.

## Toast attribution

Manager fires four automate transition toasts:

| Toast | i18n key | Override key (for "(site rule)" suffix) | Duration | Actions | Fires when |
|---|---|---|---|---|---|
| Idle | `automate_toast_idle` | `automate_idle` | 5000ms | If `_idle_stop_actions` set: calls it async → `showToast(msg, 5000, actions)`. Falls back to `showToast(msg, 5000)` if callback not provided or rejects. | `automate_blur_only && triggers.idle && idle phase transitioned to 'idle' or 'locked'` |
| Tab-switch | `automate_toast_tab_switch` | `automate_tab_switch` | 5000ms | If `_tab_switch_stop_actions` set: same Promise-based pattern as idle. Falls back to `showToast(msg, 5000)`. | `automate_blur_only && triggers.tab_switch && tab_switch phase transitioned to 'fired'` |
| Screen-share | `automate_toast_screen_share` | `automate_screen_share` | persistent | Uses `_ss_stop_actions` Promise pattern; `{ persistent: true }` skips auto-dismiss. On falling edge (`!ss_blurring && _last_ss_blurring`), calls `Shortcuts.dismissToast()` to remove the persistent toast. | rising edge of `triggers.screen_share` (show); falling edge (dismiss) |
| Skipped | `automate_toast_skipped` | `automate_screen_share` | — | — | rising edge of `automate_blur_skipped && automate_blur_skip_reason` |

All four read the override key off `r._rule_overrides_automate` to decide whether to append "(site rule)". Idle and tab_switch toasts only fire when automate is the **sole** blur reason (`automate_blur_only`) — when manual blur is already on, only the "skipped" toast can fire.

**`_fire_toasts()` action pattern** (idle & tab_switch): Both idle and tab_switch toasts now use the same Promise-based pattern as screen_share. When the corresponding `_*_stop_actions` callback is set, Manager calls it async, then passes the resolved actions array to `showToast(msg, 5000, actions)`. If the callback is not provided or rejects, Manager falls back to `showToast(msg, 5000)` without actions. Previously these toasts used `showToast(msg, 2500)` with no actions.

If `Shortcuts` is not yet initialized at toast time (e.g., a storage event arrives between `Manager.init` and `Shortcuts.init`), Manager silently skips the toast. The next storage event will fire the next toast normally; the missed transition is acceptable bootstrap noise.

## Invariants

- Manager is single-slot: `init()` followed by `init()` (without `destroy`) is a clean re-bind, not duplicate state.
- Manager never calls `engine.handleSite` or any engine method. The split's whole point is two independent reactive paths.
- Manager never reads `blsi.Model.resolve()`. Only `resolve_automate()`.
- Manager honors the master switch (`global_default_settings.enabled`) locally — `resolve_automate` does *not* gate automate_blur_active on `enabled` (parity with `resolve()`), so Manager checks it before driving the Overlay.
- `Overlay.show()` / `Overlay.hide()` are themselves idempotent; Manager calls them every evaluation. No transition tracking required for the Overlay surface (transition tracking lands in step 4 for *toasts* only).
- The exported `Manager` object is frozen.

## Edge cases / gotchas

- **Master switch off**: when `enabled === false`, Manager skips the resolve call entirely and hides the Overlay. This avoids a stale Overlay if the user disables the extension while a screen share is active.
- **Race during init**: if Manager evaluates before `Store.init_cache()` resolves, `Model.get()` returns the default model. `enabled` defaults to `true` so we proceed; `automate.*.enabled` defaults to `false` so no triggers fire — Overlay stays hidden. Correct fallback.
- **Iframe instances**: Manager is main-frame only. Iframes don't observe automate state independently (would fragment per-tab decisions).
- **Storage subscriber single-slot**: if some other code claims `Model.on_automate_change` after Manager, Manager goes silent. We rely on the `console.warn` in `Model.on_automate_change` to surface this during development.

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `content_script.init()` (main frame, after `WHO_AM_I`) | `Manager.init({ tab_id, get_host_url })` | Once at startup |
| `content_script.onUrlChange()` | `Manager.on_url_change(host, url)` | On every popstate / pushState that changes the URL |
| `content_script` (extension disable cleanup, future) | `Manager.destroy()` | If we ever fully tear down on disable; today the master-switch evaluation handles it |

Manager calls outwards:
- `blsi.Model.get()` — read master switch
- `blsi.Model.on_automate_change(fn)` — subscribe
- `blsi.Model.resolve_automate(host, url, tab_id)` — derive state
- `blsi.Automate.Overlay.show()` / `.hide()` — drive render

## Test strategy

- Mock `chrome.storage.session.get/set` and `chrome.storage.onChanged.addListener` (already provided by `tests/setup.js`).
- Reload the module per test via `jest.resetModules()` so `_initialized` and `_last_active` start fresh.
- Cover:
  - `init()` registers the subscriber + runs initial `_evaluate`.
  - `destroy()` hides the Overlay + flips `_initialized` so subsequent storage events no-op.
  - `_evaluate()` shows the Overlay when `automate_blur_active` is true; hides when false.
  - Master switch off → Overlay hidden regardless of automate state.
  - `init()` re-bind: calling `init()` twice destroys and re-binds without duplicate state.
  - `on_url_change` triggers a re-evaluation.
  - Storage onChange (via `_fireStorageChanged`) triggers `_evaluate` through the subscriber.
- Visual / integration: not part of unit tests; manual QA verifies the actual Overlay rendering.
