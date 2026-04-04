/**
 * storage_manager.js — PrivacyBlur Storage Manager
 *
 * Provides a clean async API for reading and writing persisted blur state.
 * All actual chrome.storage.local I/O is delegated to the background service
 * worker via chrome.runtime.sendMessage — this keeps storage access centralised
 * and avoids content-script permission issues in some browsers.
 *
 * Storage schema managed by background.js:
 * {
 *   "blurred_selectors": {
 *     "hostname": ["selector1", "selector2", ...]
 *   },
 *   "settings": {
 *     blurRadius: 8,
 *     transitionDuration: 200,
 *     highlightColor: "#f59e0b",
 *     revealOnHover: false,
 *     enabled: true,
 *     shortcuts: {
 *       chordKey1: "k",
 *       chordKey2: "v",
 *       chordModifier: "ctrl"
 *     }
 *   }
 * }
 *
 * Exposed as window.PrivacyBlurStorage (IIFE — no ES module syntax).
 */

const PrivacyBlurStorage = (() => {
  'use strict';

  const MSG = window.PrivacyBlur;
  const D   = window.PrivacyBlur.DEFAULTS;

  // -------------------------------------------------------------------------
  // Default settings — sourced from constants.js (single source of truth).
  // background.js holds the authoritative copy used during merges.
  // -------------------------------------------------------------------------
  const DEFAULT_SETTINGS = {
    blurRadius: D.BLUR_RADIUS,
    highlightColor: D.HIGHLIGHT_COLOR,
    transitionDuration: D.TRANSITION_DURATION,
    revealOnHover: D.REVEAL_ON_HOVER,
    enabled: D.ENABLED,
    shortcuts: {
      chordKey1: D.CHORD_KEY1,
      chordKey2: D.CHORD_KEY2,
      chordCode1: D.CHORD_CODE1,
      chordCode2: D.CHORD_CODE2,
      chordModifier: D.CHORD_MODIFIER
    },
    thoroughBlur: D.THOROUGH_BLUR,
    blurCategories: {
      text:      D.BLUR_CATEGORIES.text,
      media:     D.BLUR_CATEGORIES.media,
      form:      D.BLUR_CATEGORIES.form,
      table:     D.BLUR_CATEGORIES.table,
      structure: D.BLUR_CATEGORIES.structure,
    }
  };

  // -------------------------------------------------------------------------
  // Private: send a message to the background worker and return a Promise
  // -------------------------------------------------------------------------

  /**
   * Sends a message to the background service worker and wraps the callback
   * response in a Promise for ergonomic async/await usage.
   * @param {object} message
   * @returns {Promise<any>}
   */
  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            // Background may be suspended during MV3 service-worker sleep
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        // Extension context invalidated (e.g., extension was updated/reloaded)
        reject(err);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Public API — blurred selectors
  // -------------------------------------------------------------------------

  /**
   * Persists a newly blurred element's selector for a given hostname.
   * Duplicate selectors are ignored by the background worker.
   * @param {string} hostname  - e.g. "example.com"
   * @param {string} selector  - CSS selector produced by selector_utils.js
   * @returns {Promise<void>}
   */
  async function saveBlurredElement(hostname, selector) {
    if (!hostname || !selector) return;

    return send({
      type: MSG.SAVE_SELECTOR,
      hostname,
      selector
    });
  }

  /**
   * Removes a single selector from the persisted list for a hostname.
   * Safe to call even if the selector is not in the list.
   * @param {string} hostname
   * @param {string} selector
   * @returns {Promise<void>}
   */
  async function removeBlurredElement(hostname, selector) {
    if (!hostname || !selector) return;

    await send({
      type: MSG.REMOVE_SELECTOR,
      hostname,
      selector
    });
  }

  /**
   * Retrieves the list of persisted selectors for a hostname.
   * Returns an empty array if nothing has been saved for that host.
   * @param {string} hostname
   * @returns {Promise<string[]>}
   */
  async function getBlurredSelectors(hostname) {
    if (!hostname) return [];

    const response = await send({
      type: MSG.GET_SELECTORS,
      hostname
    });

    return (response && Array.isArray(response.selectors))
      ? response.selectors
      : [];
  }

  /**
   * Deletes all persisted selectors for a specific hostname.
   * @param {string} hostname
   * @returns {Promise<void>}
   */
  async function clearHost(hostname) {
    if (!hostname) return;

    await send({
      type: MSG.CLEAR_HOST,
      hostname
    });
  }

  /**
   * Wipes the entire blurred_selectors map for all hostnames.
   * @returns {Promise<void>}
   */
  async function clearAll() {
    await send({ type: MSG.CLEAR_ALL });
  }

  // -------------------------------------------------------------------------
  // Public API — settings
  // -------------------------------------------------------------------------

  /**
   * Retrieves the current settings, merged with built-in defaults.
   * The background worker performs the deep-merge with DEFAULT_SETTINGS,
   * so callers always receive a complete settings object.
   * @returns {Promise<object>}
   */
  async function getSettings() {
    const response = await send({ type: MSG.GET_SETTINGS });

    const stored = (response && response.settings) ? response.settings : {};
    // Merge stored values over defaults so callers always get a complete object.
    // Deep-merge shortcuts sub-object to avoid losing default keys.
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
    merged.shortcuts = Object.assign(
      {},
      DEFAULT_SETTINGS.shortcuts,
      stored.shortcuts || {}
    );
    merged.blurCategories = Object.assign(
      {},
      DEFAULT_SETTINGS.blurCategories,
      stored.blurCategories || {}
    );
    return merged;
  }

  /**
   * Saves a partial settings object. The background worker deep-merges it
   * into the existing settings, so callers only need to pass changed keys.
   *
   * Example:
   *   await saveSettings({ blurRadius: 12 });
   *   await saveSettings({ shortcuts: { chordKey2: "b" } });
   *
   * @param {Partial<object>} partialSettings
   * @returns {Promise<void>}
   */
  async function saveSettings(partialSettings) {
    if (!partialSettings || typeof partialSettings !== "object") return;

    // Send partial to background — background.js deep-merges with stored settings
    await send({
      type: MSG.SAVE_SETTINGS,
      settings: partialSettings
    });
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
    // Expose defaults so the popup UI can read them without a round-trip
    DEFAULT_SETTINGS
  };
})();

// Attach to window so content_script.js and popup scripts can access it
window.PrivacyBlurStorage = PrivacyBlurStorage;
