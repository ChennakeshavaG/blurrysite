/**
 * constants.js — PrivacyBlur Message Type Constants
 *
 * Single source of truth for all message type strings used across the
 * extension (background worker, content scripts, popup).
 *
 * Usage:
 *   PrivacyBlur.STORAGE.SAVE_SELECTOR          // namespaced access
 *   PrivacyBlur.SAVE_SELECTOR                   // flat shorthand
 *   PrivacyBlur.isValid('SAVE_SELECTOR')        // true — validates a type string
 *   PrivacyBlur.categoryOf('SAVE_SELECTOR')     // 'STORAGE'
 *
 * Adding a new category:
 *   1. Define a frozen object in the categories map below.
 *   2. The build helpers (allTypes, flat spread) pick it up automatically.
 *
 * Exposed as globalThis.PrivacyBlur (IIFE — no ES module syntax).
 * Uses globalThis so it works in both window (content scripts) and
 * self (service worker) contexts.
 */

const PrivacyBlur = (() => {
  'use strict';

  // ── Category definitions ────────────────────────────────────────────────────
  // Each category is a frozen map of constant-name → wire-string.
  // To add a new message type, add it to the relevant category.
  // To add a new category, add a new entry to `categories`.

  const categories = {
    /** Content script / popup → background (storage I/O) */
    STORAGE: Object.freeze({
      GET_SELECTORS:   'GET_SELECTORS',
      SAVE_SELECTOR:   'SAVE_SELECTOR',
      REMOVE_SELECTOR: 'REMOVE_SELECTOR',
      CLEAR_HOST:      'CLEAR_HOST',
      CLEAR_ALL:       'CLEAR_ALL',
      GET_SETTINGS:    'GET_SETTINGS',
      SAVE_SETTINGS:   'SAVE_SETTINGS',
    }),

    /** Background → content script (command relay, restore, context menu) */
    COMMAND: Object.freeze({
      TOGGLE_BLUR_ALL: 'TOGGLE_BLUR_ALL',
      TOGGLE_PICKER:   'TOGGLE_PICKER',
      CLEAR_ALL_BLUR:  'CLEAR_ALL_BLUR',
      RESTORE:         'RESTORE',
      CONTEXT_BLUR:    'CONTEXT_BLUR',
      CONTEXT_UNBLUR:  'CONTEXT_UNBLUR',
    }),

    /** Popup → content script */
    POPUP: Object.freeze({
      UPDATE_SETTINGS:  'UPDATE_SETTINGS',
      GET_STATUS:       'GET_STATUS',
      UNBLUR_SELECTOR:  'UNBLUR_SELECTOR',
    }),
  };

  // ── Derived helpers ─────────────────────────────────────────────────────────

  /** Set of every registered type string for O(1) validation. */
  const allTypes = new Set();

  /** Reverse map: type string → category name. */
  const typeToCategory = Object.create(null);

  for (const [catName, catObj] of Object.entries(categories)) {
    for (const value of Object.values(catObj)) {
      allTypes.add(value);
      typeToCategory[value] = catName;
    }
  }

  /**
   * Returns true if `type` is a known message type.
   * Useful for guarding unknown messages in handlers.
   * @param {string} type
   * @returns {boolean}
   */
  function isValid(type) {
    return allTypes.has(type);
  }

  /**
   * Returns the category name ('STORAGE', 'COMMAND', 'POPUP') for a type,
   * or null if the type is unknown.
   * @param {string} type
   * @returns {string|null}
   */
  function categoryOf(type) {
    return typeToCategory[type] || null;
  }

  // ── Application defaults ─────────────────────────────────────────────────────
  // Single source of truth for all default values. Every DEFAULT_SETTINGS
  // object across the codebase must reference these instead of hardcoding.

  const DEFAULTS = Object.freeze({
    CHORD_KEY1:          'k',
    CHORD_KEY2:          'v',
    CHORD_CODE1:         null,   // null = no physical key code stored yet; fall back to event.key
    CHORD_CODE2:         null,
    CHORD_MODIFIER:      'ctrl',
    BLUR_RADIUS:         8,
    TRANSITION_DURATION: 200,
    HIGHLIGHT_COLOR:     '#f59e0b',
    REVEAL_ON_HOVER:     false,
    REVEAL_MODE:         'hover',  // 'none' | 'click' | 'hover'
    ENABLED:             true,
    THOROUGH_BLUR:       false,
    BLUR_CATEGORIES:     Object.freeze({
      text:      true,
      media:     true,
      form:      false,
      table:     true,
      structure: true,
    }),
  });

  // ── Build public object ─────────────────────────────────────────────────────
  // Spread every category's constants at the top level for flat access,
  // and also expose each category object for namespaced access.
  // DEFAULTS is exposed as a separate namespace (not spread flat).

  const flat = {};
  for (const catObj of Object.values(categories)) {
    Object.assign(flat, catObj);
  }

  return Object.freeze(Object.assign(flat, categories, {
    DEFAULTS,
    isValid,
    categoryOf,
  }));
})();

globalThis.PrivacyBlur = PrivacyBlur;
