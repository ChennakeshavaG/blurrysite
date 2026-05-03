# pii_pre_filter Contract

## Overview

Stage 0 whole-node drops. Cheap DOM + text checks that decide whether a text node should bypass the PII pipeline entirely. Seven predicates:
- `isExtensionUI` — extension-owned UI tree (ancestor walk via `closest()`, mutation path only)
- `isExtensionUIElement` — O(1) element-self check via `matches()` (used by walker filter to reject subtrees)
- `isCodePre` — O(1) check: is this `<pre>` a code block? (child `<code>`, syntax-highlighting classes, `data-code` attr, or parent `.highlight` div)
- `isCodeEditorWidget` — O(1) element-self check for web editor roots (`.cm-editor`, `.CodeMirror`, `.monaco-editor`, `.ace_editor`, `[data-code]`, `.codehilite`)
- `isInsidePiiSpan` — already-wrapped node
- `hasDigit` — M1 whole-node digit pre-screen
- `hasDigitOrLongAlnum` — extended pre-screen for the numeric branch when the identifier sub-pass is in play; lets pure-alpha tokens with a 8+ char alnum run (Bearer, base64 refresh tokens) through

Sibling sub-modules call into this through `blsi.PiiPreFilter`.

## Module State

| Variable | Description |
|---|---|
| `_HAS_DIGIT_RE` | `/\d/` — module-level shared regex used by `hasDigit`. No `/g` flag (not used in match-position contexts). |
| `_HAS_DIGIT_OR_LONG_ALNUM_RE` | `/\d|[A-Za-z0-9]{8,}/` — module-level shared regex used by `hasDigitOrLongAlnum`. Same single-pass cost as `_HAS_DIGIT_RE`. |
| `_EXT_UI_SELECTOR` | `'#bl-si-picker-toolbar, .bl-si-toast, .bl-si-toolbar, [data-bl-si-zone], #bl-si-svg-filters'` — extension-owned UI roots. Used by `isExtensionUI` (ancestor walk via `closest()`) and `isExtensionUIElement` (self check via `matches()`). |
| `_CODE_EDITOR_SELECTOR` | `'[data-code], .codehilite, .cm-editor, .CodeMirror, .monaco-editor, .ace_editor'` — web-based code editor widget roots. Used by `isCodeEditorWidget`. |

## Public API

### isExtensionUI(node)

**What**: Returns `true` if `node` (text or element) sits inside any extension-owned UI tree. Ancestor walk via `closest(_EXT_UI_SELECTOR)`. Used by `handleMutations` to guard added nodes.
**Params**:
- `node` — `Text | Element`
**Returns**: `boolean`
**Logic**: resolves parent element (if text node), then `el.closest(_EXT_UI_SELECTOR)`. No cache — called only on mutation paths (low volume), not during scan (walker filter handles that).

Returns `true` for null/orphaned nodes (parent element null → skip).

### isExtensionUIElement(el)

**What**: Returns `true` if the element itself matches `_EXT_UI_SELECTOR`. O(1) self-check via `el.matches()` — does NOT walk ancestors. Used by the facade's `TreeWalker` filter (`FILTER_REJECT`) to skip entire extension UI subtrees during scan, eliminating per-node `closest()` cost.
**Params**:
- `el` — `Element`
**Returns**: `boolean`
**Logic**: `el.matches(_EXT_UI_SELECTOR)`. Returns `false` if `el.matches` is undefined (text nodes should not be passed).

### isInsidePiiSpan(node)

**What**: Returns `true` if `node` is already inside a `[data-bl-si-pii]` wrapper. Used to avoid double-wrapping on re-scan and during mutation handling.
**Params**:
- `node` — `Text | Element`
**Returns**: `boolean`
**Logic**: parent-element walk + `closest('[data-bl-si-pii]')` query. Reads attribute name from `blsi.PiiState.PII_ATTR`.

### isCodePre(el)

**What**: Returns `true` if the `<pre>` element is a code block (not poetry/legal/preformatted text). Used by the walker filter to `FILTER_REJECT` code `<pre>` subtrees while allowing bare `<pre>` (which may contain real PII like preformatted addresses).
**Params**:
- `el` — `Element` (must be a `<pre>`)
**Returns**: `boolean`
**Logic**: returns `true` if any of:
- `el.querySelector("code")` finds a `<code>` child
- `el.className` contains `"highlight"`, `"lang"`, or `"language"` (syntax-highlighting convention)
- `el.hasAttribute("data-code")`
- Parent is a `<div>` with `"highlight"` in its className (GitHub convention: `div.highlight > pre`)

Returns `false` for bare `<pre>` — those may contain poetry, ASCII art, legal text, or preformatted addresses with real PII.

### isCodeEditorWidget(el)

**What**: Returns `true` if the element is a web-based code editor root. O(1) self-check via `el.matches(_CODE_EDITOR_SELECTOR)`. Used by the walker filter to `FILTER_REJECT` editor subtrees.
**Params**:
- `el` — `Element`
**Returns**: `boolean`
**Logic**: `el.matches(_CODE_EDITOR_SELECTOR)`. Covers `[data-code]`, `.codehilite`, `.cm-editor` (CodeMirror 6), `.CodeMirror` (CodeMirror 5), `.monaco-editor` (VS Code), `.ace_editor` (Ace). Returns `false` if `el.matches` is undefined.

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

Reads `blsi.PiiState.PII_ATTR`.

## Edge cases

- Null `node` → `false` (all DOM predicates).
- Empty `text` → `hasDigit` returns `false`.
- Orphaned `Text` node (no parent element) → `false` (all DOM predicates).
- Parent element lacks `closest()` (SVG elements in some contexts, custom elements) → `isExtensionUI` returns `true` (skip), `isInsidePiiSpan` returns `false` (safe — won't double-wrap since there's no wrapper to detect).
- `Text` nodes inside `<svg>` → walked via `parentElement`; works.
- Custom-element shadow roots: `closest()` does not pierce shadow boundaries — same as the rest of the engine. Inside-shadow checks happen at the shadow-root scan level, not here.
- `<pre>` inside extension UI — `isExtensionUI` runs first in the facade, so the code-block check is reached only on page-owned nodes.
