# automate/screen_share Contract

## Overview

Isolated-world bridge between the MAIN-world screen-share interceptor (`main_world_bridge.js`) and the background service worker. Listens for `window.postMessage` messages with `type: '__blsi_screen_share'` and a `streamId` field, then relays share start/end to background via per-stream persistent ports (`'blsi-ss-<streamId>'`) and runtime messages that include the `streamId`.

Background owns the live-share state record (`chrome.storage.session.blsi_screen_share`); content tabs read it via storage onChanged + `blsi.Automate.State` caches. Each port's lifetime equals one stream's lifetime — port disconnect in background clears only that stream's record and broadcasts `SCREEN_SHARE_NOTIFY` as a UI ping.

Multiple concurrent shares from the same tab are tracked independently via `stream.id` (browser-assigned GUID from `MediaStream.id`, threaded through postMessage from the MAIN world bridge).

Only detects web-app screen shares via `getDisplayMedia`. OS-level captures (Zoom desktop, Discord) are not detectable via browser APIs.

Loaded in ISOLATED world content scripts (manifest.json content_scripts). Depends on `blsi.command` (from constants.js). State reference (`blsi.Automate.State`) is resolved at load time for future use but not currently called.

Exposed as `blsi.Automate.ScreenShare` (IIFE — no ES module syntax).

## Module State

| Variable | Description |
|---|---|
| `_handler` | `Function\|null` — bound `window 'message'` event handler (filters on `data.type === '__blsi_screen_share'` + requires `data.streamId`) |
| `_sharePorts` | `Object` — `{ [streamId]: chrome.runtime.Port }` — per-stream port map; keyed by `stream.id` from postMessage |
| `_myTabId` | `number\|null` — this tab's id, resolved via WHO_AM_I round-trip |
| `_whoAmIPromise` | `Promise\|null` — in-flight WHO_AM_I round-trip; cached so `whoAmI()` is idempotent |

## Public API

### init()

**What**: Kicks off a (idempotent) WHO_AM_I round-trip and registers a `window 'message'` listener that filters on `e.data.type === '__blsi_screen_share'` and requires `e.data.streamId`. Idempotent — if `_handler` is already registered, returns immediately without destroying active ports or re-registering.
**Params**: none
**Returns**: `void`
**Side effects**: Fires `whoAmI()` (fire-and-forget); registers `window.addEventListener('message', _handler)`.

**On share start** (`e.data.active === true`):
- Reads `streamId` from `e.data.streamId` (browser-assigned `stream.id` GUID); messages without `streamId` are silently dropped
- Opens a per-stream persistent port: `chrome.runtime.connect({ name: 'blsi-ss-' + streamId })`
- Stores port in `_sharePorts[streamId]`
- Sends `{ type: blsi.command.screen_share_started, streamId }` to background
- Background writes the per-stream session record and broadcasts `SCREEN_SHARE_NOTIFY` to all other tabs

**On share end** (`e.data.active === false`):
- Reads `streamId` from `e.data.streamId`; looks up `_sharePorts[streamId]`
- If port exists: disconnects it (background's `onDisconnect` clears only that stream's record + broadcasts NOTIFY as crash-safety) and deletes from `_sharePorts`
- If no port for that stream: no disconnect call (end without prior start, or duplicate end)
- Sends `{ type: blsi.command.screen_share_ended, streamId }` as a redundant cleanup signal

**Extension context invalidated**: The entire handler body is wrapped in try-catch. On stale content scripts (after extension reload without tab reload), `chrome.runtime.connect` throws — the catch swallows silently. The MAIN-world bridge still fires postMessages but they are harmlessly dropped.

### destroy()

**What**: Disconnects ALL open share ports and removes the event listener.
**Params**: none
**Returns**: `void`
**Side effects**: Iterates `Object.keys(_sharePorts)`, disconnects each port, resets `_sharePorts` to `{}`; removes `window 'message'` listener; nulls `_handler` (does NOT clear `_myTabId` — tab id stays cached for the document lifetime).
**Handles**: Idempotent — safe when no ports are open or listener not registered.

### whoAmI()

**What**: Resolves and caches this tab's id via a WHO_AM_I round-trip with the background service worker. Idempotent — multiple callers share one in-flight promise.
**Params**: none
**Returns**: `Promise<number|null>` — the cached `_myTabId`. Resolves to `null` on transient SW failures (e.g. cold-start race); the cache stays `null` and the next call retries.
**Side effects**: One `chrome.runtime.sendMessage({ type: WHO_AM_I })` per cold cache.

### getTabId()

**What**: Synchronous accessor for the cached tab id.
**Returns**: `number|null` — `null` until `whoAmI()` resolves.

## Invariants

- Per-stream port disconnect (crash, navigation, normal end) triggers background's `onDisconnect` → clears only that stream's session record + broadcasts NOTIFY. This is the crash-safety net.
- All ports are disconnected before the listener is removed in `destroy()` — prevents orphaned ports.
- Multiple concurrent shares from the same tab are fully independent — ending one does not affect the other.
- The sharing tab itself is NOT blurred — `Store.resolve()` skips the screen-share trigger when `tab_id === sharing_tab_id`. (Background also broadcasts NOTIFY excluding the sender tab, but the resolve-side check is the authoritative gate.)
- `whoAmI()` is fired before content_script's first `applyState` so `Store.resolve()` can identify the sharing tab on the very first sync.
- `sendMessage` calls use `.catch(function() {})` — safe for cases where background is not yet ready.
- Messages without `streamId` are silently dropped (guard at top of handler).
- The exported `ScreenShare` object is frozen.

## Cross-file contract

| Caller | Method | When |
|---|---|---|
| `content_script.js` applyState | `init()` / `destroy()` | screen_share.enabled toggles on/off |
| `content_script.js` init | `whoAmI()` | Before first resolve (main frame only) |
| `content_script.js` various | `getTabId()` | Resolve calls needing tab id for suppression |

## Test strategy

- Mock `chrome.runtime.sendMessage`, `chrome.runtime.connect`, `document.addEventListener/removeEventListener`.
- Cover: init registers listener; init is idempotent; whoAmI sends WHO_AM_I + caches; share start opens per-stream port + sends message with streamId; share end disconnects that stream's port + sends message with streamId; two streams tracked independently (ending one does not disconnect the other); destroy disconnects all ports + removes listener; destroy is idempotent; getTabId returns null before resolve, number after; messages without streamId are dropped.
