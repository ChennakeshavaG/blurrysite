---
paths:
  - "src/*.js"
  - "background.js"
  - "popup/**/*.js"
  - "content_script.js"
---

# Message Protocol

**Sender/handler type mismatch silently drops the message — no error, no warning.**

## background.js → content_script.js

| Trigger | Type string |
|---|---|
| Alt+Shift+B shortcut | `TOGGLE_BLUR_ALL` |
| Alt+Shift+P shortcut | `TOGGLE_PICKER` |
| Alt+Shift+U shortcut | `CLEAR_ALL_BLUR` |
| Alt+Shift+O shortcut (PWA) / tab open (normal) | `TOGGLE_PANEL` |
| Page load complete | `RESTORE` |
| Context menu blur | `CONTEXT_BLUR` |
| Context menu unblur | `CONTEXT_UNBLUR` |
| Context menu "Open Settings Panel" (PWA) | `TOGGLE_PANEL` |
| Screen share active (fan-out to other tabs) | `SCREEN_SHARE_BLUR` |
| Screen share ended (fan-out to all tabs) | `SCREEN_SHARE_UNBLUR` |

## content_script.js → background.js

| Event | Type string |
|---|---|
| `getDisplayMedia()` call succeeded in page | `SCREEN_SHARE_STARTED` |
| All display tracks ended | `SCREEN_SHARE_ENDED` |

## popup.js → content_script.js

| Action | Type string |
|---|---|
| Live settings update | `UPDATE_SETTINGS` |
| Query page status | `GET_STATUS` |
| Unblur specific item | `UNBLUR_ITEM` |

## Adding a new message type — checklist
1. Add constant to `src/constants.js` (source of truth)
2. Add handler in `background.js`
3. Add sender in the relevant source module
4. Add row to protocol table in `docs/architecture.md §6`

> `storage_model.js` (`blsi.Model`) accesses `chrome.storage` directly — no background relay for storage ops.
> Old relay types (`GET_BLUR_ITEMS`, `SAVE_BLUR_ITEM`, `REMOVE_BLUR_ITEM`, `CLEAR_HOST`, `CLEAR_ALL`,
> `GET_SETTINGS`, `SAVE_SETTINGS`, `GET_RULES`, `SAVE_RULES`) no longer exist.
