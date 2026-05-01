# automate/overlay.tests Contract

## Overview

Unit-test suite for `src/automate/overlay.js`. Verifies the viewport-covering
blur overlay primitive (`blsi.Automate.Overlay`) — DOM mounting, mode
application (`solid` / `frosted` / `color`), update merging, hide/destroy
teardown, and `isVisible()` accuracy.

The suite reloads the module per test via `jest.resetModules()` + `require()`
so each test starts from a clean closure (`_el = null`, `_initialized = false`).
DOM is reset in `beforeEach`. The module mounts `<div id="bl-si-automate-overlay">`
to `document.body`.

## Describe groups

### `mounting`
- `init()` does not mount any DOM by itself (lazy — overlay only appears on `show`).
- `show()` mounts a `<div>` with `id="bl-si-automate-overlay"`, the
  `data-bl-si-extension-ui="1"` exclusion attribute, and the `aria-hidden="true"`
  hint.
- `show()` is idempotent — calling twice does not duplicate the element.
- `hide()` removes the element. After `hide`, `isVisible()` is `false`.
- `destroy()` removes the element + resets internal state.

### `base styles`
- The overlay uses inline `!important` styles for `position`, `top/right/bottom/left`,
  `width`, `height`, `z-index`, `pointer-events`, `display`, `user-select`, `all`.
- `z-index` is one below the picker toolbar (`2147483646`).
- `position: fixed` covers the entire viewport.

### `mode application`
- `show({ mode: 'solid', color: '#000000', opacity: 1 })` sets `background:
  rgba(0,0,0,1)` and removes any `backdrop-filter`.
- `show({ mode: 'frosted', color: '#ffffff', opacity: 0.5, blur_radius: 12 })`
  sets `background` to a translucent rgba and applies `backdrop-filter:
  blur(12px)` plus the `-webkit-` variant.
- `show({ mode: 'color', color: '#ff0000', opacity: 0.4 })` sets `background:
  rgba(255,0,0,0.4)` and removes any `backdrop-filter`.
- An invalid hex falls back to `rgba(0,0,0,alpha)`.
- Frosted mode caps the tint alpha at `0.6` so the backdrop blur stays visible.
- `opacity` outside `[0, 1]` is clamped.

### `update`
- `update(opts)` merges into `_last_options` rather than replacing them.
- Calling `update` before `show` falls through to `show` (mounts the overlay).

### `isVisible`
- Returns `false` initially, `true` after `show`, `false` after `hide` or `destroy`.

### `destroy`
- Removes the element + clears `_initialized` + `_last_options` so a subsequent
  `show()` re-mounts cleanly.

## Edge cases covered

- Overlay mounts to `document.body`, not `document.documentElement` (matches
  picker behavior).
- Inline styles use `setProperty(name, value, 'important')` so page CSS cannot
  hide the overlay.
- Invalid hex value falls back to the default black tint without throwing.
- Mode switching `frosted` → `solid` removes the previous `backdrop-filter`.

## Known gaps

- No test for `aria-hidden`-only mode (the overlay is not currently focusable;
  if that ever changes, add a focus-trap test).
- No test for very high blur radii — purely a CSS pass-through.
- No test for multiple show/hide churn affecting GC; overlay is a single
  element so this is implicit.

## Test count

18 tests in 6 describe groups.

## jsdom-specific notes

- jsdom canonicalises bare `0` length values to `0px` (we assert `'0px'`, not `'0'`).
- jsdom collapses `rgba(R,G,B,1)` → `rgb(R, G, B)` when alpha is 1.
- jsdom uses `cssstyle`'s property whitelist, so `backdrop-filter` and
  `-webkit-backdrop-filter` are silently dropped by `setProperty`. Tests verify
  those calls by spying on `CSSStyleDeclaration.prototype.setProperty` instead
  of reading them back through `getPropertyValue`.
