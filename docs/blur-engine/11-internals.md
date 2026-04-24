# Blur Engine — Internals

This document covers the private internal anatomy of `src/blur_engine.js`: the IIFE structure, all closure-scoped state variables, private helper functions, the selector cache, CSS class constants, and the naming-counter system. Read this before digging into the orchestration or stamping docs — this is the vocabulary the other documents reference.

---

## IIFE Structure

The entire engine is an Immediately Invoked Function Expression (IIFE). Nothing leaks to the global scope except the final assignment:

```js
const BlurEngine = (() => {
  "use strict";

  // ─── private constants, state, helpers ───
  // ...

  // ─── public API object ───
  return {
    handleSite,
    injectRules,
    applyBlur,
    // ...
  };
})();

blsi.BlurEngine = BlurEngine;
```

**Why this pattern:**
- `"use strict"` inside the IIFE applies strict mode without affecting the global scope.
- All internal state (`_isPageBlurred`, `_observers`, `_handling`, counters, the stamp queue) is completely private — no external code can corrupt them.
- A single export (`blsi.BlurEngine`) is assigned at the very end, consistent with the project-wide IIFE convention.

**Module dependencies (implicit global reads):**
The engine reads these globals that must be loaded before `blur_engine.js` in the manifest:
- `blsi.ids.svg_filters` — SVG filter element ID string
- `blsi.ids.picker_toolbar` — picker toolbar DOM ID
- `blsi.css.*` — CSS class name strings (zone_overlay, toast, toolbar, etc.)
- `blsi.DEFAULT_MODEL.settings.blur_categories` — fallback categories
- `blsi.blur_modes.*` / `blsi.pick_blur_modes.*` / `blsi.pii_modes.*` — mode enum strings
- `blsi.SelectorUtils.restoreSelector()` — selector-to-element restoration
- `blsi.Fonts.*` — embedded font face strings (DISC_FONT_FACE, ASTERISK_FONT_FACE)
- `blsi.Logger` — optional flow logger

---

## CSS Style Element IDs

Three distinct `<style>` elements are managed by the engine. Each has a hard-coded `id`:

```js
const SVG_FILTER_ID = blsi.ids.svg_filters;   // "bl-si-svg-filters"
const STYLE_ID      = "bl-si-blur-styles";     // injected blur-all rules
const PICK_STYLE_ID = "bl-si-pick-blur-styles";// injected pick-blur rules (non-gaussian only)
const PII_STYLE_ID  = "bl-si-pii-styles";      // injected PII rules
```

The PII style ID is defined as a `const` inside the PII section of the IIFE:
```js
const PII_STYLE_ID = "bl-si-pii-styles";
```

These IDs serve two purposes:
1. **Idempotent injection** — `injectRules` calls `removeRules` first (which queries by ID), so injecting twice never creates duplicate `<style>` elements.
2. **DOM probing** — `isBlurAllActive()` detects whether blur-all CSS is live by querying `document.head` for `#bl-si-blur-styles`. This is a stateless DOM check, independent of `_isPageBlurred`.

---

## Internal State Variables

All state lives in closure scope. No external code can read or write these directly.

### `_isPageBlurred` — `boolean`
Whether blur-all is currently active for this page. Managed exclusively by `handleSite()`. Read by the `isPageBlurred` getter and by the MutationObserver callback gate (`if (!_isPageBlurred) return`).

Set to `true` when `settings.blur_all_active === true` inside `handleSite`. Set to `false` in the disabled path and when blur-all becomes inactive.

**Do not confuse with `isBlurAllActive()`**, which is a DOM check (does `#bl-si-blur-styles` exist?). Both typically agree but can briefly diverge during async transitions.

---

### `_handling` — `boolean` (mutex)
Prevents concurrent `handleSite()` invocations from interleaving DOM mutations. Pattern:

```js
async function handleSite(settings) {
  if (_handling) return;  // drop concurrent call
  _handling = true;
  try {
    // ... all work ...
  } finally {
    _handling = false;
  }
}
```

If a storage onChange fires while a previous `handleSite` is still running (async storage write + DOM work), the new call is dropped. The `_currentSettings` snapshot is updated first, so the in-flight MO callback still reads fresh settings even if the concurrent call is dropped.

---

### `_currentSettings` — `object | null`
A snapshot of the settings object from the most recent `handleSite()` call. The MutationObserver callback reads this on every idle flush:

```js
const thorough = _currentSettings ? !!_currentSettings.thorough_blur : false;
```

**Why stored here instead of captured in closure:** If settings change between a mutation event and the idle callback executing, the idle should use the *new* settings, not the stale closure-captured ones. `_currentSettings` is always the latest snapshot.

Set at the very top of `handleSite()` before any async work, so MO callbacks during the idle phase see the right settings:
```js
_currentSettings = settings;  // updated FIRST
```

---

### `_lastReconcileKey` — `string | null`
A fingerprint of the last inputs that caused a page-wide DOM rebuild. Lets `handleSite()` skip the nuke-and-rescan when only CSS-var-propagated properties change.

Structure:
```js
const reconcileKey = isActive
  ? `${settings.blur_mode}|${JSON.stringify(settings.blur_categories)}|${settings.thorough_blur}|${settings.blur_mode === blsi.blur_modes.frosted ? settings.blur_radius : ''}`
  : 'inactive';
```

**What's included:**
- `blur_mode` — switching modes (gaussian → frosted) requires rebuilding CSS and SVG filter
- `blur_categories` — toggling a category (e.g., form OFF) requires new CSS selectors
- `thorough_blur` — toggling thorough mode changes which elements get stamped
- `blur_radius` (frosted only) — frosted mode's radius lives in SVG `stdDeviation`, not a CSS var, so changing it requires a filter rebuild

**What's excluded:**
- `blur_radius` in gaussian mode — the CSS var `--bl-si-radius` propagates instantly at paint time; no DOM work needed
- `highlight_color`, `transition_duration`, `redaction_color` — CSS var only, no DOM work

Set to `null` on extension disable or full teardown, forcing a fresh reconcile on re-enable.

---

### `_activeItems` — `Map<string, item>`
Tracks currently-applied blur items (dynamic picker blurs + sticky zone overlays). Keys are item IDs:
- Dynamic items: keyed by `item.selectors[0]` (the primary CSS selector string)
- Sticky items: keyed by `item.id` (a unique `s_` + hex string)

Used by `_reconcileItems()` to diff desired items (from storage) against applied items:
- Items in desired but not in `_activeItems` → `applyItem(item)` + add to map
- Items in `_activeItems` but not in desired → `removeItem(item)` + delete from map

Persists across `handleSite()` calls. Only cleared by `_reconcileItems([])` (disabled path).

---

### `_observers` — `WeakMap<root, MutationObserver>`
One `MutationObserver` per active root (document + every shadow root). The WeakMap key is the root itself (either `document` or a `ShadowRoot` instance).

**WeakMap auto-GC:** When a shadow host is removed from DOM and GC'd (no other references), the WeakMap entry for its shadow root is automatically removed. No explicit cleanup needed for detached shadow roots.

Manual cleanup still happens in `teardown(root)` via `disconnectObserver(root)` for the actively-managed case (blur-all turned off). But for shadow roots that just disappear from DOM naturally, the GC handles it.

---

### `_handling` — `boolean`
Documented above (mutex). Initialized to `false`.

---

### `_dynamicCounter` — `integer`
High-water mark for "Dynamic N" item names. Seeded from existing items when `applyItem()` processes each dynamic item:

```js
const num = parseInt((item.name || "").replace("Dynamic ", ""), 10);
if (!isNaN(num) && num > _dynamicCounter) _dynamicCounter = num;
```

So if storage contains items named "Dynamic 2" and "Dynamic 5", after applying both, `_dynamicCounter` is `5`. The next `allocateDynamicName()` call returns `"Dynamic 6"`.

Reset to `0` by `resetCounters()`, which content_script calls once during `init()` before `applyState()`.

---

### `_stickyCounter` — `integer`
Same pattern as `_dynamicCounter` but for "Sticky N" zone overlay names. Seeded from `item.name.replace("Sticky ", "")`.

---

### `_pickerActive` — `boolean`
When `true`, the MutationObserver callback early-returns without processing mutations. Prevents the MO from blurring picker hover previews or context menus that appear while the user is picking an element.

Set by `_setPickerActiveForObserver(bool)`, which is called from `content_script.setPickerActive()` — the single source of truth that synchronizes all three picker-active flags (content_script, shortcut_handler, blur_engine).

---

### `_stampQueue` — `Array<{root, cats, thorough, mode, settings}>`
Work items for the idle stamp queue. Each item describes one root that needs a `stampElements()` pass. The queue is flushed by `_flushStampQueue()` when `requestIdleCallback` fires.

**Queue replacement, not append:** On every `handleMainDocument()` call (page-wide reconcile), the queue is *replaced*:
```js
_stampQueue = [{ root: document, cats, thorough, mode, settings }];
```

This prevents stale work from a previous reconcile from running after new settings arrive.

For shadow roots discovered during a stamp pass, they are *appended* to the queue (since they are new discoveries, not replacements of existing work):
```js
_stampQueue.push({ root: sr, cats, thorough, mode, settings });
```

`teardown(root)` filters the queue to remove any items for the being-torn-down root:
```js
_stampQueue = _stampQueue.filter(item => item.root !== root);
```

---

### `_stampIdlePending` — `boolean`
Guards against scheduling multiple idle callbacks for the same stamp queue. `_scheduleStampIdle()` is a no-op if this is already `true`.

---

### `_pendingMoNodes` — `Array<Element>`
Nodes collected synchronously by the MutationObserver callback, awaiting processing in the next idle callback. Multiple MO firings between idle ticks accumulate here; one idle processes the entire batch.

---

### `_moIdlePending` — `boolean`
Same guard as `_stampIdlePending` but for the MO idle callback. Prevents multiple idle requests for the same batch.

---

### `_zoneOverlays` — `Map<string, HTMLElement>`
Active zone overlay DOM elements, keyed by zone ID. Regular `Map` (not WeakMap) because zone elements must be explicitly tracked for `removeZoneOverlay()` and `getZoneOverlays()`. Manually cleared by `removeAllZoneOverlays()`.

---

### `selectorCache` — `object | null`
Cached result of `buildSelectors(categories)` for the current category toggle combination. Invalidated automatically when the category key changes:

```js
function getSelectors(categories) {
  const key = CATEGORY_ORDER.map(n => categories[n] ? "1" : "0").join("");
  if (selectorCache && selectorCache.key === key) return selectorCache;
  selectorCache = buildSelectors(categories);
  return selectorCache;
}
```

Cache content:
```js
{
  key: "11011",                         // binary toggle string
  alwaysBlurSelector: "h1,h2,...",     // CSS selector string for always-blur tags + roles
  textCheckSelector: "span,a,...",     // CSS selector string for text-check tags
  alwaysBlurTags: ["h1", "h2", ...],  // array (for isBlurred O(n) tag walk)
  textCheckTags: ["span", "a", ...],   // array
  tagSet: Set<string>,                 // O(1) tag membership check
  roleSet: Set<string>,                // O(1) role membership check (ARIA roles from FORM)
}
```

---

### `_textCheckSet` — `Set<string>`
Set of tag names that require text-check stamping (built from `CATEGORY_SELECTORS[name].textCheck`). Used by `tryBlurTextCheck()` for O(1) tag lookup in the MO idle callback. Rebuilt by `_rebuildTextCheckSet(categories)` on every `injectRules()` or `stampElements()` call.

---

### `_structuralTags` — `Set<string>` (constant)
Set of structural container tag names (`div`, `section`, `article`, `aside`, `header`, `footer`, `figure`, `details`, `dialog`) derived from `CATEGORY_SELECTORS.structure.textCheck`. These tags always require the `hasMeaningfulTextContent` gate, even in thorough mode.

**Why:** Structural containers group content. Blurring them creates a parent `filter` which composites the entire subtree — child `filter: none` cannot pierce through a parent `filter`. This makes hover reveal fail for children inside a blurred container. So containers are only blurred if they have *direct* text content (not just child element content).

`li`, `dt`, `dd` were moved to `alwaysBlur` (not `textCheck`) so CSS injection covers `::marker` pseudo-elements. A JS-gated stamp would leave list markers visible while blurring the item content.

---

## Private Helper Functions

### `hasMeaningfulTextContent(element)` — lines 221–231

```js
function hasMeaningfulTextContent(element) {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
      return true;
    }
  }
  return false;
}
```

Checks whether the element has any direct text-node children with non-whitespace content. Only checks *direct* children — not descendants. This is intentional: if text is inside a child `<span>`, the `<span>` should be stamped, not the parent container.

---

### `_readCssRadius()` — lines 235–241

```js
function _readCssRadius() {
  const v = document.documentElement.style
    .getPropertyValue("--bl-si-radius")
    .trim();
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
```

Reads `--bl-si-radius` from `:root` inline style (not computed style — content_script sets it as an inline style property). Returns a finite positive number or `null`. Used only by `ensureSvgFilter()` to set `feGaussianBlur.stdDeviation` — because frosted mode's radius lives in the SVG attribute, not a CSS var.

---

### `_isExtensionUI(element)` — lines 602–612

```js
function _isExtensionUI(element) {
  const toolbarId = blsi.ids.picker_toolbar;
  return (
    element.id === toolbarId ||
    element.closest("#" + toolbarId) ||
    element.classList.contains(blsi.css.toast) ||
    element.closest("." + blsi.css.toast) ||
    element.classList.contains(blsi.css.toolbar) ||
    element.dataset.blSiZone !== undefined
  );
}
```

Returns `true` for elements that are part of the extension's own UI. Called in three places:
1. `stampElements()` — skip blurring extension UI during the full-page stamp pass
2. `tryBlurTextCheck()` — skip dynamically added extension UI (e.g., toast notifications)
3. `applyBlur()` — prevent context menu "blur this" from blurring the picker toolbar itself

Zone overlays (`data-bl-si-zone !== undefined`) are excluded because they are visually-blur-styled divs appended to `document.body` — without exclusion, the MO callback would try to stamp them during the idle pass.

---

### `_colorToRgba(color)` — lines 616–624

```js
function _colorToRgba(color) {
  if (!color || !color.hex) return 'rgba(0,0,0,1)';
  const hex = color.hex.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = typeof color.opacity === 'number' ? color.opacity : 1;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
```

Converts a `{ hex: '#RRGGBB', opacity: 0–1 }` color object to an `rgba(...)` string for use in CSS rules. Used by `injectPickBlurRules()` for pick-blur color mode.

---

### `_itemId(item)` — lines 960–964

```js
function _itemId(item) {
  return item && item.type === "dynamic"
    ? (item.selectors ? item.selectors[0] : item.selector)
    : item && item.id;
}
```

Computes the Map key for `_activeItems`. Dynamic items use their primary CSS selector (first entry in `selectors[]`); sticky items use `item.id`.

---

### `buildSelectors(categories)` and `getSelectors(categories)` — lines 145–195

`buildSelectors` constructs the selector strings and sets from the `CATEGORY_SELECTORS` data shape. It:
1. Iterates `CATEGORY_ORDER` (text, media, structure, form, table) respecting the toggle flags
2. Collects `alwaysBlur` tags and `textCheck` tags into separate arrays
3. Collects `roles` from categories that define them (currently only FORM)
4. Builds role selectors as `[role="button"]` attribute selector strings
5. Joins them into `alwaysBlurSelector` (tag list + role list)
6. Returns all arrays, strings, and sets

`getSelectors` wraps `buildSelectors` with a key-based cache. Cache key is the binary toggle string (`"11011"` for text+media+structure+table with form off). Returns the cached object on hit; rebuilds on miss.

---

## Public API Object

The returned object from the IIFE exposes:

**Orchestration:**
- `handleSite(settings)` — primary entry point; all production callers use this
- `handleDocument(settings, root)` — thin router, backward compat / tests
- `handleMainDocument(settings)` — document-scoped blur lifecycle
- `handleShadowRoot(settings, shadowRoot)` — shadow-root-scoped blur lifecycle
- `handleIframe(settings, iframeEl)` — cross-origin iframe stamping

**Element blur:**
- `applyBlur(el)`, `removeBlur(el)`, `toggleBlur(el)`, `unblurAll()`, `teardown(root)`

**Queries:**
- `isBlurred(el)` — data attribute or always-blur tag match
- `isVisuallyBlurred(el)` — same + role-based CSS matches (for reveal)
- `isBlurAllActive()` — DOM check (does `#bl-si-blur-styles` exist?)
- `get isPageBlurred` — state-based getter
- `matchesActiveCategories(el)`, `shouldBlurElement(el, cats, thorough)`

**CSS injection:**
- `injectRules(root, cats, mode)`, `removeRules(root)`
- `injectPickBlurRules(root, type, color)`, `removePickBlurRules(root)`
- `injectPiiRules(mode, color)`, `removePiiRules()`
- `ensureSvgFilter(root)`
- `stampElements(root, cats, thorough, mode)`, `tryBlurTextCheck(el, thorough)`

**Zone overlays:**
- `createZoneOverlay(zoneData)`, `removeZoneOverlay(zoneId)`, `getZoneOverlays()`, `removeAllZoneOverlays()`

**Observer:**
- `observeRoot(root)`, `disconnectObserver(root)`

**Counter allocation:**
- `resetCounters()`, `allocateDynamicName()`, `allocateStickyName()`

**Picker gate:**
- `_setPickerActiveForObserver(bool)` — semi-private; only called by content_script

**Data:**
- `CATEGORY_SELECTORS` — exported for tests

---

## Counter Allocation System

### `resetCounters()` — line 1043
Sets `_dynamicCounter = 0` and `_stickyCounter = 0`. Called once by `content_script.init()` before the first `applyState()`, so the first item gets name "Dynamic 1" even if prior items exist in storage.

### `allocateDynamicName()` — line 1048
```js
function allocateDynamicName() {
  _dynamicCounter++;
  return "Dynamic " + _dynamicCounter;
}
```
Increments and returns the next name. The counter is also advanced internally by `_applyDynamicItem()` when it processes stored items with higher numbers — so if "Dynamic 5" is in storage, the counter jumps to 5 and the next allocation returns "Dynamic 6".

### `allocateStickyName()` — line 1053
Same pattern for sticky zones: returns "Sticky 1", "Sticky 2", etc.

### Counter Seeding
Inside `_applyDynamicItem()`:
```js
const num = parseInt((item.name || "").replace("Dynamic ", ""), 10);
if (!isNaN(num) && num > _dynamicCounter) _dynamicCounter = num;
```

Inside `_applyStickyItem()`:
```js
const num = parseInt((item.name || "").replace("Sticky ", ""), 10);
if (!isNaN(num) && num > _stickyCounter) _stickyCounter = num;
```

This guarantees that after `_reconcileItems()` processes all stored items, `_dynamicCounter` and `_stickyCounter` hold the current high-water marks. New allocations always produce unique names.

---

## `isBlurred(el)` vs `isVisuallyBlurred(el)` — Why Two Functions

These two functions return different results for elements blurred solely via ARIA role CSS selectors (e.g., `<div role="button">`):

| Element | `isBlurred()` | `isVisuallyBlurred()` |
|---|---|---|
| `<div data-bl-si-blur="1">` | true | true |
| `<div data-bl-si-pick-blur="1">` | true | true |
| `<h1>` (when blur-all is ON) | true | true |
| `<div role="button">` (FORM on) | **false** | **true** |
| `<div data-bl-si-pii="email">` | false | **true** |

**Why `isBlurred` does NOT include role-matched elements:**
`isBlurred` is used by picker.js and context-menu unblur paths to decide whether a stored item exists for a clicked element. Role-matched elements (`<div role="button">`) are blurred by CSS selector alone — there is no storage item for them. If `isBlurred` returned `true` for them, the unblur path would try to remove a non-existent storage item and silently no-op. This would confuse users (clicking "unblur" does nothing).

**Why `isVisuallyBlurred` includes role-matched elements:**
`reveal_controller.js` uses `isVisuallyBlurred` during ancestor chain walks for hover/click reveal. If a parent `<div role="tab">` is visually blurred by CSS, its `filter: blur()` composites the entire subtree — child elements cannot escape the blur even if they have `filter: none`. To reveal a child element correctly, the ancestor's filter must also be cleared. `isVisuallyBlurred` returns `true` for these CSS-matched ancestors so `revealAncestorChain()` stamps them with `[data-bl-si-reveal]`.

---

## CSS Class and ID Constants

Referenced via `blsi.css.*` and `blsi.ids.*` from `src/constants.js`:

| Constant | String Value | Usage |
|---|---|---|
| `blsi.css.zone_overlay` | `"bl-si-zone-overlay"` | Zone overlay div className |
| `blsi.css.toast` | `"bl-si-toast"` | Toast notification container |
| `blsi.css.toolbar` | `"bl-si-toolbar"` | Picker toolbar |
| `blsi.css.hover_highlight` | `"bl-si-hover-highlight"` | Picker hover outline |
| `blsi.ids.picker_toolbar` | `"bl-si-picker-toolbar"` | Picker toolbar element ID |
| `blsi.ids.svg_filters` | `"bl-si-svg-filters"` | SVG filter container element ID |
| `"bl-si-blur-styles"` | (hardcoded const) | Injected blur-all style element ID |
| `"bl-si-pick-blur-styles"` | (hardcoded const) | Injected pick-blur style element ID |
| `"bl-si-pii-styles"` | (hardcoded const) | Injected PII style element ID |
| `"bl-si-frosted-filter"` | (hardcoded in SVG builder) | SVG filter element ID inside the SVG |

Data attributes used as identifiers (camelCase in JS, kebab-case in HTML):

| JS Property | HTML Attribute | Meaning |
|---|---|---|
| `el.dataset.blSiBlur` | `data-bl-si-blur` | Element is blur-all stamped |
| `el.dataset.blSiPickBlur` | `data-bl-si-pick-blur` | Element is pick-blur owned |
| `el.dataset.blSiPii` | `data-bl-si-pii` | Element is PII-detection owned |
| `el.dataset.blSiReveal` | `data-bl-si-reveal` | Element is temporarily revealed |
| `el.dataset.blSiZone` | `data-bl-si-zone` | Element is a zone overlay (value = zone ID) |
| `el.dataset.blSiZoneName` | `data-bl-si-zone-name` | Zone display name |
| `el.dataset.blSiZoneAnchor` | `data-bl-si-zone-anchor` | Zone anchor type ("page" or "screen") |
