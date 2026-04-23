'use strict';

// run-all-fixtures.js — runs all 8 fixtures sequentially by spawning
// `node run-fixture.js <id>` for each one.
//
// Usage:
//   node run-all-fixtures.js             # headed (visible browser)
//   node run-all-fixtures.js --headless  # headless (background-safe)

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FIXTURE_IDS = ['text-heavy', 'pii-rich', 'comprehensive', 'reveal', 'picker', 'spa', 'forms', 'media'];
const HEADLESS_FLAG = process.argv.includes('--headless') ? ' --headless' : '';

for (const id of FIXTURE_IDS) {
  console.log(`\n${'='.repeat(60)}\nRunning fixture: ${id}\n${'='.repeat(60)}`);
  try {
    execSync(`node ${path.join(__dirname, 'run-fixture.js')} ${id}${HEADLESS_FLAG}`, {
      stdio: 'inherit',
      cwd: __dirname,
    });
  } catch (err) {
    console.error(`Fixture ${id} failed:`, err.message);
    // continue to next fixture
  }
}

console.log('\nAll fixtures complete. See reports/COMPARISON.md');

// Generate baseline from collected data
const baselinePath = path.join(__dirname, 'scripts', 'generate-baseline.js');
if (fs.existsSync(baselinePath)) {
  console.log('\nGenerating perf-baseline.json...');
  try {
    execSync(`node ${baselinePath}`, { stdio: 'inherit', cwd: __dirname });
  } catch (err) {
    console.error('Baseline generation failed:', err.message);
  }
}
