# automate/state Contract

## Overview

Shared state surface for the `blsi.Automate` module family. Single source of truth for:
- phase enum values per trigger (`idle`, `tab_switch`)
- `chrome.storage.session` key names that carry live automate state
- synchronous read helpers backed by an in-memory cache
- async write helpers that update the cache + persist to session storage
- a subscriber registry that fires on cache transitions

Loaded in BOTH execution contexts:
- background service worker (top of `background.js` via `importScripts('src/automate/state.js')`)
- content scripts (manifest content_scripts entry, before `src/automate/visibility.js` and the rest)

The module owns no DOM, registers no event listeners apart from one `chrome.storage.onChanged` subscription that keeps the cache in sync. Trigger-specific observers (Idle / Visibility / ScreenShare) live in sibling files and call into this module to commit their writes.

Exposed as `blsi.Automate.State` (IIFE — no ES module syntax).

## Public API

### `PHASES` (frozen object)

Phase enums. Single source of truth — sibling modules and `Store.resolve()` import these constants rather than literal-stringifying.

```
PHASES.idle       = { active: 'active', idle: 'idle', locked: 'locked' }
PHASES.tab_switch = { off: 'off', armed: 'armed', fired: 'fired' }
```

`PHASES.idle` values are the literal strings reported by `chrome.idle.IdleState` — kept verbatim so we never translate.

`PHASES.tab_switch.off` is what writes to clear an entry — `write_tab_switch(id, 'off')` strips the key from the map.

### `KEYS` (frozen object)

`chrome.storage.session` key names. Authoritative — `storage_model.js` reads these too.

```
KEYS.idle              = 'blsi_automate_idle'
KEYS.tab_switch_by_tab = 'blsi_automate_tab_switch_by_tab'
KEYS.screen_share      = 'blsi_screen_share'
KEYS.suppressed_tabs   = 'blsi_automate_suppressed_tabs'
```

### `read_idle()` → string

Synchronous read of the cached idle phase. Returns one of `PHASES.idle.*` (`'active' | 'idle' | 'locked'`).

Default before any chrome.idle event has fired: `'active'`.

### `read_tab_switch(tab_id)` → string

Synchronous read of the cached tab-switch phase for a specific tab.

Params: `tab_id: number` — the chrome tab id (resolved via `WHO_AM_I` in content).

Returns: `PHASES.tab_switch.off` if no entry exists, otherwise the stored phase string.

Edge cases:
- `tab_id` is not a number → returns `'off'` without throwing.
- Map is empty / not yet hydrated → returns `'off'`.

### `read_all_tab_switch()` → object

Returns a shallow clone of the per-tab map: `{ [tab_id]: phase }`. Used by background or popup to enumerate tabs in the `fired` state.

### `write_idle(phase)` → Promise<boolean>

Writes the global idle phase to session storage. Idempotent — if the new value equals the cached value, returns `false` and skips the storage write.

Params: `phase: string` — must be one of `PHASES.idle.*` for resolve to behave correctly. Non-strings return `false` without writing.

Returns: `Promise<boolean>` — `true` if a storage write happened, `false` if no-op.

Side effects:
- Updates `_idle_cache` synchronously (before the storage write completes) so subsequent `read_idle()` calls within the same tick reflect the new value.
- `chrome.storage.session.set({[KEYS.idle]: phase})`.
- Triggers `chrome.storage.onChanged` in this and every other tab/SW; subscribers registered via `on_change` will fire.

### `write_tab_switch(tab_id, phase)` → Promise<boolean>

Writes a tab's phase to the session-storage map.

Params:
- `tab_id: number`
- `phase: string` — one of `PHASES.tab_switch.*`

Returns: `Promise<boolean>` — `true` on write, `false` on no-op or invalid input.

Behavior:
- If `phase === 'off'`, the tab id is REMOVED from the map (kept small — `'off'` = absence).
- Otherwise the entry is set/replaced.
- Storage write replaces the entire map under `KEYS.tab_switch_by_tab`.
- Cache updated synchronously before the storage write resolves.

Edge cases:
- `tab_id` not a number → no-op.
- `phase` not a string → no-op.
- Cached value already equals `phase` → no-op (no storage write).

### `clear_tab_switch(tab_id)` → Promise<boolean>

Convenience alias for `write_tab_switch(tab_id, PHASES.tab_switch.off)`. Used by `chrome.tabs.onRemoved` cleanup in background.

### `on_change(fn)` → unsubscribe function

Registers a listener fired on every cache transition (idle key changed, or per-tab map changed).

Params: `fn(key, old_value, new_value)` — called with the `KEYS.*` constant, the previous cache value, and the new cache value.

Returns: a zero-arg unsubscribe function. Calling it removes `fn` from the registry.

Behavior:
- Multiple subscribers allowed (unlike `blsi.Model.on_change` which is single-slot).
- Errors thrown inside a subscriber are swallowed — one bad listener does not break the others.
- `key` is one of `KEYS.idle` or `KEYS.tab_switch_by_tab` (screen_share / suppressed_tabs aren't routed through this module yet).
- Fires only on actual transitions — same-value writes do not fire subscribers.

### `_reset()` (test-only)

Clears `_idle_cache`, the per-tab map, and the subscriber registry. Does NOT write to storage. For unit tests starting from a clean slate.

## Internal mechanics

### Cache hydration

On module load, if running in a context with `chrome.storage.session`, the module performs a single `chrome.storage.session.get([KEYS.idle, KEYS.tab_switch_by_tab])` and seeds the caches from the stored values. This is fire-and-forget — synchronous reads before hydration completes return the default values (`'active'` for idle, `'off'` for any tab).

### onChanged listener

The module registers exactly one `chrome.storage.onChanged` listener (only when the API is available — in test environments without chrome stubs the listener is skipped and the module operates as in-memory only).

The listener:
- Filters by `area === 'session'`.
- Per-key: if the new value differs from the cached value, updates the cache and fires the change-listener registry.
- For `KEYS.tab_switch_by_tab`, tolerates missing/non-object newValue (treated as empty map).

### Cache vs storage drift

Writes update the cache synchronously, then issue the async storage `set`. The onChanged event echoes back; the listener's "value differs from cache" check makes it a no-op. There is a brief window where the cache is ahead of storage — acceptable for our access patterns (writes always go through this module, no other writer races us for these keys).

If a non-State writer mutates `KEYS.idle` directly via `chrome.storage.session.set`, the onChanged listener picks it up and updates the cache. State has no exclusive lock on the key.

## Invariants

- `KEYS.*` names match what `storage_model.js` reads. Renaming a key requires updating both files.
- The two phase enums are frozen (`Object.freeze`).
- The exported `State` object is frozen.
- The module does not import or depend on any other `blsi.*` module (it's the foundation; siblings depend on it, not the other way).
- No DOM access. No `chrome.tabs.*`, no `chrome.runtime.connect`. Only `chrome.storage.session` and `chrome.storage.onChanged`.
- `write_*` returns `Promise<boolean>` regardless of context — callers that don't need the receipt can ignore the return.
- `on_change` subscribers are NOT idempotent across multiple registrations — passing the same function twice subscribes twice. Caller responsibility.

## Cross-file contract

| Caller | Reads | Writes |
|---|---|---|
| `background.js` (via importScripts) | `read_idle()` for any debugging | n/a |
| `automate/idle.js` | `PHASES.idle`, `KEYS.idle` | `write_idle()` |
| `automate/visibility.js` | `PHASES.tab_switch`, `read_tab_switch()` | `write_tab_switch()` |
| `automate/screen_share.js` | `KEYS.screen_share`, `KEYS.suppressed_tabs` | (uses `chrome.storage.session.set` directly for the global record; deferred refactor) |
| `storage_model.js` | `KEYS.*` for the resolve fold | n/a |
| `content_script.js` | `read_idle()`, `read_tab_switch()` for status queries | n/a |

## Test strategy

- Mock `chrome.storage.session.get/set` and `chrome.storage.onChanged.addListener` in `tests/setup.js`.
- Each test calls `State._reset()` in `beforeEach`.
- Cover: defaults before hydration, write idempotency, `'off'` strips entry, on_change firing on real transitions, on_change skipping no-op writes, multiple subscribers, error in one subscriber doesn't break others, unsubscribe.
