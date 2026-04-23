'use strict';

// Custom Playwright test fixture for the BlurrySite MV3 Chrome extension.
//
// Usage in test files:
//   const { test, expect, setModel } = require('../fixtures/extension');
//
// Fixtures available in test({ extContext, extSw, fixtureUrl }):
//   extContext  — worker-scoped BrowserContext with extension loaded (1 Chrome launch per worker)
//   extSw       — worker-scoped ServiceWorker handle (waited for once, before any test runs)
//   fixtureUrl  — test-scoped factory: fixtureUrl('text-heavy') → http://127.0.0.1:PORT/page-text-heavy.html

const path = require('path');
const { test: base, chromium } = require('@playwright/test');

// Extension root — four levels up from this file (fixtures/ → playwright/ → perf/ → tests/ → blurrysite/)
const EXT_PATH = path.resolve(__dirname, '../../../..');

const DEFAULT_SEED = {
  settings: {
    enabled: true,
    blur_radius: 12,
    reveal_mode: 'hover',
    thorough_blur: false,
    blur_categories: { text: true, media: true, form: true, table: true, structure: true },
  },
  blur_all: { status: false, settings: {} },
  auto_detect_pii: { status: false, settings: { email: false, numeric: false } },
  pick_and_blur: { status: false, settings: {} },
  automate: {
    status: false,
    settings: {
      idle: { value: 5, unit: 'min', enabled: false },
      tab_switch: { enabled: false },
    },
  },
  shortcuts: {},
  site_rules: [],
};

// setModel — deep-merges a patch into blsi_model via the service worker.
// The evaluate callback is self-contained (no closures) — patch passed as JSON string.
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

const test = base.extend({
  // extContext (worker scope) — one Chrome launch per worker, extension loaded.
  // THE CRITICAL FIX: service worker is waited for HERE, once, before any test runs.
  // eslint-disable-next-line no-empty-pattern
  extContext: [async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
        ...(process.env.CI ? ['--headless=new'] : []),
      ],
    });

    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });

    // Seed clean default model once per worker
    await sw.evaluate((seedJson) => {
      return new Promise((resolve) => chrome.storage.local.set({ blsi_model: JSON.parse(seedJson) }, resolve));
    }, JSON.stringify(DEFAULT_SEED));

    ctx._sw = sw;
    await use(ctx);
    await ctx.close();
  }, { scope: 'worker' }],

  // extSw (worker scope) — the extension service worker, captured during extContext setup.
  extSw: [async ({ extContext }, use) => {
    await use(extContext._sw);
  }, { scope: 'worker' }],

  // fixtureUrl (test scope) — maps page ID to fixture server URL.
  // eslint-disable-next-line no-empty-pattern
  fixtureUrl: [async ({}, use) => {
    const port = process.env.PERF_FIXTURE_PORT;
    await use((pageId) => `http://127.0.0.1:${port}/page-${pageId}.html`);
  }, { scope: 'test' }],
});

// resetModel — full overwrite of blsi_model to DEFAULT_SEED (not a deep-merge).
// Call this in beforeAll of every test file before applying file-specific patches,
// so test files are immune to state left by previous files regardless of run order.
async function resetModel(sw) {
  await sw.evaluate((seedJson) => {
    return new Promise((resolve) => chrome.storage.local.set({ blsi_model: JSON.parse(seedJson) }, resolve));
  }, JSON.stringify(DEFAULT_SEED));
}

module.exports = { test, expect: base.expect, setModel, resetModel, DEFAULT_SEED };
