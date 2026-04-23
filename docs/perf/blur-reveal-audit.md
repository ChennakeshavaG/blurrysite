# Performance Audit: blur_engine + reveal_controller

Large-scale sites (infinite scroll, SPAs, 5k+ DOM nodes) surface 10 bottlenecks across `src/blur_engine.js`, `src/reveal_controller.js`, and `content_script.js`.

---

## HIGH

### 1. MutationObserver `querySelectorAll('*')` per inserted node
**`src/blur_engine.js:919–928`**

Every added node triggers `node.querySelectorAll('*')` over all its descendants. A single infinite-scroll batch of 50 cards walks each card's subtree independently → O(n²) queries per MO tick.

**Fix:** Collect all added `Element` nodes from the full mutation batch first, then do one combined walk (TreeWalker or single `querySelectorAll`) over their union rather than per-node.

---

### 2. `onRevealMouseOver` — no throttle, `findBlurredTarget` on every event
**`src/reveal_controller.js:299–345`, `100–154`**

`mouseover` fires hundreds of times/sec. Each event calls `findBlurredTarget()` which walks the ancestor chain to `documentElement`, then falls back to `el.querySelectorAll(sel)` on the target's subtree. On a 1000-row blurred table, every hover fires a subtree `querySelectorAll`.

**Fix:** Gate with a RAF flag — skip the event if a frame is already pending. Cache `(target → blurredEl)` for the frame duration.

---

### 3. `_findZoneAtPoint` — `getBoundingClientRect()` per zone per event
**`src/reveal_controller.js:227–238`**

Called on both click and mouseover. `getBoundingClientRect()` forces a layout flush when layout is dirty. 20 zones = 20 forced layouts per mouse event.

**Fix:** Cache zone rects in a WeakMap; invalidate on scroll/resize via a debounced listener. Call `getBoundingClientRect()` only on cache miss.

---

### 4. Full-document stamp-clear on every `pageWideChanged` reconcile
**`src/blur_engine.js:993–995`, `~1017–1019`**

`handleMainDocument` and `handleShadowRoot` clear existing stamps via `querySelectorAll('[data-bl-si-blur]')` before re-stamping. On pages with 5k blurred elements this is a 20–50ms DOM scan per category toggle, mode change, or thorough-mode flip.

**Fix:** Maintain a `_stampedElements` Set in blur_engine. Clear only tracked elements rather than scanning the DOM.

---

## MEDIUM

### 5. CSS rule injection — no content cache
**`src/blur_engine.js:312–431`**

`injectRules()` always calls `removeRules()` + creates a new `<style>` even when only `blur_radius` changed (handled by CSS var, needs no reinject). `selectorCache` already gates `buildSelectors()`, but `injectRules` has no equivalent guard.

**Fix:** Key on `(categories, mode)` string — same key as `selectorCache`. Skip remove+append if the key matches the last injected key for that root (WeakMap per root).

---

### 6. SVG filter fully rebuilt in frosted mode on every `injectRules` call
**`src/blur_engine.js:242–286`**

`ensureSvgFilter()` removes the existing SVG filter and rebuilds the full SVG DOM structure unconditionally. Causes extra SVG parse + repaint on every radius change or blur toggle in frosted mode.

**Fix:** If the filter already exists and `feGaussianBlur.stdDeviation` matches the current radius, skip rebuild entirely. For radius-only changes, mutate `stdDeviation` in-place.

---

### 7. SPA `pushState`/`replaceState` wrap — no debounce
**`content_script.js:630–639`**

React/Next.js call `pushState` multiple times per route transition. Each triggers `onUrlChange()` → full `_sync()`. Three pushState calls = three full reconciliations.

**Fix:** Debounce `onUrlChange` at 100–200ms so rapid batches collapse to one reconcile.

---

### 8. `GET_STATUS` blurredCount via `querySelectorAll` on every popup open
**`content_script.js` GET_STATUS handler**

`document.querySelectorAll('[data-bl-si-blur]').length` is O(n) per popup open. 10k blurred elements → visibly slow popup.

**Fix:** Maintain a running counter in blur_engine — increment in `applyBlur`, decrement in `removeBlur`. Expose as `BlurEngine.blurredCount` getter; use it in GET_STATUS.

---

### 9. `_broadcastToFrames()` on every storage change — no guard
**`content_script.js:565–573`**

Iterates all `window.frames` and postMessages each on every model change. On dashboards with 50+ iframes this is O(n) per write.

**Fix:** Early-return if `window.frames.length === 0`. Cache and compare frame list between calls.

---

## LOW

### 10. `_textCheckSet` rebuilt on every `injectRules` call
**`src/blur_engine.js:321`**

`_rebuildTextCheckSet(cats)` runs unconditionally inside `injectRules`. Already redundant when `selectorCache.key` is unchanged — the set is already correct.

**Fix:** Only call `_rebuildTextCheckSet` when the category key changed (same guard as `getSelectors`).

---

## Summary Table

| # | Severity | File | Lines | Trigger | Impact |
|---|---|---|---|---|---|
| 1 | HIGH | blur_engine.js | 919–928 | Infinite scroll / dynamic inserts | O(n²) DOM queries |
| 2 | HIGH | reveal_controller.js | 299–345, 100–154 | Rapid mouse movement | DOM walk + querySelectorAll per event |
| 3 | HIGH | reveal_controller.js | 227–238 | Any hover/click with zones | Forced layout × zone count per event |
| 4 | HIGH | blur_engine.js | 993–995 | Category/mode change | Full-doc scan 20–50ms |
| 5 | MEDIUM | blur_engine.js | 312–431 | Any reconcile | Redundant style DOM mutation |
| 6 | MEDIUM | blur_engine.js | 242–286 | Frosted mode radius change | SVG parse + repaint |
| 7 | MEDIUM | content_script.js | 630–639 | SPA navigation | 3× reconcile per nav |
| 8 | MEDIUM | content_script.js | GET_STATUS | Popup open | O(n) query |
| 9 | MEDIUM | content_script.js | 565–573 | Any storage change | O(iframes) postMessages |
| 10 | LOW | blur_engine.js | 321 | Any reconcile | Redundant Set rebuild |
