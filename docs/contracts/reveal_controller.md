# reveal_controller Contract

## Overview

Manages temporary reveal of blurred elements via the `data-bl-si-reveal` attribute. Three modes: `hover` (reveal on cursor enter, hide on leave), `click` (reveal on first click, dismiss on click outside or Escape), `none` (all reveal disabled). All event listeners are at capture phase. Depends on `blsi.BlurEngine` for `isVisuallyBlurred()` and `getZoneOverlays()`. The module itself is stateless relative to blur state — it only stamps/removes the reveal attribute.

## Module State

| Variable | Description |
|---|---|
| `_getMode` | `() => string` — lazy getter for current reveal mode (from caller's closure) |
| `_getPickerActive` | `() => boolean` — lazy getter for picker state |
| `_installed` | `boolean` — idempotent guard; `init()` is a no-op if already installed |
| `revealedAncestors` | `Element[]` — elements stamped by `revealAncestorChain()` |
| `clickRevealedEl` | `Element\|null` — element currently revealed in click mode |
| `mouseoutTimer` | `TimeoutID\|null` — 50ms debounce for hover reveal dismissal (zones and regular elements) |
| `_hoverRevealedEl` | `Element\|null` — element currently revealed in hover mode (zone or regular) |
| `_revealedElements` | `Set<Element>` — all elements with `data-bl-si-reveal` (for efficient cleanup) |
| `_rafPending` | `boolean` — rAF gate; prevents queuing multiple `_processZoneHover` frames |
| `_lastMouseX` | `number` — last recorded `clientX` from `mousemove`; `-1` when reset |
| `_lastMouseY` | `number` — last recorded `clientY` from `mousemove`; `-1` when reset |
| `_mouseMoveAttached` | `boolean` — tracks whether the `mousemove` listener is currently attached |

## Public API

### init({ getMode, isPickerActive })

**What**: Registers all base reveal event listeners. Idempotent — no-op if already installed.  
**Params**:
- `getMode` (function) — called on every event to get current reveal mode (`'hover'|'click'|'none'`); functions not values so no re-init needed on settings change
- `isPickerActive` (function) — called to guard click reveal while picker is active  
**Returns**: `void`  
**Side effects**:
- Registers 4 base listeners: `mouseover` (capture), `mouseout` (capture), `click` (capture), `keydown` (bubble)
- `mousemove` listener is NOT registered here — lazily attached by `_syncMouseMoveListener()` only when zones exist
- Sets `_installed = true`

### destroy()

**What**: Removes all listeners and clears all reveal state.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Removes all 4 base listeners; removes `mousemove` listener if attached (`_mouseMoveAttached`); calls `clearAll()`; sets `_installed = false`  
**Handles**: Idempotent — no-op if not installed.

### clearAll()

**What**: Resets every piece of reveal state without removing listeners.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Clears `mouseoutTimer`; resets `_rafPending`, `_lastMouseX`, `_lastMouseY`; calls `_unrevealAll()` (removes `data-bl-si-reveal` from all elements); calls `clearRevealedAncestors()`; nulls `clickRevealedEl` and `_hoverRevealedEl`  
**Does NOT**: Remove or reset the `mousemove` listener — `_mouseMoveAttached` is a lifecycle concern, not reveal state. `destroy()` handles full teardown.  
**Called by**: `applyState` on mode change, on `enabled === false` path, and by `destroy()`.

## Internal Functions

### findBlurredTarget(el, clientX, clientY)

**What**: Three-phase search for the nearest blurred element at cursor position.  
**Phase 1 (UP)**: Walks `parentElement` chain from `el` up to `documentElement` looking for `isVisuallyBlurred`.  
**Phase 2 (shadow host chain)**: When `parentElement` returns null (inside shadow root), walks up shadow host chain; re-enters light DOM from outermost host if needed. Handles: `<rpl-badge data-bl-si-blur> → #shadow-root → <span>` pattern.  
**Phase 3 (DOWN)**: Falls back to `querySelectorAll` on `el`'s subtree using the full blurred-element selector; iterates in reverse DOM order (innermost first); uses `getBoundingClientRect` + clientX/Y for hit-testing.  
**Returns**: `Element|null`

### revealAncestorChain(el)

**What**: Stamps `data-bl-si-reveal="1"` on all blurred ancestors of `el`, including across shadow DOM boundaries.  
**Side effects**: Updates `revealedAncestors` array; walks `parentElement` chain in light DOM and shadow host chain across shadow boundaries.  
**Why**: A shadow host with `data-bl-si-blur` applies `filter:blur()` to its entire shadow root contents even when inner elements have `data-bl-si-reveal`. Clearing the host is required.

### _revealElement(el)

**What**: Stamps `data-bl-si-reveal="1"` on `el` and all blurred descendants.  
**Side effects**: Adds `el` to `_revealedElements`; queries subtree for all blurred elements and stamps + adds them too. Zone overlays are NOT given a child-stamp pass (zones have no blurred children).

### _unrevealElement(el)

**What**: Removes `data-bl-si-reveal` from `el` and all stamped descendants.  
**Side effects**: Queries `[data-bl-si-reveal]` under `el`, removes attribute from each, removes from `_revealedElements`.

### _unrevealAll()

**What**: Removes `data-bl-si-reveal` from every element in `_revealedElements` and clears the set.

### onRevealClick(e)

**What**: Handles click reveal mode. Uses `composedPath()[0]` to pierce shadow DOM retargeting.  
**Flow**:
1. No-op if mode ≠ click or picker is active
2. Zone overlay at point → reveal zone (second click passes through)
3. Click inside already-revealed element → pass through; override `_blank` links to same-tab (unless modifier key)
4. Click on non-blurred area → dismiss reveal, pass through
5. First click on blurred element → intercept: `preventDefault + stopPropagation`, reveal element + ancestor chain  
**`_redirectIfBlankLink`**: Overrides `target="_blank"` navigation to `window.location.assign()` unless user holds `Ctrl/Cmd/Shift` or uses non-left-button — prevents disruptive new tabs after revealing content.  
**Note**: Click mode still uses `_findZoneAtPoint` directly (click event carries coordinates). Mousemove is hover-only.

### onRevealMouseOver(e)

**What**: Handles hover reveal for regular blurred elements. Uses `composedPath()[0]` for shadow DOM piercing.  
**Zone detection**: Removed from this handler. Zone boundary detection moved entirely to `_processZoneHover` (mousemove-based) to avoid the "distance to travel" lag caused by `pointer-events: none` gaps in zone overlays.  
**Calls `_syncMouseMoveListener()`** on entry (after mode/trust guard) to lazily attach/detach the `mousemove` listener based on zone presence.  
**Critical behavior**: When `blurredRoot === null` (cursor over non-blurred wrapper), does NOT clear the `mouseoutTimer` — allows the 50ms debounce to handle genuine cursor exits. Clearing here would cause hover reveal to stick when cursor drifts into wrapper whitespace.

### onRevealMouseOut(e)

**What**: 50ms debounce before dismissing hover reveal for regular elements. Prevents flicker on element boundaries.  
**Calls `_syncMouseMoveListener()`** to sync listener state on every cursor boundary crossing.  
**Zone guard**: Skips starting the timer when the currently revealed element is a zone overlay (`_isZoneOverlay(_hoverRevealedEl)`). Zone dismiss is owned by `_processZoneHover` — `mouseout` never reliably fires at a zone boundary because `pointer-events: none` makes zone overlays invisible to the event system.

### onRevealKeydown(e)

**What**: Dismisses click reveal on `Escape`.

### _findZoneAtPoint(clientX, clientY)

**What**: Hit-tests all active zone overlays at viewport coordinates; returns last-in-array match (topmost).  
**Used by**: `_processZoneHover` (hover mode) and `onRevealClick` (click mode).

### _isZoneOverlay(el)

**What**: Returns `true` if element has `data-bl-si-zone` attribute (is a zone overlay).

### _syncMouseMoveListener()

**What**: Lazily attaches or detaches the `mousemove` capture listener based on whether zone overlays currently exist.  
**Side effects**: Adds or removes `onRevealMouseMove` at capture phase on `document`; updates `_mouseMoveAttached`.  
**Called by**: `onRevealMouseOver` and `onRevealMouseOut` on every cursor boundary crossing — cheap because `Engine.getZoneOverlays()` returns an in-memory array (O(1)).  
**Performance**: `mousemove` listener is absent on pages with no zones — zero cost for the common case.

### onRevealMouseMove(e)

**What**: Thin `mousemove` handler — stores cursor coordinates and schedules one `requestAnimationFrame` per frame.  
**Guards**: mode ≠ hover, untrusted events, picker active — all early-exit.  
**rAF gate**: `_rafPending` prevents queuing multiple frames. Chrome 60+ already frame-aligns `mousemove` (once per frame before rAF); the gate also guards older browsers.  
**Does NOT**: Perform zone detection — delegates entirely to `_processZoneHover`.

### _processZoneHover()

**What**: rAF callback. Performs zone boundary detection using last stored cursor coordinates.  
**Guards**: `_installed` checked at top — prevents stale rAF (scheduled by `onRevealMouseMove`) from running after `destroy()`.  
**Flow**:
- No zones → early return
- Cursor inside a zone → cancel mouseout timer, reveal zone (no-op if same zone already revealed)
- Cursor outside all zones AND current hover-revealed element is a zone → start 50ms dismiss debounce (same pattern as regular element dismiss)
- Cursor outside all zones AND current hover-revealed element is NOT a zone → no-op (regular element dismiss is handled by `onRevealMouseOut`)  
**Why coordinate-based**: Zone overlays use `pointer-events: none`. The browser only fires `mouseover` when the cursor hits an underlying page element — when the zone interior has gaps between elements, `mouseover` is not delivered until the cursor reaches the next element boundary. `mousemove` fires on every cursor position update regardless, giving immediate zone enter/exit detection.

## Reveal CSS Architecture

Reveal is entirely attribute-driven — no inline styles. CSS in `styles/content.css` and the engine's injected `<style>`:
- `[data-bl-si-blur][data-bl-si-reveal]` — clears filter
- `[data-bl-si-pick-blur][data-bl-si-reveal]` — clears filter + background + color
- `.bl-si-zone-overlay[data-bl-si-reveal]` — clears `backdrop-filter` + `background` (handles blur/frosted/color zone modes)

`isVisuallyBlurred` is used for reveal walks (broader — includes role-based CSS matches). `isBlurred` is used by picker/context-menu (narrower — only storage-backed items). Do NOT conflate.

## Invariants

- `init()` is idempotent — `_installed` gate prevents double-registration.
- Reveal is ALWAYS attribute-driven — never inline styles.
- `clearAll()` ALWAYS resets the entire reveal state — including ancestor chain, timers, RAF state, and both click/hover revealed element refs.
- `onRevealMouseOver` does NOT clear `mouseoutTimer` when `blurredRoot === null` — prevents stuck hover reveal.
- `composedPath()[0]` is used in both click and mouseover handlers — required for shadow DOM event retargeting.
- mouseover/mouseout/mousemove/click listeners are at **capture phase** — SPAs often stop propagation at intermediate levels; bubble-phase listeners would never fire.
- Zone hover reveal is owned exclusively by `_processZoneHover` (mousemove path). `onRevealMouseOver` and `onRevealMouseOut` do not touch zone reveal state.
- Regular element hover reveal is owned exclusively by `onRevealMouseOver`/`onRevealMouseOut`. `_processZoneHover` does not touch regular element reveal state.
- `mousemove` listener is NEVER attached at `init()` — lazily attached by `_syncMouseMoveListener()` only when zones exist. Pages without zones pay zero `mousemove` cost.
- `_processZoneHover` MUST check `_installed` at its top — it is a rAF callback and may fire after `destroy()` is called.
