# Numeric PII Detection — Performance

> Cost model, mitigations, and budgets for the pipeline in [`PIPELINE.md`](./PIPELINE.md). Read PIPELINE first for architecture; this file is the perf side of the same design.

The risk: a 5-stage cascade with ~30 active detectors can blow the frame budget on heavy pages (Amazon, GitHub diffs, financial dashboards). The mitigations below take a naive ~120 ms first-scan cost down to ~15–25 ms without changing detection accuracy.

---

## Cost model

For a "heavy" page (Amazon product page, GitHub PR with large diff, BBC homepage):

```
Reference page profile:
  text nodes              ≈ 1000–2000
  total text content      ≈ 30–80 KB
  digit-bearing nodes     ≈ 30–40% of nodes
  unique digit patterns   ≈ 100–500 (prices, ratings, IDs, dimensions, dates)
```

### Naive cost (no mitigations)

| Stage | Per-node cost | Per-node ops | Total at 1500 nodes |
|---|---|---|---|
| 0 (pre-filter) | 5 µs | ≤5 `closest()` calls | 7.5 ms |
| 1 (high-confidence detectors × 12, regex + checksum) | 10 µs | 12 regex.exec sweeps + checksum on ~1 hit | 15 ms |
| 2 (context-gated detectors × 20) | 20 µs | 20 regex.exec sweeps + keyword tests + checksum on ~2 hits | 30 ms |
| 3 (generic regexes × 5) | 5 µs | 5 regex.exec sweeps | 7.5 ms |
| 4 (FP cascade per candidate) | 8 µs avg | 14 cascade checks (short-circuit) | 80 ms (10k candidates) |
| **Total first scan** | | | **≈ 140 ms** |

### Where it actually goes

- **Stage 4 dominates** (≈ 60% of total). Reason: most Stage-3 candidates run the full cascade. Each `isOrderRef`/`isPublicPrice`/`isCountNoise` does a regex test against a 100–150-char window. Amazon has hundreds of order/price/count strings per page.
- **Stage 1+2 detector setup is cheap-per-detector but multiplied** by 30+ active detectors. Each `new RegExp(...)` call costs ~20 µs of compile overhead in V8.
- **Stage 0 walks are fast individually** but every text node pays the cost.
- **Mutation handling**: ≤100 nodes per batch (idle-scheduled), so per-batch cost stays under 15 ms even with the naive model.

### Checksums — net cost is negative

Counterintuitively, **adding checksums to the pipeline reduces total scan cost** because Luhn-fail candidates short-circuit out before reaching the Stage 4 cascade.

Per-call cost in V8:

| Algorithm | Per-call | Where used |
|---|---|---|
| Luhn (mod-10) | ~0.5–1 µs | Card PAN, IMEI, ICCID, NPI, SIN, ZA ID, Emirates ID, Personnummer |
| Verhoeff | ~3 µs | Aadhaar, ABHA |
| Mod-11 (variants) | ~1 µs | NHS, BSN, RRN; CPF/CNPJ run mod-11 twice |
| Mod-97 (string-chunked) | ~5–10 µs | IBAN |
| ISO 7064 mod-11-2 / mod-11-10 | ~2 µs | CN ID, DE Steuer-ID |
| Letter-table check | ~1 µs | Codice Fiscale, DNI/NIE, NRIC SG |
| bech32 (BIP-173) | ~10–20 µs | BTC SegWit |
| Base58Check (2× SHA-256, pure JS) | ~100–200 µs | BTC P2PKH/P2SH |
| mod-89 | ~1 µs | AU ABN |

Calls per scan on a heavy page (after M1+M2 pre-screens):

```
Luhn-validated detectors    ~80–120 calls   → ~120 µs
Verhoeff (Aadhaar)          ~1–5 calls      → ~15 µs
Mod-11 family               ~20–40 calls    → ~30 µs
Mod-97 (IBAN)               ~5–15 calls     → ~80 µs
Letter-tables               ~10–30 calls    → ~25 µs
ISO 7064 variants           ~5–10 calls     → ~15 µs
bech32                      ~1–3 calls      → ~45 µs
Base58Check                 ~1–3 calls      → ~300 µs   ← biggest single hit
                            ──────────────────────────
                            total per scan  ≈ 0.6 ms
```

That's ~2% of the 30 ms first-scan budget.

**The savings**: without checksums, every shape-matched candidate falls through to Stage 4. ~80 candidates × 80 µs cascade = **~6 ms** in Stage 4 work for card-shape false positives. With Luhn, ~80% short-circuit in 1 µs and never reach Stage 4 — saved ~5 ms.

**Net effect**: checksums cost +0.6 ms but save −5 ms in Stage 4. Pipeline is ~4 ms faster *with* checksums than without. The earlier framing of checksums as "expensive" was wrong; they're cheaper than running the full cascade on shape-only candidates.

**One exception**: Base58Check (BTC P2PKH/P2SH) calls SHA-256 twice in pure JS. ~100–200 µs per call. If BTC detection is niche, this single algorithm can be made keyword-only (`'keyword'` mode) without affecting the others.

### Garbage collection

Allocations per scan in the naive design:
- `consumed` array: ~50 entries × `[number, number]` = 100 numbers per node
- `emitted` array: ~10 entries × `{start, end, type}` = 30 props per node
- Compiled regex instances: 30+ × 30 µs = 900 µs of compile time per node (since each detector recompiles every call)

Cumulatively this triggers 1–3 minor GCs per scan on heavy pages. The compile-cache mitigation below eliminates most of it.

---

## Mitigations (priority order)

### M1. Whole-node digit pre-screen (highest impact)

Most text nodes on consumer pages have no digits at all (titles, link text, headings, button labels, navigation, prose paragraphs). One fast `/\d/.test(text)` rules them out before any pipeline stage runs.

```js
function _findMatches(text, types, node) {
  if (_isExtensionUI(node) || _isInsidePiiSpan(node)) return [];
  if (_isInsideCodeBlock(node)) return [];
  if (!text || !text.trim()) return [];

  // M1 — whole-node digit pre-screen
  if (!_HAS_DIGIT.test(text)) {
    // Email is the only Stage-1 detector that doesn't need a digit;
    // run it independently if enabled.
    return types.email ? _emailOnly(text) : [];
  }
  // ... rest of pipeline
}

const _HAS_DIGIT = /\d/;
```

Hit rate on real pages: 60–80% of nodes pass through this gate. Expected per-scan saving: **~70 ms**.

### M2. Per-detector cheap pre-screen

Every Stage-1 / Stage-2 detector has a minimum-shape requirement that's far cheaper to test than the full regex + checksum:

```js
const CARD_DETECTOR = Object.freeze({
  type: 'card',
  preScreen: /\d{12}/,                  // 12+ consecutive digits
  regex: /(?<![A-Za-z\d])(?:\d[ -]?){11,18}\d(?![A-Za-z\d])/g,
  validate(matchText, text, idx) { /* IIN + Luhn */ },
});

const IBAN_DETECTOR = Object.freeze({
  type: 'iban',
  preScreen: /[A-Z]{2}\d{2}/,           // country prefix shape
  regex: /(?<![A-Z\d])[A-Z]{2}\d{2}[A-Z0-9]{11,30}(?![A-Z\d])/g,
  validate(matchText) { /* mod-97 */ },
});

const ETH_DETECTOR = Object.freeze({
  type: 'crypto_eth',
  preScreen: /0x[a-fA-F0-9]{6,}/,       // 0x prefix + ≥6 hex
  regex: /\b0x[a-fA-F0-9]{40}\b/g,
  validate() { return true; },          // length is dispositive
});

const AADHAAR_DETECTOR = Object.freeze({
  type: 'aadhaar',
  preScreen: /[2-9]\d{11}/,             // 12 digits starting [2-9]
  regex: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
  validate(d) { /* Verhoeff */ },
});

function runDetector(text, det, consumed, emitted, country) {
  // M2 — fast pre-screen before main regex
  if (det.preScreen && !det.preScreen.test(text)) return;
  // ... runDetector body unchanged
}
```

Each pre-screen is one O(n) scan with a tiny NFA. Per-detector hit rate is typically 1–5% of nodes that passed M1. Expected saving: **~25 ms**.

### M3. Compiled regex cache

The current `_findMatches` does `new RegExp(re.source, re.flags)` per call to reset `lastIndex`. Two cheaper options:

**Option A (preferred)** — cache compiled instances, reset `lastIndex` manually:

```js
// At module load — compile each regex exactly once.
const _DETECTOR_REGEX = new Map();
for (const det of ALL_DETECTORS) {
  _DETECTOR_REGEX.set(det.type, det.regex);   // already a RegExp; just keep ref
}

function runDetector(text, det, consumed, emitted, country) {
  if (det.preScreen && !det.preScreen.test(text)) return;
  const re = det.regex;
  re.lastIndex = 0;                            // reset state, no recompile
  let m;
  while ((m = re.exec(text)) !== null) { /* ... */ }
}
```

`exec` against a `/g` regex advances `lastIndex` until null; a manual `re.lastIndex = 0` at the top brings it back. No `new RegExp(...)` call.

**Option B** — use `String.prototype.matchAll(regex)`. This works on a global regex and *should* not leak state (per spec, `matchAll` clones internally), but engine implementation cost varies. Profile both.

Saving: **~10–20 ms** (mostly avoiding regex-compile thrash and the GC pressure from discarded RegExp instances).

### M4. Type-gate at the top

If a user enables only `numeric`, skip every Stage-1 and Stage-2 detector for groups they didn't opt into. Already in the pipeline design (`if (types.cards) runDetector(...)`), but worth restating:

```js
// M4 — early-exit empty-types call
const anyNumericFlag =
  types.email || types.numeric || types.cards || types.iban ||
  types.crypto_eth || types.crypto_btc || types.gov_ids ||
  types.health || types.phone || types.location ||
  types.devices || types.finance;
if (!anyNumericFlag) return [];
```

Most users will enable a subset. Default state today is `email + numeric` only — that means 0 Stage-1/2 detectors run, and total cost collapses to Stage-0/3/4 ≈ 30 ms.

### M5. Stage-4 candidate cap

A node yielding >50 Stage-3 candidates is almost certainly tabular data (CSV export, log dump, financial statement) — not user-targeted PII. Bail out:

```js
const STAGE_4_CANDIDATE_CAP = 50;

if (candidates.length > STAGE_4_CANDIDATE_CAP) {
  // Treat the whole node as opt-in territory; don't blur unless the user
  // explicitly enabled high-volume mode.
  return [];
}
```

Saves the worst-case Amazon "see all 4,567 reviews" pages and dev tools that dump JSON.

### M6. Page-country signal cache

Already in PIPELINE design — capture once at top of `scan()`. Make sure SPAs invalidate via `applyState()` when `<html lang>` or URL changes meaningfully. Cost saved per detector: ~5 µs × 30 detectors × 1500 nodes = **~225 ms (sic) on naive recompute**. Don't recompute per node.

### M7. Idle scheduling for the initial scan

`scan(rootEl)` on `document` at page load is the heaviest call. The current engine runs it synchronously. Switch to `requestIdleCallback` chunking:

```js
function scan(rootEl, types) {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  // M7 — chunk by deadline
  let i = 0;
  function processChunk(deadline) {
    while (i < nodes.length && deadline.timeRemaining() > 1) {
      _processOneNode(nodes[i++], types);
    }
    if (i < nodes.length) requestIdleCallback(processChunk, { timeout: 100 });
  }
  requestIdleCallback(processChunk, { timeout: 100 });
}
```

Total cost is the same; perceived latency drops to zero because the work spreads across idle frames. No effect on heavy mutation drains, which already idle-batch via the engine's observer.

### M8. Avoid double-walk on `handleMutations`

For `childList` mutations adding ELEMENT_NODEs, the current `handleMutations` calls `scan(node)` recursively. If the added subtree is large (e.g. an Amazon product card with 50+ child nodes), this re-walks all of them. Mitigation: subtree threshold — for tiny subtrees (≤5 text nodes) inline the work; for large subtrees defer to the next idle drain.

---

## Per-stage budget targets

After M1–M7 applied, target budgets per scan on a heavy page:

| Stage | Budget | Notes |
|---|---|---|
| Stage 0 | ≤ 3 ms | Pre-filter walk; capped by node count |
| Stage 1 | ≤ 5 ms | Pre-screens cull most nodes |
| Stage 2 | ≤ 8 ms | Per-country gating cuts further |
| Stage 3 | ≤ 4 ms | 5 regexes, all cached |
| Stage 4 | ≤ 10 ms | Cascade short-circuits |
| Page-country signal | ≤ 1 ms | One-time per scan |
| **Total first scan** | **≤ 30 ms** | |
| Mutation drain (≤ 100 nodes) | ≤ 5 ms | Idle-batched |
| Mutation drain (large subtree) | deferred | Splits across frames |

These match what the popup status card promises ("instant blur on page load"). If a real page exceeds budget, profile and either tighten pre-screens or defer detectors to a lazy second-pass.

---

## Backtracking risk audit

Catastrophic backtracking happens when a regex has nested quantifiers and adversarial input. The proposed regex set:

| Regex | Pattern | Risk | Mitigation |
|---|---|---|---|
| `[\d,.' ]*` (current numeric) | unbounded char class | LOW (no nested quant) | none needed |
| `(?:\d[ -]?){11,18}\d` (CARD_PAN) | bounded quant `{11,18}` | LOW | bounded |
| `[A-Z0-9]{11,30}` (IBAN body) | bounded | LOW | bounded |
| `(?:[A-Za-z0-9]{1,4}\.){2}` (DOI-ish) | nested | MEDIUM | not currently in catalog |
| `[\s-]\d{3,}+` (PHONE_SHAPE variants) | possessive needed if extended | LOW today | possessive `+` forms safer if regex grows |
| `[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+` (email) | unbounded around `@` | LOW (one `@` anchor) | already deployed |

**Rule**: forbid nested quantifiers across the catalog. Code-review checklist for new detectors:

```
[ ] No `(X+)+`, `(X*)*`, `(X{n,})+` shapes
[ ] All `*` and `+` operate on disjoint char classes
[ ] Lookarounds use only fixed-width assertions where possible
[ ] Bounded `{n,m}` preferred over open `+`/`*`
```

**Fuzz test** on commit: feed each detector regex with 10k-char synthetic strings (all-digits, all-spaces, repeated `-`, repeated `,`, mixed). Time-bound assertion: any single regex must complete in <50 ms on a 10 KB input. Run as part of `npm run test:unit`.

---

## Observability

Add lightweight perf marks in development builds (gated by `blsi.Logger.enabled`):

```js
function _processOneNode(node, types) {
  if (!Logger.enabled) return _processOneNodeFast(node, types);
  // dev path
  performance.mark('pii-node-start');
  _processOneNodeFast(node, types);
  performance.mark('pii-node-end');
  performance.measure('pii-node', 'pii-node-start', 'pii-node-end');
}
```

Devs can then `performance.getEntriesByName('pii-node').reduce((s, e) => s + e.duration, 0)` to read total scan cost.

For production: a simple counter `_scanCost = { node_count, total_ms, candidate_count }` exposed via `blsi.PiiDetector.getStats()`. Surfaces hot spots without per-node overhead.

---

## Real-page reference numbers (target)

Hand-measured budgets for representative pages, after M1–M7:

| Page type | Nodes | Digit-bearing | Stage-3 candidates | Target first-scan | Naive |
|---|---|---|---|---|---|
| Search results page (Google) | 600 | 200 | 400 | 12 ms | 60 ms |
| Amazon product page | 2000 | 600 | 1500 | 25 ms | 140 ms |
| GitHub PR (large diff) | 5000 | 1500 | 2000 | 35 ms | 220 ms |
| News article | 400 | 100 | 150 | 8 ms | 35 ms |
| Banking dashboard | 800 | 500 | 800 | 18 ms | 90 ms |
| Wikipedia article | 1500 | 300 | 600 | 15 ms | 75 ms |

All target measurements assume:
- M1 pre-screen drops 60% of nodes
- M2 detector pre-screens drop 90% of remaining per detector
- M3 cache eliminates compile thrash
- M4 limits to user-enabled types (assume 3 types: email + numeric + cards)
- M7 spreads work across idle frames (so user perceives ~0 ms)

---

## When to optimize further

Don't pre-optimize. Land Phase 1 (Stage 0 + Tier-A suppressors) and measure on real pages. Triggers for further work:

- First-scan cost on a 50%-quantile page > 50 ms
- Per-mutation drain > 10 ms regularly
- A specific page type (e.g. spreadsheet view) consistently hits the candidate cap

Common follow-on optimizations:
- **Worker offload** — move Stage 1/2 regex+checksum work to a `Worker`. Cost: serialize `text` per node. Worth it only if scan cost > 100 ms.
- **WASM regex** — `re2` via WASM avoids backtracking. Cost: ~80 KB binary. Overkill for the current catalog.
- **Streaming TreeWalker** — process text nodes as they arrive (during DOM construction) rather than waiting for `document_idle`. Requires content-script re-architecture.

---

## Migration impact

The current `pii_detector.js` is a 5-regex flat detector with 4 suppressors. After this perf work + the PIPELINE redesign:

| Metric | Today | After PIPELINE only | After PIPELINE + PERF (M1–M7) |
|---|---|---|---|
| Active detectors | 5 + 4 suppressors | 30 + 14 suppressors | 30 + 14 suppressors |
| Avg first-scan, heavy page | ~25 ms (incomplete coverage) | ~140 ms | ~25 ms |
| Coverage (TP rate) | ~30% | ~90% | ~90% |
| FP rate | ~70% remaining | ~20% remaining | ~20% remaining |

Net: ~3× detection coverage, ~3.5× FP reduction, *same* perf budget — provided the perf mitigations land alongside the detector expansion, not after.

---

## Cross-references

- Architecture: [`PIPELINE.md`](./PIPELINE.md)
- FP suppressors source: [`false-positives.md`](./false-positives.md)
- Index: [`INDEX.md`](./INDEX.md)
- Existing detector contract: [`docs/contracts/pii_detector.md`](../../contracts/pii_detector.md)
- Engine observer (mutation drain mechanics): [`docs/contracts/core/observer.md`](../../contracts/core/observer.md)
