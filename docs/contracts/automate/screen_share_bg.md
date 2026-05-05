# automate/screen_share_bg Contract

## Overview

Background-only screen-share port and message handler. Owns the `'blsi-ss-*'` port lifecycle, handles `SCREEN_SHARE_STARTED` / `SCREEN_SHARE_ENDED` / `WHO_AM_I` messages, broadcasts `SCREEN_SHARE_NOTIFY` to content tabs, and clears stale session state on service worker startup.

Tracks per-stream ports (keyed by port name `'blsi-ss-<streamId>'`) so multiple concurrent shares from the same tab are independent. When one stream's port disconnects, the handler checks whether the tab has any remaining active ports before deciding whether to clear the tab entirely or just remove one stream.

Calls `blsi.Automate.State` APIs to manage the `blsi_screen_share` session record and `blsi_automate_suppressed_tabs` list. Content tabs read state via State's in-memory caches + `chrome.storage.session.onChanged`.

Loaded in BACKGROUND service worker only (importScripts in background.js). Depends on `blsi.Automate.State` and `blsi.command`.

Exposed as `blsi.Automate.ScreenShareBg` (IIFE — no ES module syntax).

## Module State

| Variable | Description |
|---|---|
| `_sharePorts` | `Map<string, { tabId: number, port: Port }>` — keyed by port name (`'blsi-ss-<streamId>'`); in-memory, empty on SW restart |
| `_connect_listener` | `Function\|null` — bound `chrome.runtime.onConnect` listener |
| `_message_listener` | `Function\|null` — bound `chrome.runtime.onMessage` listener |

## Public API

### init()

**What**: Reconciles stale session state and registers port + message listeners.
**Params**: none
**Returns**: `void`
**Side effects**:
- Calls `_reconcile_stale_shares()` — queries live tabs and removes screen-share entries and suppressed-tab entries for tabs that no longer exist. Preserves active shares for tabs that are still open (survives SW idle/wake cycle).
- Registers `chrome.runtime.onConnect` listener for port `'blsi-screen-share'`
- Registers `chrome.runtime.onMessage` listener for STARTED/ENDED/WHO_AM_I

**Edge cases**:
- `State` unavailable (null) → no-op; module exports stay defined but init does nothing
- SW restart mid-share: session record preserved by reconcile (tab still exists); port reconnection from content re-establishes the port via onConnect handler
- Tab closed while SW was idle: reconcile detects the dead tab id via `chrome.tabs.query` and removes only that entry

### destroy()

**What**: Removes the onConnect and onMessage listeners.
**Params**: none
**Returns**: `void`
**Side effects**: Calls `removeListener` on both chrome.runtime listener APIs. Nulls references.

## Internal mechanics

### Port handler (`_onConnect`)

On port connection with `name` starting with `'blsi-ss-'`:
1. Extracts `tabId` from `port.sender.tab.id`; ignores if missing
2. Stores `{ tabId, port }` in `_sharePorts` Map keyed by `port.name`
3. Calls `State.set_screen_share_active(tabId, port.name)` — writes per-stream session record
4. Registers `port.onDisconnect` handler:
   - Removes port from `_sharePorts`
   - Calls `_tabHasActivePorts(tabId)` — iterates remaining Map values looking for same tabId
   - If tab has more active ports: `State.remove_stream(tabId, port.name)` (removes only that stream)
   - If tab has no more ports: `State.set_screen_share_inactive(tabId)` (removes entire tab entry)
   - Broadcasts `SCREEN_SHARE_NOTIFY` to all tabs

Ports with names not starting with `'blsi-ss-'` are ignored (returns immediately).

### `_tabHasActivePorts(tabId)` (internal)

Iterates `_sharePorts` Map values looking for any entry with matching `tabId`. Returns `true` if at least one other port exists for that tab. Used by the disconnect handler to decide between `remove_stream` (partial) and `set_screen_share_inactive` (full tab clear).

### Message handler (`_onMessage`)

| Message type | Behavior | Return |
|---|---|---|
| `SCREEN_SHARE_STARTED` | Reads `message.streamId`; derives `streamKey = 'blsi-ss-' + streamId`; `State.set_screen_share_active(sender.tab.id, streamKey)` + broadcast NOTIFY (excluding sender) + `sendResponse({ ok: true })` | `true` (async) |
| `SCREEN_SHARE_ENDED` | Reads `message.streamId`; derives `endStreamKey = 'blsi-ss-' + streamId`; checks `_tabHasActivePorts(tabId)` — if tab has more ports: `State.remove_stream(tabId, endStreamKey)`; otherwise: `State.set_screen_share_inactive(tabId)` + broadcast NOTIFY + `sendResponse({ ok: true })` | `true` (async) |
| `WHO_AM_I` | `sendResponse({ tab_id: sender.tab.id \|\| null })` | `false` (sync) |
| Any other type | No action | `undefined` (does not interfere with other listeners) |

### Broadcast (`_broadcastScreenShareNotify`)

Queries all tabs via `chrome.tabs.query({})` and sends `{ type: SCREEN_SHARE_NOTIFY }` to each, optionally excluding one tab id (the sharing tab, to avoid self-notification). Errors silently caught per-tab.

## Invariants

- Session records are reconciled on SW startup — entries for tabs that no longer exist are removed; active shares for live tabs are preserved across SW idle/wake cycles
- Port disconnect is the crash-safety signal: even if `SCREEN_SHARE_ENDED` message never arrives (tab crash, navigation), `onDisconnect` fires and clears only that stream's record (or the entire tab if it was the last stream)
- Multiple streams from the same tab are tracked independently — ending one does not affect the other
- `_onMessage` returns `undefined` for unhandled message types — does not interfere with other `chrome.runtime.onMessage` listeners in background.js
- `_sharePorts` is in-memory only — always empty on SW restart; repopulated by reconnecting content scripts
- The exported `ScreenShareBg` object is frozen

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `background.js` (top-level) | `init()` | After `Idle.init()` at SW load |
| `automate/screen_share.js` (content) | triggers via port + messages | Share start/end/whoAmI |
| `background.js` tab-close handler | N/A — cleanup via `State.remove_suppressed_tab` directly | Tab removed |

## Test strategy

- Mock `chrome.runtime.onConnect`, `chrome.runtime.onMessage`, `chrome.tabs.query`, `chrome.tabs.sendMessage`.
- Stub `blsi.Automate.State` methods: `set_screen_share_active`, `set_screen_share_inactive`, `remove_stream`, `clear_suppressed_tabs`.
- Cover: init clears stale state + registers listeners; port connect (blsi-ss-* name) sets active; port disconnect clears stream or tab + broadcasts; wrong port name prefix ignored; STARTED message (with streamId) sets active + broadcasts; ENDED message clears + broadcasts; WHO_AM_I returns tab id; unhandled message returns undefined; per-tab isolation (two tabs independent); per-stream isolation (two streams same tab — ending one keeps tab active, ending last clears tab); destroy removes listeners.
