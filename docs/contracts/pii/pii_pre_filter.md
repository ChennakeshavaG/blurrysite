# pii_pre_filter Contract

## Overview

Stage 0 whole-node drops. Cheap DOM + text checks that decide whether a text node should bypass the PII pipeline entirely. Five predicates:
- `isExtensionUI` — extension-owned UI tree
- `isInsidePiiSpan` — already-wrapped node
- `isInsideCodeBlock` — `<code>` / `<pre>` / `<kbd>` / `<samp>` / syntax-highlighter ancestor
- `hasDigit` — M1 whole-node digit pre-screen
- `hasDigitOrLongAlnum` — extended pre-screen for the numeric branch when the identifier sub-pass is in play; lets pure-alpha tokens with a 8+ char alnum run (Bearer, base64 refresh tokens) through

Sibling sub-modules call into this through `blsi.PiiPreFilter`.

## Module State

| Variable | Description |
|---|---|
| `_HAS_DIGIT_RE` | `/\d/` — module-level shared regex used by `hasDigit`. No `/g` flag (not used in match-position contexts). |
| `_HAS_DIGIT_OR_LONG_ALNUM_RE` | `/\d|[A-Za-z0-9]{8,}/` — module-level shared regex used by `hasDigitOrLongAlnum`. Same single-pass cost as `_HAS_DIGIT_RE`. |
| `_CODE_SELECTOR` | `'code, pre, kbd, samp, [data-code], .highlight, .codehilite'` — selector list passed to `closest()` by `isInsideCodeBlock`. |

## Public API

### isExtensionUI(node)

**What**: Returns `true` if `node` (text or element) sits inside any extension-owned UI tree, so the PII detector should not wrap content there.
**Params**:
- `node` — `Text | Element`
**Returns**: `boolean`
**Logic**: walks to the parent element if `node` is a text node, then checks ancestor chain for any of:
- `id === blsi.ids.picker_toolbar` (or fallback literal `'bl-si-picker-toolbar'`)
- `closest('#bl-si-picker-toolbar')`
- `closest('.bl-si-toast')`
- `closest('.bl-si-toolbar')`
- `closest('[data-bl-si-zone]')`
- `closest('#bl-si-svg-filters')`

Returns `false` for null/orphaned nodes.

### isInsidePiiSpan(node)

**What**: Returns `true` if `node` is already inside a `[data-bl-si-pii]` wrapper. Used to avoid double-wrapping on re-scan and during mutation handling.
**Params**:
- `node` — `Text | Element`
**Returns**: `boolean`
**Logic**: parent-element walk + `closest('[data-bl-si-pii]')` query. Reads attribute name from `blsi.PiiState.PII_ATTR`.

### isInsideCodeBlock(node)

**What**: Returns `true` if `node` sits inside a `<code>`, `<pre>`, `<kbd>`, `<samp>`, `[data-code]`, `.highlight`, or `.codehilite` ancestor. Drops the highest-impact false-positive class on technical sites (GitHub, Stack Overflow, MDN, JIRA) — code blocks contain digit-heavy tokens (commit hashes, timestamps, hex, build numbers) that share regex shape with PII but are never user-targeted PII.
**Params**:
- `node` — `Text | Element`
**Returns**: `boolean`
**Logic**: parent-element walk + `closest(_CODE_SELECTOR)` query.

### hasDigit(text)

**What**: M1 whole-node digit pre-screen — returns `true` if the string contains any digit. Cheapest possible filter; rules out 60–80% of consumer-page text nodes (titles, links, headings, prose) before any detector regex runs.
**Params**:
- `text` — `string`
**Returns**: `boolean`
**Logic**: `_HAS_DIGIT_RE.test(text)`. Single linear scan, no allocation.

**Note**: callers that have email enabled must NOT skip nodes that fail `hasDigit` outright — email addresses contain no digit-only requirement. The facade reads `types.email` and runs the email path independently when `hasDigit` returns `false`.

### hasDigitOrLongAlnum(text)

**What**: Extended whole-node pre-screen — returns `true` if the string contains any digit OR any run of 8+ alnum characters. Used by the facade on the numeric branch when the identifier sub-pass is enabled, so pure-alpha tokens (Bearer headers, base64 refresh tokens) with no digit but with a long alnum run still survive Stage 0 and reach the detector.
**Params**:
- `text` — `string`
**Returns**: `boolean`
**Logic**: `_HAS_DIGIT_OR_LONG_ALNUM_RE.test(text)`. Single linear scan, no allocation; the alternation is cheap because the digit branch short-circuits on the first digit.

## Dependencies

Reads `blsi.PiiState.PII_ATTR`. Reads `blsi.ids.picker_toolbar` if defined; falls back to literal.

## Edge cases

- Null `node` → `false` (all DOM predicates).
- Empty `text` → `hasDigit` returns `false`.
- Orphaned `Text` node (no parent element) → `false` (all DOM predicates).
- `Text` nodes inside `<svg>` → walked via `parentElement`; works.
- Custom-element shadow roots: `closest()` does not pierce shadow boundaries — same as the rest of the engine. Inside-shadow checks happen at the shadow-root scan level, not here.
- `<pre>` inside extension UI — `isExtensionUI` runs first in the facade, so the code-block check is reached only on page-owned nodes.
