# Performance Framework Validation Report

## Overview

This report validates the Blurry Site performance testing framework built in `tests/perf/`. The framework covers two complementary stacks: a Playwright suite (6 spec files measuring user-observable latency) and a CDP suite (3 scenarios measuring internal scripting/rendering breakdown). All source files, test specs, and documentation were read and cross-checked as of 2026-04-17.

**Overall verdict:** The framework is substantially complete and reflects sound engineering. Six of the eight performance-critical module paths are covered. Statistical methodology is correct. Two gaps require attention before CI integration: (1) the `timeline-trace` CDP scenario has an unresolved `renderingMs` field mismatch in the report merger, and (2) the baseline comparison in the HTML report is one-sided for every Playwright spec except the baseline spec itself — no per-spec baseline reference number flows through to the delta column.

---

## Framework Architecture

| Component | Purpose | Status |
|---|---|---|
| `tests/perf/playwright/fixtures/extension.js` | Launches a persistent Chromium context with the extension loaded; exposes `context`, `extId`, `page` fixtures plus `setExtensionStorage`, `getExtensionStorage`, `waitForExtensionInit` helpers | Complete |
| `tests/perf/playwright/tests/00-05` | Six Playwright spec files, each measuring a distinct feature path | Complete |
| `tests/perf/shared/metrics.js` | `collectWebVitals`, `collectHeap`, `summarize`, `deltaPercent` shared helpers | Complete |
| `tests/perf/shared/report-builder.js` | Converts structured JSON results into a self-contained colour-coded HTML report | Complete |
| `tests/perf/cdp/run.js` | Launches Puppeteer Chromium, connects via `chrome-remote-interface`, sequences CDP scenarios, writes `cdp-results.json` | Complete |
| `tests/perf/cdp/scenarios/heap-growth.js` | 5-load heap sampling with monotonic-growth leak detection | Complete |
| `tests/perf/cdp/scenarios/timeline-trace.js` | Tracing-based scripting/layout/style-recalc breakdown during blur-all activation | Complete (one known field mismatch — see Threshold Verification) |
| `tests/perf/cdp/scenarios/layout-thrash.js` | Forced-layout detection with 16 ms jank threshold; exercises blur-all toggle, reveal hover, and picker activation | Complete |
| `tests/perf/scripts/pre-perf.js` | Pre-flight advisory checks (manifest present, sub-package node_modules exist); always exits 0 | Complete |
| `tests/perf/scripts/merge-reports.js` | Reads Playwright `results.json` + per-spec `*-raw.json` files + CDP `cdp-results.json`; writes combined HTML via `report-builder.js` | Partial — baseline lookup in `mergeSpecRawFiles` reads `baselineData` as an array but `baseline-raw.json` is written as `{ url, iterations, samples: [...] }`, so `baselineByUrl` will always be empty and all delta cells will show `—` |

---

## Test Coverage Matrix

| Module / Feature | Scenario Covered | Spec File | Threshold (p95) | Status |
|---|---|---|---|---|
| `blur_engine` — `handleSite` / `handleDocument` | Blur-all activation on 400-paragraph DOM; time from DOM ready to first `[data-bl-si-blur]` | `01-blur-all.spec.js` | < 500 ms | TESTED |
| `blur_engine` — `MutationObserver` (SPA reconcile) | 5 pushState + innerHTML replacement cycles; time from DOM replacement to first `[data-bl-si-blur]` on new content | `04-spa-nav.spec.js` | < 20 ms per nav | TESTED |
| `blur_engine` — `stampElements` toggle cost | CDP timeline-trace triggers blur-all OFF → ON and captures full scripting/layout breakdown | `timeline-trace.js` | scriptingMs < 500, layoutMs < 50 | TESTED |
| `blur_engine` — forced layout detection | CDP layout-thrash exercises blur-all toggle, mouseover on blurred elements, picker activate | `layout-thrash.js` | No forced layout > 16 ms | TESTED |
| `pii_detector` — `scan()` | Explicit `blsi.PiiDetector.scan()` call on a 10 000-word page with 200 emails + 100 numeric patterns; wall-clock via `performance.now()` | `02-pii-scan.spec.js` | < 150 ms | TESTED |
| `pii_detector` — `observeMutations` | NOT TESTED — no spec exercises `observeMutations()` callbacks under sustained DOM insertion | — | — | NOT TESTED |
| `reveal_controller` — hover loop | 20 hover-in/out cycles per iteration (10 iterations = 200 measurements); mousemove-to-`[data-bl-si-reveal]` latency | `05-reveal.spec.js` | < 10 ms reveal, < 150 ms un-reveal | TESTED |
| `picker` — `activate` / `deactivate` | Keyboard shortcut (Alt+Shift+P) to `bl-si-picker-active` class; Escape deactivation | `03-picker.spec.js` | < 50 ms activation | TESTED |
| `picker` — zone draw gesture | mousedown → 15-step drag → mouseup → `bl-si-zone-overlay` appears | `03-picker.spec.js` | < 100 ms | TESTED |
| `auto_blur` — idle detection | NOT TESTED — no spec exercises idle timer, mousemove throttling, or tab-visibility handler | — | — | NOT TESTED |
| `blur_timer` | NOT TESTED — no spec starts or samples the countdown timer | — | — | NOT TESTED |
| `selection_blur` | NOT TESTED — no spec exercises text-selection-driven blur | — | — | NOT TESTED |
| `shortcut_handler` | Tested only implicitly via picker activation shortcut in `03-picker.spec.js`; no dedicated latency measurement | `03-picker.spec.js` | (no dedicated budget) | PARTIAL |
| Cold-start init (storage read → first reconcile) | NOT TESTED as a standalone measurement. `00-baseline.spec.js` measures page load with extension disabled. `01-blur-all.spec.js` measures MutationObserver path, not the init-from-navigation path. No spec times `chrome.storage.local.get` → `_reconcile()` on a real navigation | — | < 300 ms (METHODOLOGY.md) | NOT TESTED |
| JS heap growth across navigations | CDP `heap-growth.js` samples `JSHeapUsedSize` across 5 data: URI loads; flags delta > 5 MB and monotonic growth | `heap-growth.js` | < 5 MB delta | TESTED |

---

## Playwright Scenarios

### 00-baseline.spec.js — Baseline (extension disabled)

- **What it measures:** FCP, LCP, CLS, INP, `JSHeapUsedSize`, `JSHeapTotalSize` with `ENABLED=false` in storage so `content_script` exits before touching the DOM.
- **ITERATIONS:** 10
- **Test page:** Fixed Wikipedia article `https://en.wikipedia.org/wiki/Web_browser` (network-dependent).
- **Threshold:** None — this is the reference floor. Two sanity checks: FCP > 0 and FCP < 3 000 ms. Sample count is asserted to equal 10.
- **Pass condition:** All 10 iterations produce FCP > 0 ms and heap > 0 bytes.
- **Note:** Network dependency introduces variance. The methodology doc recommends localhost-served pages or pre-cached responses; this spec deviates from that guidance.

### 01-blur-all.spec.js — Blur-all activation cost

- **What it measures:** Wall-clock time from `page.setContent()` returning (DOM written) to first `[data-bl-si-blur]` attribute appearing on the page; blurred element count; heap delta.
- **ITERATIONS:** 10
- **Test page:** Programmatically generated: 400 `<p>`, 20 `<h2>`, 30 `<img>` via `page.setContent()`. No network.
- **p95 threshold:** < 500 ms activation latency (hard FAIL in the summary test).
- **Pass condition:** p95 `elapsedMs` < 500 ms across the 10 successful iterations; per-iteration ceiling of 10 000 ms; heap delta < 50 MB per iteration.
- **Note:** Measures the MutationObserver path triggered by `setContent()`, not the navigation-triggered `handleSite()` path. The two are distinct code paths; only the MO path is covered here.

### 02-pii-scan.spec.js — PII scan cost

- **What it measures:** `blsi.PiiDetector.scan(document.body, { EMAIL: true, NUMERIC: 'standard' })` wall-clock duration (sub-ms via `performance.now()`); number of `[data-bl-si-pii]` spans inserted; heap delta.
- **ITERATIONS:** 10
- **Test page:** Deterministic: 10 000 words, 200 email addresses, 100 numeric/phone patterns. Generated once and reused across all iterations.
- **p95 threshold:** < 150 ms (hard FAIL). Absolute per-iteration ceiling: < 5 000 ms.
- **Pass condition:** p95 `durationMs` < 150 ms for successful iterations; at least 1 `[data-bl-si-pii]` span per iteration; heap delta < 20 MB per iteration.
- **Note:** Scan is triggered explicitly via `page.evaluate()`, not through the auto-detect content-script path. This isolates `PiiDetector.scan()` correctly.

### 03-picker.spec.js — Picker activation and zone draw

- **What it measures:** Two metrics per iteration: (1) keyboard shortcut (Alt+Shift+P) to `bl-si-picker-active` class on `<html>`; (2) mousedown → 15-step drag → mouseup → `bl-si-zone-overlay` appearance. Heap delta across the full activate → draw → deactivate cycle.
- **ITERATIONS:** 10
- **Test page:** 100 `<div>` blocks via `page.setContent()`. No network.
- **p95 thresholds:** Activation < 50 ms; zone draw < 100 ms (both hard assertions in summary tests).
- **Pass condition:** p95 activation < 50 ms; p95 zone draw < 100 ms. Per-iteration ceilings: activation < 5 000 ms, draw < 3 000 ms.
- **Note:** Has a fallback path that calls `blsi.Picker.activate()` directly if the keyboard shortcut is not registered. When the fallback fires, the measurement includes a longer wall-clock duration (includes the try/catch overhead) and should be treated as inconclusive for the shortcut path.

### 04-spa-nav.spec.js — SPA navigation reconcile cost

- **What it measures:** Per-navigation MutationObserver reconcile latency: time from `root.innerHTML = html` + `history.pushState()` to first `[data-bl-si-blur]` on the new content. Heap delta across all navigation cycles per iteration.
- **ITERATIONS:** 5 (not 10 — lower due to 5 navigation cycles per iteration = 25 measurements total).
- **NAV_CYCLES:** 5 per iteration.
- **Test page:** 500-div SPA shell + 200-div route fragments via `page.setContent()`. No network.
- **p95 thresholds:** Per-nav reconcile < 20 ms (hard FAIL); heap growth across 5 navs < 2 MB p95 (hard FAIL). Per-iteration ceiling: heap < 5 MB.
- **Pass condition:** Both p95 assertions pass. At least one valid cycle timing per iteration.

### 05-reveal.spec.js — Hover reveal latency

- **What it measures:** Per-hover reveal latency: `page.mouse.move()` dispatch to `[data-bl-si-reveal]` attribute appearing on any element; un-reveal latency: move to neutral → `[data-bl-si-reveal]` removed. Heap delta across all reveal cycles. Maximum simultaneously revealed elements per iteration (correctness check).
- **ITERATIONS:** 10; **REVEAL_CYCLES:** 20 per iteration = up to 200 reveal measurements.
- **Test page:** 50 `<p>` elements styled with `filter: blur(8px)` via `page.setContent()`. No network.
- **p95 thresholds:** Reveal < 10 ms; mean reveal < 5 ms; un-reveal p95 < 150 ms (all hard assertions).
- **Pass condition:** All three latency assertions pass; maximum simultaneously revealed elements ≤ 1 per iteration.
- **Note:** The spec has a fallback that manually stamps `[data-bl-si-blur]` attributes when the blur engine does not stamp elements automatically. When the fallback fires, the reveal measurement is valid but the blur-engine path is not exercised — the spec should note whether the fallback fired in the iteration log.

---

## CDP Scenarios

### heap-growth.js

- **What it measures:** `JSHeapUsedSize` sampled via `Performance.getMetrics()` after each of 5 page loads (data: URI, no network). Reports `deltaFromFirst` per load, `maxDeltaMB`, and an `isMonotonicallyGrowing` flag.
- **Test page:** 500-paragraph + 100-div page with embedded emails, phone numbers, and financial figures (exercises PII detector on each load). Loaded as a `data:text/html;base64,...` URI.
- **Pass condition:** `heapDeltaBytes` (last − first) < 5 MB (5 242 880 bytes). `isMonotonicallyGrowing` is logged as a warning but does not independently affect the pass flag.
- **Note:** `enableBlurAll()` runs in the page context and relies on `chrome.storage` being accessible from that context. For `data:` URI pages the extension content script is injected (MV3 matches `<all_urls>`), but the storage write via `Runtime.evaluate` in the page context may silently fail if the extension API is not bridged. The function catches the error non-fatally, which means blur-all may not be active during heap sampling.

### timeline-trace.js

- **What it measures:** A Chrome tracing session capturing `devtools.timeline`, `v8.execute`, `blink.user_timing`, `loading`, and `devtools.timeline.stack` categories during a blur-all activation on a 500-element page. Sums duration of scripting events (`FunctionCall`, `EvaluateScript`, `EventDispatch`, `RunMicrotasks`, etc.) and layout/rendering events (`Layout`, `UpdateLayerTree`, `CompositeLayers`, `RecalcStyle`, `UpdateLayoutTree`). Reports long tasks (> 50 ms).
- **Pass condition:** `scriptingMs` < 500 ms AND `layoutMs` < 50 ms.
- **Note:** The scenario computes and returns `layoutMs` (not `renderingMs`). The `merge-reports.js` normaliser references `result.renderingMs`, which does not exist in the returned object — this field will always display as `—` in the HTML report. The correct field name is `layoutMs`. This is a bug in `merge-reports.js` line 289.

### layout-thrash.js

- **What it measures:** Forced synchronous layouts (JS-initiated layouts with a stack trace in `beginData`) during an 8-second trace window that exercises: (a) blur-all toggle OFF → ON, (b) 20 `Input.dispatchMouseEvent` mousemove events over blurred elements, (c) picker activate/deactivate with 50 forced `getBoundingClientRect` reads.
- **Pass condition:** Zero forced Layout events exceeding 16 ms (one frame at 60 fps).
- **Note:** The scenario correctly distinguishes forced layouts (JS stack present in `beginData`) from renderer-initiated layouts. Stack traces require `devtools.timeline.stack` in the trace categories, which this scenario includes.

---

## Threshold Verification

| Scenario | Metric | METHODOLOGY.md Budget | Spec Assertion | Match? |
|---|---|---|---|---|
| Blur-all toggle on 10 000-element DOM | `blur-all-latency` p95 | < 500 ms (FAIL) | `01-blur-all.spec.js`: `expect(summary.p95).toBeLessThan(500)` | Yes — but spec DOM is ~2 000 elements (400 paragraphs + 20 headings + 30 images), not 10 000 |
| PII scan on 10 000-word page | `pii-scan-duration` p95 | < 150 ms (FAIL) | `02-pii-scan.spec.js`: `expect(durationSummary.p95).toBeLessThan(150)` | Yes |
| PII scan on 50 000-word page | `pii-scan-duration` p95 | < 400 ms (WARNING) | No spec — not tested | MISSING |
| Picker activation | `activate()` wall clock p95 | < 50 ms (WARNING) | `03-picker.spec.js`: `expect(summary.p95).toBeLessThan(50)` | Yes (severity upgraded: spec treats as hard FAIL, not WARNING) |
| Hover reveal per event | `reveal-latency` p95 | < 10 ms (FAIL) | `05-reveal.spec.js`: `expect(revealSummary.p95).toBeLessThan(10)` | Yes |
| SPA navigation URL resolve + reconcile | < 20 ms (WARNING) | `04-spa-nav.spec.js`: `expect(timingSummary.p95).toBeLessThan(20)` | Yes (severity upgraded: spec treats as hard FAIL) |
| Context menu blur | < 100 ms (WARNING) | No spec | MISSING |
| Heap growth over 10 navigations | cumulative delta < 5 MB (WARNING) | CDP `heap-growth.js`: `heapDeltaBytes < LEAK_THRESHOLD_BYTES` (5 MB) | Yes — but only 5 loads, not 10 |
| MutationObserver callback per batch | < 2 ms (FAIL) | No dedicated spec — `04-spa-nav.spec.js` measures end-to-end nav latency not per-callback cost | PARTIAL |
| Cold-start init | < 300 ms (WARNING) | No spec | MISSING |
| Timeline scripting budget | scriptingMs < 500 ms | `timeline-trace.js`: `pass = scriptingMs < 500` | Yes |
| Timeline layout budget | layoutMs < 50 ms | `timeline-trace.js`: `pass = layoutMs < 50` | Yes — but `merge-reports.js` references wrong field name `renderingMs` (bug) |
| Zone draw latency | < 100 ms | `03-picker.spec.js`: `expect(summary.p95).toBeLessThan(100)` | Added in spec, not in METHODOLOGY.md | Extra — not documented in METHODOLOGY.md |
| Mean reveal latency | < 5 ms | `05-reveal.spec.js`: `expect(summary.mean).toBeLessThan(5)` | Added in spec, not in METHODOLOGY.md | Extra — not documented in METHODOLOGY.md |

---

## Statistical Methodology

### Iteration Count

- All Playwright specs declare `ITERATIONS = 10` as a named constant at file top, consistent with METHODOLOGY.md's minimum of 10.
- Exception: `04-spa-nav.spec.js` uses `ITERATIONS = 5` with `NAV_CYCLES = 5`, yielding 25 per-nav timing samples total. This is below the per-feature minimum of 10 specified in METHODOLOGY.md. Rationale is stated inline (test would exceed 30 s otherwise), but the lower count reduces statistical confidence for the 20 ms budget.
- `05-reveal.spec.js` uses `ITERATIONS = 10` with `REVEAL_CYCLES = 20`, yielding up to 200 reveal measurements — the most statistically robust spec in the suite.

### p95 Computation

- `summarize()` in `shared/metrics.js` uses the nearest-rank method: `sorted[Math.ceil(0.95 * n) - 1]`. For N=10 this yields index 9, i.e. the worst sample. This is the maximum of the 10 samples rather than a true 95th percentile. With N=10 this is expected and acceptable, but it means a single outlier (GC pause, slow CI machine) can fail the suite without representing a real regression. METHODOLOGY.md acknowledges this tradeoff.
- The METHODOLOGY.md pseudocode uses `Math.floor(0.95 * n)` whereas `metrics.js` uses `Math.ceil(0.95 * n) - 1`. For N=10: `Math.floor(9.5) = 9` and `Math.ceil(9.5) - 1 = 9`. Both yield index 9. They agree for N=10. For other N values they may differ by 1 position — not a current problem but worth noting for future expansion.

### Warm-up Runs

- METHODOLOGY.md requires one full dry-run warmup before the measurement window. The Playwright specs do NOT include an explicit warmup iteration: each iteration navigates to `about:blank` then calls `page.setContent()` on a fresh page context. The fresh context per test (scope: 'test') means V8 JIT is cold for the first iteration of every spec. There is no discarded first run. This is a gap from the documented methodology.
- The CDP scenarios do include a 1 500 ms settle period after each page load, which partially compensates for JIT cold-start but does not discard the first measurement.

### Isolation

- Playwright: `workers: 1` is enforced in `playwright.config.js`. Each test gets a fresh `BrowserContext` (fresh user data dir, no storage bleed) — correct.
- CDP: each scenario runs in its own tab via `openTab()`. Chrome process is shared across scenarios. Storage is not reset between CDP scenarios, so `enableBlurAll()` state from `heap-growth.js` may persist into `timeline-trace.js`. This is a potential isolation gap.
- Test pages use `page.setContent()` or `data:` URIs rather than real URLs — correct per methodology for eliminating network jitter. Exception: `00-baseline.spec.js` uses a live Wikipedia URL, introducing network variance.

---

## Known Gaps and Risks

- **Cold-start init not measured [High]:** The most user-visible latency in the extension is the `chrome.storage.local.get` IPC round-trip followed by first `_reconcile()` on navigation. No spec times this path. METHODOLOGY.md documents it as a WARNING-severity budget (< 300 ms) but no corresponding spec exists.

- **PII 50 000-word scenario missing [Medium]:** METHODOLOGY.md documents a WARNING threshold of < 400 ms for a 50 000-word scan. The spec only covers 10 000 words. Wikipedia-scale pages will not be caught by the current suite.

- **`pii_detector.observeMutations` not tested [Medium]:** The mutation-driven re-scan path is not exercised. On interactive sites (social feeds, SPAs) this is the dominant PII detector cost. A test page with simulated DOM insertion would be needed.

- **Context menu blur not tested [Medium]:** METHODOLOGY.md documents a < 100 ms WARNING threshold for context menu blur. No CDP or Playwright spec covers the `CONTEXT_BLUR` message path.

- **`auto_blur` idle detection not tested [Medium]:** `blsi.AutoBlur` attaches throttled mousemove/keydown/scroll listeners and monitors tab visibility. Sustained listener cost and correctness under idle/active transitions are not measured. EXTENSION_PROFILE.md rates this as MEDIUM perf tier.

- **`blur_timer` not tested [Low]:** A trivial `setTimeout`-based module. Low risk but excluded from coverage.

- **`selection_blur` not tested [Low]:** Text-selection-driven blur uses TreeWalker + splitText, same pattern as PII detector. Not measured.

- **Warmup omission [Medium]:** V8 JIT warm-up is not performed before the first measurement iteration in any Playwright spec. First-iteration timings will be systematically higher due to cold JIT, and p95 (= worst sample for N=10) will capture this. This inflates reported p95 values and may produce spurious FAIL results on fast code.

- **Baseline comparison broken in HTML report [Medium]:** `mergeSpecRawFiles` in `merge-reports.js` expects `baseline-raw.json` to be a flat array of entries, but `00-baseline.spec.js` writes `{ url, iterations, samples: [...] }`. `baselineByUrl` will always be empty, all delta columns will show `—`, and the report's core comparison feature does not function.

- **`enableBlurAll()` in CDP heap-growth silently fails for data: URIs [Low]:** The function uses `chrome.storage` from the page context, which may not be available. The scenario proceeds regardless, so heap measurements may not reflect extension-active behaviour.

- **`timeline-trace.js` returns `layoutMs`, merger expects `renderingMs` [Low]:** The HTML report will not display the layout cost from the timeline-trace scenario. Functional mismatch confirmed by reading both files.

- **SPA nav uses 5 iterations [Low]:** Below METHODOLOGY.md's stated minimum of 10 per feature. p95 on 25 samples (5 iters × 5 cycles) is more stable than N=5 alone, but the per-feature confidence is reduced.

- **`shortcut_handler` has no dedicated latency measurement [Low]:** The handler is exercised implicitly in `03-picker.spec.js` but the latency budget in EXTENSION_PROFILE.md (LOW perf tier) is not directly verified. Acceptable given the handler's simplicity (single O(actions) scan).

---

## Recommendations

1. **Add a cold-start init spec (High priority).** Create `06-cold-start.spec.js` that performs a real `page.goto()` to a localhost-served page with blur-all active and times from navigation start to first `_reconcile()` completion via a `performance.mark` in `content_script.js`. This covers the highest-impact user-visible latency path not currently measured.

2. **Fix the baseline comparison in `merge-reports.js` (High priority before CI).** Change the `baselineByUrl` builder to read `baselineData.samples` (the actual array) rather than treating the object root as an array. Without this fix the HTML report's delta column is universally blank.

3. **Fix the `timeline-trace` field name in `merge-reports.js` (Medium priority).** Line 289 references `result.renderingMs` — change to `result.layoutMs` to match what `timeline-trace.js` returns.

4. **Add one warmup iteration per Playwright spec (Medium priority).** Before the measurement loop, add one un-timed iteration that navigates and triggers the feature under test. This brings V8 JIT to steady state and prevents the first measured iteration from being systematically slower. The simplest approach is to prepend a `test.beforeAll` that performs one full dry run.

5. **Add `02b-pii-scan-50k.spec.js` for the 50 000-word scenario (Medium priority).** Clone `02-pii-scan.spec.js` with `targetWords: 50_000` and adjust the p95 threshold to 400 ms. This closes the METHODOLOGY.md documentation gap.

6. **Add an `observeMutations` stress test for PII detector (Medium priority).** Create a spec that enables `blsi.PiiDetector.observeMutations(document.body)` then rapidly appends 100 paragraphs via `page.evaluate()` and measures how long the MO callback takes to process each batch. A < 2 ms per-batch budget (matching METHODOLOGY.md's MutationObserver threshold) is appropriate.

7. **Reset storage between CDP scenarios in `run.js` (Low priority).** Add a `Runtime.evaluate` call between scenarios that clears `chrome.storage.local` to prevent state bleed from `heap-growth` into `timeline-trace`.

8. **Increase SPA nav to ITERATIONS=10 or document the deviation (Low priority).** Either run 10 iterations (accepting the longer runtime) or add an explicit comment in the spec and in METHODOLOGY.md documenting the reduced count and its statistical implication.

9. **Switch `00-baseline.spec.js` to a localhost-served page (Low priority).** The methodology requires network-independent pages for stable measurements. The current Wikipedia URL adds DNS, TLS, and content delivery variance. Use a local HTTP server or a `data:` URI baseline page to comply with the methodology.

10. **Add `auto_blur` and `context menu blur` coverage in Phase 2.** `auto_blur` requires a mechanism to simulate user idle (no input events for N seconds), which may need a custom Playwright helper. Context menu blur requires CDP Input domain events. Both are feasible and address METHODOLOGY.md-documented budget entries.

---

## Verdict

The framework is not yet ready for blocking CI integration in its current state, but it is close. The core measurement infrastructure (fixtures, metric helpers, statistical summary, report builder) is sound and follows the methodology correctly. Six of nine critical performance paths have working specs with hard `expect()` assertions that will fail the CI job on budget violations.

Two bugs must be fixed before the HTML report provides useful signal: the `baselineByUrl` parser reading the wrong JSON shape causes all delta columns to be blank, and the `renderingMs` / `layoutMs` field mismatch causes the timeline-trace layout cost to be invisible in the report. Neither bug prevents the Playwright tests from asserting pass/fail correctly — they only affect the visual report.

Once those two bugs are fixed and a warmup iteration is added to each spec, the framework can be integrated into CI with confidence for the six covered paths. The cold-start init path (the highest-impact user-visible latency) should be added as the first Phase 2 spec before the framework is considered complete.
