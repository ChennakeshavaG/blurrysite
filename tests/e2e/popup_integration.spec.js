/**
 * tests/e2e/popup_integration.spec.js
 *
 * Tests for popup → background → content script communication via the real
 * extension messaging path (background SW → chrome.tabs.sendMessage →
 * content_script handleMessage). Storage drives the engine; engine reacts
 * to chrome.storage.onChanged on `blsi_model`.
 */

'use strict';

const http = require('http');
const path = require('path');

const SKIP = !!process.env.SKIP_E2E;
const EXTENSION_PATH = path.resolve(__dirname, '../../');

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Popup Integration Test</title></head>
<body>
  <h1 id="title">Test Page</h1>
  <p id="para1">First paragraph to blur.</p>
  <p id="para2">Second paragraph to blur.</p>
  <span id="span1">Inline text-check span.</span>
  <img id="img1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="test">
</body>
</html>`;

const describeFn = SKIP ? describe.skip : describe;

describeFn('Popup ↔ Content Script Integration', () => {
  let puppeteer;
  let browser;
  let page;
  let server;
  let testPageUrl;
  let swTarget;

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
      slowMo: process.env.E2E_HEADED ? 100 : 0,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
      ],
    });

    swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://'),
      { timeout: 15000 }
    );

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  beforeEach(async () => {
    // Reset model to clean state before navigation.
    const client = await swTarget.createCDPSession();
    try {
      await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const { blsi_model } = await chrome.storage.local.get('blsi_model');
          if (blsi_model) {
            if (blsi_model.blur_all) blsi_model.blur_all.status = false;
            if (blsi_model.global_default_settings) {
              blsi_model.global_default_settings.enabled = true;
              blsi_model.global_default_settings.blur_radius = 8;
            }
            if (blsi_model.pick_and_blur && blsi_model.pick_and_blur.items) {
              blsi_model.pick_and_blur.items = {};
            }
            await chrome.storage.local.set({ blsi_model });
          }
        })()`,
        awaitPromise: true,
      });
    } finally {
      await client.detach();
    }

    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1500));
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function sendMessageViaBackground(type, extra) {
    const client = await swTarget.createCDPSession();
    try {
      const payload = Object.assign({ type }, extra || {});
      const result = await client.send('Runtime.evaluate', {
        expression: `
          (async () => {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (!tab || !tab.id) throw new Error('No active tab');
            return new Promise((resolve) => {
              chrome.tabs.sendMessage(tab.id, ${JSON.stringify(payload)}, (resp) => {
                resolve(resp || {});
              });
            });
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error('Background eval failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
      }
      return result.result.value;
    } finally {
      await client.detach();
    }
  }

  async function setModelField(updater) {
    const client = await swTarget.createCDPSession();
    try {
      await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const { blsi_model } = await chrome.storage.local.get('blsi_model');
          (${updater.toString()})(blsi_model);
          await chrome.storage.local.set({ blsi_model });
        })()`,
        awaitPromise: true,
      });
    } finally {
      await client.detach();
    }
  }

  async function nudgePage() {
    await page.evaluate(() => {
      const n = document.createElement('span');
      n.id = '__nudge_' + Date.now();
      n.textContent = 'nudge';
      document.body.appendChild(n);
    });
  }

  async function countBlurred() {
    return page.evaluate(() => document.querySelectorAll('[data-bl-si-blur]').length);
  }

  async function getRadius() {
    return page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bl-si-radius').trim()
    );
  }

  async function waitForCount(min, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const n = await countBlurred();
      if (n >= min) return n;
      await new Promise((r) => setTimeout(r, 100));
    }
    return countBlurred();
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  test('content script receives TOGGLE_BLUR_ALL and stamps text-check elements', async () => {
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await nudgePage();
    const count = await waitForCount(1, 5000);
    expect(count).toBeGreaterThan(0);
  }, 15000);

  test('settings change via chrome.storage.onChanged reaches content script', async () => {
    const radiusBefore = await getRadius();
    expect(radiusBefore).toBe('8px');

    // Change blur_radius via storage — content script listens via onChanged.
    await setModelField((m) => {
      m.global_default_settings.blur_radius = 15;
    });
    await new Promise((r) => setTimeout(r, 500));

    const radiusAfter = await getRadius();
    expect(radiusAfter).toBe('15px');
  }, 15000);

  test('disabling extension via storage clears CSS vars / engine work', async () => {
    // Toggle blur on first to verify engine activates.
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await nudgePage();
    await waitForCount(1, 5000);
    expect(await countBlurred()).toBeGreaterThan(0);

    // Disable via storage.
    await setModelField((m) => {
      m.global_default_settings.enabled = false;
    });
    await new Promise((r) => setTimeout(r, 800));

    // After disable, engine teardown clears stamps.
    expect(await countBlurred()).toBe(0);
  }, 15000);

  test('blur all works on google.com via message protocol', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Verify content script is injected.
    const hasCS = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bl-si-radius').trim().length > 0
    );
    expect(hasCS).toBe(true);

    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await nudgePage();
    const count = await waitForCount(1, 5000);
    expect(count).toBeGreaterThan(0);

    // Cleanup — wait past dedup window then toggle off so other tests aren't
    // affected.
    await new Promise((r) => setTimeout(r, 600));
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
  }, 30000);

  test('CLEAR_ALL_BLUR removes everything on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await nudgePage();
    await waitForCount(1, 5000);
    const before = await countBlurred();
    expect(before).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 600));  // past dedup window
    await sendMessageViaBackground('CLEAR_ALL_BLUR');
    const start = Date.now();
    let after = await countBlurred();
    while (after > 0 && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      after = await countBlurred();
    }
    expect(after).toBe(0);
  }, 30000);

  test('picker activates and Escape deactivates on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    await sendMessageViaBackground('TOGGLE_PICKER');
    await new Promise((r) => setTimeout(r, 500));

    const active = await page.evaluate(() =>
      document.documentElement.classList.contains('bl-si-picker-active')
    );
    expect(active).toBe(true);

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    const afterEscape = await page.evaluate(() =>
      document.documentElement.classList.contains('bl-si-picker-active')
    );
    expect(afterEscape).toBe(false);
  }, 30000);
});
