/**
 * tests/e2e/mutation_loop.spec.js
 *
 * Integration test: MutationObserver + blur-all must not create infinite loops.
 *
 * The bug: In blur-all mode the content_script MutationObserver calls
 * Engine.applyBlur() on every new DOM node. applyBlur wraps bare text nodes
 * in a <span class="pb-text-node-wrapper"> — a DOM insertion that re-triggers
 * the observer, creating infinite nesting until the page OOMs.
 *
 * These tests send TOGGLE_BLUR_ALL through the real extension messaging path
 * (background service worker → chrome.tabs.sendMessage → content script
 * handleMessage) so both isPageBlurred and the MutationObserver are active.
 */

'use strict';

const http = require('http');
const path = require('path');

const SKIP = !!process.env.SKIP_E2E;
const EXTENSION_PATH = path.resolve(__dirname, '../../');

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>MutationObserver Loop Test</title></head>
<body>
  <div id="container">
    <p id="p1">First paragraph with text content.</p>
    <p id="p2">Second paragraph with text content.</p>
    <div id="text-div">Bare text inside a div.</div>
    <span id="text-span">Bare text inside a span.</span>
  </div>
  <div id="dynamic-target"></div>
</body>
</html>`;

const describeFn = SKIP ? describe.skip : describe;

describeFn('MutationObserver + blur-all integration', () => {
  let puppeteer;
  let browser;
  let page;
  let server;
  let testPageUrl;
  let swTarget; // background service worker target

  // ── Setup / teardown ────────────────────────────────────────────────────

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
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
      ],
    });

    // Wait for the service worker to register.
    for (let i = 0; i < 15; i++) {
      const targets = await browser.targets();
      swTarget = targets.find(
        (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
      );
      if (swTarget) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!swTarget) throw new Error('Extension service worker not found');

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  beforeEach(async () => {
    // Clear persisted blur-all state so each test starts clean.
    const client = await swTarget.createCDPSession();
    try {
      await client.send('Runtime.evaluate', {
        expression: `chrome.storage.local.set({ blur_all_hosts: {} })`,
        awaitPromise: true,
      });
    } finally {
      await client.detach();
    }

    await page.goto(testPageUrl, { waitUntil: 'load' });
    // Wait for content scripts to initialise + MutationObserver to attach.
    await new Promise((r) => setTimeout(r, 1500));
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Send a message to the active tab's content script through the real
   * extension messaging channel: background service worker →
   * chrome.tabs.sendMessage → content script handleMessage.
   *
   * This ensures isPageBlurred and the MutationObserver are both engaged,
   * exactly as they would be in production.
   */
  async function sendMessageViaBackground(type) {
    const client = await swTarget.createCDPSession();
    try {
      const result = await client.send('Runtime.evaluate', {
        expression: `
          (async () => {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (!tab || !tab.id) throw new Error('No active tab');
            return new Promise((resolve) => {
              chrome.tabs.sendMessage(tab.id, { type: '${type}' }, (resp) => {
                resolve(resp || {});
              });
            });
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        const msg = result.exceptionDetails.exception
          ? result.exceptionDetails.exception.description
          : result.exceptionDetails.text;
        throw new Error('Background eval failed: ' + msg);
      }
      return result.result.value;
    } finally {
      await client.detach();
    }
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  test('blur-all does not cause infinite wrapper nesting on new DOM nodes', async () => {
    // Activate blur-all through the real message handler so isPageBlurred
    // is set and the MutationObserver will blur new nodes.
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 500));

    // Sanity: blur-all actually worked.
    const blurredCount = await page.evaluate(
      () => document.querySelectorAll('.pb-blurred').length
    );
    expect(blurredCount).toBeGreaterThan(0);

    // Inject a new text-containing element. The MutationObserver will call
    // Engine.applyBlur → wrapTextNodes → inserts a pb-text-node-wrapper span.
    // WITHOUT the fix, that insertion re-triggers the observer infinitely.
    // WITH the fix, applyBlur skips pb-text-node-wrapper elements.
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'injected-div';
      div.textContent = 'Dynamically added text that should be blurred once.';
      document.getElementById('dynamic-target').appendChild(div);
    });

    // If the infinite loop bug exists the page freezes here and the test
    // times out. 1.5s is more than enough for a single observer cycle.
    await new Promise((r) => setTimeout(r, 1500));

    // The injected element should be blurred by the observer.
    const injectedBlurred = await page.evaluate(() => {
      const el = document.getElementById('injected-div');
      return el ? el.classList.contains('pb-blurred') : false;
    });
    expect(injectedBlurred).toBe(true);

    // Critical: wrapper nesting depth must be exactly 1, not runaway.
    const wrapperStats = await page.evaluate(() => {
      const injected = document.getElementById('injected-div');
      if (!injected) return { count: -1, nestedCount: -1 };

      const wrappers = injected.querySelectorAll('.pb-text-node-wrapper');
      let nestedCount = 0;
      wrappers.forEach((w) => {
        if (w.querySelector('.pb-text-node-wrapper')) nestedCount++;
      });

      return { count: wrappers.length, nestedCount };
    });

    expect(wrapperStats.count).toBeLessThanOrEqual(1);
    expect(wrapperStats.nestedCount).toBe(0);
  }, 15000);

  test('rapid DOM insertions in blur-all mode stay bounded', async () => {
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 500));

    // Rapidly inject 20 text elements while the observer is active.
    await page.evaluate(() => {
      const target = document.getElementById('dynamic-target');
      for (let i = 0; i < 20; i++) {
        const el = document.createElement('p');
        el.className = 'rapid-inject';
        el.textContent = 'Rapid injection #' + i;
        target.appendChild(el);
      }
    });

    // Let the observer settle.
    await new Promise((r) => setTimeout(r, 2000));

    const stats = await page.evaluate(() => {
      const allWrappers = document.querySelectorAll('.pb-text-node-wrapper');
      const injected = document.querySelectorAll('.rapid-inject');
      const injectedBlurred = document.querySelectorAll('.rapid-inject.pb-blurred');

      // Smoking gun: a wrapper containing another wrapper means the loop ran.
      let nestedWrapperCount = 0;
      allWrappers.forEach((w) => {
        if (w.querySelector('.pb-text-node-wrapper')) nestedWrapperCount++;
      });

      return {
        totalWrappers: allWrappers.length,
        injectedCount: injected.length,
        injectedBlurredCount: injectedBlurred.length,
        nestedWrapperCount,
      };
    });

    // All 20 injected elements should be blurred by the observer.
    expect(stats.injectedCount).toBe(20);
    expect(stats.injectedBlurredCount).toBe(20);

    // No wrapper should contain another wrapper.
    expect(stats.nestedWrapperCount).toBe(0);

    // Total wrappers should be bounded. The page has ~4 original text
    // elements + 20 injected = ~24. An infinite loop would produce
    // hundreds or thousands.
    expect(stats.totalWrappers).toBeLessThan(50);
  }, 20000);

  test('canvas overlay elements are not double-blurred', async () => {
    // Insert a video so blur-all creates a pb-canvas-overlay.
    await page.evaluate(() => {
      const video = document.createElement('video');
      video.id = 'test-video';
      video.muted = true;
      video.style.cssText = 'width:320px;height:240px';
      document.getElementById('container').appendChild(video);
    });
    await new Promise((r) => setTimeout(r, 200));

    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 1000));

    const canvasStats = await page.evaluate(() => {
      const overlays = document.querySelectorAll('.pb-canvas-overlay');
      let blurredOverlayCount = 0;
      overlays.forEach((c) => {
        if (c.classList.contains('pb-blurred')) blurredOverlayCount++;
      });
      return { total: overlays.length, blurred: blurredOverlayCount };
    });

    // Canvas overlays are the blur mechanism — they must not be blurred
    // themselves, which would cause a double-blur visual artefact.
    expect(canvasStats.blurred).toBe(0);
  }, 15000);

  test('MutationObserver respects categories: form elements not blurred when form OFF', async () => {
    // Activate blur-all (default categories: form OFF)
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 500));

    // Dynamically inject form elements while observer is running
    await page.evaluate(() => {
      const target = document.getElementById('dynamic-target');
      const input = document.createElement('input');
      input.id = 'injected-input';
      input.type = 'text';
      input.value = 'sensitive';
      target.appendChild(input);

      const textarea = document.createElement('textarea');
      textarea.id = 'injected-textarea';
      textarea.textContent = 'private notes';
      target.appendChild(textarea);

      // Also inject a p for positive control
      const p = document.createElement('p');
      p.id = 'injected-p';
      p.textContent = 'This should be blurred';
      target.appendChild(p);
    });

    await new Promise((r) => setTimeout(r, 1500));

    const result = await page.evaluate(() => {
      const input = document.getElementById('injected-input');
      const textarea = document.getElementById('injected-textarea');
      const p = document.getElementById('injected-p');
      return {
        inputBlurred: input ? input.classList.contains('pb-blurred') : null,
        textareaBlurred: textarea ? textarea.classList.contains('pb-blurred') : null,
        pBlurred: p ? p.classList.contains('pb-blurred') : null,
      };
    });

    // Form elements should NOT be blurred (form category off by default)
    expect(result.inputBlurred).toBe(false);
    expect(result.textareaBlurred).toBe(false);
    // Text element should be blurred (text category on by default)
    expect(result.pBlurred).toBe(true);
  }, 15000);
});
