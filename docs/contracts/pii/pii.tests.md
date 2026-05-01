# pii Test Contract

## Overview

Unit tests for `src/pii/` — Phase 0 of the PII rewrite split the monolithic `src/pii_detector.js` into seven sub-modules under `src/pii/` (`pii_state.js`, `pii_checksums.js`, `pii_pre_filter.js`, `pii_country.js`, `pii_suppressors.js`, `pii_detectors.js`, `pii.js`). The facade `pii.js` still exposes the same public surface as the legacy detector under `blsi.PiiDetector` with five public members: `scan(rootEl, types)`, `clear(rootEl)`, `handleMutations(mutations, root)`, `getMatchCount()`, `getPatterns()`.

Tests verify pattern detection for two PII types (EMAIL and NUMERIC), false-positive suppression chains, DOM wrapping behaviour, multi-type detection, PII independence from the blur-all engine, `clear()` restoration, `getMatchCount()` accumulation, `getPatterns()` shape, and `handleMutations()` subscriber-style routing for both `childList` and `characterData` mutations.

No external module dependencies are mocked — the `src/pii/` modules operate purely on DOM text nodes and do not import other `blsi.*` modules.

## Setup & Teardown

- Module loading uses `freshLoad()` which deletes `blsi.PiiDetector`, calls `jest.resetModules()`, then `require()`s each of the seven `src/pii/*.js` files in load order via `jest.isolateModules()` (or falls back to an inline `buildStubSource()` eval if any file is absent). Load order: `pii_state.js`, `pii_checksums.js`, `pii_pre_filter.js`, `pii_country.js`, `pii_suppressors.js`, `pii_detectors.js`, `pii.js`. Called in `beforeEach` so each test gets a clean module instance with zeroed state.
- `beforeEach` — resets `document.body.innerHTML` to `''` and calls `freshLoad()`.
- `afterEach` — calls `blsi.PiiDetector.clear(document.body)`, resets `document.body.innerHTML` to `''`. (PII detector owns no observer — no `stopObserving` call needed.)

### Constants
- `ALL_TYPES = { email: true, numeric: true }` — convenience object used in multi-type and boundary tests.

## Test Groups

### Pattern: EMAIL
- `EMAIL — detects standard email` — `scan` with `{ email: true }` on `'user@example.com'` returns count 1 and creates a `[data-bl-si-pii="email"]` span with textContent `'user@example.com'`
- `EMAIL — detects email with plus tag` — `'user+tag@mail.co.uk'` is detected and the span textContent equals the full address
- `EMAIL — does not match bare @handle (no domain)` — `'@username'` returns count 0
- `EMAIL — does not match text without @` — plain text with no `@` returns count 0
- `EMAIL — skips when EMAIL type disabled` — `scan(root, { email: false })` returns 0 and creates no `[data-bl-si-pii]` spans

### Pattern: NUMERIC — currency prefix
- `NUMERIC — detects dollar amount` — `'$1,234.56'` returns count > 0 and creates `[data-bl-si-pii="numeric"]`
- `NUMERIC — detects Euro symbol (€)` — `'€500'` returns count 1
- `NUMERIC — detects British Pound (£)` — `'£250.00'` returns count 1
- `NUMERIC — detects Indian Rupee (₹)` — `'₹50,000'` returns count 1
- `NUMERIC — currency prefix matches digits up to non-digit ($17k → $17)` — span textContent is `'$17'` (k-suffix not captured)

### Pattern: NUMERIC — currency code suffix
- `NUMERIC — detects USD currency code suffix` — `'1000 USD'` returns count > 0
- `NUMERIC — detects EUR currency code suffix` — `'50000 EUR'` returns count > 0

### Pattern: NUMERIC — 4+ bare digits
- `NUMERIC — detects bare 5-digit number (17150)` — returns count 1 and span textContent is `'17150'`
- `NUMERIC — detects 4-digit number` — `'4321'` returns count 1
- `NUMERIC — detects 16-digit credit card (no separators)` — `'4111111111111111'` returns count 1 and span textContent equals the full 16-digit string
- `NUMERIC — detects comma-separated large number (1,234,567)` — returns count > 0
- `NUMERIC — does NOT detect 3-digit number (below threshold)` — `'123'` returns count 0
- `NUMERIC — does NOT detect single/double digit numbers` — `'1'` and `'99'` return count 0
- `NUMERIC — skips when NUMERIC type disabled` — `scan(root, { numeric: false })` returns 0

### Pattern: NUMERIC — phone-like grouped sequences
- `NUMERIC — hyphen-separated phone (111-222-333) wraps as one span` — count 1; span textContent is `'111-222-333'`
- `NUMERIC — mixed-width space-separated phone (111 2222 333) wraps as one span` — count 1; span textContent is `'111 2222 333'`
- `NUMERIC — space-separated phone (111 222 333) wraps as one span` — count 1; span textContent is `'111 222 333'`
- `NUMERIC — space-separated credit card (4111 1111 1111 1111) wraps as one span` — count 1; span textContent is `'4111 1111 1111 1111'` (phone-like sub-pattern fires before 4+ bare, preventing four separate spans)
- `NUMERIC — two-group ≥3-digit hyphen pair (792-792) wraps as one span` — count 1; span textContent is `'792-792'`
- `NUMERIC — two-group ≥3-digit space pair (792 792) wraps as one span` — count 1; span textContent is `'792 792'`
- `NUMERIC — does NOT match two-group number with <3-digit group` — `'12 2024'` is not wrapped as a phone-like group (group 1 has only 2 digits; though `'2024'` may still match 4+ bare)
- `NUMERIC — does NOT match digit groups separated by words` — `'room 12 door 23 window 34'` returns count 0 (text between groups breaks the pattern)

### PII independence from blur-all
- `PII span has NO data-bl-si-blur attribute (independent of blur-all)` — spans created by `scan()` carry only `data-bl-si-pii`, never `data-bl-si-blur`; blur is driven by CSS rule `[data-bl-si-pii]:not([data-bl-si-reveal])`
- `PII span persists after blur-engine sweep clears data-bl-si-blur elements` — after simulating blur-engine clearing non-PII elements, the PII span with `data-bl-si-pii` remains in the DOM with its textContent intact

### Multi-type + toggling
- `detects both EMAIL and NUMERIC in same node` — `scan(root, ALL_TYPES)` on a paragraph containing both patterns returns count 2 and creates 2 `[data-bl-si-pii]` spans
- `returns 0 when no types are enabled` — `scan(root, {})` returns 0
- `returns 0 when types object is null` — `scan(root, null)` returns 0

### Scan behavior
- `skips extension UI elements (toolbar)` — content inside `#bl-si-picker-toolbar` is not scanned; returns 0
- `skips extension toast elements` — content inside `.bl-si-toast` is not scanned; returns 0
- `skips already-wrapped PII spans (no double-wrap)` — scanning a node that already has `[data-bl-si-pii]` returns 0
- `skips empty and whitespace-only text nodes` — `'   '` returns 0
- `double scan does not re-wrap already wrapped nodes` — calling `scan()` twice on the same content produces exactly 1 `[data-bl-si-pii="email"]` span
- `handles multiple matches in one text node` — two email addresses in one `<p>` produces count 2 and 2 spans
- `preserves surrounding text after wrapping` — `<p>` textContent equals the original string after scanning (surrounding text nodes are preserved)
- `scan with null rootEl returns 0` — `scan(null, ALL_TYPES)` returns 0 without throwing

### clear()
- `clear() removes all PII spans and restores text` — after scan+clear, `[data-bl-si-pii]` is absent and `<p>` textContent is the original string
- `clear() resets match count to 0` — `getMatchCount()` returns 0 after `clear()`

### getMatchCount / getPatterns
- `getPatterns() returns EMAIL and NUMERIC entries` — result has `EMAIL.regex` (RegExp), `EMAIL.label === 'email'`, `NUMERIC.regex` (RegExp), `NUMERIC.label === 'numeric'`; does NOT have `PHONE`, `SSN`, `CREDIT_CARD`, or `FINANCIAL` keys
- `getMatchCount() accumulates across separate scans` — scanning one email → count 1; scanning a second email in a separate element → count 2

### handleMutations
- `handleMutations is a no-op when scan() has not been called` — `_activeTypes` is null → no spans created, no throw
- `handleMutations is a no-op when given empty / nullish input` — `[]`, `null`, `undefined` all return without throwing
- `handleMutations — childList: new TEXT_NODE wraps email` — synthesised `{ type: 'childList', addedNodes: [textNode] }` produces `[data-bl-si-pii="email"]` span
- `handleMutations — childList: new ELEMENT_NODE scans subtree` — synthesised record with an `<div>` containing nested email triggers `scan(node, _activeTypes)`
- `handleMutations — characterData: textContent change wraps new email` — text node mutation in a contenteditable; record `{ type: 'characterData', target: textNode }` results in PII span. **The original-bug regression test** — typed email in contenteditable / dynamic `.textContent` reassignment fires `characterData`, not `childList`.
- `handleMutations — characterData: skip text node already wrapped` — text node living inside `[data-bl-si-pii]` is skipped; no double-wrap; `getMatchCount()` unchanged
- `handleMutations — characterData: ignores extension UI node` — text node inside `#bl-si-picker-toolbar` is not wrapped
- `handleMutations — ignores attributes mutation type` — `{ type: 'attributes' }` is silently dropped

### Default settings path
- `all AUTO_DETECT defaults off — scan returns 0` — `scan(root, { email: false, numeric: false })` returns 0 and creates no PII spans
- `NUMERIC true — bare 5-digit number detected` — `{ numeric: true }` detects `'17150'` and span textContent is `'17150'`
- `NUMERIC false — no numeric spans created` — `{ numeric: false }` on `'17150'` returns 0 and creates no spans

### falsePositivesCheck: isYear
- `isYear — 4-digit year in 1000–2099 is suppressed` — `'2024'` alone in a sentence returns 0
- `isYear — 5-digit number is NOT suppressed as a year` — `'20245'` returns count 1 and span textContent is `'20245'`
- `isYear — 4-digit number above 2099 is NOT suppressed` — `'9999'` returns count 1
- `isYear — 4-digit number below 1000 is NOT suppressed as year` — `'999'` (3 digits) returns count 0 (below 4-digit threshold, not a year guard)

### falsePositivesCheck: isVersion
- `isVersion — number preceded by lowercase v is suppressed` — `'v17150'` returns 0
- `isVersion — number preceded by uppercase V is suppressed` — `'V17150'` returns 0
- `isVersion — number followed by .digit is suppressed` — `'17150.3'` returns 0
- `isVersion — bare number with no version context is NOT suppressed` — `'Account 17150 overdue'` returns 1 and span textContent is `'17150'`

### falsePositivesCheck: isPublicPrice
- `isPublicPrice — /month in window suppresses currency amount` — `'$9/month'` returns 0
- `isPublicPrice — qty in window suppresses number` — `'qty: 5000 units'` returns 0
- `isPublicPrice — /year in window suppresses number` — `'$94750/year'` returns 0
- `isPublicPrice — no price context: number is detected` — `'Account balance: 94750'` returns 1 and span textContent is `'94750'`

### falsePositivesCheck: isCountNoise
- `isCountNoise — "unread" in window suppresses number` — `'12345 unread messages'` returns 0
- `isCountNoise — "followers" in window suppresses number` — `'10234 followers'` returns 0
- `isCountNoise — "results" in window suppresses number` — `'Showing 12345 results'` returns 0
- `isCountNoise — no count context: number is detected` — `'Hello there 12345 friend.'` returns 1 and span textContent is `'12345'` (fixture uses neutral text — `Invoice` and `total` would now match Phase 1's extended `isOrderRef` and `isPublicPrice`)

### Phase 1 — STAGE 0 pre-filter (added)
- `STAGE 0 — skips numbers inside <code>` — content inside `<code>` is not scanned; returns 0
- `STAGE 0 — skips numbers inside <pre>` — content inside `<pre>` is not scanned; returns 0
- `STAGE 0 — skips numbers inside <kbd>` — content inside `<kbd>` is not scanned; returns 0
- `STAGE 0 — skips numbers inside <samp>` — content inside `<samp>` is not scanned; returns 0
- `STAGE 0 — skips numbers inside .highlight (syntax-highlighter)` — `.highlight`/`.codehilite`/`[data-code]` selectors covered
- `STAGE 0 — numbers OUTSIDE code block still detected` — sanity check
- `STAGE 0 — M1 digit pre-screen skips no-digit nodes when email disabled` — `'No digits here at all.'` with `{ numeric: true }` returns 0 (saves regex work via the `hasDigit` early-exit)
- `STAGE 0 — M1 pre-screen does NOT skip when email enabled` — email path runs even on no-digit text; sanity check that the email path is preserved

### Phase 1 — Tier-A suppressors (added)
- `isHexColor — #FF5733-shape hex bare-digits not blurred` — `'#123456'` returns 0
- `isHexColor — bare digits without # prefix still blurred` — `'123456'` returns 1
- `isYearRange — "2020-2024" not blurred` — endpoints both in 1000–2099 → suppressed
- `isYearRange — non-year range "1234-9999" still considered` — fingerprint edge; smoke test (`9999` outside range)
- `isPercentage — "12345%" not blurred`
- `isPercentage — number without trailing % blurred`
- `isScientificNotation — "1234e10" not blurred` — trailing `e[+-]?\d` triggers suppression
- `isMeasurement — "1024 MB" not blurred`
- `isMeasurement — "5000 km" not blurred`
- `isMeasurement — number without trailing unit blurred`
- `isResolution — "1920x1080" not blurred` — `\d+x\d+` pattern triggers suppression
- `isOrdinalLabel — "Section 12345" not blurred`
- `isOrdinalLabel — "Chapter 12345" not blurred`
- `isOrdinalLabel — "Page 12345" not blurred`
- `isOrdinalLabel — bare 12345 with no precursor blurred` — sanity check
- `isDateLike — ISO 8601 "2026-04-29" not blurred` — structural fingerprint
- `isDateLike — compact 8-digit "20260429" not blurred` — sanity check on month/day passes
- `isDateLike — invalid compact 8-digit "20269999" still blurs` — sanity-check fails (day 99) → not suppressed
- `isOrderRef — "Order #12345" not blurred`
- `isOrderRef — "Tracking 12345" not blurred`
- `isOrderRef — "Invoice 12345" not blurred`
- `isOrderRef — bare number with no order context blurred` — sanity check
- `extended isPublicPrice — "price" keyword suppresses` — `'The price 12345 here.'` returns 0
- `extended isPublicPrice — multilingual ES "precio" suppresses` — `'El precio 12345 aquí.'` returns 0 (ES keyword)

### Phase 2 — cascade tiers + regex cache + stats (added)
- `Phase 2 — getCachedRegex returns same RegExp instance per pattern` — two consecutive calls with the same prototype return the identical instance; `lastIndex` is `0` after each call
- `Phase 2 — getCachedRegex resets lastIndex on each call` — after `exec()` advances `lastIndex`, a subsequent `getCachedRegex` call resets it to `0`
- `Phase 2 — getCachedRegex distinguishes by source AND flags` — same source with different flags (`/\d+/g` vs `/\d+/gi`) yields distinct instances
- `Phase 2 — falsePositivesCheckCascade returns same as flat precise` — behavior parity smoke test: each Phase 1 suppressor still fires through the cascade (`isYear` / `isHexColor` / `isPercentage` / `isDateLike` true cases + one no-suppressor false case)
- `Phase 2 — getStats returns the stats shape (zeros when Logger off)` — `{ node_count, digit_node_count, stage3_candidates, stage4_suppressed, total_emit }` all numbers; values 0 when `Logger.enabled` is falsy
- `Phase 2 — getStats counters increment when Logger.enabled is true` — mocks `blsi.Logger = { enabled: true }`; assert `node_count`, `digit_node_count`, `total_emit` all ≥ 1 after a scan that finds a numeric match. Restores `blsi.Logger` in `finally`.
- `Phase 2 — getStats resets at the top of each scan` — after `scan` + `clear`, all counters return to 0
- `Phase 2 — getStats is a copy, not a live reference` — mutating the returned object does not affect subsequent `getStats` results

## Edge Cases Covered

- `scan(null, types)` returns 0 without throwing.
- `scan(root, null)` returns 0 without throwing.
- `scan(root, {})` (all types disabled) returns 0.
- Double-scan idempotency — a second scan on already-wrapped nodes produces no additional spans.
- Multiple matches in a single text node — each match becomes a separate span; surrounding text nodes are preserved.
- Extension UI elements (`#bl-si-picker-toolbar`, `.bl-si-toast`) are excluded from scanning.
- `handleMutations()` is a safe no-op when `_activeTypes` is null (i.e. `scan()` has not run).
- `handleMutations()` covers both `childList` and `characterData` mutation types — the latter is the fix for typed PII in contenteditable surfaces (Gmail compose, Slack, Notion, etc.) that fired no `childList` records under the old observer.
- Phone-like sub-pattern fires before 4+ bare digit pattern, preventing space-separated card numbers from splitting into individual 4-digit spans.
- Two-group digit sequences (`'12 2024'`) do not match the phone-like pattern (minimum 3 groups required).
- Word-separated digit groups (`'room 12 door 23 window 34'`) return count 0.
- The `isYear` guard range is 1000–2099 (inclusive); values outside this range are not suppressed.
- PII spans carry only `data-bl-si-pii`, never `data-bl-si-blur` — blur-all engine sweeps do not affect them.

## Coverage Gaps

- No test for `clear()` when both EMAIL and NUMERIC matches exist simultaneously on the same page.
- No test for greedy match with trailing punctuation (`'5000,'`) — whether the comma is captured inside the span is unspecified.
- No test for embedded number in a word boundary context (`'model2024x'`) — the `\b` guard should prevent a match but is unverified.
- Currency-prefix variants (dollar, euro, pound, rupee — 4 tests) all verify the same sub-pattern; redundant; candidates for `test.each`.
- Phone-like grouped-sequence variants (hyphen, mixed-width space, space, credit-card — 4 tests) all verify the same one-span rule with different separators; candidates for `test.each`.
