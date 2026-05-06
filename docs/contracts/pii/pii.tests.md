# pii Test Contract

## Overview

Unit tests for `src/pii/` — Phase 0 of the PII rewrite split the monolithic `src/pii_detector.js` into seven sub-modules under `src/pii/` (`pii_state.js`, `pii_checksums.js`, `pii_pre_filter.js`, `pii_country.js`, `pii_suppressors.js`, `pii_detectors.js`, `pii.js`). The facade `pii.js` still exposes the same public surface as the legacy detector under `blsi.PiiDetector` with public members: `scan(rootEl, types, onDone?)`, `cancelChunkedScan()`, `clear(rootEl)`, `handleMutations(mutations, root)`, `getMatchCount()`, `getPatterns()`, `getStats()`. Most tests use the synchronous path (no `onDone`); two tests exercise the chunked async path with `jest.useFakeTimers()` to verify mutation buffering during scans.

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
- `STAGE 0 — skips numbers inside pre.highlight (syntax-highlighter)` — `pre.highlight` variant; bare `<div class="highlight">` no longer matches (apps use `.highlight` for search/UI highlighting)
- `STAGE 0 — bare .highlight div does NOT suppress (not a code block)` — verifies the tightened selector doesn't suppress non-code `.highlight` containers
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

### Bug fixes — currency punct / country-code phone / isDateLike shape gate (added)
- `NUMERIC currency prefix — trailing comma is NOT captured` — `'Hello $1,234.56, world done.'` → span = `'$1,234.56'` (alt #1 anchored at digit-end)
- `NUMERIC currency prefix — trailing space is NOT captured` — `'Hello $100 world done.'` → span = `'$100'`
- `NUMERIC currency prefix — trailing period is NOT captured` — `'Saw $50.'` → span = `'$50'`
- `NUMERIC currency prefix — European decimal comma still captured fully` — `'Paid €99,99 here.'` → span = `'€99,99'` (internal comma preserved)
- `NUMERIC country-code phone — "+91 94909 73391" wraps as one span` — alt #4 captures cc + 2 groups
- `NUMERIC country-code phone — "+1 555-123-4567" wraps as one span` — alt #4 captures cc + 3 groups
- `NUMERIC country-code phone — plain "555-123-4567" still wraps as one span` — alt #4's optional `\+?` allows no-`+` form
- `NUMERIC country-code phone — "1234-5678" still falls through to alt #5` — leading 4-digit group exceeds alt #4's `\d{1,3}`; alt #5 takes over
- `isDateLike — country-code phone near "created" is NOT suppressed` — `('+91 94909 73391', 'Group created by ...', 17)` returns `false` (length>10 fails shape gate)
- `isDateLike — bare 10-digit phone near "updated" is NOT suppressed` — `('9876543210', 'Account updated 9876543210 yesterday', 16)` returns `false` (no separator fails shape gate)
- `isDateLike — country-code phone near "modified" is NOT suppressed` — `('+1 555-123-4567', 'Last modified ...', 14)` returns `false` (`+` fails shape gate)
- `isDateLike — bare 4-digit year near "Posted" IS still suppressed` — `('2024', 'Posted 2024', 7)` returns `true` (shape gate passes, keyword fires)
- `isDateLike — slash date near "Created" IS still suppressed via shape gate` — `('11/12', 'Created on 11/12', 11)` returns `true`
- `isDateLike — full slash date "01/15/2024" IS still suppressed (structural fast-path)` — structural list catches it before the gate runs
- `end-to-end — "Group created by +91 94909 73391" wraps the phone` — combined Bug 2 + Bug 3 regression
- `end-to-end — "Account updated 9876543210 yesterday" wraps the number` — combined Bug 3 + alt #7 regression
- `NUMERIC parens phone — "(555) 123-4567" wraps as one span` — alt #4 parens form
- `NUMERIC parens phone — "(555)-123-4567" wraps as one span` — alt #4 with hyphen between `)` and groups
- `NUMERIC parens phone — "+1 (555) 123-4567" wraps including country code` — alt #4 with leading cc
- `NUMERIC parens phone — "(20) 7946 0958" wraps with 2-digit area code` — alt #4 UK-style
- `NUMERIC phone — UK landline "+44 20 7946 0958" wraps as one span` — alt #5 with 2-digit middle group
- `NUMERIC phone — French "01 23 45 67 89" wraps with all 2-digit groups` — alt #5 all-2-digit groups, no `+`

### Identifier-context detection (added — sub-pass inside types.numeric)
Decision #3 reframe — `Order #12345` / `Tracking 12345` / `Invoice 12345` now suppressed by `isOrderRef` (order keyword near bare digit). PREFIX_RE minimum value length raised to 12 chars — short values no longer captured by keyword-prefix path, fall through to NUMERIC_RE Stage 3 where suppressors apply.

Keyword-prefix positives (12+ char alphanumeric values): `User ID: 12345` (via NUMERIC_RE), `user_id=abc123def456g`, `API Key — 7HsKx9aZ2pQrLm`, `OTP is 4729` (via NUMERIC_RE), `customer #12345` (via NUMERIC_RE), `Verification: 123456` (via NUMERIC_RE), `Pin 4242` (via NUMERIC_RE), `refresh_token: VeryLongAlpha_Token42` (long value with non-alpha char), `Account #12345 / Customer ID 67890` (via NUMERIC_RE), `api_key: abc123def456ghi` (15 chars), tie-break `User ID: 12345`.

Keyword-prefix negatives (under 12 chars): `password: hunter2` (7 chars), `Confirmation code: VX7-9PQ` (7 chars), `client_secret = "abc123_xyz"` (10 chars), `employee no 88421` (suppressed), `Order ABC-12345` (9 chars), `user: sdk-alpha` (9 chars), `key: page-3` (6 chars), `id: v2-beta` (7 chars), `ref: ABC-001` (7 chars).

Dispositive providers: bare AWS `AKIA…`, GitHub PAT `ghp_…`, 3-segment JWT, `Authorization: Bearer eyJ…`, Stripe `api_key: sk_live_…`, Bearer + JWT overlap → one span, GitLab `glpat-…`, Anthropic `sk-ant-…`, OpenAI `sk-…`, SendGrid `SG.…`, npm `npm_…`, Twilio `AC…`, HuggingFace `hf_…`.

Keyword expansion: `database: prod-db-01.cluster`, `webhook: hook_abc123xyz456`, `smtp: mail.relay-01.internal`.

Negatives: `the id is short`, `id="x"`, `account holder smith`, `Order #5`, `Case 12`, `password: aaaaaaaaaaaaaaaa` (all-same-char gate), `Key responsibilities include managing the team.` (pure-alpha English word rejected by non-alpha gate).
- `NUMERIC phone — NBSP-separated "+91 94909 73391" wraps as one span` — alt #5 with U+00A0 separators

### Cross-node keyword lookaround (added — facade `_processTextNode` + `_precedingText`)

Bridges the gap when keyword ("Customer ID:") and value ("90002883607") are in different DOM elements. The facade walks backward through preceding siblings/parents (stopping at block-level boundaries) and checks `hasKeywordTrail`. Only fires for digit-only text nodes that `findMatches` returned empty for.

Positives:
- `<strong>Customer ID:</strong> <span>90002883607</span>` — 11-digit value in sibling span
- `<strong><u>Org ID:</u></strong> <span>5678</span>` — short value across nested elements
- `<strong>Customer ID:</strong> <span>2024</span>` — year-suppressed value rescued by keyword context

Negatives:
- `<strong>Description:</strong> <span>2024</span>` — not a PII keyword
- `<span>2024</span> <strong>is the account</strong>` — keyword after value, not preceding
- `<p>Customer ID:</p><p><span>2024</span></p>` — block boundary stops walk

### Chunked scan — mutation buffering (added)

Exercises the async `scan(..., onDone)` path with `jest.useFakeTimers()` and `requestIdleCallback` overridden to `undefined` (forces `setTimeout` fallback). DOM has 210+ text nodes to exceed `CHUNK_SIZE` (200) and force multi-chunk scheduling.

- `mutations during scan are buffered and replayed` — injects a `<p>` with `<strong><u>Org ID:</u></strong> 46387905` during mid-scan (`_scanComplete` false), calls `handleMutations` which buffers. After `jest.runAllTimers()` drains all chunks, verifies the PII span exists.
- `cancelChunkedScan discards buffered mutations` — buffers a mutation then calls `cancelChunkedScan`. Verifies no PII spans exist (buffer discarded, not drained).

### Phase 2 — cascade tiers + regex cache + stats (added)
- `Phase 2 — getCachedRegex returns same RegExp instance per pattern` — two consecutive calls with the same prototype return the identical instance; `lastIndex` is `0` after each call
- `Phase 2 — getCachedRegex resets lastIndex on each call` — after `exec()` advances `lastIndex`, a subsequent `getCachedRegex` call resets it to `0`
- `Phase 2 — getCachedRegex distinguishes by source AND flags` — same source with different flags (`/\d+/g` vs `/\d+/gi`) yields distinct instances
- `Phase 2 — falsePositivesCheckCascade returns same as flat precise` — behavior parity smoke test: each Phase 1 suppressor still fires through the cascade (`isYear` / `isHexColor` / `isPercentage` / `isDateLike` true cases + one no-suppressor false case)
- `Phase 2 — getStats returns the stats shape (zeros when Logger off)` — `{ node_count, digit_node_count, stage3_candidates, stage4_suppressed, total_emit }` all numbers; values 0 when `Logger.enabled` is falsy
- `Phase 2 — getStats counters increment when Logger.enabled is true` — mocks `blsi.Logger = { enabled: true }`; assert `node_count`, `digit_node_count`, `total_emit` all ≥ 1 after a scan that finds a numeric match. Restores `blsi.Logger` in `finally`.
- `Phase 2 — getStats resets at the top of each scan` — after `scan` + `clear`, all counters return to 0
- `Phase 2 — getStats is a copy, not a live reference` — mutating the returned object does not affect subsequent `getStats` results

### Phase 3 — Stage 1 dedicated detectors (added)

Integration coverage for the high-confidence checksum-validated detectors wired into `findMatches` ahead of the identifier sub-pass and Stage 3 NUMERIC_RE. Underlying validator unit tests live in `pii_checksums.test.js`.

#### Stage 1 — Card PAN
- `valid Visa test PAN wrapped as one span` — `'4242424242424242'` → 1 span; textContent equals the full 16-digit PAN.
- `Mastercard with hyphen separators wrapped` — `'5555-5555-5555-4444'` → 1 span (regex allows `[ \-]` between digits).
- `Amex 15-digit test PAN wrapped` — `'378282246310005'` → 1 span (15-digit Amex IIN).
- `Luhn-passing 16-digit number with non-card IIN falls back to bare-numeric (NOT Stage 1)` — `'1230231230231233'` → ≥ 1 span via Stage 3; Stage 1 declines because `_classifyPan` returns null.
- `Luhn-FAIL 16-digit not detected by Stage 1 (still falls back)` — `'4242424242424241'` → 1 span (bare-numeric); Stage 1 declines on Luhn fail. Asserts no double-wrap.

#### Stage 1 — IBAN
- `valid GB IBAN with spaces wrapped as one span` — `'GB29 NWBK 6016 1331 9268 19'` → 1 span; textContent equals the spaced form.
- `valid DE IBAN no separators wrapped` — `'DE89370400440532013000'` → 1 span.
- `flipped IBAN check digits not wrapped` — `'GB99 NWBK 6016 1331 9268 19'` → no IBAN-shaped span starting `GB`; mod-97 fails.
- `non-IBAN 2-letter prefix with valid mod-97 length not wrapped` — `'ZZ29NWBK60161331926819'` → no `ZZ`-prefixed PII span; `ZZ` has no `_IBAN_LENGTHS` entry.

#### Stage 1 — ETH wallet
- `valid 0x + 40-hex address wrapped as one span` — `'0x742d35cc6634c0532925a3b844bc9e7595f0beb1'` → 1 span; textContent equals the full address.
- `0x with 39 hex chars NOT wrapped (length dispositive)` — Short-by-one address → no `0x`-prefixed PII span (regex strictly requires 40 hex).
- `mixed-case ETH address still wrapped` — Upper-case hex still matches; EIP-55 case-checksum is optional in this implementation.

#### Stage 1 — ISBN-13 (suppress / anti-PII)
- `valid ISBN-13 NOT wrapped (consumed → no PII span)` — `'9780135957059'` → 0 spans; Stage 1 consumes the range, suppressing the bare-numeric overlap.
- `ISBN-13 dashed form NOT wrapped` — `'978-0-13-595705-9'` → 0 spans.
- `978-prefixed but checksum-invalid 13-digit number STILL wraps via bare-numeric` — Stage 1 declines on checksum fail; bare-numeric Stage 3 catches it.

#### Stage 1 — Aadhaar
- `valid Verhoeff-passing 12-digit ID wrapped` — `'234123412346'` → ≥ 1 span (synthetic Aadhaar passing Verhoeff).
- `Verhoeff-failing 12-digit number falls back to bare-numeric (not Stage 1)` — Off-by-one check digit → ≥ 1 span via Stage 3 (bare-numeric).

#### Stage 1 — E164 phone vs Aadhaar priority
- `+91 with 4-4-4 grouping wraps full string including country code` — `'+91 9876 5432 1098'` → span includes `+91`; E164 runs before Aadhaar so the full phone is one span.
- `+91 with no space wraps full string including +` — `'+919876543210'` → span text `+919876543210`; without E164 priority, Aadhaar would consume `919876543210` leaving `+` orphaned.
- `+91 with Aadhaar-shaped body wraps full string` — `'+91 2345 6789 0123'` → span includes `+91`.
- `standalone Aadhaar (no + prefix) still detected` — `'234123412346'` → ≥1 span; E164 priority doesn't affect standalone Aadhaar detection.

#### Stage 1 — overlap with bare-numeric
- `PAN does not double-wrap (Stage 1 + Stage 3)` — Bare 16-digit Visa → exactly 1 span; consumed-tracker prevents Stage 3 from re-emitting.
- `ETH address does not double-wrap` — 0x-prefixed address → exactly 1 span.

### Phase 4 — Stage 2 context-gated detectors (added)

Stage 2 detectors run after the identifier sub-pass and before Stage 3 NUMERIC_RE, sharing the same `consumed[]` tracker. Validators read country signal via `blsi.PiiState.getCountry()`, seeded once per scan by the facade calling `blsi.PiiCountry.detect()`. Tests drive the country signal through `<html lang>` (cleared in `beforeEach` / `afterEach`) — that's the same input path production uses.

Country signal cleanup is added to `beforeEach`/`afterEach`: `document.documentElement.removeAttribute('lang')` plus the existing innerHTML reset.

#### Stage 2 — MAC address
- `valid colon-separated MAC wrapped` — `'00:1A:2B:3C:4D:5E'` → 1 span; full address text.
- `hyphen-separated MAC wrapped` — `'00-1A-2B-3C-4D-5E'` → 1 span.
- `5-pair string (only 5 octets) NOT wrapped as MAC` — short-by-one pairs → no MAC-shaped span.

#### Stage 2 — IPv4
- `public IPv4 with keyword nearby wrapped` — `'Connect to server 8.8.8.8 today.'` → 1 span; textContent equals `8.8.8.8`.
- `public IPv4 without keyword NOT wrapped` — Same address with no keyword → no IPv4 span.
- `private IPv4 (10/8) NOT wrapped even with keyword` — `'Server IP 10.0.0.1 internal.'` → 0 spans (private range suppressed).
- `loopback 127.0.0.1 NOT wrapped` — Reserved range.
- `192.168.x.y private NOT wrapped` — Reserved range.

#### Stage 2 — IMEI
- `Luhn-valid IMEI with keyword wrapped` — `'490154203237518'` near `IMEI` → 1 span.
- `Luhn-valid 15-digit number WITHOUT keyword falls back to bare-numeric` — Same digits, no keyword → 1 span via Stage 3 bare-numeric.
- `Luhn-FAIL 15-digit number with IMEI keyword NOT wrapped by Stage 2 (still bare-numeric)` — Stage 2 declines on Luhn fail; Stage 3 wraps.

#### Stage 2 — E.164 phone
- `+ prefix dispositive — wrapped without keyword` — `'+1 555-123-4567'` → 1 span.
- `NBSP-separated +91 phone wrapped as one span` — `'+91<NBSP>94909<NBSP>73391'` → 1 span (NBSP via ` ` escape in regex source).

#### Stage 2 — SSN_US
- `SSN with keyword wrapped (no country signal)` — `'SSN 123-45-6789 on file.'` → 1 span; textContent equals `123-45-6789`.
- `SSN on US-country page wrapped without keyword` — `<html lang="en-US">` → 1 span via country gate.
- `SSN on non-US page without keyword NOT wrapped` — `<html lang="en-GB">` + no SSN keyword → ≤ 1 span (only Stage 3 bare-numeric of the trailing 4-digit group).
- `SSN with 000 area code NOT wrapped (range gate)` — Negative lookahead in regex rejects `000` first 3 digits.
- `SSN with 666 area code NOT wrapped` — Negative lookahead rejects `666`.

#### Stage 2 — NHS_UK
- `valid NHS number on GB-country page wrapped` — `<html lang="en-GB">` + `'943 476 5919'` (mod-11 valid) → 1 span; textContent matches the spaced form.
- `valid NHS number with NHS keyword wrapped (no country signal)` — `'NHS number 9434765919 entered.'` → 1 span via keyword.
- `valid NHS shape on non-GB page without keyword NOT wrapped via Stage 2` — `<html lang="en-US">` + no NHS keyword → 1 span via Stage 3 bare-numeric (Stage 2 declines).
- `mod-11 fail on GB page NOT wrapped via Stage 2` — `'9434765918'` (off-by-one) → Stage 2 declines on mod-11 fail; Stage 3 wraps.

### Phase 5 — Consolidated descriptor framework (added)

After Phase 5 unification, every detector is a frozen data row in `STAGE1_DETECTORS` / `STAGE2_DETECTORS` running through a single `_runDescriptor` runner. The integration tests below cover the new detectors landed alongside the consolidation.

#### Stage 1 dispositive — CN ID / NRIC SG / CURP MX / Emirates ID / NIE ES / Codice Fiscale
- `valid 18-char CN ID with X check digit wrapped` — activates the previously-dead `iso7064Mod11_2` checksum.
- `invalid CN ID checksum NOT wrapped via Stage 1` — fails ISO 7064 → Stage 1 declines.
- `NRIC SG positional shape wrapped` — `S1234567A` → 1 span (positional shape dispositive).
- `CURP MX positional shape wrapped` — `HEGG560427MVZRRL04` → 1 span (18-char RENAPO format).
- `Emirates ID with 784 prefix wrapped` — `784-1985-1234567-8` → 1 span.
- `NIE ES XYZ-prefix shape wrapped` — `X1234567L` → 1 span.
- `Codice Fiscale 16-char wrapped` — `RSSMRA80A01H501Z` → 1 span.

#### Stage 1 dispositive — postal codes (UK / CA)
- `UK postcode SW1A 1AA wrapped` — distinctive shape, no country gate.
- `CA postal K1A 0B1 wrapped` — alternating letter-digit, dispositive.

#### Stage 1 dispositive — IPv6 / GPS DMS / Plus Code
- `IPv6 full address wrapped` — `2001:0db8:85a3:0000:0000:8a2e:0370:7334`.
- `GPS DMS coordinate wrapped` — `40°26'46"N`.
- `Plus Code wrapped` — `8FVC9G8F+5W`.

#### Stage 2 country-gated — postal codes
- `NL postal on NL page wrapped` — `<html lang="nl-NL">` + `1234 AB`.
- `NL postal-shaped 1024 MB on non-NL page NOT wrapped (measurement)` — proves the country gate is necessary; raw shape collides with `1024 MB`.
- `US ZIP+4 on US page wrapped` — `<html lang="en-US">` + `90210-1234`.

#### Stage 2 country-gated — BSN NL / NPI US / DNI ES / ABN AU / MRN
- `BSN on NL page wrapped` — `111222333` passes 11-test (weights 9..2 + −1 on d9, sum mod 11 = 0).
- `NPI with NPI keyword wrapped` — `1234567893` passes Luhn(`80840` + npi).
- `DNI on ES page wrapped` — `12345678Z` (letter-mod-23 dropped — country gate alone).
- `ABN with keyword wrapped` — `51 824 753 556` (mod-89 dropped — keyword gate alone).
- `MRN with medical keyword wrapped` — bare 5-digit number with `MRN` / `Patient` keyword.

#### isStatistic suppressor
- `"n=2018" near "p<0.05" not blurred` — 5-digit value within 30 chars of `p<` / `n=` keyword → suppressed.
- `"R²=0.842" not blurred` — 4-digit value within 30 chars of `R²=` keyword → suppressed.
- `plain number with no statistical context still wrapped` — guards against over-suppression.

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
