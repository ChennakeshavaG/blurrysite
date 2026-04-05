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
      GET_BLUR_STATE:  'GET_BLUR_STATE',
      SAVE_BLUR_STATE: 'SAVE_BLUR_STATE',
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

  // ── Enum constants ──────────────────────────────────────────────────────────
  // Strongly-typed values for settings that accept a fixed set of options.
  // Use these instead of bare string literals in comparisons.

  const REVEAL_MODES = Object.freeze({
    NONE:  'none',
    CLICK: 'click',
    HOVER: 'hover',
  });

  const BLUR_MODES = Object.freeze({
    GAUSSIAN: 'gaussian',
    FROSTED:  'frosted',
  });

  const PATTERN_TYPES = Object.freeze({
    WILDCARD: 'wildcard',
    REGEX:    'regex',
  });

  // ── CSS class and ID constants ─────────────────────────────────────────────
  // Shared across blur_engine, content_script, picker, shortcut_handler.
  // Must match the class names in styles/content.css exactly.

  const CSS = Object.freeze({
    BLURRED:          'pb-blurred',
    FROSTED:          'pb-frosted',
    CANVAS_OVERLAY:   'pb-canvas-overlay',
    TEXT_WRAPPER:     'pb-text-node-wrapper',
    REVEAL_ON_HOVER:  'pb-reveal-on-hover',
    ANCESTOR_REVEAL:  'pb-ancestor-reveal',
    REVEALED:         'pb-revealed',
    HOVER_HIGHLIGHT:  'pb-hover-highlight',
    PICKER_ACTIVE:    'pb-picker-active',
    TOAST:            'pb-toast',
    TOAST_MESSAGE:    'pb-toast__message',
    TOAST_EXITING:    'pb-toast--exiting',
    TOOLBAR:          'pb-toolbar',
    TOOLBAR_LABEL:    'pb-toolbar-label',
    TOOLBAR_BTN:      'pb-toolbar-btn',
    TOOLBAR_BTN_CLEAR:'pb-toolbar-btn--clear',
    TOOLBAR_BTN_CLOSE:'pb-toolbar-btn--close',
  });

  const IDS = Object.freeze({
    PICKER_TOOLBAR: 'pb-picker-toolbar',
    SVG_FILTERS:    'pb-svg-filters',
  });

  // ── Default settings ────────────────────────────────────────────────────────
  // Single source of truth. All UPPER_SNAKE_CASE. Every file in the codebase
  // references this object or uses buildDefaultSettings() to get a mutable copy.
  // No other file should define its own defaults.

  const DEFAULT_SETTINGS = Object.freeze({
    BLUR_RADIUS:          10,
    TRANSITION_DURATION:  200,
    HIGHLIGHT_COLOR:      '#f59e0b',
    REVEAL_MODE:          REVEAL_MODES.HOVER,
    ENABLED:              true,
    THOROUGH_BLUR:        false,
    BLUR_MODE:            BLUR_MODES.GAUSSIAN,

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

    PERFORMANCE: Object.freeze({
      // Unblur elements when they scroll off-screen, re-blur when they return.
      // Reduces compositing layer count on long/infinite-scroll pages.
      OFFSCREEN_UNBLUR:   true,

      // Maximum number of simultaneously blurred elements. 0 = unlimited.
      // When the cap is reached, oldest elements (by blur order) are skipped.
      MAX_BLURRED:        500,

      // Batch size for the MutationObserver chunk processor.
      CHUNK_SIZE:         50,
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

  // ── Utility: validate and repair settings ──────────────────────────────────
  // Checks every key against DEFAULT_SETTINGS. Replaces missing, wrong-type,
  // or out-of-range values with defaults. Returns a clean, complete object.

  function validateSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return buildDefaultSettings();
    }

    const defaults = buildDefaultSettings();
    const result = {};

    // Top-level scalars: type-check and range-check
    result.BLUR_RADIUS = (typeof settings.BLUR_RADIUS === 'number' &&
      settings.BLUR_RADIUS >= 2 && settings.BLUR_RADIUS <= 20)
      ? settings.BLUR_RADIUS : defaults.BLUR_RADIUS;

    result.TRANSITION_DURATION = (typeof settings.TRANSITION_DURATION === 'number' &&
      settings.TRANSITION_DURATION >= 0 && settings.TRANSITION_DURATION <= 2000)
      ? settings.TRANSITION_DURATION : defaults.TRANSITION_DURATION;

    result.HIGHLIGHT_COLOR = (typeof settings.HIGHLIGHT_COLOR === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(settings.HIGHLIGHT_COLOR))
      ? settings.HIGHLIGHT_COLOR : defaults.HIGHLIGHT_COLOR;

    result.REVEAL_MODE = (Object.values(REVEAL_MODES).includes(settings.REVEAL_MODE))
      ? settings.REVEAL_MODE : defaults.REVEAL_MODE;

    result.ENABLED = (typeof settings.ENABLED === 'boolean')
      ? settings.ENABLED : defaults.ENABLED;

    result.THOROUGH_BLUR = (typeof settings.THOROUGH_BLUR === 'boolean')
      ? settings.THOROUGH_BLUR : defaults.THOROUGH_BLUR;

    result.BLUR_MODE = (Object.values(BLUR_MODES).includes(settings.BLUR_MODE))
      ? settings.BLUR_MODE : defaults.BLUR_MODE;

    // BLUR_CATEGORIES: each key must be boolean
    result.BLUR_CATEGORIES = {};
    const cats = (settings.BLUR_CATEGORIES && typeof settings.BLUR_CATEGORIES === 'object')
      ? settings.BLUR_CATEGORIES : {};
    for (const key of Object.keys(defaults.BLUR_CATEGORIES)) {
      result.BLUR_CATEGORIES[key] = (typeof cats[key] === 'boolean')
        ? cats[key] : defaults.BLUR_CATEGORIES[key];
    }

    // SHORTCUTS: each action must have primaryModifier (string) and keys (array)
    result.SHORTCUTS = {};
    const sc = (settings.SHORTCUTS && typeof settings.SHORTCUTS === 'object')
      ? settings.SHORTCUTS : {};
    for (const action of Object.keys(defaults.SHORTCUTS)) {
      const binding = sc[action];
      if (binding &&
          typeof binding.primaryModifier === 'string' &&
          Array.isArray(binding.keys) &&
          binding.keys.length > 0 &&
          binding.keys.length <= 10 &&
          binding.keys.every(k => k && typeof k.key === 'string' && typeof k.code === 'string')) {
        result.SHORTCUTS[action] = binding;
      } else {
        result.SHORTCUTS[action] = JSON.parse(JSON.stringify(defaults.SHORTCUTS[action]));
      }
    }

    // PERFORMANCE: validate each key with type + range checks
    result.PERFORMANCE = {};
    const perf = (settings.PERFORMANCE && typeof settings.PERFORMANCE === 'object')
      ? settings.PERFORMANCE : {};
    result.PERFORMANCE.OFFSCREEN_UNBLUR = (typeof perf.OFFSCREEN_UNBLUR === 'boolean')
      ? perf.OFFSCREEN_UNBLUR : defaults.PERFORMANCE.OFFSCREEN_UNBLUR;
    result.PERFORMANCE.MAX_BLURRED = (typeof perf.MAX_BLURRED === 'number' && perf.MAX_BLURRED >= 0 && perf.MAX_BLURRED <= 5000)
      ? perf.MAX_BLURRED : defaults.PERFORMANCE.MAX_BLURRED;
    result.PERFORMANCE.CHUNK_SIZE = (typeof perf.CHUNK_SIZE === 'number' && perf.CHUNK_SIZE >= 10 && perf.CHUNK_SIZE <= 200)
      ? perf.CHUNK_SIZE : defaults.PERFORMANCE.CHUNK_SIZE;

    return result;
  }

  // ── Build public object ─────────────────────────────────────────────────────

  const flat = {};
  for (const catObj of Object.values(categories)) {
    Object.assign(flat, catObj);
  }

  return Object.freeze(Object.assign(flat, categories, {
    REVEAL_MODES,
    BLUR_MODES,
    PATTERN_TYPES,
    CSS,
    IDS,
    DEFAULT_SETTINGS,
    buildDefaultSettings,
    validateSettings,
    deepMerge,
    isValid,
    categoryOf,
  }));
})();

globalThis.PrivacyBlur = PrivacyBlur;
