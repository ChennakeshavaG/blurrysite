# logger Test Contract

## Overview

Tests for `src/logger.js` (`blsi.Logger`). Verifies that `log`, `warn`, and `flow` are gated on an internal `_enabled` flag; that `error` always writes to `console.error` regardless of toggle; that `enable()` and `disable()` persist the flag to `chrome.storage.local`; that `scope(name)` returns a tagged variant respecting the same gate; that the `chrome.storage.onChanged` listener syncs the toggle across contexts; and that the initial enabled state is hydrated from `chrome.storage.local` on module load.

## Setup & Teardown

- **`freshLoad({ initial })`** helper: clears `blsi.Logger`, calls `jest.resetModules()`, installs a `chrome.storage.onChanged.addListener` mock that captures the registered listener into `onChangedListener`, mocks `chrome.storage.local.get` to resolve with `{ blsi_debug: initial }`, then calls `jest.isolateModules(() => require(MODULE_PATH))`.
- **`beforeEach`**: calls `freshLoad()` (default `initial: false`), then spies on `console.log`, `console.warn`, `console.error` with `.mockImplementation(() => {})`.
- **`afterEach`**: restores all three console spies.
- **`afterAll`**: calls `.mockReset()` on `chrome.storage.onChanged.addListener` and `chrome.storage.local.get` so other test files receive fresh jest.fn() defaults.

## Test Groups

### logger.js

- `log/warn/flow are silent by default` — with `_enabled = false`, calling `log()`, `warn()`, and `flow()` produces no `console.log` or `console.warn` output.
- `error() always writes regardless of toggle` — with logging disabled, `error('boom')` still calls `console.error`; the call arguments include `'[BLSI]'` as the first element and the message string `'boom'`.
- `enable() flips state and persists to storage` — after `enable()`, `Logger.enabled` is `true`; `chrome.storage.local.set` is called with `{ blsi_debug: true }`; subsequent `log()` calls produce `console.log` output containing the message string.
- `disable() flips state off and persists` — after `enable()` then `disable()`, `Logger.enabled` is `false`; `chrome.storage.local.set` is called with `{ blsi_debug: false }`; subsequent `log()` calls produce no output.
- `flow() emits the event tag and payload when enabled` — after `enable()`, calling `flow('init.start', { hostname: 'example.com' })` produces a `console.log` call that includes both the string `'init.start'` and the object `{ hostname: 'example.com' }`.
- `scope() prefixes with the scope tag and respects the gate` — `scope('content').log()` is silent while disabled; after `enable()`, `scope('content').flow('msg.in', { type: 'X' })` produces a `console.log` call containing `'[content]'`, `'msg.in'`, and `{ type: 'X' }`.
- `scope().error always writes` — `scope('bg').error('fatal')` calls `console.error` even while disabled; the call arguments include `'[bg]'` and `'fatal'`.
- `chrome.storage.onChanged listener syncs cross-context state` — the registered `onChangedListener` is a function; firing it with `{ blsi_debug: { newValue: true } }, 'local'` sets `Logger.enabled` to `true`; firing with `newValue: false` sets it back to `false`.
- `onChanged listener ignores non-local areas and unrelated keys` — firing `onChangedListener` with area `'sync'` or with an unrelated key in area `'local'` leaves `Logger.enabled` unchanged at `false`.
- `initial state read from storage when blsi_debug=true` — calling `freshLoad({ initial: true })` and immediately reading `Logger.enabled` returns `true`.

## Edge Cases Covered

- Cross-context sync: `onChanged` listener distinguishes storage area (`'local'` vs `'sync'`) and key name.
- Scope variant of the un-gated error path verified separately from the root variant.
- Initial hydration from storage is tested at module load time (not just after explicit `enable()`).

## Coverage Gaps

- No explicit assertion that `Logger.enabled` is `false` before any `enable()` call (default state verified only implicitly through the silent-log test).
- `scope().warn()` is not tested — `warn` is gated but the scoped warn path is unverified.
- No test for two independent scopes sharing the same `_enabled` flag (cross-scope coupling).
- No test verifying the `_ts()` timestamp format (`HH:MM:SS.mmm` prefix) present on log output.
- No test for `scope()` called with an empty string or non-string argument.
