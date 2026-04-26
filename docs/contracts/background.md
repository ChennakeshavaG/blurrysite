# background Contract

## Overview

MV3 service worker. Stateless between wake cycles — no module-level mutable state except `_sharePorts` (which is empty on every SW restart by design). Handles: keyboard command relay, context menu management, screenshot capture relay, and screen share port tracking + fan-out. All storage I/O is handled by `storage_model.js` in content script and popup contexts — no storage reads/writes in background except for `blsi_screen_share_active` session flag.

## Initialization (Top-Level SW Start)

On every SW start:
1. Clears `blsi_screen_share_active` in `chrome.storage.session` — prevents stale flag after mid-share SW restart. If a share is actually in progress, `screen_share.js` will reconnect the port and re-set the flag.
2. Imports `src/constants.js`, `src/logger.js`, `src/action_registry.js` via `importScripts`.
3. Builds `COMMAND_TO_MESSAGE` map from `blsi.Actions.list()`.

## Module-Level State

| Variable | Description |
|---|---|
| `_sharePorts` | `Map<tabId, port>` — in-memory only, ALWAYS empty on SW restart |
| `COMMAND_TO_MESSAGE` | Frozen `{ chromeCommandName: messageType }` map, auto-built from action registry |
| `log` | Scoped logger: `blsi.Logger.scope('bg')` |

## Lifecycle Events

### `chrome.runtime.onInstalled`

**What**: Calls `createContextMenus()` and removes stale storage keys from pre-refactor versions.  
**Stale keys removed**: `blurred_selectors`, `settings`, `rules`, `blurred_items`, `blur_all_hosts`

### `chrome.runtime.onStartup`

**What**: Calls `createContextMenus()` to recreate menus after browser restart.

## Functions

### createContextMenus()

**What**: Removes all existing context menus and recreates the full set.  
**Side effects**: Calls `chrome.contextMenus.removeAll()` then creates 6 items:
- `bl-si-blur-element` — "Blur this element" (all contexts)
- `bl-si-unblur-element` — "Unblur this element" (all contexts)
- `bl-si-blur-selection` — "Blur selected text" (selection context only)
- `bl-si-settings-sep` — separator
- `bl-si-settings-panel` — "Open Settings Panel" (all contexts)
- `bl-si-settings-tab` — "Open Settings in Tab" (all contexts)

**Note**: Context menu blur/unblur sends message to tab but does not capture `targetElementId` — content script uses `lastContextMenuTarget` (set by `contextmenu` event listener in content_script.js).

### _openSettingsOrPanel(tab)

**What**: Routes "Open Settings Panel" to the correct destination based on window type.  
**Params**: `tab` — chrome Tab object  
**Returns**: `Promise<void>`  
**Logic**: If `tab.windowId` is a PWA app window (`win.type === 'app'`) → sends `TOGGLE_PANEL` message to content script (toggles in-page shadow DOM panel). Otherwise → opens `popup/popup.html` as a new tab.  
**Handles**: `chrome.windows.get` failure → falls through to tab open.

## Event Handlers

### `chrome.contextMenus.onClicked`

Routes context menu clicks:
- `bl-si-blur-element` → `sendMessage(CONTEXT_BLUR)` to tab
- `bl-si-unblur-element` → `sendMessage(CONTEXT_UNBLUR)` to tab
- `bl-si-blur-selection` → `sendMessage(BLUR_SELECTION)` to tab
- `bl-si-settings-panel` → `_openSettingsOrPanel(tab)`
- `bl-si-settings-tab` → `chrome.tabs.create(popup.html)`

### `chrome.commands.onCommand`

**What**: Relays keyboard commands from `chrome://extensions/shortcuts` to active tab.  
**COMMAND_TO_MESSAGE**: Auto-built from `blsi.Actions.list()` — any action with a `chromeCommand` field is automatically wired. Adding an action with `chromeCommand` automatically creates the relay without editing background.js.  
**Special case**: `'open-settings'` command → `_openSettingsOrPanel(activeTab)`.

### `chrome.runtime.onConnect`

**What**: Tracks `'blsi-screen-share'` ports; each port's lifetime equals a screen share session.  
**On connect**: Records port in `_sharePorts[tabId]`; sets `blsi_screen_share_active: true` in session storage (handles SW-restart-mid-share reconnect).  
**On disconnect**: Removes port from `_sharePorts`; clears `blsi_screen_share_active`; fans out `SCREEN_SHARE_UNBLUR` to ALL tabs — this is the crash-safety net for when the sharing tab crashes/closes/navigates.

### `chrome.runtime.onMessage`

Handles 3 message types:

**`CAPTURE_VIEWPORT`**: Calls `chrome.tabs.captureVisibleTab(null, { format: 'png' })` → responds `{ dataUrl }` or `{ error }`. Returns `true` (async sendResponse).

**`SCREEN_SHARE_STARTED`**: Sets `blsi_screen_share_active: true` in session; fans out `SCREEN_SHARE_BLUR` to all tabs EXCEPT sender. Returns `true`.

**`SCREEN_SHARE_ENDED`**: Clears `blsi_screen_share_active`; fans out `SCREEN_SHARE_UNBLUR` to ALL tabs. Returns `true`.

## Screen Share Architecture

```
[page JS]   → getDisplayMedia() call
              ↓ (main_world_bridge.js patches)
[MAIN world] → '__blsi_screen_share' CustomEvent on document
              ↓ (screen_share.js listens)
[isolated]  → opens port 'blsi-screen-share'
              → sendMessage(SCREEN_SHARE_STARTED)
              ↓
[background] → sets blsi_screen_share_active = true
              → fans out SCREEN_SHARE_BLUR to other tabs
              ↓ (port disconnect = crash-safety)
[background] → onDisconnect fans out SCREEN_SHARE_UNBLUR to ALL tabs
```

**Mid-share SW restart**: Top-level `session.set({ blsi_screen_share_active: false })` runs; port reconnect immediately sets it back to `true`. New tabs opening between these two calls see `false` — a brief race window but self-healing within milliseconds.

## Invariants

- Service worker MUST be stateless between wake cycles — `_sharePorts` is the only module-level mutable state, and it starts empty on every restart (by design).
- No storage reads/writes except `blsi_screen_share_active` session flag.
- `sendMessage` calls always use `.catch(() => {})` — tab may have no content script (chrome:// pages, etc.).
- `COMMAND_TO_MESSAGE` auto-builds from action registry — never hardcode command→message mappings in background.js.
- The sharing tab is excluded from `SCREEN_SHARE_BLUR` fan-out (filtered by `tab.id !== senderTabId`).
