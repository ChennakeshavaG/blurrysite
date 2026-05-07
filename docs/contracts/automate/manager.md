# automate/manager Contract

## Overview

Single owner of automate-driven Overlay show/hide AND automate transition toasts (idle / tab_switch / screen_share). The orchestrator for the automate side of the engine/automate split — `engine.js` does not react to live automate state.

Toasts are rendered via `blsi.Toast` (see `docs/contracts/toast.md`). Manager owns no toast DOM.

Triggers are independent of manual blur. Idle, tab-switch, and screen-share each fire when their own conditions are met regardless of whether blur-all or pick-and-blur is already active on the page — the Overlay layers on top. There is no "skipped" concept anywhere in the resolver, the Manager, the popup, or the i18n bundle.

Reacts to:
- `chrome.storage.session` changes (idle / tab_switch / screen_share / suppressed_tabs / suspended) via `blsi.Automate.State.on_session_change` — caches are guaranteed fresh before the callback fires (eliminates the race where Manager reads stale data from a separately-ordered onChanged listener).
- `chrome.storage.local` changes that may flip automate gates (popup edits to `automate.*.enabled`, `site_rules` mutations) via `blsi.Model.on_automate_change`.
- Suspended triggers (session-only, per-trigger) — `resolve_automate()` treats a suspended trigger as feature-off. Browser restart clears the session key and all triggers auto-resume.
- Explicit URL change notifications from `content_script` on SPA navigation (path-specific site rules can flip automate gates within the same host).

Reads `blsi.Model.resolve_automate(host, url, tab_id)` for the slim automate-decision snapshot. Never reads `blsi.Model.resolve()`. Never invokes engine APIs.

Loaded in CONTENT context only. Main-frame only at the call site (`content_script.init()` guards on `IS_MAIN_FRAME`).

Exposed as `blsi.Automate.Manager` (IIFE — no ES module syntax).

## Public API

### `init({ tab_id, get_host_url, ss_stop_actions?, ss_resume_action? })` → void

Wires the storage subscriber and runs an initial evaluation so the Overlay paints correctly on bootstrap (e.g., a tab opened mid-share immediately reflects the live screen-share record).

Params (single options object):
- `tab_id: number | null` — chrome tab id from `WHO_AM_I`. Required for per-tab automate suppression and the screen-share self-skip; pass `null` if unavailable (popup-style callers; degrades to host-level decisions).
- `get_host_url: () => { host: string, url: string }` — callback returning live values. Manager re-invokes on every evaluation so URL-change notifications don't need to thread the latest values through the call.
- `ss_stop_actions?: () => Promise<Array<{label, onClick, variant?}>>` — optional callback used by Manager when firing the screen-share toast. Builds the 3-button stop-share UI (per-tab / per-site-session / disable feature). Manager calls this lazily right before showing the toast so each click handler captures the *current* hostname / tab_id closure from content_script.
- `ss_resume_action?: () => Array<{label, onClick}>` — optional synchronous callback used by Manager when the screen-share trigger is suspended while the share is still live. Builds a single "Undo" button that calls `unsuppress_screen_share('feature', ...)`. Must be synchronous — Manager calls it inline within `_fire_toasts` so the undo toast is created before `_seed_tracking` runs. The resulting toast is transient (8s auto-dismiss) — a brief escape hatch, not a persistent surface.

Idle and tab-switch toasts have **no action buttons**. Tab-switch is a 3-second info notification. Idle duration is controlled by `blsi.idle_toast_duration_seconds` (default `0` = persistent forever, dismissed on the falling edge; positive `N` = `N`-second auto-dismiss). The `idle_stop_actions` / `tab_switch_stop_actions` plumbing was removed in the toast-redesign — the popup notif card retains per-trigger Skip-tab / Skip-site / Disable buttons for users who want to suppress.

**Priority**: screen-share > idle > tab-switch. Idle is gated on `!ss_blurring` so it never fires while screen-share is active. Screen-share's rising-edge toast call passes `{ override: true }` to `Toast.show` so a stale persistent idle toast (from before SS started) is replaced rather than blocked.

Side effects:
- If already initialized, calls `destroy()` first (clean re-bind).
- Registers `_evaluate` as the `State.on_session_change` subscriber (session state changes — guaranteed-fresh caches).
- Registers `_evaluate` as the `Model.on_automate_change` subscriber (local model changes — automate gate toggles, site rules).
- Runs one immediate `_evaluate()` to paint the Overlay state.
- The first `_evaluate` seeds transition tracking (`_last_idle_phase`, `_last_tab_switch_phase`, `_last_ss_blurring`) **without firing toasts**. This avoids alerting the user about state that already existed when the tab opened. Subsequent `_evaluate` calls compare against the seeded values and fire toasts on real transitions.

Edge cases:
- `get_host_url` missing → silent no-op (Manager cannot operate without a host source).
- `_get_host_url()` returns no host (e.g., during boot) → `_evaluate` skips silently.
- Master switch off (`global_default_settings.enabled === false`) → Manager treats it as "automate cannot fire" and hides the Overlay regardless of session state.

### `destroy()` → void

Tears down internal state and hides the Overlay. Idempotent — calling on an uninitialized Manager is a no-op.

Nulls `_ss_stop_actions` and `_ss_resume_action`. `_idle_stop_actions` and `_tab_switch_stop_actions` were removed — idle is persistent info-only, tab-switch is a 3s info notification with no buttons.

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

Manager fires three automate transition toasts via `blsi.Toast.show`:

| Toast | i18n key | Override key (for "(site rule)" suffix) | Duration | Actions | Fires when |
|---|---|---|---|---|---|
| Idle | `automate_toast_idle` | `automate_idle` | `blsi.idle_toast_duration_seconds` (default `0` = persistent) | None — `Toast.show(msg, ...)` with persistent flag when `<= 0`, or `Toast.show(msg, N*1000)` transient when `> 0`. Auto-dismisses on the falling edge: when idle phase returns to `'active'` AND screen-share is not currently holding the toast slot, Manager calls `Toast.dismiss()`. **Skipped while `ss_blurring` is true** — screen-share has higher priority. | rising edge: `triggers.idle && idle phase transitioned to 'idle' or 'locked' && !ss_blurring`; falling edge: idle phase returned to `'active'` while no screen-share toast is live |
| Tab-switch | `automate_toast_tab_switch` | `automate_tab_switch` | 3000ms | None — `Toast.show(msg, 3000)`. | `triggers.tab_switch && tab_switch phase transitioned to 'fired'` |
| Screen-share | `automate_toast_screen_share` | `automate_screen_share` | persistent | Uses `_ss_stop_actions` Promise pattern; `{ persistent: true, override: true }` skips auto-dismiss AND forces replacement of any current toast (e.g. a stale persistent idle toast). On falling edge (`!ss_blurring && _last_ss_blurring`), calls `blsi.Toast.dismiss()` to remove the persistent toast. If the drop was caused by suspension (share still live, `screen_share_suspended === true`), shows a **persistent** 8s "Undo" toast via `_ss_resume_action` with `{ persistent: true, override: true }` + manual `setTimeout(dismiss, 8000)`. Must be persistent because the `_sync() → applyState → Shortcuts.destroy() → clearIfTransient()` cycle that follows the suspend action would remove a non-persistent toast. **Master-switch teardown**: when the global `enabled` flips off mid-share, `_apply` takes the `master_off` early-return; before re-seeding tracking it checks `_last_ss_blurring` and calls `Toast.dismiss()` so the persistent toast does not outlive the disabled extension. | rising edge of `triggers.screen_share` (show); falling edge OR master switch off while `_last_ss_blurring` (dismiss; + undo toast if suspended) |

All three read the override key off `r._rule_overrides_automate` to decide whether to append "(site rule)". Each trigger fires independently — there is no "automate is the sole blur reason" gate; Manager always fires when its trigger transitions, even when blur-all or pick-and-blur is already active on the page.

**Idle falling-edge guard** — when both idle and screen-share are firing, the persistent idle toast and the persistent screen-share toast share one slot. The newer toast wins (single-slot). Idle's falling-edge dismiss is gated on `!ss_blurring` so an idle clear while screen-share is still active does NOT yank the screen-share toast.

If `blsi.Toast` is not yet loaded at toast time (e.g., a storage event arrives during the cold-start window), Manager silently skips the toast. The next storage event will fire the next toast normally; the missed transition is acceptable bootstrap noise.

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
| `content_script.init()` (main frame, after `WHO_AM_I`) | `Manager.init({ tab_id, get_host_url, ss_stop_actions, ss_resume_action })` | Once at startup |
| `content_script.onUrlChange()` | `Manager.on_url_change(host, url)` | On every popstate / pushState that changes the URL |
| `content_script` (extension disable cleanup, future) | `Manager.destroy()` | If we ever fully tear down on disable; today the master-switch evaluation handles it |

Manager calls outwards:
- `blsi.Model.get()` — read master switch
- `blsi.Model.on_automate_change(fn)` — subscribe
- `blsi.Model.resolve_automate(host, url, tab_id)` — derive state
- `blsi.Automate.Overlay.show()` / `.hide()` — drive render
- `blsi.Toast.show()` / `.dismiss()` — render transition toasts

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
