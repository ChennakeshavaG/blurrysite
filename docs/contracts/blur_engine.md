# blur_engine Contract

## Overview

`blur_engine.js` is the core blur execution module for the Blurry Site extension, exposed as `blsi.BlurEngine`. It owns the complete blur lifecycle: CSS injection for always-blur tags, `data-bl-si-blur` attribute stamping for text-check elements, pick-and-blur item reconciliation, sticky zone overlay management, shadow root recursion, and MutationObserver wiring for dynamic content. The module uses a hybrid CSS + data-attribute strategy — CSS selectors cover structurally predictable elements unconditionally, while JS stamping handles inline/phrasing content after a text-content gate. All production code enters through the single `handleSite(settings)` async entry point; everything else is a primitive exposed for unit tests. CSS vars (`--bl-si-radius`, `--bl-si-transition-duration`, etc.) are written by `handleSite` via `_applyCssVars`; callers must never set them independently.

---

## Section Map

| Section | Use case |
|---|---|
| `§CATEGORY-SELECTORS` | Frozen `CATEGORY_SELECTORS` constant mapping each of the 5 categories (`text`, `media`, `form`, `table`, `structure`) to `{ alwaysBlur: string[], textCheck: string[], roles?: string[] }`, plus `CATEGORY_ORDER` and `DEFAULT_CATS` constants. Edit here when adding/removing HTML elements from a blur category. **Future file: `src/blur_engine/categories.js`.** |
| `§CSS-INJECTION` | `injectRules`, `removeRules`, `injectPickBlurRules`, `removePickBlurRules`, `injectPiiRules`, `removePiiRules` (PII rule injection folded in — detection logic still lives in `src/pii_detector.js`), `ensureSvgFilter`, `isBlurAllActive`, `buildSelectors`, `getSelectors`, the `EXCLUDE` chain, blur mode CSS declarations, `selectorCache`. Edit here when adding/changing a blur mode or changing which attributes exclude an element from blur-all. **Future file: `src/blur_engine/css.js`.** |
| `§STAMP-OBSERVER` | Element queries + stamping: `stampElements`, `tryBlurTextCheck`, `_isExtensionUI`, `hasMeaningfulTextContent`, `_rebuildTextCheckSet`, `applyBlur`, `removeBlur`, `isBlurred`, `isVisuallyBlurred`, `matchesActiveCategories`, `shouldBlurElement`, `_blurredCount`, `_textCheckSet`, `_lastTextCheckKey`, `_structuralTags`. Observer infrastructure: idle queue (`_stampQueue`, `_scheduleStampIdle`, `_flushStampQueue`), MutationObserver wiring (`observeRoot`, `disconnectObserver`, `_observers`), MO idle drain + subscriber dispatch (`_drainMoIdle`, `subscribeMutations`, `unsubscribeMutations`, `_subscribers`, `_pendingMutations`, `_pendingMoNodes`, `_moIdlePending`), shadow root event bridge (`_initShadowAttachListener`, `_removeShadowAttachListener`, `_shadowAttachHandler`). Edit here when fixing text stamping, element queries, MO callback, idle scheduling, shadow root discovery, or mutation dispatcher. **Future file: `src/blur_engine/observer.js`** (element queries may move to a sibling `element.js` at split time). |
| `§ITEMS-ZONES` | Zone overlays: `createZoneOverlay`, `removeZoneOverlay`, `getZoneOverlays`, `removeAllZoneOverlays`, `_zoneOverlays`. Item reconcile + counters: `_activeItems`, `_pickBlurDynamicActive`, `_elementCounter`, `_pageAreaCounter`, `_screenAreaCounter`, `_itemId`, `_applyDynamicItem`, `_tryPickBlurNode`, `_removeDynamicItem`, `_applyStickyItem`, `_removeStickyItem`, `applyItem`, `removeItem`, `_reconcileItems`, `resetCounters`, `allocateElementName`, `allocateStickyName`. Popup hover highlight: `highlightItem`, `clearItemHighlight`, `_highlightedEl`. Edit here for zone overlay layout/anchor logic, item reconciliation, or popup item highlighting. **Future file: `src/blur_engine/zones.js`.** |
| `§ORCHESTRATOR` | `handleSite` (mutex entry point), `handleMainDocument`, `handleShadowRoot`, `handleIframe`, `_applyCssVars`, `_setPickerActiveForObserver`, `teardown`, `unblurAll`. Lifecycle state: `_isPageBlurred`, `_handling`, `_pickerActive`, `_currentSettings`, `_lastReconcileKey`. Edit here for top-level blur init, teardown, SPA/URL change handling, or lifecycle state changes. **Future file: `src/blur_engine/orchestrator.js`.** |
| `§PUBLIC-API` | The `return { ... }` block — the exported surface of `blsi.BlurEngine`. Edit this when adding or removing a public method; also update `CLAUDE.md` Module Globals table and this contract. |

---

## Module State

| Variable | Type | Tracks | Lifetime |
|---|---|---|---|
| `selectorCache` | `object \| null` | Last `buildSelectors()` result keyed by category toggle string (`"11110"`). Cache miss re-builds automatically. | Module lifetime. `null` until first `getSelectors()` call. |
| `_textCheckSet` | `Set<string>` | Tag names (lowercase) for text-check stamping; rebuilt by `_rebuildTextCheckSet` when category key changes. | Module lifetime. Rebuilt on category change. |
| `_lastTextCheckKey` | `string \| null` | Key used for last `_textCheckSet` build; enables O(1) same-key short-circuit. | Module lifetime. |
| `_blurredCount` | `number` | Running O(1) count of elements currently carrying `data-bl-si-blur`. Incremented on stamp, decremented on clear/teardown. | Module lifetime. Never reset to zero by `teardown` — decrements are applied per-element. |
| `_structuralTags` | `Set<string>` | Tag names from `CATEGORY_SELECTORS.structure.textCheck` (`div`, `section`, etc.); always require the text gate even in thorough mode. | Module constant (frozen at load). |
| `_zoneOverlays` | `Map<string, HTMLElement>` | Active zone overlay `<div>` elements keyed by `zoneData.id`. | Module lifetime. Entries removed by `removeZoneOverlay` / `removeAllZoneOverlays`. |
| `_isPageBlurred` | `boolean` | Whether blur-all is currently active. Set by `handleSite` only. Exposed via `get isPageBlurred`. | Module lifetime. `false` until first `handleSite` activates blur. |
| `_pickBlurDynamicActive` | `boolean` | Whether at least one active dynamic pick-blur item exists. Updated at the end of every `_reconcileItems` call. When `true`, the MO idle drain calls `_tryPickBlurNode` on new nodes even if blur-all is OFF. | Module lifetime. `false` until first `_reconcileItems` call with a dynamic item. |
| `_observers` | `WeakMap<root, MutationObserver>` | One `MutationObserver` per active root (document or shadow root). WeakMap auto-GCs entries when shadow roots are GC'd. | Module lifetime. Entries added by `observeRoot`, removed by `disconnectObserver`. |
| `_handling` | `boolean` | Mutex flag preventing concurrent `handleSite` re-entry. | Module lifetime. Held for the duration of one `handleSite` call. |
| `_elementCounter` | `number` | High-water mark for element (dynamic) item names (`"Element 1"`, `"Element 2"`, …). | Module lifetime. Reset by `resetCounters()`. |
| `_pageAreaCounter` | `number` | High-water mark for page-anchored zone names (`"Area on page 1"`, …). Also seeded by legacy `"Sticky N"` names. | Module lifetime. Reset by `resetCounters()`. |
| `_screenAreaCounter` | `number` | High-water mark for screen-anchored zone names (`"Area on screen 1"`, …). | Module lifetime. Reset by `resetCounters()`. |
| `_pickerActive` | `boolean` | Whether the picker is active. When `true`, the engine drain inside the MO idle callback is skipped (no stamps), but registered subscribers still receive `MutationRecord[]`. Updated via `_setPickerActiveForObserver`. | Module lifetime. |
| `_currentSettings` | `object \| null` | Last resolved settings snapshot passed to `handleSite`. Read by the MO idle callback to stamp newly inserted elements with current thorough/mode settings. | Module lifetime. Updated at start of each `handleSite` call. |
| `_shadowAttachHandler` | `function \| null` | Capture-phase listener for `__blsi_shadow_attached` CustomEvents from `main_world_bridge.js`. `null` until `_initShadowAttachListener()` is called. | Module lifetime. Removed by `_removeShadowAttachListener()` on teardown of `document`. |
| `_stampIdlePending` | `boolean` | Gate preventing duplicate `requestIdleCallback` scheduling for the stamp queue. | Module lifetime. |
| `_stampQueue` | `Array<{root, cats, thorough, mode, settings}>` | Queue of stamp work items; replaced (not appended) on each new reconcile so the pending idle always picks up the latest batch. | Module lifetime. Cleared for specific roots by `teardown`. |
| `_pendingMoNodes` | `Array<Element>` | Nodes collected by the MO callback; drained by a single idle callback. | Module lifetime. Drained to zero by the idle. |
| `_moIdlePending` | `boolean` | Gate preventing duplicate idle scheduling for the MO drain callback. | Module lifetime. |
| `_subscribers` | `Map<string, function>` | Registered subscribers receiving raw `MutationRecord[]` per root in the engine's idle drain. Insertion order preserved. Re-registering the same name replaces the prior handler. | Module lifetime. |
| `_pendingMutations` | `Map<root, MutationRecord[]>` | Per-root buffer of raw `MutationRecord` instances awaiting subscriber dispatch. | Module lifetime. Cleared for a root by `teardown(root)` and after each idle dispatch. |
| `_activeItems` | `Map<string, object>` | Items currently applied to the DOM (dynamic: selector as key; sticky: `item.id` as key). Diffed against `blur_items` on every `handleSite` call. | Module lifetime. |
| `_lastReconcileKey` | `string \| null` | Fingerprint of last `handleSite` inputs that drove `handleMainDocument`. Allows `handleSite` to skip the page-wide nuke+rescan when only CSS vars changed. | Module lifetime. |
| `_highlightedEl` | `HTMLElement \| null` | The element currently highlighted by `highlightItem`. | Module lifetime. Cleared by `clearItemHighlight` and on next `highlightItem` call. |

---

## Public API

### handleSite(settings)
**What**: Single async entry point — reconciles the entire page (document + all shadow roots) to the provided resolved settings snapshot.  
**Params**:  
- `settings` (object) — full resolved settings from `blsi.Model.resolve(hostname, url)`. Must include:
  - `blur_all_active` (boolean) — whether blur-all is on for this host
  - `blur_items` (Array) — per-host blur items (dynamic + sticky)
  - `blur_mode` (string) — one of `blsi.blur_modes`
  - `blur_categories` (object) — `{ text, media, form, table, structure }` booleans
  - `thorough_blur` (boolean) — when true, stamps text-check elements without a text-content gate (except structural containers)
  - `blur_radius` (number) — radius in px for gaussian/frosted modes
  - `highlight_color`, `transition_duration`, `redaction_color` — CSS var values
  - `pick_blur_enabled` (boolean), `pick_blur_type` (string), `pick_blur_color` (object)
  - `enabled` (boolean) — if `false`, full teardown is performed  

**Returns**: `Promise<void>`  
**Side effects**:
- Sets CSS vars on `:root` via `_applyCssVars`.
- Calls `handleMainDocument(settings)` when `reconcileKey` changes (page-wide CSS inject + idle stamp queue).
- Reconciles items via `_reconcileItems(settings.blur_items)`.
- After reconcile: if `_pickBlurDynamicActive` is true, calls `observeRoot(document)` (idempotent) to ensure the MO is attached even when blur-all is OFF. This is the key enabler for late-loading element detection in pick-blur-only mode — `handleMainDocument` tears down the observer on the inactive path, so this re-attaches it.
- Injects or removes pick-blur rules via `injectPickBlurRules` / `removePickBlurRules`.
- Sets `_isPageBlurred`, `_currentSettings`, `_lastReconcileKey`.
- Logs via `blsi.Logger.scope('engine').flow(...)` when logger is enabled.  

**Handles**:
- Concurrent calls: mutex (`_handling`) drops any re-entrant call — callers must `await` every invocation.
- `settings.enabled === false`: calls `handleMainDocument` (which calls `teardown(document)`), then clears items, zone overlays, and reconcile key.
- CSS-var-only changes (e.g., `blur_radius` in gaussian mode): `reconcileKey` unchanged → skips DOM nuke+rescan. Frosted mode exception: `blur_radius` folded into key because SVG `stdDeviation` must be rebuilt.

---

### applyBlur(element)
**What**: Stamps `data-bl-si-blur="1"` on an individual element (picker / context-menu path).  
**Params**:  
- `element` (Element) — the element to blur  

**Returns**: `void`  
**Side effects**: Sets `element.dataset.blSiBlur = "1"`, increments `_blurredCount`.  
**Handles**:
- `null` / non-Element: early return (no-op).
- Already-stamped element: idempotent guard via direct `element.dataset.blSiBlur` check (does NOT use `isBlurred()`).
- Extension UI elements (`_isExtensionUI`): skipped.

---

### removeBlur(element)
**What**: Removes both `data-bl-si-blur` and `data-bl-si-pick-blur` attributes from an element.  
**Params**:  
- `element` (Element) — the element to unblur  

**Returns**: `void`  
**Side effects**: Deletes `blSiBlur` dataset key (decrements `_blurredCount` if it was set), deletes `blSiPickBlur` dataset key.  
**Handles**: `null` / non-Element: early return.

---

### unblurAll()
**What**: Removes all blur state from the entire document and all zone overlays. Alias for `teardown(document)` + `removeAllZoneOverlays()`.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Full teardown of `document` root (disconnects observers, removes injected styles, clears all `data-bl-si-blur` stamps, recurses into shadow roots); removes all zone overlay `<div>` elements from DOM; clears `_zoneOverlays` map.  
**Handles**: PII-stamped elements (`data-bl-si-pii`) are intentionally skipped — they own their own blur lifecycle.

---

### teardown(root)
**What**: Removes all blur state from `root` and recursively from any open shadow roots within it.  
**Params**:  
- `root` (Document | ShadowRoot) — the root to tear down  

**Returns**: `void`  
**Side effects**:
- Removes `_shadowAttachHandler` listener if `root === document`.
- Filters `_stampQueue` to cancel any pending idle work for this root.
- Calls `disconnectObserver(root)`.
- Calls `removeRules(root)` and `removePickBlurRules(root)`.
- Single `querySelectorAll('*')` pass: clears `data-bl-si-blur` (except on PII elements, decrements `_blurredCount`), clears `data-bl-si-pick-blur`, collects shadow hosts.
- Removes SVG filter element (`#bl-si-svg-filters`) from root if present.
- Recurses into each collected shadow root.  

**Handles**: PII-stamped elements are not cleared — they survive a blur-all disable.

---

### isBlurred(element)
**What**: Returns `true` if the element is blurred by a data-attribute stamp OR by the always-blur CSS tag rules currently active.  
**Params**:  
- `element` (Element)  

**Returns**: `boolean`  
**Side effects**: none  
**Handles**:
- `null` / non-Element: returns `false`.
- Data-attribute check: `data-bl-si-blur` OR `data-bl-si-pick-blur` → `true`.
- Tag-rule check: if `isBlurAllActive()` and element's tag is in `selectorCache.alwaysBlurTags` → `true`.
- Does NOT include role-based CSS matches or PII elements — use `isVisuallyBlurred` for those.

---

### isVisuallyBlurred(element)
**What**: Returns `true` for everything `isBlurred` covers, PLUS elements blurred via role-based CSS selectors (e.g. `<div role="button">` under FORM), and PII-stamped elements.  
**Params**:  
- `element` (Element)  

**Returns**: `boolean`  
**Side effects**: none  
**Handles**:
- Includes `data-bl-si-pii` elements (`isBlurred` does not).
- Includes role-matched elements (checks `roleSet` against `element.getAttribute("role")`).
- Used exclusively by `reveal_controller` for ancestor/descendant walks — do NOT substitute for `isBlurred` in picker/context-menu paths. Role-matched elements have no stored item; routing them into unblur storage paths silently no-ops.

---

### matchesActiveCategories(element, categories)
**What**: Returns `true` if the element's tag or ARIA role matches any currently active blur category.  
**Params**:  
- `element` (Element)  
- `categories` (object) — `{ text, media, form, table, structure }` booleans. Falls back to `DEFAULT_CATS` if falsy.  

**Returns**: `boolean`  
**Side effects**: none (reads from `selectorCache` via `getSelectors`).

---

### shouldBlurElement(element, categories, thorough)
**What**: Returns `true` if the element should be blurred given current category settings and thorough mode, applying the text-content gate for text-check elements.  
**Params**:  
- `element` (Element)  
- `categories` (object) — blur category toggles. Falls back to `DEFAULT_CATS`.  
- `thorough` (boolean) — when `true`, bypasses text gate for non-structural text-check elements.  

**Returns**: `boolean`  
**Side effects**: none  
**Handles**:
- `null` / non-Element: returns `false`.
- Always-blur tags: returns `true` unconditionally.
- Text-check tags: returns `true` if `thorough` OR `hasMeaningfulTextContent`.
- Role-based (ARIA): treated as always-blur (no text gate). Checked after tag-based paths.

---

### stampElements(root, categories, thorough, mode)
**What**: Single `querySelectorAll('*')` pass over `root` that clears stale `data-bl-si-blur` stamps, stamps text-check and custom-element nodes that qualify, and collects discovered shadow roots for caller dispatch.  
**Params**:  
- `root` (Document | ShadowRoot | Element) — root to scan  
- `categories` (object) — blur category toggles  
- `thorough` (boolean) — bypass text gate for inline elements  
- `mode` (string) — current blur mode (passed for context; unused in stamp logic itself)  

**Returns**: `ShadowRoot[]` — shadow roots discovered during the pass  
**Side effects**:
- Deletes `data-bl-si-blur` from elements that carry it but don't qualify (stale clear), decrements `_blurredCount`.
- Sets `data-bl-si-blur="1"` on qualifying elements, increments `_blurredCount`.  

**Handles**:
- Custom elements (hyphenated tags): stamped if `structure` or `text` active and `thorough || hasMeaningfulTextContent`. Shadow root content handled separately via caller recursion.
- Structural containers (`div`, `section`, etc.): always require `hasMeaningfulTextContent` regardless of `thorough`.
- Elements already carrying `data-bl-si-pick-blur` or `data-bl-si-pii`: skipped (ownership guard).
- Extension UI elements: skipped via `_isExtensionUI`.
- Elements with `<slot>` descendants: stamped in non-structural path even without direct text (covers shadow DOM projection).
- PII-stamped elements (`data-bl-si-pii`): stale-clear skipped — PII owns its own lifecycle.

---

### tryBlurTextCheck(element, thorough)
**What**: Checks and stamps a single text-check element. Used by the MO idle callback for dynamically added elements.  
**Params**:  
- `element` (Element)  
- `thorough` (boolean) — bypass text gate for non-structural elements  

**Returns**: `void`  
**Side effects**: May set `data-bl-si-blur="1"`, increment `_blurredCount`.  
**Handles**: Same guards as `stampElements` text-check path: competing stamps, extension UI, tag membership, structural gate, slot check.

---

### injectRules(root, categories, mode)
**What**: Injects a `<style id="bl-si-blur-styles">` into `root` with CSS rules for all active blur categories and the current blur mode. Idempotent — calls `removeRules(root)` first.  
**Params**:  
- `root` (Document | ShadowRoot) — injection target; style goes to `root.head ?? root`  
- `categories` (object) — blur category toggles. Falls back to `DEFAULT_CATS`.  
- `mode` (string) — one of `blsi.blur_modes` (`'blur'`, `'frosted'`, `'redacted'`, `'censored'`)  

**Returns**: `void`  
**Side effects**:
- Calls `ensureSvgFilter(root)` for frosted mode.
- Calls `removeRules(root)` (replace semantics).
- Calls `_rebuildTextCheckSet(cats)`.
- Appends `<style>` containing: always-blur tag rules with `EXCLUDE` chain, `[data-bl-si-blur]` rule, media-element extras for redacted/censored modes, reveal override rules.
- For censored mode: prepends `blsi.Fonts.DISC_FONT_FACE` `@font-face` rule.  

**Handles**:
- Frosted: `filter: url(#bl-si-frosted-filter)` + transition.
- Redacted: `background-color: var(--bl-si-redaction-color)`, `color: transparent`, `filter: none`, `visibility: hidden` on media.
- Censored: `font-family: "bl-si-censored-disc"`, `filter: brightness(0)` on media.
- Default (blur): `filter: blur(var(--bl-si-radius, 10px))` + transition.
- Empty `alwaysBlurSelector` (all categories disabled): only `[data-bl-si-blur]` and reveal rules are emitted.
- Reveal override rules are injected after blur rules in same stylesheet so they win source-order tiebreak.

---

### removeRules(root)
**What**: Removes the `<style id="bl-si-blur-styles">` element injected by `injectRules`.  
**Params**:  
- `root` (Document | ShadowRoot) — same target used in `injectRules`  

**Returns**: `void`  
**Side effects**: Removes `<style>` from `root.head ?? root` if present. No-op if not found.

---

### injectPickBlurRules(root, type, color)
**What**: Injects a `<style id="bl-si-pick-blur-styles">` for the pick-and-blur mode override. No-op for the default `'blur'` type (covered by static `content.css`).  
**Params**:  
- `root` (Document | ShadowRoot) — injection target  
- `type` (string) — one of `blsi.pick_blur_modes` (`'blur'`, `'frosted'`, `'color'`)  
- `color` (object) — `{ hex: string, opacity: number }` for `'color'` type  

**Returns**: `void`  
**Side effects**: Calls `removePickBlurRules(root)`, then for frosted: `ensureSvgFilter(root)` + injects filter rule; for color: injects background-color rule for elements and separate `backdrop-filter` override for zone overlays.  
**Handles**: Returns early without injecting a style for `type === 'blur'` or falsy `type`.

---

### removePickBlurRules(root)
**What**: Removes the `<style id="bl-si-pick-blur-styles">` element from `root`.  
**Params**:  
- `root` (Document | ShadowRoot)  

**Returns**: `void`  
**Side effects**: Removes the style element if present. No-op otherwise.

---

### injectPiiRules(mode, color)
**What**: Injects a `<style id="bl-si-pii-styles">` into `document.head` for PII blur rendering. Idempotent — calls `removePiiRules()` first.  
**Params**:  
- `mode` (string) — one of `blsi.pii_modes` (`'blur'`, `'frosted'`, `'redacted'`, `'starred'`)  
- `color` (string | undefined) — hex color string for redacted mode (e.g., `'#ff0000'`). Falls back to `var(--bl-si-redaction-color, #000)` if invalid or absent.  

**Returns**: `void`  
**Side effects**:
- Calls `removePiiRules()`.
- For frosted: calls `ensureSvgFilter(document)`.
- For starred: prepends `blsi.Fonts.ASTERISK_FONT_FACE` `@font-face` rule.
- Appends `<style>` to `document.head` targeting `[data-bl-si-pii]:not([data-bl-si-reveal])` and reveal overrides.  

**Handles**:
- Returns early if `!document.head` (called before document ready).
- Validates `color` with `/^#[0-9a-fA-F]{6}$/` — invalid values fall back to CSS var.
- Only targets `document` — PII spans do not exist inside shadow roots.

---

### removePiiRules()
**What**: Removes the `<style id="bl-si-pii-styles">` element from `document.head`.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Removes style element if present. No-op if `document.head` is absent.

---

### isBlurAllActive()
**What**: Stateless DOM check for whether blur-all CSS rules are currently injected into `document.head`.  
**Params**: none  
**Returns**: `boolean` — `true` if `#bl-si-blur-styles` is present in `document.head`.  
**Side effects**: none  
**Handles**: Prefer `get isPageBlurred` (state-based) in most callers; `isBlurAllActive` is for callers that need DOM ground-truth (e.g., `isBlurred` when deciding if tag-rule coverage applies).

---

### ensureSvgFilter(root)
**What**: Creates (or replaces) the `<svg id="bl-si-svg-filters">` containing the `feGaussianBlur` + `feTurbulence` + `feDisplacementMap` filter definition for frosted glass mode.  
**Params**:  
- `root` (Document | ShadowRoot | null) — injection container; for `document`, appends to `document.body`; for shadow roots, appends to the root itself.  

**Returns**: `void`  
**Side effects**: Removes existing `#bl-si-svg-filters` element, creates new SVG and appends to container.  
**Handles**:
- Called before `document.body` exists: `container` is null/undefined → returns immediately (injectRules re-creates on next reconcile when body is ready).
- Always rebuilds rather than mutating `stdDeviation` in place — Chrome's filter cache does not reliably invalidate on in-place mutation.
- Reads `--bl-si-radius` from `:root` via `_readCssRadius()` for `stdDeviation`; falls back to `4` if not set or not a positive finite number.

---

### observeRoot(root)
**What**: Attaches a `MutationObserver` to `root` to stamp newly inserted text-check elements, activate newly attached shadow roots and iframes, and dispatch raw `MutationRecord[]` to registered subscribers. Idempotent.  
**Params**:  
- `root` (Document | ShadowRoot) — observation target; observer attaches to `root.body ?? root`  

**Returns**: `void`  
**Side effects**: Creates and starts a `MutationObserver` with config `{ childList: true, subtree: true, characterData: true }`; stores it in `_observers` (WeakMap). Observer callback defers all work to a single idle callback (`_drainMoIdle`) per batch.  
**Handles**:
- Already observed root: no-op (idempotency guard).
- `root.body` not yet mounted (shadow roots): observes `root` directly.
- MO callback maintains two independent buffers per tick:
  1. `_pendingMoNodes` — element-add nodes for the engine drain. Buffered only when `engineActive = !_pickerActive && (_isPageBlurred || _pickBlurDynamicActive)`.
  2. `_pendingMutations.get(root)` — raw `MutationRecord[]` for subscriber dispatch. Buffered whenever `_subscribers.size > 0`, regardless of picker / blur-all / pick-blur state. PII relies on this to keep wrapping typed text while the picker is open.
- MO callback returns early only when `!engineActive && !hasSubscribers`.
- Idle drain (`_drainMoIdle`):
  1. **Engine drain**: snapshot captures `blurAllOn = _isPageBlurred` and `pickBlurOn = _pickBlurDynamicActive`. For each node and its children: calls `tryBlurTextCheck` when `blurAllOn`; calls `_tryPickBlurNode` when `pickBlurOn`; calls `handleShadowRoot` / `handleIframe` only when `blurAllOn`. Deduplicates ancestor/descendant pairs in the same batch.
  2. **Subscriber dispatch**: for each `(root, MutationRecord[])` bucket, invokes registered handlers in registration order. Errors are caught per subscriber via `try/catch` and routed through `blsi.Logger.scope('engine').error` so one failing subscriber cannot stall others.
- `teardown(root)` deletes the root's entry from `_pendingMutations` so subscribers do not receive records for a torn-down root.

---

### subscribeMutations(name, handler)
**What**: Registers a subscriber to receive raw `MutationRecord[]` per root inside the engine's idle drain. Subscribers never own observers themselves.  
**Params**:
- `name` (string) — idempotent registration key (e.g. `'pii'`). Re-registering the same name replaces the prior handler.
- `handler` (function) — `(mutations: MutationRecord[], root: Document|ShadowRoot) => void`. Invoked AFTER the engine's stamp / pick-blur / shadow / iframe pass for that batch.

**Returns**: `void`  
**Side effects**: Inserts an entry into `_subscribers` (insertion-ordered `Map`).  
**Handles**:
- Non-string / empty `name`: no-op (silent reject).
- Non-function `handler`: no-op (silent reject).
- Subscribers are invoked in registration order across all roots' buckets.

---

### unsubscribeMutations(name)
**What**: Removes a registered subscriber.  
**Params**: `name` (string)  
**Returns**: `void`  
**Side effects**: `_subscribers.delete(name)`. No-op if not present.

---

### handleShadowRoot(settings, shadowRoot)
**What**: Applies or removes blur for one shadow root. Active path: injects rules and starts observer immediately (synchronous), then queues stamp work for idle.  
**Params**:  
- `settings` (object) — resolved settings snapshot (same shape as `handleSite`)  
- `shadowRoot` (ShadowRoot) — the shadow root to handle  

**Returns**: `void`  
**Side effects**:
- Active path: `injectRules(shadowRoot, ...)`, `observeRoot(shadowRoot)`, pushes to `_stampQueue`, calls `_scheduleStampIdle()`.
- Inactive path: `teardown(shadowRoot)`.  

**Handles**: `settings.enabled === false` or `!blur_all_active` → inactive path.

---

### handleIframe(settings, iframeEl)
**What**: Stamps or unstamps a cross-origin `<iframe>` element as a blur black-box. Same-origin iframes are skipped (their own `content_script` handles blur via `all_frames: true`).  
**Params**:  
- `settings` (object) — resolved settings snapshot  
- `iframeEl` (HTMLIFrameElement)  

**Returns**: `void`  
**Side effects**: Sets or removes `data-bl-si-blur="1"` on `iframeEl`, adjusts `_blurredCount`.  
**Handles**:
- `null` or extension UI element: early return.
- Same-origin detection: wraps `!!iframeEl.contentDocument` in try/catch; skips on `true`.
- Active: stamps if not already stamped. Inactive: removes stamp if present.

---

### createZoneOverlay(zoneData)
**What**: Creates and appends a sticky zone overlay `<div>` to `document.body`.  
**Params**:  
- `zoneData` (object) — `{ id: string, name?: string, anchor?: 'page'|'screen', x: number, y: number, width: number, height: number }`  

**Returns**: `HTMLElement | null` — the created overlay element, or `null` if `zoneData.id` is missing or `document.body` is not ready.  
**Side effects**:
- Removes existing overlay with same id (idempotent replace).
- Sets `class="bl-si-zone-overlay"`, `data-bl-si-zone=id`, `data-bl-si-zone-name`, `data-bl-si-zone-anchor`, `data-bl-si-pick-blur="1"`.
- Applies `position: absolute` (page anchor) or `position: fixed` (screen anchor) with raw pixel coordinates.
- Stores in `_zoneOverlays` map.

---

### removeZoneOverlay(zoneId)
**What**: Removes the zone overlay `<div>` identified by `zoneId` from DOM and internal tracking.  
**Params**:  
- `zoneId` (string)  

**Returns**: `void`  
**Side effects**: Removes element from DOM (if attached), deletes entry from `_zoneOverlays`.

---

### getZoneOverlays()
**What**: Returns an array of all active zone overlay DOM elements.  
**Params**: none  
**Returns**: `HTMLElement[]`  
**Side effects**: none

---

### highlightItem(item)
**What**: Adds the `bl-si-hover-highlight` class to the DOM element corresponding to a blur item (dynamic or sticky), and scrolls it into view.  
**Params**:  
- `item` (object) — blur item with `item_type` (`'dynamic'` or `'sticky'`), `selectors`, `selector`, `name`, and/or `id` fields  

**Returns**: `void`  
**Side effects**:
- Removes highlight from previously highlighted element (`_highlightedEl`).
- Dynamic: tries `SelectorUtils.restoreSelector(item.selectors)`, fallback to `[data-bl-si-pick-blur-name="..."]` query, fallback to selector intersection across stamped elements.
- Sticky: looks up via `_zoneOverlays.get(item.id)`.
- Adds `bl-si-hover-highlight` class, calls `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`.
- Updates `_highlightedEl`.  

**Handles**: No-op if element cannot be resolved.

---

### clearItemHighlight()
**What**: Removes the `bl-si-hover-highlight` class from the currently highlighted element.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Removes class from `_highlightedEl`, sets `_highlightedEl = null`.

---

### resetCounters()
**What**: Resets `_elementCounter`, `_pageAreaCounter`, and `_screenAreaCounter` to zero.  
**Params**: none  
**Returns**: `void`  
**Side effects**: All three counters zeroed. Call once on init before item restore; picker uses `allocate*Name` afterward.

---

### allocateElementName()
**What**: Increments `_elementCounter` and returns the next element (dynamic) item name.  
**Params**: none  
**Returns**: `string` — e.g., `"Element 1"`, `"Element 2"`, …  
**Side effects**: Increments `_elementCounter`.

---

### allocateStickyName(anchor)
**What**: Increments the appropriate area counter and returns the next zone item name matching the picker UI label.  
**Params**:  
- `anchor` (`'page'` | `'screen'` | undefined) — zone anchor type. Defaults to `'page'` when missing.  

**Returns**: `string` — `"Area on page N"` when anchor is `'page'` (or absent); `"Area on screen N"` when anchor is `'screen'`.  
**Side effects**: Increments `_pageAreaCounter` (page path) or `_screenAreaCounter` (screen path).

---

### _setPickerActiveForObserver(v)
**What**: Sets the `_pickerActive` gate used by the MutationObserver callback.  
**Params**:  
- `v` (boolean) — `true` to silence MO stamping while picker is active  

**Returns**: `void`  
**Side effects**: Sets `_pickerActive = !!v`. When `true`, the MO callback returns immediately without stamping new nodes.  
**Note**: Must be called via `content_script.setPickerActive()` helper, not directly — that helper also updates `Shortcuts._setPickerActive` and `Picker`.

---

### get isPageBlurred
**What**: Getter returning the module's current blur-all active state.  
**Returns**: `boolean`  
**Side effects**: none  
**Note**: Prefer this over `isBlurAllActive()` (DOM check) in callers that trust engine state.

---

### get blurredCount
**What**: Getter returning the running count of elements carrying `data-bl-si-blur`.  
**Returns**: `number` — O(1), maintained by stamp/clear operations  
**Side effects**: none

---

### CATEGORY_SELECTORS
**What**: Frozen constant exposing the per-category element lists.  
**Type**: `{ text, media, form, table, structure }` — each value is `{ alwaysBlur: string[], textCheck: string[], roles?: string[] }`  
**Usage**: Read-only. Consumed by `buildSelectors` and exported for unit tests and CLAUDE.md documentation. Do not mutate at runtime.

---

## Internal Functions

### buildSelectors(categories)
**What**: Constructs selector strings and tag/role sets from the active category toggles. Result is cached by `getSelectors`.  
**Params**: `categories` (object) — blur category toggles  
**Returns**: `{ key, alwaysBlurSelector, textCheckSelector, alwaysBlurTags, textCheckTags, tagSet, roleSet }`  
- `key`: 5-char string of `'0'`/`'1'` (category order: text/media/structure/form/table)
- `alwaysBlurSelector`: comma-joined CSS selector string for always-blur tags + role attribute selectors
- `textCheckSelector`: comma-joined tag selector for text-check tags
- `tagSet`: `Set<string>` of all tag names (both alwaysBlur + textCheck) for O(1) lookup
- `roleSet`: `Set<string>` of ARIA role values  

**Side effects**: none

---

### getSelectors(categories)
**What**: Returns `buildSelectors` result, using `selectorCache` if the category key matches.  
**Params**: `categories` (object)  
**Returns**: Same shape as `buildSelectors`  
**Side effects**: May update `selectorCache`.

---

### _rebuildTextCheckSet(categories)
**What**: Rebuilds `_textCheckSet` from active category textCheck lists if the category key has changed. No-op on same-key call.  
**Params**: `categories` (object | null) — falls back to `DEFAULT_CATS`  
**Side effects**: Updates `_textCheckSet` and `_lastTextCheckKey`.

---

### hasMeaningfulTextContent(element)
**What**: Returns `true` if the element has at least one direct text node child with non-empty trimmed content.  
**Params**: `element` (Element)  
**Returns**: `boolean`  
**Side effects**: none  
**Note**: Checks only direct child text nodes (not descendants). Prevents structural containers from being stamped just because a deeply nested child has text.

---

### _isExtensionUI(element)
**What**: Returns `true` if the element is part of the extension's own UI (toolbar, toast, zone overlay) and should never be blurred.  
**Params**: `element` (Element)  
**Returns**: `boolean`  
**Handles**: Checks `id === picker_toolbar`, `.closest("#" + picker_toolbar)`, toast class, toolbar class, and `data-bl-si-zone` attribute presence.

---

### _readCssRadius()
**What**: Reads `--bl-si-radius` from `:root` inline style and returns the numeric pixel value.  
**Returns**: `number | null` — positive finite number, or `null` if not set or invalid.  
**Side effects**: none

---

### _colorToRgba(color)
**What**: Converts a `{ hex, opacity }` color object to an `rgba(...)` CSS string.  
**Params**: `color` (object | null) — `{ hex: string, opacity: number }`  
**Returns**: `string` — `rgba(r,g,b,a)`  
**Handles**: `null` / missing hex → returns `'rgba(0,0,0,1)'`.

---

### _itemId(item)
**What**: Returns the canonical identity key for an item used as the `_activeItems` Map key.  
**Params**: `item` (object)  
**Returns**: `string | undefined` — for dynamic: `item.selectors[0] ?? item.selector`; for sticky: `item.id`.

---

### _applyDynamicItem(item)
**What**: Restores a dynamic pick-and-blur item to the DOM by stamping `data-bl-si-pick-blur="1"` on the target element.  
**Params**: `item` (object) — `{ selectors, selector, name, type: 'dynamic' }`  
**Side effects**: Stamps `data-bl-si-pick-blur` and `data-bl-si-pick-blur-name`; updates `_elementCounter` high-water mark from `item.name`. Parses both `"Element N"` (new) and `"Dynamic N"` (legacy) name formats.  
**Handles**: Element not found → no stamp, counter still updated if name parses.

---

### _tryPickBlurNode(el)
**What**: Checks a single newly-inserted element against all active dynamic pick-blur items and stamps it if a unique selector match is found. Called by the MO idle drain for late-loading element detection.  
**Params**: `el` (Element | any) — the element to check  
**Returns**: `void`  
**Side effects**: May set `el.dataset.blSiPickBlur = '1'` on a match (returns immediately after first match — no double-stamp).  
**Handles**:
- Non-Element or missing `el`: early return (no-op).
- Element already carrying `data-bl-si-pick-blur`: idempotency guard — skipped.
- Extension UI elements (`_isExtensionUI`): skipped.
- For each dynamic item: tries each selector in `item.selectors` (or `[item.selector]`) via `el.matches(sel)` (O(1) CSS engine); if matched, confirms uniqueness via `document.querySelectorAll(sel).length === 1` before stamping. Invalid selectors are silently swallowed (try/catch).
- Only matches dynamic items (`item.type === 'dynamic'`) — sticky items have zone overlays, not element stamps.

---

### _removeDynamicItem(item)
**What**: Removes `data-bl-si-pick-blur` and `data-bl-si-pick-blur-name` from a dynamic item's element.  
**Side effects**: Deletes both dataset keys.  
**Handles**: Stale selector (SPA position shift): fallback to `[data-bl-si-pick-blur-name="..."]` query.

---

### _applyStickyItem(item)
**What**: Creates a zone overlay for a sticky item, applying xPct/yPct re-projection when viewport width has changed.  
**Params**: `item` (object) — `{ id, name, anchor, x, y, width, height, xPct, yPct, widthPct, scrollWidth }`  
**Side effects**: Calls `createZoneOverlay(...)`, updates `_pageAreaCounter` or `_screenAreaCounter` high-water mark based on name prefix. Parses `"Area on page N"`, `"Area on screen N"` (new) and `"Sticky N"` (legacy → page counter).  
**Handles**:
- Width re-projection: if `scrollWidth` changed >1% or 10px, uses `xPct * curW` and `widthPct * curW`. Y/height never re-projected (page height varies during load).
- `anchor === 'screen'`: raw x/y used directly.

---

### _removeStickyItem(item)
**What**: Removes the zone overlay for a sticky item.  
**Params**: `item` (object) — must have `item.id`  
**Side effects**: Calls `removeZoneOverlay(item.id)`.

---

### applyItem(item)
**What**: Dispatches to `_applyDynamicItem` or `_applyStickyItem` based on `item.type`.  
**Params**: `item` (object)  
**Side effects**: Delegates.

---

### removeItem(item)
**What**: Dispatches to `_removeDynamicItem` or `_removeStickyItem` based on `item.type`.  
**Params**: `item` (object)  
**Side effects**: Delegates.

---

### _reconcileItems(desired)
**What**: Diffs `desired` items against `_activeItems` and applies/removes the delta.  
**Params**: `desired` (Array) — desired blur items from resolved settings  
**Returns**: `{ added: number, removed: number }`  
**Side effects**: Calls `removeItem` for stale items, `applyItem` for new items, updates `_activeItems` Map. Sets `_pickBlurDynamicActive = desiredArray.some(i => i.type === 'dynamic')` after reconcile — drives the MO gate for pick-blur-only users.  
**Handles**: Non-array `desired` treated as empty array.

---

### handleMainDocument(settings)
**What**: Applies or tears down blur for the main document. CSS injection is synchronous; stamp work is deferred to `requestIdleCallback`.  
**Params**: `settings` (object) — resolved settings snapshot  
**Side effects**:
- Inactive path (`!active`): `teardown(document)`.
- Active path: `injectRules(document, ...)`, `observeRoot(document)`, `_initShadowAttachListener()`, replaces `_stampQueue` with a new entry for `document`, calls `_scheduleStampIdle()`.  

**Note**: Does NOT set `_isPageBlurred` — that is `handleSite`'s responsibility.

---

### _applyCssVars(settings)
**What**: Sets the four CSS custom properties on `:root` that all blur CSS rules reference.  
**Params**: `settings` (object) — must have `blur_radius`, `highlight_color`, `transition_duration`, `redaction_color`  
**Side effects**: Calls `document.documentElement.style.setProperty(...)` for each var. No-op if `document.documentElement` is absent.

---

### _scheduleIdle(fn)
**What**: Calls `requestIdleCallback(fn, { timeout: 300 })` when available; falls back to `setTimeout(fn, 0)`.  
**Params**: `fn` (function) — callback  
**Side effects**: Schedules callback.

---

### _scheduleStampIdle()
**What**: Schedules `_flushStampQueue` via `_scheduleIdle` if not already pending.  
**Side effects**: Sets `_stampIdlePending = true`. No-op if already pending.

---

### _flushStampQueue(deadline)
**What**: Processes entries in `_stampQueue` one by one, calling `stampElements` for each. For discovered shadow roots, immediately injects rules and observes before pushing to the queue.  
**Params**: `deadline` (IdleDeadline | undefined)  
**Side effects**:
- Calls `stampElements(root, ...)` for each queue entry.
- For discovered shadow roots: `injectRules(sr, ...)`, `observeRoot(sr)`, pushes new entry to `_stampQueue`.
- Re-schedules via `_scheduleStampIdle()` if `deadline.timeRemaining() < 1` mid-queue.

---

### _initShadowAttachListener()
**What**: Registers a capture-phase listener on `document` for `__blsi_shadow_attached` CustomEvents fired by `main_world_bridge.js` when a page calls `Element.prototype.attachShadow()`. Idempotent.  
**Side effects**: Attaches listener, stores reference in `_shadowAttachHandler`.  
**Handles**: MutationObserver `childList+subtree` does not fire for `attachShadow()` — this listener bridges the gap so late-attached shadow roots are discovered and blurred.

---

### _removeShadowAttachListener()
**What**: Removes the `__blsi_shadow_attached` listener registered by `_initShadowAttachListener`.  
**Side effects**: Removes listener, sets `_shadowAttachHandler = null`.

---

### disconnectObserver(root)
**What**: Disconnects and removes the `MutationObserver` for `root`.  
**Params**: `root` (Document | ShadowRoot)  
**Side effects**: Calls `obs.disconnect()`, deletes entry from `_observers`. No-op if no observer is tracked for `root`.

---

## Invariants

1. **`handleSite` is the sole entry point for production callers.** `content_script.js` must always call `handleSite`; calling lower-level functions (`injectRules`, `stampElements`, etc.) directly bypasses the mutex, reconcile-key check, and CSS var write.

2. **Every `handleSite` call must be awaited.** Fire-and-forget invocations let concurrent `onChange` events interleave two reconciles that corrupt `_activeItems`.

3. **`_isPageBlurred` is set only by `handleSite`.** No other function sets it directly.

4. **`data-bl-si-pii` elements are never touched by blur-engine teardown or stamp-clear paths.** PII detector owns their lifecycle — blur-engine skips them in `teardown` and `stampElements`.

5. **EXCLUDE chain must include every competing blur attribute.** Any new attribute system that blurs elements independently must add `:not([data-attr])` to `EXCLUDE` AND a guard in `stampElements` / `tryBlurTextCheck`. Without both, blur-all CSS wins over the competing system due to tag-rule specificity `(0,7,1)` vs attribute specificity `(0,3,0)`.

6. **`selectorCache` and `_textCheckSet` are single-slot caches keyed by category toggle string.** They auto-rebuild on key mismatch. Callers must not cache references to their internals across category-change events.

7. **Zone overlay elements carry `data-bl-si-zone` attribute.** `_isExtensionUI` uses this to exclude them from being treated as blur targets. Zone overlays also carry `data-bl-si-pick-blur` to receive pick-blur CSS styling.

8. **Reveal override rules must be injected after blur rules in the same `<style>` block.** Source-order wins for `!important` at equal specificity. Both the injected `<style>` and the static `content.css` copies are required: the static copy handles reveal when blur-all is OFF; the injected copy handles reveal when blur-all is ON.

9. **`injectRules` is stateless with respect to root type.** It uses `root.head ?? root` uniformly — no branching on whether root is `document` or a `ShadowRoot`. This allows identical calls from `_flushStampQueue` for shadow roots.

10. **Counter seeding happens inside `_applyDynamicItem` / `_applyStickyItem`.** Callers only need `resetCounters()` once at init; counters self-seed from item names during restore so subsequent `allocate*Name` calls never produce collisions. Both new-format (`"Element N"`, `"Area on page N"`, `"Area on screen N"`) and legacy (`"Dynamic N"`, `"Sticky N"`) names are parsed for backward compatibility.

11. **`_pickerActive = true` silences the engine drain only — subscribers still receive mutations.** New DOM nodes inserted while the picker is active are not stamped, but registered subscribers (PII detector, future modules) continue to receive raw `MutationRecord[]` so PII keeps wrapping typed text while the picker is open. The picker gate must be toggled via `_setPickerActiveForObserver` through `content_script.setPickerActive`.

12. **Frosted mode requires a fresh `ensureSvgFilter` call whenever radius or mode changes.** In-place mutation of `feGaussianBlur.stdDeviation` does not reliably invalidate Chrome's filter cache. The reconcile key folds `blur_radius` into itself only when `blur_mode === 'frosted'` to force a filter rebuild on radius change in that mode.

13. **`_stampQueue` is replaced, not appended, on every new `handleMainDocument` call.** The pending idle always picks up the latest queue. `teardown()` filters out entries for its root to prevent stale idle work from re-stamping after cleanup.

14. **`data-bl-si-pick-blur` is the sole attribute for pick-and-blur and zone overlays.** It is in the EXCLUDE chain and the stamp ownership guard. Zone overlays use it to receive pick-blur CSS without colliding with blur-all stamping.
