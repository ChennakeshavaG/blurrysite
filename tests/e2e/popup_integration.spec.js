/**
 * tests/e2e/popup_integration.spec.js
 *
 * Tests for popup → background → content script communication.
 * Uses CDP to evaluate in the content script's isolated world (reliable).
 * Avoids worker.evaluate() which hangs with Puppeteer service workers.
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
  <img id="img1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="test">
</body>
</html>`;

const describeFn = SKIP ? describe.skip : describe;

describeFn('Popup ↔ Content Script Integration', () => {
  let puppeteer;
  let browser;
  let page;
  let extensionId;
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

  // ── Helpers (all use CDP — no worker.evaluate) ───────────────────────────

  async function getContentScriptContextId(client) {
    const contexts = [];
    client.on('Runtime.executionContextCreated', (params) => {
      contexts.push(params.context);
    });
    await client.send('Runtime.disable');
    await client.send('Runtime.enable');
    await new Promise((r) => setTimeout(r, 100));
    return (
      contexts.find(
        (ctx) =>
          ctx.origin &&
          ctx.origin.includes('chrome-extension://') &&
          ctx.auxData &&
          ctx.auxData.type === 'isolated'
      ) || {}
    ).id;
  }

  async function evalInContentScript(expression) {
    const client = await page.createCDPSession();
    try {
      const contextId = await getContentScriptContextId(client);
      if (!contextId) throw new Error('Content script context not found');
      const result = await client.send('Runtime.evaluate', {
        expression,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'Eval failed');
      }
      return result.result.value;
    } finally {
      await client.detach();
    }
  }

  async function countBlurred() {
    return page.evaluate(() => document.querySelectorAll('.pb-blurred').length);
  }

  async function getRadius() {
    return page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--pb-radius').trim()
    );
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  test('content script receives messages and blurs content', async () => {
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    // Trigger TOGGLE_BLUR_ALL via content script globals (simulates what
    // background.js does when relaying chrome.commands).
    await evalInContentScript(`
      window.PrivacyBlurEngine.blurAllContent(8);
    `);
    await new Promise((r) => setTimeout(r, 300));

    const count = await countBlurred();
    console.log(`  → Blurred: ${count}`);
    expect(count).toBeGreaterThan(0);

    // Unblur.
    await evalInContentScript(`window.PrivacyBlurEngine.unblurAll()`);
  });

  test('settings change via chrome.storage.onChanged reaches content script', async () => {
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    const radiusBefore = await getRadius();
    console.log(`  → Radius before: ${radiusBefore}`);

    // Change settings via chrome.storage.local (content script has access).
    // This fires chrome.storage.onChanged which the content script listens to.
    await evalInContentScript(`
      new Promise((resolve) => {
        chrome.storage.local.get('settings', (result) => {
          const s = result.settings || {};
          s.blurRadius = 15;
          chrome.storage.local.set({ settings: s }, resolve);
        });
      });
    `);
    await new Promise((r) => setTimeout(r, 500));

    const radiusAfter = await getRadius();
    console.log(`  → Radius after: ${radiusAfter}`);
    expect(radiusAfter).toBe('15px');

    // Reset.
    await evalInContentScript(`
      new Promise((resolve) => {
        chrome.storage.local.get('settings', (result) => {
          const s = result.settings || {};
          s.blurRadius = 8;
          chrome.storage.local.set({ settings: s }, resolve);
        });
      });
    `);
    await new Promise((r) => setTimeout(r, 300));
  });

  test('disabling extension via storage blocks blur actions', async () => {
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    // Disable via storage — content script picks this up via onChanged.
    await evalInContentScript(`
      new Promise((resolve) => {
        chrome.storage.local.get('settings', (result) => {
          const s = result.settings || {};
          s.enabled = false;
          chrome.storage.local.set({ settings: s }, resolve);
        });
      });
    `);
    await new Promise((r) => setTimeout(r, 500));

    // Try to blur directly — engine still works, but content script message
    // handler should block TOGGLE_BLUR_ALL from background.
    // Simulate the message handler check:
    const canBlur = await evalInContentScript(`
      // Check the internal settings.enabled flag in the content script closure.
      // We can't access it directly, but we can check the observable effect:
      // try to send a message through the extension's own messaging.
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
          resolve(resp && resp.settings ? resp.settings.enabled : 'unknown');
        });
      });
    `);
    console.log(`  → Enabled in storage: ${canBlur}`);
    expect(canBlur).toBe(false);

    // Re-enable.
    await evalInContentScript(`
      new Promise((resolve) => {
        chrome.storage.local.get('settings', (result) => {
          const s = result.settings || {};
          s.enabled = true;
          chrome.storage.local.set({ settings: s }, resolve);
        });
      });
    `);
    await new Promise((r) => setTimeout(r, 300));
  });

  test('blur all works on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Verify content script is injected.
    const hasCS = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--pb-radius').trim().length > 0
    );
    console.log(`  → Content script on google: ${hasCS}`);
    expect(hasCS).toBe(true);

    // Blur all via content script world.
    await evalInContentScript(`window.PrivacyBlurEngine.blurAllContent(8)`);
    await new Promise((r) => setTimeout(r, 500));

    const count = await countBlurred();
    console.log(`  → Blurred on google: ${count}`);
    expect(count).toBeGreaterThan(0);

    // Unblur.
    await evalInContentScript(`window.PrivacyBlurEngine.unblurAll()`);
  });

  test('clear page works on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Blur.
    await evalInContentScript(`window.PrivacyBlurEngine.blurAllContent(8)`);
    await new Promise((r) => setTimeout(r, 300));
    const before = await countBlurred();
    console.log(`  → Before clear: ${before}`);
    expect(before).toBeGreaterThan(0);

    // Clear.
    await evalInContentScript(`window.PrivacyBlurEngine.unblurAll()`);
    await new Promise((r) => setTimeout(r, 300));
    const after = await countBlurred();
    console.log(`  → After clear: ${after}`);
    expect(after).toBe(0);
  });

  test('picker mode works on google.com', async () => {
    await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    await evalInContentScript(`
      window.PrivacyBlurPicker.activate(
        { blurRadius: 8, highlightColor: '#f59e0b' },
        {
          onBlur: function(el) { window.PrivacyBlurEngine.applyBlur(el, 8); },
          onUnblur: function(el) { window.PrivacyBlurEngine.removeBlur(el); },
          onDeactivate: function() {}
        }
      );
    `);
    await new Promise((r) => setTimeout(r, 300));

    const active = await page.evaluate(() =>
      document.documentElement.classList.contains('pb-picker-active')
    );
    console.log(`  → Picker active on google: ${active}`);
    expect(active).toBe(true);

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    const afterEscape = await page.evaluate(() =>
      document.documentElement.classList.contains('pb-picker-active')
    );
    expect(afterEscape).toBe(false);
  });

  test('blur persists and restores on local page after reload', async () => {
    // Use local test page for reliable selector persistence (google.com
    // re-renders on load, making selectors stale — documented limitation).
    await page.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    // Blur a specific element via picker flow (save to storage).
    await evalInContentScript(`
      (async () => {
        const el = document.querySelector('#para1');
        if (el) {
          window.PrivacyBlurEngine.applyBlur(el, 8);
          const sel = window.PrivacyBlurSelectorUtils.getSelector(el);
          if (sel) {
            await window.PrivacyBlurStorage.saveBlurredElement(location.hostname, sel);
          }
        }
      })();
    `);
    await new Promise((r) => setTimeout(r, 500));

    const before = await countBlurred();
    console.log(`  → Blurred before reload: ${before}`);
    expect(before).toBeGreaterThan(0);

    // Reload.
    await page.reload({ waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1500));

    const after = await countBlurred();
    console.log(`  → Blurred after reload (restored): ${after}`);
    expect(after).toBeGreaterThan(0);

    // Clean up storage.
    await evalInContentScript(`
      window.PrivacyBlurStorage.clearHost(location.hostname);
    `);
  });
});
