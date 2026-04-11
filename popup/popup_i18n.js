/**
 * popup_i18n.js — Blurry Site Internationalization Loader
 *
 * Loads language JSON files and provides a t() function for string lookup.
 * Falls back: current locale → English → raw key.
 *
 * Exposed as blsi.I18n (IIFE — no ES module syntax).
 */

const I18n = (() => {
  'use strict';

  /** @type {Object<string, string>} Current language strings */
  let _strings = {};

  /** @type {Object<string, string>} English fallback (always loaded) */
  let _fallback = {};

  /**
   * Load a language JSON file from _locales/<lang>/popup.json.
   * @param {string} lang — Language code (e.g. 'en', 'es', 'ja')
   * @returns {Promise<Object>} Parsed JSON or empty object on failure
   */
  async function _loadJSON(lang) {
    try {
      const url = chrome.runtime.getURL(`_locales/${lang}/popup.json`);
      const resp = await fetch(url);
      if (!resp.ok) return {};
      return await resp.json();
    } catch {
      return {};
    }
  }

  /**
   * Initialize the i18n system. Loads English as fallback, then loads the
   * requested language as the primary string source.
   *
   * @param {string} [requestedLang] — 'auto' | 'en' | 'hi' (or undefined → 'auto')
   *   'auto' resolves via navigator.language, clamped to the supported set.
   *   May be called repeatedly — each call replaces _strings in place so the
   *   popup's "switch language live" path can re-init without re-loading the
   *   English fallback.
   */
  async function init(requestedLang) {
    // Load English fallback exactly once. Subsequent re-inits keep the cache.
    if (Object.keys(_fallback).length === 0) {
      _fallback = await _loadJSON('en');
      if (Object.keys(_fallback).length === 0) {
        console.warn('[BlurrySite i18n] Failed to load English fallback — UI will show raw keys');
      }
    }

    const supported = (blsi && blsi.SUPPORTED_LANGUAGES) || ['auto', 'en'];
    let lang = requestedLang || 'auto';
    if (!supported.includes(lang)) lang = 'auto';
    if (lang === 'auto') {
      lang = _resolveAuto(supported);
    }

    _strings = (lang === 'en') ? {} : await _loadJSON(lang);
  }

  /**
   * Map navigator.language (BCP47, e.g. 'hi-IN', 'ta-IN-Latn', 'en') to a
   * supported locale code (Chrome convention: 'hi_IN', 'ta_IN', 'en').
   * Tries the full region match first, then falls back to the language alone,
   * then to English.
   */
  function _resolveAuto(supported) {
    const raw = (navigator.language || 'en');
    const parts = raw.split('-');
    const lang = parts[0].toLowerCase();
    const region = parts[1] ? parts[1].toUpperCase() : '';

    // Try language_REGION first (e.g. hi_IN)
    if (region) {
      const full = lang + '_' + region;
      if (supported.includes(full)) return full;
    }
    // Try bare language code (e.g. 'en')
    if (supported.includes(lang)) return lang;
    // Try the first supported locale that starts with this language code
    for (const code of supported) {
      if (code.toLowerCase().startsWith(lang + '_')) return code;
    }
    return 'en';
  }

  /**
   * Get a localized string by key.
   * Supports {{placeholder}} replacement via the replacements object.
   *
   * @param {string} key — The i18n key to look up
   * @param {Object<string, string|number>} [replacements] — Key-value pairs for placeholders
   * @returns {string} The localized string, or the key itself if not found
   */
  function t(key, replacements) {
    let str = _strings[key] || _fallback[key] || key;
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        str = str.split('{{' + k + '}}').join(String(v));
      }
    }
    return str;
  }

  return { init, t };
})();

blsi.I18n = I18n;
