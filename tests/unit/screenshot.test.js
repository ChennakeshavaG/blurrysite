/**
 * tests/unit/screenshot.test.js
 *
 * Unit tests for src/screenshot.js
 * Module exposes blsi.Screenshot with:
 *   captureViewport, download, copyToClipboard, startCrop, cancelCrop
 */

/* === TEST QUALITY ANNOTATIONS ===
 * Covers: captureViewport happy path, captureViewport rejection (lastError + no data),
 *         download no-throw (jsdom limitation), startCrop overlay injection,
 *         cancelCrop no-throw when active, cancelCrop safety when no crop active.
 *
 * Redundant:
 *   "captureViewport rejects on runtime error" and "captureViewport rejects when no
 *   data returned" both verify the rejection path of captureViewport — could be merged
 *   into test.each([['lastError', ...setup], ['no data', ...setup]]).
 *
 * Optimization opportunities:
 *   Rejection tests → test.each([['Tab not found via lastError', lastErrSetup], ['No screenshot data', noDataSetup]])
 *   cancelCrop tests — "cancelCrop removes the overlay" has zero assertions; add DOM
 *   assertion to verify overlay child count drops back to zero.
 *
 * Missing coverage:
 *   - copyToClipboard() — public API method with zero test coverage
 *   - Crop drag simulation: mousedown → mousemove → mouseup sequence → callback with rect
 *   - Crop callback with undersized region (< 10x10 px) — should pass null or skip
 *   - startCrop() called while a crop is already active — should cancel and restart
 *   - download() anchor element creation and programmatic click (jsdom limitation; verify attempt)
 *
 * === END ANNOTATIONS === */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/screenshot.js');

function freshLoad() {
  delete blsi.Screenshot;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

// USER IMPACT: user clicks screenshot button — viewport captured with blur preserved
describe('screenshot.js', () => {
  beforeEach(() => {
    freshLoad();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    blsi.Screenshot.cancelCrop();
    document.body.innerHTML = '';
  });

  test('captureViewport sends CAPTURE_VIEWPORT message', async () => {
    const testDataUrl = 'data:image/png;base64,fakedata';
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      expect(msg.type).toBe('CAPTURE_VIEWPORT');
      if (cb) cb({ dataUrl: testDataUrl });
    });

    const result = await blsi.Screenshot.captureViewport();
    expect(result).toBe(testDataUrl);
  });

  // OPTIMIZE: structurally identical to "captureViewport rejects when no data returned" — test.each([['lastError', ...], ['no data', ...]]) candidate
  test('captureViewport rejects on runtime error', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      Object.defineProperty(chrome.runtime, 'lastError', {
        value: { message: 'Tab not found' },
        configurable: true,
      });
      if (cb) cb(undefined);
      Object.defineProperty(chrome.runtime, 'lastError', {
        value: null,
        configurable: true,
      });
    });

    await expect(blsi.Screenshot.captureViewport()).rejects.toThrow('Tab not found');
  });

  // REDUNDANT: both rejection tests verify captureViewport Promise.reject path — only the error setup differs; test.each candidate
  test('captureViewport rejects when no data returned', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (cb) cb({});
    });

    await expect(blsi.Screenshot.captureViewport()).rejects.toThrow('No screenshot data');
  });

  // USER IMPACT: user downloads screenshot — browser save dialog triggered (jsdom cannot verify this)
  // NOTE: this is essentially a no-op test — jsdom cannot exercise anchor click or navigation; verifies only no-crash
  test('download does not throw', () => {
    // Just verify it doesn't crash (jsdom doesn't support navigation)
    expect(() => blsi.Screenshot.download('data:image/png;base64,abc', 'test.png')).not.toThrow();
  });

  // USER IMPACT: user clicks crop — full-screen crosshair overlay appears for drag selection
  // MISSING: no test for copyToClipboard() — public API with zero coverage
  // MISSING: no test for crop drag simulation (mousedown → mousemove → mouseup → callback with rect)
  // MISSING: no test for undersized crop region (< 10x10 px) — should yield null callback
  // MISSING: no test for startCrop() called while crop already active (should cancel and restart)
  test('startCrop creates an overlay element on the body', () => {
    const childCountBefore = document.body.children.length;
    blsi.Screenshot.startCrop(jest.fn());
    expect(document.body.children.length).toBeGreaterThan(childCountBefore);
  });

  // USER IMPACT: user presses Escape during crop — overlay removed cleanly
  // NOTE: this test has NO assertions — it only verifies no-throw; add DOM assertion (body.children.length === 0) to make it meaningful
  test('cancelCrop removes the overlay', () => {
    blsi.Screenshot.startCrop(jest.fn());
    blsi.Screenshot.cancelCrop();
    // No throw, overlay cleaned up
  });

  test('cancelCrop is safe when no crop active', () => {
    expect(() => blsi.Screenshot.cancelCrop()).not.toThrow();
  });
});
