# BlurrySite Code Review — 2026-04-07

## Phase 1: Individual File Review

### Critical

**~~CR-01. `sendResponse({ success: true })` called before write completes~~ — RESOLVED**
~~`background.js:194,230,255,267,293,329,353`~~
All storage handlers removed from background.js. Popup now writes directly via `storage_manager.js` with `try/catch` + user-facing toast on failure. Content script already wrote directly.

**~~CR-02. `writeQueue` lost on service worker termination~~ — RESOLVED**
~~`background.js:140`~~
`writeQueue` and `serialWrite` removed from background.js. No module-level mutable state remains in the service worker.

**CR-03. `repaint()` has no concurrency guard; concurrent calls interleave** — Race Condition → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:63`
`repaint()` is async and called from many paths (message handlers, `applyState`, `storage.onChanged`). None guard against concurrent execution. Since `repaint()` does `unblurAll()` then re-applies, two overlapping calls cause blur items to appear then disappear.
**Planned fix:** Scorched-earth `repaint()` replaced by diff-based handlers per storage key. Diff handlers are idempotent — concurrent calls converge to the same state.

---

### Warning

**CR-04. `_storageGet`/`_storageSet` don't check `chrome.runtime.lastError`** — Bug
`storage_manager.js:73-82`
The storage wrapper doesn't check `runtime.lastError`. Failed reads resolve with `{}`, causing subsequent read-modify-write to overwrite all data with a single item. Failed writes resolve as success. (Background.js references removed — no longer applicable there.)

**CR-05. Read-modify-write race on `saveBlurItem` / `removeBlurItem` / `saveBlurState`** — Race Condition
`storage_manager.js:90-107,109-126,215-227`
All do get→modify→set without locking. Concurrent calls (rapid clicks, multi-item restore) cause last-write-wins data loss. Same pattern in `background.js` handlers.

**CR-06. `applyState` calls `repaint()` without `await`** — Race Condition → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:917`
`applyState` is synchronous but calls async `repaint()` fire-and-forget. Code after line 917 (including `Engine.unblurAll()` on line 938) races with the in-progress repaint.
**Planned fix:** `applyState` no longer calls `repaint()`. Blur-all state changes arrive via `Store.onChange` as a separate event.

**CR-07. `_ownStorageWrite` flag unreliable as debounce** — Race Condition → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:41,65-66`
Flag resets after 100ms via `setTimeout`, but `repaint()` async operations may take longer. Flag can reset before storage change event fires, causing spurious cross-tab repaints.
**Planned fix:** `_ownStorageWrite` eliminated. `storage_manager.js` synchronous cache comparison replaces it — no timers.

**CR-08. Saving resolved settings instead of global settings on picker mode change** — Bug
`content_script.js:263-264`
`onModeChange` saves the resolved settings (with URL-rule overrides merged in) back to global storage, leaking per-URL overrides into global settings.

**CR-09. Reveal handlers not registered when extension disabled at load** — Bug
`content_script.js:974,983-986`
If `settings.ENABLED === false` at init, reveal listeners (click/hover/mouseout/keydown) are never registered. Later enabling via `UPDATE_SETTINGS` calls `applyState` but never registers these listeners — reveal is permanently broken for the session.

**CR-10. `_isPickerActive` not reset by `destroy()`** — Bug
`shortcut_handler.js:246-269`
`destroy()` resets most state but not `_isPickerActive`. After `destroy()`+`init()` cycle, stale picker state persists. Pressing Escape could call `onExitPicker` incorrectly.

**CR-11. Empty `keyCodes` array matches any keydown with primary modifier** — Bug
`shortcut_handler.js:200-208`
If a shortcut has `keys: []` (malformed config), the `allHeld` check is vacuously true, firing the shortcut on any keydown while the modifier is held.

**CR-12. `document.head`/`document.body` null guards missing** — Undefined Error
`blur_engine.js:213` (`document.head`), `blur_engine.js:164` (`document.body`), `shortcut_handler.js:126` (`document.body`)
Several functions append to `document.head`/`document.body` without null guards, inconsistent with `createZoneOverlay` (blur_engine.js:364) which correctly guards.

**CR-13. `_processingStorageChange` flag drops concurrent updates** — Race Condition → **WILL BE RESOLVED** (plan-reactive-storage.md)
`popup.js:394,399`
Boolean guard causes entire `onChanged` events to be dropped if a previous handler is still in flight. Settings + rules + items changing simultaneously causes stale popup UI.
**Planned fix:** Popup subscribes via `Store.onChange()`. Cache comparison in `storage_manager.js` handles dedup — no boolean guard needed.

**CR-14. `isPickerActive` toggled optimistically without confirmation** — Race Condition
`popup.js:335-336`
Picker state toggled immediately before `sendMessage` completes. If content script is unavailable, popup state diverges from actual page state. Error is swallowed by `catch(() => {})`.

**CR-15. Dynamic mode `onMouseOut` may target wrong element** — Bug
`picker.js:445-450`
`onMouseOut` removes highlight from `resolveTarget(e.target)`, but `onMouseOver` may have promoted the target to a parent via `findClassedParent`. The raw mouseout target won't match, leaving the promoted parent highlighted.

**CR-16. `_registry` in settings renderer grows unboundedly** — Optimization
`popup_settings_renderer.js:24-25,174`
Module-level Map grows across `renderSection` calls (main panel + rule modals). Entries for detached DOM nodes (from closed modals) persist, causing wasteful `_syncControl` on detached elements.

**CR-17. `TOGGLE_BLUR_ALL` response may return stale `isPageBlurred`** — Race Condition → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:733-735`
`saveBlurState` uses current `isPageBlurred`, then `repaint()` re-reads from storage and updates it. Concurrent repaints between lines 733-734 can make the value stale.
**Planned fix:** `TOGGLE_BLUR_ALL` handler just flips storage — no response, no `repaint()` call. `Store.onChange` handles the state update.

**CR-18. Reveal `querySelectorAll('*')` is overly broad** — Optimization
`content_script.js:512,531`
`_revealElement` and `_unrevealElement` query all descendants. `querySelectorAll('[data-bl-si-blur]')` or iterating `_revealedElements` with `el.contains()` would be significantly more efficient.

**CR-19. Logger init is async but `_enabled` used synchronously** — Race Condition
`logger.js:21-24`
`chrome.storage.local.get` sets `_enabled` asynchronously. Log calls during the init window silently drop even if debug logging is enabled.

**CR-20. `deepMerge` shares array references** — Bug (Potential)
`constants.js:189-212`
When `override[key]` is an array, `result[key] = override[key]` assigns by reference. Mutations to one affect the other. Safe when merging from frozen defaults, but risky when merging two mutable settings objects.

**CR-21. `selectedElements` Set holds stale DOM references** — Optimization
`picker.js:33`
Holds direct DOM element references. SPA page transitions leave stale references preventing GC. Only cleared on `deactivate()` or `clearAllFromPicker()`.

---

### Info

**CR-22. Dead code: `rules.length === 0` check unreachable** — Optimization
`blur_engine.js:208`
The `[data-bl-si-blur]` rule is always pushed at line 206, so `rules.length` is always >= 1.

**CR-23. `buildDefaultSettings` uses `JSON.parse(JSON.stringify())` instead of `structuredClone`** — Optimization
`constants.js:216-218`
`structuredClone` is available in all modern browsers and service workers, would be more idiomatic.

**CR-24. `isBlurred` uses linear scan of `alwaysBlurTags`** — Optimization
`blur_engine.js:309-312`
A `Set` would give O(1) lookup instead of O(n) array scan. Minor since array is ~15 items.

**CR-25. Reveal event listeners active even when extension disabled** — Optimization
`content_script.js:983-986`
Four document-level listeners fire on every click/mouseover/mouseout/keydown even when disabled (they early-return, but the dispatch cost remains).

**CR-26. `blurredCount` variable appears vestigial** — Optimization
`popup.js:29,306-307,321,326,356-357,367-369`
Maintained alongside `blurredItems` but never used independently. `renderBlurList()` uses `blurredItems.length` directly.

**CR-27. SPA history monkey-patching runs before `init()`** — Race Condition (minor)
`content_script.js:1018-1029`
`pushState`/`replaceState` wrapped at IIFE time. If SPA triggers navigation during loading, `onUrlChange` runs with default settings and empty rules.

**CR-28. Duplicate step numbering in `applyState`** — Cosmetic
`content_script.js:928,935`
Both labeled "// 7." — suggests one block added without renumbering.

**CR-29. `tabMessage` timeout race leaks response** — Optimization (minor)
`popup.js:92-99`
`Promise.race` with 3s timeout means late real responses are ignored. Minor memory concern.

**CR-30. `cssEscape` manual fallback doesn't handle leading digits** — Bug (Potential)
`selector_utils.js:34`
The fallback regex `([^\w-])` doesn't escape leading digits in IDs. Falls through gracefully to next selector strategy.

---

## Phase 2: Cross-File Interaction Review

### Message Protocol

**~~CR-31. `GET_STATUS` response shape mismatch~~ — FIXED**
~~`popup.js:305,713` vs `content_script.js:781`~~
Fixed — popup now reads `status.blurredCount` (was `status.count`).

**~~CR-32. Dead handlers: `GET_BLUR_STATE` / `SAVE_BLUR_STATE` have no callers~~ — RESOLVED**
~~`background.js:336-366`~~
All storage handlers removed from background.js. No message-based storage I/O remains.

**CR-33. Dual-write risk: popup and content_script both write same keys without cross-context serialization** — Race Condition (improved) → **WILL BE RESOLVED** (plan-reactive-storage.md)
`storage_manager.js` (all write methods)
Both popup and content script now write via the same `storage_manager.js` API (background.js middleman eliminated). The code path is consistent, but concurrent `get→modify→set` from different contexts still has last-writer-wins risk (see CR-05).
**Planned fix:** Synchronous cache update before async write eliminates dual-write divergence. Cross-context races (CR-05) remain but are narrowed to the storage write window.

**~~CR-34. `UNBLUR_ITEM` payload sent but never used~~ — FIXED**
~~`popup.js:355` sends `{ item }`, `content_script.js:850-856` ignores it and just calls `repaint()`.~~
Fixed — unused `{ item }` payload and `itemData` dataset removed from popup.

**~~CR-35. `STORAGE.*` constants partially orphaned~~ — RESOLVED**
~~`constants.js`~~
All storage handlers removed from background.js. Constants remain defined in `constants.js` but are no longer used as message wire types. Optional cleanup.

---

### State & Lifecycle

**CR-36. Escape key double-fires through both shortcut handler and picker handler** — State Machine
`shortcut_handler.js:185-189`, `picker.js:514-524`, `content_script.js:692-697`
Both the shortcut handler's `onExitPicker` and the picker's own `onKeyDown` catch Escape. The shortcut handler fires first (registered earlier at capture phase), calls `Picker.deactivate()`, which sets `isActive = false`. When the picker's handler fires next, `deactivate()` bails via `if (!isActive) return`. Works correctly but is fragile — if registration order changes, double-deactivate could occur.

**CR-37. `applyState()` → `repaint()` → `storage.onChanged` → `applyState()` — no re-entrancy guard** — Race Condition → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:916-918,1033-1058`
`applyState` calls `repaint()` (async, no await). During repaint's async gap, `storage.onChanged` can fire from another tab, calling `applyState()` again, which triggers another `repaint()`. Two repaints interleave: double `unblurAll()` causes flicker.
**Planned fix:** Single entry point via `Store.onChange`. `applyState` no longer calls `repaint()`. Each storage key has its own diff handler — no circular trigger chain.

**CR-38. nth-child selector fallback fragile to DOM insertions** — Selector Stability
`selector_utils.js:55-72`
`buildNthChildPath` generates `:nth-of-type(N)` paths. DOM mutations (SPA re-renders, dynamic content) shift sibling indices, causing wrong element restoration or silent loss. Class-based selectors (checked first) are more stable.

---

### Settings Flow

**CR-39. `deepMerge` in `storage.onChanged` and `UPDATE_SETTINGS` accumulates stale keys** — Merge Bug → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:791,1046`
Both paths merge incoming settings over existing `globalSettings` via `deepMerge`. Since `deepMerge` never removes keys, removed/renamed settings keys persist in `globalSettings` for the tab lifetime. Should replace rather than merge since incoming values are already complete validated objects.
**Planned fix:** `Store.onChange` delivers full `newValue` from storage. `onSettingsChanged` replaces `globalSettings` entirely instead of merging. `UPDATE_SETTINGS` message eliminated.

**CR-40. `storage.onChanged` uses raw `newValue` without validation** — Merge Bug → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:1046`
`changes.settings.newValue` comes directly from `chrome.storage.onChanged` — not validated or merged with defaults. Any direct `chrome.storage.local.set` (e.g., `onInstalled`) could store an unvalidated value that propagates unfiltered.
**Planned fix:** `onSettingsChanged` applies `deepMerge(DEFAULTS, newValue)` + `validateSettings()` before using — same merge+validate as `Store.getSettings()`.

**CR-41. `resolveSettings` does not validate after URL rule merge** — Merge Bug
`content_script.js:436-447`
After merging rule overrides, the result is returned without `validateSettings()`. Rules are only checked by JSON size limit (`background.js:326`), so invalid values like `{ BLUR_RADIUS: "not-a-number" }` pass through unchecked.

**~~CR-42. Duplicate settings read paths may diverge~~ — RESOLVED**
~~`storage_manager.js:158-163` vs `background.js:275-284`~~
Single read path remains: `storage_manager.js`. Background.js no longer reads or serves settings.

**CR-43. Cross-tab settings change triggers redundant self-repaint** — Optimization → **WILL BE RESOLVED** (plan-reactive-storage.md)
`content_script.js:1033-1058`
`_ownStorageWrite` guard only suppresses echo for `blurred_items`/`blur_all_hosts`, not for `settings`. When a tab saves settings, it also processes its own `storage.onChanged`, causing a redundant `resolveSettings` + `applyState`.
**Planned fix:** `storage_manager.js` cache comparison catches self-echo for ALL keys — `settings` included. No key-specific guard logic needed.

---

## Summary

| Severity | Phase 1 | Phase 2 | Total | Resolved | Planned (reactive-storage) |
|----------|---------|---------|-------|----------|---------------------------|
| Critical | 3 | 0 | **3** | 2 (CR-01, CR-02) | 1 (CR-03) |
| Warning | 18 | 8 | **26** | 5 (CR-31, CR-32, CR-34, CR-35, CR-42) | 7 (CR-06, CR-07, CR-13, CR-17, CR-33, CR-37, CR-39, CR-40, CR-43) |
| Info | 9 | 5 | **14** | 0 | 0 |
| **Total** | **30** | **13** | **43** | **7** | **+10** |

After reactive-storage implementation: **17 of 43** findings resolved.

### Top 10 Most Impactful Findings (updated)

| # | ID | Category | Summary | Status |
|---|-----|----------|---------|--------|
| 1 | CR-03 | Race Condition | `repaint()` concurrency — concurrent calls interleave | **Planned** (diff-based handlers) |
| 2 | ~~CR-01~~ | ~~Bug~~ | ~~`sendResponse(success)` before write completes~~ | **Resolved** |
| 3 | CR-08 | Bug | Picker mode change saves resolved settings, leaking URL rule overrides to global storage | Open |
| 4 | CR-33 | Race Condition | Dual-write on `blurred_items`/`settings` without cross-context locking | **Planned** (sync cache) |
| 5 | CR-05 | Race Condition | Read-modify-write on blur items/state without locking | Open (narrowed by sync cache) |
| 6 | CR-09 | Bug | Reveal handlers never registered if extension disabled at page load | Open |
| 7 | CR-41 | Merge Bug | URL rule overrides bypass settings validation | Open |
| 8 | ~~CR-31~~ | ~~Bug~~ | ~~`GET_STATUS` response field name mismatch~~ | **Fixed** |
| 9 | CR-37 | Race Condition | `applyState` → `repaint` re-entrancy loop | **Planned** (single entry point) |
| 10 | CR-04 | Bug | Missing `chrome.runtime.lastError` checks — silent data loss on storage failure | Open |
