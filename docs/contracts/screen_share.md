# screen_share Contract

## Overview

Isolated-world bridge between the MAIN-world screen-share interceptor (`main_world_bridge.js`) and the background service worker. Listens for `'__blsi_screen_share'` CustomEvents on `document`, then relays share start/end to background via a persistent port (`'blsi-screen-share'`) and runtime messages. Port lifetime equals the share's lifetime — port disconnect in background triggers the crash-safety SCREEN_SHARE_UNBLUR fan-out.

Only detects web-app screen shares via `getDisplayMedia`. OS-level captures (Zoom desktop, Discord) are not detectable via browser APIs.

## Module State

| Variable | Description |
|---|---|
| `_handler` | `Function\|null` — bound `'__blsi_screen_share'` event handler |
| `_sharePort` | `chrome.runtime.Port\|null` — open port for the duration of a share |

## Public API

### init()

**What**: Registers the `'__blsi_screen_share'` CustomEvent listener on `document`. Calls `destroy()` first — idempotent.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Registers `document.addEventListener('__blsi_screen_share', _handler)`  
**Handles**: If already initialized, destroys previous listener before adding new one.

**On share start** (`e.detail.active === true`):
- Opens a persistent port: `chrome.runtime.connect({ name: 'blsi-screen-share' })`
- Sends `{ type: blsi.command.screen_share_started }` to background
- background.js `onConnect` registers the port; `onDisconnect` fans out `SCREEN_SHARE_UNBLUR` as crash-safety net

**On share end** (`e.detail.active === false`):
- Disconnects port first (triggers background `onDisconnect` → fan-out of `SCREEN_SHARE_UNBLUR`)
- Sends `{ type: blsi.command.screen_share_ended }` as redundant cleanup signal
- Nulls `_sharePort`

### destroy()

**What**: Disconnects any open share port and removes the event listener.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Calls `_sharePort.disconnect()` if open; removes `'__blsi_screen_share'` listener; nulls `_handler` and `_sharePort`  
**Handles**: Idempotent — safe when port is null or listener not registered.

## Invariants

- Port disconnect (crash, navigation, normal end) triggers background's `onDisconnect` fan-out — this is the crash-safety net for SCREEN_SHARE_UNBLUR.
- Port is always disconnected before the listener is removed in `destroy()` — prevents orphaned ports.
- The sharing tab itself is NOT blurred — background's fan-out logic excludes the sender tab.
- `sendMessage` calls use `.catch(function() {})` — safe for cases where background is not yet ready.
