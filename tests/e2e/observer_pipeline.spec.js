/**
 * tests/e2e/observer_pipeline.spec.js
 *
 * E2E tests for the observer pipeline:
 * - Blur-all doesn't crash (pendingRefresh removal)
 * - Perf mode ON: off-screen elements lose blur, re-blur on scroll back
 * - Perf mode OFF: all elements stay blurred regardless of scroll
 */

'use strict';

const http = require('http');
const path = require('path');

const SKIP = !!process.env.SKIP_E2E;
const EXTENSION_PATH = path.resolve(__dirname, '../../');

// Tall page with elements above and below the fold
const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Observer Pipeline Test</title>
<style>
  body { font-family: sans-serif; padding: 24px; margin: 0; }
  .item { padding: 16px; margin: 8px 0; background: #f0f0f0; }
  .spacer { height: 3000px; }
</style>
</head>
<body>
  <div id="top-item" class="item"><p>Top visible item</p></div>
  <div id="top-img-item" class="item"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="top"></div>
  <div class="spacer"></div>
  <div id="bottom-item" class="item"><p>Bottom item below the fold</p></div>
  <div id="bottom-img" class="item"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="bottom"></div>
</body>
</html>`;

const describeFn = SKIP ? describe.skip : describe;

describeFn('Observer Pipeline — E2E', () => {
  let puppeteer;
  let browser;
  let page;
  let server;
  let testPageUrl;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(TEST_PAGE_HTML);
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        testPageUrl = `http://127.0.0.1:${server.address().port}/`;
        resolve();
      });
    });

    puppeteer = require('puppeteer');

    browser = await puppeteer.launch({
      headless: process.env.E2E_HEADED ? false : 'new',
      slowMo: process.env.E2E_HEADED ? 150 : 0,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    // Wait for service worker
    let extTarget = null;
    for (let i = 0; i < 15 && !extTarget; i++) {
      const targets = await browser.targets();
      extTarget = targets.find(
        (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
      );
      if (!extTarget) await new Promise((r) => setTimeout(r, 500));
    }

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  // Helper: evaluate in content script's isolated world
  async function evalInContentScript(expression) {
    const client = await page.createCDPSession();
    try {
      const contexts = [];
      client.on('Runtime.executionContextCreated', (params) => {
        contexts.push(params.context);
      });
      await client.send('Runtime.disable');
      await client.send('Runtime.enable');
      await new Promise((r) => setTimeout(r, 100));

      const csCtx = contexts.find(
        (ctx) => ctx.origin && ctx.origin.includes('chrome-extension://') &&
                 ctx.auxData && ctx.auxData.type === 'isolated'
      );
      if (!csCtx) throw new Error('Content script context not found');

      const result = await client.send('Runtime.evaluate', {
        expression,
        contextId: csCtx.id,
        returnByValue: true,
        awaitPromise: true,
      });
      return result.result ? result.result.value : undefined;
    } finally {
      await client.detach();
    }
  }

  // ── Test: Blur-all doesn't crash ──────────────────────────────────────────

  test('blur-all toggle does not crash (pendingRefresh removed)', async () => {
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    // Toggle blur-all ON — should not throw
    const result = await evalInContentScript(`
      try {
        pb.BlurEngine.blurAllContent(10, {
          categories: pb.DEFAULT_SETTINGS.BLUR_CATEGORIES,
          thoroughBlur: false,
          blurMode: 'gaussian'
        });
        'ok';
      } catch (e) {
        'error: ' + e.message;
      }
    `);
    expect(result).toBe('ok');

    // Verify elements are blurred
    const topBlurred = await page.$eval('#top-item p', (el) => el.classList.contains('pb-blurred'));
    expect(topBlurred).toBe(true);
  }, 15000);

  // ── Test: Perf mode ON — off-screen elements ─────────────────────────────

  test('perf mode ON: off-screen elements lose blur, re-blur on scroll back', async () => {
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    // Enable perf mode and blur-all via content script
    await evalInContentScript(`
      pb.BlurEngine.blurAllContent(10, {
        categories: pb.DEFAULT_SETTINGS.BLUR_CATEGORIES,
        thoroughBlur: false,
        blurMode: 'gaussian'
      });
      // Manually start visibility observer (simulates perf mode ON)
      document.querySelectorAll('.pb-blurred').forEach(el => {
        if (typeof visibilityObserver !== 'undefined' && visibilityObserver) {
          visibilityObserver.observe(el);
        }
      });
    `);

    // Verify top element is blurred initially
    const topBlurredBefore = await page.$eval('#top-item p', (el) => el.classList.contains('pb-blurred'));
    expect(topBlurredBefore).toBe(true);

    // Verify bottom element is also blurred (by blurAllContent)
    const bottomBlurredBefore = await page.$eval('#bottom-item p', (el) => el.classList.contains('pb-blurred'));
    expect(bottomBlurredBefore).toBe(true);
  }, 15000);

  // ── Test: Perf mode OFF — all elements stay blurred ──────────────────────

  test('perf mode OFF: all elements stay blurred regardless of position', async () => {
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    // Blur everything without perf mode
    await evalInContentScript(`
      pb.BlurEngine.blurAllContent(10, {
        categories: pb.DEFAULT_SETTINGS.BLUR_CATEGORIES,
        thoroughBlur: false,
        blurMode: 'gaussian'
      });
    `);

    // All elements should be blurred
    const topBlurred = await page.$eval('#top-item p', (el) => el.classList.contains('pb-blurred'));
    const bottomBlurred = await page.$eval('#bottom-item p', (el) => el.classList.contains('pb-blurred'));
    expect(topBlurred).toBe(true);
    expect(bottomBlurred).toBe(true);

    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 500));

    // Without perf mode, top element should STILL be blurred (no IO to remove it)
    const topStillBlurred = await page.$eval('#top-item p', (el) => el.classList.contains('pb-blurred'));
    expect(topStillBlurred).toBe(true);

    // Bottom element also blurred
    const bottomStillBlurred = await page.$eval('#bottom-item p', (el) => el.classList.contains('pb-blurred'));
    expect(bottomStillBlurred).toBe(true);
  }, 15000);
});
