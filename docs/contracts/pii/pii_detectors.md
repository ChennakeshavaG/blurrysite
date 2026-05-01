# pii_detectors Contract

## Overview

Pattern catalog + `findMatches(text, types)` for the PII pipeline. Phase 0 covers the existing 5-alternation NUMERIC regex + EMAIL regex. Phase 3 adds Stage 1 dedicated detectors (Card / IBAN / Aadhaar / etc.) and a `runDetector` helper + `consumed[]` tracker. Phase 4 adds Stage 2 context-gated detectors.

Suppressor calls go through `blsi.PiiSuppressors.falsePositivesCheck`.

## Module State

None — patterns are frozen module-level constants. `findMatches` retrieves cached `RegExp` instances via `blsi.PiiState.getCachedRegex(prototype)` (Phase 2 — PERF.md M3). The cache returns one compiled instance per `(source, flags)` tuple with `lastIndex` reset; eliminates per-call `new RegExp(...)` allocation.

## Public API

### EMAIL_RE

Frozen `RegExp /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g`. RFC-ish local@domain.tld. Pre-filter: only run on text containing `@` to avoid O(n) regex on every node.

### NUMERIC_RE

Frozen `RegExp` — five ordered alternations, first match at a given position wins:

1. Currency symbol prefix — `$1,234.56`, `€500`, `₹50,000`
2. Currency code suffix — `1234 USD`, `50000 EUR`
3. Comma-grouped thousands — `1,234,567`, `12,345`
4. Space/hyphen digit groups (phone-like) — `111-222-333`, `4111 1111 1111 1111`. Requires ≥2 groups of ≥3 digits each, separators `[ \- ]` only (no newline/tab).
5. 4+ bare digit sequence (catch-all) — `17150`, account numbers.

Alternation 4 must precede 5 so `"4111 1111 1111 1111"` wraps as ONE span.

### PATTERNS

Frozen `{ EMAIL: { regex, label }, NUMERIC: { regex, label } }`. Returned to callers via `getPatterns()`.

### findMatches(text, types)

**What**: scans a single string for PII matches.
**Params**:
- `text` — `string` to scan
- `types` — `{ email?: bool, numeric?: bool }`
**Returns**: `Array<{ start: number, end: number, type: 'email' | 'numeric' }>`, sorted by `start`, overlapping matches removed (keep first / longest).
**Side effects**:
- Records candidate / suppress / emit counters via `blsi.PiiState.recordCandidate / recordSuppress / recordEmit` (no-op when `Logger.enabled` is false).
- Mutates the cached regex's `lastIndex` during iteration (single-threaded; safe).
**Logic**:
1. If `types.email` AND `text.includes('@')`: fetch cached `EMAIL_RE` via `blsi.PiiState.getCachedRegex`, exec-loop, push `{start, end, type: 'email'}`. Call `recordEmit()` per push.
2. If `types.numeric`: fetch cached `NUMERIC_RE` via `getCachedRegex`, exec-loop. For each hit: call `recordCandidate()`. Then call `blsi.PiiSuppressors.falsePositivesCheck(matchText, text, matchIndex)`; if it returns `false`, push `{start, end, type: 'numeric'}` and `recordEmit()`. Otherwise `recordSuppress()`.
3. Sort by `start`, with ties by `end` desc (longer match first).
4. Filter: keep matches whose `start >= lastEnd` (drops overlaps).

### getPatterns()

**Returns**: `PATTERNS` (the frozen catalog).
**Use**: exposed via the facade `blsi.PiiDetector.getPatterns()` for tests and external observability.

## Dependencies

Reads `blsi.PiiSuppressors.falsePositivesCheck` for the NUMERIC path.

## Edge cases

- Empty `text` → returns `[]`.
- `types = {}` or missing both flags → returns `[]`.
- Zero-length match (regex pathology) — explicit `re.lastIndex++` advance to prevent infinite loop.
- Matches longer than `text.length` impossible by construction (regex is anchored to `text`).
- Overlapping email + numeric — sort puts email first; numeric overlap dropped.
