# Contract: popup/popup.js

## Purpose

Coordinator IIFE — no window global, no public API. Owns all event wiring between DOM, `BlurrySitePopupState`, `BlurrySitePopupUI`, and render files. No raw DOM manipulation beyond media tooltip setup and scroll arrow wiring.

## Entry Point

`DOMContentLoaded` → `init()` — async; calls `State.load()`, seeds i18n, renders initial state.

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

### `_openSiteRulesPage()`
Renders Site Rules sub-page body and calls `UI.showView('bl-view-site-rules', true)`.

### `_generalCallbacks()`
Returns callback object for General sub-page: `{ onSave, debugEnabled, onToggleDebug, onExport, onImport }`.  
`onExport`: downloads full model as JSON blob.  
`onImport(text)`: parses + validates + saves; shows success/error toast.

### `_updateScrollArrows()`
Toggles `is-visible` on `#bl-scroll-up` / `#bl-scroll-down` based on `#bl-view-main` scroll position.

### `_updateSubpageArrows(bodyEl)`
Toggles `.bl-sp-arrow--top` / `.bl-sp-arrow--bottom` in the nearest `.bl-subpage__scroll-wrap`.

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
| Popup `unload` (with active highlight) | `blsi.popup.clear_highlight` | — |

## Side Effects

- **Picker open → popup closes**: Both picker-trigger paths (`[data-picker-mode]` chip and `[data-action="open-picker"]` button) call `_activatePicker(mode)`, which queries `GET_STATUS` then either closes immediately (picker already on) or sends `toggle_picker` and closes in callback.
- **Language change → re-render General sub-page**: `_saveAndApply` re-initialises i18n and re-renders the General view if open.
- **Import → full re-render**: `onImport` calls `_renderCurrent()` after successfully saving imported settings.

## Edge Cases

- `tabs[0]` may be undefined (no active tab, restricted URL) — all `chrome.tabs.sendMessage` calls guard with `if (tabs[0])`.
- Mode chip with unknown `data-picker-mode` value: guarded by `if (mode)` check; no-op if empty string.
- Import JSON parse failure: caught; shows `toast_import_error`.
- Picker mode chip with no mode saves nothing and sends no message (inner `if (mode)` guard), but still returns early.
