# pii_detector Contract

## Overview

Scans text nodes for PII patterns (email, numeric) using `TreeWalker` and wraps matches in `<span data-bl-si-pii="email|numeric">` elements. PII blur is driven exclusively by the `[data-bl-si-pii]:not([data-bl-si-reveal])` CSS rule in `content.css` — completely independent of blur-all. Enabling PII detection blurs matching text regardless of whether blur-all is active. Module is a singleton.

## Module State

| Variable | Description |
|---|---|
| `NUMERIC_PROFILE` | `'precise'` — developer-only constant; users see only on/off |
| `PII_ATTR` | `'data-bl-si-pii'` — the only attribute placed on PII wrapping spans |
| `_matchCount` | `number` — running total of wrapped spans; incremented by `_wrapTextNode`, reset by `clear()` |
| `_activeTypes` | `{email: bool, numeric: bool}\|null` — set by `scan()`, reused by `handleMutations` |

## Regex Patterns

| Pattern | Description |
|---|---|
| `EMAIL_RE` | RFC-ish `\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g` — only run when text contains `@` (pre-filter) |
| `NUMERIC_RE` | 5 ordered alternations: (1) currency-symbol prefix, (2) ISO currency-code suffix, (3) comma-grouped thousands, (4) space/hyphen digit groups ≥3 groups (phone-like), (5) 4+ bare digit sequence catch-all |

Order in `NUMERIC_RE` is critical: alternation 4 must precede alternation 5 so `"4111 1111 1111 1111"` wraps as one span.

## False-Positive Checks (NUMERIC only)

| Check | Suppresses |
|---|---|
| `isYear` | 4-digit integers in 1000–2099 |
| `isVersion` | Numbers preceded by `v`/`V` or followed by `.digit` (semver) |
| `isPublicPrice` | Matches near `/mo`, `/year`, `cart`, `qty`, `quantity`, `units`, `rating`, `reviews`, `stars` (100-char window) |
| `isCountNoise` | Matches near `unread`, `notifications`, `messages`, `followers`, etc. (150-char window) |

`precise` profile runs all four. `aggressive` runs only `isVersion`. To add a check: write `(matchText, text, matchIndex) => boolean`, add to `FALSE_POSITIVE_CHECKS.precise`, add tests, update `docs/TEST_VALIDATION.md`.

## Public API

### scan(rootEl, types)

**What**: Scans `rootEl` subtree for PII text nodes and wraps matches in blur spans.  
**Params**:
- `rootEl` (Element) — root element to scan
- `types` (`{email: bool, numeric: bool}`) — which PII types to detect  
**Returns**: `number` — total spans created in this call  
**Side effects**:
- Sets `_activeTypes` for reuse by `handleMutations`
- TreeWalker collects ALL text nodes before wrapping — avoids walker invalidation from DOM mutations
- For each eligible text node: calls `_findMatches` then `_wrapTextNode`
- Increments `_matchCount`  
**Handles**: Null `rootEl` or `types` → returns 0; extension UI nodes skipped; already-wrapped nodes skipped; whitespace-only nodes skipped.

### clear(rootEl)

**What**: Removes all `[data-bl-si-pii]` spans under `rootEl`, restoring text nodes.  
**Params**: `rootEl` (Element)  
**Returns**: `void`  
**Side effects**: Replaces each span with a text node; calls `parent.normalize()` to merge adjacent text; resets `_matchCount = 0`  
**Handles**: PII detector owns no observer — `clear()` is enough. `content_script.applyState` calls `Engine.unsubscribeMutations('pii')` separately on the disable path.

### handleMutations(mutations, root)

**What**: Subscriber-style handler invoked by `blur_engine`'s mutation dispatcher with raw `MutationRecord[]` for one root.  
**Params**:
- `mutations` (`MutationRecord[]`) — the batch dispatched by the engine for this idle tick
- `root` (Document | ShadowRoot) — the root the records belong to (currently unused by PII; kept for subscriber signature stability)

**Returns**: `void`  
**Side effects**: For each record, may call `_wrapTextNode` (TEXT_NODE / characterData target) or `scan(node, _activeTypes)` (ELEMENT_NODE additions). Increments `_matchCount` indirectly via `_wrapTextNode`.  
**Handles**:
- `mutation.type === 'childList'`: iterates `addedNodes`. TEXT_NODE → `_findMatches` + `_wrapTextNode`. ELEMENT_NODE → `scan(node, _activeTypes)`. Skips extension UI and nodes already inside a `[data-bl-si-pii]` wrapper.
- `mutation.type === 'characterData'`: target is the text node whose `textContent` changed. Wraps fresh matches against the new value. Skips text nodes already inside a `[data-bl-si-pii]` wrapper (existing wrapper covers updated content) and extension UI.
- Other mutation types (`attributes`, etc.): ignored.
- No-op when `_activeTypes` is null (caller must `scan()` first), or when `mutations` is null/empty.

### getMatchCount()

**What**: Returns the running count of PII spans.  
**Params**: none  
**Returns**: `number` — count of spans created since last `clear()`. Not a live DOM count.

### getPatterns()

**What**: Returns the frozen `PATTERNS` object containing the raw regex patterns.  
**Params**: none  
**Returns**: Frozen `{ EMAIL: {regex, label}, NUMERIC: {regex, label} }`  
**Note**: Callers MUST clone regexes via `new RegExp(re.source, re.flags)` before calling `exec()` — never mutate `lastIndex` on the shared constants.

## Internal Functions

### _isExtensionUI(node)

**What**: Guards toolbar, toast, zone overlays, and SVG filter container from PII wrapping.  
**Returns**: `boolean`

### _isInsidePiiSpan(node)

**What**: Guards against double-wrapping via `closest("[data-bl-si-pii]")`.  
**Returns**: `boolean`

### _falsePositivesCheck(matchText, text, matchIndex)

**What**: Runs the active profile's false-positive checks against a numeric match.  
**Returns**: `boolean` — `true` to suppress the match

### _findMatches(text, types)

**What**: Finds all PII matches in a text string; deduplicates overlaps.  
**Returns**: `Array<{start, end, type}>` sorted by start asc, overlaps removed (keep first/longest)  
**Critical**: Always clones regexes via `new RegExp(re.source, re.flags)` — never calls `EMAIL_RE.exec()` or `NUMERIC_RE.exec()` directly.

### _wrapTextNode(textNode, matches)

**What**: Wraps matched portions of a text node in `<span data-bl-si-pii="type">` elements.  
**Critical**: Processes matches **right-to-left** so earlier text node offsets remain valid after each `splitText()` call.  
**Side effects**: Splits text node, inserts spans; increments `_matchCount` for each span; reads `textNode.textContent` fresh each iteration.

## Invariants

- PII spans carry ONLY `data-bl-si-pii` — NEVER `data-bl-si-blur`. The CSS rule in `content.css` drives blur.
- `_wrapTextNode` ALWAYS processes right-to-left — violating this corrupts text node offsets.
- `_findMatches` ALWAYS clones regexes — never uses `EMAIL_RE.exec()` or `NUMERIC_RE.exec()` directly.
- `scan()` collects all text nodes BEFORE the wrapping loop — prevents TreeWalker invalidation.
- `handleMutations()` is a no-op if `_activeTypes` is null — `scan()` must be called first.
- **PII detector owns no observer.** `blur_engine` runs the single `MutationObserver` per root (document + each shadow root) and dispatches raw `MutationRecord[]` to `handleMutations` via `subscribeMutations('pii', handleMutations)`. The MO config includes `characterData: true` so typed text in contenteditable is detected without a reload.
- Module is a singleton — one `_matchCount`, one `_activeTypes` per page.
- `clear()` resets `_matchCount = 0` but does NOT touch the engine subscription — `content_script.applyState` calls `Engine.unsubscribeMutations('pii')` on disable.
- `blur_engine.isVisuallyBlurred` returns `true` for `element.dataset.blSiPii` — `reveal_controller` can reveal PII spans.
