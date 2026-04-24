# Blur Engine — MutationObserver

SPAs continuously insert and remove DOM elements after the initial page load. The MutationObserver (MO) system ensures that new elements added after the initial stamp pass are blurred correctly. This document covers the observer setup, the two-phase callback (synchronous collection + async idle flush), all gating conditions, and the idle queue management.

---

## Why a MutationObserver is Needed

The initial stamp pass (`stampElements`) runs during `requestIdleCallback` after `handleMainDocument()` is called. Between page load and that idle, and throughout the page's lifetime as SPAs render new content, elements are continuously added to the DOM.

The always-blur CSS rules (for tags like `h1`, `p`, `img`) handle themselves — CSS is a live query; any `<h1>` added at any time matches the injected CSS rule immediately.

But text-check elements (`<div>`, `<span>`, `<a>`, etc.) need JS inspection to determine if they have meaningful text content before being stamped with `data-bl-si-blur`. A `<span>` added by a React re-render won't be blurred until the MO catches it.

---

## `observeRoot(root)` — Setup

```js
function observeRoot(root) {
  if (_observers.has(root)) return;  // idempotent: only one observer per root

  const target = root.body ?? root;  // document.body or the shadow root itself
  if (!target) return;               // guard: body may not exist in early readyState

  const obs = new MutationObserver((mutations) => {
    // ... callback (see below) ...
  });

  obs.observe(target, { childList: true, subtree: true });
  _observers.set(root, obs);
}
```

**Observation target selection:**
- `document.body ?? document` → `document.body` (watches the body subtree; ignores `<head>` changes)
- `shadowRoot.body ?? shadowRoot` → `shadowRoot` (shadow roots have no `.body` property; watch the root itself)

**Observation options:**
- `childList: true` — notify on element insertions and removals
- `subtree: true` — watch the entire subtree under the target, not just direct children
- `attributes: false` (default, not specified) — do not notify on attribute changes
- `characterData: false` (default) — do not notify on text changes

Only `childList` is watched because the engine stamps based on presence of elements and text content. Attribute changes (class changes, etc.) don't affect stamp decisions. Text content changes inside already-stamped elements don't need re-evaluation (the stamp is already applied).

**WeakMap storage:** `_observers.set(root, obs)` stores the observer keyed by the root. WeakMap ensures that when a shadow root is GC'd (its host element removed from DOM and all references released), the WeakMap entry is automatically removed — no memory leak from accumulated stale observers.

**Idempotency:** `if (_observers.has(root)) return` prevents double-registration. Calling `observeRoot` on the same root twice is safe.

---

## MO Callback — Two-Phase Design

The callback is intentionally split into two phases: a fast synchronous phase (collect node references) and a deferred async phase (process those nodes in idle).

### Phase 1: Synchronous Collection

```js
const obs = new MutationObserver((mutations) => {
  // ── Gate 1: Picker active or blur-all off → skip entirely
  if (_pickerActive || !_isPageBlurred) return;

  // ── Synchronous part: collect added nodes only, no DOM queries
  let collected = false;
  for (const mutation of mutations) {
    if (mutation.type !== 'childList') continue;
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // Skip zone overlays (our own injected divs, not page content)
      if (node.dataset && node.dataset.blSiZone !== undefined) continue;
      _pendingMoNodes.push(node);
      collected = true;
    }
  }
  if (!collected) return;  // no element nodes added → nothing to process

  // ── Schedule idle (one per batch) ──
  if (!_moIdlePending) {
    _moIdlePending = true;
    _scheduleIdle(() => {
      // Phase 2: executed in idle
      // ...
    });
  }
});
```

**Why synchronous collection is fast:** The synchronous phase only pushes node references to `_pendingMoNodes`. No DOM queries (`querySelectorAll`, `getBoundingClientRect`, etc.) are performed. MO callbacks must be fast to avoid delaying browser rendering.

**Zone overlay filtering:** Zone overlays (`<div data-bl-si-zone="...">`) are injected by the engine itself. Without this guard, the MO would observe the overlay being appended to `document.body` and try to stamp it as a blur target.

**Mutation type filter:** `mutation.type !== 'childList'` skips character data and attribute mutations. Only element additions are relevant for stamping.

**Only addedNodes, not removedNodes:** Removed elements don't need processing — their stamps are cleared by `teardown()` when blur-all turns off. There's no need to track individual element removals.

---

### Phase 2: Idle Callback

```js
_scheduleIdle(() => {
  _moIdlePending = false;

  // Re-check gate (state may have changed since MO fired)
  if (!_isPageBlurred) {
    _pendingMoNodes.length = 0;
    return;
  }

  // Read thorough_blur fresh from current settings (not closure-captured)
  const thorough = _currentSettings ? !!_currentSettings.thorough_blur : false;

  // Drain pending nodes
  const nodes = _pendingMoNodes.splice(0);

  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n];

    // Stamp the node itself
    tryBlurTextCheck(node, thorough);

    // Handle dynamically attached shadow roots
    if (node.shadowRoot && _currentSettings && !_observers.has(node.shadowRoot)) {
      handleShadowRoot(_currentSettings, node.shadowRoot);
    }

    // Handle newly inserted cross-origin iframes
    if (node.tagName === 'IFRAME' && _currentSettings) {
      handleIframe(_currentSettings, node);
    }

    // Stamp children of the inserted node
    const children = node.querySelectorAll('*');
    for (let i = 0; i < children.length; i++) {
      tryBlurTextCheck(children[i], thorough);

      // Handle shadow roots nested inside inserted subtrees
      if (children[i].shadowRoot && _currentSettings && !_observers.has(children[i].shadowRoot)) {
        handleShadowRoot(_currentSettings, children[i].shadowRoot);
      }

      // Handle iframes nested inside inserted subtrees
      if (children[i].tagName === 'IFRAME' && _currentSettings) {
        handleIframe(_currentSettings, children[i]);
      }
    }
  }
});
```

**Why deferred to idle:** The `querySelectorAll('*')` call on inserted subtrees can be expensive for large subtrees (SPA inserting a full table, a modal, a sidebar). Deferring to `requestIdleCallback` prevents blocking paint and layout.

**Batch processing:** All nodes accumulated in `_pendingMoNodes` since the last idle are processed in one idle callback. Multiple rapid DOM mutations (a SPA inserting 50 elements) produce one idle callback, not 50.

**Fresh settings read:** `_currentSettings.thorough_blur` is read inside the idle callback, not captured in the closure when the MO fires. If settings changed between the mutation and the idle, the idle processes with the current settings:
```js
const thorough = _currentSettings ? !!_currentSettings.thorough_blur : false;
```

**Shadow root discovery:** New custom elements inserted by SPAs may have shadow roots. `!_observers.has(node.shadowRoot)` prevents double-registration for shadow roots already set up during the initial stamp pass.

**Iframe discovery:** Cross-origin iframes dynamically inserted by SPAs are handled via `handleIframe()`, which stamps them with `data-bl-si-blur="1"` if blur-all is active.

**`_pendingMoNodes.splice(0)`:** Drains the array atomically. If the MO fires again during the idle callback's execution (before the loop completes), new nodes are pushed to `_pendingMoNodes` but won't be processed by the current idle (they were spliced out). The next idle callback will process those new nodes.

---

## Gate 1: `_pickerActive`

```js
if (_pickerActive || !_isPageBlurred) return;  // at top of synchronous phase
```

When the picker is active, the MO callback early-returns without collecting any nodes.

**Why this gate exists:** The picker works by hovering over elements and highlighting them before the user clicks to blur. If the MO were active during this interaction, it might stamp hover-preview elements (context menus, dropdowns, tooltips) with `data-bl-si-blur` before the user has a chance to inspect them. This would make the preview look blurred during picking — confusing and incorrect behavior.

`_pickerActive` is set by `_setPickerActiveForObserver(bool)`, called from `content_script.setPickerActive()` which atomically updates three flags (content_script state + shortcut_handler state + blur_engine MO gate).

---

## Gate 2: `_isPageBlurred`

```js
if (_pickerActive || !_isPageBlurred) return;  // synchronous gate

// And in idle:
if (!_isPageBlurred) {
  _pendingMoNodes.length = 0;
  return;
}
```

When blur-all is not active, the MO callback skips processing entirely. Even if nodes were collected before the idle ran, the idle checks again and clears the pending queue.

**Why both gates:** The synchronous gate prevents collection when blur-all is known to be off at MO-fire time. But blur-all might turn off *after* the MO fires and *before* the idle runs. The idle re-check ensures no stamping occurs in that race window.

---

## `_pendingMoNodes` — Batching Buffer

```js
const _pendingMoNodes = [];
```

Global accumulator for nodes collected by the MO callback, awaiting processing by the idle.

**Not cleared between idle invocations:** Nodes from multiple MO callbacks accumulate until the idle drains them with `splice(0)`. If the idle fires while new nodes are being added (concurrent MO callbacks during the idle execution), the new nodes wait for the next idle.

**Race safety:** `splice(0)` is atomic for JavaScript's single-threaded execution model. The MO callback and idle callback cannot overlap — they are both JavaScript microtasks/macrotasks, sequenced by the event loop.

---

## `_moIdlePending` — Idle Request Deduplication

```js
let _moIdlePending = false;
```

Prevents scheduling multiple `requestIdleCallback` requests for the same batch of pending nodes.

```js
if (!_moIdlePending) {
  _moIdlePending = true;
  _scheduleIdle(() => {
    _moIdlePending = false;
    // ... process nodes ...
  });
}
```

If the MO fires 50 times in rapid succession (SPA inserting content), only one idle is scheduled. All 50 batches of nodes accumulate in `_pendingMoNodes` and are drained by the single idle callback. `_moIdlePending = false` is reset inside the idle so the next batch after the idle completes can schedule another idle.

---

## `_scheduleIdle(fn)` — Cross-Environment Idle Scheduling

```js
function _scheduleIdle(fn) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn, { timeout: 300 });
  } else {
    setTimeout(fn, 0);
  }
}
```

`requestIdleCallback` is preferred — it fires when the browser has idle time (not blocking user input). The `{ timeout: 300 }` fallback forces execution within 300ms even if there is no idle time. This prevents indefinite delay on pages with no idle time (animation-heavy pages).

`setTimeout(fn, 0)` is the jsdom/test environment fallback. jsdom does not implement `requestIdleCallback`.

---

## `disconnectObserver(root)` — Explicit Cleanup

```js
function disconnectObserver(root) {
  const obs = _observers.get(root);
  if (obs) {
    obs.disconnect();
    _observers.delete(root);
  }
}
```

Called by `teardown(root)` when blur-all turns off. Stops the MO from firing on future mutations.

**WeakMap vs. explicit disconnect:** WeakMap auto-cleans entries when keys are GC'd, but does NOT call `obs.disconnect()`. A GC'd shadow root's observer is dereferenced, but the browser may have already cleared it. For actively-managed roots (blur turned off while page is visible), explicit disconnect is needed to immediately stop processing.

---

## Interaction with the Stamp Queue

The MO idle callback (`_scheduleIdle(() => { ...nodes... })`) uses the same `_scheduleIdle` helper as the stamp queue, but they are separate idle callbacks with separate dedup flags (`_moIdlePending` vs `_stampIdlePending`). They can both be pending simultaneously:

- `_stampIdlePending` guards the initial full-page stamp (one large `querySelectorAll('*')` pass)
- `_moIdlePending` guards the MO's per-batch node processing

Both are independent. A pending stamp idle and a pending MO idle can both be scheduled — the browser runs them in separate idle slices.

---

## Full MO Lifecycle Example

**Timeline on a typical SPA page:**

```
0ms  — handleMainDocument(settings) called
       injectRules(document, ...) → CSS live
       observeRoot(document) → MO registered
       _stampQueue = [{root: document, ...}]
       _scheduleStampIdle() → idle scheduled

10ms — SPA renders a new <div>Hello</div>
       MO fires: _pendingMoNodes.push(div), _moIdlePending=true, idle scheduled

25ms — requestIdleCallback fires for MO idle:
       thorough = _currentSettings.thorough_blur
       nodes = _pendingMoNodes.splice(0)  → [div]
       tryBlurTextCheck(div, thorough) → div.dataset.blSiBlur = "1"

100ms — requestIdleCallback fires for stamp idle:
        stampElements(document, cats, thorough, mode)
        → all [data-bl-si-blur] from initial page elements stamped
        → no re-stamp of the MO-stamped div (already has data-bl-si-blur, guard skips it)
        → shadow roots discovered and queued
```

The MO idle can run before OR after the stamp idle — both are safe. The stamp idle's inline stale-clear `(if (el.dataset.blSiBlur && !el.dataset.blSiPii) delete el.dataset.blSiBlur)` and re-stamp logic are idempotent. The MO's ownership guard `(if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return)` prevents double-stamping.
