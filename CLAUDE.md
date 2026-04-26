```markdown
# Blurry Site — Claude Instructions

## What This Project Is

Chrome/Firefox MV3 extension. Vanilla JS only — no bundler, no ES modules, no TypeScript.
All source files IIFEs assigning single `window.BlurrySite*` global.

Per-module contracts: `docs/contracts/<module>.md` (one per module — read during implementation).
Full design ref: `docs/module-contracts.md` and `docs/architecture.md` (planning only — see rule 4).

---

## Before Any Change

1. Run tests first, confirm green baseline: `npm run test:unit`
2. **Read contract first** — hook fires automatically on every Edit/Write to src/. Full rules: `.claude/rules/code-contracts.md`.
3. Adding new `chrome.runtime.sendMessage` type — checklist in `.claude/rules/message-protocol.md`.

---

## Critical: Module Globals

Every source file exposes exactly one window global. Wrong name → silent `undefined` crash in page context.

| File | Namespace | Exposed API |
|---|---|---|
| `src/constants.js` | `globalThis.blsi` | Message types (`blsi.STORAGE.*`, `blsi.COMMAND.*`, `blsi.POPUP.*`), `DEFAULT_MODEL` (no shortcuts — built lazily), `reveal_dfs_max_depth`, `modifier_codes`, `is_valid()`, `category_of()`, `build_default_model()`, `validate_model()`, `isValidShortcutEntry()`, `deep_merge()`. Enums: `reveal_modes`, `blur_modes`, `picker_modes`, `pick_blur_modes`, `pii_modes`, `idle_units`, `pattern_types`, `SUPPORTED_LANGUAGES`, `css`, `ids` |
| `src/logger.js` | `blsi.Logger` | `log`, `warn`, `error`, `flow(tag, data?)`, `scope(name)`, `enable`, `disable`, `get enabled`. Persists toggle to `chrome.storage.local.blsi_debug`. Listens on `chrome.storage.onChanged` for cross-context state sync. `error` always logs; all else gated. `scope(name)` returns tagged variant `{log, warn, error, flow, get enabled}`. |
| `src/action_registry.js` | `blsi.Actions` | Single source of truth for shortcut-driven actions. `list()`, `get(id)`, `ids()`, `defaultBindings()`, `ACTIONS`. Each action: `{ id, label, description, defaultBinding, messageType, chromeCommand }`. Adding action = one entry here. |
| `src/shortcut_label.js` | `blsi.ShortcutLabel` | Platform-aware label rendering + reserved chord list. `codeLabel(code)`, `modLabel(mod)`, `chordLabel({code, mods})`, `bindingLabel([...])`, `chordKey(chord)`, `bindingKey(binding)`, `IS_MAC`, `CODE_TO_LABEL`. Mac renders `⌘⇧⌥⌃`, Windows/Linux renders spelled-out mods. Also: `isReserved(chord)`, `lookup(chord)`, `RESERVED` — warning-only hint list (~14 entries); capture UI allows save regardless. |
| `src/url_matcher.js` | `blsi.UrlMatcher` | `matchesPattern`, `resolveSettings`, `MAX_PATTERN_LENGTH` |
| `src/selector_utils.js` | `blsi.SelectorUtils` | `getSelectors(el) → string[]` (ordered structural→semantic; use for saving), `getSelector(el) → string\|null` (compat alias → `getSelectors()[0]`), `isSelectorStable(el) → bool` (fast O(1) check; true if id/class/aria/data-* found), `generateId`, `restoreSelector(string\|string[]) → Element\|null` (tries each in order, returns first unique match), `restoreAllSelectors` |
| `src/storage_model.js` | `blsi.Model` | `init_cache`, `on_change`, `get`, `patch_section`, `debounced_patch`, `save_settings`, `get_all_site_rules`, `get_site_entry`, `set_site_entry`, `remove_site_entry`, `capture_snapshot`, `save_site_snapshot(hostname_value, hostname_type, snapshot)`, `clear_site_snapshot(hostname_value, hostname_type)`, `get_site_snapshot(hostname_value, hostname_type)`, `resolve`, `get_blur_items`, `get_cached_blur_state`, `save_blur_state`, `save_blur_item`, `remove_blur_item`, `save_automate_blur`, `patch_automate_blur`, `clear_automate_blur`, `get_automate_blur`, `clear_host`, `clear_all`, `get_rules`, `save_rules`, `_reset_cache` — accesses `chrome.storage.local` (model) and `chrome.storage.session` (automate_blur) directly (no background relay) |
| `src/tab_privacy.js` | `blsi.TabPrivacy` | `enable()`, `disable()`, `isActive` (getter) — replaces tab title with `…` when active |
| `src/pii_detector.js` | `blsi.PiiDetector` | `scan(rootEl, types)`, `clear(rootEl)`, `observeMutations(rootEl)`, `stopObserving()`, `getMatchCount()`, `getPatterns()` — TreeWalker text-node approach; wraps matches in `[data-bl-si-pii]` spans (no `[data-bl-si-blur]`); independent of blur-all |
| `src/fonts.js` | `blsi.Fonts` | `DISC_FONT_FACE`, `ASTERISK_FONT_FACE` — base64-encoded `@font-face` strings for `"bl-si-censored-disc"` and `"bl-si-starred-asterisk"` (OFL-1.1). Used by `blur_engine` for censored/starred modes. |
| `src/blur_engine.js` | `blsi.BlurEngine` | Low-level: `applyBlur`, `removeBlur`, `unblurAll`, `isBlurred`, `isVisuallyBlurred`, `injectRules`, `removeRules`, `isBlurAllActive`, `stampElements` (returns `ShadowRoot[]`), `tryBlurTextCheck`, `matchesActiveCategories`, `shouldBlurElement`, `ensureSvgFilter`, `injectPiiRules(mode)`, `removePiiRules()`, `getZoneOverlays`, `teardown`, `CATEGORY_SELECTORS`. High-level: `handleSite`, `handleShadowRoot`, `handleIframe`, `observeRoot`, `resetCounters`, `allocateElementName`, `allocateStickyName(anchor)`, `isPageBlurred` (getter), `blurredCount` (getter — O(1) running count of `data-bl-si-blur` stamped elements), `_setPickerActiveForObserver` |
| `src/auto_blur.js` | `blsi.AutoBlur` | `init(callbacks)`, `destroy()`, `isIdle()` — idle + tab-switch auto-blur; callbacks: `{ onIdle, onActive, onTabSwitch }` |
| `src/main_world_bridge.js` | _(none — MAIN world)_ | No global; runs at `document_start` in page's MAIN world. Patches `navigator.mediaDevices.getDisplayMedia` (fires `'__blsi_screen_share'` on share start/stop) and `Element.prototype.attachShadow` (fires `'__blsi_shadow_attached'` on element for late shadow root discovery). No `chrome.*` access. |
| `src/screen_share.js` | `blsi.ScreenShare` | `init()`, `destroy()` — isolated-world bridge; listens for `'__blsi_screen_share'` CustomEvents from MAIN world. On share start opens port `'blsi-screen-share'` + sends `SCREEN_SHARE_STARTED`; on share end disconnects port + sends `SCREEN_SHARE_ENDED`. Port disconnect (crash/close/nav) fans out `SCREEN_SHARE_UNBLUR` in background as crash-safety net. |
| `src/reveal_controller.js` | `blsi.Reveal` | `init({ getMode, isPickerActive })`, `destroy`, `clearAll` |
| `src/shortcut_handler.js` | `blsi.Shortcuts` | `init(shortcuts, callbacks)` — accepts `{ 'action-id': { binding: [{code, mods}] } }` shape (kebab-case action ids). `destroy`, `showToast`, `_setPickerActive`, `_getFireToken` (for content_script dedup). Reads mods from event booleans (side-agnostic). Reads label from `blsi.Actions.get(id).label` for toast. |
| `src/selection_blur.js` | `blsi.SelectionBlur` | `init()`, `destroy()`, `blurSelection()`, `clearAll()`, `getSelectionBlurs()`, `removeSelectionBlur(id)` — text-selection driven blur via `[data-bl-si-blur]` spans. `blurSelection()` takes no args; reads `document.getSelection()` internally. |
| `src/screenshot.js` | `blsi.Screenshot` | `captureViewport()`, `download(dataUrl, filename)`, `copyToClipboard(dataUrl)`, `startCrop()`, `cancelCrop()` — viewport capture with blur preserved |
| `src/picker.js` | `blsi.Picker` | `activate`, `deactivate`, `setSettings`, `setMode`, `isActive` (getter) |
| `content_script.js` | _(none — orchestrator)_ | Binds all modules via `blsi.*` aliases after DOM ready |

**Load order fixed by `manifest.json`** — `main_world_bridge.js` runs first in MAIN world at `document_start`. Isolated world at `document_idle`: constants → content_i18n → logger → action_registry → shortcut_label → url_matcher → selector_utils → storage_model → tab_privacy → pii_detector → fonts → blur_engine → auto_blur → screen_share → reveal_controller → shortcut_handler → selection_blur → screenshot → picker → content_script. Never reorder.

---

## Critical: Message Protocol

**Sender/handler type mismatch silently drops message — no error.** Full tables and add-new-type checklist: `.claude/rules/message-protocol.md` (auto-loaded when touching src/, background.js, or popup/).

---

## Critical: Settings Shape

Settings use **snake_case** keys everywhere. No two-shape duality — same shape in storage, background, content script, popup. Stored under single `blsi_model` storage key, accessed via `blsi.Model`.

**Popup namespace rule:** All popup code (render files, `popup.js`, `popup_state.js`) uses exact `blsi.DEFAULT_MODEL` nested shape — never flat alias. Old flat keys (`blur_mode`, `pick_blur_enabled`, `pick_blur_type`, `pii_email`, `pii_numeric`, `blur_radius`, `reveal_mode`, `redaction_color`, `thorough_blur`, `transition_duration`, `blur_categories`, `pick_blur_color`, `automate_idle`, `automate_tab_switch`, `automate_screen_share`, `enabled`) removed. Use nested model path everywhere (`settings.blur_all.settings.blur_mode`, `settings.global_default_settings.enabled`, etc.). `saveSettings(patch)` in `popup_state.js` takes model-shaped patch, routes each top-level key via `patch_section`.

**Top-level model shape:**
```js
{
  global_default_settings,  // global settings (snake_case keys)
  blur_all:          { status, settings },
  pick_and_blur:     { status, settings, items },  // items: hostname-keyed map of blur items
  auto_detect_pii:   { status, settings },
  automate:          { status, settings },
  shortcuts,         // per-action shortcut definitions
  site_rules,        // array of URL-rule entries (blur_all + snapshot per hostname; NO items)
}
// automate_blur lives separately in chrome.storage.session['blsi_automate_blur'] — NOT in blsi_model
```

**`pick_and_blur.items`** — hostname-keyed map storing all pick & blur items:
```js
pick_and_blur.items = {
  'gmail.com': [{ type: 'dynamic', selector: '#foo', name: 'Foo' }, ...],
  'github.com': [{ type: 'sticky', id: 'z1', x, y, width, height, anchor }, ...],
}
```
Default: `{}`. Each hostname's array is capped at 10 items. Empty arrays are stripped by `validate_model`. `get_blur_items(hostname)`, `save_blur_item(hostname, item)`, `remove_blur_item(hostname, item_id)` are the CRUD APIs.

**`shortcuts`** — per-action shortcut definitions (v2 shape):
```js
shortcuts = {
  'toggle-blur-all': { binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] },
  'toggle-picker':   { binding: [{ code: 'KeyP', mods: ['Alt', 'Shift'] }] },
  'clear-all':       { binding: [{ code: 'KeyU', mods: ['Alt', 'Shift'] }] },
  'screenshot':      { binding: [{ code: 'KeyS', mods: ['Alt', 'Shift'] }] },
}
```

- Keys are action ids from `blsi.Actions` — **kebab-case** (e.g. `'toggle-blur-all'`), matching `id` field in `action_registry.js`. Not message-type strings, not snake_case.
- `binding` is array of chords. Phase 1 always `length === 1`; phase 2 adds multi-chord sequences like `[{code: 'KeyG'}, {code: 'KeyI'}]` for Gmail-style `g i`.
- `code` is `KeyboardEvent.code` (physical key, layout-independent).
- `mods` is sorted subset of `{"Alt","Control","Meta","Shift"}`. Left/right folded — `AltLeft` and `AltRight` both map to `"Alt"`.
- Default shortcuts NOT in `constants.js` — come from `blsi.Actions.defaultBindings()`, merged by `blsi.build_default_model()`.

`content_script.js` passes `shortcuts` directly to `Shortcuts.init()` — no flattening needed.

**`reveal_mode`** — controls how blurred elements can be temporarily revealed: `'hover'` | `'click'` | `'none'`.

**`thorough_blur`** — boolean; when true, applies deeper blur processing.

**`picker_mode`** — controls picker strategy:
- `'sticky-page'` (default) — box anchored to document. Scrolls with page. Stored with `anchor: 'page'`.
- `'sticky-screen'` — box anchored to viewport. Fixed on screen during scroll. Stored with `anchor: 'screen'`. Best for screen-sharing/streaming.
- `'dynamic'` — tap element to blur it (selector-based, follows element).

Legacy `'sticky'` migrated to `'sticky-page'` in `blsi.validate_model()`. Sticky zones without `anchor` field default to `'page'` at restore time.

**All defaults live in `src/constants.js` → `blsi.DEFAULT_MODEL`.** No hardcoded defaults elsewhere.

### Settings Shape: blur_categories

**In `chrome.storage.local` (via `blsi.Model`) / background / content_script.js / popup.js:**
```js
settings.blur_categories = {
  text:      true,   // headings, paragraphs, spans, etc.
  media:     true,   // img, video, audio, canvas, svg, picture, figure
  form:      false,  // input, textarea, select, button, label, fieldset
  table:     true,   // table, thead, tbody, tr, td, th
  structure: true,   // div, section, article, nav, aside, header, footer, main, li
}
```

Defaults in `src/constants.js` → `blsi.DEFAULT_MODEL`. Per-category element lists in `src/blur_engine.js` → `CATEGORY_SELECTORS`.

### Settings Shape: auto_detect

Controls automatic PII detection. Same shape everywhere — no flattening.

**In `chrome.storage.local` (via `blsi.Model`) / background / content_script.js / popup.js:**
```js
auto_detect_pii.settings = {
  email:   false,   // boolean — email addresses (local@domain.tld)
  numeric: false,   // boolean — financial numbers, phone-like groups, currency amounts
}
```

- `email` boolean. Default `false`.
- `numeric` boolean. Default `false`.

Defaults in `src/constants.js` → `blsi.DEFAULT_MODEL`.

Master toggle's `expandKeys` sets both `email` and `numeric` to `true`/`false` atomically.

PII blur **independent of blur-all**. PII spans carry `[data-bl-si-pii]` only — no `[data-bl-si-blur]`. `[data-bl-si-pii]:not([data-bl-si-reveal])` CSS rule in `content.css` drives blur. Enabling PII = spans stay blurred regardless of blur-all state.

### Settings Shape: pick_and_blur and automate keys

**`pick_blur_enabled`** — Pick & Blur mode independently enabled: `true` (default) | `false`. Blur All and Pick & Blur can be on simultaneously; no "active mode" concept. Persisted to storage.

**`pick_blur_type`** — blur type for Pick & Blur: `'blur'` (default) | `'frosted'` | `'color'`. No `'redacted'` or `'censored'` — unavailable for Pick & Blur. Use `blsi.pick_blur_modes` enum.

**`pick_blur_color`** — color for Pick & Blur `'color'` type:
```js
pick_and_blur.settings.pick_blur_color = { hex: '#000000', opacity: 1.0 }
// hex: 6-char hex string (validated: must match /^#[0-9a-fA-F]{6}$/)
// opacity: number 0–1 inclusive
```

**`pii_mode`** — blur type for auto-detect PII rendering: `'blur'` (default) | `'frosted'` | `'redacted'` | `'starred'`. Use `blsi.pii_modes` enum.

**`automate`** — automation trigger settings (feature-grouped under `automate.settings`):
```js
automate.settings = {
  screen_share: { enabled: false },                   // boolean only — see screen share detection
  idle:         { value: 5, unit: 'min', enabled: false }, // value 1–99; unit from idle_units (no 'hr')
  tab_switch:   { enabled: false },
}
```
- `screen_share.enabled` — when true, `blsi.ScreenShare.init()` wraps `navigator.mediaDevices.getDisplayMedia` in page's MAIN world. On share start, `screen_share.js` opens port (`blsi-screen-share`) + sends `SCREEN_SHARE_STARTED`; background fans out `SCREEN_SHARE_BLUR` to all other tabs. Those tabs write `automate_blur[hostname].screen_share = true` to `chrome.storage.session`. New tabs mid-share read session entry on init. On share end (or tab crash/close), port disconnect fans out `SCREEN_SHARE_UNBLUR`; all tabs clear session entry. Sharing tab NOT blurred. **Smart skip**: if blur-all or pick-and-blur already enabled, automate defers (sets `automate_blur_skipped = true`), shows "Blur already active — automate skipped" toast.
- `idle.unit` accepts `blsi.idle_units` (`'sec'` | `'min'`) only — `'hr'` rejected (Chrome idle API cap ~3000 s). `value` min 1. UI warns when value exceeds 3000 s.
- `tab_switch.enabled` boolean only.

### Settings Shape: automate_blur (transient trigger state)

**`automate_blur`** — hostname-keyed object tracking active automate trigger per site. Stored in **`chrome.storage.session`** (key: `blsi_automate_blur`) — NOT in `blsi_model`. Session storage clears on browser close/crash, preventing stale triggers.

```js
// chrome.storage.session['blsi_automate_blur']:
{
  'gmail.com': { idle: true, tab_switch: false, screen_share: false },
  'github.com': { idle: false, tab_switch: false, screen_share: true },
}
```

Default: `{}`. Each hostname entry defaults all sub-keys to `false`. Never written by user actions — only by automate trigger handlers in `content_script.js`.

**`blur_all_active` OR logic** — `resolve()` computes:
```
manual_blur   = exact.blur_all !== null ? !!exact.blur_all : global_status
automate_any  = idle || tab_switch || screen_share (from _automate_cache[hostname])
blur_all_active = manual_blur || automate_any
```

Automate triggers NEVER write `blur_all`. `onActive()` only clears automate_blur sub-keys — manual blur survives idle return.

`resolve()` exposes four derived keys:
- `resolved.automate_blur_active` — boolean, true if any trigger active
- `resolved.automate_blur_triggers` — `{ idle, tab_switch, screen_share }` booleans
- `resolved.automate_blur_only` — boolean, true when automate is **sole** blur reason (no manual/pick blur); `blur_mode`, `blur_categories`, `blur_radius`, `thorough_blur`, `reveal_mode`, `transition_duration`, `redaction_color`, `highlight_color` all overridden with DEFAULT_MODEL values
- `resolved.automate_blur_skipped` — boolean, true when automate fired but deferred because blur-all or pick-and-blur already enabled

`blsi.Model` methods for automate_blur:
- `get_automate_blur(hostname)` — returns `{ idle, tab_switch, screen_share }` from in-memory session cache
- `save_automate_blur(hostname, trigger, bool)` — write one trigger to session storage
- `patch_automate_blur(hostname, patch)` — batch-write multiple triggers in one session storage write
- `clear_automate_blur(hostname)` — remove all automate_blur state for hostname from session storage
- `clear_host(hostname)` / `clear_all()` — also clear automate_blur atomically

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
No `import`, `export`, `import()`, or `require()` in any file under `src/`, `background.js`, or `popup/`. No build step.

### Blur engine element handling
All elements (video, img, text containers, generic) blurred via CSS class only (`bl-si-blurred`). CSS `filter: blur()` on parent blurs all descendants — no canvas overlays, no text-node wrapping, no DOM injection. This means:
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

## Spawning Sub-agents

Sub-agents get CLAUDE.md loaded but task prompt overrides attention to rules. For any Agent call touching src/ or popup/:

1. Name the specific contract in the prompt: `"read docs/contracts/<module>.md before proposing changes"`
2. For Explore agents: end with `"Report only — no edits"`
3. For Plan agents: add `"plan must respect: no ES modules, IIFEs only, load order fixed in manifest.json"`

---

## Testing

### Running tests
```bash
npm run test:unit          # 743 unit tests, fast
npm test                   # + coverage (~91% line coverage on src/)
```

**Do NOT read test files unless modifying tests.** For behavior: read `docs/contracts/<module>.md` — tests confirm correctness, contracts document intent. Loading tests pre-emptively costs ~5K tokens, no benefit for implementation tasks.

**When modifying tests:** read `docs/contracts/<module>.tests.md` first — it documents every describe/test group, edge cases covered, and known gaps. After adding/removing/changing tests, update the test contract in the same commit.

### Constraints (from hard-learned failures)

| Rule | Why |
|---|---|
| Use `require(MODULE_PATH)` to load source files in tests | `require()` lets Jest instrument for coverage. Fallback to `(0, eval)(buildStubSource())` when file missing. |
| `global.window = global` must be in `tests/setup.js` | IIFEs assign `window.BlurrySite*`; without this alias, globals are lost |
| `requestAnimationFrame` mock must NOT call the callback | Video blur uses `requestAnimationFrame` in infinite loop; auto-executing causes OOM |
| `HTMLCanvasElement.prototype.getContext` must be mocked | jsdom returns `null` from `getContext()`; `ctx.clearRect()` then throws |
| `KeyboardEvent.prototype.getModifierState` must be mocked | jsdom may not implement it; shortcut handler uses it for AltGr detection |
| All 6 test files use same load pattern | `fs.existsSync(MODULE_PATH) ? require(MODULE_PATH) : eval(buildStubSource())` |

### Adding a new unit test file

Follow pattern in any existing `tests/unit/*.test.js`:
1. `loadXxx()` guards with `if (global.BlurrySiteXxx) return;`
2. Use `require(MODULE_PATH)` to load source (enables coverage)
3. Provide `buildStubSource()` matching public contract exactly
4. `afterEach` or `beforeEach` must clean DOM and call `destroy()` if applicable
5. **Add every new test to `docs/test-validation.md`** with manual replication steps

---

## Firefox Compatibility Rules

- Use only `chrome.*` namespace (Firefox 109+ exposes as compatibility shim).
- Do NOT use `browser.*` — Chrome lacks it.
- Service worker (`background.js`) must be stateless between wake cycles — never store mutable state in module-level variables in background.js.
- Always guard against `moz-extension://` URLs in background.js tab listeners (already done).
- Test shortcut behaviour: `Ctrl+K` may conflict with Firefox address bar on some platforms; document in release notes.

---

## Documentation Maintenance

Docs are load-bearing references used by humans and Claude. Code changes → relevant docs MUST update in same change.

### When to update which doc

| What changed | Update |
|---|---|
| Added/removed/renamed public API method on any module | `CLAUDE.md` Module Globals table, `src/CLAUDE.md` module-specific rules, `docs/contracts/<module>.md` contract |
| Added/removed `chrome.runtime.sendMessage` type | `src/constants.js` (source of truth), `CLAUDE.md` Message Protocol tables, `docs/architecture.md §6` protocol table |
| Changed default value (blur radius, chord keys, etc.) | `src/constants.js` DEFAULTS — all other files reference it |
| Changed settings shape (new keys, renamed keys) | `CLAUDE.md` Settings Shape section, `docs/contracts/storage_model.md` |
| Added/removed/renamed `blsi.Model` method or storage key | `CLAUDE.md` Module Globals table (`src/storage_model.js` row), `src/CLAUDE.md` storage_model.js rules, `docs/contracts/storage_model.md` contract |
| Added new source file under `src/` | `CLAUDE.md` Module Globals table, `src/CLAUDE.md` load order, `manifest.json` content_scripts |
| Added/modified/removed unit test | `docs/test-validation.md` — add entry with test name, assertion, manual replication steps |
| Added new test file | `docs/test-validation.md` new section, `tests/CLAUDE.md` if test patterns differ |
| Changed test loading pattern or setup | `CLAUDE.md` Testing section, `tests/CLAUDE.md` |
| Changed keyboard shortcut handling | `CLAUDE.md` Settings Shape section, `src/CLAUDE.md` shortcut_handler rules |
| Changed CSS class names or IDs | `CLAUDE.md` CSS class constants table |
| Changed Firefox compatibility behavior | `CLAUDE.md` Firefox Compatibility Rules |
| Found new known limitation | `CLAUDE.md` Known Limitations table |

### Rules

1. **Same-commit rule** — doc updates go in same commit as code change. Never leave docs for follow-up.
2. **Update, don't append** — behavior changes: find and update existing entry. Don't add contradicting entry.
3. **Test count** — keep test count in Testing section current. Run `npm run test:unit`, update number.
4. **TEST_VALIDATION.md** — every test needs: test name, what it asserts, step-by-step manual replication. Adding test → add entry. Modifying → update entry. Removing → remove entry.
5. **Don't document internals** — only document things affecting how other code interacts with module (public API, message types, settings shapes, CSS classes). Private details in code comments, not docs.

---

## Known Limitations (do not "fix" without understanding the tradeoff)

| Issue | Root cause | Status |
|---|---|---|
| ~~DRM video shows dark overlay~~ | Fixed — CSS `filter: blur()` works on DRM video (DRM blocks pixel extraction, not CSS rendering) | Resolved |
| SPA selector staleness | Dynamic blur items store `selectors: string[]` ordered structural→semantic. Structural (nth-of-type) paths fail when SPA re-renders DOM; fallback selectors (class, aria, data-*, id) survive. Elements with no stable signals show "may not persist" warning in picker on hover. | Partially mitigated — picker shows warning; full SPA resilience requires semantic signals on element |
| Context menu blur has no element targeting | `contextMenus.onClicked` does not capture `targetElementId` in current impl | Known gap — `docs/browser-compatibility.md §6.6` |
| `position: fixed` inside blurred containers shifts | CSS `filter` creates stacking context — browser spec behaviour | User education in README |
| `position: sticky` inside blurred containers stops sticking | CSS `filter` creates stacking context — spec behaviour | Same root cause as `position: fixed` issue |
| `<select>` dropdown options visible when opened | CSS filter only blurs closed state | Known limitation |
| Reveal may strip element background color | `data-bl-si-reveal` sets `background-color: transparent` to cancel redacted mode; in blur/frosted, removes legitimate backgrounds during temporary reveal | Acceptable — reveal is temporary (hover/click) |
| Hover reveal and click reveal work inside shadow roots; picker does not | `reveal_controller` uses `event.composedPath()[0]` to pierce shadow DOM retargeting — reveal reaches elements inside shadow roots. `picker` still uses `event.target`, cannot reach inside shadow roots. | Hover/click reveal: fixed. Picker: Phase 2 |
| `isBlurred()` returns false for alwaysBlur elements inside shadow roots | `isBlurAllActive()` checks `document.head` only; elements blurred by CSS injected into shadow root undetected. Picker can't reach them until Phase 2. | Phase 2 |
| Zone overlays misalign on pages with CSS `transform` on ancestor elements | `position:absolute` coordinate space anchors to nearest transformed ancestor, not document root — CSS spec behaviour | Known limitation — `position:fixed` screen-anchor zones unaffected; page-anchor zones may appear offset on transform-heavy pages (rare) |
| Picker cannot reach into iframes | Picker uses `event.target`, guarded to main frame only (`IS_MAIN_FRAME`) — zone drawing cannot cross frame boundaries | Phase 2 |
| Keyboard shortcuts don't fire when focus inside cross-origin iframe | Browser delivers keydown to focused frame; shortcut handler is main-frame only | Phase 2 |
| Cross-origin iframes with strict `Referrer-Policy` may not blur on initial load | `document.referrer` empty → `_topHostname` starts empty → blur-all state unknown until postMessage from main frame arrives | Acceptable — resolves within milliseconds once main frame init completes |
| SPA navigation inside iframes not tracked | `history.pushState` wrapping and popstate/hashchange listeners are main-frame only — URL rule overrides don't update if iframe does SPA navigation | Phase 2 |
```