# Picker Blur Modes: Sticky Blur vs Dynamic Blur

**Status:** Research / Design Proposal  
**Date:** 2026-04-06  
**Updated:** 2026-04-07 (incorporated review feedback)  
**Scope:** Picker mode UX, blur persistence, storage schema, restore logic

---

## 1. Problem Statement

Today, when a user picks an element to blur, we:

1. Walk up to the nearest parent with a CSS class (`findClassedParent`)
2. Generate a CSS selector for that element (`SelectorUtils.getSelector`)
3. Store the selector string per-hostname in `chrome.storage.local`
4. On page reload, re-query the DOM with that selector and re-apply blur

**This breaks in practice:**

| Failure mode | Frequency | Example |
|---|---|---|
| Element has no ID or class; `data-pb-id` stamp is session-only | Very common | `<div>` wrappers in React/Vue apps |
| CSS class renamed by framework rebuild or A/B test | Common | Tailwind hash classes, CSS modules |
| DOM restructured by SPA navigation | Common | React Router replaces route subtree |
| Multiple elements match the same selector | Occasional | `.card` matches 50 cards, user wanted one |
| Element removed from DOM entirely | Occasional | Feed items, notifications |

The user has no alternative. Every picker selection goes through selector-based persistence, and there's no way to say "blur *this region of the screen* regardless of what DOM element is there."

---

## 2. Proposed Solution: Two Picker Modes

When the user activates the picker, offer a choice between two blur strategies:

### A. **Sticky Blur** (new, default) — "Blur this area of the page"

- User draws or selects a rectangular region on the viewport
- We store the region as `{ x, y, width, height }` relative to the **document** (not viewport), plus the page URL path
- On restore, we inject an overlay `<div>` at those document coordinates with CSS `backdrop-filter: blur()` (or frosted, if user enabled)
- Coordinates are stored as both absolute pixels and percentages of document dimensions for proportional scaling
- Survives page reload, DOM changes, SPA navigation (as long as the page layout is similar)
- Best for: static layouts, dashboards, always-visible panels, fixed sidebars

**Why "Sticky":** It sticks to a fixed position on the page — no matter what the DOM does, the blur stays put. Like a sticky note placed over part of a page.

### B. **Dynamic Blur** (current) — "Blur this element"

- Existing behavior: pick element -> generate selector -> store -> restore via DOM query
- Follows the element wherever the DOM puts it, but breaks if the element disappears or its selector changes
- Best for: elements with stable IDs/classes (nav bars, profile cards, specific widgets)

**Why "Dynamic":** It dynamically tracks a DOM element — if the element moves in the layout, the blur follows. But if the element is gone, so is the blur.

### Tooltip text for the mode selector

| Mode | Tooltip |
|---|---|
| **Sticky** | "Draw a box to blur a fixed area on the page. Stays in place even if the page content changes." |
| **Dynamic** | "Click an element to blur it. Follows the element, but may not survive page reloads." |

---

## 3. User Flow

### 3.1 Picker Activation

When picker activates (Alt+Shift+P or popup button), the toolbar shows a **mode toggle**:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Picker Mode  [Sticky ▾]  Click and drag to blur an area.  [Clear] [×]  │
└───────────────────────────────────────────────────────────────────────────┘
```

The `[Sticky ▾]` dropdown offers:
- **Sticky** (default) — crosshair drag to draw a rectangle
- **Dynamic** — hover highlight + click (current behavior)

The selected mode is remembered in settings (`settings.PICKER_MODE: 'sticky' | 'dynamic'`) so it persists across sessions.

### 3.2 Sticky Mode (new, default)

1. **Cursor changes to crosshair** (already have `pb-picker-active` with crosshair)
2. **User presses and drags** to draw a rectangle
3. **While dragging**: semi-transparent overlay shows the selected region (like a screenshot selection tool)
4. **On mouseup**:
   - The region is finalized
   - A blur overlay div is injected at that position
   - Region coordinates are stored (see storage schema below)
   - Toast shows "Sticky 1" (auto-named)
5. **To remove**: user can click on an existing sticky overlay in picker mode to unblur it, or use the popup's blurred-items list

### 3.3 Dynamic Mode (existing, renamed)

No behavioral changes. User hovers, element highlights, click blurs/unblurs. Stored as CSS selector.

### 3.4 Naming & Labels

Every blur item gets an **auto-generated name**:
- Sticky items: "Sticky 1", "Sticky 2", "Sticky 3", ...
- Dynamic items: "Dynamic 1", "Dynamic 2", "Dynamic 3", ...

Counter is per-hostname, incrementing. Names are stored with the item and shown:
- **In picker mode**: on hover over a blurred item, a small tooltip/label appears showing the name
- **In popup**: the blurred items list shows the name as the primary identifier

Users can optionally rename items in the popup (stretch goal, not required for v1).

### 3.5 Popup Blurred Items List

Updated to show both types with names:

```
Blurred Items (3)
├─ Sticky 1    120,340 — 400x200     [×]
├─ Dynamic 1   #sidebar-profile      [×]
└─ Dynamic 2   div.feed-card         [×]
```

Each item shows: name, a secondary descriptor (coordinates or selector), and a remove button.

---

## 4. Technical Design

### 4.1 Storage Schema

**New schema** in `chrome.storage.local` (no migration needed — unreleased product):

```js
{
  blurred_items: {
    "example.com": [
      {
        type: "dynamic",
        name: "Dynamic 1",
        selector: "#profile-card"
      },
      {
        type: "sticky",
        name: "Sticky 1",
        id: "s_a3f92c1b",
        // Absolute coordinates (document-relative, px)
        x: 120,
        y: 340,
        width: 400,
        height: 200,
        // Proportional coordinates (for scaling on different screen sizes)
        xPct: 0.0833,     // x / scrollWidth
        yPct: 0.0654,     // y / scrollHeight
        widthPct: 0.2778, // width / scrollWidth
        heightPct: 0.0385,// height / scrollHeight
        // Context
        path: "/dashboard",
        scrollWidth: 1440,
        scrollHeight: 5200
      }
    ]
  }
}
```

Both absolute and proportional coordinates are stored. On restore, proportional values are used to recompute positions against the current document dimensions, ensuring zones scale correctly when window size changes.

### 4.2 Sticky Overlay Implementation

Each sticky blur creates a DOM element:

```html
<div class="pb-zone-overlay"
     data-pb-zone="s_a3f92c1b"
     data-pb-zone-name="Sticky 1"
     style="position: absolute;
            left: 120px; top: 340px;
            width: 400px; height: 200px;
            backdrop-filter: blur(var(--pb-radius, 10px));
            -webkit-backdrop-filter: blur(var(--pb-radius, 10px));
            z-index: 2147483640;
            pointer-events: none;">
</div>
```

When frosted glass mode is enabled by the user, the overlay uses `filter: url(#pb-frosted-filter)` instead — same behavior as dynamic blur, no special handling.

**Key design decisions:**

| Decision | Rationale |
|---|---|
| `position: absolute` (not `fixed`) | Scrolls with the page; covers the same content region even after scrolling |
| `backdrop-filter` (not `filter`) | Blurs content *behind* the overlay, not the overlay itself — no need to clone/capture content |
| `pointer-events: none` default | Click-through when not in picker mode; switched to `auto` in picker mode via CSS |
| Proportional scaling by default | Store both px and percentages; restore using percentages * current doc dimensions |
| Store `path` | Exact-path matching — zone from `/dashboard` doesn't appear on `/settings` |
| Append to `document.body` | Avoids CSS `transform` ancestor issues that shift absolute positioning |

**Fallback for browsers without `backdrop-filter`:** Solid semi-transparent overlay (`background: rgba(0,0,0,0.85)`) that fully obscures. Firefox 103+ and Chrome 76+ both support `backdrop-filter`, so this is edge-case only.

### 4.3 Restore Logic

On page load (inside `restoreBlurItems()`):

```
for each item in stored items for this hostname:
  if item.type === "dynamic":
    → SelectorUtils.restoreSelector(item.selector) → applyBlur
    
  if item.type === "sticky":
    → check item.path === location.pathname (exact match)
    → recompute coordinates: x = item.xPct * document.scrollWidth, etc.
    → inject zone overlay div at computed coordinates
```

**Path matching: exact match only.** The user blurred a region on `/dashboard`, it only appears on `/dashboard`. Path matching as a whole needs rework (tracked separately), but for sticky blur v1 this simple rule is sufficient.

### 4.4 Proportional Coordinate Scaling

On creation:
```js
const zone = {
  x: docX,
  y: docY,
  width: w,
  height: h,
  xPct: docX / document.documentElement.scrollWidth,
  yPct: docY / document.documentElement.scrollHeight,
  widthPct: w / document.documentElement.scrollWidth,
  heightPct: h / document.documentElement.scrollHeight,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight
};
```

On restore:
```js
const currentW = document.documentElement.scrollWidth;
const currentH = document.documentElement.scrollHeight;
const restoredX = zone.xPct * currentW;
const restoredY = zone.yPct * currentH;
const restoredW = zone.widthPct * currentW;
const restoredH = zone.heightPct * currentH;
```

The original absolute values are kept for debugging and for cases where the user explicitly wants pixel-exact positioning.

### 4.5 Module Changes

#### `src/constants.js`

```js
// New settings key
DEFAULTS.PICKER_MODE = 'sticky';  // 'sticky' | 'dynamic'

// New message types (replace SAVE_SELECTOR / GET_SELECTORS / REMOVE_SELECTOR)
STORAGE.SAVE_BLUR_ITEM = 'SAVE_BLUR_ITEM';
STORAGE.REMOVE_BLUR_ITEM = 'REMOVE_BLUR_ITEM';
STORAGE.GET_BLUR_ITEMS = 'GET_BLUR_ITEMS';

// New CSS classes
CSS.ZONE_OVERLAY = 'pb-zone-overlay';
CSS.ZONE_DRAWING = 'pb-zone-drawing';
CSS.ZONE_HIGHLIGHT = 'pb-zone-highlight';
CSS.ZONE_LABEL = 'pb-zone-label';
```

#### `src/picker.js`

New internal state:
```js
let currentMode = 'sticky';  // 'sticky' | 'dynamic'
let drawState = null;         // { startX, startY, previewEl } during sticky drag
let stickyCounter = 0;        // auto-increment for naming
let dynamicCounter = 0;
```

New methods:
- `setMode(mode)` — switch between sticky/dynamic; update toolbar label and tooltip
- Internal: `onStickyMouseDown`, `onStickyMouseMove`, `onStickyMouseUp` — drawing handlers
- Internal: `createDrawPreview()`, `finalizeZone()` — overlay creation
- Internal: `showZoneLabel(zoneEl)`, `hideZoneLabel()` — hover label in picker mode

Toolbar changes:
- Mode dropdown before the label text with tooltip on each option
- Label text updates: "Click and drag to blur an area" (sticky) vs "Hover and click to blur an element" (dynamic)

**Public API addition:**
```js
return {
  get isActive() { return isActive; },
  activate,
  deactivate,
  setSettings,
  setMode,  // new
};
```

#### `src/blur_engine.js`

New methods for sticky overlays:
```js
function createZoneOverlay(zoneData) { ... }  // inject overlay div
function removeZoneOverlay(zoneId) { ... }    // remove by ID
function getZoneOverlays() { ... }            // list all active overlays
```

No `isInZone(x, y)` needed — CSS hover handles interaction.

#### `src/storage_manager.js`

Replace existing selector methods with unified item methods:
```js
function saveBlurItem(hostname, item) { ... }
function removeBlurItem(hostname, itemId) { ... }  // selector string or zone ID
function getBlurItems(hostname) { ... }             // returns typed item objects
```

Remove `saveBlurredElement`, `removeBlurredElement`, `getBlurredSelectors` (unreleased, no backward compat needed).

#### `background.js`

- Replace `SAVE_SELECTOR` / `GET_SELECTORS` / `REMOVE_SELECTOR` handlers with `SAVE_BLUR_ITEM` / `GET_BLUR_ITEMS` / `REMOVE_BLUR_ITEM`
- Storage key: `blurred_items` (replaces `blurred_selectors`)
- Per-host limit: 10 items (sticky zones are expensive; 10 is generous for real use)

#### `content_script.js`

- `restoreBlurredElements()` → `restoreBlurItems()`: dispatch on `item.type`
- Picker activation passes `currentMode` to `Picker.activate()`
- New callback `onStickyBlur(zoneData)` alongside existing `onBlur(element)`
- MutationObserver: skip nodes with `data-pb-zone` attribute

#### `popup/popup.js`

- Blurred items list renders both types with names and secondary info
- Remove button dispatches correct message based on item type
- Mode indicator next to picker button (optional)

### 4.6 CSS Additions (`styles/content.css`)

```css
/* Sticky zone overlay — blurs content behind it */
.pb-zone-overlay {
  position: absolute;
  backdrop-filter: blur(var(--pb-radius, 10px));
  -webkit-backdrop-filter: blur(var(--pb-radius, 10px));
  background: rgba(128, 128, 128, 0.05);
  border: 1px dashed rgba(128, 128, 128, 0.3);
  z-index: 2147483640;
  pointer-events: none;
  transition: opacity var(--pb-transition-duration, 200ms);
}

/* In picker mode, zones become interactive */
.pb-picker-active .pb-zone-overlay {
  pointer-events: auto;
  cursor: pointer;
  border-color: var(--pb-highlight-color, #f59e0b);
}

/* Drawing preview while dragging */
.pb-zone-drawing {
  position: fixed;
  background: rgba(245, 158, 11, 0.15);
  border: 2px solid var(--pb-highlight-color, #f59e0b);
  z-index: 2147483645;
  pointer-events: none;
}

/* Hover highlight on existing zone in picker mode */
.pb-zone-overlay.pb-zone-highlight {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

/* Zone name label (shown on hover in picker mode) */
.pb-zone-label {
  position: absolute;
  top: -24px;
  left: 0;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2147483641;
}

/* Print: hide all zones */
@media print {
  .pb-zone-overlay { display: none; }
}
```

---

## 5. Edge Cases & Failure Modes

### 5.1 Sticky Blur

| Scenario | Behavior |
|---|---|
| Page layout changes (responsive) | Proportional scaling repositions the zone. May drift on major breakpoints — user deletes and redraws. |
| Page is scrolled when drawing | Convert viewport coords to document coords (`+ window.scrollX/Y`) at finalize time |
| User draws a very small zone (< 10px) | Ignore; show toast "Area too small" |
| User draws zone over existing zone | Allow; overlapping zones are valid |
| Zone extends beyond document bounds | Clamp to `[0, 0, scrollWidth, scrollHeight]` |
| SPA navigation changes URL path | Zone auto-hides (exact path match). Reappears when user navigates back. |
| `document.body` has `position: static` | Works — absolute positioning relative to initial containing block |
| Page has `transform` on an ancestor | Mitigated by appending overlays directly to `document.body` |
| Print / reader mode | Hidden via `@media print` rule |
| Zoom level changes | Browser zoom scales proportionally; zones scale with it |
| Frosted glass mode enabled | Zone uses `filter: url(#pb-frosted-filter)` — same SVG filter as dynamic blur |

### 5.2 Dynamic Blur (existing issues, unchanged)

| Scenario | Behavior |
|---|---|
| Selector becomes stale | Silent failure — element not found on restore |
| Multiple matches | First match blurred (current behavior) |
| SPA replaces element | Lost until next reload |

### 5.3 Mode Switching

| Scenario | Behavior |
|---|---|
| Switch mode while picker active | Cancel any in-progress zone drag; switch immediately |
| Zone mode on touch device | Not supported in v1; fall back to dynamic mode |
| Zone mode with keyboard only | Not supported; sticky requires mouse drag |

---

## 6. Reveal Modes & Sticky Zones

Current reveal modes (hover, click, none) work with sticky zones:

| Reveal mode | Dynamic blur | Sticky blur |
|---|---|---|
| `hover` | Existing: unblur on hover | On hover over zone overlay: reduce `backdrop-filter` to `blur(0px)` |
| `click` | Existing: unblur on click | On click on zone overlay: toggle revealed state |
| `none` | Existing: no reveal | Zone always blurred |

Implementation: Zone overlays get the same `data-pb-revealed` attribute handling as blurred elements.

---

## 7. Performance Considerations

| Concern | Analysis |
|---|---|
| `backdrop-filter` cost | GPU-composited; modern browsers handle well. 10 zones is well within budget. |
| Zone overlay count limit | Cap at 10 per hostname. |
| MutationObserver interaction | Zone overlays excluded from observer via `data-pb-zone` attribute check |
| Storage size | Each zone item ~200 bytes JSON (with proportional coords). 10 zones = 2KB. Negligible. |
| Restore performance | Zone restore is O(n) inject — faster than selector restore which requires DOM queries |

---

## 8. Implementation Plan

### Phase 1: Storage Refactor (foundation)

1. Replace `blurred_selectors` with `blurred_items` storage key in `background.js`
2. Replace `SAVE_SELECTOR` / `GET_SELECTORS` / `REMOVE_SELECTOR` message types with `SAVE_BLUR_ITEM` / `GET_BLUR_ITEMS` / `REMOVE_BLUR_ITEM` in `constants.js`
3. Replace `saveBlurredElement` / `getBlurredSelectors` / `removeBlurredElement` with `saveBlurItem` / `getBlurItems` / `removeBlurItem` in `storage_manager.js`
4. Update `content_script.js` restore logic to dispatch on `item.type`
5. Update `popup/popup.js` blurred-items list to render typed items with names
6. All tests updated (no backward compat wrappers)

**Tests:** Unit tests for new storage methods, typed item handling.

### Phase 2: Sticky Overlay Engine

1. Add `createZoneOverlay` / `removeZoneOverlay` / `getZoneOverlays` to `blur_engine.js`
2. Add CSS for `.pb-zone-overlay`, `.pb-zone-drawing`, `.pb-zone-label`
3. Add zone restore logic to `content_script.js` (proportional scaling, path matching)
4. Add reveal mode support for zones
5. Exclude zone overlays from MutationObserver

**Tests:** Unit tests for overlay inject/remove, coordinate scaling, path matching.

### Phase 3: Picker Mode Toggle

1. Add mode dropdown to picker toolbar with tooltips
2. Implement sticky drawing handlers (`mousedown` → `mousemove` → `mouseup`)
3. Add `PICKER_MODE` to settings defaults + popup settings UI
4. Wire finalize → storage save → overlay inject pipeline
5. Wire click-to-remove in picker mode
6. Auto-naming system (Sticky 1, Dynamic 1, ...)
7. Hover labels in picker mode

**Tests:** Unit tests for drawing state machine, mode switching, coordinate conversion, naming.

### Phase 4: Polish & v2 Prep

1. Zone size minimum enforcement (10px)
2. Print media query exclusion
3. Touch device detection and fallback
4. Popup UI polish (names, coordinates, path info)
5. **v2: Resize handles on sticky zones** (drag corners/edges to resize after creation)

---

## 9. Alternatives Considered

### 9.1 Screenshot + Image Comparison

**Rejected:** Requires `<canvas>` pixel access (blocked by CORS/DRM), extremely expensive on every page load, fragile against any content change.

### 9.2 XPath Selectors

**Rejected:** Even more fragile than CSS selectors for dynamic content. Doesn't solve the fundamental problem of elements not existing in the DOM.

### 9.3 AI-Based Element Matching

**Rejected:** Requires external service or heavy ML model, latency, privacy concerns (defeating the purpose of a privacy tool).

### 9.4 Fixed-Position Overlay Only

**Rejected:** Only works for fixed-position UI (nav bars, sidebars). Most content scrolls.

### 9.5 Hybrid: Zone + Anchor Element

**Parked for v2:** Store both zone coordinates AND the nearest element selector. On restore, try the selector first; if it fails, fall back to coordinates. Adds complexity to the mental model.

---

## 10. Resolved Questions

| Question | Decision |
|---|---|
| Blur style for sticky zones? | Same as dynamic — gaussian by default, frosted if user enabled. No separate setting. |
| Resizable after creation? | v2. Delete and redraw for v1. |
| Labels/names? | Yes. Auto-named "Sticky 1", "Dynamic 1", etc. Shown on hover in picker mode and in popup list. |
| Interaction with blur-all mode? | Coexist independently. Hover reveal works on both. |
| Max zones per host? | 10 (sticky + dynamic combined). |
| Non-rectangular zones? | No. Rectangles only. |
| Default mode? | Sticky (new default). |

---

## 11. Summary

| Aspect | Dynamic Blur (current) | Sticky Blur (new, default) |
|---|---|---|
| Selection | Click on DOM element | Draw rectangle on page |
| Persistence | CSS selector string | Document coordinates (absolute + proportional) + path |
| Restore | DOM query → re-apply | Proportional scaling → inject overlay div |
| Survives reload | Only if selector is stable | Yes (same layout assumed) |
| Survives DOM change | No | Yes |
| Survives layout change | N/A (element-bound) | Proportional scaling adapts to width changes |
| Naming | "Dynamic 1", "Dynamic 2" | "Sticky 1", "Sticky 2" |
| Performance | Negligible | GPU layer per zone |
| Best for | Stable, identifiable elements | Regions, dynamic content, SPAs |
| Storage cost | ~80 bytes/item | ~200 bytes/item |
| Path scoping | By hostname only | Exact pathname match |

The two modes are complementary. Dynamic blur is precise but fragile; sticky blur is robust but position-dependent. Defaulting to sticky gives users the more reliable experience out of the box, with dynamic available for users who want element-tracking behavior.
