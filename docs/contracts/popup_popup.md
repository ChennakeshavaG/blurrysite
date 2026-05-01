# Contract: popup/popup.js

## Purpose

Coordinator IIFE — no window global, no public API. Owns all event wiring between DOM, `BlurrySitePopupState`, `BlurrySitePopupUI`, and render files. No raw DOM manipulation beyond media tooltip setup and scroll arrow wiring.

## Entry Point

`DOMContentLoaded` → `init()` — async; calls `State.load()`, seeds i18n, renders initial state.

**Restricted-URL guard:** After `chrome.tabs.query`, `init()` checks `blsi.UrlMatcher.isRestrictedUrl(tab.url)`. When `true` (Chrome Web Store, chrome://*, etc.), it calls `UI.showRestrictedView()` and returns early — `State.load`, hostname/URL seeding, render, and storage subscription are all skipped. The toggles cannot affect those tabs, so a dedicated empty state replaces the normal UI.

## Private Helpers

### `_activatePicker(mode: string)`
Queries `GET_STATUS` on the active tab first. If picker is already active (`response.isPickerActive`), closes popup without toggling — preserves the live picker session. If picker is inactive, sends `toggle_picker` with `picker_mode: mode`, then closes popup in the callback. Used by both the mode-chip handler and the Open Picker button handler.

Edge cases:
- `tabs[0]` undefined (restricted URL / no active tab): early return, no message sent, popup stays open.
- Content script not injected (e.g. `chrome://` page): `sendMessage` callback fires with undefined response and `lastError` set; treated as "picker inactive" → sends `toggle_picker` (which will silently fail but popup still closes).

### `_renderCurrent()`
Calls `BlurrySitePopupRender.renderAll(...)` and `UI.updateClearAll(...)` after every state mutation. Also calls `_updateScrollArrows()`.

### `_saveAndApply(patch)`
`State.saveSettings(patch)` then `_renderCurrent()`. Language change side-effect: re-initialises `blsi.ContentI18n` and re-applies i18n to General sub-page if open.

### `_onSave(patch)`
Alias for `_saveAndApply`. Passed as callback into all render files.

### `_onClearAutomate()`
`State.clearAutomateBlur()` then `_renderCurrent()`.

### `_onSuppressScreenShare(scope)`
`State.suppressScreenShare(scope)` then `_renderCurrent()`. `scope ∈ 'tab' | 'site_session' | 'feature'`.

### `_onUnsuppressScreenShare(scope)`
`State.unsuppressScreenShare(scope)` then `_renderCurrent()`. Used by the notif card's Undo affordance.

### `_openHtbModify(isBlurAll: boolean)`
Renders HTB sub-page body and calls `UI.showView('bl-view-htb-modify', true)`.

### `_openSiteRulesPage(opts?)`
Renders Site Rules sub-page body and calls `UI.showView('bl-view-site-rules', true)`. Accepts `opts.focusRule = { hostname_value, hostname_type }` to scroll + auto-expand a target rule (used by the rule-managed banner CTA).

The `onSaveRules` and `saveSiteSnapshot` callbacks wrap `State.saveRules` / `State.saveSiteSnapshot` with `await` + `location.reload()`. Rationale: rule writes change the popup's "rule-managed" verdict, which cascades through main view (banner / hidden sections), every sub-page (HTB nav, automate nav, general tab-privacy row), and `_renderCurrent`'s render branch. Reloading is simpler and safer than threading a fan-out re-render across every screen.

### `_generalCallbacks()`
Returns callback object for General sub-page: `{ onSave, debugEnabled, onToggleDebug, onExport, onImport }`.  
`onExport`: downloads full model as JSON blob.  
`onImport(text)`: parses + validates + saves; shows success/error toast.

### `_updateScrollArrows()`
Toggles `is-visible` on `#bl-scroll-up` / `#bl-scroll-down` based on `#bl-view-main` scroll position.

### `_updateSubpageArrows(bodyEl)`
Toggles `.bl-sp-arrow--top` / `.bl-sp-arrow--bottom` in the nearest `.bl-subpage__scroll-wrap`.

### Media tooltip (`_showTip` / `_hideTip` / `_positionTip`)
Hover-triggered floating tooltip shared across the popup. A single `.bl-media-tooltip` element is appended to `<body>` and positioned beneath the hovered chip.

Trigger: any element matching `[data-tooltip-media], [data-tooltip-caption]`. Listeners attached to `body` `mouseover` / `mouseout` (event delegation).

Supported `data-*` attributes on the trigger:
- `data-tooltip-media` — image/GIF/video URL. Optional. `.mp4` / `.webm` use `<video>`, all others use `<img>`.
- `data-tooltip-caption` — caption text. Optional, but at least one of media/caption must be present (handler returns early if both empty).
- `data-tooltip-label` — bold heading above the caption. Optional; label `<p>` is hidden when absent.

Modes:
- **Media mode** (default — `data-tooltip-media` set): shows shimmer placeholder, then loads image or video. Removes `bl-media-tooltip--loading` on `load` / `canplay`. On error, hides the failed media element so the tooltip falls back to label/caption only.
- **Text-only mode** (`data-tooltip-caption` only, no media): adds `bl-media-tooltip--text-only` modifier class which hides shimmer + image + video via CSS. Used by the Blur All categories grid in `popup/renders/howtoblur.js`.

Hide is debounced 80 ms via `_tipHideTimer` so the tooltip doesn't flicker when moving between adjacent chips.

## Module State

| Variable | Type | Purpose |
|---|---|---|
| `_highlightedRowKey` | `string\|null` | Key of currently highlighted pick-blur item row; used to debounce mouseover/mouseout highlight messages |

## Messages Sent to Content Script

All sent via `chrome.tabs.sendMessage` to the active tab. Errors swallowed via `void chrome.runtime.lastError`.

| Trigger | Type | Payload extras |
|---|---|---|
| Picker mode chip / Open Picker (status check) | `blsi.popup.get_status` | — |
| Picker mode chip / Open Picker (picker was off) | `blsi.command.toggle_picker` | `picker_mode: string` |
| Blur item row hover | `blsi.popup.highlight_item` | `item_type, selectors, id` |
| Blur item row mouseout | `blsi.popup.clear_highlight` | — |
| Blur item remove button click | `blsi.popup.clear_highlight` | — |
| Popup `pagehide` (with active highlight) | `blsi.popup.clear_highlight` | — |

## Side Effects

- **Picker open → popup closes**: Both picker-trigger paths (`[data-picker-mode]` chip and `[data-action="open-picker"]` button) call `_activatePicker(mode)`, which queries `GET_STATUS` then either closes immediately (picker already on) or sends `toggle_picker` and closes in callback.
- **Language change → re-render General sub-page**: `_saveAndApply` re-initialises i18n and re-renders the General view if open.
- **Import → full re-render**: `onImport` calls `_renderCurrent()` after successfully saving imported settings.

## Edge Cases

- `tabs[0]` may be undefined (no active tab, restricted URL) — all `chrome.tabs.sendMessage` calls guard with `if (tabs[0])`.
- Mode chip with unknown `data-picker-mode` value: guarded by `if (mode)` check; no-op if empty string.
- Import JSON parse failure: caught; shows `toast_import_error`.
- Picker mode chip with no mode saves nothing and sends no message (inner `if (mode)` guard), but still returns early.
