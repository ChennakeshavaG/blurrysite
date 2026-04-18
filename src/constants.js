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
  "use strict";

  // ── Message type categories ─────────────────────────────────────────────────
  // Each category is a frozen map of constant-name → wire-string.

  const categories = {
    /** Content script / popup → background (storage I/O) */
    STORAGE: Object.freeze({
      GET_BLUR_ITEMS: "GET_BLUR_ITEMS",
      SAVE_BLUR_ITEM: "SAVE_BLUR_ITEM",
      REMOVE_BLUR_ITEM: "REMOVE_BLUR_ITEM",
      CLEAR_HOST: "CLEAR_HOST",
      CLEAR_ALL: "CLEAR_ALL",
      GET_SETTINGS: "GET_SETTINGS",
      SAVE_SETTINGS: "SAVE_SETTINGS",
      GET_RULES: "GET_RULES",
      SAVE_RULES: "SAVE_RULES",
      GET_BLUR_STATE: "GET_BLUR_STATE",
      SAVE_BLUR_STATE: "SAVE_BLUR_STATE",
    }),

    /** Background → content script (command relay, restore, context menu) */
    COMMAND: Object.freeze({
      TOGGLE_BLUR_ALL: "TOGGLE_BLUR_ALL",
      TOGGLE_PICKER: "TOGGLE_PICKER",
      CLEAR_ALL_BLUR: "CLEAR_ALL_BLUR",
      RESTORE: "RESTORE",
      CONTEXT_BLUR: "CONTEXT_BLUR",
      CONTEXT_UNBLUR: "CONTEXT_UNBLUR",
      BLUR_SELECTION: "BLUR_SELECTION",
      CAPTURE_VIEWPORT: "CAPTURE_VIEWPORT",
    }),

    /** Popup → content script */
    POPUP: Object.freeze({
      UPDATE_SETTINGS: "UPDATE_SETTINGS",
      GET_STATUS: "GET_STATUS",
      UNBLUR_ITEM: "UNBLUR_ITEM",
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
    NONE: "none",
    CLICK: "click",
    HOVER: "hover",
  });

  const BLUR_MODES = Object.freeze({
    GAUSSIAN: "gaussian",
    FROSTED: "frosted",
    REDACTED: "redacted",
    MASKED: "masked",
  });

  // Picker modes — what happens when the user clicks / sketches in the picker.
  //   DYNAMIC       — tap an element to blur it; selector-based, follows the element.
  //   STICKY_PAGE   — sketch a box anchored to document coordinates; scrolls with content.
  //   STICKY_SCREEN — sketch a box anchored to viewport coordinates; stays fixed on screen.
  //
  // STICKY (legacy) maps to STICKY_PAGE at validation time.
  const PICKER_MODES = Object.freeze({
    DYNAMIC: "dynamic",
    STICKY_PAGE: "sticky-page",
    STICKY_SCREEN: "sticky-screen",
  });

  // Active blur mode — which top-level mode is currently selected.
  // Switching modes is destructive: stored blur items for the deactivated mode
  // are deleted from chrome.storage.
  const ACTIVE_MODES = Object.freeze({
    BLUR_ALL: 'blur-all',
    PICK_BLUR: 'pick-blur',
  });

  // Pick & Blur blur types — separate set from BLUR_MODES (no Redacted/Masked).
  // Color is a solid-cover mode exclusive to Pick & Blur.
  const PICK_BLUR_MODES = Object.freeze({
    GAUSSIAN: 'gaussian',
    FROSTED: 'frosted',
    COLOR: 'color',
  });

  // PII auto-detect blur types — independent of blur-all and pick-blur.
  const PII_MODES = Object.freeze({
    GAUSSIAN: 'gaussian',
    FROSTED: 'frosted',
    REDACTED: 'redacted',
    ASTERISKED: 'asterisked',
  });

  // Timer unit options — supports hours (no Chrome API constraint on setTimeout).
  const TIMER_UNITS = Object.freeze({
    SEC: 'sec',
    MIN: 'min',
    HR: 'hr',
  });

  // Idle unit options — hr excluded: Chrome idle API hard cap is 3000 s (50 min).
  const IDLE_UNITS = Object.freeze({
    SEC: 'sec',
    MIN: 'min',
  });

  const PATTERN_TYPES = Object.freeze({
    WILDCARD: "wildcard",
    REGEX: "regex",
  });

  // Display languages supported by the popup i18n loader. Codes follow Chrome's
  // _locales convention: language code, optional `_REGION`. 'auto' follows the
  // browser via navigator.language (with `-` → `_` normalization).
  // Adding a new locale: append the code here, create `_locales/<code>/popup.json`
  // and `_locales/<code>/messages.json`, and add a `lang_<code>` key to every
  // existing popup.json so the picker label is translated everywhere.
  const SUPPORTED_LANGUAGES = Object.freeze(["auto", "en", "hi_IN", "ta_IN"]);

  // ── CSS class and ID constants ─────────────────────────────────────────────
  // Shared across blur_engine, content_script, picker, shortcut_handler.
  // Must match the class names in styles/content.css exactly.

  const CSS = Object.freeze({
    CANVAS_OVERLAY: "bl-si-canvas-overlay",
    HOVER_HIGHLIGHT: "bl-si-hover-highlight",
    PICKER_ACTIVE: "bl-si-picker-active",
    TOAST: "bl-si-toast",
    TOAST_MESSAGE: "bl-si-toast__message",
    TOAST_EXITING: "bl-si-toast--exiting",
    TOOLBAR: "bl-si-toolbar",
    TOOLBAR_LABEL: "bl-si-toolbar-label",
    TOOLBAR_BTN: "bl-si-toolbar-btn",
    TOOLBAR_BTN_CLEAR: "bl-si-toolbar-btn--clear",
    TOOLBAR_BTN_CLOSE: "bl-si-toolbar-btn--close",
    ZONE_OVERLAY: "bl-si-zone-overlay",
    ZONE_DRAWING: "bl-si-zone-drawing",
    ZONE_HIGHLIGHT: "bl-si-zone-highlight",
    ZONE_LABEL: "bl-si-zone-label",
  });

  const IDS = Object.freeze({
    PICKER_TOOLBAR: "bl-si-picker-toolbar",
    SVG_FILTERS: "bl-si-svg-filters",
  });

  // ── Reveal constants ─────────────────────────────────────────────────────────
  const REVEAL_DFS_MAX_DEPTH = 2;

  // ── Default settings ────────────────────────────────────────────────────────
  // Single source of truth. All UPPER_SNAKE_CASE. Every file in the codebase
  // references this object or uses buildDefaultSettings() to get a mutable copy.
  // No other file should define its own defaults.

  const DEFAULT_SETTINGS = Object.freeze({
    BLUR_RADIUS: 6,
    TRANSITION_DURATION: 150,
    HIGHLIGHT_COLOR: "#f59e0b",
    REVEAL_MODE: REVEAL_MODES.HOVER,
    ENABLED: true,
    THOROUGH_BLUR: false,
    BLUR_MODE: BLUR_MODES.GAUSSIAN,
    PICKER_MODE: PICKER_MODES.STICKY_PAGE,
    LANGUAGE: "auto",
    TAB_PRIVACY: false,
    REDACTION_COLOR: "#000000",

    BLUR_TIMER_MINUTES: 0,
    AUTO_BLUR_IDLE: false,
    AUTO_BLUR_TAB_SWITCH: false,
    IDLE_TIMEOUT_SECONDS: 300,

    AUTO_DETECT: Object.freeze({
      EMAIL:   false,
      NUMERIC: false,
    }),

    // SHORTCUTS intentionally omitted here — built lazily by buildDefaultSettings()
    // from blsi.Actions.defaultBindings() (loaded by src/action_registry.js, which
    // runs after this module). Keeping this out of the frozen DEFAULT_SETTINGS
    // avoids the chicken-and-egg where constants.js would need the registry at
    // module-load time.

    BLUR_CATEGORIES: Object.freeze({
      TEXT: true,
      MEDIA: true,
      FORM: false,
      TABLE: true,
      STRUCTURE: true, // Safe with data-bl-si-blur (no classList = no framework loops)
    }),

    // ── Popup redesign keys ───────────────────────────────────────────────────
    // Which top-level mode is active. Destructive switch — other mode's items deleted.
    ACTIVE_MODE: 'blur-all',

    // Blur type used in Pick & Blur mode (gaussian | frosted | color).
    PICK_BLUR_TYPE: 'gaussian',

    // Color used in Pick & Blur 'color' type. HEX is a 6-char hex string; OPACITY 0–1.
    PICK_BLUR_COLOR: Object.freeze({
      HEX: '#000000',
      OPACITY: 1.0,
    }),

    // Blur type used by auto-detect PII rendering.
    PII_MODE: 'gaussian',

    // Automate trigger settings. VALUE is 1–99; UNIT is from TIMER_UNITS / IDLE_UNITS.
    AUTOMATE: Object.freeze({
      TIMER: Object.freeze({ VALUE: 0, UNIT: 'min', ENABLED: false }),
      IDLE: Object.freeze({ VALUE: 5, UNIT: 'min', ENABLED: false }),
      TAB_SWITCH: Object.freeze({ ENABLED: false }),
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
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        continue;
      if (
        override[key] !== null &&
        typeof override[key] === "object" &&
        !Array.isArray(override[key]) &&
        typeof base[key] === "object" &&
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
  const MODIFIER_CODES = Object.freeze(
    new Set([
      "AltLeft",
      "AltRight",
      "ControlLeft",
      "ControlRight",
      "ShiftLeft",
      "ShiftRight",
      "MetaLeft",
      "MetaRight",
      "OSLeft",
      "OSRight", // older Chrome / Firefox alias for Meta
      "CapsLock",
      "Fn",
      "FnLock",
    ]),
  );

  // ── Utility: build mutable settings clone ───────────────────────────────────

  function buildDefaultSettings() {
    const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // SHORTCUTS defaults come from the action registry (loaded after this
    // module). At the time buildDefaultSettings() is called, every module is
    // loaded and blsi.Actions is available.
    base.SHORTCUTS =
      globalThis.blsi && globalThis.blsi.Actions
        ? globalThis.blsi.Actions.defaultBindings()
        : {};
    return base;
  }

  // ── Utility: validate and repair settings ──────────────────────────────────
  // Checks every key against DEFAULT_SETTINGS. Replaces missing, wrong-type,
  // or out-of-range values with defaults. Returns a clean, complete object.

  function validateSettings(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return buildDefaultSettings();
    }

    const defaults = buildDefaultSettings();
    const result = {};

    // Top-level scalars: type-check and range-check
    result.BLUR_RADIUS =
      typeof settings.BLUR_RADIUS === "number" &&
      settings.BLUR_RADIUS >= 2 &&
      settings.BLUR_RADIUS <= 30
        ? settings.BLUR_RADIUS
        : defaults.BLUR_RADIUS;

    result.TRANSITION_DURATION =
      typeof settings.TRANSITION_DURATION === "number" &&
      settings.TRANSITION_DURATION >= 0 &&
      settings.TRANSITION_DURATION <= 2000
        ? settings.TRANSITION_DURATION
        : defaults.TRANSITION_DURATION;

    result.HIGHLIGHT_COLOR =
      typeof settings.HIGHLIGHT_COLOR === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(settings.HIGHLIGHT_COLOR)
        ? settings.HIGHLIGHT_COLOR
        : defaults.HIGHLIGHT_COLOR;

    result.REVEAL_MODE = Object.values(REVEAL_MODES).includes(
      settings.REVEAL_MODE,
    )
      ? settings.REVEAL_MODE
      : defaults.REVEAL_MODE;

    result.ENABLED =
      typeof settings.ENABLED === "boolean"
        ? settings.ENABLED
        : defaults.ENABLED;

    result.THOROUGH_BLUR =
      typeof settings.THOROUGH_BLUR === "boolean"
        ? settings.THOROUGH_BLUR
        : defaults.THOROUGH_BLUR;

    result.BLUR_MODE = Object.values(BLUR_MODES).includes(settings.BLUR_MODE)
      ? settings.BLUR_MODE
      : defaults.BLUR_MODE;

    // Legacy "sticky" maps to the new "sticky-page" value (kept as a one-line
    // shim because PICKER_MODE is live user state that was previously valid).
    const legacyPicker =
      settings.PICKER_MODE === "sticky"
        ? PICKER_MODES.STICKY_PAGE
        : settings.PICKER_MODE;
    result.PICKER_MODE = Object.values(PICKER_MODES).includes(legacyPicker)
      ? legacyPicker
      : defaults.PICKER_MODE;

    result.LANGUAGE =
      typeof settings.LANGUAGE === "string" &&
      SUPPORTED_LANGUAGES.includes(settings.LANGUAGE)
        ? settings.LANGUAGE
        : defaults.LANGUAGE;

    result.TAB_PRIVACY =
      typeof settings.TAB_PRIVACY === "boolean"
        ? settings.TAB_PRIVACY
        : defaults.TAB_PRIVACY;

    result.REDACTION_COLOR =
      typeof settings.REDACTION_COLOR === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(settings.REDACTION_COLOR)
        ? settings.REDACTION_COLOR
        : defaults.REDACTION_COLOR;

    result.BLUR_TIMER_MINUTES =
      typeof settings.BLUR_TIMER_MINUTES === "number" &&
      settings.BLUR_TIMER_MINUTES >= 0 &&
      settings.BLUR_TIMER_MINUTES <= 480
        ? settings.BLUR_TIMER_MINUTES
        : defaults.BLUR_TIMER_MINUTES;

    result.AUTO_BLUR_IDLE =
      typeof settings.AUTO_BLUR_IDLE === "boolean"
        ? settings.AUTO_BLUR_IDLE
        : defaults.AUTO_BLUR_IDLE;

    result.AUTO_BLUR_TAB_SWITCH =
      typeof settings.AUTO_BLUR_TAB_SWITCH === "boolean"
        ? settings.AUTO_BLUR_TAB_SWITCH
        : defaults.AUTO_BLUR_TAB_SWITCH;

    result.IDLE_TIMEOUT_SECONDS =
      typeof settings.IDLE_TIMEOUT_SECONDS === "number" &&
      settings.IDLE_TIMEOUT_SECONDS >= 30 &&
      settings.IDLE_TIMEOUT_SECONDS <= 3600
        ? settings.IDLE_TIMEOUT_SECONDS
        : defaults.IDLE_TIMEOUT_SECONDS;

    // AUTO_DETECT: both EMAIL and NUMERIC are now booleans
    result.AUTO_DETECT = {};
    const ad =
      settings.AUTO_DETECT && typeof settings.AUTO_DETECT === "object"
        ? settings.AUTO_DETECT
        : {};
    for (const key of Object.keys(defaults.AUTO_DETECT)) {
      result.AUTO_DETECT[key] =
        typeof ad[key] === "boolean" ? ad[key] : defaults.AUTO_DETECT[key];
    }

    // BLUR_CATEGORIES: each key must be boolean
    result.BLUR_CATEGORIES = {};
    const cats =
      settings.BLUR_CATEGORIES && typeof settings.BLUR_CATEGORIES === "object"
        ? settings.BLUR_CATEGORIES
        : {};
    for (const key of Object.keys(defaults.BLUR_CATEGORIES)) {
      result.BLUR_CATEGORIES[key] =
        typeof cats[key] === "boolean"
          ? cats[key]
          : defaults.BLUR_CATEGORIES[key];
    }

    // ── Popup redesign keys ─────────────────────────────────────────────────

    result.ACTIVE_MODE = Object.values(ACTIVE_MODES).includes(settings.ACTIVE_MODE)
      ? settings.ACTIVE_MODE
      : defaults.ACTIVE_MODE;

    result.PICK_BLUR_TYPE = Object.values(PICK_BLUR_MODES).includes(settings.PICK_BLUR_TYPE)
      ? settings.PICK_BLUR_TYPE
      : defaults.PICK_BLUR_TYPE;

    const pbc =
      settings.PICK_BLUR_COLOR && typeof settings.PICK_BLUR_COLOR === 'object'
        ? settings.PICK_BLUR_COLOR
        : {};
    result.PICK_BLUR_COLOR = {
      HEX:
        typeof pbc.HEX === 'string' && /^#[0-9a-fA-F]{6}$/.test(pbc.HEX)
          ? pbc.HEX
          : defaults.PICK_BLUR_COLOR.HEX,
      OPACITY:
        typeof pbc.OPACITY === 'number' && pbc.OPACITY >= 0 && pbc.OPACITY <= 1
          ? pbc.OPACITY
          : defaults.PICK_BLUR_COLOR.OPACITY,
    };

    result.PII_MODE = Object.values(PII_MODES).includes(settings.PII_MODE)
      ? settings.PII_MODE
      : defaults.PII_MODE;

    const automateIn =
      settings.AUTOMATE && typeof settings.AUTOMATE === 'object' ? settings.AUTOMATE : {};
    const timerIn =
      automateIn.TIMER && typeof automateIn.TIMER === 'object' ? automateIn.TIMER : {};
    const idleIn =
      automateIn.IDLE && typeof automateIn.IDLE === 'object' ? automateIn.IDLE : {};
    const tabIn =
      automateIn.TAB_SWITCH && typeof automateIn.TAB_SWITCH === 'object'
        ? automateIn.TAB_SWITCH
        : {};
    result.AUTOMATE = {
      TIMER: {
        VALUE:
          typeof timerIn.VALUE === 'number' &&
          timerIn.VALUE >= 0 &&
          timerIn.VALUE <= 99
            ? timerIn.VALUE
            : defaults.AUTOMATE.TIMER.VALUE,
        UNIT: Object.values(TIMER_UNITS).includes(timerIn.UNIT)
          ? timerIn.UNIT
          : defaults.AUTOMATE.TIMER.UNIT,
        ENABLED:
          typeof timerIn.ENABLED === 'boolean'
            ? timerIn.ENABLED
            : defaults.AUTOMATE.TIMER.ENABLED,
      },
      IDLE: {
        VALUE:
          typeof idleIn.VALUE === 'number' &&
          idleIn.VALUE >= 1 &&
          idleIn.VALUE <= 99
            ? idleIn.VALUE
            : defaults.AUTOMATE.IDLE.VALUE,
        UNIT: Object.values(IDLE_UNITS).includes(idleIn.UNIT)
          ? idleIn.UNIT
          : defaults.AUTOMATE.IDLE.UNIT,
        ENABLED:
          typeof idleIn.ENABLED === 'boolean'
            ? idleIn.ENABLED
            : defaults.AUTOMATE.IDLE.ENABLED,
      },
      TAB_SWITCH: {
        ENABLED:
          typeof tabIn.ENABLED === 'boolean'
            ? tabIn.ENABLED
            : defaults.AUTOMATE.TAB_SWITCH.ENABLED,
      },
    };

    // SHORTCUTS: new shape. Each entry is { binding: [{code, mods}, ...] }.
    // Malformed entries fall back to the registry default.
    result.SHORTCUTS = {};
    const sc =
      settings.SHORTCUTS && typeof settings.SHORTCUTS === "object"
        ? settings.SHORTCUTS
        : {};
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
        result.SHORTCUTS[action] = JSON.parse(
          JSON.stringify(defaults.SHORTCUTS[action]),
        );
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
  const VALID_MODS = new Set(["Alt", "Control", "Meta", "Shift"]);
  function isValidShortcutEntry(entry) {
    if (!entry || typeof entry !== "object") return false;
    if (!Array.isArray(entry.binding)) return false;
    if (entry.binding.length < 1 || entry.binding.length > 4) return false;
    for (const chord of entry.binding) {
      if (!chord || typeof chord !== "object") return false;
      if (typeof chord.code !== "string" || chord.code.length === 0)
        return false;
      if (!Array.isArray(chord.mods)) return false;
      for (const mod of chord.mods) {
        if (!VALID_MODS.has(mod)) return false;
      }
      const modSet = new Set(chord.mods);
      if (modSet.size < 1) return false;
      if (
        modSet.has("Control") &&
        modSet.has("Alt") &&
        !modSet.has("Shift") &&
        !modSet.has("Meta")
      ) {
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
    ACTIVE_MODES,
    PICK_BLUR_MODES,
    PII_MODES,
    TIMER_UNITS,
    IDLE_UNITS,
    PATTERN_TYPES,
    SUPPORTED_LANGUAGES,
    CSS,
    IDS,
    DEFAULT_SETTINGS,
    REVEAL_DFS_MAX_DEPTH,
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
