# selector_utils Test Contract

## Overview

Tests for `src/selector_utils.js` (`blsi.SelectorUtils`). The module generates and
restores CSS selectors for blurred elements, supports multi-strategy selector arrays
(structural-first ordering), assesses selector stability for picker warnings, and
produces unique identifiers for blur items. Tests cover the full public API:
`getSelectors`, `getSelector` (compat alias), `isSelectorStable`, `generateId`,
`restoreSelector`, and `restoreAllSelectors`.

## Setup & Teardown

- `beforeAll`: loads `blsi.SelectorUtils` via `require()` (falls back to inline IIFE
  stub if file missing). The stub implements the full public API contract so tests
  pass against both the real file and the stub.
- `beforeEach`: resets `document.body.innerHTML = ''` to give each test a clean DOM.
- No explicit `afterEach` teardown needed (DOM reset handled in `beforeEach`).

## Test Groups

### getSelector

- `returns structural selector first even when element has a unique ID` — `getSelector` is an alias for `getSelectors()[0]`; the structural `nth-of-type` path is always at index 0 even when the element has a unique id.
- `does not use ID selector when multiple elements share the same ID` — returns a non-`#shared` selector for malformed HTML with duplicate IDs (falls back to structural path).
- `returns nth-of-type path when no unique identifier found` — bare `<div>` with no ID produces a selector matching `^body > ` containing `nth-of-type`.
- `returns nth-of-type path when element has no ID` — same as above; adds assertion that selector starts with `body > div:nth-of-type`.
- `returns same selector when called twice on same element` — deterministic: two calls on the same element return the identical string.
- `returns null (or falsy) when called with body element` — `document.body` is excluded; result is falsy.
- `returns null when called with null` — null input returns falsy.
- `generated selector can be used to re-find the element` — `document.querySelector(selector)` returns the original element (round-trip verification).

### getSelectors

- `returns an array` — return type is always `Array`.
- `returns empty array for body element` — `document.body` is excluded; returns `[]`.
- `returns empty array for documentElement` — `document.documentElement` is excluded; returns `[]`.
- `returns empty array for null` — null input returns `[]`.
- `first selector in array is structural (nth-of-type path)` — index 0 is always the structural path.
- `includes #id selector when element has unique id` — when element has a unique id, the array contains `'#uniqueEl'` as a non-first entry.
- `#id selector is not first when element also has structural path` — `nth-of-type` index is less than `#id` index (structural precedes semantic).
- `every selector in the array either uniquely matches the element or is a class combo hint` — every selector in the returned array must match the target element when queried.
- `different elements produce different selector arrays` — sibling elements get different structural selectors.
- `no duplicate selectors within the returned array` — `new Set(selectors).size === selectors.length`.

### class-based selector strategy

- `stores class combo even when non-unique` — two elements sharing `className = 'chat-item preview'` still produce `'div.chat-item.preview'` in the selectors array for the first element.
- `stores parent-id scoped combo when it is unique` — `#sidebar span.label` form appears in selectors when the parent-scoped combo uniquely identifies the element.
- `omits bl-si-* classes from the combo` — internal blur classes (`bl-si-blurred`, `bl-si-frosted`) are stripped from class-based selectors; only user-defined classes appear.
- `does not include class selector when element has no classes` — no `.`-containing selector is emitted for an element with no className.

### getSelector (compat alias)

- `returns a string or null (not an array)` — return type is `string` or `null`, never an array.
- `returns first selector from getSelectors` — exact value equals `getSelectors(div)[0] ?? null`.
- `returns null for body` — `document.body` input returns falsy.

### isSelectorStable

- `returns true for element with unique id` — element with `id` attribute is stable.
- `returns true for element with non-bl-si class` — element with at least one non-internal class is stable.
- `returns false for element with only bl-si-* classes` — classes prefixed `bl-si-` are ignored; element is unstable if they are the only classes.
- `returns true for element with aria-label` — `aria-label` attribute signals stability.
- `returns true for element with data-testid` — `data-testid` (and other STABLE_DATA_ATTRS) signals stability.
- `returns false for bare element with no stable signals` — plain `<div>` with no id, class, aria, or data-* is unstable.
- `returns false for null` — null input returns `false`.
- `returns false for non-element` — string input returns `false`.

### restoreSelector — array input

- `returns element when first selector matches` — tries selectors in order; returns element on first hit.
- `falls back to second selector when first does not match` — skips stale first entry; returns element found by second entry.
- `returns null for empty array` — `[]` input returns `null`.
- `returns null when no selector in array matches` — all stale entries return `null`.
- `skips invalid CSS selectors without throwing` — invalid selector (`##invalid!`) is caught silently; continues to next entry and returns the valid match.
- `does not return element when selector matches multiple elements (non-unique)` — `.dup` matching two elements returns `null` (uniqueness enforced).

### generateId

- `returns an 8-character string` — `typeof id === 'string'` and `id.length === 8`.
- `returns a hex string (only 0-9, a-f characters)` — matches `/^[0-9a-f]{8}$/`.
- `returns unique values on repeated calls` — 50 calls produce at least 45 unique values.

### restoreSelector

- `returns the element when selector is valid and element exists` — `'#restoreMe'` returns the span.
- `returns null when selector matches nothing (stale selector)` — non-existent id returns `null`.
- `returns null instead of throwing for syntactically invalid selector` — `'##bad-selector!!!'` does not throw; returns `null`.
- `returns null for null input` — `null` input returns `null`.
- `returns null for empty string input` — empty string returns `null` or does not throw.
- `returns element by data attribute selector` — `'[data-bl-si-id="abc12345"]'` successfully finds element by data attribute.

### restoreAllSelectors

- `returns array of found elements for a mix of valid and stale selectors` — one valid + two stale selectors yields array of length 1 containing the matched element.
- `returns empty array when all selectors are stale` — no matches yields `[]`.
- `returns empty array when called with empty array` — `[]` input yields `[]`.
- `does not throw for invalid selector in the array` — `'##invalid'` entry does not propagate an exception.
- `returns empty array for non-array input` — `null` input returns `[]` (not a throw, not `null`).
- `returns all elements when every selector is valid` — three valid ids returns array of length 3.

### getSelector edge cases

- `returns null when called with documentElement` — `document.documentElement` is excluded (falsy result).
- `returns null when called with undefined` — `undefined` input returns falsy.
- `handles element with ID containing special characters` — `id = 'my:special.id'` produces a usable selector that round-trips via `querySelector`.
- `handles element with numeric-starting ID` — `id = '123numeric'` produces a usable selector that round-trips.
- `handles element with whitespace-only ID (falls back to nth-of-type)` — `id = '   '` (spaces) is skipped; selector matches `^body > `.
- `nth-of-type path can re-find the element` — structural path successfully locates the element via `querySelector`.
- `different elements get different selectors` — two sibling `<div>` elements produce different selectors.

### restoreSelector edge cases

- `returns null for undefined input` — `undefined` returns `null`.
- `returns null for numeric input` — `42` returns `null`.
- `handles complex selectors correctly` — `.container > .text` descendant selector resolves correctly and returns the matching element with expected `textContent`.

### generateId robustness

- `all generated IDs are exactly 8 lowercase hex chars` — 100 iterations all match `/^[0-9a-f]{8}$/`.
- `high uniqueness over many generations` — 500 calls produce at least 495 unique ids (collision rate near zero in 32-bit space).

## Edge Cases Covered

- Duplicate IDs in malformed HTML: structural path used as safe fallback.
- Special-character and numeric-start IDs: CSS-escaped to remain queryable.
- Whitespace-only IDs: trimmed and skipped, structural fallback used.
- `bl-si-*` class filtering: internal blur classes stripped from class-based selectors and stability check.
- Shadow DOM / detached elements: excluded-node guards (`body`, `documentElement`, `null`, `undefined`) return empty/falsy without throwing.
- Non-unique selectors in `restoreSelector`: uniqueness enforced — multi-match returns `null`.
- Invalid CSS in `restoreSelector` / `restoreAllSelectors`: wrapped in `try/catch`, silently skipped.
- Non-array input to `restoreAllSelectors`: early return of `[]`.

## Coverage Gaps

- No test for class-based selector strategy when an element has a unique className but no ID — it is unclear from tests alone whether this path exists in the real implementation.
- No test for the CSS.escape fallback when `global.CSS` is absent.
- No test for selector fragility after DOM mutations — nth-of-type selectors become stale when a sibling is inserted before the element; this is undocumented in tests.
- No test for `getSelector` on an element that is not attached to `document.body` (detached/floating element).
- No test for `getSelector` on an element inside a shadow root.
- No test for `restoreAllSelectors` preserving input order in the returned array.
- No test for `restoreAllSelectors` with duplicate selectors in the input array.
- `getSelector` excluded-node tests (`body`, `documentElement`) are spread across two separate describe groups rather than unified as a `test.each` table.
- Several guard-clause tests (`null`, `undefined`, numeric inputs for `restoreSelector`) could be consolidated into a `test.each` table.
