# logger Contract

## Overview

Persistent debug logger with cross-context toggle. The enabled state is stored in `chrome.storage.local['blsi_debug']` so enabling in any context (DevTools, popup, background) propagates to all contexts via `chrome.storage.onChanged`. `error()` always fires regardless of the toggle — it is never suppressed.

## Module State

| Variable | Description |
|---|---|
| `_enabled` | `boolean` — whether debug logging is active; loaded from storage on init |
| `PREFIX` | `'[BLSI]'` — prepended to every log line |
| `STORAGE_KEY` | `'blsi_debug'` — chrome.storage.local key for persistence |

**Init block**: At IIFE load, loads persisted state from `chrome.storage.local['blsi_debug']` and registers `chrome.storage.onChanged` to sync state across contexts. Entire init is wrapped in `try/catch` — safe in test environments where `chrome` is unavailable.

## Public API

### log(...args)

**What**: Debug-level log; only fires when logging is enabled.  
**Params**: `...args` — any values  
**Returns**: `void`  
**Side effects**: `console.log(PREFIX, timestamp, ...args)` when `_enabled`  
**Format**: `[BLSI] HH:MM:SS.mmm ...args`

### warn(...args)

**What**: Warning-level log; only fires when logging is enabled.  
**Params**: `...args` — any values  
**Returns**: `void`  
**Side effects**: `console.warn(PREFIX, timestamp, ...args)` when `_enabled`

### error(...args)

**What**: Error-level log; **always fires**, never gated on `_enabled`.  
**Params**: `...args` — any values  
**Returns**: `void`  
**Side effects**: `console.error(PREFIX, timestamp, ...args)` — unconditional

### flow(tag, data?)

**What**: Semantic flow event log; used to trace execution paths.  
**Params**: `tag` (string) — event label; `data` (any, optional) — payload  
**Returns**: `void`  
**Side effects**: `console.log(PREFIX, timestamp, '⟶', tag[, data])` when `_enabled`  
**Handles**: When `data === undefined`, omits it from output (avoids trailing `undefined`).

### scope(name)

**What**: Returns a logger variant with `[name]` inserted into every output line.  
**Params**: `name` (string) — scope label  
**Returns**: `{ log, warn, error, flow, get enabled }` — same interface as root logger  
**Side effects**: Creates a closure; does not persist or store the scope  
**Handles**: Scoped `error()` always logs (like root). All methods close over the module-level `_enabled` (not a copy) — toggling the root logger immediately affects all scopes.

### enable()

**What**: Enables logging and persists the state.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Sets `_enabled = true`; writes `{ blsi_debug: true }` to `chrome.storage.local`; always prints activation confirmation to console.  
**Handles**: `chrome.storage.local.set` wrapped in `try/catch` — safe in test contexts.

### disable()

**What**: Disables logging and persists the state.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Sets `_enabled = false`; writes `{ blsi_debug: false }` to `chrome.storage.local`; always prints deactivation confirmation to console.

### get enabled

**What**: Read-only getter for the current logging state.  
**Returns**: `boolean` — current value of `_enabled`  
**Side effects**: none

## Internal Functions

### _ts()

**What**: Returns a formatted timestamp string for log prefixes.  
**Returns**: `"HH:MM:SS.mmm"` — 24-hour format using `en-GB` locale regardless of system locale, with 3-digit milliseconds.

## Invariants

- `error()` is NEVER gated — it always fires regardless of `_enabled`.
- All scopes share the single `_enabled` module-level variable — toggling via `enable()`/`disable()` instantly affects all active scopes.
- `scope()` does not cache — each call creates a fresh closure. Multiple calls with the same name are independent.
- Cross-context sync: the `chrome.storage.onChanged` listener handles updates from other contexts within the same extension session.
