# background Contract

## Overview

MV3 service worker. Stateless between wake cycles — no module-level mutable state except `_sharePorts` (which is empty on every SW restart by design). Handles: keyboard command relay, context menu management, screenshot capture relay, screen-share session record ownership + tab broadcast, and `WHO_AM_I` tab-id discovery. All other storage I/O is handled by `storage_model.js` in content script and popup contexts. Background owns the screen-share session record (`blsi_screen_share`) and the per-tab automate suppression list (`blsi_automate_suppressed_tabs`).

## Initialization (Top-Level SW Start)

On every SW start:
1. Resets `blsi_screen_share` to its empty default `{ active: false, sharing_tab_id: null, started_at: null, suppressed_sites: [] }` and clears `blsi_automate_suppressed_tabs`. Prevents stale state after mid-share SW restart; tab ids from a prior session may have been recycled by Chrome, so the per-tab list is safest to drop. If a share is actually in progress, the port reconnect immediately re-stamps the record via `_setScreenShareActive`.
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
**On connect**: Records port in `_sharePorts[tabId]`; calls `_setScreenShareActive(tabId)` (also handles SW-restart-mid-share reconnect).  
**On disconnect**: Removes port from `_sharePorts`; calls `_setScreenShareInactive()` and broadcasts `SCREEN_SHARE_NOTIFY` to ALL tabs — crash-safety for when the sharing tab crashes/closes/navigates. Storage `onChanged` re-resolves tabs even if the broadcast misses them.

### `chrome.runtime.onMessage`

Handles 4 message types:

**`CAPTURE_VIEWPORT`**: Calls `chrome.tabs.captureVisibleTab(null, { format: 'png' })` → responds `{ dataUrl }` or `{ error }`. Returns `true` (async sendResponse).

**`SCREEN_SHARE_STARTED`**: Calls `_setScreenShareActive(senderTabId)` (writes session record + clears suppression maps); broadcasts `SCREEN_SHARE_NOTIFY` to all tabs EXCEPT the sender (toast trigger).

**`SCREEN_SHARE_ENDED`**: Calls `_setScreenShareInactive()`; broadcasts `SCREEN_SHARE_NOTIFY` to ALL tabs.

**`WHO_AM_I`**: Synchronous `sendResponse({ tab_id: sender.tab.id })`. Used by `screen_share.js` so content tabs can self-identify for `Store.resolve(..., tab_id)`.

### `chrome.tabs.onRemoved`

**What**: When a tab closes, removes its id from `blsi_automate_suppressed_tabs` so a recycled tab id can't inherit a stale suppression.

## Screen Share Architecture

```
[page JS]   → getDisplayMedia() call
              ↓ (main_world_bridge.js patches)
[MAIN world] → '__blsi_screen_share' CustomEvent on document
              ↓ (screen_share.js listens)
[isolated]  → opens port 'blsi-screen-share'
              → sendMessage(SCREEN_SHARE_STARTED)
              ↓
[background] → writes blsi_screen_share = { active:true, sharing_tab_id, started_at, suppressed_sites:[] }
              → clears blsi_automate_suppressed_tabs
              → broadcasts SCREEN_SHARE_NOTIFY (toast ping; excludes sharing tab)
              ↓ (storage onChanged re-resolves all tabs)
              ↓ (port disconnect = crash-safety)
[background] → resets blsi_screen_share to empty + broadcasts NOTIFY
```

Content tabs read the live record via `chrome.storage.session.onChanged` in `storage_model.js` — no `_BLUR`/`_UNBLUR` per-tab fan-out needed.

**Mid-share SW restart**: Top-level reset clears the record; the reconnecting port re-stamps it via `_setScreenShareActive` within milliseconds. Any tab that loads in the gap reads the record on `init_cache` once it stabilizes.

## Invariants

- Service worker MUST be stateless between wake cycles — `_sharePorts` is the only module-level mutable state, and it starts empty on every restart (by design).
- Background writes only `blsi_screen_share` and `blsi_automate_suppressed_tabs` session keys. The model (`blsi_model`) is owned by `storage_model.js` in content + popup contexts.
- `sendMessage` calls always use `.catch(() => {})` — tab may have no content script (chrome:// pages, etc.).
- `COMMAND_TO_MESSAGE` auto-builds from action registry — never hardcode command→message mappings in background.js.
- The sharing tab is excluded from `SCREEN_SHARE_NOTIFY` broadcast on STARTED. Resolve-side check (`tab_id === sharing_tab_id`) is the authoritative blur gate.
