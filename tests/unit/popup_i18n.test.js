/**
 * tests/unit/popup_i18n.test.js
 *
 * Unit tests for popup/popup_i18n.js — the popup-only i18n loader.
 *
 * The loader holds module-private state (_strings, _fallback). Once
 * _fallback is loaded it sticks for the rest of the suite, so all tests
 * share the same fallback shape and only swap _strings via init(lang).
 */

'use strict';

const path = require('path');
const fs = require('fs');

const MODULE_PATH = path.resolve(__dirname, '../../popup/popup_i18n.js');

// Load the loader exactly once for the whole suite.
beforeAll(() => {
  global.chrome = global.chrome || {};
  global.chrome.runtime = global.chrome.runtime || {};
  global.chrome.runtime.getURL = jest.fn((p) => 'chrome-extension://test/' + p);
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  }
});

describe('popup_i18n loader', () => {
  let originalFetch;
  let originalNavLanguage;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalNavLanguage = navigator.language;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(navigator, 'language', { value: originalNavLanguage, configurable: true });
  });

  // Every test uses the same en/popup.json shape so the cached _fallback
  // stays consistent across the suite. Per-test variation lives in hi/.
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

  function setNavLanguage(lang) {
    Object.defineProperty(navigator, 'language', { value: lang, configurable: true });
  }

  const EN_BASE = { hello: 'Hello', only_en: 'EN only', greet: 'Hi {{name}}, you have {{count}} items' };

  // ── init shape ─────────────────────────────────────────────────────────────

  test('I18n module is exposed on blsi', () => {
    expect(blsi.I18n).toBeDefined();
    expect(typeof blsi.I18n.init).toBe('function');
    expect(typeof blsi.I18n.t).toBe('function');
  });

  test("init('en') leaves t() returning English fallback", async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(blsi.I18n.t('hello')).toBe('Hello');
  });

  test("init('hi_IN') loads Hindi as primary; missing keys fall back to English", async () => {
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/hi_IN/popup.json': { hello: 'नमस्ते' },
    });
    await blsi.I18n.init('hi_IN');
    expect(blsi.I18n.t('hello')).toBe('नमस्ते');
    expect(blsi.I18n.t('only_en')).toBe('EN only');
  });

  test("init('ta_IN') loads Tamil as primary", async () => {
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/ta_IN/popup.json': { hello: 'வணக்கம்' },
    });
    await blsi.I18n.init('ta_IN');
    expect(blsi.I18n.t('hello')).toBe('வணக்கம்');
  });

  test("init('auto') with hi-IN navigator resolves to hi_IN", async () => {
    setNavLanguage('hi-IN');
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/hi_IN/popup.json': { hello: 'नमस्ते' },
    });
    await blsi.I18n.init('auto');
    expect(blsi.I18n.t('hello')).toBe('नमस्ते');
  });

  test("init('auto') with ta-IN navigator resolves to ta_IN", async () => {
    setNavLanguage('ta-IN');
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/ta_IN/popup.json': { hello: 'வணக்கம்' },
    });
    await blsi.I18n.init('auto');
    expect(blsi.I18n.t('hello')).toBe('வணக்கம்');
  });

  test("init('auto') with bare 'hi' navigator falls back to first hi_* match", async () => {
    setNavLanguage('hi');
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/hi_IN/popup.json': { hello: 'नमस्ते' },
    });
    await blsi.I18n.init('auto');
    expect(blsi.I18n.t('hello')).toBe('नमस्ते');
  });

  test("init('auto') with unsupported navigator clamps to English", async () => {
    setNavLanguage('fr-FR');
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('auto');
    expect(blsi.I18n.t('hello')).toBe('Hello');
  });

  test('switching from hi_IN back to en restores English strings', async () => {
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/hi_IN/popup.json': { hello: 'नमस्ते' },
    });
    await blsi.I18n.init('hi_IN');
    expect(blsi.I18n.t('hello')).toBe('नमस्ते');
    await blsi.I18n.init('en');
    expect(blsi.I18n.t('hello')).toBe('Hello');
  });

  test('unknown key returns the key itself', async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(blsi.I18n.t('totally_unknown')).toBe('totally_unknown');
  });

  // ── interpolation ──────────────────────────────────────────────────────────

  test('t(key, replacements) interpolates {{name}} placeholders', async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(blsi.I18n.t('greet', { name: 'Asha', count: 3 })).toBe('Hi Asha, you have 3 items');
  });

  // ── re-init does not re-fetch the cached fallback ──────────────────────────

  test("init('en') after fallback is cached fetches nothing extra", async () => {
    // Fallback already loaded by earlier tests; new init('en') should be a no-op fetch-wise.
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(global.fetch).toHaveBeenCalledTimes(0);
  });
});
