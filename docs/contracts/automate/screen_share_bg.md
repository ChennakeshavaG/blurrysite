# automate/screen_share_bg Contract

## Overview

Background-only screen-share port and message handler. Owns the `'blsi-screen-share'` port lifecycle, handles `SCREEN_SHARE_STARTED` / `SCREEN_SHARE_ENDED` / `WHO_AM_I` messages, broadcasts `SCREEN_SHARE_NOTIFY` to content tabs, and clears stale session state on service worker startup.

Calls `blsi.Automate.State` APIs to manage the `blsi_screen_share` session record and `blsi_automate_suppressed_tabs` list. Content tabs read state via State's in-memory caches + `chrome.storage.session.onChanged`.

Loaded in BACKGROUND service worker only (importScripts in background.js). Depends on `blsi.Automate.State` and `blsi.command`.

Exposed as `blsi.Automate.ScreenShareBg` (IIFE — no ES module syntax).

## Module State

| Variable | Description |
|---|---|
| `_sharePorts` | `Map<number, Port>` — tabId → port; in-memory, empty on SW restart |
| `_connect_listener` | `Function\|null` — bound `chrome.runtime.onConnect` listener |
| `_message_listener` | `Function\|null` — bound `chrome.runtime.onMessage` listener |

## Public API

### init()

**What**: Clears stale session state and registers port + message listeners.
**Params**: none
**Returns**: `void`
**Side effects**:
- Calls `State.set_screen_share_inactive()` — clears any stale session record from prior SW lifetime
- Calls `State.clear_suppressed_tabs()` — clears suppressed tab list (Chrome may reuse tab ids)
- Registers `chrome.runtime.onConnect` listener for port `'blsi-screen-share'`
- Registers `chrome.runtime.onMessage` listener for STARTED/ENDED/WHO_AM_I

**Edge cases**:
- `State` unavailable (null) → no-op; module exports stay defined but init does nothing
- SW restart mid-share: session record cleared by init, then port reconnection from content restores active state via the onConnect handler

### destroy()

**What**: Removes the onConnect and onMessage listeners.
**Params**: none
**Returns**: `void`
**Side effects**: Calls `removeListener` on both chrome.runtime listener APIs. Nulls references.

## Internal mechanics

### Port handler (`_onConnect`)

On port connection with `name === 'blsi-screen-share'`:
1. Extracts `tabId` from `port.sender.tab.id`; ignores if missing
2. Stores port in `_sharePorts` Map (replaces any prior port for same tab)
3. Calls `State.set_screen_share_active(tabId)` — writes session record
4. Registers `port.onDisconnect` handler:
   - Removes port from `_sharePorts`
   - Calls `State.set_screen_share_inactive(tabId)` → removes only that tab's entry from the per-tab map
   - Broadcasts `SCREEN_SHARE_NOTIFY` to all tabs

Ports with names other than `'blsi-screen-share'` are ignored (returns immediately).

### Message handler (`_onMessage`)

| Message type | Behavior | Return |
|---|---|---|
| `SCREEN_SHARE_STARTED` | `State.set_screen_share_active(sender.tab.id)` + broadcast NOTIFY (excluding sender) + `sendResponse({ ok: true })` | `true` (async) |
| `SCREEN_SHARE_ENDED` | `State.set_screen_share_inactive(sender.tab.id)` + broadcast NOTIFY + `sendResponse({ ok: true })` | `true` (async) |
| `WHO_AM_I` | `sendResponse({ tab_id: sender.tab.id \|\| null })` | `false` (sync) |
| Any other type | No action | `undefined` (does not interfere with other listeners) |

### Broadcast (`_broadcastScreenShareNotify`)

Queries all tabs via `chrome.tabs.query({})` and sends `{ type: SCREEN_SHARE_NOTIFY }` to each, optionally excluding one tab id (the sharing tab, to avoid self-notification). Errors silently caught per-tab.

## Invariants

- Session record is always cleared on SW startup before listeners register — prevents stale "active" state from a crashed prior session
- Port disconnect is the crash-safety signal: even if `SCREEN_SHARE_ENDED` message never arrives (tab crash, navigation), `onDisconnect` fires and clears the record
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
- Stub `blsi.Automate.State` methods: `set_screen_share_active`, `set_screen_share_inactive`, `clear_suppressed_tabs`.
- Cover: init clears stale state + registers listeners; port connect sets active; port disconnect clears + broadcasts; wrong port name ignored; STARTED message sets active + broadcasts; ENDED message clears + broadcasts; WHO_AM_I returns tab id; unhandled message returns undefined; destroy removes listeners.
