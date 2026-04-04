/**
 * tests/unit/constants.test.js
 *
 * Unit tests for src/constants.js
 * Module exposes globalThis.PrivacyBlur with message type constants,
 * DEFAULT_SETTINGS, buildDefaultSettings(), deepMerge(), isValid(), categoryOf().
 */

'use strict';

describe('PrivacyBlur constants', () => {
  const PB = global.PrivacyBlur;

  // ── Message type categories ───────────────────────────────────────────────

  describe('STORAGE category', () => {
    test('exposes all storage message types', () => {
      expect(PB.STORAGE.GET_SELECTORS).toBe('GET_SELECTORS');
      expect(PB.STORAGE.SAVE_SELECTOR).toBe('SAVE_SELECTOR');
      expect(PB.STORAGE.REMOVE_SELECTOR).toBe('REMOVE_SELECTOR');
      expect(PB.STORAGE.CLEAR_HOST).toBe('CLEAR_HOST');
      expect(PB.STORAGE.CLEAR_ALL).toBe('CLEAR_ALL');
      expect(PB.STORAGE.GET_SETTINGS).toBe('GET_SETTINGS');
      expect(PB.STORAGE.SAVE_SETTINGS).toBe('SAVE_SETTINGS');
      expect(PB.STORAGE.GET_RULES).toBe('GET_RULES');
      expect(PB.STORAGE.SAVE_RULES).toBe('SAVE_RULES');
    });
  });

  describe('COMMAND category', () => {
    test('exposes all command message types', () => {
      expect(PB.COMMAND.TOGGLE_BLUR_ALL).toBe('TOGGLE_BLUR_ALL');
      expect(PB.COMMAND.TOGGLE_PICKER).toBe('TOGGLE_PICKER');
      expect(PB.COMMAND.CLEAR_ALL_BLUR).toBe('CLEAR_ALL_BLUR');
      expect(PB.COMMAND.RESTORE).toBe('RESTORE');
      expect(PB.COMMAND.CONTEXT_BLUR).toBe('CONTEXT_BLUR');
      expect(PB.COMMAND.CONTEXT_UNBLUR).toBe('CONTEXT_UNBLUR');
    });
  });

  describe('POPUP category', () => {
    test('exposes all popup message types', () => {
      expect(PB.POPUP.UPDATE_SETTINGS).toBe('UPDATE_SETTINGS');
      expect(PB.POPUP.GET_STATUS).toBe('GET_STATUS');
      expect(PB.POPUP.UNBLUR_SELECTOR).toBe('UNBLUR_SELECTOR');
    });
  });

  // ── Flat access ───────────────────────────────────────────────────────────

  describe('flat shorthand access', () => {
    test('all message types accessible at top level', () => {
      expect(PB.SAVE_SELECTOR).toBe('SAVE_SELECTOR');
      expect(PB.TOGGLE_BLUR_ALL).toBe('TOGGLE_BLUR_ALL');
      expect(PB.UPDATE_SETTINGS).toBe('UPDATE_SETTINGS');
    });
  });

  // ── isValid ───────────────────────────────────────────────────────────────

  describe('isValid', () => {
    test('returns true for known message types', () => {
      expect(PB.isValid('GET_SELECTORS')).toBe(true);
      expect(PB.isValid('TOGGLE_BLUR_ALL')).toBe(true);
      expect(PB.isValid('UPDATE_SETTINGS')).toBe(true);
      expect(PB.isValid('GET_RULES')).toBe(true);
    });

    test('returns false for unknown strings', () => {
      expect(PB.isValid('UNKNOWN_TYPE')).toBe(false);
      expect(PB.isValid('')).toBe(false);
    });

    test('returns false for non-string input', () => {
      expect(PB.isValid(null)).toBe(false);
      expect(PB.isValid(undefined)).toBe(false);
      expect(PB.isValid(42)).toBe(false);
    });
  });

  // ── categoryOf ────────────────────────────────────────────────────────────

  describe('categoryOf', () => {
    test('returns correct category for storage types', () => {
      expect(PB.categoryOf('SAVE_SELECTOR')).toBe('STORAGE');
      expect(PB.categoryOf('GET_SETTINGS')).toBe('STORAGE');
      expect(PB.categoryOf('GET_RULES')).toBe('STORAGE');
    });

    test('returns correct category for command types', () => {
      expect(PB.categoryOf('TOGGLE_BLUR_ALL')).toBe('COMMAND');
      expect(PB.categoryOf('RESTORE')).toBe('COMMAND');
    });

    test('returns correct category for popup types', () => {
      expect(PB.categoryOf('UPDATE_SETTINGS')).toBe('POPUP');
      expect(PB.categoryOf('GET_STATUS')).toBe('POPUP');
    });

    test('returns null for unknown types', () => {
      expect(PB.categoryOf('UNKNOWN')).toBeNull();
      expect(PB.categoryOf('')).toBeNull();
    });
  });

  // ── DEFAULT_SETTINGS ─────────────────────────────────────────────────────

  describe('DEFAULT_SETTINGS', () => {
    test('contains all expected top-level keys', () => {
      expect(PB.DEFAULT_SETTINGS.BLUR_RADIUS).toBe(8);
      expect(PB.DEFAULT_SETTINGS.TRANSITION_DURATION).toBe(200);
      expect(PB.DEFAULT_SETTINGS.HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(PB.DEFAULT_SETTINGS.REVEAL_MODE).toBe('hover');
      expect(PB.DEFAULT_SETTINGS.ENABLED).toBe(true);
      expect(PB.DEFAULT_SETTINGS.THOROUGH_BLUR).toBe(false);
    });

    test('is frozen (immutable)', () => {
      expect(Object.isFrozen(PB.DEFAULT_SETTINGS)).toBe(true);
    });

    test('SHORTCUTS is frozen with 3 actions', () => {
      expect(Object.isFrozen(PB.DEFAULT_SETTINGS.SHORTCUTS)).toBe(true);
      expect(Object.keys(PB.DEFAULT_SETTINGS.SHORTCUTS)).toHaveLength(3);
      expect(PB.DEFAULT_SETTINGS.SHORTCUTS.TOGGLE_BLUR_ALL).toBeDefined();
      expect(PB.DEFAULT_SETTINGS.SHORTCUTS.TOGGLE_PICKER).toBeDefined();
      expect(PB.DEFAULT_SETTINGS.SHORTCUTS.CLEAR_ALL).toBeDefined();
    });

    test('each shortcut has primaryModifier and keys array', () => {
      for (const action of Object.values(PB.DEFAULT_SETTINGS.SHORTCUTS)) {
        expect(action.primaryModifier).toBeDefined();
        expect(Array.isArray(action.keys)).toBe(true);
        expect(action.keys.length).toBeGreaterThan(0);
      }
    });
  });

  describe('DEFAULT_SETTINGS.BLUR_CATEGORIES', () => {
    test('exists and is frozen', () => {
      expect(PB.DEFAULT_SETTINGS.BLUR_CATEGORIES).toBeDefined();
      expect(Object.isFrozen(PB.DEFAULT_SETTINGS.BLUR_CATEGORIES)).toBe(true);
    });

    test('has correct default values', () => {
      const bc = PB.DEFAULT_SETTINGS.BLUR_CATEGORIES;
      expect(bc.TEXT).toBe(true);
      expect(bc.MEDIA).toBe(true);
      expect(bc.FORM).toBe(false);
      expect(bc.TABLE).toBe(true);
      expect(bc.STRUCTURE).toBe(true);
    });

    test('has exactly 5 keys', () => {
      expect(Object.keys(PB.DEFAULT_SETTINGS.BLUR_CATEGORIES)).toHaveLength(5);
    });
  });

  // ── buildDefaultSettings ─────────────────────────────────────────────────

  describe('buildDefaultSettings', () => {
    test('returns a mutable deep clone', () => {
      const s = PB.buildDefaultSettings();
      expect(s.BLUR_RADIUS).toBe(8);
      s.BLUR_RADIUS = 20;
      expect(s.BLUR_RADIUS).toBe(20);
      // Original unchanged
      expect(PB.DEFAULT_SETTINGS.BLUR_RADIUS).toBe(8);
    });

    test('nested objects are also cloned', () => {
      const s = PB.buildDefaultSettings();
      s.BLUR_CATEGORIES.FORM = true;
      expect(PB.DEFAULT_SETTINGS.BLUR_CATEGORIES.FORM).toBe(false);
    });
  });

  // ── deepMerge ────────────────────────────────────────────────────────────

  describe('deepMerge', () => {
    test('merges flat keys', () => {
      const result = PB.deepMerge({ A: 1, B: 2 }, { B: 3 });
      expect(result).toEqual({ A: 1, B: 3 });
    });

    test('merges nested objects', () => {
      const result = PB.deepMerge(
        { OUTER: { A: 1, B: 2 } },
        { OUTER: { B: 3 } }
      );
      expect(result).toEqual({ OUTER: { A: 1, B: 3 } });
    });

    test('blocks prototype pollution keys', () => {
      const result = PB.deepMerge({}, { __proto__: { evil: true }, constructor: 'bad' });
      expect(result.evil).toBeUndefined();
      // constructor should NOT be overwritten to 'bad' — it stays as Object's default
      expect(result.constructor).toBe(Object);
    });

    test('does not mutate base', () => {
      const base = Object.freeze({ A: 1 });
      const result = PB.deepMerge(base, { A: 2 });
      expect(result.A).toBe(2);
      expect(base.A).toBe(1);
    });
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  describe('immutability', () => {
    test('top-level object is frozen', () => {
      expect(Object.isFrozen(PB)).toBe(true);
    });

    test('category objects are frozen', () => {
      expect(Object.isFrozen(PB.STORAGE)).toBe(true);
      expect(Object.isFrozen(PB.COMMAND)).toBe(true);
      expect(Object.isFrozen(PB.POPUP)).toBe(true);
    });
  });
});
