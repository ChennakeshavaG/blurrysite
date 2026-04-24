# Blur Engine — Reveal System

The reveal system allows users to temporarily un-blur content via hover or click. It is implemented entirely in `src/reveal_controller.js` and works purely through CSS attribute manipulation — no inline styles. This document covers the reveal architecture, hover and click mechanics, the ancestor chain resolution, and shadow DOM piercing.

---

## Architecture: Attribute-Driven CSS

Reveal does not set inline `style.filter = 'none'`. Instead, it stamps `data-bl-si-reveal="1"` on elements:

```js
function _revealElement(el) {
  el.dataset.blSiReveal = '1';
}
```

CSS rules in `styles/content.css` (static) and the injected `#bl-si-blur-styles` (when blur-all is ON) handle the visual effect:

```css
[data-bl-si-reveal] {
  filter: none !important;
  visibility: visible !important;  /* for redacted-mode media */
  font-family: unset !important;   /* for censored/starred modes */
  user-select: auto !important;
  transition: filter var(--bl-si-transition-duration, 150ms) ease !important;
}
```

**Why attribute-driven, not inline styles:**
1. No specificity war — `!important` on the attribute rule beats all blur rules without needing per-mode inline style values
2. No mode knowledge required — the CSS overrides work for all blur modes (gaussian, frosted, redacted, censored) because each property resets what its mode set
3. Clean removal — removing `data-bl-si-reveal` attribute restores blur immediately; no inline style cleanup needed

**Known trade-off:** `background-color: transparent` in the reveal CSS may strip legitimate element backgrounds during reveal (e.g., a styled button revealed in color mode). Acceptable because reveal is always temporary (hover/click).

---

## Initialization

```js
// In content_script.js:
Reveal.init({
  getMode: () => settings.reveal_mode,      // function, not value
  isPickerActive: () => isPickerActive,      // function, not value
});
```

**Functions, not values:** `getMode` and `isPickerActive` are passed as functions so the reveal controller always reads the current state without needing to be re-initialized when settings change. On every event handler invocation, it calls `_getMode()` to get the current reveal mode — so changing reveal mode from 'hover' to 'click' takes effect immediately without a re-init.

Listeners are registered at **document level** with `capture: true` (for hover) or `bubble: false` (for click):
- `mouseover` — capture phase (fires before the element's own handler)
- `mouseout` — capture phase
- `click` — bubble phase (fires after the element's own handler, but `stopImmediatePropagation` is called on first-click to prevent action)
- `keydown` — for Escape to dismiss click-reveal

---

## Three Reveal Modes

| Mode | Behavior | CSS Used |
|---|---|---|
| `'hover'` | Element un-blurs when hovered; re-blurs when mouse leaves (50ms debounce) | `[data-bl-si-reveal]` set on mouseover, removed on mouseout |
| `'click'` | First click reveals; second click acts (navigation, form submit, etc.) | Same attribute; cleared on click outside |
| `'none'` | Reveal disabled; no mouse events handled | — |

---

## Hover Reveal

### `onRevealMouseOver(event)`

```js
function onRevealMouseOver(e) {
  if (_getMode() !== RM.hover) return;
  if (_getPickerActive()) return;

  // composedPath pierces shadow DOM retargeting
  const target = (e.composedPath && e.composedPath()[0] instanceof Element)
    ? e.composedPath()[0] : e.target;

  // Zone overlay hit-test takes priority
  const zone = _findZoneAtPoint(e.clientX, e.clientY);
  if (zone) {
    if (mouseoutTimer) { clearTimeout(mouseoutTimer); mouseoutTimer = null; }
    if (_hoverRevealedEl === zone) return;
    _dismissHoverReveal();
    _revealElement(zone);
    _hoverRevealedEl = zone;
    return;
  }

  // Find nearest blurred ancestor
  const blurredRoot = findBlurredTarget(target, e.clientX, e.clientY);
  if (!blurredRoot) return;

  if (mouseoutTimer) { clearTimeout(mouseoutTimer); mouseoutTimer = null; }

  if (_hoverRevealedEl && _hoverRevealedEl !== blurredRoot) {
    _dismissHoverReveal();
  }
  if (_hoverRevealedEl === blurredRoot) return;

  _revealElement(blurredRoot);
  _hoverRevealedEl = blurredRoot;
  revealAncestorChain(blurredRoot);
}
```

**Zone priority:** Zone overlays are checked first via coordinate hit-testing. Zone overlays use `pointer-events: none`, so `event.target` won't be the zone — only `getBoundingClientRect` hit-testing catches them.

**Dismiss-before-reveal:** If a different element was previously revealed (`_hoverRevealedEl && _hoverRevealedEl !== blurredRoot`), it is dismissed before revealing the new element. This prevents multiple simultaneously-revealed elements.

**Idempotency:** If the same element is hovered again (`_hoverRevealedEl === blurredRoot`), the handler returns without re-setting the attribute.

### 50ms Mouseout Debounce

```js
function onRevealMouseOut(_e) {
  if (!_hoverRevealedEl) return;
  if (mouseoutTimer) clearTimeout(mouseoutTimer);
  mouseoutTimer = setTimeout(() => {
    mouseoutTimer = null;
    _dismissHoverReveal();
  }, 50);
}
```

**Why 50ms debounce:** `mouseover`/`mouseout` fire on every element boundary crossing. When the cursor moves from a blurred `<p>` to a child `<span>` inside it, a `mouseout` fires on the `<p>` followed immediately by a `mouseover` on the `<span>`. Without debouncing, the `<p>` would be revealed and immediately re-blurred, causing a flicker.

The 50ms delay allows the subsequent `mouseover` on the child element to arrive and cancel the debounce timer. If no subsequent `mouseover` arrives within 50ms (cursor truly left the blurred area), the dismiss executes.

### `_dismissHoverReveal()`

```js
function _dismissHoverReveal() {
  if (_hoverRevealedEl) {
    delete _hoverRevealedEl.dataset.blSiReveal;
    clearRevealedAncestors();
    _hoverRevealedEl = null;
  }
}
```

Removes `data-bl-si-reveal` from the element and clears the ancestor chain.

---

## Click Reveal

### `onRevealClick(event)` — Two-Click Pattern

```js
function onRevealClick(e) {
  if (_getMode() !== RM.click) return;
  if (_getPickerActive()) return;
  // Skip interactive element handling
  if (['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target.tagName)) return;

  const target = (e.composedPath && e.composedPath()[0] instanceof Element)
    ? e.composedPath()[0] : e.target;

  // Zone hit-test
  const zone = _findZoneAtPoint(e.clientX, e.clientY);
  if (zone) {
    if (zone === clickRevealedEl) {
      _redirectIfBlankLink(target, e);  // second click: let action proceed
      return;
    }
    dismissClickReveal();
    _revealElement(zone);
    clickRevealedEl = zone;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    return;
  }

  const blurredEl = findBlurredTarget(target, e.clientX, e.clientY);

  // Click inside already-revealed area: let the action proceed
  if (clickRevealedEl && (blurredEl === clickRevealedEl ||
      (clickRevealedEl.contains && clickRevealedEl.contains(target)))) {
    _redirectIfBlankLink(target, e);
    return;
  }

  // Click outside blurred element: dismiss
  if (!blurredEl) {
    dismissClickReveal();
    return;
  }

  // First click on blurred element: reveal, intercept
  dismissClickReveal();
  _revealElement(blurredEl);
  clickRevealedEl = blurredEl;
  revealAncestorChain(blurredEl);
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
}
```

**Two-click semantics:**
- **First click on blurred element:** Reveals it. The click is intercepted (`preventDefault` + `stopPropagation`) — no navigation, no form action.
- **Second click on revealed element:** Passes through. `_redirectIfBlankLink` handles `target="_blank"` links.
- **Click outside revealed element:** Dismisses reveal.

**Why intercept the first click:** Blurred content may contain links, buttons, form inputs. Clicking a blurred link should show the content first, not navigate away. The user should see what they're clicking before acting.

**Skip interactive elements:** `INPUT`, `TEXTAREA`, `SELECT`, `BUTTON` are excluded from the handler. These elements' click behavior is important — a checkbox should toggle, an input should focus. Intercepting these would break form interactions.

### `_redirectIfBlankLink(target, event)`

```js
function _redirectIfBlankLink(target, e) {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  var node = target;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLAnchorElement && node.href &&
        (node.target === '_blank' || node.target === '_new')) {
      e.preventDefault();
      window.location.assign(node.href);
      return;
    }
    node = node.parentElement;
  }
}
```

`target="_blank"` links inside revealed content open in a new tab by default. This can be disorienting when the user is trying to navigate content inside the current page. The redirect function intercepts blank-target link clicks (left button, no modifier) and navigates in the same tab instead.

**Modifier keys preserved:** If the user explicitly holds Ctrl/Meta/Shift (opening in new tab/window intentionally), the redirect is skipped.

---

## `findBlurredTarget(element, cx, cy)` — Nearest Blurred Ancestor

```js
function findBlurredTarget(el, cx, cy) {
  // Walk up the parent chain
  let node = el;
  while (node && node !== document.documentElement) {
    if (Engine.isVisuallyBlurred(node)) return node;
    node = node.parentElement;
  }
  // Also check zone overlays at the cursor position
  return _findZoneAtPoint(cx, cy);
}
```

Walks from the hovered/clicked element upward through its ancestors, checking `Engine.isVisuallyBlurred()` at each level. Returns the first blurred ancestor it finds.

**Why `isVisuallyBlurred` instead of `isBlurred`:** `isVisuallyBlurred` returns true for role-matched elements (e.g., `<div role="button">`) that are blurred by CSS but have no `data-bl-si-blur` attribute. Without this, a blur-all page with the FORM category enabled would fail to reveal clicks on `<div role="button">` elements — the ancestor walk would skip them.

---

## `revealAncestorChain(el)` — Clearing Parent Filters

This is the most important function for making reveal work correctly inside nested blur contexts.

```js
function revealAncestorChain(el) {
  clearRevealedAncestors();

  // ── Light DOM walk: up through parentElement chain ──
  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    if (_isVisuallyBlurred(node)) {
      node.dataset.blSiReveal = '1';
      revealedAncestors.push(node);
    }
    node = node.parentElement;
  }

  // ── Shadow DOM walk: cross shadow host boundaries ──
  var root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    var host = root.host;
    if (_isVisuallyBlurred(host)) {
      host.dataset.blSiReveal = '1';
      revealedAncestors.push(host);
    }
    var hostParent = host.parentElement;
    while (hostParent && hostParent !== document.documentElement) {
      if (_isVisuallyBlurred(hostParent)) {
        hostParent.dataset.blSiReveal = '1';
        revealedAncestors.push(hostParent);
      }
      hostParent = hostParent.parentElement;
    }
    root = host.getRootNode();
  }
}
```

**Why ancestor chain reveal is necessary:**

CSS `filter` creates a *stacking context*. When a parent element has `filter: blur(10px)`, all its descendants are composited into a single texture before the filter is applied. This means a child's `filter: none !important` does NOT escape the parent's filter — the child is blurred as part of the parent's composited output.

Example:
```html
<div class="blurred" style="filter: blur(10px)">
  <p class="revealed" style="filter: none !important">
    Still blurred because parent's filter applies to entire subtree
  </p>
</div>
```

To actually reveal `<p>`, the `<div>` must also have `filter: none`. `revealAncestorChain` does this by stamping `[data-bl-si-reveal]` on every blurred ancestor.

**The ancestor list:** `revealedAncestors` tracks all elements stamped by this call. When `clearRevealedAncestors()` runs (on dismiss or mode change), it removes `data-bl-si-reveal` from all of them:

```js
function clearRevealedAncestors() {
  for (var i = 0; i < revealedAncestors.length; i++) {
    delete revealedAncestors[i].dataset.blSiReveal;
  }
  revealedAncestors.length = 0;
}
```

---

## Shadow DOM Piercing

### Why `composedPath()[0]` Instead of `event.target`

Shadow DOM retargeting: when an event fires inside a shadow root, `event.target` is *retargeted* to the shadow host from the perspective of listeners outside the shadow root. This means a click on a `<span>` inside `<my-component>` shows `event.target === myComponentElement`, not the actual `<span>`.

```js
const target = (e.composedPath && e.composedPath()[0] instanceof Element)
  ? e.composedPath()[0] : e.target;
```

`composedPath()` returns the full event path including elements inside shadow roots, piercing shadow boundaries. `composedPath()[0]` is the actual deepest target of the event, even if it's inside a shadow root.

This allows `findBlurredTarget` to start from the correct element when hovering inside a web component.

### Ancestor Chain Across Shadow Boundaries

The shadow DOM walk in `revealAncestorChain`:

```js
var root = el.getRootNode();
while (root instanceof ShadowRoot) {
  var host = root.host;    // the shadow host element (in light DOM)
  // stamp host and its light-DOM ancestors
  ...
  root = host.getRootNode();  // move up to the next outer shadow root or document
}
```

`el.getRootNode()` returns either `document` (if the element is in the main DOM) or the containing `ShadowRoot`. If the element is inside a shadow root, the loop:
1. Gets the shadow host
2. Stamps the host if it's visually blurred
3. Walks the host's parentElement chain
4. Gets the root of the host (which may itself be inside another shadow root)
5. Repeats

This handles arbitrary nesting of shadow roots.

---

## `clearAll()` — Full Reveal State Reset

```js
function clearAll() {
  _dismissHoverReveal();
  dismissClickReveal();
  clearRevealedAncestors();
  if (_hoverRevealedEl) {
    delete _hoverRevealedEl.dataset.blSiReveal;
    _hoverRevealedEl = null;
  }
  if (mouseoutTimer) {
    clearTimeout(mouseoutTimer);
    mouseoutTimer = null;
  }
  // Also remove data-bl-si-reveal from all elements in the document
  document.querySelectorAll('[data-bl-si-reveal]').forEach(el => {
    delete el.dataset.blSiReveal;
  });
}
```

Called by:
- `content_script.applyState()` on `reveal_mode` change — clearing old reveal state before setting up new mode
- `content_script.applyState()` when extension is disabled (`settings.enabled === false`)

The `querySelectorAll('[data-bl-si-reveal]')` sweep catches any elements that were revealed but not tracked in `revealedAncestors` (edge cases from rapid state changes).

---

## `destroy()` — Full Cleanup

```js
function destroy() {
  clearAll();
  document.removeEventListener('mouseover', onRevealMouseOver, true);
  document.removeEventListener('mouseout', onRevealMouseOut, true);
  document.removeEventListener('click', onRevealClick, false);
  document.removeEventListener('keydown', onRevealKeyDown, false);
}
```

Removes all event listeners. Called only on extension disable path.

---

## Zone Overlay Reveal Interaction

Zone overlays have `pointer-events: none` by default, so mouse events pass through to page content underneath. The reveal controller handles zones through explicit coordinate hit-testing:

```js
function _findZoneAtPoint(cx, cy) {
  const zones = Engine.getZoneOverlays();
  for (const zone of zones) {
    const rect = zone.getBoundingClientRect();
    if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
      return zone;
    }
  }
  return null;
}
```

Zone reveal uses `data-bl-si-reveal` on the zone overlay element itself:
```css
/* In content.css: */
.bl-si-zone-overlay[data-bl-si-reveal] {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background: transparent !important;
  background-color: transparent !important;
}
```

This clears both `backdrop-filter` (gaussian/frosted mode) and `background` (color mode) — a single reveal rule covers all zone overlay visual modes.

---

## Reveal Mode Summary

```
USER HOVERS over blurred element
         ↓
onRevealMouseOver
  ├─ mode === 'hover'? yes
  ├─ picker active? no
  ├─ zone at point? → reveal zone, return
  ├─ findBlurredTarget(target) → blurredEl
  ├─ _revealElement(blurredEl)    → data-bl-si-reveal="1"
  └─ revealAncestorChain(blurredEl) → stamp ancestors

USER MOVES MOUSE AWAY
         ↓
onRevealMouseOut (50ms debounce)
  └─ _dismissHoverReveal() → delete data-bl-si-reveal

USER CLICKS blurred element (click mode)
         ↓
onRevealClick (first click)
  ├─ findBlurredTarget(target) → blurredEl
  ├─ _revealElement(blurredEl)    → data-bl-si-reveal="1"
  ├─ revealAncestorChain(blurredEl)
  └─ e.preventDefault() + stopPropagation()

USER CLICKS inside revealed element (click mode)
         ↓
onRevealClick (second click)
  ├─ clickRevealedEl.contains(target)? yes
  ├─ _redirectIfBlankLink(target, e)
  └─ let click proceed normally

USER CLICKS outside revealed element (click mode)
         ↓
onRevealClick
  └─ dismissClickReveal() → delete data-bl-si-reveal from all
```
