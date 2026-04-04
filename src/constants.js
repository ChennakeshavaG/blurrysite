/**
 * constants.js — PrivacyBlur Constants & Settings
 *
 * Single source of truth for message types, default settings, and utility
 * functions used across the extension (background worker, content scripts, popup).
 *
 * Usage:
 *   PrivacyBlur.STORAGE.SAVE_SELECTOR          // namespaced access
 *   PrivacyBlur.SAVE_SELECTOR                   // flat shorthand
 *   PrivacyBlur.isValid('SAVE_SELECTOR')        // true — validates a type string
 *   PrivacyBlur.categoryOf('SAVE_SELECTOR')     // 'STORAGE'
 *   PrivacyBlur.DEFAULT_SETTINGS                // frozen settings object
 *   PrivacyBlur.buildDefaultSettings()          // mutable deep clone
 *   PrivacyBlur.deepMerge(base, override)       // prototype-safe recursive merge
 *
 * Exposed as globalThis.PrivacyBlur (IIFE — no ES module syntax).
 * Uses globalThis so it works in both window (content scripts) and
 * self (service worker) contexts.
 */

const PrivacyBlur = (() => {
  'use strict';

  // ── Message type categories ─────────────────────────────────────────────────
  // Each category is a frozen map of constant-name → wire-string.

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
      GET_RULES:       'GET_RULES',
      SAVE_RULES:      'SAVE_RULES',
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

  function isValid(type) {
    return allTypes.has(type);
  }

  function categoryOf(type) {
    return typeToCategory[type] || null;
  }

  // ── Default settings ────────────────────────────────────────────────────────
  // Single source of truth. All UPPER_SNAKE_CASE. Every file in the codebase
  // references this object or uses buildDefaultSettings() to get a mutable copy.
  // No other file should define its own defaults.

  const DEFAULT_SETTINGS = Object.freeze({
    BLUR_RADIUS:          8,
    TRANSITION_DURATION:  200,
    HIGHLIGHT_COLOR:      '#f59e0b',
    REVEAL_MODE:          'hover',   // 'none' | 'click' | 'hover'
    ENABLED:              true,
    THOROUGH_BLUR:        false,

    SHORTCUTS: Object.freeze({
      TOGGLE_BLUR_ALL: Object.freeze({
        primaryModifier: 'AltLeft',
        keys: Object.freeze([
          Object.freeze({ key: 'Shift', code: 'ShiftLeft' }),
          Object.freeze({ key: 'b',     code: 'KeyB' }),
        ]),
      }),
      TOGGLE_PICKER: Object.freeze({
        primaryModifier: 'AltLeft',
        keys: Object.freeze([
          Object.freeze({ key: 'Shift', code: 'ShiftLeft' }),
          Object.freeze({ key: 'p',     code: 'KeyP' }),
        ]),
      }),
      CLEAR_ALL: Object.freeze({
        primaryModifier: 'AltLeft',
        keys: Object.freeze([
          Object.freeze({ key: 'Shift', code: 'ShiftLeft' }),
          Object.freeze({ key: 'u',     code: 'KeyU' }),
        ]),
      }),
    }),

    BLUR_CATEGORIES: Object.freeze({
      TEXT:      true,
      MEDIA:     true,
      FORM:      false,
      TABLE:     true,
      STRUCTURE: true,
    }),
  });

  // ── Utility: deep merge ─────────────────────────────────────────────────────
  // Recursive merge with prototype pollution protection and depth limit.
  // Used by all files for settings merging.

  function deepMerge(base, override, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 5) return override;

    const result = Object.assign({}, base);

    for (const key of Object.keys(override)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (
        override[key] !== null &&
        typeof override[key] === 'object' &&
        !Array.isArray(override[key]) &&
        typeof base[key] === 'object' &&
        base[key] !== null &&
        !Array.isArray(base[key])
      ) {
        result[key] = deepMerge(base[key], override[key], depth + 1);
      } else {
        result[key] = override[key];
      }
    }

    return result;
  }

  // ── Utility: build mutable settings clone ───────────────────────────────────

  function buildDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  // ── Build public object ─────────────────────────────────────────────────────

  const flat = {};
  for (const catObj of Object.values(categories)) {
    Object.assign(flat, catObj);
  }

  return Object.freeze(Object.assign(flat, categories, {
    DEFAULT_SETTINGS,
    buildDefaultSettings,
    deepMerge,
    isValid,
    categoryOf,
  }));
})();

globalThis.PrivacyBlur = PrivacyBlur;
