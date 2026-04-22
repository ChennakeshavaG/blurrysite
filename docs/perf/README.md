# Blurry Site — Performance Testing Framework

## Overview

This framework measures the runtime overhead introduced by the Blurry Site extension across two complementary stacks: Playwright for user-observable latency (Web Vitals, heap delta, feature timing) and raw Chrome DevTools Protocol (CDP) for low-level scripting/rendering breakdown and layout-thrash detection. Every run produces per-framework JSON reports plus a merged self-contained HTML report at `tests/perf/reports/combined-report.html`.

## Quick Start

```bash
# Prerequisites
node --version   # >= 18
npm install      # from repo root — installs puppeteer-core used by the CDP runner

# Run everything (pre-flight check → Playwright → CDP → merged HTML report)
npm run test:perf

# Run individual frameworks
npm run test:perf:playwright   # Playwright specs only
npm run test:perf:cdp          # CDP scenarios only

# Find results
open tests/perf/reports/combined-report.html
```

**First run:** `npm run test:perf:playwright` triggers `cd tests/perf/playwright && npm install`, which downloads the Playwright-bundled Chromium binary (~200 MB). Subsequent runs use the cached binary and skip the download.

The `pretest:perf` hook (`tests/perf/scripts/pre-perf.js`) runs automatically before both frameworks. It verifies `manifest.json` is present and checks that sub-package `node_modules` exist — it is advisory only and always exits 0.

## Framework Overview

| Framework | Location | What it measures | Output |
|---|---|---|---|
| Playwright | `tests/perf/playwright/` | Web Vitals (FCP/LCP/CLS/INP), JS heap delta, feature latency | `tests/perf/playwright/reports/` |
| CDP | `tests/perf/cdp/` | Raw timeline scripting + rendering ms, heap snapshots, layout thrash | `tests/perf/cdp/reports/` |
| Combined | `tests/perf/reports/` | Merged HTML report built from both frameworks' JSON output | `combined-report.html` |

## Test Scenarios

### Playwright specs (`tests/perf/playwright/tests/`)

| File | Scenario | What it measures |
|---|---|---|
| `00-baseline.spec.js` | Baseline | FCP, LCP, CLS, INP, heap without any extension activity (blur-all off, no stored items) |
| `01-blur-all.spec.js` | Blur All | Time from trigger to `.bl-si-blurred` appearing + heap delta on a large DOM |
| `02-pii-scan.spec.js` | PII Scan | `blsi.PiiDetector.scan()` wall-clock duration + match count + heap delta |
| `03-picker.spec.js` | Picker | Activate latency (trigger → `bl-si-picker-active` on `<html>`) + zone draw gesture timing |
| `04-spa-nav.spec.js` | SPA Navigation | MutationObserver disconnect/reconnect cycle across 5 `pushState` navigations |
| `05-reveal.spec.js` | Hover Reveal | Reveal latency (mousemove → `data-bl-si-reveal` set) + un-reveal latency, 20 hover cycles |

Each spec runs 10 iterations and writes a `*-raw.json` file to `tests/perf/playwright/reports/`. The `posttest:perf` hook reads these files and the Playwright `results.json` to build the combined HTML report.

### CDP scenarios (`tests/perf/cdp/scenarios/`)

| Scenario file | What it measures |
|---|---|
| `heap-growth.js` | JS heap (`JSHeapUsedSize`) across 5 page navigations; reports `deltaFromFirst` per load |
| `timeline-trace.js` | Scripting ms + rendering ms during a 5-second trace window with blur-all active |
| `layout-thrash.js` | Layout events > 16 ms threshold; reports `slowLayouts` count and `maxLayoutMs` |

CDP results are written to `tests/perf/cdp/reports/cdp-results.json`.

## Report Artifacts

| Path | Contents |
|---|---|
| `tests/perf/playwright/reports/results.json` | Playwright JSON reporter output (test pass/fail + durations) |
| `tests/perf/playwright/reports/*-raw.json` | Per-spec raw metric arrays written by each spec's `afterAll` |
| `tests/perf/cdp/reports/cdp-results.json` | CDP scenario results keyed by scenario name |
| `tests/perf/reports/combined-raw.json` | Normalised intermediate JSON fed to the HTML builder |
| `tests/perf/reports/combined-report.html` | Self-contained HTML report with colour-coded delta table |

Delta colour key in the HTML report:

| Colour | Meaning |
|---|---|
| Green | Improvement — delta ≤ 0% |
| No colour | Acceptable — delta 1–10% |
| Orange | Warning — delta 10–20% |
| Red | Regression — delta > 20% |

## CI Integration

Extensions require a visible display; standard headless CI (GitHub Actions default Chromium) won't load them. Use Xvfb on Linux runners:

```yaml
jobs:
  perf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install root deps
        run: npm install
      - name: Run perf tests
        run: |
          export DISPLAY=:99
          Xvfb :99 -screen 0 1280x720x24 &
          npm run test:perf
      - name: Upload HTML report
        uses: actions/upload-artifact@v4
        with:
          name: perf-report
          path: tests/perf/reports/combined-report.html
```

`HEADED=1` is not required in CI because the Playwright fixture uses `headless: false` only when the `HEADED` environment variable is set. The fixture calls `launchPersistentContext` with `headless: false` unconditionally — set `HEADED` to any value to open a visible window locally.

> **Note:** The Playwright config sets `headless: process.env.HEADED !== '1'` in the project block, but the extension fixture in `fixtures/extension.js` always passes `headless: false` to `launchPersistentContext`. The fixture wins. On Linux CI, Xvfb provides the required display.

## Troubleshooting

### 1. "Extension not loading" / extension ID not found
The service worker URL match (`/chrome-extension:\/\/([a-z]{32})\//`) failed. Verify the extension path resolves correctly:
```bash
node -e "const p = require('path'); console.log(p.resolve('tests/perf/playwright/fixtures', '../../../../'));"
```
The printed path must be the repo root containing `manifest.json`. If `BLURRYSITE_EXT_PATH` is set in the environment it overrides the CDP runner's path; clear it or point it at the correct directory.

### 2. "Service worker not found" — timeout waiting for `serviceworker` event
Extension startup races the 10-second timeout in `fixtures/extension.js`. Common causes: another Chrome profile already has the extension registered; a stale `userDataDir` left from a killed run. Kill all Chrome processes and retry:
```bash
pkill -f "blurrysite-perf"
npm run test:perf:playwright
```

### 3. Playwright Chromium binary missing
The cached binary was deleted or the first install was interrupted:
```bash
cd tests/perf/playwright && npx playwright install chromium
```

### 4. "CDP connection refused" — port 9222 already in use
A previous CDP run left a Chrome process alive:
```bash
lsof -ti tcp:9222 | xargs kill -9   # macOS / Linux
# Windows: netstat -ano | findstr :9222 → taskkill /PID <pid> /F
```
Then set a different port: `CHROME_REMOTE_PORT=9223 npm run test:perf:cdp`.

### 5. All metrics show 0 or null
The extension content script did not initialise. Check that:
- `blsi.PiiDetector`, `blsi.Picker`, `blsi.BlurEngine` etc. are accessible via `window.blsi` in the page context.
- The test URL loaded successfully (network, HTTPS errors).
- `AUTO_DETECT` is enabled in storage for PII scan tests — the spec warns in console if `blsi.PiiDetector` is missing.
