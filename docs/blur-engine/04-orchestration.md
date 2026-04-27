# Blur Engine — Orchestration

This document covers the high-level lifecycle management of `blur_engine.js`: the primary entry point `handleSite()`, the mutex guard, the reconcile key, item diffing, teardown, and the lower-level document/shadow-root handlers.

---

## `handleSite(settings)` — Primary Entry Point

`handleSite` is the **only function that production callers should invoke**. All paths (init, storage change, shortcut, picker callback, SPA navigation) converge here. It is an `async` function that performs four phases inside a mutex.

```js
async function handleSite(settings) {
  if (_handling) return;   // mutex: drop concurrent call
  _handling = true;
  try {
    // Phase 1: Store settings snapshot (MO reads this for new shadow roots)
    _currentSettings = settings;

    // Phase 2: Extension disabled — full teardown
    if (settings.enabled === false) {
      handleMainDocument(settings);
      _isPageBlurred = false;
      _reconcileItems([]);
      removeAllZoneOverlays();
      _lastReconcileKey = null;
      return;
    }

    // Phase 3: Page-wide reconcile (skip if only CSS vars changed)
    const isActive = !!settings.engage;
    const reconcileKey = isActive
      ? `${settings.blur_mode}|${JSON.stringify(settings.blur_categories)}|${settings.thorough_blur}|${settings.blur_mode === blsi.blur_modes.frosted ? settings.blur_radius : ''}`
      : 'inactive';
    const pageWideChanged = reconcileKey !== _lastReconcileKey;
    _lastReconcileKey = reconcileKey;

    if (pageWideChanged) {
      handleMainDocument(settings);  // synchronous CSS + idle stamp
    }
    _isPageBlurred = isActive;

    // Phase 4: Item reconcile (always runs — items persist when blur-all is OFF)
    const { added, removed } = _reconcileItems(settings.blur_items || []);

    // Idempotent pick-blur CSS (re-inject on every call for mode/color changes)
    if (settings.pick_blur_enabled && (settings.blur_items || []).length > 0) {
      injectPickBlurRules(document, settings.pick_blur_type, settings.pick_blur_color);
    } else {
      removePickBlurRules(document);
    }

    // Optional: debug logging
    if (blsi.Logger && blsi.Logger.enabled) {
      blsi.Logger.scope('engine').flow('handleSite', { active: isActive, pageWideChanged, added, removed, totalActive: _activeItems.size });
    }
  } finally {
    _handling = false;
  }
}
```

---

## Phase 1: Settings Snapshot

```js
_currentSettings = settings;
```

Updated at the top of `handleSite`, before any other work. The MutationObserver idle callback reads `_currentSettings` to get the current `thorough_blur` flag:

```js
const thorough = _currentSettings ? !!_currentSettings.thorough_blur : false;
```

**Why this must come first:** If `handleSite` were to complete before the MO idle fires, the MO should still use the newest settings. By updating `_currentSettings` first, even a concurrent MO idle fired mid-function will see the latest settings.

---

## Phase 2: Extension Disabled Path

```js
if (settings.enabled === false) {
  handleMainDocument(settings);  // teardown: active=false → teardown(document)
  _isPageBlurred = false;
  _reconcileItems([]);           // remove all picker items + zone overlays
  removeAllZoneOverlays();       // safety net for orphaned zones
  _lastReconcileKey = null;      // force full rescan on re-enable
  return;
}
```

When the extension is globally disabled (toggle in popup), all blur is removed:
- `handleMainDocument(settings)` with `enabled=false` → calls `teardown(document)` → removes CSS, disconnects MO, clears stamps
- `_reconcileItems([])` → removes all picker items (their DOM stamps and zone overlays)
- `removeAllZoneOverlays()` — safety net in case `_reconcileItems` missed any zone overlays
- `_lastReconcileKey = null` — on re-enable, the key won't match anything, forcing a fresh reconcile

---

## Phase 3: Page-Wide Reconcile Key

The reconcile key is a fingerprint of the settings that require DOM work when they change:

```js
const reconcileKey = isActive
  ? `${settings.blur_mode}|${JSON.stringify(settings.blur_categories)}|${settings.thorough_blur}|${settings.blur_mode === blsi.blur_modes.frosted ? settings.blur_radius : ''}`
  : 'inactive';
```

**Included:**
- `blur_mode` — switching modes requires new CSS rules (different `blurDecl`) and may require SVG filter or font injection/removal
- `blur_categories` — toggling a category (TEXT off, FORM on) requires different tag selectors in CSS
- `thorough_blur` — toggling thorough changes which elements pass the stamp gate (affects the idle scan)
- `blur_radius` in frosted mode — frosted mode's radius is in SVG `stdDeviation`, not a CSS var; changing it requires `ensureSvgFilter()` rebuild

**Excluded:**
- `blur_radius` in non-frosted modes — CSS `var(--bl-si-radius)` propagates instantly; no DOM work needed
- `highlight_color`, `transition_duration`, `redaction_color` — CSS var only
- `reveal_mode` — managed by `reveal_controller.js`, not the engine
- `blur_items`, `engage` — these drive phases 3 and 4 independently, not the page-wide structure

**Key comparison:**
```js
const pageWideChanged = reconcileKey !== _lastReconcileKey;
_lastReconcileKey = reconcileKey;
if (pageWideChanged) {
  handleMainDocument(settings);
}
```

If the key matches the previous call's key, `handleMainDocument` is skipped entirely — no CSS rebuild, no MO re-registration, no stamp queue update. This makes rapid settings changes (slider dragging) very cheap for non-structural properties.

**The inactive key:** When `engage` is false, the key is always `'inactive'`. Any transition from active to inactive triggers `handleMainDocument(settings)` (which runs `teardown(document)`). Subsequent inactive calls are no-ops (key is still `'inactive'`, no change). The transition from inactive back to active also triggers (key changes from `'inactive'` to the new active key).

---

## Phase 4: Item Reconcile

```js
const { added, removed } = _reconcileItems(settings.blur_items || []);
```

**Why this runs unconditionally (both active and inactive paths):**
Picker items and zone overlays persist independently of blur-all. If the user picks an element and then turns off blur-all, the picker item should remain visible. When blur-all is off, the item's CSS is handled by the static `content.css` gaussian fallback rule — no injected `#bl-si-blur-styles` needed.

**Pick-blur CSS injection:**
```js
if (settings.pick_blur_enabled && (settings.blur_items || []).length > 0) {
  injectPickBlurRules(document, settings.pick_blur_type, settings.pick_blur_color);
} else {
  removePickBlurRules(document);
}
```

This is called on every `handleSite` invocation — it's intentionally idempotent (removes old and re-injects new). This ensures mode/color changes take effect immediately without waiting for a reconcile key change.

---

## `_reconcileItems(desired)` — Item Diffing

```js
function _reconcileItems(desired) {
  const desiredArray = Array.isArray(desired) ? desired : [];
  const desiredById = new Map(desiredArray.map(i => [_itemId(i), i]));

  let added = 0, removed = 0;

  // Remove items no longer in desired
  for (const [id, item] of Array.from(_activeItems)) {
    if (!desiredById.has(id)) {
      removeItem(item);
      _activeItems.delete(id);
      removed++;
    }
  }

  // Apply new items (idempotent for existing items — applyItem re-seeds counters)
  for (const [id, item] of desiredById) {
    const isNew = !_activeItems.has(id);
    applyItem(item);
    _activeItems.set(id, item);
    if (isNew) added++;
  }

  return { added, removed };
}
```

**`_itemId(item)` key selection:**
- Dynamic items: `item.selectors[0]` (primary CSS selector) — unique per element
- Sticky items: `item.id` (unique `s_` + hex string generated at creation)

**Idempotency:** `applyItem` is called for all desired items, not just new ones. For existing items, `applyItem` re-seeds the name counters (updating the high-water mark) but does not create duplicate DOM elements or attributes (each apply path has its own idempotency guard).

---

## `applyItem(item)` and `removeItem(item)` — Item Type Dispatch

```js
function applyItem(item) {
  if (!item) return;
  if (item.type === "dynamic") _applyDynamicItem(item);
  else if (item.type === "sticky") _applyStickyItem(item);
}

function removeItem(item) {
  if (!item) return;
  if (item.type === "dynamic") _removeDynamicItem(item);
  else if (item.type === "sticky") _removeStickyItem(item);
}
```

### Dynamic items (`_applyDynamicItem` / `_removeDynamicItem`)

A dynamic item represents a user-selected element tracked by CSS selector:

```js
function _applyDynamicItem(item) {
  const el = blsi.SelectorUtils.restoreSelector(item.selectors || item.selector);
  if (el && !_isExtensionUI(el)) {
    el.dataset.blSiPickBlur = '1';
  }
  // Seed counter from existing item name
  const num = parseInt((item.name || "").replace("Dynamic ", ""), 10);
  if (!isNaN(num) && num > _dynamicCounter) _dynamicCounter = num;
}

function _removeDynamicItem(item) {
  const el = blsi.SelectorUtils.restoreSelector(item.selectors || item.selector);
  if (el) delete el.dataset.blSiPickBlur;
}
```

`SelectorUtils.restoreSelector(selectors)` tries each selector in the array (most structural first) until `querySelectorAll().length === 1` — returning the unique element match. Returns `null` if the element is not found (e.g., SPA re-rendered, element removed). In that case, no DOM change is made but the item remains in `_activeItems` (it will be re-applied if the element reappears).

### Sticky items (`_applyStickyItem` / `_removeStickyItem`)

A sticky item represents a zone overlay:

```js
function _applyStickyItem(item) {
  const anchor = item.anchor === "screen" ? "screen" : "page";

  // Path scoping: page-anchored zones only appear on their captured path
  if (anchor === "page" && item.path) {
    const stored = item.path.replace(/\/+$/, "") || "/";
    const current = location.pathname.replace(/\/+$/, "") || "/";
    if (stored !== current) return;  // wrong page, skip
  }

  // Coordinate re-projection for page-anchored zones
  let x, y, w, h;
  if (anchor === "page") {
    const curW = document.documentElement.scrollWidth || window.innerWidth;
    const wChanged = item.scrollWidth && Math.abs(curW - item.scrollWidth) > Math.max(10, item.scrollWidth * 0.01);
    x = (wChanged && typeof item.xPct === "number") ? item.xPct * curW : item.x;
    y = item.y;
    w = (wChanged && typeof item.widthPct === "number") ? item.widthPct * curW : item.width;
    h = item.height;
  } else {
    // Screen-anchored: raw viewport coordinates, stable across pages
    x = item.x;
    y = item.y;
    w = item.width;
    h = item.height;
  }

  createZoneOverlay({ id: item.id, name: item.name, anchor, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });

  const num = parseInt((item.name || "").replace("Sticky ", ""), 10);
  if (!isNaN(num) && num > _stickyCounter) _stickyCounter = num;
}

function _removeStickyItem(item) {
  removeZoneOverlay(item.id);
}
```

**Path scoping:** Page-anchored zones record `item.path` (the `location.pathname` at creation time). On restore, if the current path doesn't match, the zone is not drawn. This allows path-scoped zones — "blur only on /account, not on /public". Screen-anchored zones have no path scoping.

**Coordinate re-projection:** When a page-anchored zone is created, the picker records:
- `x`, `y`, `width`, `height` — absolute document coordinates at time of creation
- `xPct`, `yPct`, `widthPct`, `heightPct` — percentage of `scrollWidth`/`scrollHeight`
- `scrollWidth`, `scrollHeight` — document dimensions at creation time

On restore, if `document.documentElement.scrollWidth` has changed by more than 1% of the stored width (indicating layout reflow), the X coordinate and width are re-projected from the percentage values. Y and height are never re-projected — page height changes unpredictably during load (lazy images, dynamic content), so raw Y is used as-is.

**Why no Y re-projection:** The document height at restore time differs from creation time because:
- Images load and expand the page height after the zone was created
- Dynamic content injected by SPAs alters the vertical layout
- The user may have scrolled to a different position

Re-projecting Y with the new `scrollHeight` would misplace the zone. The original `y` coordinate (document-space) remains accurate for the target content's vertical position even if the surrounding page has grown.

---

## `handleMainDocument(settings)` — Document-Scoped Lifecycle

```js
function handleMainDocument(settings) {
  const active = !!settings.engage;
  if (!active) {
    teardown(document);
    return;
  }

  const cats = settings.blur_categories || DEFAULT_CATS;
  const mode = settings.blur_mode || null;
  const thorough = !!settings.thorough_blur;

  injectRules(document, cats, mode);             // synchronous
  observeRoot(document);                         // synchronous
  _stampQueue = [{ root: document, cats, thorough, mode, settings }];
  _scheduleStampIdle();
}
```

**Active path:**
1. `injectRules(document, ...)` — CSS injected immediately (always-blur tags blurred now)
2. `observeRoot(document)` — MO registered immediately (new elements captured)
3. Queue replaced — stamp pass queued for idle

**Inactive path:**
`teardown(document)` — full cleanup: cancel idle work, disconnect MO, remove CSS, clear stamps, remove SVG filter, recurse shadow roots.

**Key design:** `_isPageBlurred` is NOT set here — `handleSite()` owns that. `handleMainDocument` is stateless with respect to `_isPageBlurred`.

---

## `handleDocument(settings, root)` — Thin Router (Backward Compat)

```js
function handleDocument(settings, root) {
  if (!root || root === document) return handleMainDocument(settings);
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot)
    return handleShadowRoot(settings, root);
}
```

Routes to the appropriate handler based on root type. Kept on the public API for:
1. Backward compatibility with callers from before the shadow DOM refactor
2. Unit tests that want to test a specific root in isolation

All production paths go through `handleSite()`.

---

## `handleIframe(settings, iframeEl)` — Cross-Origin Iframe Handling

```js
function handleIframe(settings, iframeEl) {
  if (!iframeEl || _isExtensionUI(iframeEl)) return;
  const active = !!settings.engage;

  let isSameOrigin = false;
  try { isSameOrigin = !!iframeEl.contentDocument; } catch (_) {}
  if (isSameOrigin) return;

  if (active) {
    iframeEl.dataset.blSiBlur = '1';
  } else {
    delete iframeEl.dataset.blSiBlur;
  }
}
```

**Same-origin iframes are skipped:** Same-origin iframes can be detected by accessing `iframeEl.contentDocument` without throwing. If accessible, the iframe has its own content_script running (`all_frames: true`) which handles blur independently. Stamping the iframe element would double-blur its content.

**Cross-origin iframes are stamped as black boxes:** Cross-origin iframes cannot be blurred internally (the extension cannot inject scripts across origins). Instead, the `<iframe>` element itself is stamped with `data-bl-si-blur="1"`, and the CSS `filter: blur()` rule applies. This blurs the iframe's *rendered output* as an opaque box — the user sees a blurred rectangle where the iframe would appear.

**Access detection via try/catch:** The cross-origin check uses `try { !!iframeEl.contentDocument }`. Accessing `contentDocument` on a cross-origin frame throws a `SecurityError`. Catching it and returning `null`/`undefined` indicates cross-origin.

---

## `teardown(root)` — Full State Cleanup

See `03-shadow-dom.md` for the full teardown algorithm. In the orchestration context:

- Called by `handleMainDocument(settings)` when `active === false`
- Called by `handleShadowRoot(settings, sr)` when `active === false`
- Called by `unblurAll()` (public alias: `teardown(document) + removeAllZoneOverlays()`)

Key property: **teardown is idempotent**. Calling it twice on the same root is safe — the second call finds nothing to clean up and returns.

---

## Mutex: Preventing Concurrent `handleSite` Calls

```js
let _handling = false;

async function handleSite(settings) {
  if (_handling) return;   // DROP concurrent call
  _handling = true;
  try {
    // ...
  } finally {
    _handling = false;
  }
}
```

**What causes concurrent calls:**
- `content_script.handleStorageChange()` fires while a previous `handleSite` is awaiting an async operation (storage write, etc.)
- Shortcut handler fires during init's `applyState()`
- SPA URL change fires during a storage-change-triggered `handleSite`

**Drop semantics:** The concurrent call is silently dropped. This is acceptable because:
- `_currentSettings` is updated at the start of each call
- The in-flight call will complete with the latest settings (it reads `_currentSettings` for MO-related work)
- `content_script._sync()` always re-resolves settings from storage just before calling `handleSite`, so the most recent storage state is always reflected in the next successful call

**Why not queue instead of drop:** Queuing would require maintaining a queue, potentially executing stale work after a rapid succession of changes. Drop-and-let-latest-call-complete is simpler and produces the correct result for most cases. The final state after all concurrent calls settle is always the correct one (latest storage wins).

---

## `resetCounters()` — Counter Initialization

```js
function resetCounters() {
  _dynamicCounter = 0;
  _stickyCounter = 0;
}
```

Called by `content_script.init()` before the first `applyState()`. Zeros both counters so the first item gets "Dynamic 1" / "Sticky 1". Counters are then re-seeded by `applyItem()` as existing items are processed.

Without `resetCounters()`, counter state from a previous page's session could bleed through (if the engine is reused across SPA navigations). Content script re-initializes on each navigation, so this is called fresh each time.

---

## Summary: Call Chain for a Typical Storage Change

```
chrome.storage.onChanged fires
  → content_script.handleStorageChange(newModel)
    → Store.resolve(_topHostname, url)  [reads storage cache]
    → applyState(resolved, prev)
      → applySettingsToDom(resolved)    [updates CSS vars on :root]
      → Shortcuts.init(resolved.shortcuts) [re-wires keyboard shortcuts]
      → _sync()
        → Store.resolve(...)            [re-resolve just before engine call]
        → Engine.handleSite(resolved)   [← primary engine entry point]
          [Phase 1] _currentSettings = resolved
          [Phase 2] enabled check (skip)
          [Phase 3] reconcileKey comparison
                    → handleMainDocument(resolved) [if structural change]
                      → injectRules(document, ...) [CSS live]
                      → observeRoot(document)       [MO live]
                      → queue stamp for idle
          [Phase 4] _reconcileItems(resolved.blur_items)
                    → applyItem / removeItem for delta
                    → injectPickBlurRules(...)
```

Every step is either synchronous or awaited. No concurrent `handleSite` calls can proceed (mutex). By the time `_sync()` resolves, the page's blur state matches storage.
