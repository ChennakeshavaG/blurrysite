'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function reportPath(name) {
  return path.join(REPORTS_DIR, name);
}

// ---------------------------------------------------------------------------
// Budget table
// ---------------------------------------------------------------------------
const BUDGETS = {
  'blur-all:text-heavy':    { budget: 300,  label: '<300ms'  },
  'blur-all:comprehensive': { budget: 500,  label: '<500ms'  },
  'pii:email+numeric':      { budget: 1000, label: '<1000ms' },
  'pii:email-only':         { budget: 600,  label: '<600ms'  },
  'picker:activation':      { budget: 150,  label: '<150ms'  },
  'picker:deactivation':    { budget: 150,  label: '<150ms'  },
  'spa:text':               { budget: 400,  label: '<400ms'  },
  'spa:forms':              { budget: 200,  label: '<200ms'  },
  'spa:table':              { budget: 1000, label: '<1000ms' },
  'spa:media':              { budget: 200,  label: '<200ms'  },
  'spa:mixed':              { budget: 300,  label: '<300ms'  },
  'reveal:flat':            { budget: 80,   label: '<80ms'   },
  'reveal:nested':          { budget: 120,  label: '<120ms'  },
  'reveal:unreveal':        { budget: 80,   label: '<80ms'   },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read + parse a JSON file. Returns null if the file is missing or unparseable.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Format a number: 1 decimal place when < 10, integer otherwise.
 * Returns '—' for null/undefined/NaN.
 * @param {number|null|undefined} n
 * @returns {string}
 */
function fmt(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

/**
 * Returns '✓ PASS' when p95 <= budget, '✗ FAIL' otherwise.
 * @param {number|null|undefined} p95
 * @param {number} budget
 * @returns {string}
 */
function pass(p95, budget) {
  if (p95 == null || Number.isNaN(p95)) return '? N/A';
  return p95 <= budget ? '✓ PASS' : '✗ FAIL';
}

/**
 * Look up the budget entry by key.
 * @param {string} key
 * @returns {{ budget: number, label: string }}
 */
function budget(key) {
  return BUDGETS[key] || { budget: Infinity, label: 'none' };
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

/**
 * Section 00 — Baseline (extension idle)
 * Shape: { timestamp, results: [{ pageId, fcp, lcp, cls, heapUsedMB, blurredCount }] }
 */
function renderBaseline(data) {
  if (!data) return '_No data — `reports/00-baseline-raw.json` not found._\n';

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length === 0) return '_No results in `00-baseline-raw.json`._\n';

  const header = [
    '| Page | FCP (ms) | LCP (ms) | CLS | Heap (MB) |',
    '|---|---|---|---|---|',
  ];
  const rows = results.map(r => {
    const cls = (r.cls != null && !Number.isNaN(r.cls))
      ? r.cls.toFixed(3)
      : '—';
    return `| ${r.pageId || '—'} | ${fmt(r.fcp)} | ${fmt(r.lcp)} | ${cls} | ${fmt(r.heapUsedMB)} |`;
  });

  return [...header, ...rows].join('\n') + '\n';
}

/**
 * Section 01 — Blur-All Activation
 * Shape: { timestamp, tests: [{ page, threshold, iterations, durations, stats }] }
 */
function renderBlurAll(data) {
  if (!data) return '_No data — `reports/01-blur-all-raw.json` not found._\n';

  const tests = Array.isArray(data.tests) ? data.tests : [];
  if (tests.length === 0) return '_No tests in `01-blur-all-raw.json`._\n';

  const header = [
    '| Page | Threshold | n | p50 (ms) | p95 (ms) | max (ms) | Budget | Result |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const rows = tests.map(t => {
    const s    = t.stats || {};
    const key  = `blur-all:${t.page}`;
    const b    = budget(key);
    const res  = pass(s.p95, b.budget);
    return `| ${t.page || '—'} | ${fmt(t.threshold)} | ${s.n != null ? s.n : '—'} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${b.label} | ${res} |`;
  });

  return [...header, ...rows].join('\n') + '\n';
}

/**
 * Section 02 — PII Scan
 * Shape: { timestamp, tests: [{ pattern, threshold, iterations, durations, stats }] }
 */
function renderPii(data) {
  if (!data) return '_No data — `reports/02-pii-raw.json` not found._\n';

  const tests = Array.isArray(data.tests) ? data.tests : [];
  if (tests.length === 0) return '_No tests in `02-pii-raw.json`._\n';

  const header = [
    '| Pattern | Threshold | n | p50 (ms) | p95 (ms) | max (ms) | Budget | Result |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const rows = tests.map(t => {
    const s   = t.stats || {};
    const key = `pii:${t.pattern}`;
    const b   = budget(key);
    const res = pass(s.p95, b.budget);
    return `| ${t.pattern || '—'} | ${fmt(t.threshold)} | ${s.n != null ? s.n : '—'} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${b.label} | ${res} |`;
  });

  return [...header, ...rows].join('\n') + '\n';
}

/**
 * Section 03 — Picker Activation
 * Shape: {
 *   timestamp,
 *   activationDurations, activateStats,
 *   deactivationDurations, deactivateStats
 * }
 */
function renderPicker(data) {
  if (!data) return '_No data — `reports/03-picker-raw.json` not found._\n';

  const header = [
    '| Action | n | p50 (ms) | p95 (ms) | max (ms) | Budget | Result |',
    '|---|---|---|---|---|---|---|',
  ];

  const rows = [];

  // Activation row
  const as  = data.activateStats || {};
  const ab  = budget('picker:activation');
  const ar  = pass(as.p95, ab.budget);
  rows.push(`| Activation | ${as.n != null ? as.n : '—'} | ${fmt(as.p50)} | ${fmt(as.p95)} | ${fmt(as.max)} | ${ab.label} | ${ar} |`);

  // Deactivation row
  const ds  = data.deactivateStats || {};
  const db  = budget('picker:deactivation');
  const dr  = pass(ds.p95, db.budget);
  rows.push(`| Deactivation | ${ds.n != null ? ds.n : '—'} | ${fmt(ds.p50)} | ${fmt(ds.p95)} | ${fmt(ds.max)} | ${db.label} | ${dr} |`);

  return [...header, ...rows].join('\n') + '\n';
}

/**
 * Section 04 — SPA Navigation Reconcile
 * Shape: {
 *   timestamp,
 *   routes: {
 *     text:   { threshold, iterations, durations, stats },
 *     forms:  { ... },
 *     table:  { ... },
 *     media:  { ... },
 *     mixed:  { ... },
 *   }
 * }
 */
function renderSpa(data) {
  if (!data) return '_No data — `reports/04-spa-raw.json` not found._\n';

  const routes = data.routes || {};
  const routeNames = ['text', 'forms', 'table', 'media', 'mixed'];

  const header = [
    '| Route | Threshold | n | p50 (ms) | p95 (ms) | max (ms) | Budget | Result |',
    '|---|---|---|---|---|---|---|---|',
  ];

  const rows = routeNames.map(name => {
    const r   = routes[name];
    if (!r) return `| ${name} | — | — | — | — | — | — | ? N/A |`;
    const s   = r.stats || {};
    const b   = budget(`spa:${name}`);
    const res = pass(s.p95, b.budget);
    return `| ${name} | ${fmt(r.threshold)} | ${s.n != null ? s.n : '—'} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${b.label} | ${res} |`;
  });

  return [...header, ...rows].join('\n') + '\n';
}

/**
 * Section 05 — Reveal Controller
 * Shape: {
 *   timestamp,
 *   flat:     { threshold?, iterations?, durations, stats },
 *   nested:   { ... },
 *   unreveal: { ... },
 * }
 */
function renderReveal(data) {
  if (!data) return '_No data — `reports/05-reveal-raw.json` not found._\n';

  const scenarioNames = ['flat', 'nested', 'unreveal'];

  const header = [
    '| Scenario | n | p50 (ms) | p95 (ms) | max (ms) | Budget | Result |',
    '|---|---|---|---|---|---|---|',
  ];

  const rows = scenarioNames.map(name => {
    const sc  = data[name];
    if (!sc) return `| ${name} | — | — | — | — | — | ? N/A |`;
    const s   = sc.stats || {};
    const b   = budget(`reveal:${name}`);
    const res = pass(s.p95, b.budget);
    return `| ${name} | ${s.n != null ? s.n : '—'} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${b.label} | ${res} |`;
  });

  return [...header, ...rows].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

/**
 * Collect pass/fail counts from each suite's parsed data.
 * Returns an array of { suite, tests, pass, fail } rows.
 */
function buildSummary(blurAllData, piiData, pickerData, spaData, revealData) {
  const rows = [];

  // --- Blur-All ---
  if (blurAllData && Array.isArray(blurAllData.tests)) {
    let p = 0, f = 0;
    blurAllData.tests.forEach(t => {
      const s = t.stats || {};
      const b = budget(`blur-all:${t.page}`);
      if (s.p95 != null) {
        s.p95 <= b.budget ? p++ : f++;
      }
    });
    rows.push({ suite: 'Blur-All', tests: blurAllData.tests.length, pass: p, fail: f });
  }

  // --- PII ---
  if (piiData && Array.isArray(piiData.tests)) {
    let p = 0, f = 0;
    piiData.tests.forEach(t => {
      const s = t.stats || {};
      const b = budget(`pii:${t.pattern}`);
      if (s.p95 != null) {
        s.p95 <= b.budget ? p++ : f++;
      }
    });
    rows.push({ suite: 'PII Scan', tests: piiData.tests.length, pass: p, fail: f });
  }

  // --- Picker ---
  if (pickerData) {
    let p = 0, f = 0, total = 0;
    const checkPicker = (stats, key) => {
      const s = stats || {};
      const b = budget(key);
      if (s.p95 != null) {
        total++;
        s.p95 <= b.budget ? p++ : f++;
      }
    };
    checkPicker(pickerData.activateStats,   'picker:activation');
    checkPicker(pickerData.deactivateStats, 'picker:deactivation');
    rows.push({ suite: 'Picker', tests: total, pass: p, fail: f });
  }

  // --- SPA ---
  if (spaData && spaData.routes) {
    const routeNames = ['text', 'forms', 'table', 'media', 'mixed'];
    let p = 0, f = 0, total = 0;
    routeNames.forEach(name => {
      const r = spaData.routes[name];
      if (!r) return;
      const s = r.stats || {};
      const b = budget(`spa:${name}`);
      if (s.p95 != null) {
        total++;
        s.p95 <= b.budget ? p++ : f++;
      }
    });
    rows.push({ suite: 'SPA Navigation', tests: total, pass: p, fail: f });
  }

  // --- Reveal ---
  if (revealData) {
    const scenarioNames = ['flat', 'nested', 'unreveal'];
    let p = 0, f = 0, total = 0;
    scenarioNames.forEach(name => {
      const sc = revealData[name];
      if (!sc) return;
      const s = sc.stats || {};
      const b = budget(`reveal:${name}`);
      if (s.p95 != null) {
        total++;
        s.p95 <= b.budget ? p++ : f++;
      }
    });
    rows.push({ suite: 'Reveal Controller', tests: total, pass: p, fail: f });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Read all raw JSON files (null if missing)
  const baselineData  = readJson(reportPath('00-baseline-raw.json'));
  const blurAllData   = readJson(reportPath('01-blur-all-raw.json'));
  const piiData       = readJson(reportPath('02-pii-raw.json'));
  const pickerData    = readJson(reportPath('03-picker-raw.json'));
  const spaData       = readJson(reportPath('04-spa-raw.json'));
  const revealData    = readJson(reportPath('05-reveal-raw.json'));

  // Use the latest timestamp we can find, falling back to now
  const ts =
    (baselineData && baselineData.timestamp)  ||
    (blurAllData  && blurAllData.timestamp)   ||
    (piiData      && piiData.timestamp)       ||
    (pickerData   && pickerData.timestamp)    ||
    (spaData      && spaData.timestamp)       ||
    (revealData   && revealData.timestamp)    ||
    new Date().toISOString();

  // Build summary rows for the final section
  const summaryRows = buildSummary(blurAllData, piiData, pickerData, spaData, revealData);
  const totalPass   = summaryRows.reduce((acc, r) => acc + r.pass, 0);
  const totalFail   = summaryRows.reduce((acc, r) => acc + r.fail, 0);

  // Assemble the markdown
  const lines = [];

  lines.push('# BlurrySite Perf Report — Playwright Suite');
  lines.push('');
  lines.push(`Generated: ${ts}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Section 00
  lines.push('## 00 — Baseline (extension idle)');
  lines.push('');
  lines.push(renderBaseline(baselineData));
  lines.push('---');
  lines.push('');

  // Section 01
  lines.push('## 01 — Blur-All Activation');
  lines.push('');
  lines.push(renderBlurAll(blurAllData));
  lines.push('---');
  lines.push('');

  // Section 02
  lines.push('## 02 — PII Scan');
  lines.push('');
  lines.push(renderPii(piiData));
  lines.push('---');
  lines.push('');

  // Section 03
  lines.push('## 03 — Picker Activation');
  lines.push('');
  lines.push(renderPicker(pickerData));
  lines.push('---');
  lines.push('');

  // Section 04
  lines.push('## 04 — SPA Navigation Reconcile');
  lines.push('');
  lines.push(renderSpa(spaData));
  lines.push('---');
  lines.push('');

  // Section 05
  lines.push('## 05 — Reveal Controller');
  lines.push('');
  lines.push(renderReveal(revealData));
  lines.push('---');
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  if (summaryRows.length === 0) {
    lines.push('_No benchmark data available._');
  } else {
    lines.push('| Suite | Tests | Pass | Fail |');
    lines.push('|---|---|---|---|');
    summaryRows.forEach(r => {
      lines.push(`| ${r.suite} | ${r.tests} | ${r.pass} | ${r.fail} |`);
    });
    lines.push('');
    lines.push(`Overall: **${totalPass} PASS**, **${totalFail} FAIL**`);
  }
  lines.push('');

  const output = lines.join('\n');

  // Write report
  const outPath = reportPath('REPORT.md');
  fs.writeFileSync(outPath, output, 'utf8');
  console.log('[report] Written: reports/REPORT.md');
}

main();
