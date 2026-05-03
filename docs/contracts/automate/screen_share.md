# automate/screen_share Contract

## Overview

Isolated-world bridge between the MAIN-world screen-share interceptor (`main_world_bridge.js`) and the background service worker. Listens for `window.postMessage` messages with `type: '__blsi_screen_share'`, then relays share start/end to background via a persistent port (`'blsi-screen-share'`) and runtime messages.

Background owns the live-share state record (`chrome.storage.session.blsi_screen_share`); content tabs read it via storage onChanged + `blsi.Automate.State` caches. Port lifetime equals the share's lifetime — port disconnect in background clears the record and broadcasts `SCREEN_SHARE_NOTIFY` as a UI ping.

Only detects web-app screen shares via `getDisplayMedia`. OS-level captures (Zoom desktop, Discord) are not detectable via browser APIs.

Loaded in ISOLATED world content scripts (manifest.json content_scripts). Depends on `blsi.command` (from constants.js). State reference (`blsi.Automate.State`) is resolved at load time for future use but not currently called.

Exposed as `blsi.Automate.ScreenShare` (IIFE — no ES module syntax).

## Module State

| Variable | Description |
|---|---|
| `_handler` | `Function\|null` — bound `window 'message'` event handler (filters on `data.type === '__blsi_screen_share'`) |
| `_sharePort` | `chrome.runtime.Port\|null` — open port for the duration of a share |
| `_myTabId` | `number\|null` — this tab's id, resolved via WHO_AM_I round-trip |
| `_whoAmIPromise` | `Promise\|null` — in-flight WHO_AM_I round-trip; cached so `whoAmI()` is idempotent |

## Public API

### init()

**What**: Kicks off a (idempotent) WHO_AM_I round-trip and registers a `window 'message'` listener that filters on `e.data.type === '__blsi_screen_share'`. Idempotent — if `_handler` is already registered, returns immediately without destroying the active port or re-registering.
**Params**: none
**Returns**: `void`
**Side effects**: Fires `whoAmI()` (fire-and-forget); registers `window.addEventListener('message', _handler)`.

**On share start** (`e.data.active === true`):
- Opens a persistent port: `chrome.runtime.connect({ name: 'blsi-screen-share' })`
- Sends `{ type: blsi.command.screen_share_started }` to background
- Background writes the session record (`active: true`, `sharing_tab_id: sender.tab.id`, `started_at: now`) and broadcasts `SCREEN_SHARE_NOTIFY` to all other tabs

**On share end** (`e.data.active === false`):
- Disconnects port first (background's `onDisconnect` clears the session record + broadcasts NOTIFY as crash-safety)
- Sends `{ type: blsi.command.screen_share_ended }` as a redundant cleanup signal
- Nulls `_sharePort`

**Extension context invalidated**: The entire handler body is wrapped in try-catch. On stale content scripts (after extension reload without tab reload), `chrome.runtime.connect` throws — the catch swallows silently. The MAIN-world bridge still fires postMessages but they are harmlessly dropped.

### destroy()

**What**: Disconnects any open share port and removes the event listener.
**Params**: none
**Returns**: `void`
**Side effects**: Calls `_sharePort.disconnect()` if open; removes `window 'message'` listener; nulls `_handler` and `_sharePort` (does NOT clear `_myTabId` — tab id stays cached for the document lifetime).
**Handles**: Idempotent — safe when port is null or listener not registered.

### whoAmI()

**What**: Resolves and caches this tab's id via a WHO_AM_I round-trip with the background service worker. Idempotent — multiple callers share one in-flight promise.
**Params**: none
**Returns**: `Promise<number|null>` — the cached `_myTabId`. Resolves to `null` on transient SW failures (e.g. cold-start race); the cache stays `null` and the next call retries.
**Side effects**: One `chrome.runtime.sendMessage({ type: WHO_AM_I })` per cold cache.

### getTabId()

**What**: Synchronous accessor for the cached tab id.
**Returns**: `number|null` — `null` until `whoAmI()` resolves.

## Invariants

- Port disconnect (crash, navigation, normal end) triggers background's `onDisconnect` → clears the session record + broadcasts NOTIFY. This is the crash-safety net.
- Port is always disconnected before the listener is removed in `destroy()` — prevents orphaned ports.
- The sharing tab itself is NOT blurred — `Store.resolve()` skips the screen-share trigger when `tab_id === sharing_tab_id`. (Background also broadcasts NOTIFY excluding the sender tab, but the resolve-side check is the authoritative gate.)
- `whoAmI()` is fired before content_script's first `applyState` so `Store.resolve()` can identify the sharing tab on the very first sync.
- `sendMessage` calls use `.catch(function() {})` — safe for cases where background is not yet ready.
- The exported `ScreenShare` object is frozen.

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `content_script.js` applyState | `init()` / `destroy()` | screen_share.enabled toggles on/off |
| `content_script.js` init | `whoAmI()` | Before first resolve (main frame only) |
| `content_script.js` various | `getTabId()` | Resolve calls needing tab id for suppression |

## Test strategy

- Mock `chrome.runtime.sendMessage`, `chrome.runtime.connect`, `document.addEventListener/removeEventListener`.
- Cover: init registers listener; init is idempotent (calls destroy first); whoAmI sends WHO_AM_I + caches; share start opens port + sends message; share end disconnects port + sends message; destroy disconnects port + removes listener; destroy is idempotent; getTabId returns null before resolve, number after.
