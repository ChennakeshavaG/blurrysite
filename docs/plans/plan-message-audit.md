# Plan: Message Protocol Audit & Cleanup

**Date:** 2026-04-10
**Status:** Phase 1 complete. Phase 2 (remaining CR fixes) pending.

---

## Architecture Overview (post-cleanup)

Two communication channels remain:

| Channel | API | Direction | Purpose |
|---|---|---|---|
| `tabMessage()` | `chrome.tabs.sendMessage` | popup → content_script | Live page actions (blur, pick, status, settings update) |
| `chrome.tabs.sendMessage` | (direct) | background.js → content_script | Keyboard shortcut relay, context menu, restore on load |

**Eliminated channel:** `bgMessage()` / `chrome.runtime.sendMessage` (popup → background.js) — removed. Popup now uses `blsi.Storage.*` directly via `storage_manager.js` loaded in `popup.html`.

Content script uses `blsi.Storage.*` directly (unchanged).
Background.js is now a pure relay — no storage handlers, no `serialWrite` queue.

---

## Full Message Trace (20 types)

### STORAGE category — direct `chrome.storage.local` (no message passing)

These types are defined in `constants.js` but **no longer used as messages**. Both popup and content script call `blsi.Storage.*` methods directly.

| # | Type | Used by popup via | Used by content_script via |
|---|---|---|---|
| 1 | `GET_BLUR_ITEMS` | `Store.getBlurItems(hostname)` | `Store.getBlurItems(hostname)` |
| 2 | `SAVE_BLUR_ITEM` | N/A (popup never saves items) | `Store.saveBlurItem(hostname, item)` |
| 3 | `REMOVE_BLUR_ITEM` | `Store.removeBlurItem(hostname, itemId)` | `Store.removeBlurItem(hostname, itemId)` |
| 4 | `CLEAR_HOST` | `Store.clearHost(hostname)` | `Store.clearHost(hostname)` |
| 5 | `CLEAR_ALL` | `Store.clearAll()` | N/A |
| 6 | `GET_SETTINGS` | `Store.getSettings()` | `Store.getSettings()` |
| 7 | `SAVE_SETTINGS` | `Store.saveSettings(settings)` | `Store.saveSettings(settings)` |
| 8 | `GET_RULES` | `Store.getRules()` | `Store.getRules()` |
| 9 | `SAVE_RULES` | `Store.saveRules(rules)` | N/A |
| 10 | `GET_BLUR_STATE` | N/A | `Store.getBlurState(hostname)` |
| 11 | `SAVE_BLUR_STATE` | N/A | `Store.saveBlurState(hostname, blurAll)` |

**Error handling:** All popup writes are wrapped in `try/catch` with `console.error` + user-facing toast on failure. Reads return safe defaults on failure (built into `storage_manager.js`).

---

### COMMAND category — background.js → content_script

#### 12. `TOGGLE_BLUR_ALL` — Active ✅

| | Detail |
|---|---|
| **Sender** | background.js:86 — keyboard shortcut relay (`Alt+Shift+B`). Also popup.js — Blur All button via `tabMessage`. |
| **Handler** | content_script.js — saves inverted blur state, repaints, responds with `{ isPageBlurred }` |
| **Response used?** | By popup (indirectly — popup queries `GET_STATUS` after). Background ignores response. |
| **Issues** | CR-17 (stale `isPageBlurred` in response — popup works around this via separate `GET_STATUS` call) |

#### 13. `TOGGLE_PICKER` — Active ✅

| | Detail |
|---|---|
| **Sender** | background.js:87 — keyboard shortcut relay (`Alt+Shift+P`). Also popup.js — Picker button via direct `chrome.tabs.sendMessage`. |
| **Handler** | content_script.js — activates/deactivates picker, responds with `{ isPickerActive }` |
| **Response used?** | Not by popup — it optimistically toggles local state (CR-14). Background ignores response. |
| **Issues** | CR-14 (optimistic toggle), CR-36 (Escape double-fire) |

#### 14. `CLEAR_ALL_BLUR` — Active ✅

| | Detail |
|---|---|
| **Sender** | background.js:88 — keyboard shortcut relay (`Alt+Shift+U`). Also popup.js — Clear All / Clear All Sites buttons. |
| **Handler** | content_script.js — clears host items + blur state from storage, repaints |
| **Response used?** | Not by popup (fire-and-forget). |

#### 15. `RESTORE` — Active ✅

| | Detail |
|---|---|
| **Sender** | background.js:113 — `chrome.tabs.onUpdated` when page load completes |
| **Handler** | content_script.js — calls `repaint()` to re-apply persisted blur items |
| **Response used?** | No |

#### 16. `CONTEXT_BLUR` — Active ✅ (but limited)

| | Detail |
|---|---|
| **Sender** | background.js:70 — right-click context menu "Blur this element" |
| **Handler** | content_script.js — uses `lastContextMenuTarget` (set by `contextmenu` DOM event), gets selector, saves as dynamic item, repaints |
| **Response used?** | No |
| **Issues** | `lastContextMenuTarget` is fragile — DOM changes between right-click and menu click can target wrong element. |

#### 17. `CONTEXT_UNBLUR` — Active ✅ (but limited)

| | Detail |
|---|---|
| **Sender** | background.js:73 — right-click context menu "Unblur this element" |
| **Handler** | content_script.js — uses `lastContextMenuTarget`, finds the blurred ancestor, removes from storage, repaints |
| **Response used?** | No |
| **Issues** | Same `lastContextMenuTarget` fragility as CONTEXT_BLUR. |

---

### POPUP category — popup → content_script

#### 18. `UPDATE_SETTINGS` — Active ✅

| | Detail |
|---|---|
| **Sender** | popup.js — after saving settings or rules, sends updated settings to the active tab via `tabMessage` |
| **Handler** | content_script.js — deep-merges into globalSettings, re-resolves with URL rules, applies state changes |
| **Response used?** | No (fire-and-forget) |
| **Issues** | CR-39 (deepMerge accumulates stale keys), CR-08 (resolved settings leak in onModeChange) |

#### 19. `GET_STATUS` — Active ✅ (CR-31 fixed)

| | Detail |
|---|---|
| **Sender** | popup.js — after blur-all toggle + on popup init |
| **Handler** | content_script.js — returns `{ isPageBlurred, isPickerActive, blurredCount }` |
| **Response used?** | Yes — popup reads `isPageBlurred`, `isPickerActive`, `blurredCount` for UI state. |
| **Issues** | ~~CR-31~~ Fixed — popup now reads `status.blurredCount` (was `status.count`). |

#### 20. `UNBLUR_ITEM` — Active ✅ (CR-34 fixed)

| | Detail |
|---|---|
| **Sender** | popup.js — after removing an item from storage via `Store.removeBlurItem()`, tells content script to repaint |
| **Handler** | content_script.js — calls `repaint()` |
| **Response used?** | No |
| **Issues** | ~~CR-34~~ Fixed — unused `{ item }` payload removed from sender. |

---

## Completed Work (Phase 1)

### What changed

| File | Change |
|---|---|
| `popup/popup.html` | Added `<script src="../src/storage_manager.js" defer>` |
| `popup/popup.js` | Replaced all 12 `bgMessage()` calls with direct `Store.*` calls. Added `try/catch` + toast on all writes. Removed `bgMessage()` helper. Fixed CR-31, CR-34. |
| `background.js` | Removed ~370 lines: all storage message handlers, `serialWrite` queue, validation helpers. Now purely a relay. |

### CRs resolved

| CR | Status | How |
|---|---|---|
| CR-01 | **Resolved** | No more `sendResponse` in background.js — popup writes directly with error handling |
| CR-02 | **Resolved** | `writeQueue` removed — no module-level mutable state in background.js |
| CR-31 | **Fixed** | `status.count` → `status.blurredCount` in popup.js |
| CR-32 | **Resolved** | Dead `GET_BLUR_STATE`/`SAVE_BLUR_STATE` handlers removed |
| CR-33 | **Improved** | Popup no longer writes through background.js. Both popup and content_script now write via same `storage_manager.js` API. Still no cross-context lock, but the dual-path divergence is eliminated. |
| CR-34 | **Fixed** | Unused `{ item }` payload removed from UNBLUR_ITEM sender |
| CR-35 | **Resolved** | All orphaned STORAGE handlers removed |
| CR-42 | **Resolved** | No more duplicate merge+validate path — single path in `storage_manager.js` |

---

## Remaining Work (Phase 2)

### Bugs still open in active messages

| Priority | ID | Message | Fix |
|---|---|---|---|
| 1 | CR-14 | `TOGGLE_PICKER` | Optimistic toggle in popup — await response before updating state |
| 2 | CR-39 | `UPDATE_SETTINGS` | Replace deepMerge with full replacement (incoming is already complete) |
| 3 | CR-17 | `TOGGLE_BLUR_ALL` | Stale `isPageBlurred` in response (popup works around via GET_STATUS) |

### Dual-write risk (CR-33 — remaining)

| Storage key | Who writes | Risk |
|---|---|---|
| `blurred_items` | content_script + popup (both via `storage_manager.js`) | Last-writer-wins on concurrent read-modify-write (CR-05) |
| `settings` | content_script + popup (both via `storage_manager.js`) | Same pattern |
| `rules` | popup only | Safe |
| `blur_all_hosts` | content_script only | Safe |

Both callers now use the same `storage_manager.js` code, so the logic is consistent. The remaining risk is CR-05: concurrent `get→modify→set` without locking. This is an `storage_manager.js` issue, not a message protocol issue.

### Optional cleanup

- Remove orphaned STORAGE constant definitions from `constants.js` (`SAVE_BLUR_ITEM`, `GET_BLUR_STATE`, `SAVE_BLUR_STATE`) — these are no longer message types, but the strings are still used by `storage_manager.js` as storage key concepts. Low priority.

---

## Phase 3: Reactive Storage (supersedes Phase 2)

Phase 2 remaining work (CR-14, CR-39, CR-17) is superseded by **plan-reactive-storage.md**, which eliminates 5 more message types and resolves 10 CRs via diff-based `Store.onChange` architecture. See that plan for details.

**Final message count:** 20 defined → 4 active (TOGGLE_BLUR_ALL, TOGGLE_PICKER, GET_STATUS, CONTEXT_BLUR/UNBLUR).
