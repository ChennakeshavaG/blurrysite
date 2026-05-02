# automate/overlay.tests Contract

## Overview

Unit-test suite for `src/automate/overlay.js`. Verifies the viewport-covering
frosted blur overlay (`blsi.Automate.Overlay`) — DOM mounting, the fixed
frosted style (backdrop-filter blur + dark tint), hide/destroy teardown, and
`isVisible()` accuracy.

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
- `destroy()` removes the element + resets internal state. Subsequent `show()`
  remounts cleanly.

### `base styles`
- The overlay uses inline `!important` styles for `position`, `top/right/bottom/left`,
  `width`, `height`, `z-index`, `pointer-events`, `background`.
- `z-index` is one below the picker toolbar (`2147483646`).
- `position: fixed` covers the entire viewport (`100vw × 100vh`).
- `background` is also marked `!important` (overlay primitive owns its tint).

### `frosted style`
- `show()` calls `setProperty('backdrop-filter', 'blur(40px)', 'important')`
  and `setProperty('-webkit-backdrop-filter', 'blur(40px)', 'important')`.
  (Verified via `setProperty` spy because jsdom's cssstyle drops the property.)
- `background` is `rgba(0, 0, 0, 0.45)` — the moderate dark tint atop the
  backdrop blur.

### `isVisible`
- Returns `false` initially, `true` after `show`, `false` after `hide`.

## Edge cases covered

- Overlay mounts to `document.body`, not `document.documentElement` (matches
  picker behavior).
- Inline styles use `setProperty(name, value, 'important')` so page CSS cannot
  hide the overlay.
- `show()` after `destroy()` re-mounts cleanly (no stale closure state).

## Known gaps

- No test for `aria-hidden`-only mode (the overlay is not currently focusable;
  if that ever changes, add a focus-trap test).
- No test for the actual rendered look of `backdrop-filter: blur(40px)` —
  jsdom drops the property; visual verification is manual.
- No test for `document.body` being absent at `show()` call time (the module
  silently skips; jsdom always provides body).

## Test count

11 tests in 4 describe groups.

## jsdom-specific notes

- jsdom canonicalises bare `0` length values to `0px` (we assert `'0px'`, not `'0'`).
- jsdom uses `cssstyle`'s property whitelist, so `backdrop-filter` and
  `-webkit-backdrop-filter` are silently dropped by `setProperty`. The frosted
  style test verifies those calls by spying on
  `CSSStyleDeclaration.prototype.setProperty` instead of reading them back
  through `getPropertyValue`.
