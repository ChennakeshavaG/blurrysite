# Blurry Site — Performance Testing Methodology

## 1. Testing Philosophy

Every performance measurement begins with a baseline run: the same test page loaded with the extension disabled (or unpacked but not active on the target origin). Without a baseline you cannot distinguish extension overhead from page variance. The baseline captures the page's native web-vitals (FCP, LCP, CLS), heap size, and script duration. Extension-enabled runs are then measured under identical conditions and reported as absolute values plus percent delta from the baseline. A result that shows zero delta is as important to verify as one that shows a regression — it may indicate the feature is being silently gated or lazy-loaded.

Statistical rigor is required because browser timing is noisy. A single measurement of `blur-all-latency` is useless: GC pauses, JIT cold starts, and OS scheduling can inflate any individual sample by 50 ms or more. The framework requires a minimum of 10 iterations per scenario. From those 10 samples you report the mean and the 95th percentile (p95). The p95 captures worst-case user experience without being thrown off by a single catastrophic outlier. Never report the minimum — it does not represent a real user.

Test isolation is non-negotiable. Run one browser instance per test session. Pre-warm the test page with one dry-run iteration before the measurement window to bring V8 JIT and browser layout into a steady state. Use localhost-served test pages or pre-cached pages to eliminate network jitter. Fix the iteration count in a named constant (`ITERATIONS = 10`) at the top of every spec file so the number is visible and auditable. Set Playwright `workers: 1` to prevent CPU contention between concurrent test suites.

---

## 2. Metric Definitions

| Metric | Unit | Source | Description |
|---|---|---|---|
| FCP (First Contentful Paint) | ms | `PerformanceObserver` (`paint` entry type) | Time from navigation start to first pixel of text or image rendered in the viewport |
| LCP (Largest Contentful Paint) | ms | `PerformanceObserver` (`largest-contentful-paint`) | Time to the largest visible element (image or text block) becoming rendered |
| CLS (Cumulative Layout Shift) | score | `PerformanceObserver` (`layout-shift`) | Sum of all unexpected layout shift scores during the page lifetime; lower is better |
| TTI (Time to Interactive) | ms | Long Tasks API / Lighthouse | Time from navigation until the main thread is quiet for at least 5 s with no long tasks |
| JSHeapUsedSize | bytes | `page.metrics()` via Chrome DevTools Protocol | Active JS heap after the most recent GC cycle |
| JSHeapTotalSize | bytes | `page.metrics()` via Chrome DevTools Protocol | Total committed heap (used + free pages allocated from OS) |
| ScriptDuration | ms | CDP Performance Timeline | Total time spent executing JavaScript within the recording window |
| LayoutDuration | ms | CDP Performance Timeline | Total time spent in layout and reflow passes within the recording window |
| RecalcStyleDuration | ms | CDP Performance Timeline | Total time spent recalculating CSS styles within the recording window |
| TaskDuration | ms | CDP Performance Timeline | Total task time including all sub-tasks (script, layout, paint, composite) |
| heap-delta | bytes | computed | `JSHeapUsedSize(after) − JSHeapUsedSize(before)` per measured action; isolates allocation from a single operation |
| blur-all-latency | ms | `performance.mark()` in extension | Wall-clock time from the blur-all trigger message received in `content_script` to the last `data-bl-si-blur` attribute written by `stampElements` |
| pii-scan-duration | ms | `performance.mark()` in extension | Wall-clock time from `PiiDetector.scan()` entry to the last `splitText` DOM mutation completing |
| reveal-latency | ms | `performance.mark()` in extension | Wall-clock time for a single `findBlurredTarget()` call in `reveal_controller` per `mouseover` event |

---

## 3. Pass / Fail Thresholds

These budgets represent the maximum acceptable values for production releases. Exceeding a FAIL threshold blocks the release. Exceeding a WARNING threshold is logged, tracked in the performance history, and triggers an investigation issue but does not block.

| Scenario | Metric | Budget | Severity if exceeded |
|---|---|---|---|
| Cold-start init (storage read → first reconcile) | init + first `_reconcile()` wall clock | < 300 ms | WARNING |
| Blur-all toggle on a 10 000-element DOM | `blur-all-latency` (CSS injection + stamp) | < 500 ms p95 | FAIL |
| PII scan on a 10 000-word page | `pii-scan-duration` | < 150 ms | FAIL |
| PII scan on a 50 000-word page | `pii-scan-duration` | < 400 ms | WARNING |
| Picker activation (`Picker.activate()`) | `activate()` wall clock p95 | < 50 ms | WARNING |
| Picker zone draw (mousedown → mouseup commit) | zone draw p95 | < 100 ms | WARNING |
| Hover reveal per event (`findBlurredTarget()`) | `reveal-latency` p95 | < 10 ms | FAIL (causes jank at 60 Hz) |
| Hover reveal mean across all cycles | `reveal-latency` mean | < 5 ms | WARNING |
| Hover un-reveal (mouseout → attribute removed) | un-reveal p95 (includes 50 ms debounce) | < 150 ms | WARNING |
| SPA navigation (URL resolve + settings re-apply) | URL resolve + `_reconcile()` p95 | < 20 ms | WARNING |
| Context menu blur (blur element + storage write) | end-to-end handler latency | < 100 ms | WARNING |
| Heap growth over 10 navigations | cumulative `heap-delta` | < 5 MB | WARNING |
| MutationObserver callback per batch | per-mutation handler wall clock | < 2 ms | FAIL |
| Timeline — scripting (CDP trace) | total scripting time during blur-all activation | < 500 ms | WARNING |
| Timeline — layout (CDP trace) | total layout time during blur-all activation | < 50 ms | WARNING |

**Severity definitions:**

- **FAIL** — The scenario produces user-visible jank, frame drops, or a blocking main-thread pause. The release is blocked until the budget is restored.
- **WARNING** — The scenario is slower than desired but does not cause immediate user-visible degradation. The result is logged to the performance history. Three consecutive WARNING releases for the same metric escalate to FAIL.

---

## 4. Statistical Summary Method

Given an array of `N` timing samples collected from `N` iterations of a scenario, the framework reports:

```js
function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  // Nearest-rank method (0-indexed): index = Math.ceil(0.95 * n) - 1
  const p95  = sorted[Math.ceil(0.95 * sorted.length) - 1];
  return { mean, p95, min: sorted[0], max: sorted[sorted.length - 1], n: samples.length };
}
```

This `summarize()` function lives in `tests/perf/shared/metrics.js` and is imported by every scenario spec. The threshold checks in `expect` assertions are performed against **p95**, not mean, because a budget that passes on average but fails at p95 still produces a bad experience for one in twenty users.

---

## 5. Iteration Count Rationale

Ten iterations is the minimum for meaningful results. Here is why fewer is not sufficient:

**Warm JIT:** V8's optimizing compiler (Turbofan) does not kick in until a function has been called enough times to trigger tiering. The first one or two iterations of a cold extension function (e.g., `stampElements` on a fresh tab) will be slower than subsequent calls by 20–50%. Discarding the first run (the dry-run warmup) and sampling from runs 2–11 ensures the JIT is warm before measurement starts.

**GC noise:** V8's garbage collector runs on a heuristic schedule that is not tied to test iteration boundaries. A major GC event can add 10–50 ms of pause to a random sample. With N=10, one GC-inflated sample contributes 10% to the mean (harmful) but lands somewhere in the sorted array; p95 = `sorted[9]` so it is captured as the worst-case. With N=5, p95 = `sorted[4]` which may be the GC-inflated run — making the budget evaluation pessimistic and unstable.

**Confidence interval:** For a typical extension latency with standard deviation of ~20 ms, N=10 produces a 95% confidence interval width of approximately ±13 ms around the mean. This is sufficient to detect regressions of 30 ms or more. N=5 would double the interval width to ±26 ms, making 30 ms regressions statistically invisible.

---

## 6. Environment Requirements

| Requirement | Value | Reason |
|---|---|---|
| OS | macOS or Linux | Windows Chromium sandboxing adds higher baseline variance (~10–15 ms extra per task) |
| Browser | Bundled Chromium from Playwright (`channel: 'chromium'`) | Never use system Chrome — version and flag differences invalidate cross-run comparisons |
| Headless mode | `headless: false` | MV3 extensions require a headed browser context; `headless: true` silently drops the extension |
| Playwright workers | `1` | Multiple workers share CPU; concurrent test suites inflate each other's `ScriptDuration` measurements |
| Network | Localhost-served HTML or pre-cached responses | Network latency adds uncontrolled variance to LCP and page-load timing |
| Warmup | One full page load per scenario before measurement window | Brings JIT, browser cache, and layout engine to steady state before samples are collected |
| Extension loading | `--load-extension=<dist>` via Playwright `launchPersistentContext` | Required to run the extension in the test browser; pack to a dist folder before each test run |

---

## 7. Interpreting Results

The test framework writes raw JSON results to `tests/perf/results/` and prints a summary table. Each cell shows `<value> (<delta>%)` versus the baseline run.

**Red cells (> +20% regression):** The extension has introduced a significant performance regression relative to the baseline page. Investigate immediately. Common causes: a new `querySelectorAll` call in a hot path, an unbounded loop in a MutationObserver callback, or a new storage round-trip added to `_reconcile()`.

**Orange cells (10–20% regression):** The extension is slower than before, but not catastrophically. Track the value across releases. Three consecutive orange releases for the same metric should be treated as a red. Common causes: accumulated small allocations in repeated reconcile paths, selector cache misses from new category configurations.

**Green cells (negative delta — extension faster than baseline):** Do not assume this is a win without investigation. A green cell on `pii-scan-duration` after a change that touches PII detection may indicate the scan is being short-circuited or skipped rather than genuinely faster. Verify with a test-page inspection that the feature is actually running. A genuine improvement should be documented in the PR description.

**Unstable baseline (> 5% variance between baseline runs):** If two consecutive baseline-only runs differ by more than 5% on a metric, the test environment is contaminated. Common causes: background OS processes, browser extensions installed in the test profile, or a non-fixed network route. Re-run in a clean environment before drawing any conclusions from the instrumented runs.

---

## 8. Adding New Tests

Follow this runbook to add a new performance scenario to the framework.

**Step 1 — Create the spec file.**
Add a new file to `tests/perf/playwright/tests/` following the naming convention `<scenario_name>.perf.spec.js`.

**Step 2 — Import fixtures and helpers.**
```js
const { test, expect }       = require('../fixtures/extension');
const { collectWebVitals,
        collectHeap,
        summarize }           = require('../../shared/metrics');
```

**Step 3 — Declare the iteration constant.**
```js
const ITERATIONS = 10;
```
Put this at the top of the file so it is visible at a glance.

**Step 4 — Structure the spec.**
```js
test.describe('My new scenario', () => {
  let baselineSamples = [];
  let enabledSamples  = [];

  test.beforeAll(async ({ browser }) => {
    // One dry-run warmup load — not measured.
  });

  test('baseline (extension inactive)', async ({ page }) => {
    for (let i = 0; i < ITERATIONS; i++) {
      await page.goto(TEST_PAGE_URL);
      const vitals = await collectWebVitals(page);
      baselineSamples.push(vitals.fcp);
    }
  });

  test('extension enabled', async ({ extensionPage }) => {
    for (let i = 0; i < ITERATIONS; i++) {
      await extensionPage.goto(TEST_PAGE_URL);
      const vitals = await collectWebVitals(extensionPage);
      enabledSamples.push(vitals.fcp);
    }
  });

  test.afterAll(async () => {
    const result = {
      baseline: summarize(baselineSamples),
      enabled:  summarize(enabledSamples),
    };
    // Write JSON to tests/perf/results/<scenario>.json
    require('fs').writeFileSync(
      `tests/perf/results/my_new_scenario.json`,
      JSON.stringify(result, null, 2)
    );
  });
});
```

**Step 5 — Add custom marks if measuring extension-internal latency.**
In the relevant source file (`src/*.js`), add `performance.mark('bl-si:<scenario>:start')` and `performance.mark('bl-si:<scenario>:end')` at the entry and exit points. Collect them in the test via `page.evaluate(() => performance.getEntriesByName(...))`.

**Step 6 — Register the scenario in this doc.**
Add a row to the thresholds table in [§3 Pass / Fail Thresholds](#3-pass--fail-thresholds) with the scenario name, metric, budget, and severity. This is mandatory — do not merge a new spec without the corresponding threshold entry.
