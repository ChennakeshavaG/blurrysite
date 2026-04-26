# reveal_controller Test Contract

## Overview

Tests for `src/reveal_controller.js` (`blsi.Reveal`). The module controls temporary
reveal of blurred elements via click or hover interactions. Tests verify reveal
attribution via `data-bl-si-reveal`, shadow DOM event-path piercing, debounce
timing, picker gating, mode gating, Escape dismissal, and lifecycle teardown.

## Setup & Teardown

- `beforeAll`: loads `blsi.SelectorUtils`, `blsi.BlurEngine`, then `blsi.Reveal` via
  `require()` (falls back to inline stub if file missing).
- `beforeEach` (`resetState`): resets `mode = 'click'` and `pickerActive = false`,
  clears `document.body.innerHTML`, removes blur-style elements, calls
  `blsi.BlurEngine.unblurAll()`, destroys any prior `Reveal` instance, and calls
  `blsi.Reveal.init({ getMode, isPickerActive })` with closures over the reset vars.
- `afterEach`: calls `blsi.Reveal.destroy()` (swallows errors).
- `fireClick(target)` helper: dispatches a cancelable `MouseEvent('click')` on
  `document` with `event.target` overridden to the given element.
- `fireMouseOver(target)` helper: dispatches a `MouseEvent('mouseover')` on
  `document` with `event.target` overridden.

## Test Groups

### blsi.Reveal — click mode

- `click on blurred element reveals it` — first click sets `el.dataset.blSiReveal === '1'` on a blurred element.
- `second click on same element keeps reveal (link pass-through)` — second click on an already-revealed element does not clear the reveal attribute.
- `first click on blurred element calls preventDefault` — `event.defaultPrevented` is `true` after the first intercepting click.
- `second click on revealed element does not preventDefault (link works)` — `event.defaultPrevented` is `false` on the second click so native navigation proceeds.
- `Escape dismisses click reveal` — dispatching a `keydown` with `key: 'Escape'` removes `data-bl-si-reveal` from a revealed element.
- `first click on blurred input reveals it; second click passes through` — first click reveals the input; second click (dispatched directly on the input) does not call `preventDefault`.
- `picker active blocks click reveal` — when `isPickerActive()` returns `true`, click does not set `data-bl-si-reveal`.
- `mode=none disables click reveal` — when `getMode()` returns `'none'`, click does not set `data-bl-si-reveal`.

### blsi.Reveal — hover mode

- `mouseover on blurred element reveals it` — `mouseover` event sets `el.dataset.blSiReveal === '1'` when `mode === 'hover'`.
- `mouseout debounces dismiss by 50ms` — after `mouseout`, reveal is still present immediately; after `jest.advanceTimersByTime(60)` the attribute is cleared (uses `jest.useFakeTimers()`).

### blsi.Reveal.clearAll

- `clears any active reveal` — after a click-reveal, `blsi.Reveal.clearAll()` removes `data-bl-si-reveal` from all currently revealed elements.

### blsi.Reveal — composedPath (shadow DOM pierce)

- `onRevealMouseOver reveals composedPath target, not retargeted e.target` — when `ev.composedPath()` is overridden to return `[innerEl, hostEl, ...]`, a `mouseover` event reveals `innerEl` (the composedPath head) rather than `hostEl` (the retargeted `e.target`).
- `onRevealClick reveals composedPath target, not retargeted e.target` — same composedPath-override logic applied to a `click` event; reveals the composedPath head, not the retargeted target.

### blsi.Reveal — shadow host reveal (parentElement boundary)

- `hover over element inside shadow root reveals blurred shadow host` — when a blurred custom element hosts a shadow root containing an unblurred `<span>`, hovering the inner span (composedPath override) sets `data-bl-si-reveal` on the blurred host element (walks `getRootNode().host`).
- `hover over shadow DOM child finds blurred light DOM ancestor of host` — when the blur is on a light-DOM wrapper (not on the custom host), hover over shadow content reveals the outer wrapper, not the intermediate host; host remains un-revealed.

### blsi.Reveal.destroy

- `after destroy, clicks no longer reveal` — after `blsi.Reveal.destroy()`, clicking a blurred element does not set `data-bl-si-reveal`.

## Edge Cases Covered

- Shadow DOM event retargeting: `composedPath()[0]` is used instead of `e.target` so elements inside shadow roots receive reveal correctly.
- Shadow host chain walking: when `parentElement` is `null` (inside a shadow root), the module traverses `getRootNode().host` to find a blurred ancestor in the light DOM.
- Double-click pass-through: the first click intercepts and reveals; the second click propagates normally, allowing native behaviors (link navigation, input focus) to proceed.
- Debounce on hover-out: `mouseout` does not immediately strip reveal; a 50 ms timer fires the removal so rapid re-enter does not flicker.
- Guard conditions: picker-active and `mode=none` both fully suppress reveal logic.
- Escape key as a global dismiss: functions as a catch-all reveal-clear without requiring the user to re-click revealed elements.

## Coverage Gaps

- No test for `revealAncestorChain()` — parent containers up to `documentElement` should also receive `data-bl-si-reveal` so parent blur containers are visible when a child is targeted.
- No test for zone overlay reveal — a `.bl-si-zone-overlay` element with `data-bl-si-blur` should respond to click/hover the same way as a regular element.
- No test for `clearAll()` when nothing is currently revealed (expected silent no-op).
- No test for nested shadow roots (two levels deep); existing shadow tests use only one shadow level.
- No test verifying click on an unblurred element (no `data-bl-si-blur`) does nothing — `data-bl-si-reveal` must not be added to non-blurred elements.
- No test for `mode=none` suppressing hover reveal.
- No test for picker-active blocking hover reveal.
- No test for `destroy()` when hover mode is active — any pending 50 ms debounce timer should be cancelled on teardown.
