/**
 * tests/e2e/blur.spec.js
 *
 * End-to-end tests for the PrivacyBlur Chrome extension using Puppeteer.
 * Launches a real Chromium instance with the extension loaded and verifies
 * behaviour from the user's perspective.
 *
 * Skip guard: set SKIP_E2E=1 to bypass (useful in CI without Chrome).
 */

'use strict';

const http = require('http');
const path = require('path');

const SKIP = !!process.env.SKIP_E2E;
const EXTENSION_PATH = path.resolve(__dirname, '../../');

// ─── Test page HTML ──────────────────────────────────────────────────────────

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>PrivacyBlur E2E Test Page</title>
<style>
  body { font-family: sans-serif; padding: 24px; }
  img  { width: 200px; height: 200px; background: #ccc; display: block; }
  video { width: 320px; height: 240px; background: #000; display: block; margin-top: 12px; }
  p    { font-size: 18px; }
</style>
</head>
<body>
  <h1 id="title">E2E Test Page</h1>
  <img id="test-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="test">
  <video id="test-video" muted></video>
  <p id="test-para">Sensitive paragraph content that should be blurred.</p>
  <p id="para2">Another paragraph.</p>
</body>
</html>`;

// ─── Suite ────────────────────────────────────────────────────────────────────

const describeFn = SKIP ? describe.skip : describe;

describeFn('PrivacyBlur extension — E2E', () => {
  let puppeteer;
  let browser;
  let page;
  let extensionId;
  let server;
  let testPageUrl;

  // ── Setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // Local HTTP server — content scripts require http/https (not data: URLs).
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
    let extTarget = null;
    for (let i = 0; i < 15 && !extTarget; i++) {
      const targets = await browser.targets();
      extTarget = targets.find(
        (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
      );
      if (!extTarget) await new Promise((r) => setTimeout(r, 500));
    }
    if (extTarget) {
      extensionId = extTarget.url().split('//')[1].split('/')[0];
    }

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  beforeEach(async () => {
    await page.goto(testPageUrl, { waitUntil: 'load' });
    // Wait for content scripts to initialise.
    await new Promise((r) => setTimeout(r, 1000));
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Find the content script's isolated execution context ID via CDP.
   * Content scripts run in an isolated world separate from the main page world.
   */
  async function getContentScriptContextId(client) {
    const contexts = [];

    // Collect execution contexts.
    client.on('Runtime.executionContextCreated', (params) => {
      contexts.push(params.context);
    });
    await client.send('Runtime.disable');
    await client.send('Runtime.enable');
    // Brief pause so context events fire.
    await new Promise((r) => setTimeout(r, 100));

    // Find the content script's isolated context (has chrome-extension:// origin).
    const csCtx = contexts.find(
      (ctx) =>
        ctx.origin &&
        ctx.origin.includes('chrome-extension://') &&
        ctx.auxData &&
        ctx.auxData.type === 'isolated'
    );
    return csCtx ? csCtx.id : null;
  }

  /**
   * Evaluate an expression in the content script's isolated world via CDP.
   * This gives us access to pb.BlurEngine and other globals.
   */
  async function evalInContentScript(expression) {
    const client = await page.createCDPSession();
    try {
      const contextId = await getContentScriptContextId(client);
      if (!contextId) {
        throw new Error('Content script context not found');
      }

      const result = await client.send('Runtime.evaluate', {
        expression,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });

      if (result.exceptionDetails) {
        const msg = result.exceptionDetails.exception
          ? result.exceptionDetails.exception.description
          : result.exceptionDetails.text;
        throw new Error('Content script eval failed: ' + msg);
      }

      return result.result.value;
    } finally {
      await client.detach();
    }
  }

  /**
   * Send a command message to the content script by evaluating in its world.
   * This simulates what background.js does via chrome.tabs.sendMessage.
   */
  async function sendCommand(type) {
    // Dispatch directly through the content script's message handler by
    // firing the chrome.runtime.onMessage listeners in the content script world.
    // The content script registered: chrome.runtime.onMessage.addListener(handleMessage)
    // We can trigger it by dispatching through the extension messaging system.
    //
    // Simplest: call the extension globals directly from the content script world.
    const expressions = {
      TOGGLE_BLUR_ALL: `
        (function() {
          var blurred = document.querySelectorAll('.pb-blurred');
          if (blurred.length > 0) {
            pb.BlurEngine.unblurAll();
          } else {
            pb.BlurEngine.blurAllContent(8);
          }
        })()
      `,
      TOGGLE_PICKER: `
        (function() {
          if (document.documentElement.classList.contains('pb-picker-active')) {
            pb.Picker.deactivate();
          } else {
            pb.Picker.activate(
              { blurRadius: 8, highlightColor: '#f59e0b' },
              {
                onBlur: function(el) {
                  pb.BlurEngine.applyBlur(el, 8);
                  var sel = pb.SelectorUtils.getSelector(el);
                  if (sel) pb.Storage.saveBlurredElement(location.hostname, sel);
                },
                onUnblur: function(el) {
                  pb.BlurEngine.removeBlur(el);
                },
                onDeactivate: function() {}
              }
            );
          }
        })()
      `,
      CLEAR_ALL_BLUR: `
        (function() {
          pb.BlurEngine.unblurAll();
        })()
      `,
    };

    const expr = expressions[type];
    if (!expr) throw new Error('Unknown command: ' + type);
    return evalInContentScript(expr);
  }

  async function hasClass(selector, className) {
    return page.evaluate(
      (sel, cls) => {
        const el = document.querySelector(sel);
        return el ? el.classList.contains(cls) : false;
      },
      selector,
      className
    );
  }

  async function countBlurred() {
    return page.evaluate(() => document.querySelectorAll('.pb-blurred').length);
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  test('extension loads and content script is injected', async () => {
    const title = await page.title();
    expect(title).toBe('PrivacyBlur E2E Test Page');

    // Content script sets CSS custom properties on :root.
    const hasCustomProp = await page.evaluate(() => {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--pb-radius');
      return val.trim().length > 0;
    });
    expect(hasCustomProp).toBe(true);
  });

  test('blur all content works', async () => {
    await sendCommand('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 300));

    const paraBlurred = await hasClass('#test-para', 'pb-blurred');
    const imgBlurred = await hasClass('#test-img', 'pb-blurred');
    expect(paraBlurred || imgBlurred).toBe(true);
  });

  test('blur all toggles off on second call', async () => {
    await sendCommand('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 300));

    await sendCommand('TOGGLE_BLUR_ALL');
    await new Promise((r) => setTimeout(r, 300));

    const paraBlurred = await hasClass('#test-para', 'pb-blurred');
    const imgBlurred = await hasClass('#test-img', 'pb-blurred');
    expect(paraBlurred).toBe(false);
    expect(imgBlurred).toBe(false);
  });

  test('picker activates and adds pb-picker-active class', async () => {
    await sendCommand('TOGGLE_PICKER');
    await new Promise((r) => setTimeout(r, 300));

    const pickerActive = await page.evaluate(() =>
      document.documentElement.classList.contains('pb-picker-active')
    );
    expect(pickerActive).toBe(true);
  });

  test('clicking an image in picker mode applies pb-blurred', async () => {
    await sendCommand('TOGGLE_PICKER');
    await new Promise((r) => setTimeout(r, 300));

    await page.click('#test-img');
    await new Promise((r) => setTimeout(r, 300));

    const blurred = await hasClass('#test-img', 'pb-blurred');
    expect(blurred).toBe(true);
  });

  test('pressing Escape deactivates picker mode', async () => {
    await sendCommand('TOGGLE_PICKER');
    await new Promise((r) => setTimeout(r, 300));

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    const pickerActive = await page.evaluate(() =>
      document.documentElement.classList.contains('pb-picker-active')
    );
    expect(pickerActive).toBe(false);
  });

  test('blurred elements are restored after page reload', async () => {
    // Blur via picker.
    await sendCommand('TOGGLE_PICKER');
    await new Promise((r) => setTimeout(r, 300));

    await page.click('#test-para');
    await new Promise((r) => setTimeout(r, 400));

    const blurredBefore = await hasClass('#test-para', 'pb-blurred');
    expect(blurredBefore).toBe(true);

    // Deactivate picker.
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 200));

    // Reload and wait for content script + restore.
    await page.reload({ waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1500));

    const blurredAfter = await hasClass('#test-para', 'pb-blurred');
    expect(blurredAfter).toBe(true);
  });

  test('clear all blur removes everything', async () => {
    // Directly blur some elements to ensure there is something to clear.
    await evalInContentScript(`
      pb.BlurEngine.applyBlur(document.querySelector('#test-img'), 8);
      pb.BlurEngine.applyBlur(document.querySelector('#test-para'), 8);
    `);
    await new Promise((r) => setTimeout(r, 300));

    const before = await countBlurred();
    expect(before).toBeGreaterThan(0);

    await sendCommand('CLEAR_ALL_BLUR');
    await new Promise((r) => setTimeout(r, 500));

    const after = await countBlurred();
    expect(after).toBe(0);
  });

  // ── Google.com tests ───────────────────────────────────────────────────

  test('content script injects on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Verify content script set CSS custom properties on google.com.
    const hasCustomProp = await page.evaluate(() => {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--pb-radius');
      return val.trim().length > 0;
    });
    expect(hasCustomProp).toBe(true);
  });

  test('blur all works on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Find the content script world and call blurAllContent.
    const client = await page.createCDPSession();
    try {
      const contextId = await getContentScriptContextId(client);
      expect(contextId).toBeTruthy();

      await client.send('Runtime.evaluate', {
        expression: 'pb.BlurEngine.blurAllContent(8)',
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
    } finally {
      await client.detach();
    }

    await new Promise((r) => setTimeout(r, 500));

    const blurredCount = await page.evaluate(
      () => document.querySelectorAll('.pb-blurred').length
    );
    expect(blurredCount).toBeGreaterThan(0);
  });

  test('picker mode works on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    const client = await page.createCDPSession();
    try {
      const contextId = await getContentScriptContextId(client);
      expect(contextId).toBeTruthy();

      // Activate picker via content script world.
      await client.send('Runtime.evaluate', {
        expression: `
          pb.Picker.activate(
            { blurRadius: 8, highlightColor: '#f59e0b' },
            {
              onBlur: function(el) { pb.BlurEngine.applyBlur(el, 8); },
              onUnblur: function(el) { pb.BlurEngine.removeBlur(el); },
              onDeactivate: function() {}
            }
          );
        `,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
    } finally {
      await client.detach();
    }

    await new Promise((r) => setTimeout(r, 300));

    const pickerActive = await page.evaluate(() =>
      document.documentElement.classList.contains('pb-picker-active')
    );
    expect(pickerActive).toBe(true);

    // Escape to deactivate.
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    const pickerAfter = await page.evaluate(() =>
      document.documentElement.classList.contains('pb-picker-active')
    );
    expect(pickerAfter).toBe(false);
  });

  // ── Popup test ────────────────────────────────────────────────────────────

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
    expect(bodyText).toContain('PrivacyBlur');

    await popupPage.close();
  });
});
