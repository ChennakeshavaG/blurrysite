# auto_blur Contract

## Overview

Fires idle/tab-switch callbacks without owning blur state — a pure event trigger. The caller (`content_script.js`) owns the blur state and writes to storage; `AutoBlur` only invokes `onIdle` and `onActive` at the right time. Singleton: calling `init()` always destroys the previous instance first.

## Module State

| Variable | Description |
|---|---|
| `_idleTimer` | `TimeoutID\|null` — scheduled idle timeout handle |
| `_isIdle` | `boolean` — whether page is currently considered idle |
| `_opts` | `Object\|null` — the options passed to `init()` |
| `_onVisChange` | `Function\|null` — bound `visibilitychange` handler (for cleanup) |
| `_onActivity` | `Function\|null` — bound activity event handler (for cleanup) |
| `_onWindowBlur` | `Function\|null` — bound `window.blur` handler (for cleanup) |
| `_onWindowFocus` | `Function\|null` — bound `window.focus` handler (for cleanup) |
| `_hiddenTimer` | `TimeoutID\|null` — 150ms debounce for window-drag disambiguation |
| `_windowBlurTimer` | `TimeoutID\|null` — 250ms debounce for window-blur (URL-bar / quick-focus-pull suppression) |

## Public API

### init(opts)

**What**: Registers idle and/or tab-switch listeners based on the opts flags. Calls `destroy()` first to clean up any previous instance.  
**Params**:  
- `opts.idle` (boolean) — enable idle detection via activity timer  
- `opts.tabSwitch` (boolean) — enable tab-switch detection via `visibilitychange`  
- `opts.idleTimeout` (number) — seconds before idle fires (default: 300); valid range: 1–3000  
- `opts.onIdle` (function) — called with `{ reason: 'idle' | 'tab_switch' }` when page goes idle/hidden  
- `opts.onActive` (function) — called (no args) when user returns from idle/hidden  
**Returns**: `void`  
**Side effects**:
- Registers `visibilitychange` on `document` if `opts.tabSwitch`
- Registers `blur` and `focus` on `window` if `opts.tabSwitch` (catches alt-tab to other apps/windows where the page stays visible — `visibilitychange` does not fire then)
- Registers `mousemove`, `keydown`, `scroll`, `touchstart` on `document` (passive) if `opts.idle`
- Calls `_resetIdleTimer()` if `opts.idle`
- Resets `_isIdle = false`  
**Handles**: If neither `idle` nor `tabSwitch` is set, no listeners are registered (valid no-op state).

### destroy()

**What**: Removes all listeners, clears all timers, resets state.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Clears `_idleTimer`, `_hiddenTimer`, `_windowBlurTimer`; removes `visibilitychange`, `window.blur`/`window.focus`, and activity listeners; nulls `_onVisChange`, `_onActivity`, `_onWindowBlur`, `_onWindowFocus`, `_opts`; resets `_isIdle = false`  
**Handles**: Idempotent — safe to call when already destroyed or never initialized.

### isIdle()

**What**: Returns whether the page is currently in idle state.  
**Params**: none  
**Returns**: `boolean` — `true` if `onIdle` was fired and `onActive` has not fired since  
**Side effects**: none

## Internal Functions

### _resetIdleTimer()

**What**: Clears the existing idle timer and schedules a new one at `opts.idleTimeout * 1000` ms.  
**Side effects**: On timer fire, sets `_isIdle = true` and calls `opts.onIdle({ reason: 'idle' })` — guarded by `if (!_isIdle)` to prevent duplicate fires.  
**Handles**: No-op if `_opts.idle` is falsy.

### _handleActivity()

**What**: Called on user activity events (mousemove/keydown/scroll/touchstart). If returning from idle, calls `onActive()`, then reschedules the idle timer.  
**Side effects**: Resets `_isIdle = false` and fires `onActive()` if was idle; always calls `_resetIdleTimer()`.

### _handleVisChange()

**What**: `visibilitychange` event handler for tab-switch detection, with 150ms debounce to distinguish tab drag from genuine tab switch.  
**Side effects**:
- On `document.hidden`: starts `_hiddenTimer` (150ms). If still hidden after 150ms → genuine tab switch → sets `_isIdle = true`, fires `onIdle({ reason: 'tab_switch' })`.
- On `document.visible`: if `_hiddenTimer` still pending → was a window drag → cancel timer, reschedule idle timer, **skip all callbacks unconditionally** (no `onActive` even if `_isIdle` is already true from an earlier event — the drag-cancel path always exits early). If no pending timer and `_isIdle` → genuine return → sets `_isIdle = false`, fires `onActive()`.

### _handleWindowBlur()

**What**: `window.blur` event handler for window/app-switch detection, with 250ms debounce. Catches alt-tab to another browser window or external app where the page stays visible (so `visibilitychange` does NOT fire). Reuses `reason: 'tab_switch'` — same user intent as same-window tab switch.  
**Side effects**:
- Starts `_windowBlurTimer` (250ms). If `document.hasFocus()` is still false after 250ms and `_isIdle` is false → fires `onIdle({ reason: 'tab_switch' })` and sets `_isIdle = true`.
- No-op when `_opts.tabSwitch` is false.  
**Handles**: When tab-switch within the same window also triggers `window.blur`, the `if (!_isIdle)` guard inside the timer callback prevents double-firing with `_handleVisChange`.

### _handleWindowFocus()

**What**: `window.focus` event handler — paired return for `_handleWindowBlur`.  
**Side effects**:
- If `_windowBlurTimer` still pending → cancel timer, reschedule idle timer, skip callbacks (focus returned within debounce window — URL-bar click, brief focus pull, etc.).
- If no pending timer and `_isIdle && !document.hidden` → fires `onActive()` and sets `_isIdle = false`. The `!document.hidden` guard prevents firing when window focus returns but the tab is still hidden (e.g. focus moved to a different tab).

## Invariants

- `onIdle` fires **at most once per idle period** — guarded by `if (!_isIdle)` in the idle timer callback, `_handleVisChange`, and `_handleWindowBlur`.
- `onActive` fires **at most once per return** — only fires when `_isIdle === true`.
- Activity events registered with `{ passive: true }` — no scroll/touch jank.
- `_hiddenTimer` race condition: if a tab-switch fires while `_idleTimer` is pending, the idle-timer guard prevents duplicate `onIdle`.
- Tab-switch within same window: `visibilitychange` and `window.blur` may both fire. `_isIdle` mutex prevents double `onIdle`. Symmetric on return — first event clears `_isIdle`, second is a no-op.
- Module does NOT own blur state — it only fires callbacks.
- `opts.idleTimeout` default is 300 seconds; Chrome idle API cap is ~3000s (`'hr'` unit is excluded).
- Opening the extension popup pulls focus → fires `window.blur` → page blurs after 250ms. Acknowledged tradeoff: no clean way to detect own-extension focus from page context. See `CLAUDE.md` Known Limitations.
