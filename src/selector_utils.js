/**
 * selector_utils.js — PrivacyBlur CSS Selector Utilities
 *
 * Generates stable, unique CSS selectors for DOM elements so that blur state
 * can be persisted and restored across page loads.
 *
 * Selector strategy (most-specific first):
 *  1. Unique ID attribute  → #escaped-id
 *  2. Fallback             → stamp a generated data-pb-id UUID on the element
 *
 * Exposed as pb.SelectorUtils (IIFE — no ES module syntax).
 */

const SelectorUtils = (() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * CSS-escapes an arbitrary string so it is safe to embed in a selector.
   * Falls back to a manual implementation when CSS.escape is unavailable
   * (e.g., older Firefox builds, some test environments).
   * @param {string} value
   * @returns {string}
   */
  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }

    // Manual fallback: escape non-word characters with a backslash
    return String(value).replace(/([^\w-])/g, "\\$1");
  }

  /**
   * Checks whether a given CSS selector matches exactly one element in the document.
   * @param {string} selector
   * @returns {boolean}
   */
  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generates a specific CSS selector for an element.
   * The selector is guaranteed to be usable with document.querySelector.
   * @param {Element} element
   * @returns {string}
   */
  function getSelector(element) {
    if (!element || !(element instanceof Element)) return null;
    if (element === document.body || element === document.documentElement) return null;

    // ---- Strategy 1: unique id attribute ----
    const id = element.getAttribute("id");
    if (id && id.trim().length > 0) {
      const idSelector = `#${cssEscape(id.trim())}`;
      if (isUnique(idSelector)) {
        return idSelector;
      }
      // Non-unique IDs fall through to next strategy
    }

    // ---- Strategy 2: stamp data-pb-id and return attribute selector ----
    if (!element.dataset.pbId) {
      element.dataset.pbId = generateId();
    }
    return `[data-pb-id="${element.dataset.pbId}"]`;
  }

  /**
   * Generates a short 8-character hex UUID (32-bit random, sufficient for
   * identifying individual DOM elements within a single page session).
   * @returns {string} - e.g. "a3f92c1b"
   */
  function generateId() {
    // Use crypto.getRandomValues when available for better entropy
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0].toString(16).padStart(8, "0");
    }

    // Fallback: Math.random (lower entropy but sufficient for our purpose)
    return Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, "0");
  }

  /**
   * Attempts to find a DOM element from a stored CSS selector.
   * Returns null if the selector is invalid or no element matches.
   * @param {string} selector
   * @returns {Element|null}
   */
  function restoreSelector(selector) {
    if (!selector || typeof selector !== "string") return null;

    try {
      return document.querySelector(selector);
    } catch {
      // Invalid selector syntax (e.g., from a different page version)
      return null;
    }
  }

  /**
   * Resolves an array of stored selectors back to DOM elements.
   * Selectors that no longer match any element are silently skipped.
   * @param {string[]} selectors
   * @returns {Element[]} - Array of found elements (no nulls)
   */
  function restoreAllSelectors(selectors) {
    if (!Array.isArray(selectors)) return [];

    return selectors
      .map((s) => restoreSelector(s))
      .filter((el) => el !== null);
  }

  // -------------------------------------------------------------------------
  // Expose public API
  // -------------------------------------------------------------------------
  return {
    getSelector,
    generateId,
    restoreSelector,
    restoreAllSelectors
  };
})();

// Attach to window so content_script.js and other injected scripts can access it
pb.SelectorUtils = SelectorUtils;
