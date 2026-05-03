# background Contract

## Overview

MV3 background script. Runs as a **service worker** in Chrome, **non-persistent event page** in Firefox. Stateless between wake cycles — no module-level mutable state. Handles: keyboard command relay, context menu management, screenshot capture relay, and tab-close cleanup. Screen-share session record ownership, port tracking, WHO_AM_I, and SCREEN_SHARE_NOTIFY broadcast are delegated to `src/automate/screen_share_bg.js`. All other storage I/O is handled by `storage_model.js` in content script and popup contexts.

## Cross-Browser Background Context

Chrome MV3 runs `background.js` as a **service worker**. Firefox MV3 runs it as a **non-persistent event page**. The manifest declares both keys:

```json
"background": {
  "service_worker": "background.js",
  "scripts": ["src/constants.js", "...", "background.js"]
}
```

- **Chrome 121+**: uses `service_worker`, ignores `scripts` (cosmetic warning in `chrome://extensions`).
- **Firefox 121+**: uses `scripts` (event page), ignores `service_worker`.

`importScripts()` is guarded by `typeof importScripts === 'function'` — available in Chrome's SW context, undefined in Firefox's event page context (where the manifest `scripts` array already loaded the dependencies).

The `scripts` array must mirror the `importScripts()` argument list + `background.js` itself as the last entry. When adding a new background-only dependency: update both places.

## Initialization (Top-Level SW/Event Page Start)

On every SW wake (Chrome) or event page start (Firefox):
1. Calls `chrome.storage.session.setAccessLevel({ areaName: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })` so content scripts can read/write session storage (MV3 default is background-only). Must run before any session storage writes.
2. Loads shared modules — via `importScripts` (Chrome SW) or manifest `scripts` array (Firefox event page). The automate imports register the `blsi.Automate.State` cache + `chrome.storage.onChanged` listener and the `blsi.Automate.Idle` observer (`chrome.idle.onStateChanged` → `blsi_automate_idle` session key) at load.
3. `Idle.init()` is invoked so the idle listener is registered on every wake.
4. `ScreenShareBg.init()` is invoked — clears stale screen-share session record + suppressed-tabs list, registers port + message listeners. See `docs/contracts/automate/screen_share_bg.md`.
5. Builds `COMMAND_TO_MESSAGE` map from `blsi.Actions.list()`.

## Module-Level State

| Variable | Description |
|---|---|
| `State` | `blsi.Automate.State` — reference to the session state module (loaded via importScripts) |
| `COMMAND_TO_MESSAGE` | Frozen `{ chromeCommandName: messageType }` map, auto-built from action registry |
| `log` | Scoped logger: `blsi.Logger.scope('bg')` |

## Lifecycle Events

### `chrome.runtime.onInstalled`

**What**: Calls `createContextMenus()`, removes stale storage keys from pre-refactor versions, and triggers `_reinjectAllTabs()` for `reason === 'install' | 'update'` so already-open tabs activate the extension without a manual reload.
**Stale keys removed**: `blurred_selectors`, `settings`, `rules`, `blurred_items`, `blur_all_hosts`
**Re-injection skipped on**: `'chrome_update'`, `'shared_module_update'` (content scripts survive Chrome updates).

### `chrome.runtime.onStartup`

**What**: Calls `createContextMenus()` to recreate menus after browser restart.

## Functions

### createContextMenus()

**What**: Removes all existing context menus and recreates the full set.  
**Side effects**: Calls `chrome.contextMenus.removeAll()` then creates 6 items:
- `bl-si-blur-element` — `ctxBlurElement` ("Blur this element") (all contexts)
- `bl-si-unblur-element` — `ctxUnblurElement` ("Unblur this element") (all contexts)
- `bl-si-blur-selection` — `ctxBlurSelection` ("Blur selected text") (selection context only)
- `bl-si-settings-sep` — separator
- `bl-si-settings-panel` — `ctx_open_settings_panel` ("Open Settings Panel") (all contexts)
- `bl-si-settings-tab` — `ctx_open_settings_tab` ("Open Settings in Tab") (all contexts)

All titles are resolved via `chrome.i18n.getMessage(key) || 'English fallback'`. The fallback runs only if the locale lookup fails (e.g. unsupported locale + missing en).

**Note**: Context menu blur/unblur sends message to tab but does not capture `targetElementId` — content script uses `lastContextMenuTarget` (set by `contextmenu` event listener in content_script.js).

### _reinjectAllTabs()

**What**: Programmatically injects content scripts and CSS into every currently-open tab so the extension activates immediately after install or update — without requiring a tab reload or browser restart.
**Returns**: `Promise<void>` — never rejects (per-tab failures are caught and logged).
**Side effects**: Calls `chrome.tabs.query({})`, `chrome.scripting.insertCSS`, and `chrome.scripting.executeScript` (twice — isolated world then MAIN world).
**Logic**:
1. Queries all tabs.
2. For each tab with an id and a URL that passes `blsi.UrlMatcher.isRestrictedUrl(tab.url) === false`:
   - Inserts `styles/content.css` into all frames.
   - Executes the 35-file isolated-world bundle (`_ISOLATED_WORLD_FILES`) in declared order across all frames.
   - Executes `src/main_world_bridge.js` in the MAIN world of the top frame only.
3. Logs an aggregate summary `{ attempted, succeeded, skipped }`.

**Handles**:
- `chrome.tabs.query` failure → logs and returns; no injection attempted.
- Per-tab injection failure (closed tab, race with navigation, restricted URL not on the helper's list) → caught and logged at `warn`; iteration continues.
- Restricted URLs (chrome://, chrome-extension://, chromewebstore.google.com, etc.) → skipped before any `chrome.scripting` call (counted in the `skipped` log field).

**Tradeoffs**:
- MAIN-world bridge runs post-`document_start` on already-open tabs. Any in-flight `getDisplayMedia` / `attachShadow` calls that already executed will not be hooked. Acceptable for install-time recovery; the static manifest declaration handles all subsequent navigations correctly.
- File list (`_MAIN_WORLD_FILES`, `_ISOLATED_WORLD_FILES`, `_CONTENT_CSS_FILES`) mirrors `manifest.json content_scripts` — the manifest is the source of truth. Adding a new content script requires updating both.

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

### `chrome.runtime.onMessage`

Handles 1 message type (screen-share and WHO_AM_I moved to `automate/screen_share_bg.js`):

**`CAPTURE_VIEWPORT`**: Calls `chrome.tabs.captureVisibleTab(null, { format: 'png' })` → responds `{ dataUrl }` or `{ error }`. Returns `true` (async sendResponse).

### `chrome.tabs.onRemoved`

**What**: When a tab closes, removes its id from the suppressed-tabs list via `State.remove_suppressed_tab(tabId)`, clears its tab-switch entry via `State.clear_tab_switch(tabId)`, and removes its screen-share map entry via `State.set_screen_share_inactive(tabId)` so a recycled tab id can't inherit stale state.

## Screen Share Architecture

Screen-share port/message handling is delegated to `src/automate/screen_share_bg.js`. See `docs/contracts/automate/screen_share_bg.md` for the full protocol. Summary:

```
[page JS]   → getDisplayMedia() call
              ↓ (main_world_bridge.js patches)
[MAIN world] → '__blsi_screen_share' CustomEvent on document
              ↓ (automate/screen_share.js listens)
[isolated]  → opens port 'blsi-screen-share'
              → sendMessage(SCREEN_SHARE_STARTED)
              ↓
[background] → automate/screen_share_bg.js handles port + messages
              → writes blsi_screen_share via State APIs
              → broadcasts SCREEN_SHARE_NOTIFY (toast ping; excludes sharing tab)
              ↓ (storage onChanged re-resolves all tabs)
              ↓ (port disconnect = crash-safety)
[background] → resets blsi_screen_share to empty + broadcasts NOTIFY
```

## Invariants

- Background context MUST be stateless between wake cycles — no module-level mutable state in background.js (`_sharePorts` moved to `screen_share_bg.js`). Applies to both Chrome SW and Firefox event page.
- Session key writes are delegated to `blsi.Automate.ScreenShareBg` (screen-share + suppressed tabs) and `blsi.Automate.Idle` (idle state), both via `blsi.Automate.State` APIs. Tab-close cleanup (`remove_suppressed_tab`, `clear_tab_switch`) remains in background.js.
- `sendMessage` calls always use `.catch(() => {})` — tab may have no content script (chrome:// pages, etc.).
- `COMMAND_TO_MESSAGE` auto-builds from action registry — never hardcode command→message mappings in background.js.
