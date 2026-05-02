/**
 * tests/unit/pii/pii_country.test.js
 *
 * Unit tests for blsi.PiiCountry — page-country signal (Phase 4).
 *
 * Two surfaces tested:
 *   1. detectFromInputs(inputs) — pure function, no DOM. Most coverage here.
 *   2. detect()                 — reads document + caches; smoke-tested via
 *                                 jsdom for hostname / lang / meta inputs.
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: TLD / lang / meta / currency-density priority order.
 *         Cache lifecycle (`detect()` once, `_resetCache()`).
 *         Type guards on every input shape.
 *         Bare-language tag rejected (no region subtag → null).
 *         Multi-country currency symbols ($, €, ¥) intentionally NOT used.
 *
 * MISSING COVERAGE:
 *   - Live <html lang> changes mid-scan are not picked up because of the
 *     cache. Production reset is gated on SPA URL change paths; not tested.
 *   - geo.country with longer than 2 chars (`"USA"`) — currently silently
 *     ignored; could test the rejection.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PII_DIR = path.resolve(__dirname, '../../../src/pii');
const COUNTRY_PATH = path.join(PII_DIR, 'pii_country.js');

function buildStubSource() {
  return `(function() {
    'use strict';
    var blsi = global.blsi;
    blsi.PiiCountry = Object.freeze({
      detect:           function() { return null; },
      detectFromInputs: function() { return null; },
      _resetCache:      function() {},
    });
  })();`;
}

function loadCountry() {
  global.blsi = global.blsi || {};
  delete blsi.PiiCountry;
  jest.resetModules();
  if (fs.existsSync(COUNTRY_PATH)) {
    jest.isolateModules(() => { require(COUNTRY_PATH); });
  } else {
    (0, eval)(buildStubSource());
  }
}

// Minimal NodeList-like array of fake meta tags.
function metaList(entries) {
  return entries.map((e) => ({
    getAttribute: (name) => e[name] != null ? e[name] : null,
  }));
}

describe('pii_country.js', () => {
  beforeEach(() => loadCountry());

  // ── detectFromInputs — TLD ────────────────────────────────────────────

  describe('detectFromInputs — TLD', () => {
    test('amazon.co.uk → GB', () => {
      expect(blsi.PiiCountry.detectFromInputs({ hostname: 'amazon.co.uk' })).toBe('GB');
    });

    test('example.de → DE', () => {
      expect(blsi.PiiCountry.detectFromInputs({ hostname: 'example.de' })).toBe('DE');
    });

    test('example.in → IN', () => {
      expect(blsi.PiiCountry.detectFromInputs({ hostname: 'example.in' })).toBe('IN');
    });

    test('amazon.com → null (gTLD, no signal)', () => {
      expect(blsi.PiiCountry.detectFromInputs({ hostname: 'amazon.com' })).toBeNull();
    });

    test('localhost → null', () => {
      expect(blsi.PiiCountry.detectFromInputs({ hostname: 'localhost' })).toBeNull();
    });

    test('empty / non-string hostname → null', () => {
      expect(blsi.PiiCountry.detectFromInputs({ hostname: '' })).toBeNull();
      expect(blsi.PiiCountry.detectFromInputs({ hostname: null })).toBeNull();
    });
  });

  // ── detectFromInputs — lang ───────────────────────────────────────────

  describe('detectFromInputs — html lang', () => {
    test('en-US → US', () => {
      expect(blsi.PiiCountry.detectFromInputs({ lang: 'en-US' })).toBe('US');
    });

    test('en_GB underscore form → GB', () => {
      expect(blsi.PiiCountry.detectFromInputs({ lang: 'en_GB' })).toBe('GB');
    });

    test('ja-JP → JP', () => {
      expect(blsi.PiiCountry.detectFromInputs({ lang: 'ja-JP' })).toBe('JP');
    });

    test('zh-Hant-TW (script subtag in middle) → TW', () => {
      expect(blsi.PiiCountry.detectFromInputs({ lang: 'zh-Hant-TW' })).toBe('TW');
    });

    test('bare "en" → null (region required)', () => {
      expect(blsi.PiiCountry.detectFromInputs({ lang: 'en' })).toBeNull();
    });

    test('empty string → null', () => {
      expect(blsi.PiiCountry.detectFromInputs({ lang: '' })).toBeNull();
    });
  });

  // ── detectFromInputs — meta ───────────────────────────────────────────

  describe('detectFromInputs — meta', () => {
    test('geo.country = "DE" → DE', () => {
      const metas = metaList([{ name: 'geo.country', content: 'DE' }]);
      expect(blsi.PiiCountry.detectFromInputs({ metas })).toBe('DE');
    });

    test('lowercase geo.country normalized to upper', () => {
      const metas = metaList([{ name: 'geo.country', content: 'fr' }]);
      expect(blsi.PiiCountry.detectFromInputs({ metas })).toBe('FR');
    });

    test('og:locale = "en_US" → US', () => {
      const metas = metaList([{ property: 'og:locale', content: 'en_US' }]);
      expect(blsi.PiiCountry.detectFromInputs({ metas })).toBe('US');
    });

    test('content-language meta → IN', () => {
      const metas = metaList([{ name: 'content-language', content: 'hi-IN' }]);
      expect(blsi.PiiCountry.detectFromInputs({ metas })).toBe('IN');
    });

    test('http-equiv content-language', () => {
      const metas = metaList([{ 'http-equiv': 'content-language', content: 'pt-BR' }]);
      expect(blsi.PiiCountry.detectFromInputs({ metas })).toBe('BR');
    });

    test('unrelated meta → no match', () => {
      const metas = metaList([{ name: 'description', content: 'something' }]);
      expect(blsi.PiiCountry.detectFromInputs({ metas })).toBeNull();
    });
  });

  // ── detectFromInputs — currency density ───────────────────────────────

  describe('detectFromInputs — currency density', () => {
    test('three or more £ → GB', () => {
      const sample = '£12 £20 £100 some other text';
      expect(blsi.PiiCountry.detectFromInputs({ sample })).toBe('GB');
    });

    test('three or more ₹ → IN', () => {
      const sample = '₹100 ₹250 ₹500 review';
      expect(blsi.PiiCountry.detectFromInputs({ sample })).toBe('IN');
    });

    test('only two of one symbol → null', () => {
      const sample = '£10 £20';
      expect(blsi.PiiCountry.detectFromInputs({ sample })).toBeNull();
    });

    test('multi-country symbols ($ / € / ¥) deliberately ignored', () => {
      const sample = '$1 $2 $3 $4 €5 €6 €7';
      expect(blsi.PiiCountry.detectFromInputs({ sample })).toBeNull();
    });

    test('empty sample → null', () => {
      expect(blsi.PiiCountry.detectFromInputs({ sample: '' })).toBeNull();
    });
  });

  // ── detectFromInputs — priority order ─────────────────────────────────

  describe('detectFromInputs — priority order', () => {
    test('meta beats lang beats tld beats currency', () => {
      const metas = metaList([{ name: 'geo.country', content: 'JP' }]);
      const result = blsi.PiiCountry.detectFromInputs({
        hostname: 'example.de',
        lang: 'fr-FR',
        metas,
        sample: '£1 £2 £3',
      });
      expect(result).toBe('JP');
    });

    test('lang beats tld when meta absent', () => {
      const result = blsi.PiiCountry.detectFromInputs({
        hostname: 'example.de',
        lang: 'es-ES',
      });
      expect(result).toBe('ES');
    });

    test('tld used when meta + lang absent', () => {
      expect(
        blsi.PiiCountry.detectFromInputs({ hostname: 'example.kr' }),
      ).toBe('KR');
    });

    test('currency only used when nothing else fires', () => {
      expect(
        blsi.PiiCountry.detectFromInputs({ sample: '₩100 ₩200 ₩300' }),
      ).toBe('KR');
    });

    test('all empty inputs → null', () => {
      expect(
        blsi.PiiCountry.detectFromInputs({ hostname: '', lang: '', metas: [], sample: '' }),
      ).toBeNull();
    });

    test('null inputs object → null', () => {
      expect(blsi.PiiCountry.detectFromInputs(null)).toBeNull();
    });
  });

  // ── detect() — live document + cache ──────────────────────────────────

  describe('detect — cache lifecycle', () => {
    beforeEach(() => {
      // Clear DOM signals between tests; jsdom default location is
      // http://localhost so hostname == 'localhost' (no TLD signal).
      document.documentElement.removeAttribute('lang');
      document.head.innerHTML = '';
      blsi.PiiCountry._resetCache();
    });

    test('reads <html lang="en-US"> when set', () => {
      document.documentElement.setAttribute('lang', 'en-US');
      expect(blsi.PiiCountry.detect()).toBe('US');
    });

    test('returns null when no signal available', () => {
      expect(blsi.PiiCountry.detect()).toBeNull();
    });

    test('caches first result — DOM mutation post-call ignored', () => {
      document.documentElement.setAttribute('lang', 'en-US');
      const first = blsi.PiiCountry.detect();
      // Mutate after first read; cache should hide the change.
      document.documentElement.setAttribute('lang', 'fr-FR');
      const second = blsi.PiiCountry.detect();
      expect(first).toBe('US');
      expect(second).toBe('US');
    });

    test('_resetCache forces re-read', () => {
      document.documentElement.setAttribute('lang', 'en-US');
      expect(blsi.PiiCountry.detect()).toBe('US');
      blsi.PiiCountry._resetCache();
      document.documentElement.setAttribute('lang', 'fr-FR');
      expect(blsi.PiiCountry.detect()).toBe('FR');
    });

    test('reads <meta name="geo.country">', () => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'geo.country');
      m.setAttribute('content', 'DE');
      document.head.appendChild(m);
      expect(blsi.PiiCountry.detect()).toBe('DE');
    });
  });
});
