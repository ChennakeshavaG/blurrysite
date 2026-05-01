# pii_state Contract

## Overview

Shared private state for the PII sub-modules. Holds the running match count, the active types snapshot, the canonical `data-bl-si-pii` attribute name, the compiled-regex cache (Phase 2 — PERF.md M3), and a per-scan stats counter (Phase 2). Other PII sub-modules read/write through this module instead of duplicating state. Sibling sub-modules import via the `blsi.PiiState` global.

## Module State

| Variable | Description |
|---|---|
| `PII_ATTR` | `'data-bl-si-pii'` — canonical attribute placed on PII wrapping spans. CSS rule `[data-bl-si-pii]:not([data-bl-si-reveal])` in `content.css` drives blur, independent of blur-all. |
| `_matchCount` | `number` — running total of wrapped spans across the current scan + all subsequent mutation drains. Reset to 0 only by `resetMatchCount()`. |
| `_activeTypes` | `{email: bool, numeric: bool} \| null` — set by `scan()` via `setActiveTypes`, reused by `handleMutations` via `getActiveTypes`. |
| `_REGEX_CACHE` | `Map<string, RegExp>` keyed by `"<source>::<flags>"`. One compiled instance per pattern, reused across scan/mutation calls. Eliminates per-call `new RegExp(...)` allocation. |
| `_stats` | `{ node_count, digit_node_count, stage3_candidates, stage4_suppressed, total_emit }` — per-scan counters. Increment helpers no-op when `blsi.Logger.enabled` is false. |

## Public API

### PII_ATTR

**What**: Constant string `'data-bl-si-pii'`.
**Use**: Span-attribute setter in `_wrapTextNode`; selector for `clear()` queries; selector base for `isInsidePiiSpan` ancestor walk.

### getMatchCount()

**Returns**: `number` — current `_matchCount`.
**Side effects**: none.

### incrementMatchCount()

**Side effects**: `_matchCount += 1`.
**Use**: called by `_wrapTextNode` once per wrapped span.

### resetMatchCount()

**Side effects**: `_matchCount = 0`.
**Use**: called by `clear()` after removing all PII spans.

### getActiveTypes()

**Returns**: `{email?: true, numeric?: true} | null` — last value passed to `setActiveTypes`, or `null` after `clearActiveTypes` / module load.
**Side effects**: none.
**Use**: `handleMutations` checks for non-null before processing records.

### setActiveTypes(types)

**Params**: `types` — `{email?: bool, numeric?: bool}` (only `true` keys preserved upstream by `scan`).
**Side effects**: `_activeTypes = types`.

### clearActiveTypes()

**Side effects**: `_activeTypes = null`.
**Use**: optional teardown helper; not currently called by any caller (handleMutations no-ops on null naturally).

### getCachedRegex(prototype)

**What**: returns the cached `RegExp` instance for `prototype.source + prototype.flags`, with `lastIndex` reset to `0`. First call per `(source, flags)` tuple compiles + caches; later calls return the same instance.
**Params**:
- `prototype` — `RegExp` (caller passes a `/g` regex; only `.source` and `.flags` are read).
**Returns**: `RegExp` — cached instance, ready to `exec()` from index 0.
**Side effects**: populates `_REGEX_CACHE` on first call per pattern; mutates the cached instance's `lastIndex` to `0`.
**Use**: replaces `new RegExp(re.source, re.flags)` per-call pattern in `pii_detectors.findMatches`. Saves ~30% scan cost on heavy pages by avoiding compile thrash + GC pressure.

### _resetRegexCache()

**What**: clears `_REGEX_CACHE` (test-only helper).
**Side effects**: empties the cache.
**Use**: tests that want to verify cache identity behavior across loads.

### recordNode(hasDigit)

**What**: increments `_stats.node_count` and (if `hasDigit`) `_stats.digit_node_count`.
**Side effects**: no-op when `blsi.Logger.enabled` is false.
**Use**: called once per text node by `pii.scan()`.

### recordCandidate()

**What**: increments `_stats.stage3_candidates`.
**Side effects**: no-op when `blsi.Logger.enabled` is false.
**Use**: called once per generic-regex match by `pii_detectors.findMatches` before the FP cascade runs.

### recordSuppress()

**What**: increments `_stats.stage4_suppressed`.
**Side effects**: no-op when `blsi.Logger.enabled` is false.
**Use**: called when a Stage 4 suppressor drops a candidate.

### recordEmit()

**What**: increments `_stats.total_emit`.
**Side effects**: no-op when `blsi.Logger.enabled` is false.
**Use**: called when a candidate survives Stage 4 and is emitted as a PII match.

### getStats()

**Returns**: a shallow copy of `_stats` — `{ node_count, digit_node_count, stage3_candidates, stage4_suppressed, total_emit }` (all `number`).
**Side effects**: none — copy is returned so callers can't mutate counters.
**Use**: surfaced via `blsi.PiiDetector.getStats()` for tests and dev observability.

### resetStats()

**Side effects**: zeros every counter in `_stats`.
**Use**: called by `pii.scan()` at the top of each scan and by `pii.clear()`.

## Lifecycle

`PII_ATTR` is constant. `_matchCount`, `_activeTypes`, `_REGEX_CACHE`, and `_stats` are module-lifetime state — survive across multiple `scan()` calls.
- `clear()` resets `_matchCount` and `_stats` but does NOT clear `_activeTypes` (so `handleMutations` keeps wrapping after a `clear()`) and does NOT clear `_REGEX_CACHE` (compile-once-reuse-forever).
- `scan()` resets `_stats` at the top of every call (per-scan window).
- `_REGEX_CACHE` is never cleared in production — it's append-only and bounded by the static set of detector regexes.

## Edge cases

- `getMatchCount()` / `getStats()` immediately after module load return `0` / a zeroed object.
- `getActiveTypes()` immediately after module load returns `null`.
- `getCachedRegex` on a `/g` regex: callers can `exec()` immediately — `lastIndex` is reset before return. Concurrent reentry is not safe (single instance per pattern), but the detector pipeline is single-threaded by construction.
- `recordNode` / `recordCandidate` / `recordSuppress` / `recordEmit` no-op when `blsi.Logger` is undefined or `Logger.enabled` is false. No exception in either case.
- Calling `incrementMatchCount` before any `setActiveTypes` is allowed — counters and types are independent.
