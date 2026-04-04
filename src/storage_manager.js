/**
 * storage_manager.js — PrivacyBlur Storage Manager
 *
 * Provides a clean async API for reading and writing persisted blur state.
 * All chrome.storage.local I/O is delegated to the background service worker
 * via chrome.runtime.sendMessage.
 *
 * Settings and defaults are sourced from constants.js — no local copies.
 * Settings are always stored as complete objects (no partial updates).
 *
 * Storage schema managed by background.js:
 * {
 *   "settings": { BLUR_RADIUS, TRANSITION_DURATION, ... (UPPER_SNAKE_CASE) },
 *   "rules": [ { id, name, pattern, patternType, settings }, ... ],
 *   "blurred_selectors": { "hostname": ["selector1", ...] }
 * }
 *
 * Exposed as window.PrivacyBlurStorage (IIFE — no ES module syntax).
 */

const PrivacyBlurStorage = (() => {
  'use strict';

  const MSG = window.PrivacyBlur;

  // -------------------------------------------------------------------------
  // Private: send a message to the background worker and return a Promise
  // -------------------------------------------------------------------------

  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Public API — blurred selectors
  // -------------------------------------------------------------------------

  async function saveBlurredElement(hostname, selector) {
    if (!hostname || !selector) return;
    return send({ type: MSG.SAVE_SELECTOR, hostname, selector });
  }

  async function removeBlurredElement(hostname, selector) {
    if (!hostname || !selector) return;
    await send({ type: MSG.REMOVE_SELECTOR, hostname, selector });
  }

  async function getBlurredSelectors(hostname) {
    if (!hostname) return [];
    const response = await send({ type: MSG.GET_SELECTORS, hostname });
    return (response && Array.isArray(response.selectors)) ? response.selectors : [];
  }

  async function clearHost(hostname) {
    if (!hostname) return;
    await send({ type: MSG.CLEAR_HOST, hostname });
  }

  async function clearAll() {
    await send({ type: MSG.CLEAR_ALL });
  }

  // -------------------------------------------------------------------------
  // Public API — settings (full-object storage, no partial updates)
  // -------------------------------------------------------------------------

  /**
   * Retrieves current settings. Background deep-merges stored settings over
   * DEFAULT_SETTINGS, so the response is always complete. Falls back to a
   * fresh default clone if background is unreachable.
   */
  async function getSettings() {
    const response = await send({ type: MSG.GET_SETTINGS });
    return (response && response.settings)
      ? response.settings
      : MSG.buildDefaultSettings();
  }

  /**
   * Saves the entire settings object. No partial merges — the caller must
   * pass the complete settings object.
   */
  async function saveSettings(fullSettings) {
    if (!fullSettings || typeof fullSettings !== "object") return;
    await send({ type: MSG.SAVE_SETTINGS, settings: fullSettings });
  }

  // -------------------------------------------------------------------------
  // Public API — URL rules
  // -------------------------------------------------------------------------

  /**
   * Retrieves the URL rules array from storage.
   * @returns {Promise<Array>}
   */
  async function getRules() {
    const response = await send({ type: MSG.GET_RULES });
    return (response && Array.isArray(response.rules)) ? response.rules : [];
  }

  /**
   * Saves the entire URL rules array. Replaces all existing rules.
   * @param {Array} rules
   */
  async function saveRules(rules) {
    if (!Array.isArray(rules)) return;
    await send({ type: MSG.SAVE_RULES, rules });
  }

  // -------------------------------------------------------------------------
  // Expose public API
  // -------------------------------------------------------------------------
  return {
    saveBlurredElement,
    removeBlurredElement,
    getBlurredSelectors,
    clearHost,
    clearAll,
    getSettings,
    saveSettings,
    getRules,
    saveRules,
  };
})();

window.PrivacyBlurStorage = PrivacyBlurStorage;
