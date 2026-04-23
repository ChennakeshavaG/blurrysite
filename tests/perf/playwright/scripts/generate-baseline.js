'use strict';

// generate-baseline.js — reads all reports/fixtures/*.json files and derives
// perf budgets at 1.25× the measured p95 / median FCP values.
//
// Usage:
//   node scripts/generate-baseline.js
//
// Writes: reports/perf-baseline.json
// Prints: summary table to stdout

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PLAYWRIGHT_DIR   = path.join(__dirname, '..');
const REPORTS_DIR      = path.join(PLAYWRIGHT_DIR, 'reports');
const FIXTURES_DIR     = path.join(REPORTS_DIR, 'fixtures');
const BASELINE_PATH    = path.join(REPORTS_DIR, 'perf-baseline.json');

const BUDGET_MULTIPLIER = 1.25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return String(Math.round(n));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error('[generate-baseline] No fixtures directory found at:', FIXTURES_DIR);
    process.exit(1);
  }

  const fixtureFiles = fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json') && !f.includes('_radius_sweep') && !f.includes('_thorough'));

  if (fixtureFiles.length === 0) {
    console.error('[generate-baseline] No fixture JSON files found in:', FIXTURES_DIR);
    process.exit(1);
  }

  const fixturesAnalyzed = [];
  const budgets = {};

  // Rows for summary table: [fixtureId, metric, measuredValue, budgetValue]
  const summaryRows = [];

  for (const file of fixtureFiles) {
    const filePath  = path.join(FIXTURES_DIR, file);
    const data      = readJson(filePath);
    if (!data || !data.states) continue;

    const fixtureId = data.fixture || path.basename(file, '.json');
    fixturesAnalyzed.push(fixtureId);

    const states = data.states;

    // Extract blur_p95 from blur_all or all_active state
    for (const stateName of ['blur_all', 'all_active']) {
      const metrics = states[stateName];
      if (metrics && metrics.blur_p95 != null) {
        const key    = `blur_all.${fixtureId}.p95_ms`;
        const budget = Math.round(metrics.blur_p95 * BUDGET_MULTIPLIER);
        budgets[key] = budget;
        summaryRows.push([fixtureId, 'blur_p95', fmt(metrics.blur_p95), fmt(budget), key]);
        break; // prefer blur_all, fall back to all_active
      }
    }

    // Extract pii_p95 from pii_only or all_active state
    for (const stateName of ['pii_only', 'all_active']) {
      const metrics = states[stateName];
      if (metrics && metrics.pii_p95 != null) {
        const key    = `pii.${fixtureId}.p95_ms`;
        const budget = Math.round(metrics.pii_p95 * BUDGET_MULTIPLIER);
        budgets[key] = budget;
        summaryRows.push([fixtureId, 'pii_p95', fmt(metrics.pii_p95), fmt(budget), key]);
        break;
      }
    }

    // Extract pick_p95 from pick_blur or all_active state
    for (const stateName of ['pick_blur', 'all_active']) {
      const metrics = states[stateName];
      if (metrics && metrics.pick_p95 != null) {
        const key    = `pick_blur.${fixtureId}.p95_ms`;
        const budget = Math.round(metrics.pick_p95 * BUDGET_MULTIPLIER);
        budgets[key] = budget;
        summaryRows.push([fixtureId, 'pick_p95', fmt(metrics.pick_p95), fmt(budget), key]);
        break;
      }
    }

    // Extract FCP median from vanilla state (cleanest baseline); fall back to idle/blur_all
    for (const stateName of ['vanilla', 'idle', 'blur_all']) {
      const metrics = states[stateName];
      if (metrics && metrics.fcp != null) {
        const key    = `fcp.${fixtureId}.budget_ms`;
        const budget = Math.round(metrics.fcp * BUDGET_MULTIPLIER);
        budgets[key] = budget;
        summaryRows.push([fixtureId, `fcp(${stateName})`, fmt(metrics.fcp), fmt(budget), key]);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Write perf-baseline.json
  // ---------------------------------------------------------------------------
  const output = Object.assign(
    {
      _meta: {
        generated:         new Date().toISOString(),
        source:            'generate-baseline.js',
        fixtures_analyzed: fixturesAnalyzed,
        budget_multiplier: BUDGET_MULTIPLIER,
      },
    },
    budgets
  );

  fs.writeFileSync(BASELINE_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log('[generate-baseline] Written: reports/perf-baseline.json');

  // ---------------------------------------------------------------------------
  // Print summary table
  // ---------------------------------------------------------------------------
  if (summaryRows.length === 0) {
    console.log('[generate-baseline] No metrics found in fixture reports.');
    return;
  }

  const col = [14, 16, 12, 12, 40];
  const header = [
    'Fixture'.padEnd(col[0]),
    'Metric'.padEnd(col[1]),
    'Measured'.padEnd(col[2]),
    'Budget'.padEnd(col[3]),
    'Key'.padEnd(col[4]),
  ].join('  ');
  const divider = '-'.repeat(header.length);

  console.log('\n' + divider);
  console.log(header);
  console.log(divider);
  for (const row of summaryRows) {
    console.log([
      row[0].padEnd(col[0]),
      row[1].padEnd(col[1]),
      row[2].padEnd(col[2]),
      row[3].padEnd(col[3]),
      row[4].padEnd(col[4]),
    ].join('  '));
  }
  console.log(divider);
  console.log(`\n${summaryRows.length} budget entries from ${fixturesAnalyzed.length} fixture(s).`);
}

main();
