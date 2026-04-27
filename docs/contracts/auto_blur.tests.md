# auto_blur Test Contract

## Overview

Tests for `src/auto_blur.js` (`blsi.AutoBlur`). Verifies idle-timeout triggering, user-activity timer reset, tab-visibility change detection (including the 150 ms debounce), window-blur/focus detection (including the 250 ms debounce for URL-bar / quick-focus-pull suppression), dedupe between visibilitychange and window.blur for same-window tab switches, destroy/cleanup semantics, double-init replacement, and mode isolation between `idle` and `tabSwitch` modes. The module protects sensitive data by auto-blurring the page when the user is idle or switches away (to another tab, another window, or another app).

## Setup & Teardown

- **`freshLoad()`** called in `beforeEach`: deletes `blsi.AutoBlur`, calls `jest.resetModules()`, then `jest.isolateModules(() => require(MODULE_PATH))` to get a clean module instance per test.
- **`beforeEach`**: `jest.useFakeTimers()` to control `setTimeout` / `setInterval`.
- **`afterEach`**: `blsi.AutoBlur.destroy()` to remove all listeners, then `jest.useRealTimers()`.
- `document.hidden` is mutated via `Object.defineProperty` with `configurable: true` and manually restored to `false` after each visibility-related test.
- `document.hasFocus` is replaced via `Object.defineProperty` with a function returning the desired boolean (helper `setHasFocus(value)`) and manually restored to `true` after each window-focus test. The window.blur timer callback inspects `document.hasFocus()` to confirm focus is still away before firing `onIdle`.

## Test Groups

### auto_blur.js

- `isIdle() returns false initially` — immediately after `freshLoad()` and before any `init()` call, `isIdle()` returns `false`.
- `idle detection triggers onIdle after timeout` — after `init({ idleTimeout: 10, idle: true, tabSwitch: false, ... })`, advancing fake timers by 10 s fires `onIdle` once and sets `isIdle()` to `true`.
- `user activity resets idle timer` — dispatching `mousemove` on `document` mid-countdown resets the idle timer; `onIdle` does not fire until a full timeout elapses after the activity event.
- `user activity after idle triggers onActive` — after the idle timer fires (`isIdle() === true`), dispatching `mousemove` on `document` calls `onActive` once and resets `isIdle()` to `false`.
- `tab switch triggers onIdle when hidden` — with `tabSwitch: true`, setting `document.hidden = true` and dispatching `visibilitychange` fires `onIdle` after the 150 ms debounce elapses (advancing fake timers by 150 ms).
- `tab becoming visible triggers onActive` — after the 150 ms debounce has fired (page hidden), setting `document.hidden = false` and dispatching `visibilitychange` calls `onActive` once.
- `brief hide-then-show (tab drag to new window) does not trigger callbacks` — if `visibilitychange` fires hidden then visible within less than 150 ms, neither `onIdle` nor `onActive` is called (debounce cancelled).
- `destroy removes all listeners and resets state` — calling `destroy()` before the idle timeout elapses prevents `onIdle` from firing; `isIdle()` returns `false` after destroy.
- `double init replaces previous listeners` — a second `init()` call discards the first set of callbacks; only `onIdle2` fires after the timeout, `onIdle1` is never called.
- `idle-only mode does not respond to visibility changes` — with `tabSwitch: false`, dispatching `visibilitychange` does not call `onIdle` regardless of `document.hidden`.
- `tab-switch-only mode does not set idle timer` — with `idle: false`, advancing fake timers by 10 s does not call `onIdle`.

### Window blur / focus group (alt-tab to other window/app)

- `window.blur triggers onIdle({reason:tab_switch}) after 250ms when focus stays away` — with `tabSwitch: true`, dispatching `blur` on `window` while `document.hasFocus()` returns `false` fires `onIdle({ reason: 'tab_switch' })` after a 250 ms debounce. Asserts no fire at 249 ms, fires at 250 ms.
- `window.focus before 250ms cancels pending blur — no callbacks fire` — focus returning within the 250 ms debounce window cancels the pending blur (URL-bar click, brief focus pull). Neither `onIdle` nor `onActive` fires.
- `window.focus after sustained blur fires onActive` — after a real window-blur fired `onIdle`, dispatching `focus` (with `document.hasFocus()` returning `true`, `document.hidden` `false`) fires `onActive` once and resets `isIdle()` to `false`.
- `visibilitychange + window.blur dedupe via _isIdle mutex` — same-window tab switch fires both `visibilitychange` (after 150 ms) and `window.blur` (after 250 ms). The shared `_isIdle` mutex ensures `onIdle` fires exactly once.
- `destroy removes window.blur and window.focus listeners` — after `destroy()`, dispatching `blur` on `window` does not fire `onIdle` even after the 250 ms debounce.
- `idle-only mode does not respond to window.blur` — with `tabSwitch: false`, `window.blur` is ignored regardless of focus state.

## Edge Cases Covered

- **Brief tab drag / new-window creation**: hide → show cycle faster than 150 ms debounce produces no callbacks.
- **URL-bar / quick-focus-pull**: window blur → focus cycle faster than 250 ms produces no callbacks.
- **Same-window tab switch double-event**: `visibilitychange` and `window.blur` both fire; `_isIdle` mutex prevents double `onIdle`.
- **Double init replacement**: second `init()` implicitly destroys the previous configuration; old callbacks are silently dropped.
- **Mode isolation**: `idle` flag and `tabSwitch` flag are independently honoured; enabling one does not activate the other. `tabSwitch: false` disables both `visibilitychange` AND `window.blur`/`window.focus` listeners.

## Coverage Gaps

- Only `mousemove` activity event is tested; `keydown`, `scroll`, and `touchstart` are not verified to reset the idle timer.
- No test for double `destroy()` — calling it twice should not throw.
- No test for `init()` with missing `onIdle` or `onActive` callbacks — module should not crash on absent optional callbacks.
- No test for edge-case `idleTimeout` values (`0`, negative, `Infinity`) — behavior on invalid input is unspecified.
- No test for `init()` with both `idle: false` and `tabSwitch: false` — effectively a no-op configuration.
