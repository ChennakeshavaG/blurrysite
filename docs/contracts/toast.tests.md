# toast Test Contract

## Overview

Tests for `src/toast.js` (`blsi.Toast`). The module renders the in-page floating
`.bl-si-toast` and owns its lifecycle (single-slot, persistent flag, auto-dismiss,
exit animation). Tests cover the public API only — `show`, `dismiss`, `clearIfTransient`.

## Setup & Teardown

- `beforeAll`: `require()` the module so `blsi.Toast` is available.
- `beforeEach`: clear `document.body`, run `jest.useFakeTimers()` so the
  exit-animation `setTimeout(_, 250)` and auto-dismiss timers are deterministic.
- `afterEach`: `jest.useRealTimers()`, remove any straggling `.bl-si-toast`.

## Test Groups

### show

- `appends a .bl-si-toast to document.body` — element with `role=status` and
  `aria-live=polite` is present after `show('hello')`.
- `renders message text into .bl-si-toast__message` — span text matches input.
- `renders close button with aria-label from chrome.i18n` — falls back to `'Dismiss'`
  when `chrome.i18n.getMessage` returns empty.
- `default duration is 15000ms` — auto-dismiss fires after 15s of fake-timer advance.
- `custom duration honored` — `show('msg', 5000)` dismisses after 5s.
- `actions row appended when actions array non-empty` — each action becomes a button
  in `.bl-si-toast__actions`; missing `label` or non-function `onClick` skipped.
- `action variant 'warn' applies bl-si-toast__action--warn class`.
- `clicking an action dismisses the toast then invokes onClick` — verified via
  spy + DOM assertion.
- `persistent flag skips auto-dismiss` — after 30s of fake-timer advance,
  `.bl-si-toast` still in DOM.
- `persistent flag blocks replacement by non-persistent show` — second `show`
  call returns `undefined`; original toast still in DOM.
- `override:true forces replacement of an existing persistent toast` — when a
  persistent toast is on screen, a second `show(..., { persistent: true, override: true })`
  replaces it. Used by Manager's screen-share rising edge to override a stale
  idle persistent toast.
- `override:true also replaces a non-persistent live toast (no-op vs default)` —
  `override` is a superset of the default replacement behavior; passing it on a
  non-persistent live toast still results in clean replacement.
- `non-persistent show replaces existing non-persistent toast synchronously` —
  only one `.bl-si-toast` in DOM at any time.

### dismiss

- `dismiss removes the live toast (persistent or not)` — after `show(..., { persistent: true })`
  + `dismiss()` + 250ms tick, no `.bl-si-toast` in DOM.
- `dismiss is a no-op when no toast is showing`.

### clearIfTransient

- `clearIfTransient removes a non-persistent toast immediately (no exit animation)` —
  no need to advance fake timers; element is gone synchronously.
- `clearIfTransient leaves persistent toasts in place` — used by `Shortcuts.destroy()`
  so the screen-share persistent toast survives shortcut teardown.

## Edge Cases Covered

- `chrome.runtime.getURL` missing → logo `<img>` skipped, no throw.
- `chrome.i18n.getMessage` returns empty → close button `aria-label` defaults to `'Dismiss'`.
- Empty / non-array `actions` → no action row rendered.
- Action with missing `label` or non-function `onClick` → skipped silently.
