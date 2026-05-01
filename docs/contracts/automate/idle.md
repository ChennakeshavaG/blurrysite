# automate/idle Contract

## Overview

Background-only observer for OS-level user idle / screen-lock state, backed by `chrome.idle`. Translates `chrome.idle.onStateChanged` events into a single global string in `chrome.storage.session` (`KEYS.idle`).

This module replaces the DOM-event-based timer approach previously living in `src/auto_blur.js`. Trade-offs documented in `docs/automate-redesign-plan.md`. The short version: `chrome.idle` is OS-level, accurate across tabs, screen-lock-aware, and event-driven (no polling, no setTimeout, no per-tab timers).

Loaded in BACKGROUND service worker only. Content scripts read the state via `blsi.Automate.State.read_idle()`; they never observe `chrome.idle` directly.

Exposed as `blsi.Automate.Idle` (IIFE — no ES module syntax).

## Public API

### `init()` → void

Idempotent. Registers the `chrome.idle.onStateChanged` listener and seeds the threshold from `chrome.storage.local.blsi_model.automate.settings.idle.value/unit` (read once on init). Subsequent threshold changes are picked up via the `chrome.storage.onChanged` listener wired internally.

Side effects:
- Registers `chrome.idle.onStateChanged` listener (one — repeated `init()` calls do not stack listeners).
- Calls `chrome.idle.setDetectionInterval(seconds)` with the resolved threshold (clamped to a minimum of 15 — Chrome enforces this floor regardless).
- Registers a `chrome.storage.onChanged` listener that watches `blsi_model` for threshold changes.
- Performs an initial `chrome.idle.queryState(threshold)` so the cached state reflects the current OS state at SW startup.

Edge cases:
- `chrome.idle` API unavailable (tests / non-Chrome contexts) → no-op; module exports stay defined but `init` does nothing.
- Stored threshold is missing or invalid → falls back to `15` seconds.
- Stored threshold is below 15 seconds → clamped to 15 with a one-time `console.warn`. (The `automate.settings.idle.value/unit` validator should keep this from happening; clamp here is belt-and-suspenders.)

### `destroy()` → void

Removes the `chrome.idle.onStateChanged` listener and the storage subscription. After destroy, no further writes to `KEYS.idle` happen until `init()` is called again.

### `setThreshold(seconds)` → void

Hot-update the detection interval without tearing down the listener. Calls `chrome.idle.setDetectionInterval(seconds)`. Clamps to 15 seconds minimum.

Used by the storage subscription internally and exposed for tests / debugging.

### `getCurrentPhase()` → string

Returns the most recent value seen from `chrome.idle.onStateChanged` or `queryState()`. Mirrors `blsi.Automate.State.read_idle()` for callers that already have an `Idle` reference but not `State`.

## Internal mechanics

### Threshold resolution

On init and on every `chrome.storage.onChanged` matching `blsi_model`, the module reads:
```
blsi_model.automate.settings.idle.value (number, 1..99)
blsi_model.automate.settings.idle.unit  ('sec' | 'min')
```
Computes seconds = value * (unit === 'min' ? 60 : 1). Clamps to `[15, 3600]`. Calls `chrome.idle.setDetectionInterval(seconds)`.

If `automate.settings.idle.enabled` is `false`, the listener stays registered but writes of `'idle'` / `'locked'` are still emitted. Resolve is responsible for ignoring them when the feature is disabled. (Rationale: keeping the listener active means a single `setDetectionInterval` call when the feature flips on, no listener churn.)

### State write

On `chrome.idle.onStateChanged(state)`:
- Validates `state ∈ {'active', 'idle', 'locked'}`.
- Calls `blsi.Automate.State.write_idle(state)`. Writes are idempotent — same-value writes are no-ops.

### SW eviction

The service worker can be evicted between idle events. On wake (next `chrome.idle.onStateChanged` event, or `onStartup`), `init` runs again, re-registers, and re-seeds via `queryState`. Storage value is preserved across eviction.

## Invariants

- Exactly one `chrome.idle.onStateChanged` listener registered at a time.
- `chrome.idle.setDetectionInterval` is called only with values >= 15. Chrome's own clamp would handle smaller values, but explicit clamp keeps the value visible to logging.
- `getCurrentPhase()` always returns one of `'active' | 'idle' | 'locked'` — never undefined or other strings.
- Writes go through `blsi.Automate.State.write_idle` — module never calls `chrome.storage.session.set` directly.
- The exported `Idle` object is frozen.

## Edge cases / gotchas

- **`chrome.idle` permission**: requires `"idle"` in manifest. Without it, `chrome.idle` is `undefined` and `init()` becomes a no-op. The module DOES NOT prompt for permission at runtime — install-time `manifest.json` is the only path.
- **Threshold floor**: Chrome's hard minimum is 15 seconds. Even if user sets 5 seconds in the popup, `chrome.idle` will only fire on >=15s of inactivity. Popup UI must clamp displayed threshold to >=15.
- **`'locked'` state**: fires when the OS reports a locked screen (lock screen / screensaver). Treated as a stronger form of `'idle'` for blur purposes. `Store.resolve()` should treat both `'idle'` and `'locked'` as "blur required".
- **Multiple Chrome windows**: `chrome.idle` is process-wide, not window-specific. All windows see the same state. This is the desired semantic — "user is away from this computer" means every browser tab in every window blurs.
- **Test environment**: jsdom does not implement `chrome.idle`. Tests must stub `chrome.idle.onStateChanged.addListener` and `chrome.idle.setDetectionInterval`.

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `background.js` (top-level) | `Idle.init()` | `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`. Also called at module load (top-level `init()`) so SW wake-on-idle event re-establishes state. |
| `Store.resolve()` | reads `blsi.Automate.State.read_idle()` | Every resolve in every tab |
| popup status query | reads via `blsi.Automate.State.read_idle()` | When popup renders |

`Idle` does not communicate with content scripts directly. Content reads the state via `State.read_idle()` after `chrome.storage.onChanged` fires.

## Test strategy

- Mock `chrome.idle.onStateChanged.addListener`, `chrome.idle.setDetectionInterval`, `chrome.idle.queryState` in `tests/setup.js`.
- Cover: `init` registers exactly one listener even when called twice; threshold clamp to 15s; storage-change-driven threshold update; state writes go through `State.write_idle`; `'idle'` / `'locked'` / `'active'` all propagate; invalid state strings rejected; `destroy` removes the listener; `init` after `destroy` works.
