# picker Contract

## Overview

`blsi.Picker` is an IIFE (~880 lines) exposed at `src/picker.js`. It is the interactive element-selection UI for the extension: a floating toolbar pill + mouse event overlay that lets the user blur individual elements or draw zone rectangles. The picker is activated and deactivated by `content_script.js`; it never reads storage directly and never calls `Store.*`. All persistence is delegated to caller-provided callbacks.

- Global: `blsi.Picker`
- IIFE pattern: `const Picker = (() => { ... })(); blsi.Picker = Picker;`
- Depends on: `blsi.BlurEngine`, `blsi.SelectorUtils`, `blsi.ContentI18n`, `blsi.Toast` (for the area-too-small toast), `blsi.css`, `blsi.ids`, `blsi.picker_modes`, `blsi.DEFAULT_MODEL`.

---

## Mode Descriptions

| Mode | Constant | Anchor | Behavior |
|---|---|---|---|
| `'dynamic'` | `PM.dynamic` | Element | Hover highlights an element; click blurs or unblurs it. Falls back to this mode on touch devices. |
| `'sticky-page'` | `PM.sticky_page` | Document | User drags to sketch a box. The zone scrolls with page content. Coordinates stored as document-space (scroll offset added). |
| `'sticky-screen'` | `PM.sticky_screen` | Viewport | User drags to sketch a box. The zone is fixed to the viewport and stays put during scroll. Coordinates are viewport-space (no scroll offset). |

Legacy value `'sticky'` (pre-v2) is treated as `'sticky-page'` in `activate()`.

`_isSticky(mode)` helper returns `true` for both `sticky-page` and `sticky-screen`. Event dispatchers branch on `_isSticky(currentMode)` to route to sticky vs. dynamic behavior.

---

## Public API

### `activate(settings, callbacks)`

**What:** Activates the picker. No-op if already active.

**Params:**
- `settings` (object) — `{ blurRadius, highlightColor, pickerMode }`. Merged over `activeSettings` (existing defaults are preserved for any missing key).
  - `pickerMode` (string) — one of `'dynamic'`, `'sticky-page'`, `'sticky-screen'`, or legacy `'sticky'`. Ignored on touch devices (forced to `'dynamic'`).
  - `blurRadius` (number) — passed to the engine when doing inline blur (fallback path without callbacks).
  - `highlightColor` (string) — used for hover highlight CSS (managed by CSS var, not directly by picker).
- `callbacks` (object) — `{ onBlur, onUnblur, onStickyBlur, onStickyUnblur, onModeChange, onDeactivate }`. All optional; fallback to direct engine calls if omitted.

**Returns:** `undefined`.

**Side effects:**
- Merges `settings` into `activeSettings`.
- Stores `callbacks` in `activeCallbacks`.
- Sets `isActive = true`.
- Determines `currentMode` from `settings.pickerMode` (with touch-device override).
- Adds `'bl-si-picker-active'` class to `document.documentElement`.
- Calls `buildToolbar()` — creates the floating pill and appends to `document.body`.
- Adds 7 capture-phase listeners on `document`: `mouseover`, `mouseout`, `click`, `keydown`, `mousedown`, `mousemove`, `mouseup`.

**Handles:**
- Touch devices (`'ontouchstart' in window || navigator.maxTouchPoints > 0`): force `currentMode = 'dynamic'` regardless of requested mode.
- Unknown `pickerMode` values: fall back to `'sticky-page'`.
- Legacy `'sticky'` value: mapped to `'sticky-page'`.

---

### `deactivate()`

**What:** Deactivates the picker. No-op if not active.

**Returns:** `undefined`.

**Side effects:**
- Sets `isActive = false`.
- Calls `_cancelDraw()` — removes any in-progress zone preview.
- Calls `_clearZoneHighlight()` — removes zone hover state.
- Removes all 7 capture-phase document listeners registered by `activate`.
- Removes `'bl-si-hover-highlight'` class from all elements that have it (full `querySelectorAll` sweep).
- Sets `hoveredElement = null`, clears `selectedElements`.
- Removes `'bl-si-picker-active'` from `document.documentElement`.
- Calls `removeToolbar()` — removes pill and chip tooltip from DOM.
- Calls `activeCallbacks.onDeactivate()` if provided.
- Clears `activeCallbacks = {}`.

---

### `setSettings(newSettings)`

**What:** Updates the active settings snapshot while the picker is running. Typically called by `content_script.applyState` when settings change mid-session.

**Params:**
- `newSettings` (object) — partial settings object. Merged over `activeSettings` (existing keys preserved).

**Returns:** `undefined`.

**Side effects:** Updates `activeSettings` via shallow merge. Does not re-render the toolbar or change mode.

---

### `setMode(mode)`

**What:** Changes the current picker mode. Called internally when the mode chip is clicked (cycles via `_cycleMode`), and callable externally.

**Params:**
- `mode` (string) — `'dynamic'` | `'sticky-page'` | `'sticky-screen'`. Any other value is silently ignored.

**Returns:** `undefined`.

**Side effects:**
- No-op if `mode` is the same as `currentMode` or is not a recognized mode.
- Calls `_cancelDraw()` — cancels any in-progress sticky draw.
- Clears dynamic hover state: removes `'bl-si-hover-highlight'` from `hoveredElement`, sets `hoveredElement = null`.
- Calls `_clearZoneHighlight()`.
- Sets `currentMode = mode`.
- Updates `modeSelectEl.textContent` to the new mode chip label (via `_modeChipLabel`).
- Calls `activeCallbacks.onModeChange(mode)` if provided — content_script persists the mode to storage.

---

### `rebuildToolbar()`

**What:** Tears down and recreates the toolbar (pill). Used by `content_script.handleStorageChange` when the language setting changes mid-session so i18n strings are re-read from `blsi.ContentI18n` in the new locale.

**Returns:** `undefined`.

**Side effects:**
- No-op if `!isActive`.
- Calls `removeToolbar()` then `buildToolbar()`.
- The pill position is NOT preserved — reopens at CSS-default top-center position.

---

### `isActive` (getter)

**What:** Returns whether the picker is currently active.

**Returns:** `boolean`. `true` after `activate()` and before `deactivate()`.

**Side effects:** None.

---

## Internal Functions

### `buildToolbar()`

**What:** Creates and appends the floating toolbar pill to `document.body`. No-op if `toolbarEl` already exists.

**Side effects:**
- Creates `<div id="bl-si-picker-toolbar" class="bl-si-toolbar" data-bl-si-toolbar="true">`.
- Appends bubble-phase `stopPropagation` handlers for `mouseover`, `mouseout`, `click` on `toolbarEl` (prevents page handlers from receiving toolbar events while allowing toolbar children to handle them normally). `mousedown`/`mouseup` are intentionally NOT stopped so the drag handler can receive them.
- Creates and appends children in order:
  - **Drag handle** (`.bl-si-toolbar-drag`, text `⚓`): wired via `_wireDrag()` at capture phase for mousedown.
  - **Prefix label** (`.bl-si-toolbar-prefix`, text from `_t('pickerPrefixLabel', 'Blur An:')`): omitted entirely if the i18n value is empty string (non-English locales where the grammar doesn't apply).
  - **Mode chip** (`.bl-si-toolbar-chip`, `<button>`): shows current mode label via `_modeChipLabel(currentMode)`. Click cycles mode via `_cycleMode`. Hover/focus shows chip tooltip via `_showChipTooltip` / `_hideChipTooltip`.
  - **Clear button** (`.bl-si-toolbar-btn.bl-si-toolbar-btn--clear`): calls `clearAllFromPicker()` on click.
  - **Close button** (`.bl-si-toolbar-btn.bl-si-toolbar-btn--close`, text `×`): calls `deactivate()` on click.
  - **Selector warning** (`.bl-si-selector-warning`): shown via `bl-si-visible` class when dynamic-mode hover target has no stable selector.
- Sets `toolbarLabelEl = null` (legacy; removed).
- Appends toolbar to `document.body`.
- Pill opens at top-center via `styles/content.css` — `picker.js` does not set initial position.

### `removeToolbar()`

**What:** Removes the toolbar pill and chip tooltip from the DOM. Clears all toolbar DOM references.

**Side effects:**
- Calls `_destroyChipTooltip()`.
- Removes `toolbarEl` from DOM.
- Sets `toolbarEl`, `toolbarLabelEl`, `modeSelectEl`, `selectorWarningEl` to null.

---

### `_wireDrag(handle)`

**What:** Registers `_onDragStart` at capture phase on the drag handle element.

**Params:** `handle` (Element) — the drag handle `<div>`.

**Side effects:** `handle.addEventListener('mousedown', _onDragStart, true)`.

---

### `_onDragStart(e)`

**What:** Begins a toolbar drag. Left-click only.

**Params:** `e` (MouseEvent).

**Side effects:**
- Stops propagation and prevents default so the sticky-zone-draw handler never sees this mousedown.
- Computes `_dragCtx = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top }`.
- Switches toolbar from CSS-default (transform-centered) to raw `{top, left}` absolute positioning using `_setPos` with `!important` (required to beat stylesheet `!important` rules).
- Clears `right`, `bottom`, `transform` on the toolbar element.
- Adds `'bl-si-toolbar--dragging'` class.
- Attaches `_onDragMove` and `_onDragEnd` at capture phase on `document`.

**Handles:** `e.button !== 0` (non-left click) returns immediately.

---

### `_onDragMove(e)`

**What:** Updates toolbar position during drag.

**Params:** `e` (MouseEvent).

**Side effects:**
- Computes new `{left, top}` from `e.clientX/Y - _dragCtx.offsetXY`, clamped to `[4, vw/vh - pill_size - 4]`.
- Calls `_setPos('left', ...)` and `_setPos('top', ...)`.
- Stops propagation and prevents default.

**Handles:** No-op if `_dragCtx` or `toolbarEl` is null.

---

### `_onDragEnd(e)`

**What:** Ends a toolbar drag.

**Params:** `e` (MouseEvent).

**Side effects:**
- Removes `_onDragMove` and `_onDragEnd` from `document`.
- Removes `'bl-si-toolbar--dragging'` class.
- Sets `_dragCtx = null`.
- Position is NOT persisted. Next picker activation opens at CSS-default top-center.

---

### `_setPos(prop, value)`

**What:** Sets a CSS property on `toolbarEl` with `!important` priority via `setProperty`.

**Params:**
- `prop` (string) — CSS property name (e.g. `'left'`).
- `value` (string) — CSS value (e.g. `'100px'`).

**Why:** The stylesheet uses `!important` on `top`/`left` for the initial toolbar position. Plain inline-style writes lose to those rules. `setProperty(prop, value, 'important')` is the only way inline writes win.

---

### `flashElementIndicator(el, text)`

**What:** Shows a transient overlay badge near the top-left corner of an element, then removes it after 900ms. Used after dynamic-mode blur/unblur to confirm the action.

**Params:**
- `el` (Element) — the element that was just blurred/unblurred.
- `text` (string) — label to display (e.g. `'Blurred'`, `'Unblurred'`).

**Side effects:** Creates a `position: fixed` `<div>` appended to `document.body`, removed via `setTimeout` at 900ms.

---

### `clearAllFromPicker()`

**What:** Calls `activeCallbacks.onUnblur(el)` for every element in `selectedElements`, then clears the set. Falls back to direct `blsi.BlurEngine.removeBlur(el)` if no callback is set.

**Side effects:** Iterates `selectedElements`, calls unblur on each, clears the set.

---

### `_modeChipLabel(mode)` / `_modeChipDescription(mode)`

**What:** Returns the short chip label or long tooltip description for a given mode, via `_t()` with English fallbacks.

| mode | label | description |
|---|---|---|
| `'sticky-page'` | `'Area on page'` | Sketch a box over a region of the page. Scrolls with content. |
| `'sticky-screen'` | `'Area on screen'` | Sketch a box fixed to your screen. Stays put when you scroll. |
| `'dynamic'` | `'Element'` | Tap an element on the page to blur it. |

---

### `_cycleMode(mode)`

**What:** Returns the next mode in the fixed cycle order `[dynamic, sticky-page, sticky-screen]`.

**Params:** `mode` (string) — current mode.

**Returns:** `string` — next mode in cycle.

---

### Chip tooltip functions

#### `_ensureChipTooltip()`

**What:** Creates the chip tooltip element (`<div id="bl-si-chip-tooltip" class="bl-si-toolbar-tooltip" role="tooltip">`) and appends it to `document.body` if it does not yet exist. Starts hidden.

#### `_showChipTooltip()`

**What:** Shows the tooltip with the current mode description. Positions it below the chip if it fits in the viewport, otherwise above. Horizontally centered on the chip, clamped to viewport edges.

**Side effects:** Sets `_chipTooltipEl.textContent`, `display: block !important`, and `top`/`left` positions.

#### `_hideChipTooltip()`

**What:** Hides the chip tooltip. Sets `display: none !important`.

#### `_destroyChipTooltip()`

**What:** Removes the chip tooltip element from the DOM and sets `_chipTooltipEl = null`. Called by `removeToolbar()`.

---

### `_onStickyMouseDown(e)`

**What:** Begins a zone draw in sticky modes. Left-click only. No-op if clicking toolbar or a zone overlay.

**Special case — zone overlay click:** If `e.target` has `data-bl-si-zone` attribute, treats it as a delete: calls `activeCallbacks.onStickyUnblur(zoneId)`, clears zone highlight, returns.

**Side effects (draw start):**
- Creates `<div class="bl-si-zone-drawing">` and appends to `document.body`.
- Initializes `drawState = { startX: e.clientX, startY: e.clientY, previewEl }`.
- Positions preview at start coordinates (0×0 size).
- Stops propagation and prevents default.

---

### `_onStickyMouseMove(e)`

**What:** Resizes the zone preview box during draw. No-op if `drawState` is null.

**Side effects:** Updates `previewEl.style.{left, top, width, height}` using `Math.min(start, current)` for position and `Math.abs(delta)` for size (supports drag in any direction).

---

### `_onStickyMouseUp(e)`

**What:** Commits or cancels a zone draw on mouse release.

**Side effects:**
- Removes `drawState.previewEl` from DOM.
- Enforces minimum size (`MIN_ZONE_SIZE = 10px`): if either `dx < 10` or `dy < 10`, cancels draw. Shows toast `'Area too small'` if delta was > 2px (user tried to draw but too small).
- Computes final coordinates (coordinate system differs by anchor):
  - `sticky-screen`: viewport-space (`x/y = clamp(left/top, 0, vw/vh - delta)`). `scrollW/H = innerWidth/Height`.
  - `sticky-page`: document-space (`x = left + scrollX`, `y = top + scrollY`). `scrollW/H = document.documentElement.scrollWidth/Height`.
- Calls `activeCallbacks.onStickyBlur({ anchor, x, y, width, height, scrollWidth, scrollHeight })`.
- Sets `drawState = null`.

---

### `_cancelDraw()`

**What:** Cancels an in-progress sticky draw (e.g. on mode switch or Escape).

**Side effects:** Removes `drawState.previewEl` from DOM; sets `drawState = null`. No-op if `drawState` is null.

---

### Zone hover label functions

#### `_onStickyMouseOver(e)`

**What:** In sticky mode, highlights a zone overlay on mouseover and shows its name label. Clears the highlight when the cursor leaves zone overlays.

**Side effects:**
- If target has `data-bl-si-zone` and is not the toolbar: calls `_clearZoneHighlight()` then sets `_highlightedZone = target`, adds `'bl-si-zone-highlight'` class, calls `_showZoneLabel(target, name)`.
- If target has no `data-bl-si-zone` and `_highlightedZone` is set: calls `_clearZoneHighlight()`.

#### `_showZoneLabel(zoneEl, text)`

**What:** Creates a `<div class="bl-si-zone-label">` with `text`, appends it as a child of `zoneEl`. Calls `_hideZoneLabel()` first.

#### `_hideZoneLabel()`

**What:** Removes `_zoneLabelEl` from DOM and sets it to null.

#### `_clearZoneHighlight()`

**What:** Removes `'bl-si-zone-highlight'` class from `_highlightedZone`, calls `_hideZoneLabel()`, sets `_highlightedZone = null`.

---

### `findClassedParent(el)`

**What:** In dynamic mode, walks up from `el` to find the nearest ancestor with non-extension CSS classes. Used to prefer a meaningful container over a classless leaf node.

**Params:** `el` (Element).

**Returns:** `Element` — the first ancestor with at least one non-`bl-si-` class, or `el` itself if none found before `document.body`.

**Handles:** Skips `bl-si-*` prefixed classes entirely — only considers classes from page styles.

---

### `resolveTarget(raw)`

**What:** Validates a raw event target for use in dynamic mode. Rejects null, non-Element, `document.documentElement`, and `document.body`.

**Params:** `raw` — any value from `event.target`.

**Returns:** `Element|null`.

---

### Unified event dispatchers

All registered at capture phase. Each dispatches to the sticky or dynamic path based on `_isSticky(currentMode)`.

#### `onMouseOver(e)`

- **Sticky:** delegates to `_onStickyMouseOver(e)`.
- **Dynamic:** resolves target; if already blurred, uses as-is (skip `findClassedParent`); if not, calls `findClassedParent`. Updates `hoveredElement` (removes `'bl-si-hover-highlight'` from previous, adds to new). Updates `selectorWarningEl` visibility based on `blsi.SelectorUtils.isSelectorStable(target)`.

#### `onMouseOut(e)`

- **Sticky:** clears zone highlight if cursor left the highlighted zone (checks `e.relatedTarget`).
- **Dynamic:** removes `'bl-si-hover-highlight'` from target; hides selector warning; clears `hoveredElement` if it equals the leaving target.

#### `onMouseDown(e)`

- **Sticky:** delegates to `_onStickyMouseDown(e)`.
- **Dynamic:** no-op.

#### `onMouseMove(e)`

- **Sticky:** delegates to `_onStickyMouseMove(e)`.
- **Dynamic:** no-op.

#### `onMouseUp(e)`

- **Sticky:** delegates to `_onStickyMouseUp(e)`.
- **Dynamic:** no-op.

#### `onClick(e)`

- **Sticky:** consumes click (`preventDefault`, `stopPropagation`, `stopImmediatePropagation`) unless clicking the toolbar. Sticky mode uses mousedown/mouseup — the click event is suppressed to prevent page handlers from firing.
- **Dynamic:** resolves target; returns if toolbar. Prevents default and stops all propagation. Checks `blsi.BlurEngine.isBlurred(target)` to decide blur vs. unblur:
  - Already blurred: calls `activeCallbacks.onUnblur(target)` (fallback: `blsi.BlurEngine.removeBlur`), removes from `selectedElements`, flashes `'Unblurred'`.
  - Not blurred: calls `findClassedParent(target)` first, then `activeCallbacks.onBlur(target)` (fallback: `blsi.BlurEngine.applyBlur`), adds to `selectedElements`, flashes `'Blurred'`.

#### `onKeyDown(e)`

- **Escape with active draw:** calls `_cancelDraw()`.
- **Escape without draw:** calls `deactivate()`.
- Prevents default and stops propagation in both cases.

---

## Zone Data Model

The `onStickyBlur` callback receives an object shaped as follows. `content_script.onStickyBlur` adds the remaining fields before calling `Store.save_blur_item`.

```js
// What picker passes to onStickyBlur callback:
{
  anchor:      'page' | 'screen',
  x:           number,  // document coords (page) or viewport coords (screen)
  y:           number,
  width:       number,
  height:      number,
  scrollWidth: number,  // document scrollWidth (page) or innerWidth (screen)
  scrollHeight: number, // document scrollHeight (page) or innerHeight (screen)
}

// What content_script adds before save:
{
  type:        'sticky',
  name:        string,  // from Engine.allocateStickyName()
  id:          string,  // from _generateZoneId() — 's_' + 8 chars
  xPct, yPct, widthPct, heightPct: number,  // percentages for re-projection
}
```

---

## Toolbar Callback Contract

`activeCallbacks` object shape passed to `activate()`:

| Callback | Signature | When called |
|---|---|---|
| `onBlur` | `async (el: Element) => void` | Dynamic mode: user clicked an unblurred element |
| `onUnblur` | `async (el: Element) => void` | Dynamic mode: user clicked a blurred element, or `clearAllFromPicker` |
| `onStickyBlur` | `async (zoneRect: object) => void` | Sticky mode: user completed a zone draw |
| `onStickyUnblur` | `async (zoneId: string) => void` | Sticky mode: user clicked an existing zone overlay |
| `onModeChange` | `async (mode: string) => void` | Mode chip cycled |
| `onDeactivate` | `() => void` | Picker deactivated (close button, Escape, external `deactivate()` call) |

All callbacks are optional. If omitted, picker falls back to direct `blsi.BlurEngine` calls (blur/unblur only; no persistence).

---

## Module State

| Variable | Type | Description |
|---|---|---|
| `isActive` | `boolean` | Whether picker is currently active |
| `currentMode` | `string` | Current picker mode (`'dynamic'` \| `'sticky-page'` \| `'sticky-screen'`) |
| `hoveredElement` | `Element\|null` | Currently highlighted element in dynamic mode |
| `selectedElements` | `Set<Element>` | Elements blurred in this session (dynamic mode); cleared on `deactivate` |
| `activeSettings` | `object` | Current settings snapshot: `{ blurRadius, highlightColor, pickerMode, … }` |
| `activeCallbacks` | `object` | Callbacks from `activate()`; cleared to `{}` on `deactivate` |
| `drawState` | `object\|null` | In-progress sticky draw: `{ startX, startY, previewEl }` or `null` |
| `_highlightedZone` | `Element\|null` | Zone overlay currently highlighted in sticky mode |
| `_zoneLabelEl` | `Element\|null` | Zone name label element currently shown |
| `toolbarEl` | `Element\|null` | The toolbar pill element |
| `toolbarLabelEl` | `null` | Legacy field; always null (long label removed) |
| `modeSelectEl` | `Element\|null` | The mode chip `<button>` |
| `selectorWarningEl` | `Element\|null` | The selector stability warning element |
| `_dragCtx` | `object\|null` | Drag offset context: `{ offsetX, offsetY }` or `null` |
| `_chipTooltipEl` | `Element\|null` | The chip tooltip `<div>` |

---

## Invariants

1. `activate()` is a no-op if `isActive` is already `true`. `deactivate()` is a no-op if `isActive` is `false`. No double-register of event listeners.
2. All 7 document event listeners are registered in `activate()` and removed in `deactivate()` — always in matching pairs.
3. `setMode()` rejects any mode that is not `'dynamic'`, `'sticky-page'`, or `'sticky-screen'` (silent no-op). Mode `'sticky'` is only accepted in `activate()` (mapped to `'sticky-page'`), not in `setMode()`.
4. `_setPos` always uses `setProperty(prop, value, 'important')`. Plain `style[prop] = value` writes lose to the stylesheet's `!important` position rules and must not be used for toolbar positioning.
5. The toolbar is appended to `document.body`, not `document.documentElement`.
6. The chip tooltip is a separate element from the toolbar (direct child of `document.body`). It is destroyed by `removeToolbar()` via `_destroyChipTooltip()`.
7. `drawState` is always either `null` or `{ startX, startY, previewEl }`. The `previewEl` is always in the DOM when `drawState` is non-null.
8. `selectedElements` only tracks elements in dynamic mode. Sticky zones are tracked by the engine via zone overlays; picker does not maintain a separate zone reference set.
9. `onDeactivate` is called at the END of `deactivate()`, after `activeCallbacks` would otherwise be cleared. The callback fires before the `activeCallbacks = {}` reset so `content_script` receives the event.
10. The picker does not read or write `chrome.storage`. All persistence goes through `activeCallbacks`.
11. Zone overlay removal (click on existing zone) in sticky mode: handled inside `_onStickyMouseDown`, which fires the `onStickyUnblur` callback and returns before starting a new draw.
12. Toolbar drag and sticky zone draw cannot happen simultaneously: `_onDragStart` stops propagation at capture phase so the zone draw mousedown handler never receives the event when the user is dragging the pill.
