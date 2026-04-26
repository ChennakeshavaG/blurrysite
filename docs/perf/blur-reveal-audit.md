# Performance Audit: blur_engine + reveal_controller

Large-scale sites (infinite scroll, SPAs, 5k+ DOM nodes) surface 10 bottlenecks across `src/blur_engine.js`, `src/reveal_controller.js`, and `content_script.js`.

---

## HIGH

### 1. MutationObserver `querySelectorAll('*')` per inserted node
**`src/blur_engine.js:1101`** _(was 919–928)_

~~Every added node triggers `node.querySelectorAll('*')` over all its descendants synchronously per MO tick.~~

**Partially fixed.** MO callback is now synchronous-collect-only (`_pendingMoNodes.push`); all DOM work is deferred to a single `requestIdleCallback` that drains the full batch at once. Multiple rapid MO fires coalesce into one idle via `_moIdlePending` flag. The O(n²) synchronous block is gone.

**Fixed.** Before the idle loop, `raw` nodes are filtered with `raw.filter(n => !raw.some(other => other !== n && other.contains(n)))` — any node whose subtree is already covered by an ancestor in the same batch is dropped. `contains()` is a native O(1) DOM call; batch sizes are 5–30 nodes so the O(n²) filter is sub-millisecond. Guarantees each subtree is walked exactly once per idle drain regardless of how many MO ticks fired before the idle.

---

### 2. `onRevealMouseOver` — no throttle, `findBlurredTarget` on every event
**`src/reveal_controller.js` — `onRevealMouseOver`, `findBlurredTarget`**

**Still present.** No RAF flag, no frame-rate gating. Every `mouseover` calls `_findZoneAtPoint` (see #3) then `findBlurredTarget`. `findBlurredTarget` first walks the ancestor chain (cheap); if that returns null it falls back to `el.querySelectorAll(sel)` + `getBoundingClientRect()` per candidate (line 139–151). The fallback fires whenever the cursor is over a non-blurred wrapper element (common on blur-all pages).

**Fix:** Gate with a RAF flag — skip the event if a frame is already pending. Cache `(target → blurredEl)` for the frame duration.

---

### 3. `_findZoneAtPoint` — `getBoundingClientRect()` per zone per event
**`src/reveal_controller.js:233–244`**

**Still present.** `_findZoneAtPoint` calls `getBoundingClientRect()` on every zone on every `mouseover` and `click` (lines 237, called from lines 260 and 321). No caching. `getBoundingClientRect()` forces a layout flush when layout is dirty. With 20 zones this is 20 forced layouts per mouse event, compounding with issue #2.

**Fix:** Cache zone rects in a WeakMap; invalidate on scroll/resize via a debounced listener. Call `getBoundingClientRect()` only on cache miss.

---

### 4. Full-document stamp-clear on every `pageWideChanged` reconcile
**`src/blur_engine.js` — `stampElements`, `handleMainDocument`**

**Significantly mitigated.** Three improvements since the audit:
1. Separate `querySelectorAll('[data-bl-si-blur]')` pre-pass eliminated — stale stamps are cleared inline during the existing `querySelectorAll('*')` pass (line 527–529), so it's one scan not two.
2. The `querySelectorAll('*')` stamp work is now deferred to `requestIdleCallback` via `_stampQueue` — it no longer blocks the main thread synchronously.
3. `_lastReconcileKey` (line 951) skips `handleMainDocument` entirely when only CSS-var properties (radius, highlight, transition) changed — those propagate via CSS vars with zero DOM work.

**Still present:** On a genuine category toggle or mode change (`pageWideChanged = true`), a full `querySelectorAll('*')` over the document is still enqueued. With 5k elements this is still O(n) work, just deferred to idle. No `_stampedElements` Set tracking to enable O(tracked) targeted clear.

**Remaining fix:** Low priority given idle deferral. A `_stampedElements` Set would allow clearing only known-stamped elements instead of scanning all DOM nodes.

---

## MEDIUM

### 5. CSS rule injection — no content cache
**`src/blur_engine.js:315–324`**

**Partially fixed.** `_lastReconcileKey` (line 1344–1348) gates `handleMainDocument` at the `handleSite` level: if categories, mode, thorough, and (in frosted mode) radius are all unchanged, `pageWideChanged = false` and `injectRules` is never called. Radius-only changes in gaussian mode no longer cause a style element replace.

**Still present:** When `injectRules` IS called (genuine category or mode change), it always does `removeRules(root)` + fresh `<style>` append (line 316) with no per-root WeakMap cache. Two back-to-back calls with identical `(categories, mode)` inputs would still remove+recreate. In practice this is rare (mode/category changes are deliberate user actions), so the impact is low.

**Remaining fix (low priority):** WeakMap keyed by root → last injected `(categories, mode)` key. Skip remove+append on key match.

---

### 6. SVG filter fully rebuilt in frosted mode on every `injectRules` call
**`src/blur_engine.js:243–255`**

**Mostly fixed.** `_lastReconcileKey` folds `blur_radius` into the key for frosted mode (line 1345): `${mode}|...|${mode === frosted ? blur_radius : ''}`. A radius change in frosted mode now correctly triggers a full rebuild. In gaussian mode, radius changes are CSS-var-only and never reach `injectRules`.

**Still present:** `ensureSvgFilter` always removes + rebuilds the SVG element on every call (explicit comment at line 250: "mutating `feGaussianBlur.stdDeviation` in place does not reliably invalidate Chrome's filter cache"). The in-place mutation fix from the original audit was consciously rejected. Since `injectRules` is now gated by `_lastReconcileKey`, this rebuild only fires on genuine mode/category/radius changes — acceptable.

**No further action needed.**

---

### 7. SPA `pushState`/`replaceState` wrap — no debounce
**`src/content_script.js` — `history.pushState` / `history.replaceState` wraps**

**Still present.** No debounce. Each `pushState` call fires `onUrlChange()` immediately. `onUrlChange` has a same-URL guard (`if (currentUrl === lastUrl) return`) which prevents duplicate fires for identical URLs, but React/Next.js sometimes push different intermediary URLs during a single route transition — these each trigger a full `_sync()` + `applyState()`.

**Fix:** Debounce `onUrlChange` at 100–200 ms so rapid back-to-back calls (within one JS task) collapse to one reconcile.

---

### 8. `GET_STATUS` blurredCount via `querySelectorAll` on every popup open
**`src/content_script.js:327`**

**Fixed.** `_blurredCount` integer maintained in `blur_engine.js`. Incremented at every `blSiBlur` stamp site (`stampElements` custom-element + text-check paths, `tryBlurTextCheck` both branches, `applyBlur`, `handleIframe` active path). Decremented at every clear site (`stampElements` stale-clear, `teardown`, `removeBlur`, `handleIframe` inactive path). Both `handleIframe` paths guard with an attribute-presence check to avoid double-counting on repeated reconciles. Exposed as `get blurredCount()` on the public API. `content_script.js` GET_STATUS handler replaced with `Engine.blurredCount` — O(1) instead of O(n).

---

### 9. `_broadcastToFrames()` on every storage change — no guard
**`src/content_script.js:624–632`**

**Still present.** No early-return when `window.frames.length === 0`. Iterates all frames and `postMessage`s each on every `handleStorageChange` call (line 801) and every `init` (line 658). On pages with no iframes this is a trivial loop but on dashboards with 50+ iframes it's O(n) postMessages per storage write.

**Fix:** Add `if (!window.frames.length) return;` at the top of `_broadcastToFrames`.

---

## LOW

### 10. `_textCheckSet` rebuilt on every `injectRules` and `stampElements` call
**`src/blur_engine.js:324`, `521`**

**Still present.** `_rebuildTextCheckSet(cats)` is called unconditionally in both `injectRules` (line 324) and `stampElements` (line 521). `getSelectors(cats)` has a key-equality cache guard (line 192), but `_rebuildTextCheckSet` has none. With 10 shadow roots in the idle stamp queue, `stampElements` runs 10 times and rebuilds the Set 10 times with identical inputs.

`_lastReconcileKey` reduces `injectRules` call frequency but does not help `stampElements` (which is called per-root from `_flushStampQueue`).

**Fix:** Compare the incoming category key inside `_rebuildTextCheckSet` against a `_lastTextCheckKey` string; skip rebuild on match.

---

## Summary Table

| # | Severity | Status | File | Trigger | Remaining Impact |
|---|---|---|---|---|---|
| 1 | HIGH | **Fixed** | blur_engine.js | Infinite scroll / dynamic inserts | Ancestor dedup filter before idle loop |
| 2 | HIGH | **Still present** | reveal_controller.js | Rapid mouse movement | DOM walk + qSA per mouseover, no RAF gate |
| 3 | HIGH | **Still present** | reveal_controller.js:237 | Any hover/click with zones | getBCR forced layout × zone count per event |
| 4 | HIGH | Significantly mitigated | blur_engine.js | Category/mode change | O(n) idle scan remains; no _stampedElements Set |
| 5 | MEDIUM | Partially fixed | blur_engine.js:315 | Category/mode change | remove+recreate style on every injectRules call |
| 6 | MEDIUM | Mostly fixed | blur_engine.js:243 | Frosted radius change | Rebuild is intentional; gated by reconcileKey |
| 7 | MEDIUM | **Still present** | content_script.js | SPA navigation | Multiple reconciles per route transition |
| 8 | MEDIUM | **Fixed** | content_script.js:327 | Popup open | O(1) Engine.blurredCount getter |
| 9 | MEDIUM | **Still present** | content_script.js:624 | Any storage change | No early-exit when frames.length === 0 |
| 10 | LOW | **Still present** | blur_engine.js:324,521 | Any reconcile / stamp | Set rebuilt per shadow root in idle queue |
