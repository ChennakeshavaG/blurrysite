# Blur Engine — Element Stamping

Element stamping is the process by which `blur_engine.js` decides which DOM elements should carry the `data-bl-si-blur` attribute. This attribute is the trigger for the static fallback CSS rule in `content.css` and is the mechanism for handling elements that cannot be covered by tag-based CSS selectors alone (e.g., `<div>` or `<span>` that carry meaningful text content).

This document covers `CATEGORY_SELECTORS`, the always-blur vs. text-check split, `stampElements()`, `tryBlurTextCheck()`, `shouldBlurElement()`, `matchesActiveCategories()`, and the deferred idle queue.

---

## Two Strategies: Always-Blur vs. Text-Check

The engine uses two different strategies for two different classes of elements:

### Always-Blur (CSS injection, no data attribute needed)

Tags that are *always* meaningful — headings, paragraphs, images, videos, form inputs — are covered by injected CSS tag selectors. These elements get blurred immediately as soon as `injectRules()` runs, without any JS scanning pass. Any new element of these types that the browser creates or that a SPA inserts will match the CSS rule immediately (CSS is a live query, not a snapshot).

These tags do **not** carry `data-bl-si-blur` unless they are also in `textCheck` for some other reason.

### Text-Check (JS scan, data attribute required)

Tags that *sometimes* carry meaningful content but are also used as structural wrappers — `<div>`, `<span>`, `<a>`, `<td>`, etc. — require JS inspection. The engine scans each element and checks whether it has direct text node children. If it does, it stamps `data-bl-si-blur="1"`. If not (empty wrapper div, layout-only span), it skips it.

This distinction exists because:
1. Blurring an empty `<div>` does nothing visible but adds DOM overhead.
2. More critically: blurring a structural container creates a CSS `filter` that composites the entire subtree. When `reveal_controller` later tries to reveal a child element by clearing its `filter`, the parent's `filter` still applies to the entire subtree. This creates a "ghost blur" where the child appears revealed but is actually still blurred by the parent's filter cascade. The text-gate prevents this by not blurring containers that don't have direct content.

---

## `CATEGORY_SELECTORS` — The Element Classification Map

Defined at lines 24–129 as a frozen nested object mapping category names to arrays of tag names:

```js
const CATEGORY_SELECTORS = Object.freeze({
  text: Object.freeze({
    alwaysBlur: Object.freeze([
      "h1", "h2", "h3", "h4", "h5", "h6", "hgroup",
      "p", "blockquote", "pre", "figcaption", "summary",
    ]),
    textCheck: Object.freeze([
      "span", "a", "label", "em", "strong", "b", "i", "u",
      "cite", "q", "mark", "abbr", "time", "address", "small",
      "code", "kbd", "samp", "var", "dfn", "data",
      "del", "ins", "s", "sub", "sup", "bdo", "bdi",
      "ruby", "rt", "rp",
    ]),
  }),
  media: Object.freeze({
    alwaysBlur: Object.freeze(["img", "video", "audio", "canvas", "svg"]),
    textCheck: Object.freeze([]),
  }),
  form: Object.freeze({
    alwaysBlur: Object.freeze(["input", "textarea", "select", "progress", "meter"]),
    textCheck: Object.freeze(["button", "output", "fieldset", "legend"]),
    roles: Object.freeze([
      "button", "checkbox", "radio", "switch", "textbox", "searchbox",
      "combobox", "listbox", "spinbutton", "slider",
      "menuitem", "menuitemcheckbox", "menuitemradio", "option", "tab",
    ]),
  }),
  table: Object.freeze({
    alwaysBlur: Object.freeze(["caption"]),
    textCheck: Object.freeze(["td", "th"]),
  }),
  structure: Object.freeze({
    // li/dt/dd in alwaysBlur so CSS covers ::marker pseudo-elements unconditionally
    alwaysBlur: Object.freeze(["li", "dt", "dd"]),
    textCheck: Object.freeze([
      "div", "section", "article", "aside",
      "header", "footer", "figure", "details", "dialog",
    ]),
  }),
});
```

**Category iteration order** (`CATEGORY_ORDER`): `["text", "media", "structure", "form", "table"]`. This order controls which category's tags appear first in the generated `alwaysBlurSelector` CSS string.

### The `roles` field (FORM category only)

FORM's `roles` list covers ARIA role-based interactive elements — `<div role="button">`, `<span role="checkbox">`, etc. These elements are treated as "always blur" (no text gate) because they carry interaction state, not empty text.

In CSS injection (`buildSelectors`), roles become attribute selectors:
```js
const roleSelectorPart = roles.map(r => `[role="${r}"]`).join(",");
```

These are appended to the `alwaysBlurSelector` string — so a `<div role="button">` is blurred by the injected CSS tag rule alongside native `<button>` elements.

In JS checks (`matchesActiveCategories`, `shouldBlurElement`, `isBlurred`, `isVisuallyBlurred`), roles are stored in a `Set` for O(1) lookup via `element.getAttribute("role")`.

### Why `li`, `dt`, `dd` are in `alwaysBlur` (not `textCheck`)

List item markers (`::marker` pseudo-elements) are rendered by the browser as a child visual of the `<li>`. CSS `filter: blur()` on the `<li>` blurs both the content and the marker — there is no way to address `::marker` via JS stamping. If `<li>` were in `textCheck`, an empty `<li>` would not be stamped, and its marker (bullet "•" or counter "1.") would remain visible while the content is blurred. Moving `<li>` to `alwaysBlur` ensures CSS injection always covers markers.

---

## `buildSelectors(categories)` — Selector Construction

Called by `getSelectors()` on cache miss. Takes the active category toggle object `{ text: true, media: true, form: false, ... }` and produces:

```js
{
  key: "11011",                          // binary string: text+media+structure+table on, form off
  alwaysBlurSelector: "h1,h2,...,li,dt,dd,[role='button'],[role='checkbox'],...",
  textCheckSelector: "span,a,...,div,section,...,td,th",
  alwaysBlurTags: ["h1", "h2", ...],    // array for O(n) isBlurred() walk
  textCheckTags: ["span", "a", ...],    // array
  tagSet: Set<string>,                  // all tags (alwaysBlur + textCheck) for O(1)
  roleSet: Set<string>,                 // all roles for O(1) getAttribute("role") check
}
```

The `alwaysBlurSelector` and `textCheckSelector` strings are passed to `injectRules()` for CSS generation. The sets are used by JS functions for O(1) element classification.

---

## `getSelectors(categories)` — Cached Selector Access

Wraps `buildSelectors` with a key-based cache:

```js
let selectorCache = null;

function getSelectors(categories) {
  const key = CATEGORY_ORDER.map(n => categories[n] ? "1" : "0").join("");
  if (selectorCache && selectorCache.key === key) return selectorCache;
  selectorCache = buildSelectors(categories);
  return selectorCache;
}
```

Cache miss only occurs when the category toggle combination changes (e.g., user disables the FORM category). Since `CATEGORY_ORDER` has 5 entries, there are only `2^5 = 32` possible keys. In practice, most pages use the same categories throughout their session.

`_rebuildTextCheckSet(categories)` is a parallel fast-path that builds only the `_textCheckSet` Set (for MO callback O(1) tag lookup), without rebuilding the full selector strings.

---

## `hasMeaningfulTextContent(element)` — The Text Gate

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

Scans only **direct children** (`childNodes`, not `querySelectorAll('*')`). Returns `true` if any direct child is a text node with non-whitespace content.

**Why direct children only:** If text is inside a child `<span>`, that `<span>` will be stamped on its own pass. Stamping the parent `<div>` too would create nested blur — the parent's CSS `filter` would apply over the child's `filter`, making reveal fail for the inner element (child `filter: none` cannot pierce parent `filter: blur()`).

**Common cases:**
- `<span>Hello world</span>` → `textContent.trim() = "Hello world"` → `hasMeaningfulTextContent = true` → stamped
- `<div><span>text</span></div>` → no direct TEXT_NODE children → `hasMeaningfulTextContent = false` → NOT stamped (the inner `<span>` gets stamped instead)
- `<div>  </div>` → TEXT_NODE with content `"  "` → `.trim().length = 0` → NOT stamped

---

## `_structuralTags` — Containers That Always Need the Text Gate

```js
const _structuralTags = new Set(CATEGORY_SELECTORS.structure.textCheck);
// = Set { "div", "section", "article", "aside", "header", "footer", "figure", "details", "dialog" }
```

These tags are always gated by `hasMeaningfulTextContent`, even in thorough mode. The gate cannot be bypassed for these tags.

**Why thorough mode cannot bypass the gate for structural containers:** In thorough mode, inline elements (`<span>`, `<a>`, `<em>`) are stamped even without direct text content (to catch SPAs that use empty inline elements to render text via `:before`/`:after` or slot projection). But structural containers are excluded from this — blurring an empty `<div>` wrapper creates a parent filter that composites the subtree, breaking hover reveal for all descendants. The invariant "structural containers only get stamped if they have direct text" is inviolable.

`li`, `dt`, `dd` are NOT in `_structuralTags` (they're in `alwaysBlur`), so they are never text-gated.

---

## `stampElements(root, categories, thorough, mode)` — Full-Page Stamp Pass

Called during page initialization and after settings changes that require a full DOM rescan. Runs in `requestIdleCallback` (via the stamp queue).

```js
function stampElements(root, categories, thorough, mode) {
  const cats = categories || DEFAULT_CATS;
  _rebuildTextCheckSet(cats);
  const isMasked = mode === blsi.blur_modes.masked;
  const shadowRoots = [];

  root.querySelectorAll('*').forEach(el => {
    // 1. Inline stale-clear: remove old blur stamp (but preserve PII stamps)
    if (el.dataset.blSiBlur && !el.dataset.blSiPii) delete el.dataset.blSiBlur;

    // 2. Shadow root discovery (piggybacked on this pass — no extra traversal)
    if (el.shadowRoot) shadowRoots.push(el.shadowRoot);

    const tag = el.tagName.toLowerCase();

    // 3. Custom element handling (e.g., <shreddit-foo>, <my-component>)
    if (tag.includes('-')) {
      if (!el.dataset.blSiBlur && !el.dataset.blSiPickBlur && !el.dataset.blSiPii
          && !_isExtensionUI(el)
          && (cats.structure || cats.text)) {
        el.dataset.blSiBlur = "1";
      }
      return;
    }

    // 4. Text-check gate: only process tags in _textCheckSet
    if (!_textCheckSet.has(tag)) return;

    // 5. Ownership guard: skip if already owned by competing blur system
    if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return;

    // 6. Extension UI guard
    if (_isExtensionUI(el)) return;

    // 7. Text gate decision
    const needsTextGate = _structuralTags.has(tag);
    let shouldStamp = false;
    if (needsTextGate) {
      shouldStamp = hasMeaningfulTextContent(el);
    } else {
      // Inline elements: stamp if thorough mode OR has direct text OR has a <slot> descendant
      shouldStamp = thorough || hasMeaningfulTextContent(el) ||
        !!(el.querySelector && el.querySelector('slot'));
    }

    if (shouldStamp) el.dataset.blSiBlur = "1";
  });

  return shadowRoots;
}
```

**Step-by-step analysis:**

**Step 1 — Inline stale-clear:** Instead of a separate `querySelectorAll('[data-bl-si-blur]')` pre-pass to clear stale stamps, the clear is piggybacked on the main traversal. PII-stamped elements (`el.dataset.blSiPii`) are explicitly skipped — PII spans own their own blur lifecycle and must not be cleared by blur-all sweeps.

**Step 2 — Shadow root collection:** Every element with `.shadowRoot` is collected into an array. After the traversal is complete, the caller (in `_flushStampQueue`) processes these shadow roots — injecting CSS, wiring MO, and queuing their own stamp passes. Collecting without recursing during the `forEach` prevents processing a child's shadow root before the parent's stamps are cleared.

**Step 3 — Custom elements:** Elements with hyphenated tag names (`<my-element>`, `<shreddit-foo>`) are not in `_textCheckSet`. They get stamped if STRUCTURE or TEXT categories are active, since they typically render light-DOM content. Their shadow DOM content is handled via the shadow root recursion in step 2.

**Step 4–5 — Membership and ownership guards:** Fast-path returns prevent processing tags that aren't in the current category set, and skip elements already owned by pick-blur or PII.

**Step 6 — Extension UI guard:** Prevents the stamp pass from blurring the picker toolbar, toast notifications, or zone overlay divs.

**Step 7 — Slot handling:** For inline elements (non-structural), the `slot` check allows stamping elements that contain `<slot>` descendants. In shadow DOM, a `<slot>` renders projected light-DOM content. A `<my-badge><slot></slot></my-badge>` host might have no direct text nodes, but its rendered output includes projected text. CSS `filter` on the host blurs the slot's projected content — so the host should be stamped even without direct text nodes.

**Returns:** `ShadowRoot[]` — the list of shadow roots discovered during this traversal. The caller in `_flushStampQueue` handles these immediately after the stamp pass completes.

---

## `tryBlurTextCheck(element, thorough)` — Single-Element Stamp (MO Callback)

Used by the MutationObserver idle callback to stamp dynamically added elements:

```js
function tryBlurTextCheck(element, thorough) {
  if (!element || !(element instanceof Element)) return;
  if (element.dataset.blSiBlur || element.dataset.blSiPickBlur || element.dataset.blSiPii) return;
  if (_isExtensionUI(element)) return;
  const tag = element.tagName.toLowerCase();
  if (!_textCheckSet.has(tag)) return;
  const needsTextGate = _structuralTags.has(tag);
  if (needsTextGate) {
    if (hasMeaningfulTextContent(element)) element.dataset.blSiBlur = "1";
  } else if (thorough || hasMeaningfulTextContent(element) ||
             !!(element.querySelector && element.querySelector('slot'))) {
    element.dataset.blSiBlur = "1";
  }
}
```

This is a stripped-down version of the `stampElements` inner loop for a single element. Unlike `stampElements`, it does not:
- Clear stale stamps (MO only processes new nodes)
- Collect shadow roots (MO callback handles those directly via `handleShadowRoot()`)
- Handle custom elements (custom element hosts from MO mutations are handled separately)

The `_textCheckSet` is shared with `stampElements` and rebuilt by `_rebuildTextCheckSet()`. The MO callback reads `_currentSettings.thorough_blur` fresh on every idle invocation to stay up-to-date with settings changes.

---

## `shouldBlurElement(element, categories, thorough)` — Public Classification API

Used by `picker.js` to decide whether a hovered element should show the blur highlight. Not used during the stamp pass (that uses `_textCheckSet` for performance). Traverses `CATEGORY_SELECTORS` explicitly for clarity:

```js
function shouldBlurElement(element, categories, thorough) {
  if (!element || !(element instanceof Element)) return false;
  const cats = categories || DEFAULT_CATS;
  const tag = element.tagName.toLowerCase();

  for (const name of CATEGORY_ORDER) {
    if (!cats[name]) continue;
    const cat = CATEGORY_SELECTORS[name];
    if (cat.alwaysBlur.indexOf(tag) >= 0) return true;
    if (cat.textCheck.indexOf(tag) >= 0) {
      return thorough || hasMeaningfulTextContent(element);
    }
  }

  // Role-based check (after tag-based paths — native <button> matched by tag first)
  const { roleSet } = getSelectors(cats);
  if (roleSet.size > 0) {
    const role = element.getAttribute("role");
    if (role != null && roleSet.has(role)) return true;
  }
  return false;
}
```

Returns `true` if the element should be blurred by blur-all given the current categories and thorough setting. Called by picker hover highlight logic.

---

## `matchesActiveCategories(element, categories)` — Category Membership Check

A simpler check: does this element belong to any active category, ignoring the text gate?

```js
function matchesActiveCategories(element, categories) {
  if (!element || !(element instanceof Element)) return false;
  const cats = categories || DEFAULT_CATS;
  const { tagSet, roleSet } = getSelectors(cats);
  if (tagSet.has(element.tagName.toLowerCase())) return true;
  if (roleSet.size === 0) return false;
  const role = element.getAttribute("role");
  return role != null && roleSet.has(role);
}
```

Uses the cached `tagSet` for O(1) tag lookup. `tagSet` contains both `alwaysBlur` and `textCheck` tags from all active categories.

---

## Deferred Idle Stamp Queue

The stamp queue (`_stampQueue`) decouples CSS injection (synchronous) from the expensive DOM traversal (deferred):

```js
let _stampIdlePending = false;
let _stampQueue = [];  // [{root, cats, thorough, mode, settings}]

function _scheduleIdle(fn) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn, { timeout: 300 });
  } else {
    setTimeout(fn, 0);
  }
}

function _scheduleStampIdle() {
  if (_stampIdlePending) return;
  _stampIdlePending = true;
  _scheduleIdle(_flushStampQueue);
}

function _flushStampQueue(deadline) {
  _stampIdlePending = false;
  while (_stampQueue.length > 0) {
    if (deadline && deadline.timeRemaining() < 1) {
      _scheduleStampIdle();  // yield and resume next idle slice
      return;
    }
    const { root, cats, thorough, mode, settings } = _stampQueue.shift();
    const shadowRoots = stampElements(root, cats, thorough, mode);
    // Eager CSS + MO for discovered shadow roots; queue their stamp work
    for (const sr of shadowRoots) {
      injectRules(sr, cats, mode);
      observeRoot(sr);
      _stampQueue.push({ root: sr, cats, thorough, mode, settings });
    }
  }
}
```

**Key behaviors:**

1. **Queue replacement on reconcile:** `handleMainDocument()` replaces (not appends) the queue:
   ```js
   _stampQueue = [{ root: document, cats, thorough, mode, settings }];
   ```
   If settings change while an idle is pending, the pending idle picks up the new queue — so stale work from the previous settings is never executed.

2. **Queue append for shadow roots:** Shadow roots discovered during a stamp pass are appended to the queue (they are new work, not replacements).

3. **Deadline-aware yielding:** If `deadline.timeRemaining() < 1ms`, the flush yields and schedules a new idle to continue. This prevents monopolizing the browser's idle time on large DOMs.

4. **Timeout fallback:** `requestIdleCallback` is called with `{ timeout: 300 }` — the browser must execute the callback within 300ms even if there is no idle time. `setTimeout(fn, 0)` is the fallback for environments without `requestIdleCallback` (e.g., test environments with jsdom).

5. **Teardown queue cleanup:** `teardown(root)` filters the queue to remove pending work for the torn-down root:
   ```js
   _stampQueue = _stampQueue.filter(item => item.root !== root);
   ```
   This prevents a scenario where blur-all turns off, `teardown` clears all stamps, but a pending idle then re-stamps elements from the old queue.

---

## Stamp Ownership Guard (invariant)

A core invariant maintained throughout: **each element carries at most one blur attribute**.

The guard in `stampElements` and `tryBlurTextCheck`:
```js
if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return;
```

This ensures:
- Blur-all does not re-stamp pick-blur-owned elements (changing their visual mode unintentionally)
- Blur-all does not stamp PII-owned spans (PII spans must stay exclusively PII-managed)
- Idempotency: running `stampElements` twice on the same element is safe

**Adding a new competing blur system** requires adding the new attribute to this guard and to the `EXCLUDE` chain in `injectRules`. Both guards must stay in sync — the CSS guard prevents wrong-mode rendering; the JS guard prevents re-stamping.
