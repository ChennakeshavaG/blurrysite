# selection_blur Test Contract

## Overview

Tests for `src/selection_blur.js`, exposed as `blsi.SelectionBlur`. The module wraps programmatically selected text in `[data-bl-si-selection]` / `[data-bl-si-blur]` spans to blur specific text snippets without affecting surrounding content. Tests cover the full public API: `blurSelection`, `clearAll`, `getSelectionBlurs`, `removeSelectionBlur`, `destroy`, and unique ID generation. Each test reloads the module fresh via `jest.isolateModules`. A `selectText(element, start, end)` helper uses the jsdom Selection API to set up ranges on text nodes.

## Setup & Teardown

- `freshLoad()` — deletes `blsi.SelectionBlur`, calls `jest.resetModules()`, then uses `jest.isolateModules()` to `require(MODULE_PATH)`.
- `beforeEach`: clears `document.body.innerHTML`; calls `freshLoad()`.
- `afterEach`: calls `blsi.SelectionBlur.destroy()` (swallows errors); clears `document.body.innerHTML`.
- `selectText(element, startOffset, endOffset)` — creates a `Range` on `element.firstChild` (must be a text node), adds it to `document.getSelection()`.

## Test Groups

### selection_blur.js

- `blurSelection wraps selected text in a blur span` — selects `"Hello"` (offsets 0–5) from `<p>Hello World</p>`; `blurSelection()` returns `{ text: 'Hello', id: ... }`; a `[data-bl-si-selection]` span exists with `textContent='Hello'` and `data-bl-si-blur='1'`.
- `blurSelection preserves surrounding text` — selects `"World"` (offsets 6–11); after `blurSelection()`, full paragraph `textContent` is still `'Hello World'` (surrounding text nodes intact).
- `blurSelection returns null for collapsed selection` — with no selection range added, `blurSelection()` returns `null`.
- `blurSelection returns null for whitespace-only selection` — selects three spaces from `<p>   </p>`; `blurSelection()` returns `null`.
- `blurSelection skips extension UI elements` — selection is inside `#bl-si-picker-toolbar`; `blurSelection()` returns `null` (extension UI guard).
- `clearAll removes all selection blur spans` — adds one blur span then calls `clearAll()`; `querySelectorAll('[data-bl-si-selection]').length` drops to 0; paragraph text still contains `'Hello'`.
- `getSelectionBlurs returns records for active blurs` — after one `blurSelection()`, `getSelectionBlurs()` returns an array of length 1 with `{ text: 'Hello', id: <truthy> }`.
- `removeSelectionBlur removes a specific blur by ID` — after blurring, calls `removeSelectionBlur(result.id)`; `[data-bl-si-selection]` count drops to 0; `getSelectionBlurs()` returns empty array.
- `each blurSelection generates unique IDs` — blurs two separate paragraphs; `r1.id !== r2.id`.
- `destroy clears all blurs` — after one `blurSelection()`, calls `destroy()`; `[data-bl-si-selection]` count is 0.
- `removeSelectionBlur with non-existent ID is a no-op` — calling `removeSelectionBlur('fake_id')` does not throw.

## Edge Cases Covered

- Extension UI guard: selection anchored inside `#bl-si-picker-toolbar` (id used by picker toolbar) returns `null`.
- Whitespace-only content: purely whitespace selection returns `null` (not a blur record).
- Collapsed selection (no range): `null` returned without throwing.
- `destroy()` delegates to `clearAll()` internally — both result in zero `[data-bl-si-selection]` spans.
- `removeSelectionBlur` with an unknown ID is safe (no throw, no side effects).
- Text node integrity: wrapping `"World"` does not corrupt `"Hello "` prefix text node.

## Coverage Gaps

Documented in the test file's annotation block:

- Multi-node range — selection spanning multiple sibling elements (e.g. `Hello <span>World</span> Foo`) exercises the TreeWalker cross-node split path; not tested.
- Partial text node wrapping with non-zero `startOffset` and mid-node `endOffset` — verifying only the targeted substring is wrapped and siblings preserved as separate text nodes; not tested.
- Sequential selections in the same paragraph — second `blurSelection()` after first should create two independent spans in the same parent; not tested.
- `getSelectionBlurs()` returning an empty array when no blurs are active — not tested.
- `blurSelection()` when selection contains mixed text and element nodes (e.g. `<b>`) — not tested.
- TreeWalker correctness with `NodeFilter.SHOW_TEXT` — confirming only text nodes are visited; not tested at unit level.
- `init()` and `destroy()` lifecycle interaction (calling `init()` more than once, or `blurSelection()` before `init()`); not tested.
- `destroy clears all blurs` and `clearAll removes all selection blur spans` are noted as redundant — `destroy()` delegates to `clearAll()` so both assert the same outcome.
