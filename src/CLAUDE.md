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
MAIN world (world:"MAIN", run_at:"document_start" — separate content_scripts entry):
  screen_share_main.js  → no global; wraps navigator.mediaDevices.getDisplayMedia;
                          dispatches '__blsi_screen_share' CustomEvent on start/stop

Isolated world (run_at:"document_idle"):
 0. constants.js          → globalThis.blsi (message types + DEFAULTS)
 1. content_i18n.js       → blsi.ContentI18n (popup/content i18n loader: init, t, currentLang)
 2. logger.js             → blsi.Logger (flow logger; toggle persisted at chrome.storage.local.blsi_debug; cross-context sync via storage.onChanged)
 3. action_registry.js    → blsi.Actions (single source of truth for shortcut-driven actions)
 4. shortcut_label.js     → blsi.ShortcutLabel (platform-aware label rendering + canonical chord keys + reserved chord list)
 5. url_matcher.js        → blsi.UrlMatcher
 6. selector_utils.js     → blsi.SelectorUtils
 7. storage_model.js      → blsi.Model (direct chrome.storage access; single blsi_model key; resolve/patch/debounced_patch)
 8. tab_privacy.js        → blsi.TabPrivacy (title masking; enable/disable/isActive)
 9. pii_detector.js       → blsi.PiiDetector (text-node PII scan; scan/clear/observeMutations/stopObserving)
10. fonts.js              → blsi.Fonts (embedded WOFF2 font assets; FONT_FACE string for "bl-si-redact-asterisk")
11. blur_engine.js        → blsi.BlurEngine (owns blur-all + item dispatch state)
12. auto_blur.js          → blsi.AutoBlur (idle + tab-switch triggers; init/destroy/isIdle)
13. screen_share.js       → blsi.ScreenShare (CustomEvent bridge; init/destroy — listens for '__blsi_screen_share' from MAIN world, opens port 'blsi-screen-share' + sends SCREEN_SHARE_STARTED/ENDED; port disconnect = crash-safety UNBLUR fan-out)
15. reveal_controller.js  → blsi.Reveal
16. shortcut_handler.js   → blsi.Shortcuts
17. selection_blur.js     → blsi.SelectionBlur (text selection blur; init/destroy/blurSelection/clearAll)
18. screenshot.js         → blsi.Screenshot (viewport capture; captureViewport/download/copyToClipboard)
19. picker.js             → blsi.Picker
20. content_script.js     → (no global, binds all above)
```

A module may only depend on modules loaded before it.
`content_script.js` binds all globals to local aliases inside `init()` (after DOM ready), not at top-level.

---

## Module-Specific Rules

### pii_detector.js
- `EMAIL` is boolean. `NUMERIC` is boolean. Gate with `Boolean(NUMERIC)` — no string enum.
- `NUMERIC_PROFILE` (`'precise' | 'aggressive'`) is a developer-only constant inside the IIFE. Users only see on/off.
- **falsePositivesCheck pattern**: each check is `(matchText, text, matchIndex) => boolean`. Return `true` to suppress. Adding a check: (1) write the function, (2) add to `FALSE_POSITIVE_CHECKS.precise` (and optionally `.aggressive`), (3) add tests, (4) update `docs/TEST_VALIDATION.md` and the design spec.
- `_falsePositivesCheck` runs the active profile's checks. Never put suppression logic directly in `_findMatches`.
- Active profile checks: `precise` = [isYear, isVersion, isPublicPrice, isCountNoise]; `aggressive` = [isVersion].
- `isYear` suppresses 4-digit numbers in 1000–2099 (dates, copyright years).
- `isVersion` suppresses numbers preceded by `v`/`V` or followed by `.digit` (semver build numbers).
- `isPublicPrice` suppresses matches near `/month`, `/year`, `cart`, `qty`, `quantity`, `units`, `rating`, `reviews`, `stars` (100-char window).
- `isCountNoise` suppresses matches near `unread`, `notifications`, `messages`, `followers`, `following`, `likes`, `views`, `comments`, `results`, `items`, `members`, `subscribers`, `posts`, `connections` (150-char window).
- PII spans carry `[data-bl-si-pii="email"|"numeric"]` only — no `[data-bl-si-blur]`. Independent of blur-all.
- `scan(rootEl, types)` — `TreeWalker(NodeFilter.SHOW_TEXT)` collects all text nodes first, then processes each. Skips extension UI and already-wrapped nodes.
- `_wrapTextNode(textNode, matches)` — processes matches right-to-left so earlier offsets stay valid after each `splitText`. Each match: `splitText(end)` then `splitText(start)` then `replaceChild(span, matchNode)`. Spans carry `[data-bl-si-pii]` only — no `[data-bl-si-blur]`.
- `clear(rootEl)` — removes all `[data-bl-si-pii]` spans, restores text, resets `_matchCount`.
- `observeMutations(rootEl)` — requires `scan()` first so `_activeTypes` is set.
- `blur_engine.isVisuallyBlurred` returns `true` for `element.dataset.blSiPii` — reveal_controller can find and reveal PII spans.

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
- **Anchor**: `zoneData.anchor` is `'page'` (default) or `'screen'`.
  - `'page'` → `position: absolute`; coordinates are document-space; the zone scrolls with the page content. `_applyStickyItem` re-projects via `xPct`/`yPct` against the current `scrollWidth`/`scrollHeight` to survive layout changes. Also honors `path` scoping.
  - `'screen'` → `position: fixed`; coordinates are viewport-space; the zone stays on screen during scroll. Raw `x`/`y` are used as-is. No `path` scoping — a screen-anchored zone applies on every page under its host.
- Overlay stamps `data-bl-si-zone-anchor="page"|"screen"` for debugging/CSS.
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
- `_structuralTags` is derived from `STRUCTURE.textCheck` and prevents thorough-mode bypass for structural containers (`<div>`, `<section>`, etc.) to avoid nested-blur leaks on hover reveal. `<li>`/`<dt>`/`<dd>` were moved to `STRUCTURE.alwaysBlur` (not textCheck) so CSS injection covers `::marker` pseudo-elements unconditionally — they are no longer in `_structuralTags`.

#### Single orchestration entry point: `handleSite(settings)`
- `async handleSite(settings)` — one arg: the full resolved settings snapshot from `blsi.Model.resolve(hostname, url)`. The resolved object already includes `blur_all_active` and `blur_items` — no caller-side fold needed. Handles enable / disable / refresh / item diff / extension-disabled teardown in one pass. Safe to call from any path — init, storage onChange, shortcut, picker callback, SPA URL change.
- `blur_all_active` (boolean) and `blur_items` (array) are included in the resolved settings by `blsi.Model.resolve()`. Engine never reads storage — all data arrives via the settings argument.
- `handleSite` calls `handleMainDocument(settings)` (awaited) to get `shadowRoots[]`, then `Promise.all(shadowRoots.map(sr => handleShadowRoot(settings, sr)))`. Iframes: same-origin are self-managed via `all_frames:true`; cross-origin iframes are stamped by `handleIframe` in the MO callback when dynamically inserted.
- `handleMainDocument(settings)` — main document only. Active path: injectRules + clear stale stamps + stampElements + observeRoot, returns `ShadowRoot[]`. Inactive path: `teardown(document)`, returns `[]`.
- `handleShadowRoot(settings, shadowRoot)` — one shadow root. Active path: injectRules + clear stale stamps + stampElements + observeRoot, recurses into nested shadow roots via `Promise.all`. Inactive path: `teardown(shadowRoot)`.
- `handleIframe(settings, iframeEl)` — cross-origin iframes only. Stamps `data-bl-si-blur='1'` on the `<iframe>` element itself when active (CSS filter blurs the rendered output as an opaque box). Skips same-origin iframes (their own content_script handles blur via `all_frames:true`). Called from the `observeRoot` MO callback when an iframe is dynamically inserted.
- `handleDocument(settings, root)` — thin router kept for backward compatibility and unit tests. Routes to `handleMainDocument` or `handleShadowRoot` based on root type.
- `teardown(root)` — disconnects observer, removes injected style, clears stamps, recurses into shadow roots. Used by `unblurAll()` (alias: `teardown(document)`) and the inactive path of `handleMainDocument`/`handleShadowRoot`. The `querySelectorAll('*')` stamp-clearing pass already covers `<iframe>` elements — no separate cleanup needed.
- `injectRules(root, categories, mode)` — injects a `<style id="bl-si-blur-styles">` into `root.head ?? root`. Stateless — no DOM branch on root type. Calls `removeRules(root)` first (replace semantics).
- `removeRules(root)` — removes the injected style from `root.head ?? root`.
- `stampElements(root, categories, thorough, mode)` — single `querySelectorAll('*')` pass; stamps `data-bl-si-blur` on text-check elements, returns discovered `ShadowRoot[]`.
- `observeRoot(root)` — attaches a `MutationObserver` to `root.body ?? root`, keyed in `_observers` (WeakMap, auto-GCs with detached shadow roots). Observer is gated by `_pickerActive` and `_isPageBlurred`. MO callback calls `handleShadowRoot` for new shadow hosts and `handleIframe` for dynamically inserted iframes.
- Private state: `_isPageBlurred`, `_observers` (WeakMap), `_handling` (mutex), `_dynamicCounter`, `_stickyCounter`, `_pickerActive`, `_currentSettings`, `_activeItems` (Map of currently-applied items by id). Do not introduce parallel state in callers.
- Internal helpers `applyItem(item)` / `removeItem(item)` are private. `allocateDynamicName()` / `allocateStickyName()` / `resetCounters()` remain public — picker callbacks need them for item naming before writing to storage.
- Item reconciliation via `_activeItems` Map (keyed by `selector` for dynamic, `id` for sticky). Items in desired but not tracked → `applyItem`; tracked but not in desired → `removeItem`. Counter seeding happens inside `applyItem` — high-water mark from item names, so callers only need `resetCounters()` once on init.
- MutationObserver reads `_currentSettings.THOROUGH_BLUR` fresh on every callback — never capture settings in a closure.
- `isBlurAllActive()` — stateless DOM check (`document.head.querySelector('#bl-si-blur-styles')`). `get isPageBlurred` is the state-based getter — callers should prefer it.
- `handleSite` is pure w.r.t. storage. Tests call it directly with inline settings — no storage stubs needed. See `tests/unit/blur_engine.test.js`.

#### CSS Specificity Model — invariants (do not break)

Three CSS systems can co-exist on one element: blur-all, pick-blur, PII. Each system **owns its elements exclusively**. Two mechanisms enforce this:

**1. EXCLUDE contract**
`EXCLUDE` is the `:not(...)` chain appended to every tag in `alwaysBlurSelector`. It must include every independently-managed blur attribute so blur-all's tag-based CSS never matches those elements. Current entries relevant to blur ownership:
- `:not([data-bl-si-pick-blur])` — pick-blur owns those elements
- `:not([data-bl-si-pii])` — PII detection owns those elements

Root cause of past bugs: tag selectors (e.g. `p:not(...)`) have specificity `(0,7,1)` while attribute selectors (`[data-bl-si-pick-blur]`) have `(0,3,0)`. Without exclusion, the tag rule wins regardless of source order.

**2. Stamp ownership guard**
`stampElements` and `tryBlurTextCheck` must skip any element already carrying a competing blur attribute. Current guard (must stay in sync):
```js
if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return;
```
Same check applies in the custom-element (`tag.includes('-')`) path.

**Cascade priority (high → low)**: reveal > pick-blur / PII > blur-all

**Adding a new blur-all mode** — update `injectRules` + `blurDecl` only. No EXCLUDE changes needed; existing exclusions already cover all competing systems.

**Adding a new competing blur system (new attribute)** — checklist:
1. Add `:not([data-attr])` to `EXCLUDE`
2. Add `el.dataset.blSiNewAttr` guard to `stampElements` (both tag paths) and `tryBlurTextCheck`
3. Add reveal override for the new attribute in both `injectRules` reveal block and `content.css`

### url_matcher.js
- `matchesPattern(url, pattern, patternType)` — wildcard mode uses parse-then-match (scheme / hostname / port / path) with domain-boundary awareness. Regex mode rejects nested quantifiers (`(a+)+`, `a**`) to prevent ReDoS.
- `resolveSettings(url, globalSettings, rules)` — deep-merge over `blsi.DEFAULT_MODEL`, apply first matching rule. Non-array / null `rules` is tolerated.
- `MAX_PATTERN_LENGTH = 500`. Patterns exceeding this return `false` from `matchesPattern`.
- Pure module — no DOM access, no storage. Safe to load early in the manifest order (position 2, right after constants).

### reveal_controller.js
- `init({ getMode, isPickerActive })` — both are **functions**, not values. Called on every event, so the caller never has to re-init when `settings.REVEAL_MODE` or picker-active state changes.
- `clearAll()` resets every piece of reveal state: click-revealed element, hover-revealed element, ancestor chain, mouseout debounce timer, `_revealedElements` set. Called from `applyState` on `REVEAL_MODE` change and on `!settings.ENABLED`.
- `destroy()` removes all document listeners + `clearAll()`. Only used on disable paths.
- Listeners are registered at capture phase on `document` for mouseover/mouseout, bubble phase for click/keydown. Input / textarea / select / button / contenteditable targets are skipped inside `onRevealClick` — do not move that guard.
- Hover mode has a 50ms mouseout debounce via `setTimeout`; reset on any mouseover to avoid flicker on element boundaries.
- **Reveal is attribute-driven, not inline-style.** `_revealElement` stamps `data-bl-si-reveal="1"` on every element — zone overlays included. CSS rules in `styles/content.css` + injected `<style>` handle all modes: `[data-bl-si-pick-blur][data-bl-si-reveal]` clears filter/background/color; `.bl-si-zone-overlay[data-bl-si-reveal]` additionally clears `backdrop-filter` and `background` (covers blur, frosted, and color zone modes). No inline styles used for reveal. Trade-off: `background-color: transparent` may strip legitimate element backgrounds during reveal; acceptable since reveal is temporary.
- No JS mode branching needed. The CSS overrides are no-ops for properties the active blur mode doesn't set.

### selector_utils.js
- `getSelectors(el)` returns `string[]` ordered structural→semantic (index 0 = most structural). Use for saving — call sites store `item.selectors = getSelectors(el)`.
- `getSelector(el)` is a compat alias → `getSelectors(el)[0] ?? null`. Returns a string or null (never an array).
- `getSelectors(body)` / `getSelectors(documentElement)` / `getSelectors(null)` must return `[]`.
- `restoreSelector(string | string[])` — accepts either. Tries each entry until `querySelectorAll().length === 1`; returns that element. Returns `null` if nothing matches.
- `isSelectorStable(el)` — fast O(1) heuristic: returns `true` if element has id, aria-label, non-bl-si classes, or a stable data-* attr. Does NOT run querySelectorAll. Used by picker hover to show the "may not persist" warning.
- Strategy order in `getSelectors`: 0=full-structural 1=anchored-structural 2=class-combo 3=aria-label 4=data-attrs 5=#id. Only emits a selector if `querySelectorAll().length===1` (uniqueness gate).
- `generateId()` returns an 8-char lowercase hex string.

### storage_model.js
- Accesses `chrome.storage.local` (model) and `chrome.storage.session` (automate_blur) directly — no background relay. Model data lives under the single `blsi_model` key. Automate blur state lives under `blsi_automate_blur` in session storage (auto-cleared on browser close/crash).
- `init_cache()` — must be called once (by content_script/popup init) before any `get()` or `patch_section()` calls. Loads `blsi_model` from local storage into `_cache` AND loads `blsi_automate_blur` from session storage into `_automate_cache`.
- `on_change(listener)` — registers a callback fired whenever the cached model changes (from storage `onChanged`). Single subscriber — calling twice replaces the first. Popup uses this to react to cross-context updates.
- `get()` — returns the full cached model. Never reads storage directly after init; always returns from cache.
- `patch_section(section, delta)` — deep-merges `delta` into the named section, writes the updated model back to storage, and updates cache. Use for deliberate user-triggered saves.
- `debounced_patch(section, delta, delay?)` — same as `patch_section` but batches rapid calls (default **150 ms**). Use from popup inputs to avoid saturating storage writes.
- `save_settings(patch)` — merges a partial settings patch into `model.settings`. Pass only the keys you want to update; unspecified keys are preserved.
- `resolve(hostname, url)` — returns the effective resolved settings for a hostname/URL by merging global settings + first matching wildcard/regex site_rule + exact hostname site_rule. Includes `blur_all_active`, `blur_items`, `automate_blur_active`, and `automate_blur_triggers` in the output. Reads automate state from `_automate_cache` (session storage), not from the model.
- `get_blur_items(host)` / `save_blur_item(item)` / `remove_blur_item(id)` — blur item CRUD.
- `clear_host(host)` — clears `blur_all` + items for the host in local storage, then calls `clear_automate_blur(host)` to clear session storage separately.
- `clear_all()` — clears `blur_all` + items for all exact rules in local storage + resets session storage (`blsi_automate_blur: {}`) separately.
- `get_cached_blur_state(host)` — synchronous; reads blur state from cache (no I/O). Use everywhere — `get_blur_state` was removed.
- `save_blur_state(host, state)` — async blur-all state write.
- `get_automate_blur(hostname)` — synchronous; returns `{ idle, tab_switch, screen_share }` from `_automate_cache`. Use in popup to read current trigger state without going through model.
- `save_automate_blur(hostname, trigger, bool)` — write one automate trigger (`'idle'|'tab_switch'|'screen_share'`) to `chrome.storage.session`.
- `patch_automate_blur(hostname, patch)` — batch-write multiple triggers in one session storage write.
- `clear_automate_blur(hostname)` — remove all automate_blur state for a hostname from session storage.
- `get_rules()` / `save_rules(rules)` — URL rules CRUD. Rules are an array of `{ hostname_value, hostname_type, blur_all, items, settings }` where `hostname_type` is `'wildcard'|'regex'` (non-exact entries only).
- `_reset_cache()` — test-only helper. Clears both `_cache` and `_automate_cache` so tests start from a clean slate.

### action_registry.js
- Single source of truth for every shortcut-driven action. `blsi.Actions`.
- Each entry: `{ id, label, description, defaultBinding, messageType, chromeCommand }`.
- Adding an action: one entry here + one handler in `content_script.shortcutActionMap` + (optional) one entry in `manifest.json > commands`. Nothing else.
- `defaultBindings()` returns a mutable clone keyed by action id (kebab-case, e.g. `'toggle-blur-all'`) in the shape `{ 'action-id': { binding: [{code, mods}] } }`. Consumed by `blsi.build_default_model()`.
- `ACTIONS` is frozen. Do not mutate the registry at runtime.

### shortcut_label.js
- Platform-aware chord label rendering. `blsi.ShortcutLabel`.
- `IS_MAC` is computed once at module load from `navigator.platform`/`navigator.userAgent`.
- Mac renders Unicode glyphs (`⌘⇧⌥⌃`) and concatenates without separators; Win/Linux spells out mods (`Ctrl`, `Shift`, `Alt`, `Win`) joined by `+`.
- `chordKey(chord)` produces the canonical `"<sorted mods>|<code>"` string used for conflict detection. `bindingKey(binding)` joins chord keys with a space for sequence comparison.
- `CODE_TO_LABEL` is the complete letter/digit/symbol/function/numpad map. Unknown codes fall back to the code string itself.
- `isReserved(chord)` / `lookup(chord)` / `RESERVED` — 14-entry browser-reserved chord hint list with per-platform filters (`any`, `mac`, `win`). Not a deny list — capture UI shows a warning but always allows save.

### shortcut_handler.js
- `init(shortcuts, callbacks)` accepts `{ 'action-id': { binding: [{code, mods}] } }` (kebab-case action ids). Multi-chord bindings (length > 1) are skipped in phase 1 with a logger warning.
- Modifiers are read from `event.altKey/ctrlKey/metaKey/shiftKey` — side-agnostic. Do NOT reintroduce a held-keys Set.
- Key matching uses `event.code` (physical key, layout-independent).
- Early-exit guards: `event.repeat`, `event.isComposing`, `event.key === 'Dead'`, `event.key === 'Process'`, `event.key === 'Unidentified'`, `getModifierState('AltGraph')`, and pure-modifier keydowns (via `blsi.MODIFIER_CODES`).
- Fires `callbacks[actionId]` for any matched shortcut. Uses `blsi.Actions.get(actionId).label` for the toast text.
- Fires `callbacks.onExitPicker` on Escape when `_isPickerActive === true`. Escape never dispatches to a bound shortcut.
- Stamps `globalThis.__blsiShortcutFire[actionId]` with a monotonic timestamp on every match. `content_script.handleMessage` uses this as a fire-token to dedup the JS path against `chrome.commands` relays (500ms window).
- Listeners registered at capture phase (`addEventListener('keydown', fn, true)`).
- `_setPickerActive(v)` and `_getFireToken()` must be in the public return object.

### picker.js
- Three modes: `PM.DYNAMIC`, `PM.STICKY_PAGE`, `PM.STICKY_SCREEN`. `_isSticky(mode)` helper distinguishes the two sticky variants. `setMode` rejects anything else.
- Sticky draw: the preview `<div class="bl-si-zone-drawing">` always uses `position: fixed` with viewport coordinates — it's just a drag visual.
- Sticky commit: the `onStickyBlur` callback passes `{ anchor: 'page' | 'screen', x, y, width, height, scrollWidth, scrollHeight }`. For `STICKY_PAGE`, `x/y` are **document** coordinates (scroll offset added) and `scrollWidth/Height` snapshot the document size for later xPct/yPct re-projection. For `STICKY_SCREEN`, `x/y` are **viewport** coordinates (no scroll offset) and `scrollWidth/Height` is the viewport, not the document.
- Toolbar: `toolbarEl.id = "bl-si-picker-toolbar"` (tests use `getElementById`). It's a floating draggable pill, not a full-width bar. Position persisted at `chrome.storage.local.picker_toolbar_pos = { top, left, right, bottom }`. Drag handle is the `.bl-si-toolbar-drag` element; dragging attaches `mousemove`/`mouseup` at capture phase on `document` so it beats the picker's own mouse handlers.
- Toolbar appended to `document.body`, not `document.documentElement`.
- The `.bl-si-picker-active button` blanket `cursor: crosshair` rule in `styles/content.css` excludes toolbar buttons (`.bl-si-toolbar-btn`, `.bl-si-toolbar-btn--close`, `.bl-si-toolbar-drag`) and toolbar selects. Two explicit higher-specificity rules (`.bl-si-toolbar .bl-si-toolbar-btn`, `.bl-si-toolbar select`) re-assert `cursor: pointer` for the pill's interactive children.
- Blur/unblur decision: use `blsi.BlurEngine.isBlurred(target)` to detect both data-attribute and CSS-tag-rule blurs.
- Do not call `blsi.SelectorUtils` inside picker — it is not picker's responsibility.
- All event listeners at capture phase. `onClick` calls `stopPropagation` + `stopImmediatePropagation`.

### content_script.js
- Thin orchestrator. State: `settings`, `isPickerActive`, `lastContextMenuTarget`, `hostname`, `lastUrl`, `_topHostname`. Per-blur state (counters, observer, `isPageBlurred`, reveal state, active items) lives in `blur_engine.js` / `reveal_controller.js` — do not re-introduce it here.
- Module aliases: `Engine` (`blsi.BlurEngine`), `Store` (`blsi.Model`), `Selector` (`blsi.SelectorUtils`), `Picker` (`blsi.Picker`), `Shortcuts` (`blsi.Shortcuts`). `Reveal` (`blsi.Reveal`) is aliased at the very top of the IIFE. No `UrlMatcher` alias — settings resolution goes through `Store.resolve()`.
- `_topHostname` — equals `location.hostname` in the main frame; derived from `document.referrer` in cross-origin iframes. Used for `blur_all_active` lookup so iframes follow the parent page's blur-all state rather than their own. Updated via `postMessage` from the main frame on every storage change.
- Use the `setPickerActive(active)` helper for every picker state change — it's the single source of truth that updates the local flag, `Shortcuts._setPickerActive`, AND `Engine._setPickerActiveForObserver` together. Do NOT update any of those three directly from call sites (TOGGLE_PICKER handler, pickerCallbacks.onDeactivate, applyState disable path all go through the helper). Skipping the observer gate leaves the MutationObserver silent for new DOM nodes after the picker closes, which silently breaks dynamic content on the page.
- Pass `resolved.shortcuts` directly to `Shortcuts.init()` — no flattening needed. Keys are kebab-case action ids (e.g. `'toggle-blur-all'`).
- `Reveal.init({ getMode: () => settings.reveal_mode, isPickerActive: () => isPickerActive })` — pass functions, not values, so reveal state stays consistent without re-init on every settings change.
- `GET_STATUS` response: `{ isPageBlurred: Engine.isPageBlurred, isPickerActive, blurredCount: document.querySelectorAll('[data-bl-si-blur]').length }`.
- Async message handlers that need `sendResponse` must `return true` from `handleMessage`. `TOGGLE_BLUR_ALL`, `CLEAR_ALL_BLUR`, `CONTEXT_BLUR`, `CONTEXT_UNBLUR` are all async (storage write + `_sync()`), so they return `true`.
- All settings keys are **snake_case** throughout — `resolved.blur_radius`, `resolved.reveal_mode`, `resolved.blur_categories` (object with lowercase sub-keys: `{ text, media, form, table, structure }`), etc.
- **All blur state changes go through `_sync()`.** The pattern is: write to `Store.*`, then `await _sync()`. This applies to toggle, clear-all, context menu, picker callbacks, settings change, and init. `_sync()` calls `Store.resolve(_topHostname, location.href)` — which returns the full resolved snapshot including `blur_all_active` and `blur_items` — then passes to `Engine.handleSite(resolved)`. Engine never reads storage.
- **Every `_sync()` call site MUST `await`.** Fire-and-forget invocations let concurrent onChange events interleave two reconciles that corrupt the engine's `_activeItems` Map.
- `applyState(resolved, prev)` awaits `_sync()` at the end — no per-field branching on categories/mode/thorough/radius. Engine skips the page-wide nuke when nothing structural changed.
- Settings resolution: `Store.resolve(_topHostname, location.href)` → `applyState(resolved, prev)` — used by `init()`, `handleStorageChange()`, and `onUrlChange()` (SPA).
- `handleStorageChange(newModel, _oldModel)` — receives full model objects (new `blsi_model` shape). Re-resolves via `Store.resolve()` + `applyState()`. Single storage key — no per-key branching on `blurred_items` / `blur_all_hosts` (those keys no longer exist).
