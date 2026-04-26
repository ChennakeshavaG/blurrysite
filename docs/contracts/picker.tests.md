# picker Test Contract

## Overview

Unit tests for `src/picker.js`. The module exposes `blsi.Picker` with four public members: `activate`, `deactivate`, `setSettings`, `setMode`, `rebuildToolbar`, and an `isActive` getter.

Tests verify activation/deactivation lifecycle, hover-highlight toggling, click blur/unblur routing, Escape-key handling, sticky zone drawing, mode switching, i18n toolbar rendering, and boundary/safety conditions.

Dependencies mocked as window globals: `blsi.BlurEngine` (`applyBlur`, `removeBlur`, `isBlurred`) and `blsi.SelectorUtils` (`getSelector`, `getSelectors`, `isSelectorStable`, `generateId`).

## Setup & Teardown

- `beforeAll` — calls `setupGlobalMocks()` to install `blsi.BlurEngine` and `blsi.SelectorUtils` jest mocks, then calls `loadPicker()` which `require()`s the real source file (or falls back to an inline IIFE stub if the file is absent).
- `beforeEach` — resets `document.body.innerHTML` and `document.documentElement.className` to empty, calls `jest.clearAllMocks()`, then defensively calls `blsi.Picker.deactivate()` to prevent state leakage between tests.
- `afterEach` — calls `blsi.Picker.deactivate()` as a safety net in case the test left the picker active.
- `i18n integration` describe block adds its own `beforeEach`/`afterEach` to save and restore `blsi.ContentI18n` across each i18n test.

### Helper functions

| Helper | What it fires |
|---|---|
| `fireMouseover(target)` | `MouseEvent('mouseover')` dispatched on `document` with `target` overridden |
| `fireMouseout(target)` | `MouseEvent('mouseout')` dispatched on `document` with `target` overridden |
| `fireClick(target)` | `MouseEvent('click')` dispatched on `document` with `target` overridden; returns the event |
| `fireKey(key)` | `KeyboardEvent('keydown')` dispatched on `document` |
| `fireMouseDown(target, x, y)` | `MouseEvent('mousedown')` dispatched on `target` (sticky-mode tests only) |
| `fireMouseMove(x, y)` | `MouseEvent('mousemove')` dispatched on `document` (sticky-mode tests only) |
| `fireMouseUp(x, y)` | `MouseEvent('mouseup')` dispatched on `document` (sticky-mode tests only) |

## Test Groups

### activate
- `adds pb-picker-active class to html element` — `activate({ pickerMode:'dynamic' }, {})` adds `bl-si-picker-active` to `document.documentElement.classList`
- `creates a toolbar element in the DOM` — `document.getElementById('bl-si-picker-toolbar')` is non-null after activation
- `calling activate twice is safe (idempotent)` — two consecutive `activate()` calls produce exactly one toolbar element in the DOM

### hover highlight
- `adds bl-si-hover-highlight class on mouseover` — firing mouseover on a `<p>` element while picker is active adds `bl-si-hover-highlight` to that element
- `removes bl-si-hover-highlight class on mouseout` — firing mouseout removes the highlight class from the element
- `does not throw if target is null on mouseover` — dispatching a raw `MouseEvent('mouseover')` without setting a target does not throw

### click
- `calls onBlur callback with element when element is not blurred` — clicking an element without `bl-si-blurred` class calls `onBlur(el)` and does not call `onUnblur`
- `calls onUnblur callback when element has data-bl-si-blur` — clicking an element with `dataset.blSiBlur` set calls `onUnblur(el)` and does not call `onBlur`
- `click prevents default event` — the click handler calls `preventDefault()` on the event, preventing link navigation
- `click stops event propagation` — the click handler calls `stopPropagation()` on the event, preventing page handlers from firing

### Escape key
- `pressing Escape calls deactivate and removes pb-picker-active` — firing `Escape` keydown removes `bl-si-picker-active` from `documentElement`
- `pressing Escape triggers onDeactivate callback` — firing `Escape` keydown calls `onDeactivate` exactly once

### deactivate
- `removes pb-picker-active class from html element` — `deactivate()` removes `bl-si-picker-active` from `documentElement`
- `removes the toolbar from the DOM` — `document.getElementById('bl-si-picker-toolbar')` is null after `deactivate()`
- `calls onDeactivate callback` — `deactivate()` calls `onDeactivate` exactly once
- `does not fire blur/unblur after deactivation (listeners removed)` — after `deactivate()`, firing a click does not invoke `onBlur`
- `calling deactivate when not active does not throw` — calling `deactivate()` without a prior `activate()` does not throw

### setSettings
- `updates blurRadius property` — calling `setSettings({ blurRadius: 16 })` while picker is active does not throw
- `calling setSettings before activate does not throw` — `setSettings()` without prior `activate()` is a safe no-op
- `partial settings update does not wipe existing settings` — updating only `blurRadius` still allows subsequent click events to invoke `onBlur`

### isActive
- `returns false before activation` — `isActive` is `false` before any `activate()` call
- `returns true after activation` — `isActive` is `true` after `activate()`
- `returns false after deactivation` — `isActive` is `false` after `activate()` then `deactivate()`
- `returns false after Escape key deactivates picker` — `isActive` is `false` after `activate()` then firing `Escape`

### hover highlight cleanup
- `removes all hover highlights on deactivation` — `deactivate()` removes `bl-si-hover-highlight` from all elements that had it
- `hover highlight switches between elements` — firing mouseover on `el1` highlights it; firing mouseover on `el2` highlights `el2` (not a mutual-exclusion assertion, both can hold the class simultaneously in this test)

### toolbar
- `toolbar has correct ID and class` — toolbar element has id `bl-si-picker-toolbar` and class `bl-si-toolbar`
- `toolbar is removed when picker is deactivated via Escape` — `document.getElementById('bl-si-picker-toolbar')` is null after Escape deactivation

### click boundary conditions
- `clicking when no callbacks provided does not throw` — `activate({}, {})` with no callbacks; `fireClick` does not throw
- `does not highlight html or body elements on mouseover` — firing mouseover on `document.body` and `document.documentElement` does not add `bl-si-hover-highlight` to either

### sticky mode
- `activates in sticky mode by default` — `activate({}, {})` with no pickerMode sets `isActive` true; hover highlight is NOT added to elements in sticky mode
- `activates in sticky mode when pickerMode is sticky` — `activate({ pickerMode: 'sticky-page' }, {})` sets `isActive` true
- `creates drawing preview on mousedown` — firing mousedown on an element while in sticky mode creates `.bl-si-zone-drawing` in the DOM
- `updates drawing preview on mousemove` — after mousedown at (100,100) and mousemove to (200,200), the preview element has `width: 100px` and `height: 100px`
- `calls onStickyBlur on mouseup with valid area` — after drawing from (100,100) to (200,200), `onStickyBlur` is called once with a rect object where `width === 100` and `height === 100`
- `does not call onStickyBlur for area smaller than 10px` — drawing fewer than 10px in any dimension does not invoke `onStickyBlur`
- `removes drawing preview on mouseup` — after completing a draw gesture, `.bl-si-zone-drawing` is null
- `Escape cancels in-progress draw without deactivating` — pressing Escape during an active draw removes `.bl-si-zone-drawing` but leaves `isActive` true
- `clicking zone overlay in sticky mode calls onStickyUnblur` — clicking an element with `dataset.blSiZone` set calls `onStickyUnblur` with the zone name string

### setMode
- `switches from sticky to dynamic` — `setMode('dynamic')` after sticky activation enables hover highlights on mouseover
- `switches from dynamic to sticky` — `setMode('sticky-page')` after dynamic activation disables hover highlights on mouseover
- `cancels in-progress draw on mode switch` — `setMode('dynamic')` while a draw is in progress removes `.bl-si-zone-drawing`
- `calls onModeChange callback` — `setMode('dynamic')` invokes `onModeChange('dynamic')`
- `ignores invalid mode values` — `setMode('invalid')` does not invoke `onModeChange`
- `no-op when setting same mode` — `setMode('sticky-page')` when already in sticky mode does not throw and leaves `isActive` true

### i18n integration (Phase 2)
- `toolbar uses ContentI18n.t for chip label and Clear button` — with a `blsi.ContentI18n` stub, toolbar textContent includes `HI:pickerChipLabelDynamic` and `HI:pickerClearBtn`
- `empty pickerPrefixLabel hides the prefix span entirely` — when `t('pickerPrefixLabel', ...)` returns `''`, the `.bl-si-toolbar-prefix` span is absent from the toolbar
- `rebuildToolbar() tears down and rebuilds with new strings` — after swapping `blsi.ContentI18n` mid-session, `rebuildToolbar()` replaces the toolbar so its textContent contains new strings and no old strings
- `rebuildToolbar() is a no-op when picker is not active` — calling `rebuildToolbar()` without prior `activate()` does not throw and no toolbar is created
- `falls back to fallback literal when ContentI18n is missing` — with `blsi.ContentI18n = undefined`, toolbar textContent contains English fallback literals `'Element'` and `'Clear'`

## Edge Cases Covered

- Double `activate()` is safe — produces exactly one toolbar, no duplicate event listeners.
- Mouseover with null target does not crash.
- Click on toolbar element itself is ignored (no blur/unblur callbacks fired).
- Deactivate when not active is a no-op.
- `setSettings()` before `activate()` is a no-op.
- Escape during a sticky draw cancels draw but keeps picker active; Escape when not drawing deactivates the picker.
- `setMode('invalid')` is silently dropped.
- Zone overlay click (element with `data-bl-si-zone`) in sticky mode routes to `onStickyUnblur`, not `onStickyBlur`.
- Hover highlight is suppressed for `document.body` and `document.documentElement`.
- `rebuildToolbar()` when picker is inactive is a safe no-op.

## Coverage Gaps

- No test for toolbar drag behavior (`_wireDrag`, `_onDragStart`, `_onDragMove`, `_onDragEnd`).
- No test for tooltip show/hide on toolbar chip hover.
- `onStickyBlur` callback data shape is only partially asserted — `width` and `height` are checked; `x`, `y`, `anchor`, `scrollWidth`, `scrollHeight` are not.
- No test for minimum zone size toast message text content.
- No test for `findClassedParent` logic in dynamic mode (clicking a child element of a blurred parent).
- No test for `setMode` called when picker is not active.
- No test for toolbar chip click changing the mode.
- No test for `rebuildToolbar()` preserving active mode chip state after a language swap.
- The `onStickyBlur` and `onUnblur` path is tested via mock data (`dataset.blSiBlur`), but the `isBlurred()` BlurEngine integration is not tested directly.
- Redundant tests noted in annotations: currency-prefix variants (4 tests, same sub-pattern), phone-like grouped-sequence variants (4 tests, same rule), and mirrored `setMode` tests — candidates for `test.each` parameterisation.
