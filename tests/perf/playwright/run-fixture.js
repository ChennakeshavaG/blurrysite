'use strict';

// run-fixture.js — per-fixture performance measurement runner
//
// Usage:
//   node run-fixture.js <fixture-id>             # headed (visible browser)
//   node run-fixture.js <fixture-id> --headless  # headless (background-safe)
//
// Runs all states defined for the given fixture, collects performance metrics
// across 5 iterations each, computes deltas vs vanilla, and writes:
//   reports/fixtures/<fixture-id>.json  — full data
//   reports/COMPARISON.md              — appended summary table

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { chromium } = require('@playwright/test');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PLAYWRIGHT_DIR  = __dirname;
const EXT_PATH        = path.resolve(PLAYWRIGHT_DIR, '../../..');
const FIXTURES_DIR_HTML = path.resolve(PLAYWRIGHT_DIR, '../fixtures/html');
const REPORTS_DIR     = path.join(PLAYWRIGHT_DIR, 'reports');
const REPORTS_FIXTURES_DIR = path.join(REPORTS_DIR, 'fixtures');
const COMPARISON_MD   = path.join(REPORTS_DIR, 'COMPARISON.md');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ITERATIONS = 20;

const STATES = {
  vanilla:    null,
  idle:       { blur_all: { status: false }, auto_detect_pii: { status: false }, pick_and_blur: { status: false } },
  blur_all:   { blur_all: { status: true  }, auto_detect_pii: { status: false }, pick_and_blur: { status: false } },
  pii_only:   { blur_all: { status: false }, auto_detect_pii: { status: true, settings: { email: true, numeric: true } }, pick_and_blur: { status: false } },
  pick_blur:  { blur_all: { status: false }, auto_detect_pii: { status: false }, pick_and_blur: { status: true  } },
  all_active: { blur_all: { status: true  }, auto_detect_pii: { status: true, settings: { email: true, numeric: true } }, pick_and_blur: { status: true } },
};

// blur_radius sweep — each uses blur_all:true with a different radius.
// Only run when --radius-sweep flag is passed.
const RADIUS_SWEEP_STATES = {
  blur_radius_3:  { blur_all: { status: true }, auto_detect_pii: { status: false }, pick_and_blur: { status: false }, settings: { blur_radius: 3  } },
  blur_radius_6:  { blur_all: { status: true }, auto_detect_pii: { status: false }, pick_and_blur: { status: false }, settings: { blur_radius: 6  } },
  blur_radius_12: { blur_all: { status: true }, auto_detect_pii: { status: false }, pick_and_blur: { status: false }, settings: { blur_radius: 12 } },
};

// thorough_blur comparison — only when --thorough-blur flag is passed.
const THOROUGH_BLUR_STATES = {
  thorough_blur_off: { blur_all: { status: true }, settings: { thorough_blur: false } },
  thorough_blur_on:  { blur_all: { status: true }, settings: { thorough_blur: true  } },
};

const FIXTURE_MATRIX = {
  'text-heavy':    ['vanilla', 'idle', 'blur_all', 'pii_only',                  'all_active'],
  'pii-rich':      ['vanilla', 'idle', 'blur_all', 'pii_only',                  'all_active'],
  'comprehensive': ['vanilla', 'idle', 'blur_all', 'pii_only', 'pick_blur',     'all_active'],
  'reveal':        ['vanilla', 'idle', 'blur_all'],
  'picker':        ['vanilla', 'idle',                          'pick_blur'],
  'spa':           ['vanilla', 'idle', 'blur_all',                               'all_active'],
  'forms':         ['vanilla', 'idle', 'blur_all'],
  'media':         ['vanilla', 'idle', 'blur_all'],
};

const PICK_BLUR_DRAG = {
  'picker':        { start: [300, 200], end: [700, 500] },
  'comprehensive': { start: [400, 300], end: [800, 600] },
};

const DEFAULT_SEED = {
  settings: { enabled: true, blur_radius: 12, reveal_mode: 'hover', thorough_blur: false,
    blur_categories: { text: true, media: true, form: true, table: true, structure: true } },
  blur_all: { status: false, settings: {} },
  auto_detect_pii: { status: false, settings: { email: false, numeric: false } },
  pick_and_blur: { status: false, settings: {} },
  automate: { status: false, settings: {
    idle: { value: 5, unit: 'min', enabled: false },
    tab_switch: { enabled: false },
  }},
  shortcuts: {},
  site_rules: [],
};

// ---------------------------------------------------------------------------
// setModel — deep-merges patch into blsi_model via the service worker.
// Self-contained (no closures) — patch passed as JSON string.
// ---------------------------------------------------------------------------

async function setModel(sw, patch) {
  await sw.evaluate((patchJson) => {
    const patch = JSON.parse(patchJson);
    function deepMerge(target, source) {
      const out = Object.assign({}, target);
      for (const key of Object.keys(source)) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          out[key] = deepMerge(target[key] || {}, source[key]);
        } else {
          out[key] = source[key];
        }
      }
      return out;
    }
    return new Promise((resolve) => {
      chrome.storage.local.get('blsi_model', (result) => {
        chrome.storage.local.set({ blsi_model: deepMerge(result.blsi_model || {}, patch) }, resolve);
      });
    });
  }, JSON.stringify(patch));
}

// ---------------------------------------------------------------------------
// HTTP fixture server (inline, mirrors global-setup.js logic)
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

function startFixtureServer() {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(function onRequest(req, res) {
      const urlPath  = req.url.split('?')[0];
      const filePath = path.join(FIXTURES_DIR_HTML, urlPath);

      if (!filePath.startsWith(FIXTURES_DIR_HTML)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }

      fs.readFile(filePath, function onRead(err, data) {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found', path: urlPath }));
          return;
        }
        const ext      = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(data);
      });
    });

    server.listen(0, '127.0.0.1', function () {
      resolve({ server, port: server.address().port });
    });
    server.once('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

async function collectNavTiming(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('navigation');
    if (!entries || !entries[0]) return { dcl: null, load: null };
    const nav = entries[0];
    return {
      dcl:  Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
    };
  });
}

async function collectDomNodes(page) {
  return page.evaluate(() => document.querySelectorAll('*').length);
}

async function collectHeapMb(page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('HeapProfiler.collectGarbage');
    await session.detach();
  } catch (_) {
    // CDP unavailable — proceed without forced GC
  }
  return page.evaluate(() => {
    if (!performance.memory) return null;
    return Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10;
  });
}

// setupWebVitals — must be called before page.goto().
// collect() waits for bl-si-ready (content script fully initialized) before
// reading metrics, so CLS entries from extension DOM mutations are captured.
async function setupWebVitals(page) {
  await page.addInitScript(() => {
    window.__perfMetrics = { fcp: null, lcp: null, cls: 0 };
    // Track content script ready signal (dispatched by content_script.js init())
    window.__blsiReady = false;
    document.addEventListener('bl-si-ready', () => { window.__blsiReady = true; }, { once: true });

    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') {
          window.__perfMetrics.fcp = Math.round(entry.startTime);
        }
        if (entry.entryType === 'largest-contentful-paint') {
          window.__perfMetrics.lcp = Math.round(entry.startTime);
        }
        if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
          window.__perfMetrics.cls += entry.value;
        }
      }
    });
    try {
      obs.observe({ entryTypes: ['paint', 'largest-contentful-paint', 'layout-shift'] });
    } catch (_) {}
  });

  return async function collect() {
    // Wait for content script to finish (bl-si-ready) so CLS shifts from blur
    // stamping are captured. Fall back after 15s to handle disabled-extension runs.
    await page.waitForFunction(() => window.__blsiReady === true, { timeout: 15000, polling: 4 });
    // Extra 1000ms settle so any deferred CLS shifts (e.g. from lazy images or
    // post-init layout mutations) are captured before we read the metric.
    await page.waitForTimeout(1000);
    return page.evaluate(() => window.__perfMetrics || { fcp: null, lcp: null, cls: 0 });
  };
}

// Inject blur timing poller — must be called (via addInitScript) before nav.
// Anchors to 'bl-si-init-start' (dispatched at the top of content_script init())
// rather than DCL. DCL fires before document_idle, so the DCL anchor included
// 200–500ms of browser idle time that had nothing to do with the extension.
// Uses setTimeout polling — MutationObserver won't fire for isolated-world mutations.
async function injectBlurTiming(page) {
  await page.addInitScript(() => {
    window.__blurTiming = null;
    let _initStartTime = null;
    let _polls = 0;
    function _poll() {
      if (_polls++ > 2500) return; // safety cap (~10s at 4ms interval)
      // #bl-si-blur-styles is injected by injectRules() before stampElements() runs.
      if (document.querySelector('#bl-si-blur-styles') || document.querySelector('[data-bl-si-blur]')) {
        if (_initStartTime !== null) {
          window.__blurTiming = Math.round(performance.now() - _initStartTime);
        }
        return;
      }
      setTimeout(_poll, 4);
    }
    // bl-si-init-start is dispatched at the very top of content_script init(),
    // before any async work — this is the true "extension started" timestamp.
    document.addEventListener('bl-si-init-start', () => {
      _initStartTime = performance.now();
      setTimeout(_poll, 0);
    }, { once: true });
  });
}

// Inject long task observer — must be called before nav.
// Captures all tasks > 50ms (blocks main thread).
async function injectLongTaskObserver(page) {
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__longTasks.push(Math.round(e.duration));
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch (_) {}
  });
}

// Inject PII timing poller — same anchor strategy as injectBlurTiming.
async function injectPiiTiming(page) {
  await page.addInitScript(() => {
    window.__piiTiming = null;
    let _initStartTime = null;
    let _polls = 0;
    function _poll() {
      if (_polls++ > 2500) return;
      if (document.querySelector('[data-bl-si-pii]')) {
        if (_initStartTime !== null) {
          window.__piiTiming = Math.round(performance.now() - _initStartTime);
        }
        return;
      }
      setTimeout(_poll, 4);
    }
    document.addEventListener('bl-si-init-start', () => {
      _initStartTime = performance.now();
      setTimeout(_poll, 0);
    }, { once: true });
  });
}

function summarize(arr) {
  const valid = arr.filter((v) => v !== null && v !== undefined);
  if (valid.length === 0) return { min: null, p50: null, p95: null, max: null, mean: null, n: 0 };
  const sorted = [...valid].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    min:  sorted[0],
    max:  sorted[n - 1],
    mean: Math.round(valid.reduce((s, v) => s + v, 0) / n),
    p50:  sorted[Math.min(Math.ceil(n * 0.50) - 1, n - 1)],
    p95:  sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)],
  };
}

// ---------------------------------------------------------------------------
// measureOneIteration
//
// Runs a single page load for a given state, collects all metrics, returns
// a raw sample object. Context must already be set up; page is opened/closed
// within this function.
// ---------------------------------------------------------------------------

async function measureOneIteration(context, url, stateName, fixtureId, sw) {
  const page = await context.newPage();
  const sample = {};
  let cdpSession = null;

  try {
    const needsBlurTiming   = (stateName === 'blur_all' || stateName === 'all_active');
    const needsPiiTiming    = (stateName === 'pii_only'  || stateName === 'all_active');
    const needsStyleMetrics = (stateName === 'blur_all' || stateName === 'all_active');

    // Inject observers BEFORE navigation
    const collectVitals = await setupWebVitals(page);
    await injectLongTaskObserver(page);
    if (needsBlurTiming) await injectBlurTiming(page);
    if (needsPiiTiming)  await injectPiiTiming(page);

    // Enable CDP Performance metrics BEFORE navigation so counters start at 0
    if (needsStyleMetrics) {
      try {
        cdpSession = await page.context().newCDPSession(page);
        await cdpSession.send('Performance.enable');
      } catch (_) {
        cdpSession = null;
      }
    }

    // Navigate — collectVitals() waits for bl-si-ready before reading
    await page.goto(url);
    await page.waitForLoadState('load');

    // Core vitals (collect() blocks until content script fully initialized)
    const vitals  = await collectVitals();
    sample.fcp = vitals.fcp;
    sample.lcp = vitals.lcp;
    sample.cls = Math.round(vitals.cls * 10000) / 10000;  // 4 decimal places

    // Nav timing
    const nav = await collectNavTiming(page);
    sample.dcl  = nav.dcl;
    sample.load = nav.load;

    // Heap
    sample.heap_mb = await collectHeapMb(page);

    // DOM nodes
    sample.dom_nodes = await collectDomNodes(page);

    // Extension-specific: blur count.
    // data-bl-si-blur is stamped on textCheck elements; alwaysBlur elements
    // (img, video, canvas, etc.) are blurred via CSS injection only, no attribute.
    // When #bl-si-blur-styles exists, CSS is active — include those elements too.
    if (stateName !== 'vanilla') {
      sample.blur_count = await page.evaluate(() => {
        const stamped = document.querySelectorAll('[data-bl-si-blur]').length;
        if (!document.querySelector('#bl-si-blur-styles')) return stamped;
        const cssOnly = document.querySelectorAll(
          'img, video, audio, canvas, ' +
          'svg:not(#bl-si-svg-filter):not([class*="bl-si"]), ' +
          'h1, h2, h3, h4, h5, h6, blockquote, pre, code, mark, strong, em, ' +
          'b, i, u, s, abbr, cite, q, time, address, ' +
          'li, dt, dd, ' +
          'input, textarea, select, button, label, fieldset, ' +
          'table, thead, tbody, tr, td, th, caption'
        ).length;
        return stamped + cssOnly;
      });
    }

    // PII count
    if (stateName === 'pii_only' || stateName === 'all_active') {
      sample.pii_count = await page.evaluate(() => document.querySelectorAll('[data-bl-si-pii]').length);
    }

    // Timing values
    if (needsBlurTiming) {
      sample.blur_ms = await page.evaluate(() => window.__blurTiming);
    }
    if (needsPiiTiming) {
      sample.pii_ms = await page.evaluate(() => window.__piiTiming);
    }

    // Long tasks
    sample.long_task_count    = await page.evaluate(() => (window.__longTasks || []).length);
    sample.long_task_total_ms = await page.evaluate(() => (window.__longTasks || []).reduce((s, v) => s + v, 0));

    // Pick & Blur timing — activate picker via TOGGLE_PICKER, then drag to create zone.
    // pick_and_blur.status:true makes picker available, but doesn't activate it;
    // the content script requires TOGGLE_PICKER message to open the picker UI.
    if (stateName === 'pick_blur') {
      try {
        // Activate the picker on this tab via the service worker.
        // Use wildcard URL query — exact URL match is flaky in headless mode.
        await sw.evaluate(async (port) => {
          const tabs = await new Promise((resolve) =>
            chrome.tabs.query({ url: `http://127.0.0.1:${port}/*` }, resolve)
          );
          if (!tabs || tabs.length === 0) throw new Error('No fixture tab on port ' + port);
          await new Promise((resolve) => chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PICKER' }, resolve));
        }, new URL(page.url()).port);

        // Wait for picker-active class on <html> (null = no arg, then options)
        await page.waitForFunction(
          () => document.documentElement.classList.contains('bl-si-picker-active'),
          null,
          { timeout: 5000 }
        );

        // Drag to draw a sticky zone
        const drag = PICK_BLUR_DRAG[fixtureId] || PICK_BLUR_DRAG['picker'];
        const t0 = await page.evaluate(() => performance.now());
        await page.mouse.move(drag.start[0], drag.start[1]);
        await page.mouse.down();
        await page.mouse.move(drag.end[0], drag.end[1], { steps: 10 });
        await page.mouse.up();

        await page.waitForFunction(
          () => document.querySelector('.bl-si-zone-overlay') !== null,
          null,
          { timeout: 5000 }
        );
        sample.pick_ms = await page.evaluate((startTime) => Math.round(performance.now() - startTime), t0);
      } catch (pickErr) {
        console.warn(`    [warn] pick_blur failed for ${fixtureId}: ${pickErr.message}`);
        sample.pick_ms = null;
      }
    }

    // Style recalculation metrics via CDP (blur_all / all_active only)
    if (cdpSession) {
      try {
        const { metrics } = await cdpSession.send('Performance.getMetrics');
        const find = (name) => metrics.find((m) => m.name === name)?.value ?? null;
        sample.recalc_style_count    = find('RecalcStyleCount');
        sample.recalc_style_duration = find('RecalcStyleDuration') != null
          ? Math.round(find('RecalcStyleDuration') * 1000)  // s → ms
          : null;
      } catch (_) {
        // CDP metrics unavailable
      }
      await cdpSession.detach();
      cdpSession = null;
    }

  } catch (err) {
    console.warn(`    [warn] iteration error for ${fixtureId}/${stateName}: ${err.message}`);
  } finally {
    if (cdpSession) { try { await cdpSession.detach(); } catch (_) {} }
    await page.close();
  }

  return sample;
}

// ---------------------------------------------------------------------------
// aggregateSamples — averages numeric fields across iterations and computes
// p50/p95 for timing arrays
// ---------------------------------------------------------------------------

function aggregateSamples(samples) {
  if (!samples || samples.length === 0) return {};

  // Collect all keys present across samples
  const keys = new Set();
  for (const s of samples) Object.keys(s).forEach((k) => keys.add(k));

  const result = {};
  const raw = {};

  for (const key of keys) {
    const allVals = samples.map((s) => (s[key] !== undefined ? s[key] : null));
    const vals = allVals.filter((v) => v !== null && v !== undefined);
    raw[key] = allVals;  // store per-iteration including nulls
    if (vals.length === 0) {
      result[key] = null;
      continue;
    }
    // Average for all scalar metrics; also produce p50/p95 for timing keys
    const sorted = [...vals].sort((a, b) => a - b);
    const n = sorted.length;
    result[key] = Math.round(vals.reduce((s, v) => s + v, 0) / n * 10) / 10;

    // p50/p95 for timing-specific fields (nearest-rank formula)
    if (key === 'blur_ms') {
      result.blur_p50 = sorted[Math.min(Math.ceil(n * 0.50) - 1, n - 1)];
      result.blur_p95 = sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)];
    } else if (key === 'pii_ms') {
      result.pii_p50 = sorted[Math.min(Math.ceil(n * 0.50) - 1, n - 1)];
      result.pii_p95 = sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)];
    } else if (key === 'pick_ms') {
      result.pick_p50 = sorted[Math.min(Math.ceil(n * 0.50) - 1, n - 1)];
      result.pick_p95 = sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)];
    }
    // Heap growth: emit raw time series and detect monotonic increase
    if (key === 'heap_mb') {
      result.heap_mb_series = allVals;
      if (vals.length >= 3) {
        // Least-squares slope (MB/iteration) — positive slope = potential leak
        const meanIdx = (vals.length - 1) / 2;
        const meanVal = vals.reduce((s, v) => s + v, 0) / vals.length;
        let num = 0, den = 0;
        vals.forEach((v, i) => { num += (i - meanIdx) * (v - meanVal); den += (i - meanIdx) ** 2; });
        result.heap_mb_slope = den > 0 ? Math.round((num / den) * 100) / 100 : 0;
      }
    }
    // Round CLS to 4 decimal places
    if (key === 'cls') {
      result[key] = Math.round(vals.reduce((s, v) => s + v, 0) / n * 10000) / 10000;
    }
  }

  result._raw = raw;
  return result;
}

// ---------------------------------------------------------------------------
// computeDeltas — subtracts vanilla metrics from each non-vanilla state
// ---------------------------------------------------------------------------

function computeDeltas(states, vanillaKey) {
  const vanilla = states[vanillaKey];
  if (!vanilla) return {};

  const DELTA_KEYS = ['fcp', 'lcp', 'cls', 'dcl', 'load', 'heap_mb', 'dom_nodes'];
  const deltas = {};

  for (const [stateName, metrics] of Object.entries(states)) {
    if (stateName === vanillaKey) continue;
    const d = {};
    for (const key of DELTA_KEYS) {
      if (metrics[key] != null && vanilla[key] != null) {
        const diff = metrics[key] - vanilla[key];
        d[key] = key === 'cls'
          ? Math.round(diff * 10000) / 10000
          : Math.round(diff * 10) / 10;
      } else {
        d[key] = null;
      }
    }
    deltas[`${stateName}_vs_vanilla`] = d;
  }

  return deltas;
}

// ---------------------------------------------------------------------------
// buildMarkdownTable — appends a section to COMPARISON.md
// ---------------------------------------------------------------------------

function buildMarkdownTable(fixtureId, timestamp, stateResults, stateNames) {
  const label = {
    vanilla:    'Vanilla',
    idle:       'Idle',
    blur_all:   'Blur-All',
    pii_only:   'PII Only',
    pick_blur:  'Pick&Blur',
    all_active: 'All Active',
  };

  // Determine columns to show
  const cols = stateNames.map((s) => label[s] || s);

  // Header
  const headerRow  = ['Metric', ...cols].join(' | ');
  const dividerRow = ['---',    ...cols.map(() => '---')].join(' | ');

  // Which metric rows to include
  const METRIC_ROWS = [
    { key: 'fcp',       label: 'FCP (ms)'    },
    { key: 'lcp',       label: 'LCP (ms)'    },
    { key: 'cls',       label: 'CLS'         },
    { key: 'dcl',       label: 'DCL (ms)'    },
    { key: 'load',      label: 'Load (ms)'   },
    { key: 'heap_mb',   label: 'Heap (MB)'   },
    { key: 'dom_nodes', label: 'DOM Nodes'   },
    { key: 'blur_count',label: 'Blur Count'  },
    { key: 'blur_p50',  label: 'Blur p50 (ms)' },
    { key: 'blur_p95',  label: 'Blur p95 (ms)' },
    { key: 'pii_count', label: 'PII Count'   },
    { key: 'pii_p50',   label: 'PII p50 (ms)' },
    { key: 'pii_p95',   label: 'PII p95 (ms)' },
    { key: 'pick_p50',  label: 'Pick p50 (ms)' },
    { key: 'pick_p95',  label: 'Pick p95 (ms)' },
  ];

  // Only include rows that have at least one non-null value across all states
  const activeRows = METRIC_ROWS.filter((row) =>
    stateNames.some((s) => stateResults[s] && stateResults[s][row.key] != null)
  );

  const dataRows = activeRows.map((row) => {
    const cells = stateNames.map((s) => {
      const v = stateResults[s] && stateResults[s][row.key];
      return v != null ? String(v) : '—';
    });
    return [row.label, ...cells].join(' | ');
  });

  // Delta section — vanilla vs others
  const vanillaIdx = stateNames.indexOf('vanilla');
  const deltaRows = [];
  if (vanillaIdx !== -1) {
    const DELTA_KEYS = ['fcp', 'lcp', 'cls', 'dcl', 'load', 'heap_mb', 'dom_nodes'];
    const deltaLabels = { fcp: 'FCP Δ', lcp: 'LCP Δ', cls: 'CLS Δ', dcl: 'DCL Δ', load: 'Load Δ', heap_mb: 'Heap Δ (MB)', dom_nodes: 'DOM Δ' };
    const vanilla = stateResults['vanilla'];

    for (const key of DELTA_KEYS) {
      const cells = stateNames.map((s) => {
        if (s === 'vanilla') return '—';
        const v   = stateResults[s] && stateResults[s][key];
        const ref = vanilla && vanilla[key];
        if (v == null || ref == null) return '—';
        const diff = key === 'cls'
          ? Math.round((v - ref) * 10000) / 10000
          : Math.round((v - ref) * 10) / 10;
        return (diff >= 0 ? '+' : '') + diff;
      });
      deltaRows.push([deltaLabels[key], ...cells].join(' | '));
    }
  }

  const separator = deltaRows.length > 0 ? '\n**Deltas vs Vanilla**\n\n' + ['Metric', ...cols].join(' | ') + '\n' + ['---', ...cols.map(() => '---')].join(' | ') + '\n' + deltaRows.join('\n') : '';

  return [
    `## ${fixtureId} — ${timestamp}`,
    '',
    `| ${headerRow} |`,
    `| ${dividerRow} |`,
    ...dataRows.map((r) => `| ${r} |`),
    ...(separator ? ['', separator] : []),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// ensureReportDirs — creates reports/ and reports/fixtures/ if missing
// ---------------------------------------------------------------------------

function ensureReportDirs() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(REPORTS_FIXTURES_DIR)) {
    fs.mkdirSync(REPORTS_FIXTURES_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// printConsoleSummary
// ---------------------------------------------------------------------------

function printConsoleSummary(fixtureId, stateResults, stateNames) {
  console.log('\n' + '─'.repeat(60));
  console.log(`Summary: ${fixtureId}`);
  console.log('─'.repeat(60));

  const colW = 12;
  const metricW = 18;
  const header = ['Metric'.padEnd(metricW), ...stateNames.map((s) => s.padEnd(colW))].join('  ');
  console.log(header);
  console.log('─'.repeat(header.length));

  const PRINT_KEYS = ['fcp', 'lcp', 'cls', 'dcl', 'load', 'heap_mb', 'dom_nodes', 'blur_count', 'blur_p50', 'blur_p95', 'pii_count', 'pii_p50', 'pii_p95', 'pick_p50', 'pick_p95'];
  for (const key of PRINT_KEYS) {
    const hasAny = stateNames.some((s) => stateResults[s] && stateResults[s][key] != null);
    if (!hasAny) continue;
    const cells = stateNames.map((s) => {
      const v = stateResults[s] && stateResults[s][key];
      return (v != null ? String(v) : '—').padEnd(colW);
    });
    console.log([key.padEnd(metricW), ...cells].join('  '));
  }
  console.log('─'.repeat(60));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args      = process.argv.slice(2);
  const fixtureId = args.find((a) => !a.startsWith('--'));
  const HEADLESS  = args.includes('--headless');

  if (!fixtureId || !FIXTURE_MATRIX[fixtureId]) {
    console.error(`Error: unknown fixture "${fixtureId}"`);
    console.error(`Known fixtures: ${Object.keys(FIXTURE_MATRIX).join(', ')}`);
    process.exit(1);
  }

  const RADIUS_SWEEP  = args.includes('--radius-sweep');
  const THOROUGH_BLUR = args.includes('--thorough-blur');

  const stateNames = FIXTURE_MATRIX[fixtureId];

  // Build activeStates map: stateName → patch object (null for vanilla).
  // Extra sweep states are appended when the corresponding flag is present.
  const activeStates = Object.assign({}, STATES);
  if (RADIUS_SWEEP)  Object.assign(activeStates, RADIUS_SWEEP_STATES);
  if (THOROUGH_BLUR) Object.assign(activeStates, THOROUGH_BLUR_STATES);

  // Final list of state names to run (preserves FIXTURE_MATRIX order, appends sweeps).
  const allStateNames = stateNames.slice();
  if (RADIUS_SWEEP) {
    for (const k of Object.keys(RADIUS_SWEEP_STATES)) {
      if (!allStateNames.includes(k)) allStateNames.push(k);
    }
  }
  if (THOROUGH_BLUR) {
    for (const k of Object.keys(THOROUGH_BLUR_STATES)) {
      if (!allStateNames.includes(k)) allStateNames.push(k);
    }
  }

  console.log(`\n[run-fixture] ${fixtureId}  states: ${allStateNames.join(', ')}`);

  // Ensure report dirs exist
  ensureReportDirs();

  // Start fixture HTTP server
  let server, port;
  if (process.env.PERF_FIXTURE_PORT) {
    port = Number(process.env.PERF_FIXTURE_PORT);
    console.log(`[run-fixture] Reusing fixture server at port ${port}`);
  } else {
    ({ server, port } = await startFixtureServer());
    console.log(`[run-fixture] Fixture server started at http://127.0.0.1:${port}`);
  }

  const fixtureUrl = `http://127.0.0.1:${port}/page-${fixtureId}.html`;
  const stateResults = {};

  // ──────────────────────────────────────────────────────────────────────────
  // VANILLA state — persistent context, no extension loaded.
  // Uses launchPersistentContext (same model as extension states) so both sides
  // warm V8 JIT and HTTP cache at the same rate across iterations. The only
  // difference is the absence of --load-extension, giving a clean apples-to-apples
  // FCP delta that reflects extension overhead, not context model differences.
  // ──────────────────────────────────────────────────────────────────────────
  if (allStateNames.includes('vanilla')) {
    console.log('\n[vanilla] Launching persistent context (no extension)...');
    const vanillaCtx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-precise-memory-info',
        ...(HEADLESS ? ['--headless=new'] : []),
      ],
    });
    const vanillaSamples = [];

    // Warmup pass: first page in any persistent context is still cold.
    // Navigate once and discard so iteration 1 matches the extension context's
    // warm state (which is pre-warmed by the extension SW loading at launch).
    console.log('  [vanilla] warmup pass...');
    {
      const wPage = await vanillaCtx.newPage();
      try {
        await wPage.goto(fixtureUrl);
        await wPage.waitForLoadState('load');
      } catch (_) {}
      await wPage.close();
    }

    for (let i = 0; i < ITERATIONS; i++) {
      console.log(`  [vanilla] iteration ${i + 1}/${ITERATIONS}`);
      const page = await vanillaCtx.newPage();
      const sample = {};

      try {
        const collectVitals = await setupWebVitals(page);
        await injectLongTaskObserver(page);
        await page.goto(fixtureUrl);
        await page.waitForLoadState('load');
        // No extension in vanilla — signal ready immediately so collect() returns
        await page.evaluate(() => { window.__blsiReady = true; });

        const vitals  = await collectVitals();
        sample.fcp = vitals.fcp;
        sample.lcp = vitals.lcp;
        sample.cls = Math.round(vitals.cls * 10000) / 10000;

        const nav = await collectNavTiming(page);
        sample.dcl  = nav.dcl;
        sample.load = nav.load;

        sample.heap_mb   = await collectHeapMb(page);
        sample.dom_nodes = await collectDomNodes(page);
        sample.long_task_count    = await page.evaluate(() => (window.__longTasks || []).length);
        sample.long_task_total_ms = await page.evaluate(() => (window.__longTasks || []).reduce((s, v) => s + v, 0));
      } catch (err) {
        console.warn(`  [warn] vanilla iteration ${i + 1} failed: ${err.message}`);
      } finally {
        await page.close();
      }

      vanillaSamples.push(sample);
    }

    await vanillaCtx.close();
    stateResults.vanilla = aggregateSamples(vanillaSamples);
    console.log(`  [vanilla] fcp=${stateResults.vanilla.fcp}ms  lcp=${stateResults.vanilla.lcp}ms  heap=${stateResults.vanilla.heap_mb}MB`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EXTENSION states — one persistent context reused across all ext states
  // ──────────────────────────────────────────────────────────────────────────
  const extStateNames = allStateNames.filter((s) => s !== 'vanilla');

  if (extStateNames.length > 0) {
    console.log('\n[extension] Launching extension context...');
    // Extensions + service workers require '--headless=new' (Chrome 112+).
    // Setting headless:false + '--headless=new' arg lets Playwright skip its
    // own old-headless flag while still running Chrome in new headless mode.
    const extContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-precise-memory-info',
        ...(HEADLESS ? ['--headless=new'] : []),
      ],
    });

    // Wait for service worker
    let sw = extContext.serviceWorkers()[0];
    if (!sw) sw = await extContext.waitForEvent('serviceworker', { timeout: 15000 });
    console.log('[extension] Service worker ready');

    // Seed clean default model once
    await sw.evaluate((seedJson) => {
      return new Promise((resolve) => chrome.storage.local.set({ blsi_model: JSON.parse(seedJson) }, resolve));
    }, JSON.stringify(DEFAULT_SEED));
    console.log('[extension] Default seed written');

    for (const stateName of extStateNames) {
      console.log(`\n[${stateName}] Running ${ITERATIONS} iterations...`);
      const stateSamples = [];
      const statePatch = activeStates[stateName];

      // Warmup: 2 discarded iterations before measurement
      console.log(`  [${stateName}] warming up (2 iterations)...`);
      for (let w = 0; w < 2; w++) {
        const wPage = await extContext.newPage();
        try {
          await setModel(sw, statePatch);
          await wPage.goto(fixtureUrl, { waitUntil: 'load' });
          await wPage.waitForLoadState('networkidle').catch(() => {});
        } catch (_) {}
        await wPage.close();
      }

      for (let i = 0; i < ITERATIONS; i++) {
        console.log(`  [${stateName}] iteration ${i + 1}/${ITERATIONS}`);

        // Write model patch BEFORE navigation
        await setModel(sw, statePatch);

        let sample = {};
        try {
          sample = await measureOneIteration(extContext, fixtureUrl, stateName, fixtureId, sw);
        } catch (err) {
          console.warn(`  [warn] ${stateName} iteration ${i + 1} failed: ${err.message}`);
        }
        stateSamples.push(sample);
      }

      stateResults[stateName] = aggregateSamples(stateSamples);
      const r = stateResults[stateName];
      console.log(`  [${stateName}] fcp=${r.fcp}ms  lcp=${r.lcp}ms  heap=${r.heap_mb}MB  blur=${r.blur_count}`);
      if (r.blur_p50 != null)  console.log(`  [${stateName}] blur_p50=${r.blur_p50}ms  blur_p95=${r.blur_p95}ms`);
      if (r.pii_p50  != null)  console.log(`  [${stateName}] pii_p50=${r.pii_p50}ms  pii_p95=${r.pii_p95}ms`);
      if (r.pick_p50 != null)  console.log(`  [${stateName}] pick_p50=${r.pick_p50}ms  pick_p95=${r.pick_p95}ms`);
    }

    await extContext.close();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Compute deltas and write outputs
  // ──────────────────────────────────────────────────────────────────────────
  const deltas = computeDeltas(stateResults, 'vanilla');
  const timestamp = new Date().toISOString();

  // Compute p95 budgets (125% headroom above measured p95 / fcp)
  const budgets = {};
  for (const [stateName, metrics] of Object.entries(stateResults)) {
    if (metrics && metrics.blur_p95 != null) budgets[`blur_all.${fixtureId}.p95_ms`] = Math.round(metrics.blur_p95 * 1.25);
    if (metrics && metrics.pii_p95  != null) budgets[`pii.${fixtureId}.p95_ms`]      = Math.round(metrics.pii_p95  * 1.25);
    if (metrics && metrics.pick_p95 != null) budgets[`pick_blur.${fixtureId}.p95_ms`] = Math.round(metrics.pick_p95 * 1.25);
    if (metrics && metrics.fcp      != null) budgets[`fcp.${fixtureId}.budget_ms`]    = Math.round(metrics.fcp     * 1.25);
  }

  const jsonOutput = {
    fixture:   fixtureId,
    timestamp,
    states:    stateResults,
    deltas,
    budgets,
  };

  const jsonPath = path.join(REPORTS_FIXTURES_DIR, `${fixtureId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2), 'utf8');
  console.log(`\n[run-fixture] Wrote ${jsonPath}`);

  // Append to COMPARISON.md
  const mdSection = buildMarkdownTable(fixtureId, timestamp, stateResults, allStateNames);
  fs.appendFileSync(COMPARISON_MD, '\n' + mdSection + '\n', 'utf8');
  console.log(`[run-fixture] Appended to ${COMPARISON_MD}`);

  // Console summary table
  printConsoleSummary(fixtureId, stateResults, allStateNames);

  // Stop server if we started it
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    console.log('[run-fixture] Fixture server stopped');
  }
}

main().catch((err) => {
  console.error('[run-fixture] Fatal error:', err);
  process.exit(1);
});
