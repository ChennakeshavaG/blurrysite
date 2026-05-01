```markdown
# Blurry Site — Claude Instructions

## What This Project Is

Chrome/Firefox MV3 extension. Vanilla JS only — no bundler, no ES modules, no TypeScript.
All source files IIFEs assigning single `window.BlurrySite*` global.

Per-module contracts: `docs/contracts/<module>.md` (one per module — read during implementation). Index: `docs/contracts/README.md`.

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
| `src/constants.js` | `globalThis.blsi` | Message types (`blsi.STORAGE.*`, `blsi.COMMAND.*`, `blsi.POPUP.*`), `DEFAULT_MODEL` (no shortcuts — built lazily), `reveal_dfs_max_depth`, `modifier_codes`, `is_valid()`, `category_of()`, `build_default_model()`, `validate_model()`, `isValidShortcutEntry()`, `deep_merge()`, `item_selectors(item) → string[]` (selector-list normalizer), `cat_key(categories) → string` (positional-bits fingerprint shared with `Css.getSelectors`). Enums: `reveal_modes`, `blur_modes`, `picker_modes`, `pick_blur_modes`, `pii_modes`, `idle_units`, `pattern_types`, `SUPPORTED_LANGUAGES`, `css`, `ids` |
| `src/logger.js` | `blsi.Logger` | `log`, `warn`, `error`, `flow(tag, data?)`, `scope(name)`, `enable`, `disable`, `get enabled`. Persists toggle to `chrome.storage.local.blsi_debug`. Listens on `chrome.storage.onChanged` for cross-context state sync. `error` always logs; all else gated. `scope(name)` returns tagged variant `{log, warn, error, flow, get enabled}`. |
| `src/action_registry.js` | `blsi.Actions` | Single source of truth for shortcut-driven actions. `list()`, `get(id)`, `ids()`, `defaultBindings()`, `ACTIONS`. Each action: `{ id, label, description, defaultBinding, messageType, chromeCommand }`. Adding action = one entry here. |
| `src/shortcut_label.js` | `blsi.ShortcutLabel` | Platform-aware label rendering + reserved chord list. `codeLabel(code)`, `modLabel(mod)`, `chordLabel({code, mods})`, `bindingLabel([...])`, `chordKey(chord)`, `bindingKey(binding)`, `IS_MAC`, `CODE_TO_LABEL`. Mac renders `⌘⇧⌥⌃`, Windows/Linux renders spelled-out mods. Also: `isReserved(chord)`, `lookup(chord)`, `RESERVED` — warning-only hint list (~14 entries); capture UI allows save regardless. |
| `src/url_matcher.js` | `blsi.UrlMatcher` | `matchesPattern`, `resolveSettings`, `isRestrictedUrl(url)` (Chrome-blocked URL guard — chrome://, chromewebstore.google.com, etc.), `MAX_PATTERN_LENGTH` |
| `src/selector_utils.js` | `blsi.SelectorUtils` | `getSelectors(el) → string[]` (ordered structural→semantic; use for saving), `getSelector(el) → string\|null` (compat alias → `getSelectors()[0]`), `isSelectorStable(el) → bool` (fast O(1) check; true if id/class/aria/data-* found), `generateId`, `restoreSelector(string\|string[]) → Element\|null` (tries each in order, returns first unique match), `restoreAllSelectors` |
| `src/storage_model.js` | `blsi.Model` | `init_cache`, `on_change`, `get`, `patch_section`, `save_settings`, `capture_snapshot(hostname?)`, `save_site_snapshot(hostname_value, hostname_type, snapshot)`, `get_site_snapshot(hostname_value, hostname_type)`, `resolve(hostname, url, tab_id?)`, `get_blur_items`, `save_blur_state(is_active)` (writes `blur_all.status` globally), `save_blur_item`, `remove_blur_item`, `get_screen_share_state`, `set_screen_share_active(tabId)`, `set_screen_share_inactive`, `suppress_screen_share(scope, ctx)`, `unsuppress_screen_share(scope, ctx)`, `get_suppressed_tabs`, `add_suppressed_tab`, `remove_suppressed_tab`, `clear_suppressed_tabs`, `clear_host`, `get_rules`, `save_rules`, `_reset_cache` — accesses `chrome.storage.local` (model) and `chrome.storage.session` (`blsi_screen_share`, `blsi_automate_suppressed_tabs`) directly (no background relay). Idle + tab_switch session keys are owned by `blsi.Automate.State`; resolve reads them via `State.read_idle()` / `State.read_tab_switch(tab_id)`. |
| `src/tab_privacy.js` | `blsi.TabPrivacy` | `enable()`, `disable()`, `isActive` (getter) — replaces tab title with `…` when active |
| `src/pii/pii_state.js` | `blsi.PiiState` | `PII_ATTR` constant + `getMatchCount`/`incrementMatchCount`/`resetMatchCount`/`getActiveTypes`/`setActiveTypes`/`clearActiveTypes` — shared private state for the PII sub-modules. |
| `src/pii/pii_checksums.js` | `blsi.PiiChecksums` | Phase 0 stub — empty `Object.freeze({})`. Phase 3 fills with Luhn / Verhoeff / mod-N / ISO 7064 / Base58Check / bech32 / letter-tables. |
| `src/pii/pii_pre_filter.js` | `blsi.PiiPreFilter` | `isExtensionUI(node)`, `isInsidePiiSpan(node)` — Stage 0 whole-node drops. Phase 1 adds `isInsideCodeBlock` + M1 digit pre-screen. |
| `src/pii/pii_country.js` | `blsi.PiiCountry` | Phase 0 stub. Phase 4 fills with page-level country signal (TLD + lang + meta + currency density) → ISO 3166 alpha-2 or null. |
| `src/pii/pii_suppressors.js` | `blsi.PiiSuppressors` | `NUMERIC_PROFILE`, `FALSE_POSITIVE_CHECKS`, `falsePositivesCheck`, `isYear`, `isVersion`, `isPublicPrice`, `isCountNoise` — Stage 4 FP cascade. Phase 1 extends with Tier-A suppressors. |
| `src/pii/pii_detectors.js` | `blsi.PiiDetectors` | `EMAIL_RE`, `NUMERIC_RE`, `PATTERNS`, `findMatches(text, types)`, `getPatterns()` — pattern catalog + match finder. Phase 3 adds Stage 1 dedicated detectors + `runDetector` helper + `consumed[]` tracker. |
| `src/pii/pii.js` | `blsi.PiiDetector` | Facade — `scan(rootEl, types)`, `clear(rootEl)`, `handleMutations(mutations, root)`, `getMatchCount()`, `getPatterns()`. Public global name preserved from pre-split for backward compat. Owns no observer; subscribes to engine MO dispatcher. |
| `src/fonts.js` | `blsi.Fonts` | `DISC_FONT_FACE`, `ASTERISK_FONT_FACE` — `@font-face` strings for `"bl-si-censored-disc"` and `"bl-si-starred-asterisk"` (OFL-1.1) referencing `chrome-extension://` URLs. `loadFonts()` — fire-and-forget; fetches the woff2 binaries from the extension origin and registers them in `document.fonts` via the FontFace API so the modes still render when page CSP forbids `chrome-extension://` in `font-src`. |
| `src/core/engine_state.js` | `blsi.EngineState` | Shared private state across the engine sub-modules: getters/setters for `isPageBlurred`, `pickerActive`, `currentSettings`, `pickBlurDynamicActive`, plus `getBlurredCount` / `incrementBlurredCount` / `decrementBlurredCount`. |
| `src/core/categories.js` | `blsi.Categories` | `CATEGORY_SELECTORS`, `CATEGORY_ORDER`, `DEFAULT_CATS` — frozen tag/role data for the five blur categories. Pure data, no state. |
| `src/core/css_manager.js` | `blsi.CssManager` | Three injection systems: `injectRules / removeRules / isBlurAllActive` (blur-all), `injectPickBlurRules / removePickBlurRules` (pick-blur), `injectPiiRules / removePiiRules` (PII). Plus `ensureSvgFilter`, `getSelectors / getLastSelectorCache`, and `SVG_FILTER_ID` (read by orchestrator teardown). |
| `src/core/marker_engine.js` | `blsi.MarkerEngine` | Element stamping + match queries: `applyBlur`, `removeBlur`, `isBlurred`, `isVisuallyBlurred`, `stampElements` (returns `ShadowRoot[]`), `tryBlurTextCheck`, `matchesActiveCategories`, `_stampIframeIfCrossOrigin`, `_isExtensionUI`. Per-element decision logic lives in private `_evaluateAndStamp`; both `stampElements` and `tryBlurTextCheck` delegate to it. Text-check tag set lives in shared `Css.getSelectors(cats).textCheckSet` — no parallel cache. |
| `src/core/observer.js` | `blsi.Observer` | One MutationObserver per root + idle-batched drain + subscriber pub/sub: `observeRoot`, `disconnectObserver`, `subscribeMutations(name, handler)` (also attaches `observeRoot(document)` so subscribers receive mutations regardless of feature state), `unsubscribeMutations(name)` (disconnects the document MO when no subscriber AND no feature still needs it), `hasSubscribers()`, `initShadowAttachListener` / `removeShadowAttachListener`, orchestrator helpers `clearPendingMutations`, `clearStampQueueForRoot`, `pushStampQueueItem`, `scheduleStampIdle`. MO config `{ childList, subtree, characterData }`. |
| `src/core/target_engine.js` | `blsi.TargetEngine` | Pick-blur targets — zones, items, popup hover highlight: `reconcileItems`, `activeItemsSize`, `tryPickBlurNode`, `getZoneOverlays`, `removeAllZoneOverlays`, `resetCounters`, `allocateElementName`, `allocateStickyName(anchor)`, `highlightItem`, `clearItemHighlight`. |
| `src/engine.js` | `blsi.Engine` | Facade + orchestrator. Re-exports the public surface of every `core/*` module. Owns `handleSite` (single async entry, mutex-guarded), `handleDocument(settings, root)` (works for `document` and shadow roots), `handleIframe` (thin wrapper over `MarkerEngine._stampIframeIfCrossOrigin`), `teardown`, `unblurAll`, `_setPickerActiveForObserver`, and getters for `isPageBlurred` / `blurredCount`. External callers (`content_script`, `picker`, `reveal_controller`, popup, tests) talk only to this surface. |
| `src/automate/state.js` | `blsi.Automate.State` | Shared session-storage state for automate triggers. `PHASES` (idle: active/idle/locked; tab_switch: off/armed/fired), `KEYS` (storage names), `read_idle()`, `read_tab_switch(tab_id)`, `read_all_tab_switch()`, `write_idle(phase)`, `write_tab_switch(tab_id, phase)` (writing `'off'` strips the entry), `clear_tab_switch(tab_id)`, multi-subscriber `on_change(fn)`, `_reset()`. Loaded in BOTH contexts. |
| `src/automate/overlay.js` | `blsi.Automate.Overlay` | Viewport overlay primitive used by automate intent (parallel to stamp+CSS engine). `init()`, `show({mode, color, opacity, blur_radius})`, `update(opts)`, `hide()`, `isVisible()`, `destroy()`. Modes: `solid` / `frosted` / `color`. Loaded in CONTENT only. |
| `src/automate/idle.js` | `blsi.Automate.Idle` | Background-only `chrome.idle.onStateChanged` listener. `init()`, `destroy()`, `setThreshold(seconds)` (clamped [15, 3600]), `getCurrentPhase()`. Threshold seeded from `automate.settings.idle.{value,unit}`; hot-updates on storage change. |
| `src/automate/visibility.js` | `blsi.Automate.Visibility` | Per-tab Page Lifecycle observer (visibilitychange + focus + blur). `init({tab_id})`, `destroy()`, `getCurrentPhase()`. Only writes `'fired'` to State; `'armed'` strips the entry (D4: absence === armed/off). |
| `src/main_world_bridge.js` | _(none — MAIN world)_ | No global; runs at `document_start` in page's MAIN world. Patches `navigator.mediaDevices.getDisplayMedia` (fires `'__blsi_screen_share'` on share start/stop) and `Element.prototype.attachShadow` (fires `'__blsi_shadow_attached'` on element for late shadow root discovery). No `chrome.*` access. |
| `src/screen_share.js` | `blsi.ScreenShare` | `init()`, `destroy()`, `whoAmI()`, `getTabId()` — isolated-world bridge; listens for `'__blsi_screen_share'` CustomEvents from MAIN world. On `init` fires `WHO_AM_I` round-trip so `Store.resolve(..., tab_id)` can identify the sharing tab. On share start opens port `'blsi-screen-share'` + sends `SCREEN_SHARE_STARTED`; on share end disconnects port + sends `SCREEN_SHARE_ENDED`. Background owns the session record (`blsi_screen_share`); content tabs subscribe via `chrome.storage.session.onChanged`. `SCREEN_SHARE_NOTIFY` broadcast is a UI ping for toast timing. |
| `src/reveal_controller.js` | `blsi.Reveal` | `init({ getMode, isPickerActive })`, `destroy`, `clearAll` |
| `src/shortcut_handler.js` | `blsi.Shortcuts` | `init(shortcuts, callbacks)` — accepts `{ 'action-id': { binding: [{code, mods}] } }` shape (kebab-case action ids). `destroy`, `showToast`, `_setPickerActive`, `_getFireToken` (for content_script dedup). Reads mods from event booleans (side-agnostic). Reads label from `blsi.Actions.get(id).label` for toast. |
| `src/selection_blur.js` | `blsi.SelectionBlur` | `init()`, `destroy()`, `blurSelection()`, `clearAll()`, `getSelectionBlurs()`, `removeSelectionBlur(id)` — text-selection driven blur via `[data-bl-si-blur]` spans. `blurSelection()` takes no args; reads `document.getSelection()` internally. |
| `src/screenshot.js` | `blsi.Screenshot` | `captureViewport()`, `download(dataUrl, filename)`, `copyToClipboard(dataUrl)`, `startCrop()`, `cancelCrop()` — viewport capture with blur preserved |
| `src/picker.js` | `blsi.Picker` | `activate`, `deactivate`, `setSettings`, `setMode`, `isActive` (getter) |
| `content_script.js` | _(none — orchestrator)_ | Binds all modules via `blsi.*` aliases after DOM ready |

**Load order fixed by `manifest.json`** — `main_world_bridge.js` runs first in MAIN world at `document_start`. Isolated world at `document_idle`: constants → content_i18n → logger → action_registry → shortcut_label → url_matcher → selector_utils → storage_model → tab_privacy → pii/pii_state → pii/pii_checksums → pii/pii_pre_filter → pii/pii_country → pii/pii_suppressors → pii/pii_detectors → pii/pii → fonts → core/engine_state → core/categories → core/css_manager → core/marker_engine → core/observer → core/target_engine → engine → screen_share → automate/state → automate/overlay → automate/visibility → reveal_controller → shortcut_handler → selection_blur → screenshot → picker → content_script. Never reorder.

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
  site_rules,        // array of URL-rule entries — explicit, user-created via Site
                     // Rules form. Each entry: { hostname_value, hostname_type, snapshot }.
                     // Snapshot mirrors capture_snapshot() output and may include
                     // pick_and_blur.items pinned by the rule (REPLACE semantics at
                     // resolve time) and full automate.idle.value/unit. Partial inputs
                     // are auto-filled to the full shape at write (save_site_snapshot)
                     // and at load (validate_model). Empty {} = rule has no overrides.
                     // global_default_settings is NOT captured — display knobs stay editable.
                     // The popup blur-all toggle does NOT create site_rules entries —
                     // it writes to the global blur_all.status.
}
// Session-storage keys live OUTSIDE blsi_model:
//   chrome.storage.session['blsi_automate_idle']                — 'active'|'idle'|'locked' (global; owned by automate/state.js)
//   chrome.storage.session['blsi_automate_tab_switch_by_tab']   — { [tab_id]: 'fired' } (per-tab; owned by automate/state.js)
//   chrome.storage.session['blsi_screen_share']                 — single global record (see below)
//   chrome.storage.session['blsi_automate_suppressed_tabs']     — number[] (per-tab silence-all)
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

Defaults in `src/constants.js` → `blsi.DEFAULT_MODEL`. Per-category element lists in `src/core/categories.js` → `CATEGORY_SELECTORS`.

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
- `screen_share.enabled` — when true, `blsi.ScreenShare.init()` wraps `navigator.mediaDevices.getDisplayMedia` in page's MAIN world. On share start, `screen_share.js` opens port (`blsi-screen-share`) + sends `SCREEN_SHARE_STARTED`; background **owns** the live-share state in a single global session record (`blsi_screen_share = { active, sharing_tab_id, started_at, suppressed_sites }`) and broadcasts `SCREEN_SHARE_NOTIFY` (toast ping) to non-sharing tabs. Content tabs read the record via `chrome.storage.session.onChanged` in `storage_model.js` — they do NOT mirror screen-share state into their own per-hostname `automate_blur` entries. Tabs opened mid-share read the record on `init_cache`. On share end (or tab crash/close), port disconnect resets the record + broadcasts NOTIFY. Sharing tab NOT blurred (resolve-side check: `tab_id === sharing_tab_id`). **Smart skip**: if blur-all or pick-and-blur already enabled, automate defers (sets `automate_blur_skipped = true`, populates `automate_blur_skip_reason`), shows "Blur already active — automate skipped" toast.
- `idle.unit` accepts `blsi.idle_units` (`'sec'` | `'min'`) only — `'hr'` rejected (Chrome idle API cap ~3000 s). `value` min 1. UI warns when value exceeds 3000 s.
- `tab_switch.enabled` boolean only.

### Settings Shape: automate session storage (transient trigger state)

Three independent session keys, all in **`chrome.storage.session`** (auto-cleared on browser close/crash). Owned and read separately to keep concerns from leaking across each other.

**`blsi_automate_idle`** — single global string: `'active' | 'idle' | 'locked'`. Mirrors the latest `chrome.idle.IdleState`. Written by `blsi.Automate.Idle` (background-only listener). Cleared on browser close.

**`blsi_automate_tab_switch_by_tab`** — per-tab map `{ [tab_id]: 'fired' }`. Only `'fired'` is persisted; absence === `'off'` (=== `'armed'` for resolve purposes — D4). Written by `blsi.Automate.Visibility` (content-only, per-tab Page Lifecycle observer).

```js
// chrome.storage.session['blsi_automate_idle']:
'idle'

// chrome.storage.session['blsi_automate_tab_switch_by_tab']:
{ '184729322': 'fired' }
```

**`blsi_screen_share`** — single global record describing the live screen-share session. Owned by `background.js`; `storage_model.js` mirrors it into `_screen_share_cache` for synchronous reads.

```js
// chrome.storage.session['blsi_screen_share']:
{
  active: false,
  sharing_tab_id: null,    // tab id of the user who initiated the share
  started_at: null,         // epoch ms
  suppressed_sites: [],     // hostnames suppressed for this share only (session scope)
}
```

**`blsi_automate_suppressed_tabs`** — `number[]` of tab ids silenced for **all** automate triggers. Set when a user picks "This tab" from the toast / popup notif card. `chrome.tabs.onRemoved` strips closed tab ids. Each new share clears this list (mitigates Chrome tab-id reuse).

**Resolve logic** — `resolve(hostname, url, tab_id)` computes:
```
manual_blur          = snapshot.blur_all.status if matched-rule sets it, else global_status
tab_suppressed       = suppressed_tabs.includes(tab_id)

idle_eff             = !tab_suppressed && automate_cache[host].idle
tab_switch_eff       = !tab_suppressed && automate_cache[host].tab_switch

ss_blur_for_me_raw   = ss.active
                        && tab_id !== ss.sharing_tab_id
                        && !ss.suppressed_sites.includes(host)
                        && model.automate.settings.screen_share.enabled
ss_eff               = !tab_suppressed && ss_blur_for_me_raw

automate_blur_active = idle_eff || tab_switch_eff || ss_eff
engage      = manual_blur || (automate_blur_active && !blur_present)
```

Automate triggers NEVER write `blur_all`. `onActive()` only clears idle/tab_switch — manual blur survives idle return.

`resolve()` exposes derived keys:
- `automate_blur_active`, `automate_blur_triggers` — `{ idle, tab_switch, screen_share }` booleans (post-suppression)
- `automate_blur_only` — true when automate is **sole** blur reason (overrides 8 settings with DEFAULT_MODEL)
- `automate_blur_skipped` — true when automate fired but deferred (blur-all or pick-blur already on)
- `automate_blur_skip_reason` — `'site_rule' | 'manual' | 'pick_blur' | null`
- `screen_share_state` — `{ active, sharing_tab_id, started_at, is_sharing_tab }` (popup card label)
- `screen_share_suppressed_for_host`, `screen_share_suppressed_for_tab` — booleans (Undo affordance)

Idle + tab_switch session APIs live on `blsi.Automate.State`:
- `read_idle()` → `'active' | 'idle' | 'locked'` (global)
- `read_tab_switch(tab_id)` → `'off' | 'armed' | 'fired'` (per-tab; absence === armed/off)
- `write_idle(phase)` (background-only writer in production)
- `write_tab_switch(tab_id, phase)` / `clear_tab_switch(tab_id)` (per-tab)
- `on_change(fn)` — multi-subscriber registry on the two keys above

`blsi.Model` screen-share + suppression session APIs:
- `get_screen_share_state()` → `{ active, sharing_tab_id, started_at, suppressed_sites }`
- `set_screen_share_active(tabId)` / `set_screen_share_inactive()` — owned by `background.js`; popup/content read-only
- `suppress_screen_share(scope, ctx)` / `unsuppress_screen_share(scope, ctx)` — `scope ∈ 'tab' | 'site_session' | 'feature'`
- `get_suppressed_tabs()` / `add_suppressed_tab` / `remove_suppressed_tab` / `clear_suppressed_tabs`
- `clear_host(hostname)` — clears pick-blur items only (idle/tab_switch are not per-host)

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
npm run test:unit          # 801 unit tests, fast
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
5. **Update the relevant `docs/contracts/<module>.tests.md`** when adding/removing/changing tests — describe groups, edge cases, known gaps

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
| Added/removed `chrome.runtime.sendMessage` type | `src/constants.js` (source of truth), `CLAUDE.md` Message Protocol tables |
| Changed default value (blur radius, chord keys, etc.) | `src/constants.js` DEFAULTS — all other files reference it |
| Changed settings shape (new keys, renamed keys) | `CLAUDE.md` Settings Shape section, `docs/contracts/storage_model.md` |
| Added/removed/renamed `blsi.Model` method or storage key | `CLAUDE.md` Module Globals table (`src/storage_model.js` row), `src/CLAUDE.md` storage_model.js rules, `docs/contracts/storage_model.md` contract |
| Added new source file under `src/` | `CLAUDE.md` Module Globals table, `src/CLAUDE.md` load order, `manifest.json` content_scripts |
| Added/modified/removed unit test | `docs/contracts/<module>.tests.md` — describe groups, edge cases, known gaps |
| Added new test file | `docs/contracts/<module>.tests.md` new file, `tests/CLAUDE.md` if test patterns differ |
| Changed test loading pattern or setup | `CLAUDE.md` Testing section, `tests/CLAUDE.md` |
| Changed keyboard shortcut handling | `CLAUDE.md` Settings Shape section, `src/CLAUDE.md` shortcut_handler rules |
| Changed CSS class names or IDs | `CLAUDE.md` CSS class constants table |
| Changed Firefox compatibility behavior | `CLAUDE.md` Firefox Compatibility Rules |
| Found new known limitation | `CLAUDE.md` Known Limitations table |

### Rules

1. **Same-commit rule** — doc updates go in same commit as code change. Never leave docs for follow-up.
2. **Update, don't append** — behavior changes: find and update existing entry. Don't add contradicting entry.
3. **Test count** — keep test count in Testing section current. Run `npm run test:unit`, update number.
4. **Don't document internals** — only document things affecting how other code interacts with module (public API, message types, settings shapes, CSS classes). Private details in code comments, not docs.

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
| ~~Reveal may strip element background color~~ | Fixed — reveal rules now clear `background-color` only for the modes that set one (color pick-blur, redacted/censored blur-all). Blur and frosted modes leave the page's background untouched during reveal. | Resolved |
| Hover reveal and click reveal work inside shadow roots; picker does not | `reveal_controller` uses `event.composedPath()[0]` to pierce shadow DOM retargeting — reveal reaches elements inside shadow roots. `picker` still uses `event.target`, cannot reach inside shadow roots. | Hover/click reveal: fixed. Picker: Phase 2 |
| `isBlurred()` returns false for alwaysBlur elements inside shadow roots | `isBlurAllActive()` checks `document.head` only; elements blurred by CSS injected into shadow root undetected. Picker can't reach them until Phase 2. | Phase 2 |
| Zone overlays misalign on pages with CSS `transform` on ancestor elements | `position:absolute` coordinate space anchors to nearest transformed ancestor, not document root — CSS spec behaviour | Known limitation — `position:fixed` screen-anchor zones unaffected; page-anchor zones may appear offset on transform-heavy pages (rare) |
| Picker cannot reach into iframes | Picker uses `event.target`, guarded to main frame only (`IS_MAIN_FRAME`) — zone drawing cannot cross frame boundaries | Phase 2 |
| Keyboard shortcuts don't fire when focus inside cross-origin iframe | Browser delivers keydown to focused frame; shortcut handler is main-frame only | Phase 2 |
| Cross-origin iframes with strict `Referrer-Policy` may not blur on initial load | `document.referrer` empty → `_topHostname` starts empty → blur-all state unknown until postMessage from main frame arrives | Acceptable — resolves within milliseconds once main frame init completes |
| SPA navigation inside iframes not tracked | `history.pushState` wrapping and popstate/hashchange listeners are main-frame only — URL rule overrides don't update if iframe does SPA navigation | Phase 2 |
| Opening the extension popup briefly blurs the page when `automate.tab_switch` is on | `window.blur` fires when focus moves to the popup; the per-tab Visibility observer cannot detect own-extension focus from page context. | Acceptable tradeoff — consistent with privacy intent (anyone shoulder-surfing during settings adjustment sees blurred content). Future mitigation: background broadcasts a `popup-opened` flag to suppress the next `passive` for ~500ms. |
| Extension cannot run on Chrome-restricted URLs (Chrome Web Store, `chrome://*`, `chrome-extension://*`, `about:`, `view-source:`, devtools, etc.) | Browser policy — `host_permissions: ["<all_urls>"]` does NOT grant injection on these URLs. Extensions are physically blocked at the platform level. | Mitigated — popup detects via `blsi.UrlMatcher.isRestrictedUrl(tab.url)` and renders a dedicated empty-state view; `background.js _reinjectAllTabs` skips these tabs |
| MAIN-world bridge runs late on tabs already open at install/update time | `chrome.scripting.executeScript` cannot retroactively run at `document_start`; any `getDisplayMedia` / `attachShadow` already executed in those tabs goes un-hooked. Subsequent navigations get the static `document_start` injection correctly. | Acceptable — install-time recovery prioritises the common case (page idle waiting for blur to apply); resolves on next nav |
| PII auto-detect cannot scan text rendered inside `<canvas>` | Canvas contents are a 2D bitmap drawn by JS — there are no DOM text nodes for `pii_detector`'s `TreeWalker(SHOW_TEXT)` to enumerate, and the browser blocks bitmap pixel extraction by design (DRM/privacy). OCR is not viable in-extension (size, perf, latency). | Fundamental — not fixable. Workaround: enable blur-all with the `media` category on, which blurs the entire `<canvas>` element via CSS `filter: blur()`. Pick-blur (selector-based) and screenshot capture continue to work on canvas. |
```