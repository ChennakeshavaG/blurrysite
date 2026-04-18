/**
 * tests/unit/popup_i18n.test.js
 *
 * Unit tests for popup/popup_i18n.js — the popup-only i18n loader.
 *
 * The loader holds module-private state (_strings, _fallback). Once
 * _fallback is loaded it sticks for the rest of the suite, so all tests
 * share the same fallback shape and only swap _strings via init(lang).
 */

/* === TEST QUALITY ANNOTATIONS ===
 * Covers: module exposure on blsi, init() for explicit locales (en/hi_IN/ta_IN),
 *         auto-resolution via navigator.language, fallback chain, language
 *         switching, unknown key passthrough, missing-key warn-once dedup,
 *         re-init clears warn cache, {{placeholder}} interpolation,
 *         no-op re-fetch when fallback is cached.
 *
 * Redundant:
 *   "init('en') leaves t() returning English fallback", "init('hi_IN') loads Hindi",
 *   and "init('ta_IN') loads Tamil" are structurally identical (init lang, assert
 *   t() result) — candidates for test.each.
 *   "init('auto') with hi-IN navigator", "init('auto') with ta-IN navigator",
 *   "init('auto') with bare 'hi'", and "init('auto') with unsupported" all test
 *   auto resolution with different navigator.language values — candidates for test.each.
 *
 * Optimization opportunities:
 *   Language init tests (3) → test.each([['en', 'Hello'], ['hi_IN', 'नमस्ते'], ['ta_IN', 'வணக்கம்']])
 *   Auto-resolution tests (4) → test.each([['hi-IN', 'hi_IN'], ['ta-IN', 'ta_IN'], ['hi', 'hi_IN'], ['fr', 'en']])
 *   mockFetch() pattern duplicated in content_i18n.test.js — could be extracted to a shared test utility.
 *
 * Missing coverage:
 *   - init() with entirely unsupported locale string (e.g. 'xyz_XY') — should fall back to English
 *   - t() with null or undefined key — should not throw
 *   - Concurrent init() calls (race condition: second call completes before first)
 *   - Interpolation edge cases: missing placeholder key in replacements, numeric value passed
 *
 * === END ANNOTATIONS === */

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
  let warnSpy;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalNavLanguage = navigator.language;
    // Silence missing-key dev warnings by default so expected-miss tests
    // don't pollute output. Individual tests can read warnSpy.mock.calls
    // to assert the warn path.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(navigator, 'language', { value: originalNavLanguage, configurable: true });
    warnSpy.mockRestore();
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

  // USER IMPACT: user changes popup language in settings — popup immediately shows correct locale
  test('I18n module is exposed on blsi', () => {
    expect(blsi.I18n).toBeDefined();
    expect(typeof blsi.I18n.init).toBe('function');
    expect(typeof blsi.I18n.t).toBe('function');
  });

  // OPTIMIZE: structurally identical to init('hi_IN') and init('ta_IN') tests — refactor to test.each([['en', EN_BASE, 'Hello'], ['hi_IN', ...], ['ta_IN', ...]])
  test("init('en') leaves t() returning English fallback", async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(blsi.I18n.t('hello')).toBe('Hello');
  });

  // REDUNDANT: same init-then-assert-t() shape as "init('en')" and "init('ta_IN')" — test.each candidate
  test("init('hi_IN') loads Hindi as primary; missing keys fall back to English", async () => {
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/hi_IN/popup.json': { hello: 'नमस्ते' },
    });
    await blsi.I18n.init('hi_IN');
    expect(blsi.I18n.t('hello')).toBe('नमस्ते');
    expect(blsi.I18n.t('only_en')).toBe('EN only');
  });

  // REDUNDANT: same init-then-assert-t() shape as "init('en')" and "init('hi_IN')" — test.each candidate
  test("init('ta_IN') loads Tamil as primary", async () => {
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/ta_IN/popup.json': { hello: 'வணக்கம்' },
    });
    await blsi.I18n.init('ta_IN');
    expect(blsi.I18n.t('hello')).toBe('வணக்கம்');
  });

  // USER IMPACT: user's OS is Hindi — popup automatically loads Hindi without manual selection
  // OPTIMIZE: all four auto-resolution tests are structurally identical — test.each([['hi-IN', 'hi_IN'], ['ta-IN', 'ta_IN'], ['hi', 'hi_IN'], ['fr-FR', 'en']])
  test("init('auto') with hi-IN navigator resolves to hi_IN", async () => {
    setNavLanguage('hi-IN');
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/hi_IN/popup.json': { hello: 'नमस्ते' },
    });
    await blsi.I18n.init('auto');
    expect(blsi.I18n.t('hello')).toBe('नमस्ते');
  });

  // REDUNDANT: same auto-resolve shape as hi-IN, bare 'hi', and unsupported — test.each candidate
  test("init('auto') with ta-IN navigator resolves to ta_IN", async () => {
    setNavLanguage('ta-IN');
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/ta_IN/popup.json': { hello: 'வணக்கம்' },
    });
    await blsi.I18n.init('auto');
    expect(blsi.I18n.t('hello')).toBe('வணக்கம்');
  });

  // REDUNDANT: same auto-resolve shape as hi-IN, ta-IN, and unsupported — test.each candidate
  test("init('auto') with bare 'hi' navigator falls back to first hi_* match", async () => {
    setNavLanguage('hi');
    mockFetch({
      '/en/popup.json': EN_BASE,
      '/hi_IN/popup.json': { hello: 'नमस्ते' },
    });
    await blsi.I18n.init('auto');
    expect(blsi.I18n.t('hello')).toBe('नमस्ते');
  });

  // REDUNDANT: same auto-resolve shape as hi-IN, ta-IN, and bare 'hi' — test.each candidate
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

  // USER IMPACT: partial translation — missing keys show English instead of blank or raw key
  test('unknown key returns the key itself', async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(blsi.I18n.t('totally_unknown')).toBe('totally_unknown');
  });

  // USER IMPACT: missing translation keys logged once per locale switch — not spammed on every render
  test('missing key logs console.warn once per key per init', async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    warnSpy.mockClear();
    // Same key 3 times → 1 warning
    blsi.I18n.t('ghost_key');
    blsi.I18n.t('ghost_key');
    blsi.I18n.t('ghost_key');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('missing key: ghost_key');
    // A second unknown key → one additional warning
    blsi.I18n.t('ghost_key_2');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test('re-init clears the warn-once cache so missing keys re-warn in the new locale', async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    blsi.I18n.t('ghost_after_reinit');
    warnSpy.mockClear();
    await blsi.I18n.init('en');
    blsi.I18n.t('ghost_after_reinit');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  // ── interpolation ──────────────────────────────────────────────────────────

  // USER IMPACT: popup shows 'Blurred 3 items on this page' — dynamic count inserted correctly
  test('t(key, replacements) interpolates {{name}} placeholders', async () => {
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(blsi.I18n.t('greet', { name: 'Asha', count: 3 })).toBe('Hi Asha, you have 3 items');
  });

  // ── re-init does not re-fetch the cached fallback ──────────────────────────

  // MISSING: no test for init() with unsupported locale string (e.g. 'xyz_XY') falling back to English
  // MISSING: no test for t() with null or undefined key — should not crash
  // MISSING: no test for concurrent init() calls (race condition)
  // MISSING: no test for interpolation edge cases (missing placeholder key, numeric value)
  test("init('en') after fallback is cached fetches nothing extra", async () => {
    // Fallback already loaded by earlier tests; new init('en') should be a no-op fetch-wise.
    mockFetch({ '/en/popup.json': EN_BASE });
    await blsi.I18n.init('en');
    expect(global.fetch).toHaveBeenCalledTimes(0);
  });
});
