# PII Detector — Rewrite Plan

> 6-phase plan to replace the current `src/pii_detector.js` (single 336-line IIFE) with the staged pipeline from [`PIPELINE.md`](./PIPELINE.md), perf budget from [`PERF.md`](./PERF.md), and detector coverage from the per-topic research files. Each phase is a separately-shippable PR with green tests.
>
> Read [`INDEX.md`](./INDEX.md), [`PIPELINE.md`](./PIPELINE.md), [`PERF.md`](./PERF.md) before executing.

---

## Goal

Rebuild the PII detector to:

1. Cover ~30 dedicated PII patterns (cards, IBAN, gov IDs, healthcare IDs, phones, location, devices, crypto, finance) at high precision via checksums.
2. Cut FP rate by ~3.5× via the staged-cascade FP suppressors.
3. Hit the per-page perf budget (≤30 ms first scan on heavy pages, ≤5 ms per mutation drain).
4. Modularize the source so adding a new detector is a one-file change with isolated tests.

## Non-goals

- No new UI work in early phases (settings expansion lands in Phase 5).
- No backwards-incompat changes to the public `blsi.PiiDetector` API surface in any phase. Settings shape extends additively.
- No worker/WASM offload (deferred to "when to optimize further" in `PERF.md`).
- No coverage of email beyond the existing detector. This plan focuses on *numeric* PII only.

---

## Current state

```
src/pii_detector.js                          (336 lines, 1 IIFE)
  ├─ 5 regex patterns: CURRENCY_PREFIX, CURRENCY_SUFFIX,
  │                    GROUPED_THOUSANDS, PHONE_SHAPE, BARE_DIGITS (+ EMAIL)
  ├─ 4 FP suppressors: isYear, isVersion, isPublicPrice, isCountNoise
  ├─ TreeWalker scan(rootEl, types)
  ├─ handleMutations(records, root)
  ├─ _wrapTextNode (right-to-left split)
  ├─ _isExtensionUI / _isInsidePiiSpan
  └─ Module-level state: _matchCount, _activeTypes
```

Public global: `blsi.PiiDetector = { scan, clear, handleMutations, getMatchCount, getPatterns }`.

Tests: `tests/unit/pii_detector.test.js` (~70 tests). Contract: `docs/contracts/pii_detector.md`.

---

## Target file layout

After Phase 0, the module lives under `src/pii/` mirroring the `src/core/` pattern. Per-file global is set at end of each IIFE; `pii.js` is the facade that the rest of the extension talks to.

```
src/pii/
├── pii_state.js             → blsi.PiiState         shared private state, regex cache, country signal
├── pii_checksums.js         → blsi.PiiChecksums     pure math (Luhn, Verhoeff, mod-11, mod-97, ISO 7064)
├── pii_pre_filter.js        → blsi.PiiPreFilter     Stage 0 (extension UI / pii span / code-block / digit pre-screen)
├── pii_country.js           → blsi.PiiCountry       page-country signal (TLD + lang + meta + currency sample)
├── pii_suppressors.js       → blsi.PiiSuppressors   Stage 4 cascade (14 FP suppressors, tiered)
├── pii_detectors.js         → blsi.PiiDetectors     Stage 1 + 2 detector descriptors + runDetector helper
└── pii.js                   → blsi.PiiDetector      facade: scan, clear, handleMutations, getMatchCount, getStats

docs/contracts/pii/
├── pii_state.md
├── pii_checksums.md
├── pii_pre_filter.md
├── pii_country.md
├── pii_suppressors.md
├── pii_detectors.md
└── pii.md

docs/contracts/pii/
├── pii.tests.md
├── pii_checksums.tests.md
├── pii_pre_filter.tests.md
├── pii_country.tests.md
├── pii_suppressors.tests.md
└── pii_detectors.tests.md

tests/unit/pii/
├── pii.test.js                        (was tests/unit/pii_detector.test.js)
├── pii_checksums.test.js
├── pii_pre_filter.test.js
├── pii_country.test.js
├── pii_suppressors.test.js
└── pii_detectors.test.js
```

**Manifest load order** (after Phase 0):

```
constants → content_i18n → logger → action_registry → shortcut_label →
url_matcher → selector_utils → storage_model → tab_privacy →
pii/pii_state → pii/pii_checksums → pii/pii_pre_filter → pii/pii_country →
pii/pii_suppressors → pii/pii_detectors → pii/pii →
fonts → core/* → engine → auto_blur → screen_share → reveal_controller →
shortcut_handler → selection_blur → screenshot → picker → content_script
```

`blsi.PiiDetector` (the facade) loads last in the PII group; everything that depends on it (`content_script.js`) loads after it. **Pii sub-modules only depend on previously-loaded sub-modules** — no cycles.

---

## Phase plan

Each phase = 1 PR, branch off `main`, merge when green. PRs land sequentially; do not stack.

### Phase 0 — folder migration + scaffolding (no behavior change)

**Scope:** carve the existing `src/pii_detector.js` into the 7-file layout above. **Zero behavior change. All existing tests pass unchanged.**

**Changes:**

1. Create `src/pii/` directory.
2. Split `pii_detector.js`:
   - Move `_matchCount`, `_activeTypes`, `PII_ATTR` → `pii_state.js` (`blsi.PiiState`).
   - Move `_isExtensionUI`, `_isInsidePiiSpan`, blank-node check → `pii_pre_filter.js` (`blsi.PiiPreFilter`). The `_isInsideCodeBlock` lands in Phase 1.
   - Move 5 regex patterns + `EMAIL_RE` + `_findMatches` core loop → `pii_detectors.js` (`blsi.PiiDetectors`).
   - Move 4 existing FP suppressors + `FALSE_POSITIVE_CHECKS` + `_falsePositivesCheck` → `pii_suppressors.js` (`blsi.PiiSuppressors`).
   - Create empty stubs for `pii_checksums.js` (Luhn/Verhoeff arrive Phase 3) and `pii_country.js` (page-country arrives Phase 4).
   - `_wrapTextNode`, `scan`, `clear`, `handleMutations`, `getMatchCount`, `getPatterns` → `pii.js` (`blsi.PiiDetector`, the facade — name unchanged for back-compat).
3. Update `manifest.json` content_scripts entry to load the 7 files in dependency order.
4. Update `src/CLAUDE.md`:
   - Replace `pii_detector.js` row with the 7 sub-module entries.
   - Update load-order list.
5. Update top-level `CLAUDE.md` Module Globals table:
   - Replace single `src/pii_detector.js` row with one row per `pii/*.js` file.
6. Update `.claude/rules/code-contracts.md` mapping table — 7 new contract paths.
7. Create per-module contracts in `docs/contracts/pii/`. The old `docs/contracts/pii_detector.md` becomes `docs/contracts/pii/pii.md` (facade contract); content split across the 6 new files.
8. Move tests: `tests/unit/pii_detector.test.js` → `tests/unit/pii/pii.test.js`. Create empty test files for the other modules (filled as those modules grow). Test contract docs renamed accordingly.
9. Verify: `npm run test:unit` passes with zero new tests + zero changed tests.

**Risks:** load-order regressions (manifest order is fragile). Mitigation: run a manual smoke test on Chrome dev profile before merging — load extension, open Gmail, verify PII blur still works as today.

**Tests:** none added; all existing pass.

**Estimated LOC**: −336 in `pii_detector.js`, +400 across the 7 new files (boilerplate + IIFE wrappers).

**Doc updates** (same commit):
- `CLAUDE.md` Module Globals table
- `src/CLAUDE.md` load order + per-module rules
- `.claude/rules/code-contracts.md` mapping
- 7 new files in `docs/contracts/pii/`
- 6 new test contracts in same folder

---

### Phase 1 — Stage 0 + Tier-A suppressors (high-impact, low-cost)

**Scope:** add the highest-impact FP suppressors and the code-block ancestor check. No new detectors.

**Changes:**

1. **`pii_pre_filter.js`** — add `_isInsideCodeBlock(node)`. Selector list: `code, pre, kbd, samp, [data-code], .highlight, .codehilite`. Wired into `pii.js` `scan` and `handleMutations` entry points alongside the existing `_isExtensionUI` / `_isInsidePiiSpan` checks.
2. **`pii_pre_filter.js`** — add M1 whole-node digit pre-screen `_HAS_DIGIT.test(text)` (per [`PERF.md`](./PERF.md) M1). Email-only fast path when no digit.
3. **`pii_suppressors.js`** — add Tier-A:
   - `isHexColor` — `#`-prefixed match-self
   - `isYearRange` — `\d{4}-\d{4}` both endpoints in 1000–2099
   - `isPercentage` — trailing `%`
   - `isScientificNotation` — trailing `e[+-]?\d`
   - `isMeasurement` — trailing-unit token (≤8-char window)
   - `isResolution` — `\d+[ ]?[x×][ ]?\d+` match-spanning
   - `isOrdinalLabel` — preceding-word window (30 chars before)
   - `isDateLike` — structural fingerprints + 50-char keyword window
   - `isOrderRef` — 50-char keyword window (order/tracking/invoice/case/etc.)
   - Update `FALSE_POSITIVE_CHECKS.precise` order per [`PIPELINE.md`](./PIPELINE.md) Stage 4 cascade.
4. **`pii_suppressors.js`** — extend existing `isPublicPrice` and `isCountNoise` keyword regexes with multilingual entries (ES/FR/DE/JA/ZH/HI per [`INDEX.md`](./INDEX.md) context-token table).
5. **`pii.js`** — wire `_isInsideCodeBlock` early-exit in `scan` and `handleMutations`.

**Tests added (~25):**

- `pii_pre_filter.test.js` — `_isInsideCodeBlock` true/false on `<code>`, `<pre>`, `<kbd>`, `<samp>`, `[data-code]`, `.highlight`, plain `<div>`.
- `pii_suppressors.test.js` — one TP + one FP per new suppressor (9 × 2 = 18 cases).
- `pii.test.js` — integration: ISO 8601 dates not blurred, `1920x1080` not blurred, `#FF5733` not blurred, `Order #4567823` not blurred, real email/PAN still blurred.

**Doc updates** (same commit):
- `pii_suppressors.md` — list new suppressors + cascade order.
- `pii_pre_filter.md` — `_isInsideCodeBlock` and digit pre-screen.
- `pii_suppressors.tests.md` and `pii_pre_filter.tests.md` — new test groups.
- `CLAUDE.md` — pii_suppressors row notes new precise-profile entries.

**Estimated LOC**: +180 in `pii_suppressors.js`, +25 in `pii_pre_filter.js`, +10 wiring.

**Behavior change**: ~50% reduction in remaining FP rate after this phase alone. Coverage (TP rate) unchanged. **Per-page cost drops** because the digit pre-screen culls 60–80% of nodes from the pipeline.

---

### Phase 2 — STAGE 4 cascade refactor + regex compilation cache

**Scope:** structural cleanup of how suppressors run + perf wins.

**Changes:**

1. **`pii_suppressors.js`** — group suppressors into 5 ordered tiers per [`PIPELINE.md`](./PIPELINE.md) §STAGE 4. Replace flat `Array.some` with `_falsePositivesCheckCascade` that walks the tiers and short-circuits on first hit.
2. **`pii_state.js`** — add `_REGEX_CACHE` Map. Cache every compiled `RegExp` instance on first use. Detectors and generic regexes both reference cached instances. Caller resets `re.lastIndex = 0` instead of `new RegExp(...)`.
3. **`pii_detectors.js`** — refactor the generic regex loop in `_findMatches` to use cached regex instances.
4. **`pii_state.js`** — track `_scanCost` counter (node_count, total_ms, candidate_count) gated by `Logger.enabled`. Surface via `pii.js` → `blsi.PiiDetector.getStats()`.
5. **`pii.js`** — add `getStats()` to public surface; document non-clearing semantics (cleared on `clear()` or new `scan()`).

**Tests added (~10):**

- `pii_suppressors.test.js` — cascade short-circuits: a structural-tier hit should not run keyword-window checks. Verify via spy/mock or by setting two redundant suppressors and confirming only the first ran.
- `pii_state.test.js` — regex cache returns same RegExp instance on repeated lookups; `lastIndex` resets between calls don't leak.
- `pii.test.js` — `getStats()` returns expected shape; resets on `clear()`.

**Doc updates**:
- `pii_state.md` — `_REGEX_CACHE` + `_scanCost` shape.
- `pii_suppressors.md` — tier ordering + cascade contract.
- `pii.md` — new `getStats()` API.

**Estimated LOC**: +60 net (mostly refactor).

**Behavior change**: zero (refactor only). **Per-scan compile time saving**: ~30% on heavy pages.

---

### Phase 3 — STAGE 1 dedicated detectors

**Scope:** add the high-confidence checksum-validated detectors. This is the biggest detection-coverage win.

**Validate-mode default:** `'either'` (checksum OR keyword) for sensitive types — see [`PIPELINE.md`](./PIPELINE.md) §Validate-mode design. Rationale: a mistyped card next to "Card Number:" still blurs via the keyword path; a pasted valid card anywhere blurs via the checksum path; bare 16-digit IDs without either signal don't blur. Per-detector mode overrides documented in PIPELINE.md.

**Separator class:** use `DIGIT_SEP` (space + NBSP + soft-hyphen + hyphen-minus + Unicode dashes) for cards/IBAN/Aadhaar/SSN. Use `PHONE_SEP` (DIGIT_SEP + period + slash) for phones. Definitions in PIPELINE.md §Separator classes.

**Phone shapes:** use the three regexes from PIPELINE.md §Phone regexes — `PHONE_E164` (mode `'checksum'` since `+` is dispositive), `PHONE_NANP` (mode `'either'`), `PHONE_GENERIC` (mode `'keyword'`).

**Card shape:** use `CARD_SHAPE` regex + `classifyPan()` IIN classifier from PIPELINE.md §Card PAN regex. Luhn runs on classifyPan-valid candidates as the checksum half of `mode: 'either'`.

**Detectors added (regex + checksum):**

| Detector | Regex | Validator | File |
|---|---|---|---|
| Card PAN | per-network IIN ranges + `(?:\d[ -]?){11,18}\d` | IIN classify + Luhn | `pii_detectors.js` §cards |
| IBAN | `[A-Z]{2}\d{2}[A-Z0-9]{11,30}` | length table + mod-97 | `pii_detectors.js` §iban |
| ETH wallet | `\b0x[a-fA-F0-9]{40}\b` | length dispositive | `pii_detectors.js` §crypto |
| BTC wallet (bech32) | `\bbc1[ac-hj-np-z02-9]{6,87}\b` | bech32 (BIP-173) | `pii_detectors.js` §crypto |
| BTC wallet (Base58) | `\b[13][a-km-zA-HJ-NP-Z1-9]{25,33}\b` | Base58Check | `pii_detectors.js` §crypto |
| ISBN-13 | `\b97[89][- ]?\d[- ]?\d{3}[- ]?\d{5}[- ]?\d\b` | mod-10 weighted **→ SUPPRESS (anti-PII)** | `pii_detectors.js` §isbn |
| ISBN-10 | `\b\d{9}[\dX]\b` | mod-11 weighted **→ SUPPRESS (anti-PII)** | `pii_detectors.js` §isbn |
| Aadhaar | `\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b` | Verhoeff | `pii_detectors.js` §aadhaar |
| CN ID | full date-encoded regex | ISO 7064 mod-11-2 | `pii_detectors.js` §cn_id |
| Codice Fiscale | 16-alphanumeric positional | check letter | `pii_detectors.js` §codice_fiscale |
| DNI | `\b\d{8}[A-HJ-NP-TV-Z]\b` | letter-mod-23 | `pii_detectors.js` §es_dni |
| NIE | `\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b` | DNI with X/Y/Z mapping | `pii_detectors.js` §es_nie |

**Changes:**

1. **`pii_checksums.js`** — implement `luhn(d)`, `verhoeff(d)`, `mod11(d, weights)`, `mod97(s)`, `iso7064_mod_11_2(d)`, `iso7064_mod_11_10(d)`, `bech32_decode(s)`, `base58check(s)`, `isbn10(d)`, `isbn13(d)`. All pure functions, no DOM/storage, fully tested in isolation.
2. **`pii_detectors.js`** — define detector descriptors (one frozen object per detector). Add `runDetector(text, det, consumed, emitted, country)` helper + `consumed: Array<[start, end)>` + `overlaps(consumed, start, end)` per [`PIPELINE.md`](./PIPELINE.md) implementation sketch.
3. **`pii_detectors.js`** — extend `_findMatches` to run Stage 1 detectors before Stage 3 generic regexes. Each Stage-1 hit `consumed.push([start, end])` and emits if `action === 'emit'`.
4. **`pii_detectors.js`** — add per-detector cheap pre-screen (`preScreen` field on each descriptor) per [`PERF.md`](./PERF.md) M2.
5. **Constants** — add new PII type sub-keys: `cards`, `iban`, `crypto`, `gov_ids` (the 4 government-IDs detectors that don't need country gating). `auto_detect_pii.settings` extends additively. `build_default_model()` returns the new keys with `false` defaults.

**Tests added (~50):**

- `pii_checksums.test.js` — table-driven cases per algorithm. Synthetic test values for each (Luhn: known PANs, ISBN-10: known book codes, Verhoeff: UIDAI documented examples, mod-97: IBAN canonical samples, etc.). ~30 cases.
- `pii_detectors.test.js` — for each new detector: one TP (checksum-valid), one near-miss (checksum-fail, must NOT emit), one overlap test (Stage 1 wins over Stage 3). ~12 detectors × 3 = 36 cases. Folded with `pii_checksums.test.js` to keep counts modest.
- `pii.test.js` — integration: page with mixed real PANs, ISBNs, and order numbers; assert PANs blurred, ISBNs not blurred (anti-PII consume), order numbers not blurred (Tier-A suppressor).

**Doc updates**:
- `pii_checksums.md` — full API.
- `pii_detectors.md` — detector list + descriptor shape + `runDetector` contract.
- `pii.md` — extended type-keys shape.
- `CLAUDE.md` Settings Shape `auto_detect_pii.settings` — new sub-keys.

**Estimated LOC**: +280 in `pii_checksums.js`, +400 in `pii_detectors.js`, +20 in `pii.js`, +10 in `constants.js`.

**Behavior change**: ~40% increase in TP coverage (cards, IBAN, crypto, key gov IDs now detected precisely). Anti-PII suppressors prevent ISBN false blurs.

---

### Phase 4 — STAGE 2 context-gated detectors + page-country signal

**Scope:** add the medium-confidence detectors that need context (keyword window or page-country signal).

**Changes:**

1. **`pii_country.js`** — implement page-country signal capture. Inputs: `document.documentElement.lang`, hostname TLD, `<meta>` tags, currency-symbol density in first 1000 chars of body. Output: ISO 3166 alpha-2 string or `null`. Cached on `pii_state` per scan.
2. **`pii_detectors.js`** — add Stage 2 detectors per [`PIPELINE.md`](./PIPELINE.md) catalog:
   - **Government IDs (gated)**: SSN, ITIN, EIN, NPI, MBI, CURP, Emirates ID (some promoted to Stage 1 if shape is dispositive — see catalog), SIN, TFN, Medicare, ABN, My Number, RRN, CPF, CNPJ, ZA ID, Steuer-ID, INSEE, BSN, Personnummer, AVS, ABHA, IHI.
   - **Healthcare**: NHS, MRN, Member ID, NDC.
   - **Phones**: E.164, NANP, per-country (top 12).
   - **Location**: GPS decimal, GPS DMS, Plus codes, IPv4, IPv6, MAC, postal codes (per country).
   - **Devices**: IMEI, ICCID.
   - **Finance**: SWIFT/BIC, ISIN, CUSIP, SEDOL.
3. **Constants** — add type sub-keys: `health`, `phone`, `location`, `devices`, `finance`. `auto_detect_pii.settings` extends additively.
4. **`pii_detectors.js`** — context-window keyword tables (multilingual per [`INDEX.md`](./INDEX.md)).

**Tests added (~80):**

- `pii_country.test.js` — page-signal extraction from various TLD/lang/meta/currency inputs.
- `pii_detectors.test.js` — for each Stage 2 detector: TP with context, TP with country signal, FP without context (must NOT emit). ~30 detectors × 2.5 avg cases.

**Doc updates**:
- `pii_country.md` — signal-extraction contract.
- `pii_detectors.md` — Stage 2 detector list.
- `pii.md` — extended type-keys shape (full final list).
- `CLAUDE.md` Settings Shape — final `auto_detect_pii.settings` shape.

**Estimated LOC**: +120 in `pii_country.js`, +600 in `pii_detectors.js`.

**Behavior change**: ~30% additional TP coverage. Postal codes, phones, IPs flagged with country awareness.

---

### Phase 5 — Settings expansion + popup UI

**Scope:** expose the new type groups in the popup.

**Changes:**

1. **Popup PII section** — new sub-toggles per type group (cards, iban, crypto, gov_ids, health, phone, location, devices, finance). Render under the existing AUTO_DETECT master toggle. Master `expandKeys` flips all sub-keys atomically.
2. **`popup_state.js`** — `saveSettings(patch)` already routes to `patch_section('auto_detect_pii', ...)` — verify it handles new keys.
3. **i18n** — add `_locales/en/messages.json` strings for each toggle label + description. (Other locales: stub with English and let translation backfill happen post-merge.)
4. **Popup tests** — toggle each sub-key via popup, assert storage write.

**Tests added (~10):**

- `popup_pii.test.js` — sub-toggle render, master `expandKeys` behavior.

**Doc updates**:
- `CLAUDE.md` Settings Shape `auto_detect_pii.settings` — final shape (already done in Phase 4 but cross-check).
- `docs/contracts/popup_popup.md` and `docs/contracts/popup_popup_ui.md` — new sub-section.

**Estimated LOC**: +200 popup HTML/JS, +50 i18n.

**Behavior change**: feature is now user-controllable.

---

### Phase 6 — Performance + observability

**Scope:** apply the perf mitigations from [`PERF.md`](./PERF.md) that aren't already in earlier phases.

**Changes:**

1. **M5 — Stage-4 candidate cap.** `pii_detectors.js` — bail if `candidates.length > 50` per node.
2. **M7 — `requestIdleCallback` chunking** for the initial `scan(document, types)` in `pii.js`. Mutation drains continue to use the engine's existing idle batching.
3. **`pii_state.js`** — full `getStats()` shape: `{ node_count, digit_node_count, stage1_hits, stage2_hits, stage3_hits, stage4_suppressed, total_emit, total_ms_ms_p50, total_ms_p95 }`. Production overhead near-zero.
4. **`tests/perf/pii.test.js`** — perf budget tests (heavy synthetic page; assert `total_ms < 50ms`). Marked with longer timeout; runs in `npm test` but skips by default in `npm run test:unit`.
5. **Backtracking fuzz tests** — table-driven 10 KB pathological inputs across all detector regexes; assert each completes <50 ms.

**Tests added (~15):**

- `pii.test.js` — idle-chunked scan completes within deadline; mutation handler unaffected.
- `tests/perf/pii.test.js` — budget regression tests (5 representative pages × 3 metrics).
- `pii_detectors.test.js` — backtracking fuzz (1 case per regex; ~30 cases).

**Doc updates**:
- `PERF.md` — mark all 7 mitigations as "implemented".
- `pii.md` — `getStats()` final shape.
- `pii_detectors.md` — backtracking-safety code-review checklist (codified).

**Estimated LOC**: +120 net.

**Behavior change**: hits perf budget targets in [`PERF.md`](./PERF.md).

---

## Rolling per-phase doc-update checklist

Same-commit updates for every phase (per top-level `CLAUDE.md` rules):

- [ ] `CLAUDE.md` — Module Globals row(s), Settings Shape if changed, Message Protocol if new types
- [ ] `src/CLAUDE.md` — load order, per-module rules
- [ ] `.claude/rules/code-contracts.md` — file→contract mapping
- [ ] `docs/contracts/pii/<module>.md` — public API
- [ ] `docs/contracts/pii/<module>.tests.md` — describe groups + edge cases + known gaps
- [ ] Memory: `~/.claude/projects/-Users-keshava-13944-blurrysite/memory/MEMORY.md` index entry update at the END of the multi-phase project, not each phase

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase 0 manifest load-order regression | M | H | manual smoke test before merge; revert path is pure |
| Checksum impl bugs (Verhoeff esp.) | M | H | table-driven tests with documented synthetic values; isolated unit tests in `pii_checksums.test.js` |
| Page-country signal misclassifies edge sites | M | M | conservative default = `null`; detectors that need country gracefully no-op when null |
| Perf regression mid-phase (Phase 3 detectors before Phase 6 perf) | M | M | run perf budget on each PR; if any phase exceeds budget, prioritize relevant Phase 6 mitigation early |
| Settings shape change breaks popup | L | H | additive changes only; default `false` for new keys; existing tests cover popup |
| Stage 1 anti-PII (ISBN) accidentally suppresses real card | L | H | overlap tests in `pii_detectors.test.js` enforce Stage 1 ordering: PAN before ISBN by detector priority |
| Locale tokens overflow regex compile size | L | M | benchmark regex compile time after multilingual extension; if >1ms compile, split into per-language sub-regexes |
| Backtracking on adversarial input | L | H | fuzz tests in Phase 6; codified review checklist |

---

## Rollback plan

- Each phase merges as a single squash commit. Rollback = `git revert <sha>`.
- No feature flag needed — additive type-keys default to `false`, so disabled groups produce no behavior change.
- If a phase ships a regression detected post-merge, the next phase's PR can extend the revert; do not roll forward through bugs.
- If Phase 0 (folder migration) regresses load order at runtime, revert and redo with a wider smoke test (Gmail + Amazon + GitHub).

---

## Estimated effort

Rough person-day estimates assuming familiarity with the codebase:

| Phase | LOC delta | Tests added | Effort |
|---|---|---|---|
| 0 — folder migration | ±400 (refactor) | 0 | 0.5 day |
| 1 — Stage 0 + Tier-A suppressors | +215 | ~25 | 1.5 days |
| 2 — cascade + regex cache | +60 | ~10 | 1 day |
| 3 — Stage 1 detectors | +710 | ~50 | 3 days |
| 4 — Stage 2 detectors + country | +720 | ~80 | 4 days |
| 5 — popup + settings | +250 | ~10 | 1.5 days |
| 6 — perf + observability | +120 | ~15 | 1 day |
| **Total** | **+~2400** | **~190** | **~12 days** |

Test count goes from ~70 (pii_detector today) → ~260 (after all phases). Coverage on `src/pii/` should stay >90% line, >85% branch.

---

## Decision gates between phases

Don't auto-advance. Each phase's merge depends on:

- [ ] All tests green (`npm run test:unit` for unit, `npm test` for coverage).
- [ ] Manual smoke test on Gmail + Amazon + GitHub: blur-all toggle works; PII spans behave correctly; no console errors.
- [ ] FP rate measurement on a 5-page sample (curated test pages — keep in `tests/manual/pages/`). Phase 1: expect ~50% remaining-FP drop. Phase 3: expect new TPs on test PANs. Phase 4: expect new TPs on test phones/postal codes.
- [ ] Perf budget check: Phase 1+ should not exceed 50 ms first-scan on the curated heavy page. Phase 6 brings it to 30 ms target.

If any gate fails, fix in the same branch before merging — do not roll forward.

---

## Cross-references

- Architecture: [`PIPELINE.md`](./PIPELINE.md)
- Performance: [`PERF.md`](./PERF.md)
- Index + multilingual tokens: [`INDEX.md`](./INDEX.md)
- Topic research files: [`government-ids.md`](./government-ids.md), [`financial-global.md`](./financial-global.md), [`telecom-devices.md`](./telecom-devices.md), [`healthcare-insurance.md`](./healthcare-insurance.md), [`address-location.md`](./address-location.md), [`false-positives.md`](./false-positives.md)
- Existing contract: [`docs/contracts/pii_detector.md`](../../contracts/pii_detector.md) (becomes `docs/contracts/pii/pii.md` in Phase 0)
- Project rules: [`CLAUDE.md`](../../../CLAUDE.md), [`src/CLAUDE.md`](../../../src/CLAUDE.md), [`.claude/rules/code-contracts.md`](../../../.claude/rules/code-contracts.md)
