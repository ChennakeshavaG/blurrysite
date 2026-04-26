# tab_privacy Test Contract

## Overview

Tests for `src/tab_privacy.js` (`blsi.TabPrivacy`). Verifies that `enable()` replaces `document.title` and all `link[rel*="icon"]` `href` attributes with generic privacy-safe placeholders; that `disable()` restores the pre-enable originals; that `isActive()` accurately reflects the current state; that double `enable()` is idempotent and does not overwrite the saved original with the placeholder; that the module handles missing favicon elements gracefully (creating a blank favicon then removing it on `disable()`); and that `disable()` is a no-op when the module is not active. Multiple favicon `rel` variants (`icon`, `shortcut icon`, `apple-touch-icon`) are covered in the final test.

## Setup & Teardown

- **`beforeEach`**: sets `document.head.innerHTML` to `'<title>My Banking App</title><link rel="icon" href="https://example.com/favicon.ico">'`, then calls `freshLoad()`.
- **`afterEach`**: calls `blsi.TabPrivacy.disable()` inside a try/catch, then clears `document.head.innerHTML`.
- **`freshLoad()`** helper: deletes `blsi.TabPrivacy`, calls `jest.resetModules()`, then `jest.isolateModules(() => require(MODULE_PATH))`.
- Some tests call `freshLoad()` a second time after changing `document.head.innerHTML` to get a module instance that snapshotted the new DOM state.

## Test Groups

### tab_privacy.js

- `enable() replaces document.title with generic placeholder` — after `enable()`, `document.title` is `'Tab'`.
- `enable() replaces favicon href with blank data URI` — after `enable()`, the `link[rel*="icon"]` element's `href` matches `/^data:image\/png;base64,/`.
- `disable() restores original title` — after `enable()` then `disable()`, `document.title` is `'My Banking App'`.
- `disable() restores original favicon href` — after `enable()` then `disable()`, `link[rel*="icon"]` `href` is `'https://example.com/favicon.ico'`.
- `isActive() reflects current state` — `isActive()` returns `false` before `enable()`; `true` after `enable()`; `false` after `disable()`.
- `double enable is idempotent — does not nest originals` — calling `enable()` twice then `disable()` restores `document.title` to `'My Banking App'` (the placeholder `'Tab'` is not saved as the new original on the second call).
- `enable() works when no favicon link elements exist` — with an empty `<head>`, `enable()` sets `document.title` to `'Tab'` and creates a new `link[rel*="icon"]` element whose `href` matches `/^data:image\/png;base64,/`.
- `disable() removes created favicon when none existed originally` — after the above enable/disable cycle, `querySelector('link[rel*="icon"]')` returns `null` (the created element is removed).
- `disable() is a no-op when not active` — calling `disable()` without a prior `enable()` does not throw and leaves `document.title` unchanged.
- `handles multiple favicon link elements` — with three `link` elements (`icon`, `shortcut icon`, `apple-touch-icon`), `enable()` replaces all three hrefs with blank data URIs; `disable()` restores all three to their original URLs.
- `page-side writes to document.title cannot leak through while active` — after `enable()`, repeated `document.title = '…'` writes (simulating an SPA unread counter) leave reads pinned to `'Tab'`; on `disable()`, the most recent attempted value is the one restored to the underlying `<title>` element.

## Edge Cases Covered

- **Double enable**: second `enable()` call while already active must not overwrite the stored original title/hrefs with the placeholder values.
- **No favicon present**: module creates a synthetic favicon on `enable()` and removes it entirely on `disable()` to leave the DOM in its original state.
- **`disable()` when inactive**: must be a safe no-op (no exception, no mutation).
- **Multiple favicon `rel` variants**: all `link[rel*="icon"]` elements (not just the first) are replaced and restored.
- **Page-side title rewrite while active**: SPA writes to `document.title` are intercepted; the placeholder holds during obscured mode and the latest attempted title is restored on disable.

## Coverage Gaps

- No test for an `enable()` / `disable()` / `enable()` cycle — state machine consistency across multiple activations is unverified.
- No test for a favicon `link` element whose `href` attribute is absent or empty — module should not crash when restoring a corrupt link element.
- The `disable()` restoration tests for title and favicon are separate tests with near-identical setup; the assertions could be merged (noted as optimization opportunity in the test file comments).
