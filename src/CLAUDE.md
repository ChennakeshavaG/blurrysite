# src/ — Module Authoring Guide

See `../CLAUDE.md` for the full project rules. This file covers src/-specific patterns.

## IIFE Pattern (mandatory)

Every file in src/ must follow this exact structure:

```js
/**
 * module_name.js — one-line purpose
 *
 * Exposed as window.PrivacyBlurXxx (IIFE — no ES module syntax).
 */

const PrivacyBlurXxx = (() => {
  'use strict';

  // private state here

  function publicMethod() { ... }

  return { publicMethod };
})();

window.PrivacyBlurXxx = PrivacyBlurXxx;
```

Rules:
- No `import` / `export` / `require` anywhere.
- One `window.*` assignment per file, at the very end.
- The global name is always `PrivacyBlur` + PascalCase module name.
- `'use strict'` inside the IIFE.

---

## Module Load Order (enforced by manifest.json)

```
0. constants.js        → globalThis.PrivacyBlur (message types + DEFAULTS)
1. selector_utils.js   → window.PrivacyBlurSelectorUtils
2. storage_manager.js  → window.PrivacyBlurStorage
3. blur_engine.js      → window.PrivacyBlurEngine
4. shortcut_handler.js → window.PrivacyBlurShortcuts
5. picker.js           → window.PrivacyBlurPicker
6. content_script.js   → (no global, binds all above)
```

A module may only depend on modules loaded before it.
`content_script.js` binds all globals to local aliases inside `init()` (after DOM ready), not at top-level.

---

## Module-Specific Rules

### blur_engine.js
- `applyBlur` is idempotent — always guard with `if (isBlurred(el)) return`.
- Video elements use `videoOverlayMap` (WeakMap) to track canvas + RAF handle. Never store canvas on `el._pbCanvas` — that was a previous iteration.
- Canvas class must be `"pb-canvas-overlay"` exactly. CSS in `styles/content.css` references this.
- IMG blur: `data-pb-blur` attribute + CSS rule `[data-pb-blur] { filter: blur(var(--pb-radius)) }`. No inline `style.filter`.

#### Zone overlay methods
- `createZoneOverlay(zoneData)` appends an overlay `<div>` to `document.body`. Overlays use the `data-pb-zone` attribute (set to `zoneData.id`) for identification.
- `removeZoneOverlay(zoneId)` removes the overlay matching `zoneId` from DOM and internal tracking.
- `getZoneOverlays()` returns an array of all active zone overlay elements.
- `removeAllZoneOverlays()` removes all zone overlays from DOM and tracking.
- `unblurAll()` also calls `removeAllZoneOverlays()` to clean up zones alongside blurred elements.
- `_isExtensionUI` excludes zone overlays (elements with `pb-zone-overlay` class) from being treated as blur targets.

#### Category-based blurring
- `CATEGORY_SELECTORS` is a frozen constant mapping each category to `{ alwaysBlur: string[], textCheck: string[] }`. Keys are UPPER_SNAKE_CASE: TEXT, MEDIA, FORM, TABLE, STRUCTURE. Element lists sourced from `docs/BLUR_CATEGORIES.md`.
- Selector cache (`selectorCache`) stores pre-joined selector strings keyed by a 5-bit category toggle string. Invalidated by `invalidateSelectorCache()`.
- `blurAllContent(radius, options)` accepts optional `options.categories`. When omitted, defaults to all categories ON (backward compatible).
- `matchesActiveCategories(element, categories)` uses the cached `tagSet` for O(1) tag lookup.

### selector_utils.js
- `getSelector(body)` and `getSelector(documentElement)` must return `null` — tests assert this.
- `getSelector(null)` must return `null` (not empty string).
- Strategy: unique id → stamp `data-pb-id`. No nth-child path (removed — breaks tests).
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
- Toolbar: `toolbarEl.id = "pb-picker-toolbar"` (tests use `getElementById`).
- Toolbar appended to `document.body`, not `document.documentElement`.
- Blur/unblur decision: use `pb.BlurEngine.isBlurred(target)` to detect both data-attribute and CSS-tag-rule blurs.
- Do not call `PrivacyBlurSelectorUtils` inside picker — it is not picker's responsibility.
- All event listeners at capture phase. `onClick` calls `stopPropagation` + `stopImmediatePropagation`.

### content_script.js
- Module aliases (`Engine`, `Store`, etc.) are assigned synchronously at the top of the IIFE — all `pb.*` globals are available at load time via manifest script order.
- Call `Shortcuts._setPickerActive(true/false)` whenever `isPickerActive` changes.
- Pass `settings.SHORTCUTS` directly to `Shortcuts.init()` — no flattening needed.
- `GET_STATUS` response: count blurred elements as `document.querySelectorAll('[data-pb-blur]').length`.
- Async message handlers that need `sendResponse` must `return true` from `handleMessage`.
- `settings.BLUR_CATEGORIES` is `{ TEXT, MEDIA, FORM, TABLE, STRUCTURE }` (UPPER_SNAKE_CASE).
- `TOGGLE_BLUR_ALL` passes `{ categories: settings.BLUR_CATEGORIES, thoroughBlur: settings.THOROUGH_BLUR }` to `Engine.blurAllContent`.
- MutationObserver gates new nodes with `Engine.matchesActiveCategories(node, settings.BLUR_CATEGORIES)`.
- `UPDATE_SETTINGS` and `storage.onChanged` both invalidate selector cache and re-blur when categories or thoroughBlur change while blur-all is active.
