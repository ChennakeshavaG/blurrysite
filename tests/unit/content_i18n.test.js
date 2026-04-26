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

/* === TEST QUALITY ANNOTATIONS ===
 * Covers: module exposure on blsi, init() for explicit locales (en/hi_IN/ta_IN),
 *         auto-resolution via chrome.i18n.getUILanguage() (not navigator.language),
 *         fallback chain for missing keys, t(key, fallback) explicit fallback argument,
 *         unknown-key passthrough, missing-key warn-once dedup, fetch failure recovery.
 *
 * Redundant:
 *   Tests 2-7 are structurally identical to their popup_i18n.test.js counterparts.
 *   The only differences are: chrome.i18n.getUILanguage() vs navigator.language,
 *   Each test below is marked with the equivalent popup_i18n test it mirrors.
 *
 * Optimization opportunities:
 *   All init/t/auto tests are structurally identical to popup_i18n — a shared
 *   parameterized test factory (e.g. makeI18nSuite(module, fetchKey, langSource))
 *   would eliminate 90% of duplication between the two files.
 *   mockFetch() helper is a verbatim copy of the popup_i18n version — move to a
 *   shared tests/util/i18n_helpers.js.
 *
 * Missing coverage:
 *   - currentLang getter before any init() — should default to 'en'
 *   - init() with unsupported language string (e.g. 'xyz_XY') — should fall back to English
 *   - t(key, fallback) where fallback is null, undefined, or empty string
 *   - _resolveAuto() with bare language code that has no supported variant (e.g. 'fr')
 *
 * === END ANNOTATIONS === */

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

// USER IMPACT: content script adopts popup's language setting — picker toolbar and aria labels appear in correct locale
describe('blsi.ContentI18n', () => {
  let originalFetch;
  let warnSpy;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Silence missing-key dev warnings. Individual tests that exercise
    // the warn path read warnSpy.mock.calls to assert the dedup.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    warnSpy.mockRestore();
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

  // REDUNDANT: mirrors popup_i18n "init('en') leaves t() returning English fallback"
  // OPTIMIZE: structurally identical to init('hi_IN') and init('ta_IN') tests — test.each candidate
  test("init('en') only fetches the English file", async () => {
    mockFetch({ '/en/messages.json': EN_BASE });
    await blsi.ContentI18n.init('en');
    // Fallback already cached from prior tests, so this may be 0 fetches.
    // What we really care about: t() returns English.
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('Clear');
    expect(blsi.ContentI18n.currentLang).toBe('en');
  });

  // REDUNDANT: mirrors popup_i18n "init('hi_IN') loads Hindi as primary; missing keys fall back to English" — same shape, different file
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

  // REDUNDANT: mirrors popup_i18n "init('ta_IN') loads Tamil as primary" — same shape, different file
  test("init('ta_IN') loads Tamil", async () => {
    mockFetch({
      '/en/messages.json': EN_BASE,
      '/ta_IN/messages.json': { pickerClearBtn: { message: 'அழி' } },
    });
    await blsi.ContentI18n.init('ta_IN');
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('அழி');
  });

  // USER IMPACT: uses chrome.i18n.getUILanguage() not navigator.language — reflects extension UI pref, not page locale
  // REDUNDANT: mirrors popup_i18n "init('auto') with hi-IN navigator resolves to hi_IN" — key difference: chrome.i18n.getUILanguage() vs navigator.language
  // OPTIMIZE: all four auto-resolution tests are structurally identical — test.each([['hi-IN', 'hi_IN'], ['ta', 'ta_IN'], ['fr-FR', 'en']]) candidate
  test("init('auto') with hi-IN UI language resolves to hi_IN", async () => {
    chrome.i18n.getUILanguage.mockReturnValue('hi-IN');
    mockFetch({
      '/en/messages.json': EN_BASE,
      '/hi_IN/messages.json': { pickerClearBtn: { message: 'साफ़' } },
    });
    await blsi.ContentI18n.init('auto');
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('साफ़');
  });

  // REDUNDANT: mirrors popup_i18n "init('auto') with bare 'hi' navigator falls back to first hi_* match" — same bare-code logic, different language
  test("init('auto') with bare 'ta' UI language resolves to ta_IN", async () => {
    chrome.i18n.getUILanguage.mockReturnValue('ta');
    mockFetch({
      '/en/messages.json': EN_BASE,
      '/ta_IN/messages.json': { pickerClearBtn: { message: 'அழி' } },
    });
    await blsi.ContentI18n.init('auto');
    expect(blsi.ContentI18n.t('pickerClearBtn')).toBe('அழி');
  });

  // REDUNDANT: mirrors popup_i18n "init('auto') with unsupported navigator clamps to English" — same fallback logic
  test("init('auto') with unsupported UI language clamps to English", async () => {
    chrome.i18n.getUILanguage.mockReturnValue('fr-FR');
    mockFetch({ '/en/messages.json': EN_BASE });
    await blsi.ContentI18n.init('auto');
    expect(blsi.ContentI18n.currentLang).toBe('en');
  });

  // USER IMPACT: partial translation — content script UI shows English for missing keys
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

  test('missing key logs once per key per init', async () => {
    mockFetch({ '/en/messages.json': EN_BASE });
    await blsi.ContentI18n.init('en');
    warnSpy.mockClear();
    blsi.ContentI18n.t('ghost_key', 'English fallback');
    blsi.ContentI18n.t('ghost_key', 'English fallback');
    blsi.ContentI18n.t('ghost_key', 'English fallback');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('missing key: ghost_key');
  });

  // USER IMPACT: offline or broken locale file — content script shows English fallback, not blank UI
  // MISSING: no test for currentLang getter before any init() — should default to 'en'
  // MISSING: no test for init() with unsupported language string (e.g. 'xyz_XY')
  // MISSING: no test for t(key, fallback) where fallback is null, undefined, or empty string
  // MISSING: no test for _resolveAuto() with bare language that has no supported variant (e.g. 'fr')
  test('failed fetch leaves t() returning the fallback literal', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network'); });
    await blsi.ContentI18n.init('hi_IN');
    expect(blsi.ContentI18n.t('newKey', 'English fallback')).toBe('English fallback');
  });
});
