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
- IMG blur: apply `style.filter` directly on the `<img>`, not on a wrapper.

### selector_utils.js
- `getSelector(body)` and `getSelector(documentElement)` must return `null` — tests assert this.
- `getSelector(null)` must return `null` (not empty string).
- Strategy: unique id → stamp `data-pb-id`. No nth-child path (removed — breaks tests).
- `generateId()` returns an 8-char lowercase hex string.

### storage_manager.js
- All methods are Promise-based. `send()` is the single internal Promise wrapper.
- `saveSettings(partial)` sends the partial directly to background.js, which deep-merges it with stored settings. Do NOT pre-merge in storage_manager — that causes a redundant double merge.
- `getSettings()` must merge response with `DEFAULT_SETTINGS` via `Object.assign({}, DEFAULT_SETTINGS, stored)`.
- `saveBlurredElement` must `return send(...)` (not `await send(...)` without return) so callers get the response.
- DEFAULT_SETTINGS keys: `blurRadius`, `highlightColor`, `transitionDuration`, `revealOnHover`, `enabled`, `shortcuts`.

### shortcut_handler.js
- `init(settings, callbacks)` reads **flat** settings: `settings.chordKey`, `settings.chordSecond`, `settings.chordCode1`, `settings.chordCode2`, `settings.chordModifier`.
- **Does not apply defaults** — callers must pass complete settings. All defaults live in `constants.js → PrivacyBlur.DEFAULTS`.
- Key matching prefers `event.code` (physical key, layout-independent) with `event.key` fallback for legacy settings without codes.
- Early-exit guards: `event.repeat`, `event.isComposing`, `event.key === "Dead"`, `getModifierState("AltGraph")`.
- Fires `callbacks.TOGGLE_BLUR_ALL` (uppercase, no `on` prefix).
- Fires `callbacks.onExitPicker` only when `_isPickerActive === true`.
- Second chord key requires NO modifiers held (`!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey`).
- Listener registered at capture phase (`addEventListener("keydown", fn, true)`).
- `_setPickerActive(v)` must be in the public return object.

### picker.js
- Toolbar: `toolbarEl.id = "pb-picker-toolbar"` (tests use `getElementById`).
- Toolbar appended to `document.body`, not `document.documentElement`.
- Blur/unblur decision: `target.classList.contains("pb-blurred")` — do not call `PrivacyBlurEngine.isBlurred()`.
- Do not call `PrivacyBlurSelectorUtils` inside picker — it is not picker's responsibility.
- All event listeners at capture phase. `onClick` calls `stopPropagation` + `stopImmediatePropagation`.

### content_script.js
- Bind module aliases inside `init()` after DOM ready, not at top level.
- Call `Shortcuts._setPickerActive(true/false)` whenever `isPickerActive` changes.
- Use `shortcutSettings()` helper to flatten nested `settings.shortcuts` before calling `Shortcuts.init()`.
- `GET_STATUS` response: count blurred elements as `document.querySelectorAll('.pb-blurred').length`.
- Async message handlers that need `sendResponse` must `return true` from `handleMessage`.
