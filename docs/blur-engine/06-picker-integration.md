# Blur Engine — Picker Integration

The picker is the user-facing tool for targeting individual elements or drawing rectangular zones. It interacts with the blur engine through five callbacks, two zone overlay functions, and one MO gate. This document covers all three picker modes, the zone overlay system, coordinate handling, and how pick-blur CSS is managed.

---

## Three Picker Modes

Defined in `src/picker.js` and stored in `settings.pick_and_blur.settings.picker_mode`:

| Mode | Constant | Behavior |
|---|---|---|
| Dynamic | `'dynamic'` | Tap an element → blur that element (selector-based) |
| Sticky Page | `'sticky-page'` | Draw a box anchored to the document → scrolls with content |
| Sticky Screen | `'sticky-screen'` | Draw a box anchored to the viewport → stays fixed during scroll |

Legacy `'sticky'` is migrated to `'sticky-page'` by `blsi.validate_model()`.

---

## Picker Activation Flow

When the user activates the picker, the following sequence runs in `content_script.js`:

```js
// 1. Activate the picker UI
Picker.activate(pickerSettings, pickerCallbacks);

// 2. Update picker-active state atomically (three simultaneous updates)
function setPickerActive(active) {
  isPickerActive = active;                          // content_script local state
  Shortcuts._setPickerActive(active);              // shortcut_handler gate
  Engine._setPickerActiveForObserver(active);      // blur_engine MO gate
}
setPickerActive(true);
```

`Engine._setPickerActiveForObserver(true)` sets `_pickerActive = true` inside the engine. This gates the MutationObserver:
```js
if (_pickerActive || !_isPageBlurred) return;  // MO callback skips when picker is active
```

Without this gate, the MO would blur hover-preview elements (dropdowns, tooltips) that appear while the user is selecting an element. The gate prevents the engine from modifying blur state during picker interaction.

---

## `_setPickerActiveForObserver(bool)` — Engine's Picker Gate

```js
function _setPickerActiveForObserver(v) {
  _pickerActive = !!v;
}
```

Simple setter. Only affects the MO gate. Picker activate/deactivate do not affect `_isPageBlurred` or the injected CSS.

**Critical: always call via `content_script.setPickerActive()`** — not directly. `setPickerActive` updates all three flags atomically. Calling `Engine._setPickerActiveForObserver(false)` alone without updating the shortcut handler's flag would leave shortcut handling in an incorrect state.

---

## Five Picker Callbacks

`content_script.js` passes five callbacks to `Picker.activate()`. Each callback writes to storage and calls `_sync()` to let the engine reconcile:

### `onBlur(el)` — Dynamic Item Creation

```js
async function onBlur(el) {
  const selectors = Selector.getSelectors(el);
  if (!selectors.length) return;
  const name = Engine.allocateDynamicName();
  const item = { type: 'dynamic', name, selectors };
  await Store.save_blur_item(hostname, item);
  await _sync();
}
```

`Engine.allocateDynamicName()` returns the next "Dynamic N" name (increments `_dynamicCounter`). `Selector.getSelectors(el)` returns an array of CSS selectors ordered structural→semantic. The item is saved to storage, then `_sync()` re-resolves settings from storage and calls `handleSite()`, which calls `_reconcileItems()`, which calls `applyItem()`, which calls `_applyDynamicItem()`:

```js
function _applyDynamicItem(item) {
  const el = blsi.SelectorUtils.restoreSelector(item.selectors || item.selector);
  if (el && !_isExtensionUI(el)) {
    el.dataset.blSiPickBlur = '1';
  }
  // counter seeding
  const num = parseInt((item.name || "").replace("Dynamic ", ""), 10);
  if (!isNaN(num) && num > _dynamicCounter) _dynamicCounter = num;
}
```

The element gets `data-bl-si-pick-blur="1"`. The static `content.css` gaussian rule blurs it immediately. If pick-blur is in frosted or color mode, the injected `#bl-si-pick-blur-styles` handles the visual.

### `onUnblur(el)` — Dynamic Item Removal

```js
async function onUnblur(el) {
  const selectors = Selector.getSelectors(el);
  if (!selectors.length) return;
  await Store.remove_blur_item(hostname, selectors[0]);
  await _sync();
}
```

Removes the item from storage by its primary selector. `_sync()` → `_reconcileItems()` → `removeItem()` → `_removeDynamicItem()`:

```js
function _removeDynamicItem(item) {
  const el = blsi.SelectorUtils.restoreSelector(item.selectors || item.selector);
  if (el) delete el.dataset.blSiPickBlur;
}
```

### `onStickyBlur(zoneRect)` — Zone Overlay Creation

```js
async function onStickyBlur(zoneRect) {
  const name = Engine.allocateStickyName();
  const id = 's_' + generateHex();
  const item = {
    type: 'sticky',
    name,
    id,
    anchor: zoneRect.anchor,
    x: zoneRect.x,
    y: zoneRect.y,
    width: zoneRect.width,
    height: zoneRect.height,
    xPct: zoneRect.x / (zoneRect.scrollWidth || window.innerWidth),
    yPct: zoneRect.y / (zoneRect.scrollHeight || window.innerHeight),
    widthPct: zoneRect.width / (zoneRect.scrollWidth || window.innerWidth),
    heightPct: zoneRect.height / (zoneRect.scrollHeight || window.innerHeight),
    scrollWidth: zoneRect.scrollWidth,
    scrollHeight: zoneRect.scrollHeight,
    path: (zoneRect.anchor === 'page') ? location.pathname : undefined,
  };
  await Store.save_blur_item(hostname, item);
  await _sync();
  Shortcuts.showToast(name);
}
```

The picker passes the zone's bounding box in `zoneRect`. Percentages are computed immediately and stored alongside the absolute coordinates for later re-projection.

`_sync()` → `_reconcileItems()` → `_applyStickyItem()` → `createZoneOverlay(...)`.

### `onStickyUnblur(zoneId)` — Zone Removal

```js
async function onStickyUnblur(zoneId) {
  await Store.remove_blur_item(hostname, zoneId);
  await _sync();
}
```

### `onModeChange(mode)` — Picker Mode Persistence

```js
function onModeChange(mode) {
  Store.patch_section('pick_and_blur', { settings: { picker_mode: mode } });
}
```

Does NOT call `_sync()` — picker mode changes don't affect blur state. The setting is persisted for the next page load.

---

## Zone Overlay System

### `createZoneOverlay(zoneData)` — Overlay Creation

```js
function createZoneOverlay(zoneData) {
  if (!zoneData || !zoneData.id) return null;
  if (!document.body) return null;

  // Idempotent: remove existing overlay with same id
  if (_zoneOverlays.has(zoneData.id)) {
    removeZoneOverlay(zoneData.id);
  }

  const el = document.createElement("div");
  el.className = blsi.css.zone_overlay;         // "bl-si-zone-overlay"
  el.dataset.blSiZone = zoneData.id;
  el.dataset.blSiZoneName = zoneData.name || "";

  const anchor = zoneData.anchor === "screen" ? "screen" : "page";
  el.dataset.blSiZoneAnchor = anchor;
  el.dataset.blSiPickBlur = '1';                // participates in pick-blur CSS

  const position = anchor === "screen" ? "fixed" : "absolute";
  el.style.cssText = [
    "position: " + position,
    "left: " + zoneData.x + "px",
    "top: " + zoneData.y + "px",
    "width: " + zoneData.width + "px",
    "height: " + zoneData.height + "px",
  ].join("; ") + ";";

  document.body.appendChild(el);
  _zoneOverlays.set(zoneData.id, el);
  return el;
}
```

**Why `data-bl-si-pick-blur = '1'`:** Zone overlays participate in the pick-blur CSS system, not the blur-all system. They get their visual effect from:
- `content.css` rule: `.bl-si-zone-overlay { backdrop-filter: blur(var(--bl-si-radius)) }` — gaussian backdrop blur
- Injected `#bl-si-pick-blur-styles` — frosted or color mode override

**Why `data-bl-si-zone !== undefined` is checked in `_isExtensionUI`:** This prevents `stampElements` and the MO callback from treating zone overlays as page content to stamp.

**Why stamp is done here, not in `stampElements`:** Zone overlays are injected by the engine itself, not discovered during a DOM scan. They need `data-bl-si-pick-blur` stamped at creation time so CSS rules match immediately.

---

## Anchor Types: Page vs Screen

```
┌───────────────────────────────────────────────────────────────────────┐
│                     Anchor System                                     │
│                                                                       │
│  PAGE ANCHOR (position: absolute)                                     │
│  ────────────────────────────────                                     │
│  Coordinate system: document space                                    │
│  (x, y include scroll offset at capture time)                        │
│  Scroll behavior: moves with page content                             │
│  Path scoping: YES — only on item.path                               │
│  Re-projection: YES — xPct/widthPct recalculate on layout reflow    │
│  Best for: blurring content at a specific page position              │
│                                                                       │
│  SCREEN ANCHOR (position: fixed)                                      │
│  ──────────────────────────────                                       │
│  Coordinate system: viewport space                                    │
│  (x, y are fixed viewport coordinates, no scroll offset)             │
│  Scroll behavior: stays fixed on screen                              │
│  Path scoping: NO — applies on every page under the hostname         │
│  Re-projection: NO — raw viewport coordinates are stable             │
│  Best for: always-on overlays (e.g., Zoom meeting name bar)          │
└───────────────────────────────────────────────────────────────────────┘
```

### Coordinate Conversion (Picker → Zone Overlay)

**Dynamic mode:** No zones. Elements are targeted by CSS selector.

**Sticky page mode:** The picker draws the preview box using `position: fixed` (viewport coordinates). On commit, the content script converts to document coordinates:
```js
// Viewport → document
x_doc = pickerViewportX + window.scrollX;
y_doc = pickerViewportY + window.scrollY;
// scrollWidth/scrollHeight = document.documentElement.scrollWidth/scrollHeight
```

**Sticky screen mode:** The picker draws using `position: fixed`. On commit, viewport coordinates are used directly (no scroll offset). `scrollWidth/scrollHeight` = `window.innerWidth/window.innerHeight`.

### Re-Projection on Layout Reflow

For page-anchored zones, when the viewport width changes significantly (responsive reflow, window resize), the zone's X position and width are recomputed from stored percentages:

```js
const curW = document.documentElement.scrollWidth || window.innerWidth;
const wChanged = item.scrollWidth && Math.abs(curW - item.scrollWidth) > Math.max(10, item.scrollWidth * 0.01);
x = (wChanged && typeof item.xPct === "number") ? item.xPct * curW : item.x;
w = (wChanged && typeof item.widthPct === "number") ? item.widthPct * curW : item.width;
```

**Why width-based only (not height):** Page height changes during load as images and dynamic content render. The stored `y` coordinate (document-space) accurately positions the zone vertically even if the page has grown — the zone "sticks" to the same content it was drawn on because content above it retains its height. Re-projecting Y using the new `scrollHeight` would misplace the zone (the ratio of stored Y to old scrollHeight ≠ ratio to new scrollHeight because non-uniform content growth).

**Threshold:** >1% change in scroll width (with a minimum of 10px) triggers re-projection. This avoids micro-adjustments on sub-pixel reflows.

---

## `removeZoneOverlay(zoneId)` — Idempotent Removal

```js
function removeZoneOverlay(zoneId) {
  const el = _zoneOverlays.get(zoneId);
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
  _zoneOverlays.delete(zoneId);
}
```

`Map.delete` on a non-existent key is a no-op. `el.parentNode` check prevents errors if the element was already removed from DOM externally.

---

## `removeAllZoneOverlays()` — Full Cleanup

```js
function removeAllZoneOverlays() {
  for (const [id, el] of _zoneOverlays) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  _zoneOverlays.clear();
}
```

Called by:
- `unblurAll()` (public alias for `teardown(document) + removeAllZoneOverlays()`)
- `handleSite()` extension disabled path (safety net for orphaned zones)

---

## `getZoneOverlays()` — Hit-Testing for Reveal

```js
function getZoneOverlays() {
  return Array.from(_zoneOverlays.values());
}
```

Returns all active zone overlay DOM elements. Used by `reveal_controller.js` to hit-test zone overlays for hover/click reveal:

```js
// In reveal_controller.js:
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

Zone overlays use `pointer-events: none` by default (from `content.css`), so normal mouse events pass through them. The reveal controller manually checks whether the cursor is within a zone's bounds using `getBoundingClientRect`.

---

## Pick-Blur CSS Management

### `injectPickBlurRules(root, type, color)`

Injects `<style id="bl-si-pick-blur-styles">` for non-gaussian pick-blur modes. Called on every `handleSite()` invocation (idempotent):

```js
function injectPickBlurRules(root, type, color) {
  removePickBlurRules(root);
  if (!type || type === blsi.pick_blur_modes.blur) return;  // gaussian: static CSS handles it
  // ... build rules for frosted or color ...
}
```

**Why called on every `handleSite()` and not just on mode change:** If the user changes from color mode to frosted mode, the old color CSS must be removed and new frosted CSS (including SVG filter) injected. The idempotent pattern (remove-then-inject) handles this cleanly without a mode-change detector.

**Why gaussian mode is a no-op:** `content.css` already has `[data-bl-si-pick-blur]:not([data-bl-si-reveal]) { filter: blur(var(--bl-si-radius)) }`. The injected `#bl-si-pick-blur-styles` is only needed for modes that override this gaussian rule.

See `01-css-layer.md` and `09-blur-modes.md` for the full CSS generated by each mode.

---

## Counter Allocation: `allocateDynamicName()` / `allocateStickyName()`

These are exposed as **public API** because the picker callbacks need to allocate names *before* writing to storage:

```js
async function onBlur(el) {
  const name = Engine.allocateDynamicName();  // "Dynamic 3"
  const item = { type: 'dynamic', name, selectors };
  await Store.save_blur_item(hostname, item);  // saved with "Dynamic 3"
  await _sync();  // engine sees "Dynamic 3" and seeds counter to 3
}
```

If name allocation were inside the engine's `_applyDynamicItem`, the storage item would have no name — the name would only exist transiently in the engine state, lost across page reloads.

**Counter seeding from existing items:** When `_applyDynamicItem` processes an existing item named "Dynamic 5", it advances `_dynamicCounter` to 5. The next `allocateDynamicName()` call returns "Dynamic 6". This prevents name collisions after page reload.

`resetCounters()` is called once by `content_script.init()` before the first `_reconcileItems()` run, so counters start at 0. The first `_reconcileItems()` call re-seeds them from existing items.
