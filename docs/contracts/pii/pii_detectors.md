# pii_detectors Contract

## Overview

Pattern catalog + `findMatches(text, types)` for the PII pipeline. **Phase 5 consolidation**: every detector is a frozen data row in `STAGE1_DETECTORS` or `STAGE2_DETECTORS` driven by a single `_runDescriptor` runner. Adding a detector is a row append — no new code unless a new checksum is needed.

Four layers run inside the numeric branch of `findMatches` (in execution order):

1. **Stage 1 — dispositive detectors** (shape-bound or shape+checksum). Card PAN, IBAN, ETH wallet, ISBN-13 (suppress), Aadhaar, CN ID, NRIC SG, CURP MX, Emirates ID, NIE ES, Codice Fiscale, UK / CA postal, IPv6, GPS DMS, Plus Code. Each entry sets `dispositive: true`; `checksum` runs first when present.
2. **Identifier-context sub-pass** — `DISPOSITIVE_RES` (Bearer / AKIA / ghp_ / sk_/pk_ / AIza / xox- / JWT) + `PREFIX_RE` keyword-prefix value capture. Bespoke logic — its capture-group semantics don't fit the generic descriptor.
3. **Stage 2 — context-gated detectors**. MAC address, IPv4, IMEI, E.164 phone, SSN_US, NHS_UK, BSN_NL, NPI_US, DNI_ES, ABN_AU, MRN, postal_jp / postal_au / postal_nl / postal_br / us_zip4 / eircode_ie. Validators read country signal via `blsi.PiiState.getCountry()` and/or run keyword windows via `_hasKeywordIn`.
4. **Stage 3 — generic NUMERIC_RE** (7 alternations) + Stage 4 FP suppressors via `blsi.PiiSuppressors.falsePositivesCheck`.

All four layers share a per-call `consumed[]` overlap tracker. SUPPRESS detectors (ISBN-13) push to `consumed[]` without emitting → Stage 3 bare-numeric overlap is dropped (anti-PII).

Per the project decision: **users see one switch (`numeric` toggle); per-detector behaviour is configured in source by maintainers via the descriptor rows.** No popup UI is exposed for individual detectors.

## Module State

None — patterns are frozen module-level constants. `findMatches` retrieves cached `RegExp` instances via `blsi.PiiState.getCachedRegex(prototype)` (Phase 2 — PERF.md M3). The cache returns one compiled instance per `(source, flags)` tuple with `lastIndex` reset; eliminates per-call `new RegExp(...)` allocation.

## Public API

### EMAIL_RE

Frozen `RegExp /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g`. RFC-ish local@domain.tld. Pre-filter: only run on text containing `@` to avoid O(n) regex on every node.

### NUMERIC_RE

Frozen `RegExp` — seven ordered alternations, first match at a given position wins. Phone-form separator class is `[<SPACE>\-<NBSP>]` (literal ASCII space, hyphen-minus, U+00A0 NO-BREAK SPACE) so chat-app and word-processor encodings of phone numbers wrap as a single span.

1. Currency symbol prefix — `$1,234.56`, `€500`, `₹50,000`. **Anchored to digit-end** via `\d(?:[\d,.'<NBSP>]*\d)?` so trailing punctuation/space stay outside the span (`Hello $1,234.56, world` → span = `$1,234.56`, comma/space dropped). Internal NBSP grouping (`€1<NBSP>234,56`) is preserved.
2. Currency code suffix — `1234 USD`, `50000 EUR`
3. Comma-grouped thousands — `1,234,567`, `12,345`
4. **Parenthesised area code** — `(555) 123-4567`, `(555)-123-4567`, `+1 (555) 123-4567`, `(20) 7946 0958`. Pattern `\+?(?:\d{1,3}[ \-<NBSP>])?\(\d{1,4}\)[ \-<NBSP>]?\s*\d{2,}(?:[ \-<NBSP>]\d{2,})*`: optional `+` cc, then `(<1–4 digits>)`, then a digit run of ≥2, optionally followed by more `[ \-<NBSP>]\d{2,}` groups. Most-specific phone form — placed first.
5. **Country-code / 2-digit-group phone** — `+91 94909 73391`, `+1 555-123-4567`, `+44 20 7946 0958`, `01 23 45 67 89`. Pattern `\+?\d{1,3}(?:[ \-<NBSP>]\d{2,}){2,}`: optional `+`, 1–3 leading digits, then ≥2 groups of ≥2 digits each. Captures `+`-prefixed forms (which `\b` cannot anchor on) AND European/Asian formats with 2-digit middle or all-2-digit groups (UK landline `+44 20 ...`, French `01 23 45 67 89`, Norwegian `12 34 56 78`).
6. Space/hyphen digit groups (phone-like fallback) — `111-222-333`, `4111 1111 1111 1111`. Requires ≥2 groups of ≥3 digits each, separator `[ \-<NBSP>]`. Catches plain phones / cards when alt #5's `\d{1,3}` leading group cannot match (e.g. `1234-5678` — first group is 4 digits).
7. 4+ bare digit sequence (catch-all) — `17150`, account numbers.

Alt order rationale: parens form (4) is most specific → wins when present; cc/2-digit form (5) covers `+`-prefixed and European phones; phone-like fallback (6) catches separator-grouped numbers without cc; bare 4+ digit (7) is the last-resort catch-all and must come last so longer sub-patterns wrap their full match.

### PATTERNS

Frozen `{ EMAIL: { regex, label }, NUMERIC: { regex, label } }`. Returned to callers via `getPatterns()`.

### STAGE1_DETECTORS / STAGE2_DETECTORS

Frozen arrays of detector descriptors driven by the unified `_runDescriptor` runner. Same shape across both stages:

```js
{
  id:             'card_pan' | 'iban' | ... ,  // diagnostic label
  regex:          /.../g,                       // /g RegExp prototype, cached per call
  checksum?:      (matchText, text, start) => boolean,  // runs FIRST when present
  dispositive?:   boolean,                      // skip country/keyword if true
  countries?:     ['US' | 'GB' | ...],         // ISO alpha-2 codes that bypass keyword
  keywordRe?:     RegExp,                       // tested against ±keywordWindow chars
  keywordWindow?: number,                       // default 50
  action:         'emit' | 'suppress',          // suppress = consume only
  preScreen?:     (text) => boolean,            // cheap whole-text early-out
}
```

Decision flow per match (see `_runDescriptor`):

1. `preScreen(text)` — early-out if false.
2. `consumed[]` overlap check — skip if range already claimed.
3. `checksum(matchText, text, start)` — skip on fail.
4. Context gate — `dispositive` ? PASS : `(country in countries)` ? PASS : `(keywordRe matches window)` ? PASS : SKIP.
5. `consumed.push([start, end])`; `action === 'emit'` also pushes the match object.

Stage 1 entries are dispositive (shape+checksum is enough); Stage 2 entries lean on country/keyword gates. The split is execution order — Stage 1 runs before identifier sub-pass; Stage 2 runs after.

**Adding a detector** is a single data row in the right array. New regex + (optional) new checksum function + descriptor entry. Tests + contract updates follow the standard rules.

### STAGE1_DETECTORS (legacy header — see unified shape above)

Frozen array. See the **STAGE1_DETECTORS / STAGE2_DETECTORS** section above for the current descriptor shape (`{ id, regex, checksum?, dispositive?, countries?, keywordRe?, keywordWindow?, action, preScreen? }`). Per-detector regex / checksum / gate documented in the **Stage 1 detectors** table below. Old per-row shape preserved here for orientation only:

```js
{
  id:        'card_pan' | 'iban' | 'eth_wallet' | 'isbn_13' | 'aadhaar',
  regex:     /.../g,                  // /g RegExp prototype, cached per call
  validator: (matchText) => boolean,  // checksum + shape gate
  action:    'emit' | 'suppress',     // 'suppress' consumes range without emitting
  preScreen: (text) => boolean,       // optional cheap whole-text early-out
}
```

Order is intentional and lower-FP-first so the shared `consumed[]` tracker dedupes correctly: `card_pan` → `iban` → `eth_wallet` → `isbn_13` → `aadhaar`. Adding a detector: append a frozen entry; the runner picks it up automatically.

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
2. If `types.numeric`:
   1. Allocate per-call `consumed: Array<[start, end)>` overlap tracker shared across the four numeric layers.
   2. Run Stage 1 — `_runStage1(text, matches, consumed)` calls `_runDescriptor` for each `STAGE1_DETECTORS` row. The runner applies overlap → checksum → context-gate (`dispositive` / `countries` / `keywordRe`).
   3. Run identifier sub-pass — `_runIdentifierPass(text, matches, consumed)`. Dispositive provider regexes first, then PREFIX_RE keyword-prefix capture.
   4. Run Stage 2 — `_runStage2(text, matches, consumed)` calls the same `_runDescriptor` for each `STAGE2_DETECTORS` row.
   5. Run Stage 3 NUMERIC_RE — for each hit, call `recordCandidate()`, then `_overlapsAny(consumed, …)`; if the range overlaps any prior consumption, `recordSuppress()` and skip. Otherwise call `blsi.PiiSuppressors.falsePositivesCheck`; if it returns `false`, push `{start, end, type: 'numeric'}` and `recordEmit()`. Otherwise `recordSuppress()`.
3. Sort by `start`, with ties by `end` desc (longer match first).
4. Filter: keep matches whose `start >= lastEnd` (drops overlaps).

### getPatterns()

**Returns**: `PATTERNS` (the frozen catalog).
**Use**: exposed via the facade `blsi.PiiDetector.getPatterns()` for tests and external observability.

## Stage 1 detectors

Each entry below maps a regex to a dispositive (shape-bound, optionally checksum-validated) decision. All entries set `dispositive: true`; the `checksum` field, when present, is the gate. SUPPRESS detectors (ISBN-13) consume the range without emitting so the Stage 3 bare-numeric loop drops the overlap.

| Detector | Regex (sketch) | Checksum | Action | Notes |
|---|---|---|---|---|
| `card_pan` | `(?<![A-Za-z\d])(?:\d[ \-]?){11,18}\d(?![A-Za-z\d])` | `_checksumCardPan` (IIN classify + Luhn) | emit | Strips `[ \-]` separators before validating. Classifier covers Visa / Mastercard / Amex / Discover / Diners / JCB / UnionPay. |
| `iban` | `(?<![A-Za-z\d])[A-Z]{2}\d{2}[A-Z0-9 \-]{11,42}(?![A-Za-z\d])` | `_checksumIban` (per-country length + mod-97) | emit | `_IBAN_LENGTHS` is an alpha-2-keyed snapshot of the ISO 13616 registry (~75 countries). |
| `eth_wallet` | `\b0x[a-fA-F0-9]{40}\b` | (none — length dispositive) | emit | EIP-55 case-checksum NOT enforced. |
| `isbn_13` | `\b97[89][\- ]?\d[\- ]?\d{3}[\- ]?\d{5}[\- ]?\d\b` | `_checksumIsbn13` | suppress | Anti-PII. ISBN-10 deferred (bare 10-digit FP risk on phones). |
| `aadhaar` | `\b[2-9]\d{3}[ \-]?\d{4}[ \-]?\d{4}\b` | `_checksumAadhaar` (Verhoeff) | emit | Not country-gated; sensitive gov ID, over-blur preferred. |
| `cn_id` | `\b\d{17}[\dXx]\b` | `_checksumCnId` (ISO 7064 mod-11-2) | emit | Activated `iso7064Mod11_2` checksum that previously had no consumer. |
| `nric_sg` | `\b[STFGM]\d{7}[A-Z]\b` | (none — positional shape dispositive) | emit | Letter-table validator dropped — country/positional shape is enough. |
| `curp_mx` | `\b[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z]{3}[A-Z0-9]\d\b` | (none) | emit | 18-char positional per RENAPO. |
| `emirates_id` | `\b784[ \-]?\d{4}[ \-]?\d{7}[ \-]?\d\b` | (none — `784` prefix dispositive) | emit | Optional Luhn dropped. |
| `nie_es` | `\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b` | (none — XYZ prefix dispositive) | emit | Letter-mod-23 validator dropped. |
| `codice_fiscale` | `\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b` | (none — 16-char positional) | emit | Letter-table validator dropped. |
| `postal_uk` | `\b[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2}\b` | (none) | emit | Distinctive shape; FP risk low without country gate. |
| `postal_ca` | `\b[ABCEGHJ-NPR-TV-Z]\d[ABCEGHJ-NPR-TV-Z][ \-]?\d[ABCEGHJ-NPR-TV-Z]\d\b` | (none) | emit | Alternating letter/digit; letter set excludes D/F/I/O/Q/U. |
| `ipv6` | `\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b\|...compressed forms` | (none — colon-grouped hex shape dispositive) | emit | Conservative; full and `::`-compressed forms accepted. |
| `gps_dms` | `\b\d{1,3}°\d{1,2}['′]\d{1,2}(?:\.\d+)?["″]\s?[NSEW]\b` | (none) | emit | `°` symbol dispositive. |
| `plus_code` | `\b[2-9CFGHJMPQRVWX]{4,8}\+[2-9CFGHJMPQRVWX]{2,3}\b` | (none) | emit | Open Location Code; `+` separator distinctive. |

### Validator helpers (private)

Each `checksum` field on a Stage 1 / Stage 2 descriptor points to one of these:

- `_classifyPan(digits)` — returns `'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'unionpay' | null`. ISO/IEC 7812-1 IIN ranges + per-network length checks.
- `_checksumCardPan(matchText)` — strips `[ \-]`, requires 13–19 digits, runs `_classifyPan`, then `luhn`.
- `_checksumIban(matchText)` — strips `[ \-]`, upcases, requires `^[A-Z]{2}\d{2}[A-Z0-9]+$`, looks up `_IBAN_LENGTHS[country]`, runs `mod97`.
- `_checksumIsbn13(matchText)` — strips `[ \-]`, runs `isbn13`.
- `_checksumAadhaar(matchText)` — strips `[ \-]`, requires `^\d{12}$`, runs `verhoeff`.
- `_checksumCnId(matchText)` — upcases, runs `iso7064Mod11_2`.
- `_checksumNhsUk(matchText)` — strips `[ \-]`, requires `^\d{10}$`, runs `mod11Weighted(first9, [10..2])` and applies the NHS check-digit convention (`check = 11 - r`, remap `11 → 0`, `10 → invalid`).
- `_checksumBsnNl(matchText)` — requires `^\d{9}$`, runs `mod11Weighted(first8, [9..2])` and applies the 11-test (`(r - last) mod 11 === 0`).
- `_checksumNpiUs(matchText)` — runs `luhn('80840' + matchText)` (NPI Luhn variant per ISO/IEC 7812 issuer-ID prefix).
- `_checksumImei(matchText)` — `luhn(matchText)`.
- `_checksumIpv4Public(matchText)` — splits on `.`, validates octet bounds, suppresses `0/8`, `10/8`, `127/8`, `169.254/16`, `172.16-31`, `192.168/16`, `224+`. Returns `true` iff public-routable.

### Internal helpers (shared across layers)

- `_overlapsAny(consumed, start, end)` — `true` iff `[start, end)` overlaps any range in `consumed[]`. Linear scan; cheap because `consumed[]` rarely exceeds ~10 entries per text node.
- `_runDescriptor(text, det, matches, consumed)` — single generic runner shared by Stage 1 and Stage 2. Walks the detector's regex through the cached-regex helper, applies overlap → checksum → context-gate (dispositive | country | keyword) in order, and pushes to `consumed[]` + `matches[]` accordingly.
- `_runStage1(text, matches, consumed)` — calls `_runDescriptor` for each entry in `STAGE1_DETECTORS`.
- `_runStage2(text, matches, consumed)` — calls `_runDescriptor` for each entry in `STAGE2_DETECTORS`.
- `_hasKeywordIn(re, text, start, end, window)` — substring helper. Slices `[start - window, end + window]` of `text` and tests `re` against the slice. Default `window` is 50 characters.

## Stage 2 detectors

Each entry below maps a regex to a context-aware decision. All entries gate via `dispositive` (rare — only when shape is unique), `countries` (positive trigger when page-country signal matches), and/or `keywordRe` (window check). The runner is the same `_runDescriptor` as Stage 1.

| Detector | Regex (sketch) | Checksum | Country | Keyword (window) | Notes |
|---|---|---|---|---|---|
| `mac_address` | `\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b` | — | — | — (dispositive) | Six hex pairs is rare in non-PII text. |
| `ipv4` | `\b(?:(?:25[0-5]\|2[0-4]\d\|[01]?\d\d?)\.){3}…\b` | `_checksumIpv4Public` | — | `ip\|ipv4\|address\|server\|host\|client\|connect*\|from` (50) | Suppresses private/reserved ranges + keyword required. |
| `imei` | `\b\d{15}\b` | `_checksumImei` (Luhn) | — | `imei\|device( id)?` (50) | Luhn + keyword. |
| `e164_phone` | `\+\d{1,3}[ .\- ]?\d[\d .\- ]{6,14}\d\b` | — | — | — (dispositive) | `+` prefix dispositive. NBSP via `\u00A0` escape. |
| `ssn_us` | `\b(?!000\|666\|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b` | — | `US` | `ssn\|social security\|social sec` (50) | Range gates baked in via lookaheads. |
| `nhs_uk` | `\b\d{3}[ \-]?\d{3}[ \-]?\d{4}\b` | `_checksumNhsUk` | `GB` | `nhs\|national health\|patient` (50) | Mod-11 weighted with NHS convention. |
| `bsn_nl` | `\b\d{9}\b` | `_checksumBsnNl` | `NL` | `bsn\|burgerservicenummer\|sofinummer` (50) | 11-test with `−1` weight on the 9th digit. |
| `npi_us` | `\b\d{10}\b` | `_checksumNpiUs` (Luhn(`80840`+npi)) | — | `npi\|provider id\|national provider` (50) | NPI Luhn variant. |
| `dni_es` | `\b\d{8}[A-HJ-NP-TV-Z]\b` | — | `ES` | `dni\|d\.n\.i\.\|documento nacional` (50) | Letter-mod-23 dropped — country/keyword gate. |
| `abn_au` | `\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b` | — | `AU` | `abn\|australian business number` (50) | Mod-89 dropped. |
| `mrn` | `\b\d{4,10}\b` | — | — | `mrn\|medical record\|chart\|patient (id\|no)` (50) | Healthcare context. |
| `postal_jp` | `(?:〒\s?)?\b\d{3}-\d{4}\b` | — | `JP` | `〒\|postal code\|郵便番号` (30) | `〒` symbol or JP gate. |
| `postal_au` | `\b\d{4}\b` | — | `AU` | `postal\|postcode\|po box` (30) | 4-digit; needs gate. |
| `postal_nl` | `\b[1-9]\d{3} ?[A-Z]{2}\b` | — | `NL` | `postcode\|postbus` (30) | Shape collides with `1024 MB` measurements. |
| `postal_br` | `\b\d{5}-\d{3}\b` | — | `BR` | `cep\|c\.e\.p\.` (30) | Shape collides with phone-like numbers. |
| `us_zip4` | `\b\d{5}-\d{4}\b` | — | `US` | `zip\|zipcode\|zip code\|postal code` (30) | Shape can collide with phone formats. |
| `eircode_ie` | `\b[AC-FHKNPRTV-Y][0-9W][0-9 ][AC-FHKNPRTV-Y0-9]{4}\b` | — | `IE` | `eircode\|eir code` (30) | 7-char alphanumeric — collides with version strings. |

## Identifier-context sub-pass (inside `types.numeric`)

`findMatches` runs an internal `_runIdentifierPass(text, matches)` BEFORE the NUMERIC_RE loop when `types.numeric` is true. Two passes contribute matches with `type: 'numeric'` (label preserved so existing CSS / reveal logic apply):

### A. Dispositive provider detectors

Frozen list `DISPOSITIVE_RES` (full match wrapped — the prefix word stays inside the span). Order matters: broader-span patterns first so longer wraps win the overlap dedup.

| # | Pattern | Catches |
|---|---|---|
| 1 | `\b(?:Bearer\|Basic)\s+[A-Za-z0-9._\-+/=]{20,}\b` | `Authorization: Bearer eyJ…` (whole header) |
| 2 | `\bAKIA[0-9A-Z]{16}\b` | AWS access key |
| 3 | `\bgithub_pat_[A-Za-z0-9_]{82}\b` | GitHub fine-grained PAT |
| 4 | `\bghp_[A-Za-z0-9]{36}\b` | GitHub classic PAT |
| 5 | `\b[sp]k_(?:live\|test)_[A-Za-z0-9]{24,}\b` | Stripe sk_/pk_ live/test |
| 6 | `\bAIza[A-Za-z0-9_\-]{35}\b` | Google API |
| 7 | `\bxox[bpoars]-[A-Za-z0-9\-]{10,}\b` | Slack |
| 8 | `\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b` | Bare 3-segment JWT |

A local `consumed[]` array tracks ranges so subsequent dispositive passes and the keyword-prefix pass skip overlapping spans.

### B. Keyword-prefix detector — `PREFIX_RE`

```
\bKEYWORD_ALT\b\s*[:=#\-—]?\s*(?:is\s+|of\s+)?["']?
([A-Za-z0-9][A-Za-z0-9._\-]{3,63})
["']?
```

Capture group `m[1]` is the value to wrap; offsets read via `/d` flag → `m.indices[1]`.

`KEYWORD_ALT` is built at module init from a frozen `KEYWORDS` array (~50 English entries) sorted by source-length descending so multi-word phrases (`api[ _-]?key`, `client[ _-]?secret`, `customer[ _-]?id`) win against single-word fallbacks (`key`, `id`). Catalog covers:

- Generic IDs — `id`, `account`, `customer`, `employee`, `member`, `user`, …
- Credentials — `password`, `secret`, `key`, `token`, `bearer`, `auth`, `credential`, …
- Dev (multi-word) — `api[ _-]?key`, `access[ _-]?token`, `refresh[ _-]?token`, `client[ _-]?id/secret`, `session[ _-]?id`, `request[ _-]?id`, `trace[ _-]?id`, `correlation[ _-]?id`, `transaction[ _-]?id`, `device[ _-]?id`, `tenant[ _-]?id`, `org[ _-]?id`, …
- Corporate / consumer — `reference`, `confirmation`, `otp`, `pin`, `verification`, `serial`, `license`, `policy`, `order`, `invoice`, `tracking`, `case`, `ticket`, …

#### Value-validator (`_validateValue`)

```
length >= 4
AND (matchText contains a digit OR length >= 16)
AND not all-same-char  (rejects "aaaa", "0000")
```

The 4-char floor + digit-or-length-16 gate is the **Decision #3 length gate**: short public references (`Order #5`, `Case 12`) stay unblurred; long unique identifiers (`Order #1234567890`, `Case ABC-12345`, `Tracking 1Z999AA10123456784`) wrap. `isOrderRef` in `pii_suppressors.js` is **unchanged** — still suppresses bare-numeric matches near order-ish keywords on the NUMERIC path when no value of length ≥ 4 follows.

### Pre-filter coupling

The numeric branch in the facade (`pii.js`) uses `blsi.PiiPreFilter.hasDigitOrLongAlnum(text)` (added alongside the existing `hasDigit`) so pure-alpha tokens with an 8+ char alnum run (refresh tokens, base64) survive the M1 pre-screen. Email-only paths still use `hasDigit`; nothing else needs to change.

### Overlap dedup

Two mechanisms work together:

1. **Per-call `consumed: Array<[start, end)>` tracker.** Stage 1 → identifier sub-pass → Stage 3 NUMERIC_RE all share the same array. `_overlapsAny` is consulted before each push. Stage 3 also calls `recordSuppress()` when it skips a candidate due to overlap — observable through `getStats().stage4_suppressed`.
2. **Tail sort + filter.** After all three layers, `matches[]` is sorted by `start` ascending (ties broken by longer-first) and a single-pass filter drops any entry whose `start < lastEnd`. Belt-and-braces with the tracker — covers cases where two layers emit non-overlapping ranges that the tracker doesn't notice but should still dedupe.

## Dependencies

- `blsi.PiiChecksums` — validators consume `luhn` (PAN, IMEI), `verhoeff` (Aadhaar), `mod97` (IBAN), `isbn13` (ISBN-13 suppress), `mod11Weighted` (NHS_UK).
- `blsi.PiiSuppressors.falsePositivesCheck` — Stage 4 cascade on the Stage 3 NUMERIC_RE path. Stage 1 + Stage 2 hits skip suppressors entirely (the checksum/country/keyword gate is enough).
- `blsi.PiiState.getCachedRegex / recordCandidate / recordSuppress / recordEmit / getCountry` — single-instance regex cache + scan stats + per-scan country signal. `getCountry()` is consulted by Stage 2 validators (SSN_US, NHS_UK) for the country-OR-keyword gate.
- `blsi.PiiCountry.detect()` — invoked by the facade `pii.scan()`; not invoked directly by `pii_detectors.js`.

## Edge cases

- Empty `text` → returns `[]`.
- `types = {}` or missing both flags → returns `[]`.
- Zero-length match (regex pathology) — explicit `re.lastIndex++` advance to prevent infinite loop.
- Matches longer than `text.length` impossible by construction (regex is anchored to `text`).
- Overlapping email + numeric — sort puts email first; numeric overlap dropped.
- Overlapping identifier + bare-numeric on the same span — identifier wins (pushed first; longer span wins ties).
- All-same-char identifier values (`0000`, `aaaaaaaaaaaaaaaa`) — rejected by `_validateValue`. Bare-numeric path still catches `\b\d{4,}\b` like `0000` unless an existing suppressor fires.
