# Blurry Site — Claude Instructions

## What This Project Is

A Chrome/Firefox MV3 browser extension. Vanilla JS only — no bundler, no ES modules, no TypeScript.
All source files are IIFEs that assign a single `window.BlurrySite*` global.

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
| `src/constants.js` | `globalThis.blsi` | Message types (`blsi.STORAGE.*`, `blsi.COMMAND.*`, `blsi.POPUP.*`), `DEFAULT_SETTINGS` (no SHORTCUTS — built lazily), `REVEAL_DFS_MAX_DEPTH`, `MODIFIER_CODES`, `isValid()`, `categoryOf()`, `buildDefaultSettings()`, `validateSettings()`, `isValidShortcutEntry()`, `deepMerge()` |
| `src/logger.js` | `blsi.Logger` | `log`, `warn`, `error`, `flow(tag, data?)`, `scope(name)`, `enable`, `disable`, `get enabled`. Persists toggle to `chrome.storage.local.blsi_debug`. Listens on `chrome.storage.onChanged` for cross-context state sync. `error` always logs; everything else gated. `scope(name)` returns a tagged variant `{log, warn, error, flow, get enabled}`. |
| `src/action_registry.js` | `blsi.Actions` | Single source of truth for shortcut-driven actions. `list()`, `get(id)`, `ids()`, `defaultBindings()`, `ACTIONS`. Each action has `{ id, label, description, defaultBinding, messageType, chromeCommand }`. Adding a new action is one entry here. |
| `src/shortcut_label.js` | `blsi.ShortcutLabel` | Platform-aware label rendering + reserved chord list. `codeLabel(code)`, `modLabel(mod)`, `chordLabel({code, mods})`, `bindingLabel([...])`, `chordKey(chord)`, `bindingKey(binding)`, `IS_MAC`, `CODE_TO_LABEL`. Mac renders `⌘⇧⌥⌃`, Windows/Linux renders spelled-out mods. Also: `isReserved(chord)`, `lookup(chord)`, `RESERVED` — warning-only hint list (~14 entries); capture UI allows save regardless. |
| `src/url_matcher.js` | `blsi.UrlMatcher` | `matchesPattern`, `resolveSettings`, `MAX_PATTERN_LENGTH` |
| `src/selector_utils.js` | `blsi.SelectorUtils` | `getSelector`, `generateId`, `restoreSelector`, `restoreAllSelectors` |
| `src/storage_manager.js` | `blsi.Storage` | `saveBlurItem`, `removeBlurItem`, `getBlurItems`, `clearHost`, `clearAll`, `getSettings`, `saveSettings`, `getRules`, `saveRules`, `getBlurState`, `saveBlurState` |
| `src/tab_privacy.js` | `blsi.TabPrivacy` | `enable()`, `disable()`, `isActive` (getter) — replaces the tab title with `…` when active |
| `src/pii_detector.js` | `blsi.PiiDetector` | `scan(rootEl, types)`, `clear(rootEl)`, `observeMutations(rootEl)`, `stopObserving()`, `getMatchCount()`, `getPatterns()` — text-node split approach; wraps matches in `[data-bl-si-pii]` spans with `[data-bl-si-blur]` |
| `src/blur_engine.js` | `blsi.BlurEngine` | Low-level: `applyBlur`, `removeBlur`, `toggleBlur`, `unblurAll`, `isBlurred`, `isVisuallyBlurred`, `injectRules`, `removeRules`, `isBlurAllActive`, `stampElements` (returns `ShadowRoot[]`), `tryBlurTextCheck`, `matchesActiveCategories`, `shouldBlurElement`, `ensureSvgFilter`, `createZoneOverlay`, `removeZoneOverlay`, `getZoneOverlays`, `removeAllZoneOverlays`, `teardown`, `CATEGORY_SELECTORS`. High-level: `handleSite`, `handleDocument`, `observeRoot`, `disconnectObserver`, `resetCounters`, `allocateDynamicName`, `allocateStickyName`, `isPageBlurred` (getter), `_setPickerActiveForObserver` |
| `src/blur_timer.js` | `blsi.BlurTimer` | `start(minutes, onExpire)`, `stop()`, `getRemaining()`, `isActive()` — countdown timer that fires `onExpire` when elapsed |
| `src/auto_blur.js` | `blsi.AutoBlur` | `init(callbacks)`, `destroy()`, `isIdle()` — idle + tab-switch auto-blur; callbacks: `{ onIdle, onActive, onTabSwitch }` |
| `src/reveal_controller.js` | `blsi.Reveal` | `init({ getMode, isPickerActive })`, `destroy`, `clearAll` |
| `src/shortcut_handler.js` | `blsi.Shortcuts` | `init(shortcuts, callbacks)` — accepts the new `{ ACTION_ID: { binding: [{code, mods}] } }` shape. `destroy`, `showToast`, `_setPickerActive`, `_getFireToken` (for content_script dedup). Reads mods from event booleans (side-agnostic). Reads label from `blsi.Actions.get(id).label` for toast. |
| `src/selection_blur.js` | `blsi.SelectionBlur` | `init()`, `destroy()`, `blurSelection(range)`, `clearAll()`, `getSelectionBlurs()`, `removeSelectionBlur(id)` — text-selection driven blur via `[data-bl-si-blur]` spans |
| `src/screenshot.js` | `blsi.Screenshot` | `captureViewport()`, `download(dataUrl, filename)`, `copyToClipboard(dataUrl)`, `startCrop()`, `cancelCrop()` — viewport capture with blur preserved |
| `src/picker.js` | `blsi.Picker` | `activate`, `deactivate`, `setSettings`, `setMode`, `isActive` (getter) |
| `content_script.js` | _(none — orchestrator)_ | Binds all modules via `blsi.*` aliases after DOM ready |

**Load order is fixed by `manifest.json`** — constants → content_i18n → logger → action_registry → shortcut_label → url_matcher → selector_utils → storage_manager → tab_privacy → pii_detector → blur_engine → blur_timer → auto_blur → reveal_controller → shortcut_handler → selection_blur → screenshot → picker → content_script. Never reorder.

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

**`settings.SHORTCUTS`** — per-action shortcut definitions (v2 shape):
```js
settings.SHORTCUTS = {
  TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] },
  TOGGLE_PICKER:   { binding: [{ code: 'KeyP', mods: ['Alt', 'Shift'] }] },
  CLEAR_ALL:       { binding: [{ code: 'KeyU', mods: ['Alt', 'Shift'] }] },
}
```

- Keys are action ids from `blsi.Actions` (not message-type strings).
- `binding` is an array of chords. Phase 1 always has `length === 1`; phase 2 will add multi-chord sequences like `[{code: 'KeyG'}, {code: 'KeyI'}]` for Gmail-style `g i`.
- `code` is `KeyboardEvent.code` (physical key, layout-independent).
- `mods` is a sorted subset of `{"Alt","Control","Meta","Shift"}`. Left/right is folded away — `AltLeft` and `AltRight` both map to `"Alt"`.
- `DEFAULT_SETTINGS.SHORTCUTS` is NOT in `constants.js` — defaults come from `blsi.Actions.defaultBindings()` and are merged in by `buildDefaultSettings()`.

`content_script.js` passes `settings.SHORTCUTS` directly to `Shortcuts.init()` — no flattening needed.

**`REVEAL_MODE`** — controls how blurred elements can be temporarily revealed: `'hover'` | `'click'` | `'none'`.

**`THOROUGH_BLUR`** — boolean; when true, applies deeper blur processing for more thorough coverage.

**`PICKER_MODE`** — controls the picker strategy:
- `'sticky-page'` (default) — sketch a box anchored to the document. Scrolls with the page content. Stored with `anchor: 'page'`.
- `'sticky-screen'` — sketch a box anchored to the viewport. Stays fixed on screen during scroll. Stored with `anchor: 'screen'`. Best for screen-sharing / streaming.
- `'dynamic'` — tap an element to blur it (selector-based, follows the element).

Legacy `'sticky'` is migrated to `'sticky-page'` in `validateSettings`. Sticky zones stored without an `anchor` field default to `'page'` at restore time.

**All default values live in `src/constants.js` → `BlurrySite.DEFAULTS`.** Do not hardcode defaults anywhere else.

### Settings Shape: blurCategories

Unlike shortcuts, `blurCategories` has the **same shape everywhere** -- no flattening needed.

**In `chrome.storage.local` / background / `blsi.Storage.getSettings()` / content_script.js / popup.js:**
```js
settings.BLUR_CATEGORIES = {
  TEXT: true,        // headings, paragraphs, spans, etc.
  MEDIA: true,       // img, video, audio, canvas, svg, picture, figure
  FORM: false,       // input, textarea, select, button, label, fieldset
  TABLE: true,       // table, thead, tbody, tr, td, th
  STRUCTURE: true    // div, section, article, nav, aside, header, footer, main, li
}
```

Default values live in `src/constants.js` → `BlurrySite.DEFAULTS.BLUR_CATEGORIES`. The per-category element lists are defined in `src/blur_engine.js` → `CATEGORY_SELECTORS`.

Note: the section heading says "blurCategories" but the key is now `BLUR_CATEGORIES` (UPPER_SNAKE_CASE), consistent with the rest of the settings shape.

### Settings Shape: AUTO_DETECT

Controls automatic PII detection. Same shape everywhere — no flattening needed.

**In `chrome.storage.local` / background / `blsi.Storage.getSettings()` / content_script.js / popup.js:**
```js
settings.AUTO_DETECT = {
  EMAIL:   false,   // boolean — email addresses (local@domain.tld)
  NUMERIC: 'off',   // 'off' | 'standard' | 'conservative'
}
```

- `EMAIL` is a boolean. Default `false`.
- `NUMERIC` is a string enum. Default `'off'`.
  - `'standard'` — broad regex, hides all matched numbers. Best for screen sharing.
  - `'conservative'` — label-context aware; only hides numbers near Tier A labels (balance, salary, account, invoice, etc.) with no price-suppressor present (/month, cart, qty).

Default values live in `src/constants.js` → `DEFAULTS.AUTO_DETECT`.

The popup shows a master toggle (sets `EMAIL=true`/`NUMERIC='standard'` on enable) and a NUMERIC dropdown (`off`/`standard`/`conservative`). The master toggle's `expandKeys` uses `{ key, onValue, offValue }` objects; `popup.js patchManySettings` handles both plain key strings and object entries.

**Gate check** — `'off'` is a truthy string; always use explicit check: `NUMERIC && NUMERIC !== 'off'` rather than `Boolean(NUMERIC)`.

PII blur is **independent of blur-all**. PII spans carry `[data-bl-si-pii]` only — no `[data-bl-si-blur]`. The `[data-bl-si-pii]:not([data-bl-si-reveal])` CSS rule in `content.css` drives their blur. Enabling PII detection means those spans stay blurred whether or not blur-all is on.

---

## Critical: Code Patterns

### All source files must be IIFEs
```js
const BlurrySiteXxx = (() => {
  // ...
  return { publicMethod };
})();
blsi.Xxx = BlurrySiteXxx;
```

### No ES module syntax
No `import`, `export`, `import()`, or `require()` in any file under `src/`, `background.js`, or `popup/`. The extension has no build step.

### Blur engine element handling
All elements (video, img, text containers, generic) are blurred via CSS class only (`bl-si-blurred`). CSS `filter: blur()` on a parent blurs all descendants — no canvas overlays, no text-node wrapping, no DOM injection. This means:
- No `position: relative` injection on parent elements (was breaking layouts)
- No `requestAnimationFrame` loops for video (CSS blur works on DRM video too)
- No text-node wrapper spans (CSS blur covers text nodes via parent filter)
- Live radius updates propagate instantly via `var(--bl-si-radius)` from `:root`

### CSS class constants (do not invent new names)
| Constant | Value |
|---|---|
| Blur class | `bl-si-blurred` |
| Frosted glass mode | `bl-si-frosted` |
| Canvas overlay | `bl-si-canvas-overlay` |
| Text wrapper | `bl-si-text-node-wrapper` |
| Hover highlight | `bl-si-hover-highlight` |
| Picker active (on `<html>`) | `bl-si-picker-active` |
| Toolbar | `bl-si-toolbar` (id: `bl-si-picker-toolbar`) |
| Reveal attribute (all modes, click+hover) | `data-bl-si-reveal` (attribute, not class) |
| Sticky zone overlay | `bl-si-zone-overlay` |
| Zone drawing preview | `bl-si-zone-drawing` |
| Zone hover highlight (picker mode) | `bl-si-zone-highlight` |
| Zone name label | `bl-si-zone-label` |

---

## Testing

### Running tests
```bash
npm run test:unit          # 535 unit tests, fast
npm test                   # + coverage (~91% line coverage on src/)
```

### Constraints (from hard-learned failures)

| Rule | Why |
|---|---|
| Use `require(MODULE_PATH)` to load source files in tests | `require()` lets Jest instrument for coverage. Fallback to `(0, eval)(buildStubSource())` when file missing. |
| `global.window = global` must be in `tests/setup.js` | IIFEs assign `window.BlurrySite*`; without this alias, the globals are lost |
| `requestAnimationFrame` mock must NOT call the callback | Video blur uses `requestAnimationFrame` in an infinite loop; auto-executing causes OOM |
| `HTMLCanvasElement.prototype.getContext` must be mocked | jsdom returns `null` from `getContext()`; `ctx.clearRect()` then throws |
| `KeyboardEvent.prototype.getModifierState` must be mocked | jsdom may not implement it; shortcut handler uses it for AltGr detection |
| All 6 test files use the same load pattern | `fs.existsSync(MODULE_PATH) ? require(MODULE_PATH) : eval(buildStubSource())` |

### Adding a new unit test file

Follow the pattern in any existing `tests/unit/*.test.js`:
1. `loadXxx()` guards with `if (global.BlurrySiteXxx) return;`
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
| SPA selector staleness | `data-bl-si-id` stamped at blur time; re-rendered elements get new DOM nodes | Documented in `docs/CROSS_BROWSER.md §6.3` |
| Context menu blur has no element targeting | `contextMenus.onClicked` does not capture `targetElementId` in current impl | Known gap — `docs/CROSS_BROWSER.md §6.6` |
| `position: fixed` inside blurred containers shifts | CSS `filter` creates stacking context — browser spec behaviour | User education in README |
| `position: sticky` inside blurred containers stops sticking | CSS `filter` creates stacking context — spec behaviour | Same root cause as `position: fixed` issue |
| `<select>` dropdown options visible when opened | CSS filter only blurs closed state | Known limitation |
| Reveal may strip element background color | `data-bl-si-reveal` sets `background-color: transparent` to cancel redacted mode; in gaussian/frosted, this removes legitimate backgrounds during temporary reveal | Acceptable — reveal is temporary (hover/click) |
| Hover reveal and click reveal work inside shadow roots; picker does not | `reveal_controller` uses `event.composedPath()[0]` to pierce shadow DOM retargeting — reveal now reaches elements inside shadow roots. `picker` still uses `event.target` and cannot reach inside shadow roots. | Hover/click reveal: fixed. Picker: Phase 2 |
| `isBlurred()` returns false for alwaysBlur elements inside shadow roots | `isBlurAllActive()` checks `document.head` only; elements blurred by CSS injected into a shadow root are not detected. Picker can't reach them anyway until Phase 2. | Phase 2 |
| Zone overlays misalign on pages with CSS `transform` on ancestor elements | `position:absolute` coordinate space anchors to the nearest transformed ancestor, not the document root — CSS spec behaviour | Known limitation — `position:fixed` screen-anchor zones are unaffected; page-anchor zones may appear offset on transform-heavy pages (rare) |
| Picker cannot reach into iframes | Picker uses `event.target` and is guarded to main frame only (`IS_MAIN_FRAME`) — zone drawing cannot cross frame boundaries | Phase 2 |
| Keyboard shortcuts don't fire when focus is inside a cross-origin iframe | Browser delivers keydown to the focused frame; shortcut handler is main-frame only | Phase 2 |
| Cross-origin iframes with strict `Referrer-Policy` may not blur on initial load | `document.referrer` is empty → `_topHostname` starts empty → blur-all state unknown until postMessage from main frame arrives | Acceptable — resolves within milliseconds once main frame init completes |
| SPA navigation inside iframes not tracked | `history.pushState` wrapping and popstate/hashchange listeners are main-frame only — URL rule overrides don't update if the iframe itself does SPA navigation | Phase 2 |
