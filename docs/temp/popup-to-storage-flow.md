# Popup → Storage Data Flow

## Write path
1. UI event → `popup_state.js: applyChange()` (line ~169)
2. `applyChange` calls `blsi.Model.patch_section(section, patch)` — `storage_model.js:198`
3. `patch_section` deep-merges patch into `_cache`, then writes full model to `chrome.storage.local['blsi_model']`

## Reactivity (self + cross-context)
4. `chrome.storage.onChanged` fires back in every context (`storage_model.js:109`)
5. Self-echo detected via deep-compare → calls `_on_change(_cache, old_model)` (`storage_model.js:116`)
6. Popup registered `State.onExternalChange` → calls `State.refreshFromStorage()` + re-renders (`popup.js:99`)

## Content-script notification (live settings push)
- Separate path: popup sends `UPDATE_SETTINGS` via `chrome.tabs.sendMessage` (`popup.js:251,268`)
- Content script applies the new resolved settings immediately without waiting for storage event

## Key functions
| File | Function | Role |
|---|---|---|
| `popup_state.js` | `applyChange()` | Batches section patches |
| `storage_model.js` | `patch_section(section, patch)` | Merges + writes to chrome.storage |
| `storage_model.js` | `chrome.storage.onChanged` listener | Fires `_on_change` on any write |
| `storage_model.js` | `on_change(cb)` | Register reactivity callback |
| `popup.js` | `State.onExternalChange(cb)` | Popup-level reactivity hook |
