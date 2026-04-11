/**
 * constants.js — Blurry Site Constants & Settings
 *
 * Single source of truth for message types, default settings, and utility
 * functions used across the extension (background worker, content scripts, popup).
 *
 * Usage:
 *   blsi.STORAGE.SAVE_BLUR_ITEM          // namespaced access
 *   blsi.SAVE_BLUR_ITEM                  // flat shorthand
 *   blsi.isValid('SAVE_BLUR_ITEM')       // true — validates a type string
 *   blsi.DEFAULT_SETTINGS                // frozen settings object
 *   blsi.BlurEngine.applyBlur(el)        // module access (Java-style)
 *   blsi.Storage.getSettings()           // module access
 *
 * Exposed as globalThis.blsi (IIFE — no ES module syntax).
 * Uses globalThis so it works in both window (content scripts) and
 * self (service worker) contexts. Other modules attach to blsi:
 *   blsi.BlurEngine, blsi.Storage, blsi.SelectorUtils, blsi.Shortcuts, blsi.Picker
 */

const Constants = (() => {
  'use strict';

  // ── Message type categories ─────────────────────────────────────────────────
  // Each category is a frozen map of constant-name → wire-string.

  const categories = {
    /** Content script / popup → background (storage I/O) */
    STORAGE: Object.freeze({
      GET_BLUR_ITEMS:   'GET_BLUR_ITEMS',
      SAVE_BLUR_ITEM:   'SAVE_BLUR_ITEM',
      REMOVE_BLUR_ITEM: 'REMOVE_BLUR_ITEM',
      CLEAR_HOST:       'CLEAR_HOST',
      CLEAR_ALL:        'CLEAR_ALL',
      GET_SETTINGS:     'GET_SETTINGS',
      SAVE_SETTINGS:    'SAVE_SETTINGS',
      GET_RULES:        'GET_RULES',
      SAVE_RULES:       'SAVE_RULES',
      GET_BLUR_STATE:   'GET_BLUR_STATE',
      SAVE_BLUR_STATE:  'SAVE_BLUR_STATE',
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
      UNBLUR_ITEM:      'UNBLUR_ITEM',
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

  // Picker modes — what happens when the user clicks / sketches in the picker.
  //   DYNAMIC       — tap an element to blur it; selector-based, follows the element.
  //   STICKY_PAGE   — sketch a box anchored to document coordinates; scrolls with content.
  //   STICKY_SCREEN — sketch a box anchored to viewport coordinates; stays fixed on screen.
  //
  // STICKY (legacy) maps to STICKY_PAGE at validation time.
  const PICKER_MODES = Object.freeze({
    DYNAMIC:       'dynamic',
    STICKY_PAGE:   'sticky-page',
    STICKY_SCREEN: 'sticky-screen',
  });

  const PATTERN_TYPES = Object.freeze({
    WILDCARD: 'wildcard',
    REGEX:    'regex',
  });

  // Display languages supported by the popup i18n loader. Codes follow Chrome's
  // _locales convention: language code, optional `_REGION`. 'auto' follows the
  // browser via navigator.language (with `-` → `_` normalization).
  // Adding a new locale: append the code here, create `_locales/<code>/popup.json`
  // and `_locales/<code>/messages.json`, and add a `lang_<code>` key to every
  // existing popup.json so the picker label is translated everywhere.
  const SUPPORTED_LANGUAGES = Object.freeze(['auto', 'en', 'hi_IN', 'ta_IN']);

  // ── CSS class and ID constants ─────────────────────────────────────────────
  // Shared across blur_engine, content_script, picker, shortcut_handler.
  // Must match the class names in styles/content.css exactly.

  const CSS = Object.freeze({
    CANVAS_OVERLAY:   'bl-si-canvas-overlay',
    HOVER_HIGHLIGHT:  'bl-si-hover-highlight',
    PICKER_ACTIVE:    'bl-si-picker-active',
    TOAST:            'bl-si-toast',
    TOAST_MESSAGE:    'bl-si-toast__message',
    TOAST_EXITING:    'bl-si-toast--exiting',
    TOOLBAR:          'bl-si-toolbar',
    TOOLBAR_LABEL:    'bl-si-toolbar-label',
    TOOLBAR_BTN:      'bl-si-toolbar-btn',
    TOOLBAR_BTN_CLEAR:'bl-si-toolbar-btn--clear',
    TOOLBAR_BTN_CLOSE:'bl-si-toolbar-btn--close',
    ZONE_OVERLAY:     'bl-si-zone-overlay',
    ZONE_DRAWING:     'bl-si-zone-drawing',
    ZONE_HIGHLIGHT:   'bl-si-zone-highlight',
    ZONE_LABEL:       'bl-si-zone-label',
  });

  const IDS = Object.freeze({
    PICKER_TOOLBAR: 'bl-si-picker-toolbar',
    SVG_FILTERS:    'bl-si-svg-filters',
  });

  // ── Default settings ────────────────────────────────────────────────────────
  // Single source of truth. All UPPER_SNAKE_CASE. Every file in the codebase
  // references this object or uses buildDefaultSettings() to get a mutable copy.
  // No other file should define its own defaults.

  const DEFAULT_SETTINGS = Object.freeze({
    BLUR_RADIUS:          6,
    TRANSITION_DURATION:  200,
    HIGHLIGHT_COLOR:      '#f59e0b',
    REVEAL_MODE:          REVEAL_MODES.HOVER,
    ENABLED:              true,
    THOROUGH_BLUR:        false,
    BLUR_MODE:            BLUR_MODES.GAUSSIAN,
    PICKER_MODE:          PICKER_MODES.STICKY_PAGE,
    LANGUAGE:             'auto',

    // SHORTCUTS intentionally omitted here — built lazily by buildDefaultSettings()
    // from blsi.Actions.defaultBindings() (loaded by src/action_registry.js, which
    // runs after this module). Keeping this out of the frozen DEFAULT_SETTINGS
    // avoids the chicken-and-egg where constants.js would need the registry at
    // module-load time.

    BLUR_CATEGORIES: Object.freeze({
      TEXT:      true,
      MEDIA:     true,
      FORM:      false,
      TABLE:     true,
      STRUCTURE: true, // Safe with data-bl-si-blur (no classList = no framework loops)
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

  // ── Modifier codes (used by shortcut_handler matcher + popup capture) ──────
  // KeyboardEvent.code strings for every modifier. The matcher short-circuits
  // when event.code is in this set (waits for a non-modifier key), and the
  // capture UI uses it to distinguish "still holding modifiers" from "chord
  // committed". Left/right distinction is preserved here because the browser
  // reports separate codes for each side; we fold them away at normalization
  // time in the matcher (via event.altKey / ctrlKey / metaKey / shiftKey).
  const MODIFIER_CODES = Object.freeze(new Set([
    'AltLeft', 'AltRight',
    'ControlLeft', 'ControlRight',
    'ShiftLeft', 'ShiftRight',
    'MetaLeft', 'MetaRight',
    'OSLeft', 'OSRight',  // older Chrome / Firefox alias for Meta
    'CapsLock', 'Fn', 'FnLock',
  ]));

  // ── Utility: build mutable settings clone ───────────────────────────────────

  function buildDefaultSettings() {
    const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // SHORTCUTS defaults come from the action registry (loaded after this
    // module). At the time buildDefaultSettings() is called, every module is
    // loaded and blsi.Actions is available.
    base.SHORTCUTS = (globalThis.blsi && globalThis.blsi.Actions)
      ? globalThis.blsi.Actions.defaultBindings()
      : {};
    return base;
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
      settings.BLUR_RADIUS >= 2 && settings.BLUR_RADIUS <= 30)
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

    // Legacy "sticky" maps to the new "sticky-page" value (kept as a one-line
    // shim because PICKER_MODE is live user state that was previously valid).
    const legacyPicker = settings.PICKER_MODE === 'sticky' ? PICKER_MODES.STICKY_PAGE : settings.PICKER_MODE;
    result.PICKER_MODE = (Object.values(PICKER_MODES).includes(legacyPicker))
      ? legacyPicker : defaults.PICKER_MODE;

    result.LANGUAGE = (typeof settings.LANGUAGE === 'string' && SUPPORTED_LANGUAGES.includes(settings.LANGUAGE))
      ? settings.LANGUAGE : defaults.LANGUAGE;

    // BLUR_CATEGORIES: each key must be boolean
    result.BLUR_CATEGORIES = {};
    const cats = (settings.BLUR_CATEGORIES && typeof settings.BLUR_CATEGORIES === 'object')
      ? settings.BLUR_CATEGORIES : {};
    for (const key of Object.keys(defaults.BLUR_CATEGORIES)) {
      result.BLUR_CATEGORIES[key] = (typeof cats[key] === 'boolean')
        ? cats[key] : defaults.BLUR_CATEGORIES[key];
    }

    // SHORTCUTS: new shape. Each entry is { binding: [{code, mods}, ...] }.
    // Malformed entries fall back to the registry default.
    result.SHORTCUTS = {};
    const sc = (settings.SHORTCUTS && typeof settings.SHORTCUTS === 'object')
      ? settings.SHORTCUTS : {};
    for (const action of Object.keys(defaults.SHORTCUTS)) {
      const entry = sc[action];
      if (isValidShortcutEntry(entry)) {
        result.SHORTCUTS[action] = {
          binding: entry.binding.map((chord) => ({
            code: chord.code,
            mods: [...chord.mods].sort(),
          })),
        };
      } else {
        result.SHORTCUTS[action] = JSON.parse(JSON.stringify(defaults.SHORTCUTS[action]));
      }
    }

    return result;
  }

  /**
   * Validate a single shortcut entry against the new shape:
   *   { binding: [{code: string, mods: Array<string>}, ...] }
   *
   * Rules:
   *  - `binding` is a non-empty array, length ≤ 4 (phase 1 matcher only fires
   *    when length === 1; longer arrays are accepted to future-proof sequences).
   *  - Each chord has a non-empty `code` string and a `mods` array.
   *  - `mods` is a subset of {Alt, Control, Meta, Shift}. Duplicates are
   *    tolerated (sorted + deduped at store time).
   *  - `mods.length >= 1` — no bare-letter bindings (would fire during typing).
   *  - Not Control+Alt (correctness: breaks AltGr on European layouts).
   */
  const VALID_MODS = new Set(['Alt', 'Control', 'Meta', 'Shift']);
  function isValidShortcutEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (!Array.isArray(entry.binding)) return false;
    if (entry.binding.length < 1 || entry.binding.length > 4) return false;
    for (const chord of entry.binding) {
      if (!chord || typeof chord !== 'object') return false;
      if (typeof chord.code !== 'string' || chord.code.length === 0) return false;
      if (!Array.isArray(chord.mods)) return false;
      for (const mod of chord.mods) {
        if (!VALID_MODS.has(mod)) return false;
      }
      const modSet = new Set(chord.mods);
      if (modSet.size < 1) return false;
      if (modSet.has('Control') && modSet.has('Alt') && !modSet.has('Shift') && !modSet.has('Meta')) {
        // Bare Ctrl+Alt+X collides with AltGr. Reject.
        return false;
      }
    }
    return true;
  }

  // ── Build public object ─────────────────────────────────────────────────────

  const flat = {};
  for (const catObj of Object.values(categories)) {
    Object.assign(flat, catObj);
  }

  // Not frozen — other modules attach to blsi (blsi.BlurEngine, blsi.Storage, etc.)
  return Object.assign(flat, categories, {
    REVEAL_MODES,
    BLUR_MODES,
    PICKER_MODES,
    PATTERN_TYPES,
    SUPPORTED_LANGUAGES,
    CSS,
    IDS,
    DEFAULT_SETTINGS,
    MODIFIER_CODES,
    buildDefaultSettings,
    validateSettings,
    isValidShortcutEntry,
    deepMerge,
    isValid,
    categoryOf,
  });
})();

// Extend (don't replace) any pre-existing blsi — action_registry may have
// been loaded first in some contexts. In the extension's default load order
// (content scripts, popup, background importScripts), constants.js runs
// before any other blsi.* module, so `globalThis.blsi` is usually undefined
// at this point.
globalThis.blsi = Object.assign(globalThis.blsi || {}, Constants);
