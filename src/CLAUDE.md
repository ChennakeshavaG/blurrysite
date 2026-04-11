# src/ — Module Authoring Guide

See `../CLAUDE.md` for the full project rules. This file covers src/-specific patterns.

## IIFE Pattern (mandatory)

Every file in src/ must follow this exact structure:

```js
/**
 * module_name.js — one-line purpose
 *
 * Exposed as blsi.Xxx (IIFE — no ES module syntax).
 */

const BlurrySiteXxx = (() => {
  'use strict';

  // private state here

  function publicMethod() { ... }

  return { publicMethod };
})();

blsi.Xxx = BlurrySiteXxx;
```

Rules:
- No `import` / `export` / `require` anywhere.
- One `window.*` assignment per file, at the very end.
- The global name is always `BlurrySite` + PascalCase module name.
- `'use strict'` inside the IIFE.

---

## Module Load Order (enforced by manifest.json)

```
0. constants.js          → globalThis.blsi (message types + DEFAULTS)
1. logger.js             → blsi.Logger (flow logger; toggle persisted at chrome.storage.local.blsi_debug; cross-context sync via storage.onChanged)
2. url_matcher.js        → blsi.UrlMatcher
3. selector_utils.js     → blsi.SelectorUtils
4. storage_manager.js    → blsi.Storage
5. blur_engine.js        → blsi.BlurEngine (owns blur-all + item dispatch state)
6. reveal_controller.js  → blsi.Reveal
7. shortcut_handler.js   → blsi.Shortcuts
8. picker.js             → blsi.Picker
9. content_script.js     → (no global, binds all above)
```

A module may only depend on modules loaded before it.
`content_script.js` binds all globals to local aliases inside `init()` (after DOM ready), not at top-level.

---

## Module-Specific Rules

### blur_engine.js
- `applyBlur` is idempotent — guards via direct `element.dataset.blSiBlur` attribute check, NOT `isBlurred()`. `isBlurred()` is used by picker / context-menu unblur paths to check whether a clicked element has a stored item; those paths intentionally ignore role-only matches because there is no storage entry to remove.
- Two blur checks:
  - `isBlurred(el)` — "is this stamped or tag-rule blurred?" Used by picker.js, content_script.js (context-menu ancestor walk), and the internal `toggleBlur`.
  - `isVisuallyBlurred(el)` — same as `isBlurred` PLUS role-based CSS matches (`<button role="tab">` under FORM, etc.). Used by reveal_controller.js for ancestor / descendant walks so hover reveal can clear filter on role-matched parents. Do NOT widen `isBlurred` to subsume this — it would route picker clicks on role-blurred elements into unblur paths that silently no-op against storage.
- Video elements use `videoOverlayMap` (WeakMap) to track canvas + RAF handle. Never store canvas on `el._pbCanvas` — that was a previous iteration.
- Canvas class must be `"bl-si-canvas-overlay"` exactly. CSS in `styles/content.css` references this.
- IMG blur: `data-bl-si-blur` attribute + CSS rule `[data-bl-si-blur] { filter: blur(var(--bl-si-radius)) }`. No inline `style.filter`.

#### Zone overlay methods
- `createZoneOverlay(zoneData)` appends an overlay `<div>` to `document.body`. Overlays use the `data-bl-si-zone` attribute (set to `zoneData.id`) for identification.
- `removeZoneOverlay(zoneId)` removes the overlay matching `zoneId` from DOM and internal tracking.
- `getZoneOverlays()` returns an array of all active zone overlay elements.
- `removeAllZoneOverlays()` removes all zone overlays from DOM and tracking.
- `unblurAll()` also calls `removeAllZoneOverlays()` to clean up zones alongside blurred elements.
- `_isExtensionUI` excludes zone overlays (elements with `bl-si-zone-overlay` class) from being treated as blur targets.

#### Category-based blurring
- `CATEGORY_SELECTORS` is a frozen constant mapping each category to `{ alwaysBlur: string[], textCheck: string[], roles?: string[] }`. Keys are UPPER_SNAKE_CASE: TEXT, MEDIA, FORM, TABLE, STRUCTURE. Element lists sourced from `docs/BLUR_CATEGORIES.md`.
- Selector cache (`selectorCache`) stores pre-joined selector strings keyed by a category toggle string — rebuilds automatically on key miss via `getSelectors(cats)`, no manual invalidation needed. The cache entry carries both `tagSet` and `roleSet` for the JS consumers.
- `matchesActiveCategories(element, categories)` and `shouldBlurElement(element, categories, thorough)` use the cached `tagSet` for O(1) tag lookup first, then fall through to a `getAttribute("role")` + `roleSet` check for ARIA role coverage (currently FORM only — `<div role="button">` etc.).
- `CATEGORY_SELECTORS` entries may include an optional `roles` list. `buildSelectors` emits `[role="X"]` attribute selectors into the generated `alwaysBlurSelector` CSS string so the browser handles role matching natively; do NOT hand-edit the selector string — only mutate roles by editing the `CATEGORY_SELECTORS` data shape.
- `_structuralTags` is derived from `STRUCTURE.textCheck` and prevents thorough-mode bypass for structural containers (`<div>`, `<section>`, `<li>`, `<dt>`, `<dd>`, etc.) to avoid nested-blur leaks on hover reveal. `<li>`/`<dt>`/`<dd>` live in STRUCTURE (not TEXT) as of the 2026-04 audit because they are containers, not phrasing content.

#### Single orchestration entry point: `blurAll()`
- `async blurAll()` — zero args. Pulls `settings`, `rules`, `blurState`, `items` from `blsi.Storage` in parallel, resolves per-URL settings via `blsi.UrlMatcher`, and reconciles DOM state to match. One call handles enable / disable / refresh / item diff / extension-disabled teardown. Safe to invoke from any path — init, storage onChange, shortcut, picker callback, SPA URL change.
- Storage is the single source of truth. Callers MUST write to storage first, then invoke `blurAll()` to materialise the change. Do NOT reach into `applyBlur` / `removeBlur` / zone overlays from outside the engine — those are low-level primitives used by picker / reveal only.
- Private state inside the IIFE: `_isPageBlurred`, `_domObserver`, `_dynamicCounter`, `_stickyCounter`, `_pickerActive`, `_currentSettings`, `_activeItems` (Map of currently-applied items by id). Do not introduce parallel state in callers.
- Internal helpers `_enablePageWide(settings)` / `_disablePageWide()` / `applyItem(item)` / `removeItem(item)` are private; `blurAll()` is the only public orchestrator. `allocateDynamicName()` / `allocateStickyName()` / `resetCounters()` remain public — picker callbacks need them for item naming before writing to storage.
- Item reconciliation via `_activeItems` Map (keyed by `selector` for dynamic, `id` for sticky). Items in storage but not tracked → `applyItem`; tracked but not in storage → `removeItem`.
- Counter seeding happens inside `applyItem` when called from `blurAll()` — the high-water mark is reconstructed from item names during restore, so callers only need `resetCounters()` once on init.
- MutationObserver reads `_currentSettings.THOROUGH_BLUR` fresh on every callback — never capture settings in a closure. Observer is gated by `_pickerActive` (set via `_setPickerActiveForObserver(v)` from content_script).
- `isBlurAllActive()` is the legacy DOM-check getter (tests rely on it). `get isPageBlurred` is the state-based getter — callers should prefer it.
- `blurAll()` depends on `blsi.Storage` and `blsi.UrlMatcher` being loaded. Tests stub both on `blsi` before calling — see `tests/unit/blur_engine.test.js` `fakeStorage` setup.

### url_matcher.js
- `matchesPattern(url, pattern, patternType)` — wildcard mode uses parse-then-match (scheme / hostname / port / path) with domain-boundary awareness. Regex mode rejects nested quantifiers (`(a+)+`, `a**`) to prevent ReDoS.
- `resolveSettings(url, globalSettings, rules)` — deep-merge over `DEFAULT_SETTINGS`, apply first matching rule. Non-array / null `rules` is tolerated.
- `MAX_PATTERN_LENGTH = 500`. Patterns exceeding this return `false` from `matchesPattern`.
- Pure module — no DOM access, no storage. Safe to load early in the manifest order (position 2, right after constants).

### reveal_controller.js
- `init({ getMode, isPickerActive })` — both are **functions**, not values. Called on every event, so the caller never has to re-init when `settings.REVEAL_MODE` or picker-active state changes.
- `clearAll()` resets every piece of reveal state: click-revealed element, hover-revealed element, ancestor chain, mouseout debounce timer, `_revealedElements` set. Called from `applyState` on `REVEAL_MODE` change and on `!settings.ENABLED`.
- `destroy()` removes all document listeners + `clearAll()`. Only used on disable paths.
- Listeners are registered at bubble phase on `document` for click/keydown/mouseover/mouseout. Input / textarea / select / button / contenteditable targets are skipped inside `onRevealClick` — do not move that guard.
- Hover mode has a 50ms mouseout debounce via `setTimeout`; reset on any mouseover to avoid flicker on element boundaries.

### selector_utils.js
- `getSelector(body)` and `getSelector(documentElement)` must return `null` — tests assert this.
- `getSelector(null)` must return `null` (not empty string).
- Strategy: unique id → stamp `data-bl-si-id`. No nth-child path (removed — breaks tests).
- `generateId()` returns an 8-char lowercase hex string.

### storage_manager.js
- All methods are Promise-based. `send()` is the single internal Promise wrapper.
- `saveSettings(fullSettings)` sends the complete settings object to background.js. No partial merges — caller must pass the full object.
- `getSettings()` is a passthrough — returns what background sends (already merged with defaults). Falls back to `buildDefaultSettings()` if background is unreachable.
- `getRules()` / `saveRules(rules)` — URL rules CRUD. Rules are an array of `{ id, name, pattern, patternType, settings }`.
- `saveBlurItem` must `return send(...)` (not `await send(...)` without return) so callers get the response.

### shortcut_handler.js
- `init(shortcuts, callbacks)` accepts `{ ACTION_NAME: { primaryModifier, keys: [{ key, code }] } }`.
- Tracks held keys via `Set<code>` on keydown/keyup. Window blur clears the Set.
- Matches shortcuts by checking: is primaryModifier held? Are ALL keys in keys[] held simultaneously?
- Key matching uses `event.code` (physical key, layout-independent).
- Early-exit guards: `event.repeat`, `event.isComposing`, `event.key === "Dead"`, `getModifierState("AltGraph")`.
- Fires `callbacks[actionName]` for any matched shortcut (TOGGLE_BLUR_ALL, TOGGLE_PICKER, CLEAR_ALL).
- Fires `callbacks.onExitPicker` on Escape when `_isPickerActive === true`.
- Listeners registered at capture phase (`addEventListener("keydown"/"keyup", fn, true)`).
- `_setPickerActive(v)` must be in the public return object.

### picker.js
- Toolbar: `toolbarEl.id = "bl-si-picker-toolbar"` (tests use `getElementById`).
- Toolbar appended to `document.body`, not `document.documentElement`.
- Blur/unblur decision: use `blsi.BlurEngine.isBlurred(target)` to detect both data-attribute and CSS-tag-rule blurs.
- Do not call `blsi.SelectorUtils` inside picker — it is not picker's responsibility.
- All event listeners at capture phase. `onClick` calls `stopPropagation` + `stopImmediatePropagation`.

### content_script.js
- Thin orchestrator. State: `globalSettings`, `settings`, `rules`, `isPickerActive`, `lastContextMenuTarget`, `hostname`, `lastUrl`. Per-blur state (counters, observer, `isPageBlurred`, reveal state, active items) lives in `blur_engine.js` / `reveal_controller.js` — do not re-introduce it here.
- Module aliases (`Engine`, `Store`, `UrlMatcher`, `Reveal`, `Picker`, `Shortcuts`, `Selector`) are assigned synchronously at the top of the IIFE — all `blsi.*` globals are available at load time via manifest script order.
- Use the `setPickerActive(active)` helper for every picker state change — it's the single source of truth that updates the local flag, `Shortcuts._setPickerActive`, AND `Engine._setPickerActiveForObserver` together. Do NOT update any of those three directly from call sites (TOGGLE_PICKER handler, pickerCallbacks.onDeactivate, applyState disable path all go through the helper). Skipping the observer gate leaves the MutationObserver silent for new DOM nodes after the picker closes, which silently breaks dynamic content on the page.
- Pass `settings.SHORTCUTS` directly to `Shortcuts.init()` — no flattening needed.
- `Reveal.init({ getMode: () => settings.REVEAL_MODE, isPickerActive: () => isPickerActive })` — pass functions, not values, so reveal state stays consistent without re-init on every settings change.
- `GET_STATUS` response: `{ isPageBlurred: Engine.isPageBlurred, isPickerActive, blurredCount: document.querySelectorAll('[data-bl-si-blur]').length }`.
- Async message handlers that need `sendResponse` must `return true` from `handleMessage`. `TOGGLE_BLUR_ALL`, `CLEAR_ALL_BLUR`, `CONTEXT_BLUR`, `CONTEXT_UNBLUR` are all async (storage write + `Engine.blurAll()`), so they return `true`.
- `settings.BLUR_CATEGORIES` is `{ TEXT, MEDIA, FORM, TABLE, STRUCTURE }` (UPPER_SNAKE_CASE).
- **All blur state changes go through `Engine.blurAll()`.** The public surface of `BlurEngine` no longer exposes `enableBlurAll` / `disableBlurAll` / `refreshBlurAll` / `applyItem` / `removeItem` — `_enablePageWide` / `_disablePageWide` / `applyItem` / `removeItem` still exist as **private** helpers inside the engine's IIFE, but they're unreachable from outside and must NOT be re-exposed. The pattern is: write to Storage, then `await Engine.blurAll()`. This applies to toggle, clear-all, context menu, picker callbacks, settings change, and init.
- **Every `blurAll()` call site MUST `await`.** The reconciler is async; fire-and-forget invocations let concurrent onChange events interleave two reconciles that corrupt the engine's `_activeItems` Map. This covers `applyState` (async — all three callers await), `handleStorageChange` (async), pickerCallbacks (already await), shortcutActionMap.CLEAR_ALL (already awaits), handleMessage async-IIFE branches (already await), and `init` (awaits on restore). Any new call site added in the future must follow suit.
- `applyState` awaits `Engine.blurAll()` at the end — no per-field branching on categories/mode/thorough/radius. The reconciler reads everything from storage and applies the delta, including skipping the page-wide nuke when nothing structural changed (see `_lastReconcileKey` in blur_engine.js).
- Settings resolution goes through `UrlMatcher.resolveSettings(location.href, globalSettings, rules)` → `applyState(newSettings, prev)` — used by init, `onSettingsChanged`, `onRulesChanged`, and `onUrlChange` (SPA). Engine internally re-resolves via the same UrlMatcher path, so `applyState` passing `settings` and Engine re-fetching converge on the same result.
- Storage onChange for `blurred_items` / `blur_all_hosts` collapses to a direct `Engine.blurAll()` call — no diff logic in content_script.
