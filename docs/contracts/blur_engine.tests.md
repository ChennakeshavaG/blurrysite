# blur_engine Test Contract

## Overview

`tests/unit/blur_engine.test.js` (~1615 lines) covers the hybrid CSS + data-attribute blur engine (`src/blur_engine.js`). It exercises:

- CSS injection/removal (`injectRules`, `removeRules`, all five blur modes)
- Element-level blur state (`applyBlur`, `removeBlur`, `isBlurred`, `isVisuallyBlurred`, `unblurAll`)
- Stamping logic (`stampElements`, `tryBlurTextCheck`, `shouldBlurElement`, `matchesActiveCategories`)
- The `CATEGORY_SELECTORS` constant (shape, per-category tag membership, li/dt/dd placement)
- Zone overlay lifecycle (sticky items, anchor types, `getZoneOverlays`)
- Counter allocation and high-water seeding (`allocateElementName`, `allocateStickyName`, `resetCounters`)
- The top-level reconciler (`handleSite`) for both page-wide blur-all and per-item reconcile
- Shadow DOM support: per-root `injectRules`/`stampElements`/`handleShadowRoot`/`teardown`/nested recursion
- Late shadow root detection via the `__blsi_shadow_attached` CustomEvent
- Custom element host stamping (hyphenated tag names, `<slot>` handling)
- ARIA role matching in CSS rules and `matchesActiveCategories`
- Cross-origin iframe blur via `handleIframe`
- Pick & Blur attribute (`data-bl-si-pick-blur`) stamping and `injectPickBlurRules`/`removePickBlurRules`
- Late-loading element detection via `_pickBlurDynamicActive` flag and `_tryPickBlurNode` (MO idle drain path)
- Hover highlight helpers (`highlightItem`, `clearItemHighlight`)
- Reveal descendant cascade CSS rule
- The `_setPickerActiveForObserver` escape hatch

The test file loads `selector_utils.js` as a side-dependency (needed for dynamic item dispatch).

---

## Setup & Teardown

### Global (suite-level)

- `beforeAll` — calls `loadBlurEngine()`, which lazy-loads `selector_utils.js` then `blur_engine.js` via `require()`.
- A `fakeStorage` object is the shared settings carrier for `handleSite()` tests. It holds `settings`, `blurState`, and `items` and is reset in `beforeEach`.

### Default `beforeEach` (top-level)

Runs before every test in the outer `describe('blsi.BlurEngine', ...)`:

1. Clears `document.body.innerHTML`.
2. Removes any injected `#bl-si-blur-styles` elements from `document.head`.
3. Clears `data-bl-si-blur` attributes from any elements.
4. Resets `fakeStorage` to: all categories enabled, `blur_mode: 'censored'`, `thorough_blur: false`, `enabled: true`, `blurState: false`, `items: []`.
5. Calls `jest.clearAllMocks()`.

### Default `afterEach` (top-level)

1. Resets `fakeStorage.blurState` and `fakeStorage.items` to safe defaults.
2. Calls `blsi.BlurEngine.unblurAll()` to clean DOM state.

### Mock stubs (from `tests/setup.js`)

- `global.window = global` — IIFE global assignment works in jsdom.
- `chrome.*` — all `jest.fn()` stubs.
- `HTMLCanvasElement.prototype.getContext` — mocked fake context.
- `global.requestAnimationFrame` — `jest.fn()` that does NOT execute its callback (prevents RAF infinite-loop OOM).
- `KeyboardEvent.prototype.getModifierState` — stub returning `false`.

### Per-describe overrides

- **`shadow DOM` describe** — adds an `afterEach` that calls `handleSite` with `blur_all_active: false` to reset `_lastReconcileKey` to `'inactive'`, ensuring consecutive shadow DOM tests always see `pageWideChanged: true`.
- **`blurAll — item reconcile`** and **`counters`** describes — add a `beforeEach` that calls `blsi.BlurEngine.resetCounters()`.
- **`handleIframe`** describe — adds a `beforeEach` that calls `blsi.BlurEngine.removeRules(document)`.
- **`highlightItem / clearItemHighlight`** describe — `beforeEach` sets DOM and calls `clearItemHighlight()`; `afterEach` calls `clearItemHighlight()` and clears `document.body.innerHTML`.
- **`pick & blur — injectPickBlurRules / removePickBlurRules`** describe — `afterEach` calls `blsi.BlurEngine.removePickBlurRules(document)`.

---

## Test Groups

### `injectRules`

- `creates style element in head` — verifies a `<style id="bl-si-blur-styles">` is inserted into `document.head` after `injectRules`.
- `style contains always-blur tag selectors` — CSS text includes `h1` (text on) and `img` (media on) but not `input` (form off).
- `includes data-bl-si-blur rule` — CSS text contains the `[data-bl-si-blur]` selector for picker-stamped elements.
- `frosted mode uses SVG filter URL` — passing `'frosted'` as mode makes CSS reference `url(#bl-si-frosted-filter)`.
- `calling twice replaces previous` — only one `#bl-si-blur-styles` node exists after two consecutive inject calls.
- `removeBlurRules removes style` — `removeRules(document)` removes the style node; `getElementById` returns null.
- `isBlurAllActive reflects state` — returns `false` before inject, `true` after inject, `false` after remove.
- `excludes extension UI` — CSS text contains `:not(#bl-si-picker-toolbar)` guard so the picker toolbar is never blurred.

### `stampElements`

- `stamps text-check elements with direct text` — `<div>text</div>` gets `data-bl-si-blur="1"`; empty `<div>` does not.
- `thorough stamps inline elements without text` — empty `<span>` is stamped when `thorough_blur=true`.
- `thorough does not bypass text gate for structural containers` — empty `<div>` (structure category) is NOT stamped even in thorough mode.
- `structural container with direct text is stamped in any mode` — `<div>Direct text</div>` is stamped with `thorough=false`.

### `tryBlurTextCheck`

- `stamps text-check with text` — `<div>hello</div>` receives `data-bl-si-blur="1"` after `tryBlurTextCheck`.
- `skips empty` — `<div>` with no text content is not stamped.

### `applyBlur (picker)`

- `sets data-bl-si-blur` — `applyBlur(el)` sets `el.dataset.blSiBlur = '1'`.
- `null safe` — `applyBlur(null)` does not throw.

### `removeBlur`

- `removes data-bl-si-blur` — after `applyBlur` then `removeBlur`, attribute is gone.
- `null safe` — `removeBlur(null)` does not throw.

### `isBlurred`

- `true for data-bl-si-blur` — element with `applyBlur` applied returns `true`.
- `false for non-blurred` — plain new element returns `false`.
- `false for null` — returns `false` safely.
- `false after rules removed from always-blur tag` — `<p>` is blurred when text rules injected; after `removeRules`, `isBlurred` returns `false`.

### `unblurAll`

- `removes rules and data attrs` — after injecting rules and applying blur to an element, `unblurAll()` clears both `isBlurAllActive()` and the element's `data-bl-si-blur`.

### `shouldBlurElement`

- `true for always-blur` — `<p>` with text content returns `true` (text category on).
- `false for empty text-check` — `<td>` with no text returns `false` when `thorough=false`.
- `thorough bypasses gate` — empty `<td>` returns `true` when `thorough=true`.
- `false for null` — returns `false` safely.
- `false for img when MEDIA category is off` — `<img>` returns `false` when `media: false`.

### `CATEGORY_SELECTORS`

- `frozen with 5 categories` — `Object.isFrozen` is `true`; exactly 5 top-level keys exist.

### `matchesActiveCategories`

- `true for img when media on` — `<img>` matches with `{ media: true }`.
- `false for img when media off` — `<img>` does not match with `{ media: false }`.
- `false for custom element (hyphenated tag) when no category matches` — `<my-widget>` returns `false` with all categories on (no category selector covers hyphenated tags directly).

### `getZoneOverlays`

- `returns all active overlays after handleSite applies sticky items` — two sticky items produce `getZoneOverlays().length === 2`.
- `returns empty array when none exist` — returns `[]` before any items applied.

### `unblurAll cleans zones`

- `removes zone overlays along with data-bl-si-blur elements` — after a sticky item creates an overlay, `unblurAll()` removes the overlay and clears `data-bl-si-blur` on regular elements.

### `_isExtensionUI excludes zones`

- `zone overlay not treated as blur target` — `applyBlur(zoneEl)` is a no-op; the attribute is not set on zone overlays.

### `blurAll — item reconcile`

- `applies dynamic items from storage` — `handleSite` with a dynamic item stamps `data-bl-si-pick-blur` (not `data-bl-si-blur`) on the resolved element.
- `removes items no longer in storage` — a second `handleSite` with empty items removes `data-bl-si-pick-blur`.
- `creates zone overlay for sticky items` — a sticky item produces one zone overlay in the DOM.
- `removes zone overlay when sticky drops from storage` — second `handleSite` with empty items removes the overlay.
- `second call is idempotent when storage unchanged` — two identical `handleSite` calls leave one `data-bl-si-pick-blur`.
- `applies dynamic item using new selectors[] array shape` — item with `selectors: [...]` array resolves correctly.
- `falls back to second selector when first does not match` — first selector `#stale-no-match` misses; second `#fallback` applies blur.
- `removes dynamic item using selectors[] shape` — removal works for array-shape items.
- `dynamic item with no DOM match is a no-op (does not throw)` — missing element causes no error.
- `sticky item with anchor screen creates position:fixed overlay` — overlay has `style.position === 'fixed'` and `data-bl-si-zone-anchor="screen"`.

### `counters`

- `allocateElementName increments` — successive calls return `'Element 1'`, `'Element 2'`.
- `allocateStickyName page anchor increments` — successive `allocateStickyName('page')` calls return `'Area on page 1'`, `'Area on page 2'`.
- `allocateStickyName screen anchor increments` — successive `allocateStickyName('screen')` calls return `'Area on screen 1'`, `'Area on screen 2'`.
- `allocateStickyName defaults to page when anchor missing` — `allocateStickyName()` with no argument returns `'Area on page 1'`.
- `resetCounters zeroes all three` — after allocating one of each, reset makes all three counters restart at 1.
- `seeds element counter from new-format item name` — item named `'Element 5'` causes next `allocateElementName()` to return `'Element 6'`.
- `seeds element counter from legacy Dynamic name (backward compat)` — item named `'Dynamic 5'` causes next `allocateElementName()` to return `'Element 6'`.
- `seeds page area counter from new-format item name` — item named `'Area on page 9'` causes next `allocateStickyName('page')` to return `'Area on page 10'`.
- `seeds screen area counter from new-format item name` — item named `'Area on screen 3'` causes next `allocateStickyName('screen')` to return `'Area on screen 4'`.
- `seeds page counter from legacy Sticky name (backward compat)` — item named `'Sticky 9'` causes next `allocateStickyName('page')` to return `'Area on page 10'`.

### `blurAll — page-wide reconcile`

- `storage blurState=true injects rules and flips isPageBlurred` — `isPageBlurred` becomes `true`; style element exists.
- `storage blurState=false after being true tears down rules` — second `handleSite` with `blur_all_active: false` removes style and flips `isPageBlurred` to `false`.
- `no page-wide rules when blurState=false from the start` — style element never created.
- `category change between calls rebuilds rules` — switching from text-only to media-only makes CSS contain `img` not `h1`.
- `THOROUGH_BLUR true → false un-stamps elements no longer matching` — empty `<span>` stamped with thorough, then un-stamped when thorough disabled.
- `narrowing categories un-stamps old matches while blur-all active` — switching from text+media to media-only makes rebuilt CSS omit `h1`.
- `picker items survive page-wide refresh` — `data-bl-si-pick-blur` persists on element after `_enablePageWide` nuke triggered by thorough change.
- `ENABLED=false tears everything down` — `enabled: false` removes style, clears both blur attributes, and flips `isPageBlurred`.
- `ENABLED=false removes zone overlays` — zone overlay removed and `getZoneOverlays()` returns empty.
- `_setPickerActiveForObserver is exposed` — function exists and can be called with `true`/`false` without throwing.
- `frosted SVG filter is cleaned up on disable` — SVG filter container present when frosted active, removed when `blur_all_active` goes `false`.
- `no-op reconcile skips _enablePageWide when nothing page-wide changed` — manually stamped probe element survives identical second `handleSite` call (nuke not triggered).
- `frosted radius change DOES trigger page-wide rebuild` — changing `blur_radius` with frosted mode forces `_enablePageWide` nuke; probe element's stamp is cleared.
- `sequential awaited blurAll() converges on the final storage state` — after two sequential calls switching from `#a` to `#b`, only `#b` carries `data-bl-si-pick-blur`.

### `category coverage additions`

- `hgroup is stamped when TEXT is on (alwaysBlur rule)` — injected CSS text contains `hgroup`.
- `ruby/rt/rp gated by text content when TEXT is on` — filled ruby/rt are stamped; empty ruby is not.
- `li covered by CSS alwaysBlur when STRUCTURE is on (not JS-stamped)` — CSS contains `li`; `stampElements` does not add `data-bl-si-blur` to an `<li>`.
- `li not in CSS alwaysBlur and not JS-stamped when STRUCTURE is off` — `<li>` element not stamped when structure category is off.
- `dt and dd covered by CSS alwaysBlur when STRUCTURE is on (not JS-stamped)` — CSS contains both `dt` and `dd`; `stampElements` leaves them without the data attribute.

### `ARIA role matching`

- `alwaysBlur CSS rule contains [role="button"] when FORM is on` — CSS includes `[role="button"]`, `[role="checkbox"]`, `[role="slider"]`.
- `alwaysBlur CSS rule omits role selectors when FORM is off` — CSS does not contain `[role="button"]`.
- `matchesActiveCategories returns true for <div role="button"> when FORM is on` — role-mapped div matches.
- `matchesActiveCategories returns false for role="button" when FORM is off` — returns `false` with all categories off.
- `matchesActiveCategories returns false for plain <div> with no role` — plain div does not match form category.
- `shouldBlurElement returns true for role-matched element` — `<span role="checkbox">` returns `true` with form on.
- `role set survives selector cache invalidation (toggle off then on)` — toggling form category off then on regenerates role selectors correctly.

### `shadow DOM`

#### `injectRules` / `removeRules`

- `injectRules injects style into shadow root` — style element appears inside shadow root.
- `injectRules style in shadow root does not appear in document head` — no bleed into main document.
- `removeRules removes style from shadow root` — style gone after `removeRules(sr)`.

#### `stampElements`

- `stampElements stamps text-check elements inside shadow root` — filled `<span>` stamped; empty one not.
- `stampElements returns discovered shadow roots` — return value array contains the shadow root found during document-level stamp pass.
- `stampElements returns empty array when no shadow roots present` — returns `[]` with plain DOM.

#### `handleShadowRoot`

- `handleShadowRoot active path injects rules into shadow root` — style injected when `blur_all_active: true`.
- `handleShadowRoot active path stamps text-check elements inside shadow root` — `<span>secret</span>` receives stamp.
- `handleShadowRoot inactive path removes rules and stamps from shadow root` — switching to `blur_all_active: false` removes style and clears stamp.
- `handleShadowRoot recurses into nested shadow roots` — two-level nesting (outer sr → inner sr) both get style and stamp.

#### `teardown`

- `teardown removes stamps and rules recursively from nested shadow roots` — single `teardown(sr)` cleans both the outer shadow root and a nested shadow root.

#### `handleSite` end-to-end

- `handleSite stamps elements inside shadow roots when blur-all active` — end-to-end: `handleSite` with `blur_all_active: true` stamps `<span>` inside a shadow root.
- `handleSite cleans up shadow roots when blur-all deactivated` — second `handleSite` with `blur_all_active: false` removes style and stamp from shadow root.

#### `observeRoot` idempotency

- `handleShadowRoot called twice on same shadow root yields one style element` — two calls produce exactly one `#bl-si-blur-styles` node.

#### `__blsi_shadow_attached` event

- `__blsi_shadow_attached event triggers injectRules on newly-attached shadow root` — shadow root attached after the stamp pass gets rules injected synchronously when the event fires.
- `__blsi_shadow_attached is a no-op when blur-all is inactive` — no rules injected when `blur_all_active` is `false`.
- `__blsi_shadow_attached is a no-op when shadow root already observed` — firing event a second time for an already-known shadow root does not duplicate the style element.

### `mutation dispatcher — subscribeMutations / unsubscribeMutations`

Subscriber-style fan-out from the single MO per root. Tests use a `flushDispatch()` helper (one microtask + one macrotask) since the MO callback fires in a microtask and the idle drain falls back to `setTimeout(fn, 0)` in jsdom. Inner `afterEach` removes `'test-a'`, `'test-b'`, `'pii'` subscribers and resets picker active.

- `subscribeMutations + unsubscribeMutations are exposed` — both are exported as functions on `blsi.BlurEngine`.
- `subscriber receives childList MutationRecord[] for added node` — appendChild after `activate()` produces a callback with `(MutationRecord[], root)` whose first record has `type === 'childList'`.
- `subscriber receives characterData record on textContent change` — mutating an existing text node's `textContent` produces a `'characterData'` record on the subscriber.
- `unsubscribeMutations stops further dispatch` — handler is not called after unsubscribe.
- `re-registering same name replaces the handler` — the second handler fires; the first does not.
- `subscriber error is caught — other subscribers still fire` — a throwing subscriber does not stall the next subscriber registered under a different name.
- `subscribers still fire when picker is active (engine drain skipped)` — picker active suppresses stamping but subscribers still receive records (PII keeps wrapping typed text during picker mode).
- `subscribers still fire when blur-all is OFF` — engine drain inactive, but the dispatcher's subscriber path still runs.
- `subscribeMutations rejects non-string name and non-function handler` — silent rejects on `''`, `null` name and `null` handler.

### `custom element stamping (RC-1)`

- `stampElements stamps custom element host when text content present` — `<shreddit-foo>text</shreddit-foo>` receives `data-bl-si-blur`.
- `stampElements does not stamp custom element host when no text content` — empty custom element not stamped.
- `stampElements stamps custom element host in thorough mode regardless of text` — empty custom element stamped in thorough mode.
- `stampElements stamps shadow DOM <a> containing a <slot> (no direct text)` — `<a>` with only a `<slot>` child inside a shadow root is stamped (slot presence counts).
- `stampElements does NOT stamp structural element containing only a slot (text gate still strict)` — `<div>` wrapping only a `<slot>` inside shadow root is NOT stamped.
- `stampElements does not stamp custom element when STRUCTURE and TEXT both disabled` — custom element with text not stamped when neither text nor structure category is on.

### `CATEGORY_SELECTORS list element placement (RC-2)`

- `li is in STRUCTURE.alwaysBlur not textCheck` — direct constant inspection confirms placement.
- `dt and dd are in STRUCTURE.alwaysBlur not textCheck` — same constant check for both tags.
- `injectRules includes li in alwaysBlur CSS when STRUCTURE active` — injected CSS contains `li`.

### `reveal descendant cascade rule (RC-3)`

- `injectRules includes descendant-reveal cascade rule for data-bl-si-blur` — CSS contains `[data-bl-si-reveal] [data-bl-si-blur]`.
- `injectRules includes descendant-reveal cascade rule for data-bl-si-pii` — CSS contains `[data-bl-si-reveal] [data-bl-si-pii]`.

### `handleIframe (RC-4)`

- `handleIframe stamps cross-origin iframe with data-bl-si-blur when active` — iframe with a `SecurityError`-throwing `contentDocument` receives `data-bl-si-blur="1"` when `blur_all_active: true`.
- `handleIframe removes stamp on inactive path (blur-all off)` — pre-stamped cross-origin iframe has stamp removed when `blur_all_active: false`.
- `handleIframe skips same-origin iframe (all_frames handles it)` — jsdom iframe with accessible `contentDocument` is not stamped.

### `pick & blur — data-bl-si-pick-blur attribute`

- `_applyDynamicItem stamps data-bl-si-pick-blur, NOT data-bl-si-blur` — picker items use the pick-blur attribute, not the blur-all attribute.
- `_removeDynamicItem clears data-bl-si-pick-blur` — removing item in second `handleSite` call clears the attribute.
- `zone overlay (sticky item) stamps data-bl-si-pick-blur on overlay` — sticky zone overlay carries `data-bl-si-pick-blur`.
- `removeBlur clears data-bl-si-pick-blur as well as data-bl-si-blur` — `removeBlur` is a dual-attribute clear.
- `isBlurred returns true when only data-bl-si-pick-blur is set` — `isBlurred` treats pick-blur attribute as blurred.
- `isVisuallyBlurred returns true when only data-bl-si-pick-blur is set` — same for `isVisuallyBlurred`.

### `pick & blur — injectPickBlurRules / removePickBlurRules`

- `blur mode injects nothing (static content.css covers it)` — `injectPickBlurRules(document, 'blur', ...)` produces no `#bl-si-pick-blur-styles` element.
- `null/undefined type injects nothing` — `injectPickBlurRules(document, null, null)` is a no-op.
- `color mode injects background-color rule for dynamic elements` — style element appears with `background-color` and `rgba(255,0,0,0.9)`.
- `color mode injects zone overlay override` — CSS targets `.bl-si-zone-overlay` and sets `backdrop-filter: none`.
- `color mode injects reveal cancel rule` — CSS contains the reveal cancel (`data-bl-si-reveal]` with `background-color: transparent`).
- `frosted mode injects filter:url rule` — CSS contains `url(#bl-si-frosted-filter)` targeting `data-bl-si-pick-blur`.
- `removePickBlurRules removes bl-si-pick-blur-styles` — style element removed after call.
- `injectPickBlurRules is idempotent — re-inject replaces existing style` — only one style element; second inject overwrites content with new color value.

### `_pickBlurDynamicActive — flag lifecycle`

- `late-loaded element is pick-blurred when blur-all is OFF (MO regression)` — regression test for the root cause: `handleMainDocument` tears down the MO when blur-all is OFF; `handleSite` must re-attach via `observeRoot` after `_reconcileItems`. Verified end-to-end: `handleSite` with blur-all=OFF + one dynamic item, then `appendChild` of a matching element, then two `await` ticks (first drains MO microtask, second drains `setTimeout(fn,0)` idle) — the new element carries `data-bl-si-pick-blur="1"`.
- `flag becomes true when dynamic item reconciled` — after `handleSite` with a dynamic item, the element is stamped (verifying the flag gate is satisfied).
- `flag becomes false after all dynamic items removed` — after a second `handleSite` with `blur_items: []`, the element loses its stamp (flag reset to false).
- `sticky-only items do not set dynamic flag` — only sticky items in `blur_items` creates a zone overlay but no `_tryPickBlurNode` path is needed; flag remains false.

### `_tryPickBlurNode — late-loading element detection`

- `stamps element that matches a stored dynamic item selector (unique match)` — element matching a unique selector receives `data-bl-si-pick-blur="1"` after reconcile.
- `does not double-stamp an already-stamped element` — element with pre-existing `data-bl-si-pick-blur` attribute is not modified.
- `does not stamp when selector matches multiple elements (not unique)` — non-unique CSS selector leaves both matching elements without `data-bl-si-pick-blur`.
- `skips extension UI elements` — element with `data-bl-si-zone` attribute (extension UI guard) is not stamped even if it matches a dynamic item selector.

### `highlightItem / clearItemHighlight`

- `applies bl-si-hover-highlight to resolved dynamic element` — `highlightItem` with `selectors: ['#hi-target']` adds the class.
- `does not throw when selector resolves to nothing` — non-existent selector is safe; no class added anywhere.
- `second highlightItem clears previous highlight before applying new one` — prior element loses class; new element gains it.
- `clearItemHighlight removes the highlight class` — class removed after `clearItemHighlight()`.
- `clearItemHighlight is safe when nothing is highlighted` — no-op, no throw.
- `applies highlight to sticky zone overlay via id` — `highlightItem({ item_type: 'sticky', id: 'hl-zone-1' })` adds class to the zone overlay element.

---

## Edge Cases Explicitly Tested

- **Null safety**: `applyBlur(null)`, `removeBlur(null)`, `isBlurred(null)`, `shouldBlurElement(null, ...)` all return safely without throwing.
- **Double inject is idempotent**: calling `injectRules` twice keeps exactly one style element; the second call replaces the first.
- **Counter high-water seeding**: new-format names (`'Element 5'`, `'Area on page 9'`, `'Area on screen 3'`) and legacy names (`'Dynamic 5'`, `'Sticky 9'`) all seed the appropriate counter so the next `allocate*Name()` call skips ahead — prevents name collisions after restore. Legacy `'Sticky N'` seeds the page counter.
- **No-op reconcile detection**: an identical second `handleSite` call does not re-run `_enablePageWide`; manually stamped probe elements survive.
- **Frosted radius change forces rebuild**: changing `blur_radius` with frosted mode is specifically included in the reconcile key, causing a page-wide nuke even when other settings are unchanged.
- **Sequential await convergence**: two awaited `handleSite` calls swapping items result in only the final item's element being stamped.
- **Cross-origin iframe stamped as opaque box**: `contentDocument` access throws `SecurityError` → iframe itself gets `data-bl-si-blur`.
- **Same-origin iframe skipped**: accessible `contentDocument` → `handleIframe` leaves iframe unstamped (in-frame content script handles it).
- **Slot-containing `<a>` in shadow root stamped**: `<a>` with only a `<slot>` child is treated as having meaningful content.
- **Structural slot wrapper NOT stamped**: `<div>` with only a `<slot>` inside shadow root is not stamped (avoids layout-wrapper artifacts).
- **ARIA role toggling**: injecting rules, switching categories off, switching back — ARIA selectors regenerate correctly each time.
- **Late shadow root via `__blsi_shadow_attached`**: shadow root attached after the stamp pass is handled synchronously; duplicate events are deduplicated.
- **Zone overlay applyBlur guard**: calling `applyBlur` on a zone overlay element is silently ignored.
- **Pick-blur attribute is dual-cleared by `removeBlur`**: `removeBlur` clears both `data-bl-si-blur` and `data-bl-si-pick-blur`.
- **`isBlurred` and `isVisuallyBlurred` both detect `data-bl-si-pick-blur`**: pick-blur attribute alone satisfies both predicates.

---

## Coverage Gaps

The following behaviors exist in `src/blur_engine.js` but are not exercised in this test file:

- **`ensureSvgFilter()` standalone behavior** — no test verifies the SVG element shape, attribute values (`stdDeviation`, `feGaussianBlur`), or that it is deduplicated correctly outside the `handleSite` path.
- **`handleSite` mutex / concurrent calls** — no test fires two non-awaited `handleSite` calls simultaneously to verify the second is dropped (the internal guard exists but is untested).
- **`MutationObserver` callback correctness (blur-all ON path)** — the MO idle drain for the `tryBlurTextCheck` (blur-all) path is not tested via actual DOM mutations; only the pick-blur-only (`_tryPickBlurNode`) path has an end-to-end MO test. The blur-all stamp drain via MO is indirectly covered by `handleSite` and `stampElements` tests but not via injected mutations.
- **`observeRoot` on a shadow root** — `observeRoot` is only implicitly exercised via `handleShadowRoot`; no test calls it directly on a shadow root and verifies observer attachment.
- **`isVisuallyBlurred()` with `blur-all` active via CSS rule** — `isVisuallyBlurred` is only tested for `data-bl-si-pick-blur`; the CSS-rule path (element matched by an always-blur selector while `injectRules` is active) is not tested.
- **Closed shadow roots** — all shadow DOM tests use `mode: 'open'`; `mode: 'closed'` behavior is untested (access via `host.shadowRoot` returns `null`).
- **ARIA roles beyond button/checkbox/slider** — `role="listbox"`, `role="combobox"`, `role="switch"` are in the source selectors but not exercised.
- **CSS `:not(button):not(input)` guard on ARIA role selectors** — no test confirms native form elements are excluded from the ARIA role CSS rule to avoid double-applying blur.
- **Behavioural reveal cascade** — the cascade rule `[data-bl-si-reveal] [data-bl-si-blur]` is confirmed to exist in CSS text, but no test actually verifies that adding `data-bl-si-reveal` to a parent element visually (or computedly) un-blurs a child.
- **`audio` and `progress`/`meter` tags in category CSS** — noted in the `OPTIMIZE` annotation as candidates for `test.each`; not currently individually tested.
- **`hgroup` element JS stamping** — tested only as a CSS rule; no test verifies `shouldBlurElement` or `matchesActiveCategories` for `hgroup`.
- **`injectPiiRules` / `removePiiRules`** — PII-specific rule injection is in the source but has no tests here (covered separately in `content_i18n.test.js` or `storage_model.test.js`).
- **`blurredCount` getter (O(1) running count)** — getter is documented in the public API but not tested.
- **`isPageBlurred` getter with pick-blur-only state** — `isPageBlurred` is tested only when blur-all is active; its value when only pick items are applied is not verified.
- **`handleIframe` with enabled: false** — the "disabled" fast-path of `handleIframe` (where `enabled: false` might clear stamps) is not tested.
- **Sticky zone overlay label element** — the zone label (`bl-si-zone-label`) is not verified to exist or contain the correct name text.
- **`teardown` on the main document** — `teardown` is only tested on shadow roots; calling it on `document` or `document.body` is not covered.
