# What Was In This Folder

This folder was deleted. This file documents what was built so it can be rebuilt cleanly.

---

## Structure That Was Here

```
tests/perf/
├── fixtures/html/          9 static HTML test pages
├── bench/                  Node.js microbenchmark suite (no browser)
├── cdp/                    Chrome DevTools Protocol scenario suite
├── playwright/             Playwright browser test suite
├── shared/                 Shared metric helpers
└── scripts/                Pre/post test scripts
```

---

## fixtures/html/ — 9 Static HTML Pages

All pages are self-contained (inline CSS, data: URI images — no external deps).

| File | Purpose | Key content |
|---|---|---|
| `page-text-heavy.html` | Large text DOM | 500 `<p>`, 6 h1, 22 h2, 70 h3, 20 blockquote, financial table |
| `page-pii-rich.html` | Dense PII content | ~400 emails, 100 credit cards, 100 SSNs, 100 phones |
| `page-comprehensive.html` | All blur categories | Account dashboard — TEXT, MEDIA, FORM, TABLE, STRUCTURE |
| `page-reveal.html` | Reveal controller test | 100 `<p class="reveal-target">` with min-height:60px |
| `page-picker.html` | Picker zone drawing | Dashboard layout (sticky nav, sidebar, main, right panel) |
| `page-spa.html` | SPA navigation | `window.navigateTo(routeId)` + `history.pushState` + CustomEvent |
| `page-forms.html` | Form elements | 24 inputs, 11 selects, 4 textareas, 16 buttons |
| `page-media.html` | Media elements | 50 img (data URI), 10 video, 5 canvas, 5 svg |
| `index.json` | Page manifest | `serveBase: "https://perf.blurrysite.local"` |

---

## bench/ — Node.js Microbenchmark Suite

**Status: WORKING — all 21 benchmarks passed.**

No browser required. Uses jsdom to test pure-logic modules.

### Files
- `setup.js` — jsdom setup, chrome mock, loads all src/ modules in manifest order
- `run.js` — runs all 3 bench files, writes `reports/bench-results.json`
- `tests/url-matcher.bench.js` — 6 scenarios, budget < 1ms p95
- `tests/pii-detector.bench.js` — 8 scenarios (small/medium/large × email/full/conservative)
- `tests/blur-engine.bench.js` — 7 scenarios (injectRules, removeRules, stampElements, reconcile)
- `scripts/generate-report.js` — reads bench-results.json, writes reports/REPORT.md
- `package.json` — `{ "test": "node run.js", "posttest": "node scripts/generate-report.js" }`

### Run
```bash
cd tests/perf/bench && npm install && npm test
```

### Results (last run)
All 21 PASS. Notable:
- url-matcher: ~0.001ms per match
- pii-detector large full-scan: ~32ms p95
- blur-engine stampElements large: ~7ms p95

---

## cdp/ — Chrome DevTools Protocol Suite

**Status: Written but NOT verified end-to-end (needs Chrome + Puppeteer).**

### Files
- `run.js` — starts local HTTP server, opens Chrome via CDP, runs scenarios, writes `reports/cdp-results.json`
- `scenarios/heap-growth.js` — 5 page loads, measures JS heap growth (threshold: 5MB)
- `scenarios/timeline-trace.js` — Chrome trace, measures scripting/layout/styleRecalc ms
- `scenarios/layout-thrash.js` — detects forced synchronous layouts > 16ms
- `scripts/generate-report.js` — reads cdp-results.json, writes reports/REPORT.md
- `package.json` — `{ "test": "node run.js", "posttest": "node scripts/generate-report.js" }`

### Key design
- `run.js` starts an `http.createServer` on random port serving `fixtures/html/`
- All scenarios receive `{ baseUrl, extId }` — use `${baseUrl}/page-xxx.html` for navigation
- All `handleSite()` calls use single-argument form: `blsi.BlurEngine.handleSite({ ENABLED, BLUR_ALL_ACTIVE, BLUR_ITEMS, ... })`

### Run
```bash
cd tests/perf/cdp && npm install && npm test
```

---

## playwright/ — Playwright Browser Suite

**Status: BROKEN — tests were timing out. Root cause identified but not fixed.**

### Files
- `fixtures/extension.js` — custom `test` with persistent Chrome context + extension loaded
- `playwright.config.js` — 1 worker, serial, chromium-extension project, retries: 1
- `global-setup.js` — starts HTTP fixture server, sets `PERF_FIXTURE_PORT` env var
- `global-teardown.js` — stops HTTP fixture server
- `tests/00-baseline.spec.js` — FCP/LCP/CLS/heap baseline (extension DISABLED)
- `tests/01-blur-all.spec.js` — blur-all activation latency on page-text-heavy.html
- `tests/02-pii-scan.spec.js` — PII scan cost on page-pii-rich.html
- `tests/03-picker.spec.js` — picker activation + zone draw latency
- `tests/04-spa-nav.spec.js` — MutationObserver reconcile cost per SPA navigation
- `tests/05-reveal.spec.js` — reveal hover/un-reveal latency
- `scripts/generate-report.js` — reads reports/*-raw.json, writes reports/REPORT.md
- `package.json` — `{ "test": "playwright test", "posttest": "node scripts/generate-report.js" }`
- `shared/metrics.js` — `collectWebVitals`, `collectHeap`, `summarize`, `deltaPercent`

### Known Issue (why it's broken)
Tests call `setExtensionStorage(context, ...)` at the start of each test before any
navigation. This calls `sw.evaluate()` on the extension's service worker. If the
service worker hasn't registered yet (race condition on cold start), `waitForEvent`
waits up to 10s. Combined with two `page.goto()` calls (one warmup + one measured),
the 60s test timeout is easily exceeded.

**The minimal test `test-goto.js` confirmed navigation itself works (139ms).**
The hang is specifically in the service worker storage setup, not navigation.

### Fix needed
Option A: Wait for service worker in the `context` fixture before `use()`, not in each test.
Option B: Set storage via `page.evaluate()` after navigation (when content script has run).
Option C: Increase per-test timeout to 120s.

### Run (broken)
```bash
cd tests/perf/playwright && npm install && npm test
```

---

## shared/
- `metrics.js` — `collectWebVitals(page)`, `collectHeap(page)`, `summarize(arr)`, `deltaPercent(baseline, value)`
- `report-builder.js` — shared report formatting utilities

## scripts/
- `pre-perf.js` — pre-test checks (Chrome available, extension loaded, fixtures present)
- `merge-reports.js` — merges bench/cdp/playwright REPORT.md into one summary

---

## Root package.json scripts (were added)
```json
"test:perf":            "npm run test:perf:playwright && npm run test:perf:cdp && npm run test:perf:bench",
"test:perf:playwright": "cd tests/perf/playwright && npm install --prefer-offline 2>/dev/null; npm test",
"test:perf:cdp":        "cd tests/perf/cdp && node run.js && node scripts/generate-report.js",
"test:perf:bench":      "cd tests/perf/bench && npm install --prefer-offline 2>/dev/null; npm test",
"pretest:perf":         "node tests/perf/scripts/pre-perf.js",
"posttest:perf":        "node tests/perf/scripts/merge-reports.js"
```

---

## What To Do Next Time

1. **bench/** works — keep the design, just re-create the files.
2. **cdp/** was not tested — needs a real Chrome + Puppeteer run.
3. **playwright/** — the fixture design is fine but service worker timing is the blocker.
   Fix: in the `context` fixture, wait for the service worker before calling `use()`:
   ```js
   const sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
   // then set initial storage here once, not in each test
   await use(context);
   ```
4. All HTML fixtures are self-contained and correct — keep them.
5. The `http://127.0.0.1:PORT` approach (real HTTP server) is correct for Playwright.
   Do NOT use `page.route()` with HTTPS fake domains — it doesn't work reliably
   with persistent extension contexts.
