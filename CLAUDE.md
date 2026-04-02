# PrivacyBlur — Claude Instructions

## What This Project Is

A Chrome/Firefox MV3 browser extension. Vanilla JS only — no bundler, no ES modules, no TypeScript.
All source files are IIFEs that assign a single `window.PrivacyBlur*` global.

Full design docs: `docs/HLD.md` (architecture), `docs/LLD.md` (contracts + algorithms), `docs/CROSS_BROWSER.md` (compatibility + extensibility gaps).

---

## Before Any Change

1. Run tests first to confirm green baseline: `npm run test:unit`
2. Check `docs/LLD.md` for the module contract you're touching — do not introduce new public API surface without updating that file.
3. If adding a new `chrome.runtime.sendMessage` message type, update **both** `background.js` (handler) and the relevant source module, and add it to the protocol table in `docs/HLD.md §6`.

---

## Critical: Module Globals

Every source file exposes exactly one window global. Using the wrong name causes a silent `undefined` crash in the page context.

| File | Global | Exposed API |
|---|---|---|
| `src/selector_utils.js` | `window.PrivacyBlurSelectorUtils` | `getSelector`, `generateId`, `restoreSelector`, `restoreAllSelectors` |
| `src/storage_manager.js` | `window.PrivacyBlurStorage` | `saveBlurredElement`, `removeBlurredElement`, `getBlurredSelectors`, `clearHost`, `clearAll`, `getSettings`, `saveSettings` |
| `src/blur_engine.js` | `window.PrivacyBlurEngine` | `applyBlur`, `removeBlur`, `toggleBlur`, `blurAllContent`, `unblurAll`, `isBlurred` |
| `src/shortcut_handler.js` | `window.PrivacyBlurShortcuts` | `init`, `destroy`, `showToast`, `_setPickerActive` |
| `src/picker.js` | `window.PrivacyBlurPicker` | `activate`, `deactivate`, `setSettings`, `isActive` (getter) |
| `content_script.js` | _(none — orchestrator)_ | Binds all globals via aliases after DOM ready |

**Load order is fixed by `manifest.json`** — selector_utils → storage_manager → blur_engine → shortcut_handler → picker → content_script. Never reorder.

---

## Critical: Message Protocol

Any mismatch between sender message type and background.js handler silently drops the message.

### storage_manager.js → background.js

| Action | Type string |
|---|---|
| Fetch selectors for host | `GET_SELECTORS` |
| Save a selector | `SAVE_SELECTOR` |
| Remove a selector | `REMOVE_SELECTOR` |
| Clear all selectors for host | `CLEAR_HOST` |
| Clear all selectors everywhere | `CLEAR_ALL` |
| Fetch settings (merged with defaults) | `GET_SETTINGS` |
| Persist settings (partial merge) | `SAVE_SETTINGS` |

### background.js → content_script.js (command relay + restore)

| Trigger | Type string |
|---|---|
| Alt+Shift+B shortcut | `TOGGLE_BLUR_ALL` |
| Alt+Shift+P shortcut | `TOGGLE_PICKER` |
| Alt+Shift+U shortcut | `CLEAR_ALL_BLUR` |
| Page load complete | `RESTORE` |
| Context menu blur | `CONTEXT_BLUR` |
| Context menu unblur | `CONTEXT_UNBLUR` |

### popup.js → content_script.js

| Action | Type string |
|---|---|
| Live settings update | `UPDATE_SETTINGS` |
| Query page status | `GET_STATUS` |

---

## Critical: Settings Shape Mismatch

Two different shapes exist for shortcut settings. **Do not confuse them.**

**In `chrome.storage.local` / background / `PrivacyBlurStorage.getSettings()`** — nested:
```js
settings.shortcuts = { chordKey1: "k", chordKey2: "v", chordModifier: "ctrl" }
```

**In `PrivacyBlurShortcuts.init(settings, callbacks)`** — flat:
```js
{ chordKey: "k", chordSecond: "v", chordModifier: "ctrl" }
```

`content_script.js` flattens via `shortcutSettings()` helper before calling `Shortcuts.init()`. If you add shortcut config keys, update both shapes and `shortcutSettings()`.

---

## Critical: Code Patterns

### All source files must be IIFEs
```js
const PrivacyBlurXxx = (() => {
  // ...
  return { publicMethod };
})();
window.PrivacyBlurXxx = PrivacyBlurXxx;
```

### No ES module syntax
No `import`, `export`, `import()`, or `require()` in any file under `src/`, `background.js`, or `popup/`. The extension has no build step.

### Blur engine element handling — dispatch order
1. `<video>` → canvas overlay + RAF loop (`pb-canvas-overlay` class)
2. `<img>` → direct `style.filter = blur()` + `pb-blurred` class
3. Background-image elements → `pb-blurred` class only (CSS handles it)
4. Everything else → wrap text nodes if needed, then `pb-blurred` class

### CSS class constants (do not invent new names)
| Constant | Value |
|---|---|
| Blur class | `pb-blurred` |
| Canvas overlay | `pb-canvas-overlay` |
| Text wrapper | `pb-text-node-wrapper` |
| Hover highlight | `pb-hover-highlight` |
| Picker active (on `<html>`) | `pb-picker-active` |
| Toolbar | `pb-toolbar` (id: `pb-picker-toolbar`) |

---

## Testing

### Running tests
```bash
npm run test:unit          # 104 unit tests, fast
npm test                   # + coverage (must stay ≥70% lines & functions)
```

### Constraints (from hard-learned failures this session)

| Rule | Why |
|---|---|
| Use `(0, eval)(src)` to load source files in tests | `vm.runInThisContext` runs in Node.js V8 context where `window` is undefined; `eval` runs in Jest's jsdom context |
| `global.window = global` must be in `tests/setup.js` | IIFEs assign `window.PrivacyBlur*`; without this alias, the globals are lost |
| `requestAnimationFrame` mock must NOT call the callback | Video blur uses `requestAnimationFrame` in an infinite loop; auto-executing causes OOM |
| `HTMLCanvasElement.prototype.getContext` must be mocked | jsdom returns `null` from `getContext()`; `ctx.clearRect()` then throws |
| All 5 test files use the same load pattern | `fs.existsSync(MODULE_PATH) ? readFile : buildStubSource()` — stubs are the contract spec |

### Adding a new unit test file

Follow the pattern in any existing `tests/unit/*.test.js`:
1. `loadXxx()` guards with `if (global.PrivacyBlurXxx) return;`
2. Use `(0, eval)(src)` to execute the source
3. Provide a `buildStubSource()` that matches the public contract exactly
4. `afterEach` or `beforeEach` must clean up any DOM and call `destroy()` if applicable

---

## Firefox Compatibility Rules

- Use only `chrome.*` namespace (Firefox 109+ exposes it as a compatibility shim).
- Do NOT use `browser.*` — Chrome does not have it.
- Service worker (`background.js`) must be stateless between wake cycles — never store mutable state in module-level variables in background.js.
- Always guard against `moz-extension://` URLs in background.js tab listeners (already done).
- Test shortcut behaviour: `Ctrl+K` may conflict with Firefox address bar on some platforms; document this in release notes.

---

## Known Limitations (do not "fix" without understanding the tradeoff)

| Issue | Root cause | Status |
|---|---|---|
| DRM video shows dark overlay instead of blurred video | `ctx.drawImage()` throws on DRM content; caught and filled with dark rect | By design |
| SPA selector staleness | `data-pb-id` stamped at blur time; re-rendered elements get new DOM nodes | Documented in `docs/CROSS_BROWSER.md §6.3` |
| Context menu blur has no element targeting | `contextMenus.onClicked` does not capture `targetElementId` in current impl | Known gap — `docs/CROSS_BROWSER.md §6.6` |
| `position: fixed` inside blurred containers shifts | CSS `filter` creates stacking context — browser spec behaviour | User education in README |
