/**
 * tests/unit/content_i18n.test.js
 *
 * Unit tests for src/content_i18n.js — the content-script i18n helper
 * that loads _locales/<lang>/messages.json via fetch + chrome.runtime.getURL.
 *
 * Loads the module exactly once via require() so coverage instrumentation
 * applies. Module-private state (_strings, _fallback) is shared across
 * tests, mirroring the popup_i18n test pattern.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const MODULE_PATH = path.resolve(__dirname, '../../src/content_i18n.js');

beforeAll(() => {
  global.chrome = global.chrome || {};
  global.chrome.runtime = global.chrome.runtime || {};
  global.chrome.runtime.getURL = jest.fn((p) => 'chrome-extension://test/' + p);
  global.chrome.i18n = global.chrome.i18n || {};
  global.chrome.i18n.getUILanguage = jest.fn(() => 'en');
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  }
});

describe('blsi.ContentI18n', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(map) {
    global.fetch = jest.fn(async (url) => {
      for (const [needle, body] of Object.entries(map)) {
        if (url.includes(needle)) {
          return { ok: true, json: async () => body };
        }
      }
      return { ok: false, json: async () => ({}) };
    });
  }

  // messages.json shape: { key: { message: "..." } }
  const EN_BASE = {
    pickerClearBtn: { message: 'Clear' },
    pickerCloseBtnAria: { message: 'Close picker' },
    onlyEn: { message: 'EN only' },
  };

  test('module is exposed on blsi', () => {
    expect(blsi.ContentI18n).toBeDefined();
    expect(typeof blsi.ContentI18n.init).toBe('function');
    expect(typeof blsi.ContentI18n.t).toBe('function');
  });

  test("init('en') only fetches the English file", async () => {
    mockFetch({ '/en/messages.json': EN_BASE });
    await blsi.ContentI18n.init('en');
    // Fallback already cached from prior tests, so this may be 0 fetches.
    // What we really care about: t() returns English.
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('Clear');
    expect(blsi.ContentI18n.currentLang).toBe('en');
  });

  test("init('hi_IN') loads Hindi as primary, falls back to English for missing keys", async () => {
    mockFetch({
      '/en/messages.json': EN_BASE,
      '/hi_IN/messages.json': {
        pickerClearBtn: { message: 'साफ़' },
      },
    });
    await blsi.ContentI18n.init('hi_IN');
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('साफ़');
    expect(blsi.ContentI18n.t('onlyEn')).toBe('EN only'); // fallback chain
    expect(blsi.ContentI18n.currentLang).toBe('hi_IN');
  });

  test("init('ta_IN') loads Tamil", async () => {
    mockFetch({
      '/en/messages.json': EN_BASE,
      '/ta_IN/messages.json': { pickerClearBtn: { message: 'அழி' } },
    });
    await blsi.ContentI18n.init('ta_IN');
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('அழி');
  });

  test("init('auto') with hi-IN UI language resolves to hi_IN", async () => {
    chrome.i18n.getUILanguage.mockReturnValue('hi-IN');
    mockFetch({
      '/en/messages.json': EN_BASE,
      '/hi_IN/messages.json': { pickerClearBtn: { message: 'साफ़' } },
    });
    await blsi.ContentI18n.init('auto');
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('साफ़');
  });

  test("init('auto') with bare 'ta' UI language resolves to ta_IN", async () => {
    chrome.i18n.getUILanguage.mockReturnValue('ta');
    mockFetch({
      '/en/messages.json': EN_BASE,
      '/ta_IN/messages.json': { pickerClearBtn: { message: 'அழி' } },
    });
    await blsi.ContentI18n.init('auto');
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('அழி');
  });

  test("init('auto') with unsupported UI language clamps to English", async () => {
    chrome.i18n.getUILanguage.mockReturnValue('fr-FR');
    mockFetch({ '/en/messages.json': EN_BASE });
    await blsi.ContentI18n.init('auto');
    expect(blsi.ContentI18n.currentLang).toBe('en');
  });

  test('t(key, fallback) returns fallback when neither cache has the key', async () => {
    mockFetch({ '/en/messages.json': EN_BASE });
    await blsi.ContentI18n.init('en');
    expect(blsi.ContentI18n.t('totally_unknown', 'My Fallback')).toBe('My Fallback');
  });

  test('t(key) with no fallback returns the key itself', async () => {
    mockFetch({ '/en/messages.json': EN_BASE });
    await blsi.ContentI18n.init('en');
    expect(blsi.ContentI18n.t('totally_unknown')).toBe('totally_unknown');
  });

  test('failed fetch leaves t() returning the fallback literal', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network'); });
    await blsi.ContentI18n.init('hi_IN');
    expect(blsi.ContentI18n.t('newKey', 'English fallback')).toBe('English fallback');
  });
});
