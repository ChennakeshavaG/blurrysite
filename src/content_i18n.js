/**
 * content_i18n.js — Blurry Site Content-Script i18n Helper
 *
 * Loads `_locales/<lang>/messages.json` via fetch + chrome.runtime.getURL
 * so content scripts can honor the popup's LANGUAGE setting at runtime.
 * chrome.i18n.getMessage() reads only the OS locale and has no override —
 * this helper exists to bridge that gap.
 *
 * Public API (blsi.ContentI18n):
 *   init(lang)         async — load fallback (en) + primary (lang)
 *   t(key, fallback)   sync  — lookup with primary → fallback → key
 *   currentLang        getter — last initialized language code
 *
 * Exposed as blsi.ContentI18n (IIFE — no ES module syntax).
 */

const ContentI18n = (() => {
  'use strict';

  /** @type {Object<string, {message: string}>} Primary locale strings */
  let _strings = {};

  /** @type {Object<string, {message: string}>} English fallback (cached once) */
  let _fallback = {};

  /** @type {string} Last successful init language */
  let _lang = 'en';

  /**
   * Keys we've already warned about per init. Reset whenever init() runs
   * so a fresh locale can surface its own missing-key set cleanly without
   * console spam on every `t()` call.
   */
  let _warnedKeys = new Set();

  async function _loadJSON(lang) {
    try {
      const url = chrome.runtime.getURL('_locales/' + lang + '/messages.json');
      const resp = await fetch(url);
      if (!resp.ok) return {};
      return await resp.json();
    } catch (_) {
      return {};
    }
  }

  /**
   * Resolve 'auto' to a supported locale code via chrome.i18n.getUILanguage,
   * with BCP47 → underscore conversion (hi-IN → hi_IN). Falls back to 'en'.
   */
  function _resolveAuto(supported) {
    let raw = 'en';
    try {
      raw = (chrome.i18n && chrome.i18n.getUILanguage)
        ? chrome.i18n.getUILanguage()
        : 'en';
    } catch (_) { raw = 'en'; }

    const parts = (raw || 'en').split('-');
    const lang = (parts[0] || 'en').toLowerCase();
    const region = parts[1] ? parts[1].toUpperCase() : '';

    if (region) {
      const full = lang + '_' + region;
      if (supported.includes(full)) return full;
    }
    if (supported.includes(lang)) return lang;
    for (const code of supported) {
      if (code.toLowerCase().startsWith(lang + '_')) return code;
    }
    return 'en';
  }

  /**
   * Initialize the helper. Loads English as fallback (cached once across
   * re-inits) and the requested language as the primary string source.
   * Safe to call repeatedly — _strings is replaced each call.
   *
   * @param {string} [requestedLang] — 'auto' | 'en' | 'hi_IN' | 'ta_IN' (or undefined → 'auto')
   */
  async function init(requestedLang) {
    if (Object.keys(_fallback).length === 0) {
      _fallback = await _loadJSON('en');
    }

    const supported = (blsi && blsi.supported_languages) || ['auto', 'en'];
    let lang = requestedLang || 'auto';
    if (!supported.includes(lang)) lang = 'auto';
    if (lang === 'auto') {
      lang = _resolveAuto(supported);
    }

    _lang = lang;
    _strings = (lang === 'en') ? {} : await _loadJSON(lang);
    _warnedKeys = new Set();
  }

  /**
   * Look up a translated string by key. The Chrome messages.json shape is
   * `{ key: { message: "..." } }`, so this helper unwraps `.message`.
   *
   * @param {string} key       — message key (camelCase per Chrome convention)
   * @param {string} [fallback] — English literal to use if no translation found
   * @returns {string}
   */
  function t(key, fallback) {
    const primary = _strings[key] && _strings[key].message;
    if (primary) return primary;
    const fb = _fallback[key] && _fallback[key].message;
    if (fb) return fb;
    // Neither primary nor English fallback has this key — probably a
    // typo in the caller or a key that was added to source but not to
    // messages.json. Warn once per key so typos surface in devtools.
    if (!_warnedKeys.has(key)) {
      _warnedKeys.add(key);
      if (blsi && blsi.Logger) {
        blsi.Logger.warn('[ContentI18n] missing key: ' + key);
      } else {
        console.warn('[BlurrySite ContentI18n] missing key: ' + key);
      }
    }
    return fallback || key;
  }

  return {
    init,
    t,
    get currentLang() { return _lang; },
  };
})();

blsi.ContentI18n = ContentI18n;
