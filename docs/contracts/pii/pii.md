# pii (facade) Contract

## Overview

Facade for the PII detector pipeline. Public global is `blsi.PiiDetector` — name preserved from the pre-split single-file module. Internally delegates to `blsi.PiiState` / `PiiPreFilter` / `PiiSuppressors` / `PiiDetectors`. Owns no observer; `content_script.applyState` subscribes `handleMutations` to the engine's mutation dispatcher when PII is enabled.

Scans text nodes via `TreeWalker`, matches against `blsi.PiiDetectors.findMatches`, and wraps hits in `<span data-bl-si-pii="email|numeric">`. PII blur is driven exclusively by the `[data-bl-si-pii]:not([data-bl-si-reveal])` CSS rule in `content.css` — completely independent of blur-all.

## Module State

| Var | Scope | Notes |
|---|---|---|
| `_scanComplete` | module | `false` while a chunked scan is in progress; `true` otherwise. Gates `handleMutations` — mutations arriving while `false` are buffered in `_pendingMutations` and replayed after the scan completes. Set `true` immediately on the synchronous path. |
| `_pendingMutations` | module | `null` when no chunked scan is in progress; `[]` during a chunked scan. Each entry is `{ m: MutationRecord[], r: root }`. Drained by `_runChunked` after the walker exhausts; cleared (not drained) by `cancelChunkedScan`. |

Other state lives in `blsi.PiiState`.

## Public API

### scan(rootEl, types, onDone?)

**What**: scans `rootEl` subtree for PII text nodes and wraps matches.
**Params**:
- `rootEl` — `Element` subtree root
- `types` — `{ email?: bool, numeric?: bool }`
- `onDone` — `function(totalCount)` (optional). When provided, processing is time-sliced across idle callbacks (`CHUNK_SIZE = 500` nodes per tick) to avoid long-task violations. Called with total match count when all chunks complete. When omitted, scan runs synchronously (legacy path for tests).
**Returns**: `number` — total spans created (synchronous path). When `onDone` is provided, returns `0` immediately — use the callback for the final count.
**Side effects**:
- Cancels any in-flight chunked scan via `cancelChunkedScan()` before starting — prevents concurrent scans from interleaving when settings change while a chunked scan is in progress.
- Sets `blsi.PiiState.setActiveTypes(...)` for reuse by `handleMutations`.
- **Phase 4**: seeds the per-scan country signal — `blsi.PiiState.setCountry(blsi.PiiCountry.detect())` (PERF.md M6 cache). Stage 2 validators read it via `getCountry()`. The facade is the only path that should seed; tests can drive the signal end-to-end through `<html lang>` because `PiiCountry.detect()` reads it.
- Resets `blsi.PiiState._stats` (per-scan window).
- For each eligible text node: delegates to `_processTextNode` which calls `blsi.PiiState.recordNode(hasDigit)`, then `blsi.PiiDetectors.findMatches`, then `_wrapTextNode`.
- Increments `blsi.PiiState._matchCount` once per wrapped span (via `_wrapTextNode`).
- **Chunked path**: uses an **incremental TreeWalker** — pulls `CHUNK_SIZE` (500) text nodes per idle callback directly from the walker. No upfront collection. Sets `_scanComplete = false` at start, `true` in `onDone`. Stores an internal `_chunkedIdleHandle` for the pending idle callback. Cancellable via `cancelChunkedScan()`.
- **Synchronous path**: sets `_scanComplete = true` immediately, delegates to `_scanSubtree`.
- **TreeWalker filter** (`_walkerFilter`): uses `NodeFilter.SHOW_ALL` with a custom `acceptNode` that returns `FILTER_REJECT` for: extension UI elements (`isExtensionUIElement`), `<code>`/`<kbd>`/`<samp>` tags (via `_SKIP_RE`), code-signaling `<pre>` elements (`isCodePre` — has `<code>` child, syntax-highlighting class, or `data-code` attr; bare `<pre>` is NOT rejected since it may contain real PII like preformatted addresses), and code editor widgets (`isCodeEditorWidget`). All checks are O(1) element-self checks — no `closest()` ancestor walk. Non-rejected elements get `FILTER_SKIP` (walker descends into children). Text nodes get `FILTER_ACCEPT`.
- **Trade-off**: TreeWalker is mutable — DOM mutations between chunks can cause it to skip or revisit nodes. `_processTextNode` handles detached nodes (parent null → 0), `isInsidePiiSpan` guards double-wrapping, and `handleMutations` catches new content after `_scanComplete = true`.
**Skips** (Stage 0 pre-filter, in order):
- `null` `rootEl` or `types` → returns `0` (calls `onDone(0)` if provided).
- Both types disabled → returns `0` (calls `onDone(0)` if provided).
- Extension UI subtrees — rejected at walker level via `_walkerFilter` (`isExtensionUIElement`). Not checked per-node in `_processTextNode`.
- Code block subtrees — rejected at walker level via `_walkerFilter` (`<code>`/`<kbd>`/`<samp>` unconditionally, `<pre>` only when `isCodePre` returns true, editor widgets via `isCodeEditorWidget`). Not checked per-node in `_processTextNode`. Bare `<pre>` (no code child, no syntax classes) is NOT rejected — may contain preformatted addresses or legal text with real PII.
- Nodes already inside a `[data-bl-si-pii]` wrapper (`blsi.PiiPreFilter.isInsidePiiSpan`).
- Text nodes shorter than 4 characters (shortest legitimate PII match — email `a@b.co` is 6 chars, numeric patterns require 4+). Faster than `trim().length === 0` because no string allocation, and stricter (also drops single-glyph nodes). Same length floor applied in `handleMutations` (childList added text nodes + characterData updates).
- **M1 digit pre-screen** — nodes are skipped unless one of: (a) `types.email` is enabled (email needs no digit), (b) `blsi.PiiPreFilter.hasDigit(text)` (any digit), or (c) `types.numeric` is enabled AND `blsi.PiiPreFilter.hasDigitOrLongAlnum(text)` (any digit OR an 8+ alnum run). The (c) branch lets pure-alpha identifier-context tokens (Bearer headers, base64 refresh tokens) reach the detector. Same gate is applied in `handleMutations` for childList added text nodes.

### cancelChunkedScan()

**What**: cancels any in-flight chunked scan started by `scan(..., onDone)`.
**Params**: none.
**Returns**: nothing.
**Side effects**: cancels the pending `requestIdleCallback` / `setTimeout` handle. The `onDone` callback will NOT be called. Resets `_scanComplete = true` and **discards** `_pendingMutations` (set to `null`) — buffered mutations are NOT replayed on cancel. Safe to call when no scan is in progress (no-op — `_scanComplete` is already `true`).
**Use**: called by `content_script.applyState` on the PII-disable path to prevent a stale chunked scan from continuing after the user toggles PII off.

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
- If `_scanComplete === false` → mutations are **buffered** into `_pendingMutations` (not dropped). After the chunked scan's final chunk, `_runChunked` sets `_scanComplete = true` and drains the buffer by calling `handleMutations` for each entry. This ensures dynamically-inserted content (chat previews, lazy-loaded DOM) arriving mid-scan is not silently lost. `isInsidePiiSpan` guards prevent double-wrapping if the walker already visited the same nodes.
- If `blsi.PiiState.getActiveTypes() === null` → no-op (scan must run first).
- For each `childList` mutation:
  - `addedNodes` of type `TEXT_NODE` → guarded by `_shouldSkipMutation(node)` (extension UI + code blocks), then delegates to `_processTextNode(node, activeTypes)`. Same pre-filter chain, digit gate, cross-node fallback as the initial scan path.
  - `addedNodes` of type `ELEMENT_NODE` → skips self-generated PII spans (elements carrying `PII_ATTR`) via a direct attribute check, skips extension UI and code block nodes via `_shouldSkipMutation`, then recurses via `_scanSubtree(node, activeTypes)`. Uses the private `_scanSubtree` rather than the public `scan()` so stats counters accumulate across multi-subtree drains instead of being reset on each recursive call.
- For each `characterData` mutation:
  - guarded by `_shouldSkipMutation(mutation.target)`, then delegates to `_processTextNode(mutation.target, activeTypes)`.
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

### _walkerFilter

`NodeFilter` object passed to both `createTreeWalker` calls (chunked + synchronous). Uses `SHOW_ALL` so it sees element nodes. Returns `FILTER_REJECT` for: extension UI elements (`isExtensionUIElement`), `<code>`/`<kbd>`/`<samp>` (via `_SKIP_RE`), code `<pre>` (`isCodePre`), and editor widgets (`isCodeEditorWidget`). Returns `FILTER_SKIP` for other elements, `FILTER_ACCEPT` for text nodes. `FILTER_REJECT` on an element skips its entire subtree — no text node inside rejected subtrees is ever yielded.

### _shouldSkipMutation(node)

Combined guard for mutation paths. Returns `true` if `_isInsideExtensionUI(node)` OR the node is inside a code block (via `closest(_CODE_ANCESTOR_SELECTOR)` or `closest("pre")` + `isCodePre`). Uses `closest()` — acceptable on mutation paths (low volume, handful of nodes per batch). Not called during scan.

### _processTextNode(tn, enabledTypes)

Runs Stage 0 pre-filter on a single text node (isInsidePiiSpan, length floor, digit pre-screen), then `findMatches` + `_wrapTextNode`. Extension UI and code block checks are NOT here — handled at the walker level during scan, and by `_shouldSkipMutation` guard in `handleMutations`. Returns the wrap count for the node (`number`, usually 0 or 1). Shared by `_scanSubtree`, `_runChunked`, and (indirectly) `handleMutations` via `_scanSubtree`.

**Cross-node keyword lookaround**: when `findMatches` returns empty for a digit-only text node (`_SHORT_DIGIT_RE` — 4-16 digits with optional spaces/hyphens), `_precedingText` walks backward through sibling and parent text content (up to 120 chars, stopping at block-level element boundaries) and checks for a trailing keyword via `blsi.PiiDetectors.hasKeywordTrail`. If found, the digit value is wrapped as `numeric`. This bridges the gap when keyword ("Customer ID:") and value ("2024") live in separate DOM elements — the per-node `findMatches` can't see both, and short numbers may be suppressed (e.g. by `isYear`) without keyword context.

### _precedingText(textNode, limit)

Collects up to `limit` characters of text preceding `textNode` by walking backward through `previousSibling` (text nodes and inline elements) and ascending to parent when no siblings remain. Stops at block-level element boundaries (`P`, `DIV`, `LI`, `TD`, `H1`-`H6`, etc. via `_BLOCK_TAGS`). Returns a string (may be empty).

### _wrapTextNode(textNode, matches)

Right-to-left split: for each match in reverse order, `splitText(end)` then `splitText(start)`, then replace the match-text node with a `<span data-bl-si-pii="…">` carrying the original text. Each wrapped span calls `blsi.PiiState.incrementMatchCount`. Returns the count of wrapped spans (`number`).

The PII span carries ONLY the `[data-bl-si-pii]` attribute — never `[data-bl-si-blur]`. Blur is owned by the CSS rule in `content.css`. blur_engine sweeps must not touch these spans (they pass the EXCLUDE chain via `:not([data-bl-si-pii])`).

### _scanSubtree(rootEl, enabledTypes)

Walks a subtree's text nodes via TreeWalker, delegates each to `_processTextNode`. Does NOT reset stats and does NOT reset `_activeTypes`. Returns the wrap count for the subtree. Synchronous — used for small subtrees.

Called by:
- Public `scan()` (synchronous fallback when no `onDone`) AFTER it resets stats.
- `handleMutations` ELEMENT_NODE branch — so mutation-drained subtrees add to the running stats counters instead of overwriting them.

### _runChunked(walker, total, enabledTypes, onDone, schedule)

Pulls `CHUNK_SIZE` (200) text nodes per idle callback directly from the TreeWalker. Each chunk delegates to `_processTextNode`. When the walker is exhausted, sets `_scanComplete = true`, drains `_pendingMutations` (calling `handleMutations` for each buffered entry), then calls `onDone(total)`. Stores the pending idle handle in `_chunkedIdleHandle` so `cancelChunkedScan()` can abort mid-scan. The `schedule` function (`requestIdleCallback` or `setTimeout`) is resolved once in `scan()` and passed through to avoid re-checking on every chunk.

## Dependencies

- `blsi.PiiState` — match count + active types + `PII_ATTR`
- `blsi.PiiPreFilter` — `isExtensionUI`, `isInsidePiiSpan`
- `blsi.PiiDetectors` — `findMatches`, `getPatterns`
- `blsi.PiiSuppressors` — indirectly through `PiiDetectors.findMatches`

## Lifecycle

- Module load assigns `blsi.PiiDetector = { scan, cancelChunkedScan, clear, handleMutations, getMatchCount, getPatterns, getStats }`.
- First `scan(rootEl, types)` call seeds `_activeTypes`.
- `handleMutations` no-ops until `_activeTypes` is non-null AND `_scanComplete` is `true`.
- `clear(rootEl)` resets `_matchCount` but leaves `_activeTypes` intact.
- Tab close unloads the script; state is per-page.

## Edge cases

- Calling `handleMutations` before `scan` — no-op (active types null guard).
- Calling `handleMutations` during a chunked scan — mutations are **buffered** (not dropped). After the final chunk, the buffer is drained. If the walker already processed a buffered node, `isInsidePiiSpan` prevents double-wrapping. If `cancelChunkedScan` is called, buffered mutations are discarded.
- Calling `scan` then `clear` then `handleMutations` — handleMutations still fires because `_activeTypes` is preserved across clear and `_scanComplete` is `true`.
- TextNode whose parent has been detached between match-time and wrap-time — `_wrapTextNode` returns `0` for that match (parent null guard).
- A text node spans multiple matches — processed right-to-left so earlier offsets remain valid.
- `<iframe>` content is NOT scanned by this module; iframes load their own content_script via `all_frames: true`.
