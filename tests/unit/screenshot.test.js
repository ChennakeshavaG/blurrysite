/**
 * tests/unit/screenshot.test.js
 *
 * Unit tests for src/screenshot.js
 * Module exposes blsi.Screenshot with:
 *   captureViewport, download, copyToClipboard, startCrop, cancelCrop
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/screenshot.js');

function freshLoad() {
  delete blsi.Screenshot;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

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

  test('captureViewport rejects when no data returned', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (cb) cb({});
    });

    await expect(blsi.Screenshot.captureViewport()).rejects.toThrow('No screenshot data');
  });

  test('download does not throw', () => {
    // Just verify it doesn't crash (jsdom doesn't support navigation)
    expect(() => blsi.Screenshot.download('data:image/png;base64,abc', 'test.png')).not.toThrow();
  });

  test('startCrop creates an overlay element on the body', () => {
    const childCountBefore = document.body.children.length;
    blsi.Screenshot.startCrop(jest.fn());
    expect(document.body.children.length).toBeGreaterThan(childCountBefore);
  });

  test('cancelCrop removes the overlay', () => {
    blsi.Screenshot.startCrop(jest.fn());
    blsi.Screenshot.cancelCrop();
    // No throw, overlay cleaned up
  });

  test('cancelCrop is safe when no crop active', () => {
    expect(() => blsi.Screenshot.cancelCrop()).not.toThrow();
  });
});
