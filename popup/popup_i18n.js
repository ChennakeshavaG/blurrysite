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
   * Initialize the i18n system. Loads English as fallback,
   * then attempts to load the browser's preferred language.
   */
  async function init() {
    _fallback = await _loadJSON('en');
    if (Object.keys(_fallback).length === 0) {
      console.warn('[BlurrySite i18n] Failed to load English fallback — UI will show raw keys');
    }

    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
    if (lang !== 'en') {
      _strings = await _loadJSON(lang);
    }
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
