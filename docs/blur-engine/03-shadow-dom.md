# Blur Engine — Shadow DOM Handling

Shadow DOM is treated as a first-class context by the blur engine. Every operation that works on `document` also works on individual `ShadowRoot` objects. This document explains why shadow DOM needs special treatment, how the engine discovers shadow roots, how CSS and observers are scoped per-root, and the known limitations.

---

## Why Shadow DOM Needs Special Treatment

CSS injected into `<head>` does NOT penetrate shadow boundaries by design. Shadow DOM creates an isolated style scope — an `<h1>` inside a shadow root will not match a CSS rule in `document.head`. This is the entire point of shadow DOM encapsulation.

Consequences for the blur engine:

1. **`injectRules(document, ...)` does nothing inside shadow roots.** A web component like `<my-dashboard>` that renders its content in a shadow root will not be blurred by the document-level CSS, even if `<h1>` is in the always-blur set.

2. **`querySelectorAll('*')` on `document` does NOT pierce shadow boundaries.** Elements inside shadow roots are not returned. A separate pass must be made for each shadow root.

3. **`MutationObserver` on `document.body` does NOT observe mutations inside shadow roots.** A separate observer must be registered on each shadow root.

The engine handles all three cases by treating each shadow root as an independent "root" — identical to how it treats `document`, but scoped to that shadow tree.

---

## The Root-Agnostic API

The key engineering insight is that the engine's injection target is `root.head ?? root`:

```js
function injectRules(root, categories, mode) {
  removeRules(root);
  if (mode === blsi.blur_modes.frosted) ensureSvgFilter(root);
  // ...
  const styleEl = document.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.textContent = rules.join("\n");
  (root.head ?? root).appendChild(styleEl);  // <── shadow-aware injection
}
```

- For `document`: `document.head ?? document` → `document.head` (injects into `<head>`)
- For a `ShadowRoot`: `shadowRoot.head ?? shadowRoot` → `shadowRoot` (injects into the shadow root itself, since `shadowRoot.head` is `undefined`)

Styles injected into a shadow root are automatically scoped to that shadow tree by the browser. The CSS selector `h1:not(...)` inside the shadow root's style only matches `<h1>` elements within that specific shadow tree.

The same pattern applies to `removeRules`, `injectPickBlurRules`, `removePickBlurRules`:
```js
function removeRules(root) {
  const container = root.head ?? root;
  const el = container.querySelector && container.querySelector('#' + STYLE_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
```

---

## CSS Custom Properties in Shadow DOM

CSS custom properties (`--bl-si-radius`, `--bl-si-highlight-color`, etc.) **inherit through shadow boundaries** by default. A shadow root inherits custom properties from its host element and ultimately from `:root`.

This means:
- `content_script.applySettingsToDom()` sets `--bl-si-radius` on `document.documentElement`
- Elements inside any shadow root inherit this value
- The `blur(var(--bl-si-radius, 10px))` reference in injected shadow-root styles resolves correctly

**No extra propagation is needed.** The engine does not need to set CSS variables inside each shadow root.

**Frosted mode exception:** The SVG filter is referenced via `url(#bl-si-frosted-filter)`. This ID reference is resolved within the *local* style scope. An SVG element in `document.body` cannot be referenced from inside a shadow root's CSS. So `ensureSvgFilter(root)` must inject the SVG into the shadow root's container:

```js
function ensureSvgFilter(root) {
  const container = (root && root !== document) ? root : document.body;
  // ...
  container.appendChild(svg);  // injects into shadow root for ShadowRoot case
}
```

When `injectRules(shadowRoot, cats, "frosted")` runs, it calls `ensureSvgFilter(shadowRoot)`, which injects the SVG directly into the shadow root. The shadow root's CSS then references `url(#bl-si-frosted-filter)` which resolves to the filter inside the shadow tree.

---

## Shadow Root Discovery

The engine discovers shadow roots through two paths:

### Path 1: Initial Stamp Pass (`stampElements`)

During the `querySelectorAll('*')` traversal, every element with a `.shadowRoot` is collected:

```js
root.querySelectorAll('*').forEach(el => {
  // ...
  if (el.shadowRoot) shadowRoots.push(el.shadowRoot);
  // ...
});
return shadowRoots;
```

This produces a flat list of all open shadow roots directly accessible from this root. It does NOT recurse — the caller handles each discovered shadow root, which will itself discover nested shadow roots during its own stamp pass.

After `stampElements` returns, `_flushStampQueue` processes the discovered shadow roots immediately:

```js
// In _flushStampQueue:
const shadowRoots = stampElements(root, cats, thorough, mode);
for (const sr of shadowRoots) {
  injectRules(sr, cats, mode);      // eager: CSS live now
  observeRoot(sr);                  // eager: MO wired
  _stampQueue.push({ root: sr, ... }); // queue: stamp pass deferred to idle
}
```

**Two-phase eagerness:** CSS injection and MO registration are synchronous (eager). The stamp pass (expensive `querySelectorAll('*')`) is queued for idle. This means new elements added to a shadow root before its idle fires are still captured by the MO (which is already running).

### Path 2: MutationObserver (`observeRoot` callback)

When a shadow host is dynamically inserted into a page (SPA rendering), the MO callback catches it:

```js
// In MO idle callback:
for (let n = 0; n < nodes.length; n++) {
  const node = nodes[n];
  tryBlurTextCheck(node, thorough);
  if (node.shadowRoot && _currentSettings && !_observers.has(node.shadowRoot)) {
    handleShadowRoot(_currentSettings, node.shadowRoot);  // ← new shadow root
  }
  // Also check children of the inserted node:
  const children = node.querySelectorAll('*');
  for (let i = 0; i < children.length; i++) {
    tryBlurTextCheck(children[i], thorough);
    if (children[i].shadowRoot && _currentSettings && !_observers.has(children[i].shadowRoot)) {
      handleShadowRoot(_currentSettings, children[i].shadowRoot);
    }
  }
}
```

The `!_observers.has(node.shadowRoot)` guard prevents double-initialization for shadow roots already observed.

---

## `handleShadowRoot(settings, shadowRoot)` — Shadow Root Activation

```js
function handleShadowRoot(settings, shadowRoot) {
  const active = settings.enabled !== false && !!settings.blur_all_active;
  if (!active) {
    teardown(shadowRoot);
    return;
  }

  const cats = settings.blur_categories || DEFAULT_CATS;
  const mode = settings.blur_mode || null;
  const thorough = !!settings.thorough_blur;

  injectRules(shadowRoot, cats, mode);         // synchronous: CSS live immediately
  observeRoot(shadowRoot);                     // synchronous: MO active before idle fires
  _stampQueue.push({ root: shadowRoot, cats, thorough, mode, settings });
  _scheduleStampIdle();                        // deferred: stamp pass in idle
}
```

**Active path (blur is ON):**
1. `injectRules(shadowRoot, ...)` — scoped CSS injected immediately
2. `observeRoot(shadowRoot)` — MO wired so new elements in this shadow root are stamped
3. Stamp pass queued — runs asynchronously in requestIdleCallback

**Inactive path (blur is OFF):**
`teardown(shadowRoot)` — removes CSS, disconnects MO, clears stamps in this shadow root and all nested shadow roots

The reason MO is wired before the idle stamp runs (step 2 before step 3): any content added to the shadow root between now and the idle will trigger the MO. Without the eager MO, such content would be missed by both the initial stamp (not yet run) and the MO (not yet set up).

---

## `observeRoot(root)` — Per-Root MutationObserver

```js
function observeRoot(root) {
  if (_observers.has(root)) return;  // idempotent guard

  const target = root.body ?? root;  // document.body or the shadow root itself
  if (!target) return;

  const obs = new MutationObserver((mutations) => {
    if (_pickerActive || !_isPageBlurred) return;
    // ... collect + defer to idle ...
  });

  obs.observe(target, { childList: true, subtree: true });
  _observers.set(root, obs);
}
```

**Target selection:** For `document`, the observer watches `document.body` (ignores `<head>` changes). For a shadow root, `shadowRoot.body` is `undefined`, so the shadow root itself is the target.

**Observation options:**
- `childList: true` — notified when elements are added/removed
- `subtree: true` — watches the entire subtree under the target, not just direct children

**WeakMap storage:** `_observers` is a `WeakMap<root, MutationObserver>`. When a shadow host is removed from DOM and GC'd (no more references), the WeakMap entry for its shadow root is automatically removed. This prevents memory leaks from accumulated MO instances for transient shadow roots (e.g., dialog components that open and close).

---

## `disconnectObserver(root)` — Observer Teardown

```js
function disconnectObserver(root) {
  const obs = _observers.get(root);
  if (obs) {
    obs.disconnect();
    _observers.delete(root);
  }
}
```

Called by `teardown(root)` during the inactive path. Also idempotent — calling on a root without an observer is a no-op.

The WeakMap auto-GC handles the case where a shadow root disappears from DOM naturally (no explicit disconnect needed in that case). `disconnectObserver` is for the controlled disable case.

---

## `teardown(root)` — Recursive Shadow Root Cleanup

```js
function teardown(root) {
  // 1. Cancel pending idle work for this root
  _stampQueue = _stampQueue.filter(item => item.root !== root);

  // 2. Disconnect observer
  disconnectObserver(root);

  // 3. Remove injected styles
  removeRules(root);
  removePickBlurRules(root);

  // 4. ONE pass: clear stamps + collect shadow hosts
  const shadowHosts = [];
  root.querySelectorAll('*').forEach(el => {
    if (el.dataset.blSiBlur && !el.dataset.blSiPii) delete el.dataset.blSiBlur;
    if (el.dataset.blSiPickBlur) delete el.dataset.blSiPickBlur;
    if (el.shadowRoot) shadowHosts.push(el);  // collect for post-loop recursion
  });

  // 5. Remove SVG filter (frosted mode artifact)
  const svg = root.querySelector && root.querySelector('#' + SVG_FILTER_ID);
  if (svg && svg.parentNode) svg.parentNode.removeChild(svg);

  // 6. Recurse into shadow roots (after this root is fully cleaned)
  shadowHosts.forEach(h => teardown(h.shadowRoot));
}
```

**Collect-then-recurse pattern:** Shadow hosts are collected into an array during the `forEach` pass, then teardown is called on their shadow roots after the main root's stamp clearing is complete. This top-down order ensures parents are cleaned before children — a child shadow root teardown happening while the parent's stamps are still active could leave inconsistent state.

**PII stamps preserved:** `!el.dataset.blSiPii` guard — PII spans carry `data-bl-si-pii` and own their own blur lifecycle. Teardown of blur-all does not affect PII.

**Idle queue cleanup:** Step 1 filters out pending stamp work for this root. Without this, a pending idle could re-stamp elements in a root that has already been torn down:
- User enables blur → stamp queued for idle
- User disables blur → teardown runs, clears stamps, disconnects MO
- Idle fires → stamping elements again (incorrectly)

---

## Nested Shadow Trees

Shadow roots can be nested — a shadow root can host an element that itself has a shadow root. Teardown handles arbitrary nesting depth via recursion:

```js
// teardown of outer root collects inner shadow hosts:
shadowHosts.forEach(h => teardown(h.shadowRoot));
// teardown of inner shadow root collects any further nested shadow hosts:
// (same recursion)
```

Discovery during stamp passes is also recursive: when `stampElements(outerRoot, ...)` runs, it discovers inner shadow roots and returns them. The caller (`_flushStampQueue`) then pushes inner shadow roots to the queue. When those inner roots are processed in subsequent idle slices, their own `stampElements` discovers any deeper shadow roots.

The depth of recursion is bounded by the nesting depth of shadow DOM in the page. In practice, 2–3 levels is the maximum for most web components.

---

## Shadow Root Isolation vs. Cross-Root Features

### Reveal (works across shadow roots)
`reveal_controller.js` handles reveal by walking `composedPath()` and `getRootNode()` to cross shadow boundaries. See `07-reveal-system.md` for the full algorithm. The reveal attribute (`data-bl-si-reveal`) is set on elements across shadow roots, and the CSS `[data-bl-si-reveal]` rule in each shadow root's injected style handles the visual effect within that root's scope.

### Picker (cannot reach into shadow roots — Phase 2)
The picker uses `event.target` which is retargeted to the shadow host at the shadow boundary. The picker cannot access elements inside shadow roots directly. This is documented as a known limitation — Phase 2 will address it.

### `isBlurred(el)` — cross-root limitation
`isBlurAllActive()` checks `document.head.querySelector('#bl-si-blur-styles')`. This detects whether blur-all CSS is active in the main document, but does not detect whether blur-all CSS is active in a specific shadow root. For elements inside shadow roots, `isBlurred` returns false for always-blur tag matches even if the shadow root's own injected style is blurring them.

---

## Known Limitations

| Limitation | Root cause | Status |
|---|---|---|
| Picker cannot target elements in shadow roots | `event.target` retargeting at shadow boundary | Phase 2 |
| `isBlurred()` returns false for shadow-root tag-blurred elements | `isBlurAllActive()` only checks `document.head` | Phase 2 |
| PII detection not shadow-root-aware | `pii_detector.js` uses `TreeWalker` on `document` only | Phase 2 |
| Cross-origin iframes treated as black boxes | Cannot access cross-origin DOM; stamped as opaque `[data-bl-si-blur]` elements | Intentional |
