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

| File | Namespace | Exposed API |
|---|---|---|
| `src/constants.js` | `globalThis.pb` | Message types (`pb.STORAGE.*`, `pb.COMMAND.*`, `pb.POPUP.*`), `DEFAULT_SETTINGS`, `isValid()`, `categoryOf()`, `buildDefaultSettings()`, `validateSettings()`, `deepMerge()` |
| `src/selector_utils.js` | `pb.SelectorUtils` | `getSelector`, `generateId`, `restoreSelector`, `restoreAllSelectors` |
| `src/storage_manager.js` | `pb.Storage` | `saveBlurItem`, `removeBlurItem`, `getBlurItems`, `clearHost`, `clearAll`, `getSettings`, `saveSettings`, `getRules`, `saveRules`, `getBlurState`, `saveBlurState` |
| `src/blur_engine.js` | `pb.BlurEngine` | `applyBlur`, `removeBlur`, `toggleBlur`, `blurAllContent`, `unblurAll`, `isBlurred`, `invalidateSelectorCache`, `matchesActiveCategories`, `shouldBlurElement`, `ensureSvgFilter`, `createZoneOverlay`, `removeZoneOverlay`, `getZoneOverlays`, `removeAllZoneOverlays`, `CATEGORY_SELECTORS` |
| `src/shortcut_handler.js` | `pb.Shortcuts` | `init`, `destroy`, `showToast`, `_setPickerActive` |
| `src/picker.js` | `pb.Picker` | `activate`, `deactivate`, `setSettings`, `setMode`, `isActive` (getter) |
| `content_script.js` | _(none — orchestrator)_ | Binds all modules via `pb.*` aliases after DOM ready |

**Load order is fixed by `manifest.json`** — constants → selector_utils → storage_manager → blur_engine → shortcut_handler → picker → content_script. Never reorder.

---

## Critical: Message Protocol

Any mismatch between sender message type and background.js handler silently drops the message.

### storage_manager.js → background.js

| Action | Type string |
|---|---|
| Fetch blur items for host | `GET_BLUR_ITEMS` |
| Save a blur item | `SAVE_BLUR_ITEM` |
| Remove a blur item | `REMOVE_BLUR_ITEM` |
| Clear all blur items for host | `CLEAR_HOST` |
| Clear all blur items everywhere | `CLEAR_ALL` |
| Fetch settings (merged with defaults) | `GET_SETTINGS` |
| Persist settings (partial merge) | `SAVE_SETTINGS` |
| Fetch URL rules array | `GET_RULES` |
| Persist URL rules array | `SAVE_RULES` |

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
| Unblur a specific item | `UNBLUR_ITEM` |

---

## Critical: Settings Shape

Settings use UPPER_SNAKE_CASE keys everywhere. There is no two-shape duality — the same shape is used in storage, background, content script, and popup.

**`settings.SHORTCUTS`** — per-command shortcut definitions:
```js
settings.SHORTCUTS = {
  TOGGLE_BLUR_ALL: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'b', code: 'KeyB' }]
  },
  TOGGLE_PICKER: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'p', code: 'KeyP' }]
  },
  CLEAR_ALL_BLUR: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'u', code: 'KeyU' }]
  }
}
```

`content_script.js` passes `settings.SHORTCUTS` directly to `Shortcuts.init()` — no flattening needed.

**`REVEAL_MODE`** — controls how blurred elements can be temporarily revealed: `'hover'` | `'click'` | `'none'`.

**`THOROUGH_BLUR`** — boolean; when true, applies deeper blur processing for more thorough coverage.

**`PICKER_MODE`** — controls the picker strategy: `'sticky'` (draw rectangle, default) | `'dynamic'` (click element).

**All default values live in `src/constants.js` → `PrivacyBlur.DEFAULTS`.** Do not hardcode defaults anywhere else.

### Settings Shape: blurCategories

Unlike shortcuts, `blurCategories` has the **same shape everywhere** -- no flattening needed.

**In `chrome.storage.local` / background / `PrivacyBlurStorage.getSettings()` / content_script.js / popup.js:**
```js
settings.BLUR_CATEGORIES = {
  TEXT: true,        // headings, paragraphs, spans, etc.
  MEDIA: true,       // img, video, audio, canvas, svg, picture, figure
  FORM: false,       // input, textarea, select, button, label, fieldset
  TABLE: true,       // table, thead, tbody, tr, td, th
  STRUCTURE: true    // div, section, article, nav, aside, header, footer, main, li
}
```

Default values live in `src/constants.js` → `PrivacyBlur.DEFAULTS.BLUR_CATEGORIES`. The per-category element lists are defined in `src/blur_engine.js` → `CATEGORY_SELECTORS`.

Note: the section heading says "blurCategories" but the key is now `BLUR_CATEGORIES` (UPPER_SNAKE_CASE), consistent with the rest of the settings shape.

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

### Blur engine element handling
All elements (video, img, text containers, generic) are blurred via CSS class only (`pb-blurred`). CSS `filter: blur()` on a parent blurs all descendants — no canvas overlays, no text-node wrapping, no DOM injection. This means:
- No `position: relative` injection on parent elements (was breaking layouts)
- No `requestAnimationFrame` loops for video (CSS blur works on DRM video too)
- No text-node wrapper spans (CSS blur covers text nodes via parent filter)
- Live radius updates propagate instantly via `var(--pb-radius)` from `:root`

### CSS class constants (do not invent new names)
| Constant | Value |
|---|---|
| Blur class | `pb-blurred` |
| Frosted glass mode | `pb-frosted` |
| Canvas overlay | `pb-canvas-overlay` |
| Text wrapper | `pb-text-node-wrapper` |
| Hover highlight | `pb-hover-highlight` |
| Picker active (on `<html>`) | `pb-picker-active` |
| Toolbar | `pb-toolbar` (id: `pb-picker-toolbar`) |
| Click-to-reveal active state | `pb-revealed` |
| Ancestor chain unblur (click and hover) | `pb-ancestor-reveal` |
| Hover-to-reveal target | `pb-reveal-on-hover` |
| Sticky zone overlay | `pb-zone-overlay` |
| Zone drawing preview | `pb-zone-drawing` |
| Zone hover highlight (picker mode) | `pb-zone-highlight` |
| Zone name label | `pb-zone-label` |

---

## Testing

### Running tests
```bash
npm run test:unit          # 221 unit tests, fast
npm test                   # + coverage (~91% line coverage on src/)
```

### Constraints (from hard-learned failures)

| Rule | Why |
|---|---|
| Use `require(MODULE_PATH)` to load source files in tests | `require()` lets Jest instrument for coverage. Fallback to `(0, eval)(buildStubSource())` when file missing. |
| `global.window = global` must be in `tests/setup.js` | IIFEs assign `window.PrivacyBlur*`; without this alias, the globals are lost |
| `requestAnimationFrame` mock must NOT call the callback | Video blur uses `requestAnimationFrame` in an infinite loop; auto-executing causes OOM |
| `HTMLCanvasElement.prototype.getContext` must be mocked | jsdom returns `null` from `getContext()`; `ctx.clearRect()` then throws |
| `KeyboardEvent.prototype.getModifierState` must be mocked | jsdom may not implement it; shortcut handler uses it for AltGr detection |
| All 6 test files use the same load pattern | `fs.existsSync(MODULE_PATH) ? require(MODULE_PATH) : eval(buildStubSource())` |

### Adding a new unit test file

Follow the pattern in any existing `tests/unit/*.test.js`:
1. `loadXxx()` guards with `if (global.PrivacyBlurXxx) return;`
2. Use `require(MODULE_PATH)` to load the source (enables coverage)
3. Provide a `buildStubSource()` that matches the public contract exactly
4. `afterEach` or `beforeEach` must clean up any DOM and call `destroy()` if applicable
5. **Add every new test to `docs/TEST_VALIDATION.md`** with manual replication steps

---

## Firefox Compatibility Rules

- Use only `chrome.*` namespace (Firefox 109+ exposes it as a compatibility shim).
- Do NOT use `browser.*` — Chrome does not have it.
- Service worker (`background.js`) must be stateless between wake cycles — never store mutable state in module-level variables in background.js.
- Always guard against `moz-extension://` URLs in background.js tab listeners (already done).
- Test shortcut behaviour: `Ctrl+K` may conflict with Firefox address bar on some platforms; document this in release notes.

---

## Documentation Maintenance

Docs are not optional artifacts — they are load-bearing references used by both humans and Claude. When code changes, the relevant docs MUST be updated in the same change.

### When to update which doc

| What changed | Update |
|---|---|
| Added/removed/renamed a public API method on any module | `CLAUDE.md` Module Globals table, `src/CLAUDE.md` module-specific rules, `docs/LLD.md` contract |
| Added/removed a `chrome.runtime.sendMessage` type | `src/constants.js` (source of truth), `CLAUDE.md` Message Protocol tables, `docs/HLD.md §6` protocol table |
| Changed a default value (blur radius, chord keys, etc.) | `src/constants.js` DEFAULTS — all other files reference it |
| Changed settings shape (new keys, renamed keys) | `CLAUDE.md` Settings Shape section, `docs/LLD.md` |
| Added a new source file under `src/` | `CLAUDE.md` Module Globals table, `src/CLAUDE.md` load order, `manifest.json` content_scripts |
| Added/modified/removed a unit test | `docs/TEST_VALIDATION.md` — add entry with test name, assertion, and manual replication steps |
| Added a new test file | `docs/TEST_VALIDATION.md` new section, `tests/CLAUDE.md` if test patterns differ |
| Changed test loading pattern or setup | `CLAUDE.md` Testing section, `tests/CLAUDE.md` |
| Changed keyboard shortcut handling | `CLAUDE.md` Settings Shape section, `src/CLAUDE.md` shortcut_handler rules |
| Changed CSS class names or IDs | `CLAUDE.md` CSS class constants table |
| Changed Firefox compatibility behavior | `CLAUDE.md` Firefox Compatibility Rules |
| Found a new known limitation | `CLAUDE.md` Known Limitations table |

### Rules

1. **Same-commit rule** — doc updates go in the same commit as the code change. Never leave docs for a follow-up.
2. **Update, don't append** — when a behavior changes, find and update the existing doc entry. Don't add a new contradicting entry.
3. **Test count** — keep the test count in the Testing section current. Run `npm run test:unit` and update the number.
4. **TEST_VALIDATION.md** — every test must have: test name, what it asserts, and step-by-step manual replication instructions. When adding a test, add its entry. When modifying a test, update its entry. When removing a test, remove its entry.
5. **Don't document internals** — only document things that affect how other code interacts with a module (public API, message types, settings shapes, CSS classes). Private implementation details belong in code comments, not docs.

---

## Known Limitations (do not "fix" without understanding the tradeoff)

| Issue | Root cause | Status |
|---|---|---|
| ~~DRM video shows dark overlay~~ | Fixed — CSS `filter: blur()` works on DRM video (DRM blocks pixel extraction, not CSS rendering) | Resolved |
| SPA selector staleness | `data-pb-id` stamped at blur time; re-rendered elements get new DOM nodes | Documented in `docs/CROSS_BROWSER.md §6.3` |
| Context menu blur has no element targeting | `contextMenus.onClicked` does not capture `targetElementId` in current impl | Known gap — `docs/CROSS_BROWSER.md §6.6` |
| `position: fixed` inside blurred containers shifts | CSS `filter` creates stacking context — browser spec behaviour | User education in README |
| `position: sticky` inside blurred containers stops sticking | CSS `filter` creates stacking context — spec behaviour | Same root cause as `position: fixed` issue |
| `<select>` dropdown options visible when opened | CSS filter only blurs closed state | Known limitation |
