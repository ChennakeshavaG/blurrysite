/**
 * tests/e2e/mutation_loop.spec.js
 *
 * Integration test: MutationObserver + blur-all must not create infinite loops.
 *
 * The new engine uses CSS tag rules + data-bl-si-blur attributes instead of
 * CSS class manipulation. This test verifies that the MutationObserver
 * correctly stamps data-bl-si-blur on dynamically added elements without
 * causing infinite loops.
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
    // Clear persisted blur-all state so each test starts clean. The current
    // model lives under `blsi_model.blur_all.status` — older tests wrote to
    // a now-dead `blur_all_hosts` key which silently leaked state across tests.
    const client = await swTarget.createCDPSession();
    try {
      await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const { blsi_model } = await chrome.storage.local.get('blsi_model');
          if (blsi_model && blsi_model.blur_all) {
            blsi_model.blur_all.status = false;
            await chrome.storage.local.set({ blsi_model });
          }
        })()`,
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

  test('blur-all does not cause infinite loops on new DOM nodes', async () => {
    // Activate blur-all through the real message handler so isPageBlurred
    // is set and the MutationObserver will blur new nodes.
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 500));

    // Sanity: blur-all actually worked.
    const blurredCount = await page.evaluate(
      () => document.querySelectorAll('[data-bl-si-blur]').length
    );
    expect(blurredCount).toBeGreaterThan(0);

    // Inject a new text-containing element. The MutationObserver should
    // stamp data-bl-si-blur on it once, without re-triggering infinitely.
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'injected-div';
      div.textContent = 'Dynamically added text that should be blurred once.';
      document.getElementById('dynamic-target').appendChild(div);
    });

    // If an infinite loop exists the page freezes here and the test
    // times out. 1.5s is more than enough for a single observer cycle.
    await new Promise((r) => setTimeout(r, 1500));

    // The injected element should be blurred by the observer (data-bl-si-blur stamped).
    const injectedBlurred = await page.evaluate(() => {
      const el = document.getElementById('injected-div');
      return el ? el.hasAttribute('data-bl-si-blur') : false;
    });
    expect(injectedBlurred).toBe(true);

    // No text-node wrappers should exist (new engine uses CSS rules, not DOM wrapping).
    const wrapperCount = await page.evaluate(() => {
      return document.querySelectorAll('.bl-si-text-node-wrapper').length;
    });
    expect(wrapperCount).toBe(0);
  }, 15000);

  test('rapid DOM insertions in blur-all mode stay bounded', async () => {
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 500));

    // Rapidly inject 20 text-check elements (<span>, with text content) while
    // the observer is active. Text-check elements get the `data-bl-si-blur`
    // attribute via the MO live-stamp path. (<p> is in `alwaysBlur` and
    // doesn't carry the attribute — covered by CSS tag rules instead.)
    await page.evaluate(() => {
      const target = document.getElementById('dynamic-target');
      for (let i = 0; i < 20; i++) {
        const el = document.createElement('span');
        el.className = 'rapid-inject';
        el.textContent = 'Rapid injection #' + i;
        target.appendChild(el);
      }
    });

    // Let the observer settle. The MO drain runs through the idle queue;
    // poll briefly to absorb jitter.
    const start = Date.now();
    let count = 0;
    while (Date.now() - start < 5000) {
      count = await page.evaluate(
        () => document.querySelectorAll('.rapid-inject[data-bl-si-blur]').length
      );
      if (count === 20) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const stats = await page.evaluate(() => ({
      injectedCount: document.querySelectorAll('.rapid-inject').length,
      injectedBlurredCount: document.querySelectorAll('.rapid-inject[data-bl-si-blur]').length,
      wrapperCount: document.querySelectorAll('.bl-si-text-node-wrapper').length,
    }));

    expect(stats.injectedCount).toBe(20);
    expect(stats.injectedBlurredCount).toBe(20);

    // No text-node wrappers — the new engine uses CSS rules, not DOM wrapping.
    expect(stats.wrapperCount).toBe(0);
  }, 20000);

  test('video elements are blurred via CSS tag rules without canvas overlays', async () => {
    // Insert a video element.
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

    const result = await page.evaluate(() => {
      const video = document.getElementById('test-video');
      // New engine uses CSS tag rules for media elements (no canvas overlays).
      const overlays = document.querySelectorAll('.bl-si-canvas-overlay');
      return {
        videoExists: !!video,
        canvasOverlayCount: overlays.length,
      };
    });

    // No canvas overlays should exist — the new engine blurs video via CSS rules.
    expect(result.videoExists).toBe(true);
    expect(result.canvasOverlayCount).toBe(0);
  }, 15000);

  test('MutationObserver respects categories: text-check element gets stamped when blur-all on', async () => {
    // Default categories: text/media/table/structure ON, form OFF.
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 500));

    // Inject a <span> (text-check, gets data-bl-si-blur) and an <input>
    // (alwaysBlur form element, but form category is OFF so it shouldn't
    // appear in the alwaysBlur CSS selector). The data-attribute check is
    // only valid for text-check elements; form elements are governed by the
    // CSS tag rule which is excluded entirely when form category is off.
    await page.evaluate(() => {
      const target = document.getElementById('dynamic-target');
      const input = document.createElement('input');
      input.id = 'injected-input';
      input.type = 'text';
      input.value = 'sensitive';
      target.appendChild(input);

      const span = document.createElement('span');
      span.id = 'injected-span';
      span.textContent = 'This should be blurred';
      target.appendChild(span);
    });

    // Poll briefly for the span stamp.
    const start = Date.now();
    let spanBlurred = false;
    while (Date.now() - start < 5000) {
      spanBlurred = await page.evaluate(
        () => document.getElementById('injected-span')?.hasAttribute('data-bl-si-blur')
      );
      if (spanBlurred) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const result = await page.evaluate(() => {
      const input = document.getElementById('injected-input');
      const span = document.getElementById('injected-span');
      return {
        inputHasAttr: input ? input.hasAttribute('data-bl-si-blur') : null,
        spanHasAttr: span ? span.hasAttribute('data-bl-si-blur') : null,
      };
    });

    // <input> never carries the data-attribute (alwaysBlur tags rely on CSS
    // tag rules, not the attribute). With form category OFF the CSS rule
    // excludes inputs entirely — but that's a CSS-level assertion outside
    // the scope of this attribute check.
    expect(result.inputHasAttr).toBe(false);
    // <span> is text-check — must get the attribute when blur-all is on.
    expect(result.spanHasAttr).toBe(true);
  }, 15000);
});
