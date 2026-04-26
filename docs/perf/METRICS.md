# Performance Metrics Reference

Standard parameters measured for every BlurrySite extension perf test run.

## Fixture × State Matrix

Which activation states apply to which fixture.

| Fixture | Vanilla | Ext Idle | Blur-All | PII Only | Pick&Blur | All Active |
|---|---|---|---|---|---|---|
| `text-heavy` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `pii-rich` | ✓ | ✓ | ✓ | ✓ (primary) | — | ✓ |
| `comprehensive` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (primary) |
| `reveal` | ✓ | ✓ | ✓ | — | — | — |
| `picker` | ✓ | ✓ | — | — | ✓ (primary) | — |
| `spa` | ✓ | ✓ | ✓ | — | — | ✓ |
| `forms` | ✓ | ✓ | ✓ | — | — | — |
| `media` | ✓ | ✓ | ✓ | — | — | — |

## State Definitions

| State | Description | Storage config |
|---|---|---|
| **Vanilla** | Plain Chrome, no extension loaded. True baseline. | N/A — separate `chromium.launch()` |
| **Ext Idle** | Extension loaded, blur_all off, pii off, pick_and_blur off. Extension overhead at rest. | `blur_all.status: false, auto_detect_pii.settings: { email: false, numeric: false }, pick_and_blur.status: false` |
| **Blur-All** | All 5 blur categories on. Full blur cost. | `blur_all.status: true` |
| **PII Only** | Auto-detect PII enabled (email + numeric). PII independent of blur-all. | `auto_detect_pii.settings: { email: true, numeric: true }` |
| **Pick & Blur** | Pick & Blur mode active. Zone drawing enabled. | `pick_and_blur.status: true` |
| **All Active** | blur_all + pii + pick_and_blur all on simultaneously. Worst-case overhead. | all three status: true |

## Standard Metrics

Measured for every fixture in every applicable state.

### Web Vitals & Navigation Timing

| Metric | Key | Source | Unit |
|---|---|---|---|
| First Contentful Paint | `fcp` | PerformanceObserver `paint` entry | ms |
| Largest Contentful Paint | `lcp` | PerformanceObserver `largest-contentful-paint` | ms |
| Cumulative Layout Shift | `cls` | PerformanceObserver `layout-shift` sum | score (0–1) |
| DOM Content Loaded | `dcl` | `PerformanceNavigationTiming.domContentLoadedEventEnd` | ms |
| Load Event End | `load` | `PerformanceNavigationTiming.loadEventEnd` | ms |

### Resource Metrics

| Metric | Key | Source | Unit |
|---|---|---|---|
| JS Heap Used | `heap_mb` | `performance.memory.usedJSHeapSize / 1048576` (after 1.5s settle) | MB |
| DOM Node Count | `dom_nodes` | `document.querySelectorAll('*').length` | count |

### Extension-Only Metrics (all non-vanilla states)

| Metric | Key | Source | Unit |
|---|---|---|---|
| Blurred element count | `blur_count` | `document.querySelectorAll('.bl-si-blurred').length` | count |

### Blur Timing (blur_all and all_active states)

| Metric | Key | How | Unit |
|---|---|---|---|
| Blur activation p50 | `blur_p50` | 5 iterations: DOMContentLoaded → first `.bl-si-blurred` (MutationObserver) | ms |
| Blur activation p95 | `blur_p95` | same | ms |

### PII Timing (pii_only and all_active states)

| Metric | Key | How | Unit |
|---|---|---|---|
| PII element count | `pii_count` | `document.querySelectorAll('[data-bl-si-pii]').length` | count |
| PII scan p50 | `pii_p50` | 5 iterations: DOMContentLoaded → first `[data-bl-si-pii]` (MutationObserver) | ms |
| PII scan p95 | `pii_p95` | same | ms |

### Pick & Blur Timing (pick_blur state)

| Metric | Key | How | Unit |
|---|---|---|---|
| Zone draw p50 | `pick_p50` | 5 iterations: mouse drag start → first `.bl-si-zone-overlay` | ms |
| Zone draw p95 | `pick_p95` | same | ms |

## Measurement Flow

Critical: storage is written BEFORE navigation so content script initializes with the correct state.

```
for each iteration:
  1. setModel(sw, STATE_CONFIGS[state])   // write to storage
  2. page.goto(fixtureUrl)                // fresh load — content script reads storage on init
  3. page.waitForLoadState('load')
  4. page.waitForTimeout(1500)            // content script settle (runs at document_idle)
  5. collect metrics
```

## Output Files

- `tests/perf/playwright/reports/fixtures/{fixture-id}.json` — full data per fixture
- `tests/perf/playwright/reports/COMPARISON.md` — growing comparison table, appended after each fixture

## Timing Origin: Blur Activation

Blur timing is measured from `DOMContentLoaded` (not `navigationStart`). A `MutationObserver` watches for the first `.bl-si-blurred` element to appear and records the elapsed time since DCL fired. This reflects real-world extension activation latency from a user's perspective.

## Pick & Blur Drag Coordinates (fixed per fixture)

Fixtures are static HTML — coordinates never change.

| Fixture | Drag start (x, y) | Drag end (x, y) | Zone |
|---|---|---|---|
| `picker` | (300, 200) | (700, 500) | Main content area, above fold |
| `comprehensive` | (400, 300) | (800, 600) | Main dashboard panel |
