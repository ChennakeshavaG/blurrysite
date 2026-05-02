/**
 * tests/e2e/blur.spec.js
 *
 * End-to-end tests for the Blurry Site Chrome extension using Puppeteer.
 * Launches a real Chromium instance with the extension loaded and verifies
 * behaviour from the user's perspective by driving the same message protocol
 * that the popup and shortcut handler use (background SW →
 * chrome.tabs.sendMessage → content_script handleMessage).
 *
 * Skip guard: set SKIP_E2E=1 to bypass (useful in CI without Chrome).
 */

'use strict';

const http = require('http');
const path = require('path');

const SKIP = !!process.env.SKIP_E2E;
const EXTENSION_PATH = path.resolve(__dirname, '../../');

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Blurry Site E2E Test Page</title>
<style>
  body { font-family: sans-serif; padding: 24px; }
  img  { width: 200px; height: 200px; background: #ccc; display: block; }
  p    { font-size: 18px; }
</style>
</head>
<body>
  <h1 id="title">E2E Test Page</h1>
  <img id="test-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="test">
  <p id="test-para">Sensitive paragraph content that should be blurred.</p>
  <span id="test-span">Inline text-check span.</span>
</body>
</html>`;

const describeFn = SKIP ? describe.skip : describe;

describeFn('Blurry Site extension — E2E', () => {
  let puppeteer;
  let browser;
  let page;
  let extensionId;
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

    for (let i = 0; i < 15 && !swTarget; i++) {
      const targets = await browser.targets();
      swTarget = targets.find(
        (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
      );
      if (!swTarget) await new Promise((r) => setTimeout(r, 500));
    }
    if (swTarget) {
      extensionId = swTarget.url().split('//')[1].split('/')[0];
    } else {
      throw new Error('Service worker target not found');
    }

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  beforeEach(async () => {
    // Reset blur_all.status BEFORE navigating so init_cache reads clean state.
    const client = await swTarget.createCDPSession();
    try {
      await client.send('Runtime.evaluate', {
        expression: `(async () => {
          const { blsi_model } = await chrome.storage.local.get('blsi_model');
          if (blsi_model && blsi_model.blur_all) {
            blsi_model.blur_all.status = false;
            // Also clear any persisted blur items from prior tests.
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

  /**
   * Send a message to the active tab via the background service worker —
   * matches the production path used by shortcut commands and the popup.
   */
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

  test('extension loads and content script is injected', async () => {
    const title = await page.title();
    expect(title).toBe('Blurry Site E2E Test Page');

    // Content script sets CSS custom properties on :root.
    const hasCustomProp = await page.evaluate(() => {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--bl-si-radius');
      return val.trim().length > 0;
    });
    expect(hasCustomProp).toBe(true);
  });

  test('blur all stamps text-check element via real message protocol', async () => {
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await nudgePage();
    const blurredCount = await waitForCount(1, 5000);
    expect(blurredCount).toBeGreaterThan(0);

    // <span> is text-check — gets the data-bl-si-blur attribute.
    const spanBlurred = await page.$eval('#test-span', (el) => el.hasAttribute('data-bl-si-blur'));
    expect(spanBlurred).toBe(true);
  }, 15000);

  test('blur all toggles off on second TOGGLE_BLUR_ALL', async () => {
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await nudgePage();
    await waitForCount(1, 5000);

    // Wait past the fire-token dedup window (500ms in handleMessage) so the
    // second TOGGLE isn't absorbed as a relay duplicate.
    await new Promise((r) => setTimeout(r, 600));

    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    // Poll: teardown clears stamps but may run inside an idle slot.
    const start = Date.now();
    let after = await countBlurred();
    while (after > 0 && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      after = await countBlurred();
    }
    expect(after).toBe(0);
  }, 15000);

  test('picker activates and adds bl-si-picker-active class', async () => {
    await sendMessageViaBackground('TOGGLE_PICKER');
    await new Promise((r) => setTimeout(r, 500));

    const pickerActive = await page.evaluate(() =>
      document.documentElement.classList.contains('bl-si-picker-active')
    );
    expect(pickerActive).toBe(true);
  }, 15000);

  test('pressing Escape deactivates picker mode', async () => {
    await sendMessageViaBackground('TOGGLE_PICKER');
    await new Promise((r) => setTimeout(r, 500));

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    const pickerActive = await page.evaluate(() =>
      document.documentElement.classList.contains('bl-si-picker-active')
    );
    expect(pickerActive).toBe(false);
  }, 15000);

  test('clear all blur removes everything', async () => {
    await sendMessageViaBackground('TOGGLE_BLUR_ALL');
    await nudgePage();
    await waitForCount(1, 5000);

    await sendMessageViaBackground('CLEAR_ALL_BLUR');
    await new Promise((r) => setTimeout(r, 500));

    const after = await countBlurred();
    expect(after).toBe(0);
  }, 15000);

  // ── Google.com cross-site smoke test ─────────────────────────────────────

  test('content script injects on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    const hasCustomProp = await page.evaluate(() => {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--bl-si-radius');
      return val.trim().length > 0;
    });
    expect(hasCustomProp).toBe(true);
  }, 30000);

  // ── Popup smoke test ─────────────────────────────────────────────────────

  test('popup loads without errors', async () => {
    if (!extensionId) {
      console.warn('Extension ID not found — skipping popup test');
      return;
    }

    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    const popupPage = await browser.newPage();
    await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 500));

    const bodyText = await popupPage.evaluate(() => document.body.innerText);
    expect(bodyText).toBeTruthy();
    expect(bodyText).toContain('Blurry Site');

    await popupPage.close();
  }, 15000);
});
