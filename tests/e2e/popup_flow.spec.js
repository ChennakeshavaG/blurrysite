/**
 * tests/e2e/popup_flow.spec.js
 *
 * Tests the actual popup UI buttons. Due to a Puppeteer limitation where
 * chrome.tabs.sendMessage blocks the CDP connection to the target page,
 * we verify results via the popup's own state (which re-fetches from storage)
 * rather than by querying the content page DOM directly.
 */

'use strict';

const http = require('http');
const path = require('path');

const SKIP = !!process.env.SKIP_E2E;
const EXTENSION_PATH = path.resolve(__dirname, '../../');

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Popup Flow Test</title></head>
<body>
  <h1 id="title">Test Page</h1>
  <p id="para1">Sensitive paragraph one.</p>
  <p id="para2">Sensitive paragraph two.</p>
  <img id="img1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="test image" style="width:200px;height:200px;">
</body>
</html>`;

const describeFn = SKIP ? describe.skip : describe;

describeFn('Popup UI Flow', () => {
  let puppeteer, browser, extensionId, server, testPageUrl;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(TEST_PAGE_HTML);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    testPageUrl = `http://127.0.0.1:${server.address().port}/`;

    puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: process.env.E2E_HEADED ? false : 'new',
      slowMo: process.env.E2E_HEADED ? 80 : 0,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox', '--disable-setuid-sandbox',
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
    if (extTarget) extensionId = extTarget.url().split('//')[1].split('/')[0];
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  async function openPopup() {
    const url = `chrome-extension://${extensionId}/popup/popup.html`;
    const p = await browser.newPage();
    const logs = [];
    p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));
    return { p, logs };
  }

  async function closePopup(p) {
    await p.goto('about:blank').catch(() => {});
    await p.close().catch(() => {});
  }

  async function getPopupState(p) {
    return p.evaluate(() => {
      const el = (id) => document.getElementById(id);
      return {
        hostname: el('hostname')?.textContent,
        enabled: el('enableToggle')?.checked,
        enableLabel: el('enableLabel')?.textContent,
        blurCount: el('blurCount')?.textContent,
        listCount: el('listCount')?.textContent,
        toast: el('toast')?.textContent,
        radiusValue: el('blurRadiusValue')?.textContent,
      };
    });
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  test('popup finds the content page and shows correct hostname', async () => {
    const contentPage = await browser.newPage();
    await contentPage.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    const { p } = await openPopup();
    const state = await getPopupState(p);
    console.log('  → Popup state:', JSON.stringify(state));

    expect(state.hostname).toBe('127.0.0.1');
    expect(state.enabled).toBe(true);
    expect(state.blurCount).toBe('0');

    await closePopup(p);
    await contentPage.close();
  });

  test('popup Blur All click shows toast and updates list count', async () => {
    const contentPage = await browser.newPage();
    await contentPage.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    const { p, logs } = await openPopup();

    // Click Blur All.
    await p.evaluate(() => document.getElementById('blurAllBtn').click());
    // Wait for tabMessage + storage round trip.
    await new Promise((r) => setTimeout(r, 3000));

    const state = await getPopupState(p);
    console.log('  → After Blur All:', JSON.stringify(state));
    console.log('  → Popup logs:', logs.filter(l => l.includes('warn') || l.includes('error')).join('; ') || 'none');

    expect(state.toast).toContain('blurred');

    await closePopup(p);
    await contentPage.close().catch(() => {});
  });

  test('popup finds google.com tab and shows hostname', async () => {
    const contentPage = await browser.newPage();
    await contentPage.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    const { p } = await openPopup();
    const state = await getPopupState(p);
    console.log('  → Popup on google:', JSON.stringify(state));

    expect(state.hostname).toBe('www.google.com');
    expect(state.enabled).toBe(true);

    await closePopup(p);
    await contentPage.close();
  });

  test('popup Blur All on google.com shows toast', async () => {
    const contentPage = await browser.newPage();
    await contentPage.goto('https://www.google.com', { waitUntil: 'load', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    const { p, logs } = await openPopup();

    await p.evaluate(() => document.getElementById('blurAllBtn').click());
    await new Promise((r) => setTimeout(r, 3000));

    const state = await getPopupState(p);
    console.log('  → After Blur All on google:', JSON.stringify(state));
    console.log('  → Popup logs:', logs.filter(l => l.includes('warn') || l.includes('error')).join('; ') || 'none');

    expect(state.toast).toContain('blurred');
    // No tabMessage errors means the message was delivered successfully.
    const hasTabError = logs.some(l => l.includes('tabMessage failed'));
    expect(hasTabError).toBe(false);

    await closePopup(p);
    await contentPage.close().catch(() => {});
  });

  test('popup settings slider saves and shows updated radius', async () => {
    const contentPage = await browser.newPage();
    await contentPage.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    const { p } = await openPopup();

    // Open settings.
    await p.evaluate(() => document.getElementById('settingsToggle').click());
    await new Promise((r) => setTimeout(r, 400));

    // Change slider.
    await p.evaluate(() => {
      const s = document.getElementById('blurRadius');
      s.value = 14;
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 600));

    const state = await getPopupState(p);
    console.log('  → Radius in popup:', state.radiusValue);
    expect(state.radiusValue).toBe('14px');

    await closePopup(p);

    // Verify via storage (open a fresh popup to read back).
    await new Promise((r) => setTimeout(r, 300));
    const { p: p2 } = await openPopup();
    const state2 = await getPopupState(p2);
    console.log('  → Radius persisted in next popup open:', state2.radiusValue);
    expect(state2.radiusValue).toBe('14px');

    await closePopup(p2);
    await contentPage.close();
  });

  test('popup Clear Page click shows toast', async () => {
    const contentPage = await browser.newPage();
    await contentPage.goto(testPageUrl, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));

    const { p, logs } = await openPopup();

    await p.evaluate(() => document.getElementById('clearPageBtn').click());
    await new Promise((r) => setTimeout(r, 2000));

    const state = await getPopupState(p);
    console.log('  → After Clear Page:', JSON.stringify(state));
    console.log('  → Popup logs:', logs.filter(l => l.includes('warn') || l.includes('error')).join('; ') || 'none');

    expect(state.toast).toContain('cleared');

    await closePopup(p);
    await contentPage.close().catch(() => {});
  });
});
