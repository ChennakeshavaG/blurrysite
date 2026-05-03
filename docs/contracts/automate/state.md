# automate/state Contract

## Overview

Single source of truth for **ALL automate session state**:
- idle phase (global)
- tab_switch phase (per-tab)
- screen_share map (per-tab)
- suspended triggers (per-trigger)
- suppressed_tabs list (per-tab)
- phase enums per trigger
- `chrome.storage.session` key names
- synchronous read helpers backed by in-memory caches
- async write helpers that update cache, fire subscribers, then persist to session storage
- single `onChanged` listener that updates ALL caches before notifying subscribers
- two subscriber slots: `on_session_change` (Manager) and `on_session_notify` (Model relay)

Loaded in BOTH execution contexts:
- background service worker (top of `background.js` via `importScripts('src/automate/state.js')`)
- content scripts (manifest content_scripts entry, before `src/automate/visibility.js` and the rest)

The module owns no DOM, registers no event listeners apart from one `chrome.storage.onChanged` subscription that keeps caches in sync across contexts. Trigger-specific observers (Idle / Visibility) live in sibling files and call into this module to commit their writes. Background uses State APIs for screen-share lifecycle.

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

`chrome.storage.session` key names. Authoritative — `storage_model.js` resolve reads via State APIs, not raw keys.

```
KEYS.idle              = 'blsi_automate_idle'
KEYS.tab_switch_by_tab = 'blsi_automate_tab_switch_by_tab'
KEYS.screen_share      = 'blsi_screen_share'
KEYS.suppressed_tabs   = 'blsi_automate_suppressed_tabs'
KEYS.suspended         = 'blsi_automate_suspended'
```

### Session storage schema

Both `KEYS.idle` and `KEYS.tab_switch_by_tab` store **object** values (not bare strings / flat maps):

```
blsi_automate_idle = {
  status: 'active' | 'idle' | 'locked',
  ignore_tabs: number[],
  ignore_sites: string[]
}

blsi_automate_tab_switch_by_tab = {
  status: { [tab_id]: 'fired' },
  ignore_tabs: number[],
  ignore_sites: string[]
}
```

```
blsi_automate_suspended = {
  idle: boolean,
  tab_switch: boolean,
  screen_share: boolean
}
```

Default: all `false`. Browser restart clears session storage → all triggers auto-resume.

**Backward compatibility:** old shapes (bare string for idle, flat `{ '42': 'fired' }` map for tab_switch) are normalized on hydrate and in the `onChanged` listener. The normalizer detects old shapes by the absence of `status`/`ignore_tabs`/`ignore_sites` keys and wraps them into the new object shape with empty ignore arrays.

### `read_idle()` → string

Synchronous read of the cached idle phase. Returns one of `PHASES.idle.*` (`'active' | 'idle' | 'locked'`). Reads from the `.status` field of the idle cache object.

Default before any chrome.idle event has fired: `'active'`.

### `read_idle_ignore()` → object

Synchronous read of the idle ignore lists. Returns `{ ignore_tabs: number[], ignore_sites: string[] }` — both arrays are copies (safe to mutate).

### `add_idle_ignore_tab(tab_id)` → Promise

Appends `tab_id` to the idle `ignore_tabs` list. No-op if already present or if `tab_id` is not a finite number.

Side effects: preserves existing `status` and `ignore_sites`; fires subscribers; writes full idle object to session storage.

### `remove_idle_ignore_tab(tab_id)` → Promise

Removes `tab_id` from the idle `ignore_tabs` list. No-op if not present or if `tab_id` is not a number.

### `add_idle_ignore_site(hostname)` → Promise

Appends `hostname` to the idle `ignore_sites` list. No-op if already present, empty, or not a string.

Side effects: preserves existing `status` and `ignore_tabs`; fires subscribers; writes full idle object to session storage.

### `remove_idle_ignore_site(hostname)` → Promise

Removes `hostname` from the idle `ignore_sites` list. No-op if not present, empty, or not a string.

### `read_tab_switch(tab_id)` → string

Synchronous read of the cached tab-switch phase for a specific tab. Reads from the `.status[tab_id]` field of the tab_switch cache object.

Params: `tab_id: number` — the chrome tab id (resolved via `WHO_AM_I` in content).

Returns: `PHASES.tab_switch.off` if no entry exists, otherwise the stored phase string.

Edge cases:
- `tab_id` is not a number → returns `'off'` without throwing.
- Map is empty / not yet hydrated → returns `'off'`.

### `read_all_tab_switch()` → object

Returns a shallow clone of the `.status` sub-object: `{ [tab_id]: phase }`. Used by background or popup to enumerate tabs in the `fired` state.

### `read_tab_switch_ignore()` → object

Synchronous read of the tab_switch ignore lists. Returns `{ ignore_tabs: number[], ignore_sites: string[] }` — both arrays are copies (safe to mutate).

### `add_tab_switch_ignore_tab(tab_id)` → Promise

Appends `tab_id` to the tab_switch `ignore_tabs` list. No-op if already present or if `tab_id` is not a finite number.

Side effects: preserves existing `status` map and `ignore_sites`; fires subscribers; writes full tab_switch object to session storage.

### `remove_tab_switch_ignore_tab(tab_id)` → Promise

Removes `tab_id` from the tab_switch `ignore_tabs` list. No-op if not present or if `tab_id` is not a number.

### `add_tab_switch_ignore_site(hostname)` → Promise

Appends `hostname` to the tab_switch `ignore_sites` list. No-op if already present, empty, or not a string.

Side effects: preserves existing `status` map and `ignore_tabs`; fires subscribers; writes full tab_switch object to session storage.

### `remove_tab_switch_ignore_site(hostname)` → Promise

Removes `hostname` from the tab_switch `ignore_sites` list. No-op if not present, empty, or not a string.

### `write_idle(phase)` → Promise<boolean>

Writes the global idle phase to session storage. Idempotent — if the new value equals the cached value, returns `false` and skips.

Params: `phase: string` — must be one of `PHASES.idle.*`. Non-strings return `false` without writing.

Returns: `Promise<boolean>` — `true` if a storage write happened, `false` if no-op.

Side effects:
- Updates `_idle_cache.status` synchronously, preserving existing `ignore_tabs` and `ignore_sites` arrays.
- Fires subscribers (`_fire_subscribers()`) synchronously — guarantees same-context callers (Manager, Model relay) are notified immediately.
- `chrome.storage.session.set({[KEYS.idle]: _idle_cache})` — writes the full object (status + ignore arrays) — async.
- The onChanged event echoes back in other contexts; the self-echo guard in the local listener skips the update since cache already matches.

### `write_tab_switch(tab_id, phase)` → Promise<boolean>

Writes a tab's phase to the session-storage map.

Params:
- `tab_id: number`
- `phase: string` — one of `PHASES.tab_switch.*`

Returns: `Promise<boolean>` — `true` on write, `false` on no-op or invalid input.

Behavior:
- If `phase === 'off'`, the tab id is REMOVED from the `.status` sub-object (kept small — `'off'` = absence).
- Otherwise the entry is set/replaced in `.status`.
- Existing `ignore_tabs` and `ignore_sites` arrays are preserved.
- Storage write replaces the entire object (status + ignore arrays) under `KEYS.tab_switch_by_tab`.
- Cache updated synchronously; subscribers fired synchronously; storage write async.

Edge cases:
- `tab_id` not a number → no-op.
- `phase` not a string → no-op.
- Cached value already equals `phase` → no-op (no storage write, no subscriber fire).

### `clear_tab_switch(tab_id)` → Promise<boolean>

Convenience alias for `write_tab_switch(tab_id, PHASES.tab_switch.off)`. Used by `chrome.tabs.onRemoved` cleanup in background.

### `get_screen_share_state(opt_tab_id?)` → object

Returns a backward-compatible summary of the per-tab screen-share map. Synchronous.

Params: `opt_tab_id: number` (optional) — when provided and that tab is sharing, `sharing_tab_id` reports that tab; otherwise reports the first sharing tab.

Returns: `{ active: boolean, sharing_tab_id: number|null, started_at: number|null, suppressed_sites: string[], _sharing_tab_ids: number[] }`. `active` is `true` when any tab is sharing. `suppressed_sites` is the union across all sharing tabs. `_sharing_tab_ids` lists all currently-sharing tab ids.

### `set_screen_share_active(tabId)` → Promise

Adds a tab to the per-tab screen-share map. Additive — does not clear other tabs' entries. Each new share clears the suppressed_tabs list (mitigates Chrome tab-id reuse).

Params: `tabId: number` — required. Non-number returns without writing.
Side effects: Updates both screen_share and suppressed_tabs caches; fires subscribers; writes both session keys.

### `set_screen_share_inactive(opt_tabId?)` → Promise

With `opt_tabId: number`: removes only that tab's entry from the map. No-op if the tab is not sharing.
Without argument: clears the entire map (used by `init()` on SW startup to clear stale state).

### `suppress_screen_share_site(hostname, opt_tabId?)` → Promise

With `opt_tabId`: adds `hostname` to that tab's `suppressed_sites[]` only. Without: adds to all sharing tabs. No-op if already suppressed or invalid hostname.

### `unsuppress_screen_share_site(hostname, opt_tabId?)` → Promise

With `opt_tabId`: removes `hostname` from that tab's `suppressed_sites[]` only. Without: removes from all sharing tabs. No-op if not present.

### `get_suppressed_tabs()` → number[]

Returns a copy of the global per-tab automate suppression list. Synchronous.

### `add_suppressed_tab(tab_id)` → Promise

Adds a tab id to the suppression list. Silences ALL automate triggers for that tab. No-op if already present or invalid.

### `remove_suppressed_tab(tab_id)` → Promise

Removes a tab id from the suppression list. No-op if not present.

### `clear_suppressed_tabs()` → Promise

Empties the suppression list. No-op when already empty.

### `read_suspended()` → object

Synchronous read of the cached suspended triggers. Returns `{ idle: boolean, tab_switch: boolean, screen_share: boolean }` — a copy (safe to mutate).

### `suspend_trigger(name)` → Promise

Suspends a trigger by name. `name` must be one of `'idle' | 'tab_switch' | 'screen_share'`; other values return a resolved Promise without writing. Idempotent — if already suspended, no-op.

Side effects: updates `_suspended_cache` synchronously; fires subscribers; writes to session storage.

### `resume_trigger(name)` → Promise

Resumes a suspended trigger by name. `name` must be one of `'idle' | 'tab_switch' | 'screen_share'`; other values return a resolved Promise. Idempotent — if not suspended, no-op.

Side effects: updates `_suspended_cache` synchronously; fires subscribers; writes to session storage.

### `on_session_change(cb)` → void

Register the Manager subscriber. Called with no arguments when any session cache changes. Manager re-evaluates with guaranteed-fresh caches.

Single slot — calling twice replaces the previous subscriber.

### `on_session_notify(cb)` → void

Register the Model relay subscriber. Called with no arguments when any session cache changes. Model relay fires `_on_change` and `_on_automate_change` so content_script re-resolves and Manager re-evaluates on local-model-impacting changes.

Single slot — calling twice replaces the previous subscriber.

### `_reset()` (test-only)

Resets all five caches to their default values and clears both subscriber slots. `_idle_cache` resets to `{ status: 'active', ignore_tabs: [], ignore_sites: [] }`, `_tab_switch_cache` resets to `{ status: {}, ignore_tabs: [], ignore_sites: [] }`, `_screen_share_cache` to `{}`, `_suppressed_tabs_cache` to `[]`, `_suspended_cache` to `{ idle: false, tab_switch: false, screen_share: false }`. Does NOT write to storage. For unit tests starting from a clean slate.

## Internal mechanics

### Cache hydration

On module load, if running in a context with `chrome.storage.session`, the module performs a single `chrome.storage.session.get` for all four keys and seeds the caches from stored values. Fire-and-forget — synchronous reads before hydration completes return default values.

### onChanged listener

Registered BEFORE `_hydrate()` so a write landing between hydrate-issue and hydrate-callback is not dropped.

The listener:
- Checks `chrome.runtime.id` — if `undefined` (extension context invalidated on stale content scripts), removes itself via `chrome.storage.onChanged.removeListener` and returns. This prevents the listener from firing subscribers into a dead context.
- Filters by `area === 'session'`.
- Updates ALL changed caches before firing subscribers (eliminates the race where Manager reads stale data from a separately-ordered listener).
- For idle: skips if new value matches cache (self-echo guard).
- For tab_switch/screen_share/suppressed_tabs: always updates cache (normalized).
- Fires subscribers once at the end if any cache changed.

### Write → subscriber → storage ordering

All write methods follow the same pattern:
1. Update cache synchronously
2. Fire subscribers synchronously (`_fire_subscribers()`)
3. Issue async `chrome.storage.session.set`

This guarantees that same-context subscribers (Manager, Model relay) see fresh data immediately. Cross-context subscribers get notified via `onChanged` when the async write lands. The self-echo guard in the `onChanged` listener prevents double-notification in the originating context.

### Cache vs storage drift

Brief window where cache is ahead of storage — acceptable because writes always go through this module. If a non-State writer mutates a key directly, the onChanged listener picks it up.

## Invariants

- Single source of truth for ALL five `chrome.storage.session` automate keys.
- The two phase enums are frozen (`Object.freeze`).
- The exported `State` object is frozen.
- The module does not import or depend on any other `blsi.*` module.
- No DOM access. No `chrome.tabs.*`, no `chrome.runtime.connect`. Only `chrome.storage.session` and `chrome.storage.onChanged`.
- Write methods return a Promise; callers that don't need the receipt can ignore the return.
- Subscribers fire synchronously on every write, before the async storage operation resolves.

## Cross-file contract

| Caller | Reads | Writes |
|---|---|---|
| `background.js` (via importScripts) | `get_screen_share_state()` | `set_screen_share_active()`, `set_screen_share_inactive()`, `remove_suppressed_tab()`, `clear_suppressed_tabs()`, `clear_tab_switch()` |
| `automate/idle.js` | `PHASES.idle` | `write_idle()` |
| `automate/visibility.js` | `PHASES.tab_switch`, `read_tab_switch()` | `write_tab_switch()` |
| `automate/manager.js` | (via `on_session_change` subscriber) | n/a |
| `storage_model.js` | `get_screen_share_state()`, `get_suppressed_tabs()`, `read_suspended()`, `suppress_screen_share_site()`, `unsuppress_screen_share_site()`, `set_screen_share_inactive()`, `add_suppressed_tab()`, `remove_suppressed_tab()` (via thin wrappers); `on_session_notify` relay registered in `init_cache` | `suspend_trigger()`, `resume_trigger()` |
| `content_script.js` | `read_idle()`, `read_tab_switch()` for status queries | n/a |

## Test strategy

- Mock `chrome.storage.session.get/set` and `chrome.storage.onChanged.addListener` in `tests/setup.js`.
- Each test calls `State._reset()` in `beforeEach`.
- Cover: defaults before hydration, write idempotency, `'off'` strips entry, onChanged listener updates cache on cross-context writes, same-value onChanged is a no-op, screen_share active/inactive lifecycle, suppressed_tabs add/remove/clear, subscriber fire on write.
