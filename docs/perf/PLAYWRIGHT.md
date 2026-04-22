# Playwright Performance Tests — Complete Guide

## Architecture

The Playwright suite lives in `tests/perf/playwright/`. It uses a custom test fixture to load the unpacked extension into a persistent browser context so all six specs share the same extension-loading mechanism.

### Fixture: `fixtures/extension.js`

`fixtures/extension.js` extends Playwright's base `test` with three additional fixtures:

| Fixture | Type | Description |
|---|---|---|
| `context` | `BrowserContext` | Persistent context launched via `launchPersistentContext` with `--load-extension` |
| `extId` | `string` | Extension ID extracted from the background service worker URL |
| `page` | `Page` | A fresh page from the persistent context; closed after each test |

How extension ID extraction works: after `launchPersistentContext`, the fixture waits up to 10 seconds for the background service worker to register (it carries the extension ID in its URL). The URL format is `chrome-extension://<extId>/background.js`; the ID is captured with `/chrome-extension:\/\/([a-z]{32})\//`.

`EXTENSION_PATH` is resolved to the repo root (four levels up from `fixtures/`):
```javascript
const EXTENSION_PATH = path.resolve(__dirname, '../../../../');
```

The context is scoped to `{ scope: 'test' }`, meaning a fresh context (and fresh extension session) is created per test. This prevents state bleed across iterations but adds ~3–5 s of startup cost per test.

### Accessing the popup in a test

```javascript
const { test, expect } = require('../fixtures/extension');

test('popup opens', async ({ context, extId }) => {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`);
  await expect(popupPage.locator('#enableToggle')).toBeChecked();
  await popupPage.close();
});
```

### Accessing storage in a test

```javascript
test('settings are defaults', async ({ page, extId }) => {
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  const settings = await page.evaluate(() =>
    new Promise((resolve) => chrome.storage.local.get(null, resolve))
  );
  console.log(settings);
});
```

### Playwright config

`playwright.config.js` enforces serial execution (`workers: 1`, `fullyParallel: false`) because parallel tabs pollute timing measurements. Each spec gets a 60-second timeout. Two reporters run: `json` (output to `reports/results.json`) and `list` (stdout). Screenshots are captured only on failure; video only on the first retry.

## Metric Collection API (`shared/metrics.js`)

All specs import helpers from `../../shared/metrics`. The module has no external dependencies.

### `collectWebVitals(page)`

Injects a `PerformanceObserver` into the page and resolves once FCP fires (or after a 5-second timeout). Returns millisecond values:

```javascript
const { collectWebVitals } = require('../../shared/metrics');

const vitals = await collectWebVitals(page);
// Returns: { fcp: number|null, lcp: number|null, cls: number|null, inp: number|null }
// fcp  — First Contentful Paint (ms)
// lcp  — Largest Contentful Paint (ms); final candidate before timeout
// cls  — Cumulative Layout Shift score (unitless, rounded to 4 decimal places)
// inp  — Interaction to Next Paint (ms); max duration across all interaction events
```

Call this after `page.goto()` and after the page has settled. If the page has no paint events (e.g. a `data:` URI), `fcp` falls back to `domContentLoadedEventEnd` from Navigation Timing.

### `collectHeap(page)`

Thin wrapper around `page.metrics()`:

```javascript
const { collectHeap } = require('../../shared/metrics');

const heap = await collectHeap(page);
// Returns: { jsHeapUsedSize: number, jsHeapTotalSize: number }
// Both values are in bytes.
```

Use before and after an operation to compute the heap delta:
```javascript
const before = await collectHeap(page);
// ... do the thing ...
const after = await collectHeap(page);
const deltaBytes = after.jsHeapUsedSize - before.jsHeapUsedSize;
```

### `summarize(arr)`

Computes descriptive statistics for a numeric array. Returns `null` fields when the array is empty:

```javascript
const { summarize } = require('../../shared/metrics');

const stats = summarize([120, 135, 128, 142, 131, 129, 138, 127, 133, 136]);
// Returns: { mean: 131.9, median: 132, p95: 142, min: 120, max: 142, n: 10 }
// All values rounded to 2 decimal places.
// p95 uses nearest-rank method: Math.ceil(0.95 * n) - 1.
```

### `deltaPercent(baseline, value)`

Signed percentage change. Positive = regression; negative = improvement:

```javascript
const { deltaPercent } = require('../../shared/metrics');

deltaPercent(100, 112.5);  // => +12.5  (12.5% regression)
deltaPercent(100, 90);     // => -10    (10% improvement)
deltaPercent(0, 5);        // => Infinity
deltaPercent(100, 100);    // => 0
```

Returns `NaN` if either argument is not a finite number.

## Writing a New Test

Follow this step-by-step walkthrough to add a new spec.

### Step 1: Choose a file name

Specs run in lexicographic order. Pick the next available prefix:
```
tests/perf/playwright/tests/06-my-scenario.spec.js
```

### Step 2: Required imports

```javascript
/* eslint-disable */
'use strict';

const path = require('path');
const fs = require('fs');
const { test, expect } = require('../fixtures/extension');
const { collectHeap, collectWebVitals, summarize, deltaPercent } = require('../../shared/metrics');
```

### Step 3: Constants

```javascript
const ITERATIONS = 10;
// Use a locally served page for tighter control. Remote pages add network jitter.
const TEST_URL = 'https://example.com'; // TODO: replace with local fixture
```

### Step 4: Baseline loop (extension inactive, no stored blur items)

```javascript
const baselineSamples = [];

test.describe('My Scenario — baseline', () => {
  for (let i = 0; i < ITERATIONS; i++) {
    test(`baseline iteration ${i + 1}`, async ({ page }) => {
      await page.goto(TEST_URL, { waitUntil: 'networkidle' });
      const heap = await collectHeap(page);
      baselineSamples.push(heap.jsHeapUsedSize);
    });
  }
});
```

### Step 5: Instrumented loop (extension active, feature enabled)

```javascript
const instrumentedSamples = [];

test.describe('My Scenario — instrumented', () => {
  for (let i = 0; i < ITERATIONS; i++) {
    test(`instrumented iteration ${i + 1}`, async ({ page }) => {
      await page.goto(TEST_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500); // let content script settle

      // Enable the feature under test.
      await page.evaluate(() => {
        if (window.blsi && window.blsi.BlurEngine) {
          window.blsi.BlurEngine.handleDocument(document, { BLUR_ALL: true });
        }
      });

      const heap = await collectHeap(page);
      instrumentedSamples.push(heap.jsHeapUsedSize);
    });
  }
});
```

### Step 6: Assert with threshold

```javascript
test('heap delta < 30%', () => {
  const base = summarize(baselineSamples);
  const inst = summarize(instrumentedSamples);
  if (base.mean === null || inst.mean === null) {
    test.skip(true, 'Insufficient samples.');
    return;
  }
  const delta = deltaPercent(base.mean, inst.mean);
  expect(delta).toBeLessThan(30); // <30% heap regression
});
```

### Step 7: Write raw JSON in `afterAll`

```javascript
test.afterAll(async () => {
  const outPath = path.join(__dirname, '../reports/my-scenario-raw.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ baselineSamples, instrumentedSamples }, null, 2));
  console.log(`My scenario raw results written to ${outPath}`);
});
```

To include this file in the combined HTML report, add an entry to the `specRawFiles` array in `tests/perf/scripts/merge-reports.js` following the existing pattern for `blur-all-raw.json`.

### Complete template

```javascript
/* eslint-disable */
'use strict';

const path = require('path');
const fs = require('fs');
const { test, expect } = require('../fixtures/extension');
const { collectHeap, collectWebVitals, summarize, deltaPercent } = require('../../shared/metrics');

const ITERATIONS = 10;
const TEST_URL = 'https://example.com'; // TODO: use local fixture page

const allResults = [];

test.describe('My New Scenario', () => {
  for (let i = 0; i < ITERATIONS; i++) {
    test(`iteration ${i + 1}`, async ({ page }) => {
      await page.goto(TEST_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      const heapBefore = await collectHeap(page);

      // TODO: exercise the feature under test here.

      const heapAfter = await collectHeap(page);
      const heapDelta = heapAfter.jsHeapUsedSize - heapBefore.jsHeapUsedSize;

      allResults.push({ iteration: i + 1, heapDelta, timestamp: Date.now() });

      expect(heapDelta).toBeLessThan(5 * 1024 * 1024); // 5 MB absolute ceiling
    });
  }

  test('summary', async ({}) => {
    if (allResults.length === 0) return;
    const stats = summarize(allResults.map((r) => r.heapDelta));
    console.log('\n=== My Scenario Summary ===');
    console.log('Heap delta (bytes): ', stats);
  });

  test.afterAll(async () => {
    const outPath = path.join(__dirname, '../reports/my-scenario-raw.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log(`My scenario raw results written to ${outPath}`);
  });
});
```

## Interpreting Playwright Output

### During a run

Playwright prints a live list reporter to stdout. Each iteration is a line with the test title and status. The `summary` test inside each `describe` block prints descriptive statistics to the console via `console.log` — look for the `=== … Summary ===` blocks.

### After a run

| File | Contents | When present |
|---|---|---|
| `tests/perf/playwright/reports/results.json` | Playwright JSON reporter output — all suites, specs, retries, durations | After any Playwright run |
| `tests/perf/playwright/reports/*-raw.json` | Per-spec raw metric arrays written by `afterAll` hooks | After each spec completes |
| `tests/perf/playwright/reports/*.png` | Failure screenshots | Only when a test fails |
| `tests/perf/playwright/reports/*.webm` | Video of first retry | Only when retries > 0 and a test fails |
| `tests/perf/reports/combined-report.html` | Self-contained HTML with colour-coded delta tables | After `posttest:perf` runs |

### Reading the HTML report

Each scenario block shows a metric table with four columns: **Metric**, **Baseline (no ext)**, **With Extension**, **Delta**. Delta cells are colour-coded:

- **Green** (≤ 0%): improvement over baseline.
- **No colour** (1–10%): acceptable overhead.
- **Orange** (10–20%): worth investigating before shipping.
- **Red** (> 20%): regression — must be resolved before merge.

When a baseline value is `null` (no separate baseline loop in the spec), the Delta column shows `—`. This is expected for scenarios that measure a single-sided cost (e.g. scan duration) rather than a before/after comparison.

### Checking a specific spec's raw numbers

```bash
node -e "
  const d = require('./tests/perf/playwright/reports/blur-all-raw.json');
  const { summarize } = require('./tests/perf/shared/metrics');
  console.log('elapsed ms:', summarize(d.map(r => r.elapsedMs)));
  console.log('heap delta bytes:', summarize(d.map(r => r.heapDeltaBytes)));
"
```
