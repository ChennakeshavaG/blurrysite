# pii (facade) Contract

## Overview

Facade for the PII detector pipeline. Public global is `blsi.PiiDetector` — name preserved from the pre-split single-file module. Internally delegates to `blsi.PiiState` / `PiiPreFilter` / `PiiSuppressors` / `PiiDetectors`. Owns no observer; `content_script.applyState` subscribes `handleMutations` to the engine's mutation dispatcher when PII is enabled.

Scans text nodes via `TreeWalker`, matches against `blsi.PiiDetectors.findMatches`, and wraps hits in `<span data-bl-si-pii="email|numeric">`. PII blur is driven exclusively by the `[data-bl-si-pii]:not([data-bl-si-reveal])` CSS rule in `content.css` — completely independent of blur-all.

## Module State

None. State lives in `blsi.PiiState`.

## Public API

### scan(rootEl, types)

**What**: scans `rootEl` subtree for PII text nodes and wraps matches.
**Params**:
- `rootEl` — `Element` subtree root
- `types` — `{ email?: bool, numeric?: bool }`
**Returns**: `number` — total spans created in this call.
**Side effects**:
- Sets `blsi.PiiState.setActiveTypes(...)` for reuse by `handleMutations`.
- Resets `blsi.PiiState._stats` (per-scan window).
- TreeWalker collects ALL text nodes before wrapping — avoids walker invalidation from DOM mutations during the scan.
- For each eligible text node: calls `blsi.PiiState.recordNode(hasDigit)`, then `blsi.PiiDetectors.findMatches`, then `_wrapTextNode`.
- Increments `blsi.PiiState._matchCount` once per wrapped span (via `_wrapTextNode`).
**Skips** (Stage 0 pre-filter, in order):
- `null` `rootEl` or `types` → returns `0`.
- Both types disabled → returns `0`.
- Nodes inside extension UI (`blsi.PiiPreFilter.isExtensionUI`).
- Nodes already inside a `[data-bl-si-pii]` wrapper (`blsi.PiiPreFilter.isInsidePiiSpan`).
- Nodes inside `<code>` / `<pre>` / `<kbd>` / `<samp>` / `[data-code]` / `.highlight` / `.codehilite` (`blsi.PiiPreFilter.isInsideCodeBlock`).
- Text nodes shorter than 4 characters (shortest legitimate PII match — email `a@b.co` is 6 chars, numeric patterns require 4+). Faster than `trim().length === 0` because no string allocation, and stricter (also drops single-glyph nodes). Same length floor applied in `handleMutations` (childList added text nodes + characterData updates).
- **M1 digit pre-screen** — nodes with no digit are skipped UNLESS `types.email` is enabled (email matching needs no digit). `blsi.PiiPreFilter.hasDigit(text)`.

### clear(rootEl)

**What**: removes all `[data-bl-si-pii]` spans inside `rootEl` and restores plain text nodes.
**Params**:
- `rootEl` — `Element` subtree root
**Returns**: nothing.
**Side effects**:
- For each span: replace span with text node carrying `span.textContent`; call `parent.normalize()`.
- Resets `blsi.PiiState._matchCount` to `0`.
- Resets `blsi.PiiState._stats` to all zeros.
- Does NOT clear `_activeTypes` — handleMutations remains armed if `_activeTypes` was set.
- Does NOT clear `_REGEX_CACHE` — compiled regexes survive across clear/scan cycles.

### handleMutations(mutations, _root)

**What**: subscriber to the engine's mutation dispatcher. Wraps newly-added text nodes and re-scans newly-added element subtrees.
**Params**:
- `mutations` — `MutationRecord[]`
- `_root` — unused; kept for the subscriber-handler signature.
**Returns**: nothing.
**Behavior**:
- If `blsi.PiiState.getActiveTypes() === null` → no-op (scan must run first).
- For each `childList` mutation:
  - `addedNodes` of type `TEXT_NODE` → wrap matches via `findMatches` + `_wrapTextNode` (skipped if extension UI / already-wrapped / inside code block / whitespace-only / no-digit when email-disabled).
  - `addedNodes` of type `ELEMENT_NODE` → recurse via `_scanSubtree(node, activeTypes)` (same Stage-0 skip rules). Uses the private `_scanSubtree` rather than the public `scan()` so stats counters accumulate across multi-subtree drains instead of being reset on each recursive call.
- For each `characterData` mutation:
  - target text node → wrap matches if not extension UI / already-wrapped / inside code block / whitespace / no-digit when email-disabled.
- Other mutation types → ignored.

**Stats**: `handleMutations` does NOT reset stats — counters accumulate across the drain on top of whatever the most recent `scan()` left behind. This means a `getStats()` snapshot after a mutation drain reflects: counters from the drain's mutations + counters from the most recent `scan()`. Call `scan()` to start a fresh stats window.

### getMatchCount()

**Returns**: `blsi.PiiState.getMatchCount()` — running total of wrapped spans since the last `clear()`.

### getPatterns()

**Returns**: `blsi.PiiDetectors.getPatterns()` — the frozen `{ EMAIL, NUMERIC }` catalog.

### getStats()

**Returns**: a shallow copy of `blsi.PiiState._stats` — `{ node_count, digit_node_count, stage3_candidates, stage4_suppressed, total_emit }` (all `number`). All counters are zero unless `blsi.Logger.enabled` was true during the most recent scan.
**Side effects**: none — copy is returned so callers can't mutate counters.
**Use**: dev observability + integration tests; not exposed in the popup. Stats reset at the top of every `scan()` and on `clear()`.

## Internal helpers

### _wrapTextNode(textNode, matches)

Right-to-left split: for each match in reverse order, `splitText(end)` then `splitText(start)`, then replace the match-text node with a `<span data-bl-si-pii="…">` carrying the original text. Each wrapped span calls `blsi.PiiState.incrementMatchCount`. Returns the count of wrapped spans (`number`).

The PII span carries ONLY the `[data-bl-si-pii]` attribute — never `[data-bl-si-blur]`. Blur is owned by the CSS rule in `content.css`. blur_engine sweeps must not touch these spans (they pass the EXCLUDE chain via `:not([data-bl-si-pii])`).

### _scanSubtree(rootEl, enabledTypes)

Walks a subtree's text nodes through Stage 0 pre-filter + `findMatches` + `_wrapTextNode`. Does NOT reset stats and does NOT reset `_activeTypes`. Returns the wrap count for the subtree.

Called by:
- Public `scan()` AFTER it resets stats — so a top-level scan starts with a clean stats window.
- `handleMutations` ELEMENT_NODE branch — so mutation-drained subtrees add to the running stats counters instead of overwriting them.

## Dependencies

- `blsi.PiiState` — match count + active types + `PII_ATTR`
- `blsi.PiiPreFilter` — `isExtensionUI`, `isInsidePiiSpan`
- `blsi.PiiDetectors` — `findMatches`, `getPatterns`
- `blsi.PiiSuppressors` — indirectly through `PiiDetectors.findMatches`

## Lifecycle

- Module load assigns `blsi.PiiDetector = { scan, clear, handleMutations, getMatchCount, getPatterns }`.
- First `scan(rootEl, types)` call seeds `_activeTypes`.
- `handleMutations` no-ops until `_activeTypes` is non-null.
- `clear(rootEl)` resets `_matchCount` but leaves `_activeTypes` intact.
- Tab close unloads the script; state is per-page.

## Edge cases

- Calling `handleMutations` before `scan` — no-op (active types null guard).
- Calling `scan` then `clear` then `handleMutations` — handleMutations still fires because `_activeTypes` is preserved across clear.
- TextNode whose parent has been detached between match-time and wrap-time — `_wrapTextNode` returns `0` for that match (parent null guard).
- A text node spans multiple matches — processed right-to-left so earlier offsets remain valid.
- `<iframe>` content is NOT scanned by this module; iframes load their own content_script via `all_frames: true`.
