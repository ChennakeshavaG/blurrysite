# CDP Performance Tests — Complete Guide

## What CDP Profiling Gives You (vs Playwright)

Playwright measures user-observable latency — what a user waits for. CDP gives you the internal breakdown of where that time went.

| Capability | Playwright | CDP |
|---|---|---|
| FCP / LCP / CLS / INP | Yes | No |
| Feature latency (activate, scan, reveal) | Yes | No |
| Raw scripting ms vs. rendering ms breakdown | No | Yes |
| Heap snapshot diffs (object-level) | No | Yes |
| Long task detection (> 50 ms main-thread blocks) | No | Yes |
| Forced layout / layout-thrash detection | No | Yes |
| GC event timing | No | Yes |
| Load as Chrome trace in DevTools Performance panel | No | Yes |

**When to use CDP:** you have a Playwright regression but need to know _why_. For example, if `01-blur-all` shows a 25% elapsed-time regression, run `timeline-trace` to see whether the cost is in scripting (blame `blur_engine.js`) or rendering (blame CSS filter cascade). Use `layout-thrash` to catch MutationObserver-triggered synchronous reflows.

## Running CDP Scenarios

```bash
# Run all three scenarios
npm run test:perf:cdp

# Run a single scenario
node tests/perf/cdp/run.js --scenario heap-growth
node tests/perf/cdp/run.js --scenario timeline-trace
node tests/perf/cdp/run.js --scenario layout-thrash

# Override the debug port (default: 9222)
CHROME_REMOTE_PORT=9223 npm run test:perf:cdp

# Override the extension path (default: repo root)
BLURRYSITE_EXT_PATH=/path/to/blurrysite npm run test:perf:cdp
```

The runner (`tests/perf/cdp/run.js`) launches Chromium from the Puppeteer-bundled binary, connects via `chrome-remote-interface`, opens a new tab per scenario, runs the scenario's `run()` function, and writes results to `tests/perf/cdp/reports/cdp-results.json`.

### Output shape

`cdp-results.json` is an object keyed by scenario name:

```json
{
  "timestamp": "2025-04-17T12:00:00.000Z",
  "scenarios": {
    "heap-growth": {
      "snapshots": [
        { "url": "https://example.com", "loadIndex": 0, "heapUsed": 12345678, "heapTotal": 20000000, "deltaFromFirst": 0 },
        { "url": "https://example.com", "loadIndex": 1, "heapUsed": 12567890, "heapTotal": 20000000, "deltaFromFirst": 222212 }
      ],
      "summary": {
        "totalSnapshots": 5,
        "maxHeapDeltaBytes": 400000,
        "isMonotonicallyGrowing": false
      }
    },
    "timeline-trace": {
      "eventCount": 1204,
      "scriptingMs": 312.5,
      "renderingMs": 18.3,
      "traceFile": null
    },
    "layout-thrash": {
      "totalLayouts": 42,
      "slowLayouts": 2,
      "slowEvents": [
        { "name": "Layout", "durationMs": 24.1, "stackTrace": null, "timestamp": 1234567890 }
      ],
      "maxLayoutMs": 24.1,
      "thresholdMs": 16
    }
  }
}
```

If a scenario throws, its entry is `{ "error": "<message>" }` and the runner continues with the next scenario.

## Scenario Reference

### `heap-growth.js` — JS Heap Across Page Navigations

**What it measures:** `JSHeapUsedSize` sampled via `Performance.getMetrics()` after each of 5 page loads. Reports `deltaFromFirst` (bytes relative to the first load) per snapshot and a summary with `maxHeapDeltaBytes` and a monotonic-growth flag.

**How to read the output:**
- `deltaFromFirst` on load 0 is always 0 (the reference point).
- A small positive delta on later loads is normal — GC has not run between loads.
- `isMonotonicallyGrowing: true` means heap grew on every successive load without ever dipping, which is a strong leak signal.

**What a bad result looks like:**
- `maxHeapDeltaBytes > 5_242_880` (5 MB): heap grew more than 5 MB across navigations without returning to baseline. Suspect detached DOM nodes (PII detector spans not cleared), observer callbacks kept alive after `disconnectObserver()`, or `BlurEngine.teardown()` not called on unload.
- `isMonotonicallyGrowing: true` with a delta > 1 MB: almost certainly a leak. Cross-reference with `heap-growth` snapshots after calling `blsi.PiiDetector.clear(document.body)` and `blsi.BlurEngine.teardown()` manually to isolate which module leaks.

**To force GC before each snapshot** (tighter numbers — requires a special Chrome flag):
```bash
# Launch Chrome with --js-flags=--expose-gc, then in run.js uncomment:
# await Runtime.evaluate({ expression: 'gc()' });
```

---

### `timeline-trace.js` — Scripting + Rendering Breakdown

**What it measures:** A 5-second Chrome Tracing session with categories `devtools.timeline`, `v8.execute`, `blink.user_timing`, and `loading`. Filters the raw trace events to scripting events (`FunctionCall`, `EvaluateScript`, `v8.run`, `v8.execute`) and rendering events (`Layout`, `Paint`, `UpdateLayerTree`, `CompositeLayers`, `PaintImage`), then sums their `dur` fields (CDP duration is in microseconds; the scenario converts to ms).

**How to read the output:**
- `scriptingMs`: total JS execution time in the trace window. Extension content scripts, `blur_engine.js` MutationObserver callbacks, and `pii_detector.js` text-node scans all contribute.
- `renderingMs`: total time spent in layout + paint. High values here mean the CSS `filter: blur()` cascade or zone overlay positioning forced many repaints.
- `eventCount`: number of relevant trace events (informational — high counts alone are not a problem).

**What a bad result looks like:**
- `scriptingMs > 500`: more than 500 ms of scripting in a 5-second window is excessive for a passive extension. Investigate observer callback frequency — a MutationObserver that fires on every text-node mutation (e.g. PII detector `observeMutations`) may be too aggressive.
- `renderingMs > 50`: layout or paint is unusually expensive. Check whether zone overlays use `getBoundingClientRect` inside a mutation callback (forced synchronous layout).

**Loading the trace in DevTools:** uncomment the `fs.writeFileSync` block in `timeline-trace.js` to write a `timeline-trace.json` file to `tests/perf/cdp/reports/`. Open Chrome DevTools → Performance panel → Load profile → select the file.

**TODO in the scenario:** the blur-all trigger is currently a placeholder comment. Until it is wired up, the trace captures only page-load scripting. To measure blur-all cost specifically, uncomment and fill in:
```javascript
await Runtime.evaluate({
  expression: `
    performance.mark('blurall-start');
    blsi.BlurEngine.handleDocument(document, { BLUR_ALL: true });
    performance.mark('blurall-end');
  `
});
```

---

### `layout-thrash.js` — Forced Layout Detection

**What it measures:** A `devtools.timeline` trace during an 8-second window. Filters to `Layout` trace events and identifies those whose duration exceeds the 16 ms threshold (one frame at 60 fps). Reports `totalLayouts`, `slowLayouts`, `maxLayoutMs`, and the top 20 slow events with timestamps.

**How to read the output:**
- `slowLayouts: 0`: no forced layouts exceeded one frame — healthy.
- `slowLayouts > 0`: inspect `slowEvents[0].durationMs` and `timestamp`. Cross-reference the timestamp with the extension's action log to identify which code path triggered the layout.
- Stack traces in `slowEvents[*].stackTrace` are `null` unless you add `devtools.timeline.stack` to the trace categories (increases trace size significantly).

**What a bad result looks like:**
- Any `slowLayouts` originating from the extension's picker, zone overlay positioning, or reveal controller is a bug. The extension must not read layout properties (`getBoundingClientRect`, `offsetWidth`) after writing to the DOM within the same task.
- `maxLayoutMs > 100`: a layout that takes over 100 ms will cause a visible freeze. Immediately investigate the call stack by enabling stack traces:
  ```javascript
  await Tracing.start({
    categories: 'devtools.timeline,devtools.timeline.stack',
    options: 'sampling-frequency=1000',
  });
  ```

**Interpreting the `timestamp` field:** CDP trace timestamps are in microseconds since Chrome epoch (not Unix epoch). To align with wall clock, subtract the `Page.loadEventFired` timestamp from the trace start.

## Adding a New CDP Scenario

### Step 1: Create the scenario file

```javascript
// tests/perf/cdp/scenarios/my-scenario.js
/* eslint-disable */
'use strict';

const TEST_URL = 'https://example.com'; // TODO: local fixture

/**
 * @param {object} tabClient  — CDP tab client from run.js openTab()
 * @param {{ navigate: (url: string) => Promise<void> }} helpers
 * @returns {Promise<object>}  — result object written to cdp-results.json
 */
async function run(tabClient, { navigate }) {
  const { Performance, Runtime } = tabClient;

  await navigate(TEST_URL);
  await new Promise((res) => setTimeout(res, 500)); // let content script settle

  await Performance.enable();

  // TODO: trigger the feature under test.
  // Example: call a blsi.* method via Runtime.evaluate.
  await Runtime.evaluate({
    expression: `
      if (window.blsi && window.blsi.BlurEngine) {
        blsi.BlurEngine.handleDocument(document, { BLUR_ALL: true });
      }
    `,
  });

  // Collect metrics.
  const { metrics } = await Performance.getMetrics();
  const scriptDuration = metrics.find((m) => m.name === 'ScriptDuration');
  const taskDuration = metrics.find((m) => m.name === 'TaskDuration');

  return {
    scriptDurationMs: scriptDuration ? parseFloat((scriptDuration.value * 1000).toFixed(2)) : 0,
    taskDurationMs:   taskDuration   ? parseFloat((taskDuration.value   * 1000).toFixed(2)) : 0,
  };
}

module.exports = { run };
```

Available `Performance.getMetrics()` metric names include: `ScriptDuration`, `TaskDuration`, `LayoutCount`, `RecalcStyleCount`, `LayoutDuration`, `RecalcStyleDuration`, `JSHeapUsedSize`, `JSHeapTotalSize`.

### Step 2: Register the scenario in `run.js`

Open `tests/perf/cdp/run.js` and add an entry to the `SCENARIOS` array:

```javascript
const SCENARIOS = [
  { name: 'heap-growth',    mod: './scenarios/heap-growth' },
  { name: 'timeline-trace', mod: './scenarios/timeline-trace' },
  { name: 'layout-thrash',  mod: './scenarios/layout-thrash' },
  { name: 'my-scenario',   mod: './scenarios/my-scenario' },  // add this line
];
```

### Step 3: Add result normalisation to `merge-reports.js`

Open `tests/perf/scripts/merge-reports.js` and add a case inside `normaliseCDPResults`:

```javascript
// my-scenario
if (name === 'my-scenario') {
  if (result.scriptDurationMs !== undefined) {
    metrics.push({
      label: 'Script duration (ms)',
      baseline: null,
      instrumented: result.scriptDurationMs,
      unit: 'ms',
    });
  }
}
```

### Step 4: Run and verify

```bash
node tests/perf/cdp/run.js --scenario my-scenario
# Check output in tests/perf/cdp/reports/cdp-results.json

node tests/perf/scripts/merge-reports.js
open tests/perf/reports/combined-report.html
```

## Available CDP Domains (in `tabClient`)

`run.js` enables `Page`, `Runtime`, and `Performance` on every tab client. Scenarios can also access `HeapProfiler` and `Tracing` — both are available on `tabClient` without needing to call `enable()` first (they self-enable on first method call):

| Domain | Key methods | Notes |
|---|---|---|
| `Performance` | `enable()`, `getMetrics()` | Returns `ScriptDuration`, `JSHeapUsedSize`, etc. |
| `HeapProfiler` | `takeHeapSnapshot()`, `collectGarbage()` | Snapshot is slow (~1–2 s); use for object-level diffs |
| `Tracing` | `start()`, `end()`, `dataCollected` event, `tracingComplete` event | Stream events via `dataCollected`; flush via `tracingComplete` |
| `Runtime` | `evaluate()`, `enable()`, `collectGarbage()` | `collectGarbage()` needs `--js-flags=--expose-gc` |
| `Page` | `navigate()`, `loadEventFired` event | Already enabled in `openTab()` |
