/**
 * tests/unit/constants.test.js
 *
 * Unit tests for src/constants.js
 * Module exposes globalThis.blsi with message type constants,
 * DEFAULT_SETTINGS, buildDefaultSettings(), deepMerge(), isValid(), categoryOf().
 */

'use strict';

describe('BlurrySite constants', () => {
  const PB = blsi;

  // ── Message type categories ───────────────────────────────────────────────

  describe('STORAGE category', () => {
    test('exposes all storage message types', () => {
      expect(PB.STORAGE.GET_BLUR_ITEMS).toBe('GET_BLUR_ITEMS');
      expect(PB.STORAGE.SAVE_BLUR_ITEM).toBe('SAVE_BLUR_ITEM');
      expect(PB.STORAGE.REMOVE_BLUR_ITEM).toBe('REMOVE_BLUR_ITEM');
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
      expect(PB.POPUP.UNBLUR_ITEM).toBe('UNBLUR_ITEM');
    });
  });

  // ── Flat access ───────────────────────────────────────────────────────────

  describe('flat shorthand access', () => {
    test('all message types accessible at top level', () => {
      expect(PB.SAVE_BLUR_ITEM).toBe('SAVE_BLUR_ITEM');
      expect(PB.TOGGLE_BLUR_ALL).toBe('TOGGLE_BLUR_ALL');
      expect(PB.UPDATE_SETTINGS).toBe('UPDATE_SETTINGS');
    });
  });

  // ── isValid ───────────────────────────────────────────────────────────────

  describe('isValid', () => {
    test('returns true for known message types', () => {
      expect(PB.isValid('GET_BLUR_ITEMS')).toBe(true);
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
      expect(PB.categoryOf('SAVE_BLUR_ITEM')).toBe('STORAGE');
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
      expect(PB.DEFAULT_SETTINGS.BLUR_RADIUS).toBe(6);
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
      expect(s.BLUR_RADIUS).toBe(6);
      s.BLUR_RADIUS = 20;
      expect(s.BLUR_RADIUS).toBe(20);
      // Original unchanged
      expect(PB.DEFAULT_SETTINGS.BLUR_RADIUS).toBe(6);
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

  // ── validateSettings ──────────────────────────────────────────────────────

  describe('validateSettings', () => {
    test('returns full defaults for null input', () => {
      const result = PB.validateSettings(null);
      expect(result.BLUR_RADIUS).toBe(6);
      expect(result.ENABLED).toBe(true);
      expect(result.BLUR_CATEGORIES.TEXT).toBe(true);
      expect(result.SHORTCUTS.TOGGLE_BLUR_ALL).toBeDefined();
    });

    test('preserves valid values', () => {
      const input = PB.buildDefaultSettings();
      input.BLUR_RADIUS = 15;
      input.ENABLED = false;
      input.BLUR_CATEGORIES.FORM = true;
      const result = PB.validateSettings(input);
      expect(result.BLUR_RADIUS).toBe(15);
      expect(result.ENABLED).toBe(false);
      expect(result.BLUR_CATEGORIES.FORM).toBe(true);
    });

    test('replaces out-of-range BLUR_RADIUS with default', () => {
      expect(PB.validateSettings({ BLUR_RADIUS: 999 }).BLUR_RADIUS).toBe(6);
      expect(PB.validateSettings({ BLUR_RADIUS: -1 }).BLUR_RADIUS).toBe(6);
      expect(PB.validateSettings({ BLUR_RADIUS: 'abc' }).BLUR_RADIUS).toBe(6);
    });

    test('replaces invalid REVEAL_MODE with default', () => {
      expect(PB.validateSettings({ REVEAL_MODE: 'invalid' }).REVEAL_MODE).toBe('hover');
      expect(PB.validateSettings({ REVEAL_MODE: 42 }).REVEAL_MODE).toBe('hover');
    });

    test('replaces invalid HIGHLIGHT_COLOR with default', () => {
      expect(PB.validateSettings({ HIGHLIGHT_COLOR: 'red' }).HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(PB.validateSettings({ HIGHLIGHT_COLOR: '#fff' }).HIGHLIGHT_COLOR).toBe('#f59e0b');
    });

    test('replaces non-boolean category values with defaults', () => {
      const result = PB.validateSettings({ BLUR_CATEGORIES: { TEXT: 'yes', MEDIA: 1 } });
      expect(result.BLUR_CATEGORIES.TEXT).toBe(true); // default
      expect(result.BLUR_CATEGORIES.MEDIA).toBe(true); // default
    });

    test('replaces broken shortcut binding with default', () => {
      const result = PB.validateSettings({ SHORTCUTS: { TOGGLE_BLUR_ALL: { bad: true } } });
      expect(result.SHORTCUTS.TOGGLE_BLUR_ALL.primaryModifier).toBe('AltLeft');
      expect(result.SHORTCUTS.TOGGLE_BLUR_ALL.keys).toHaveLength(2);
    });

    test('fills missing keys with defaults', () => {
      const result = PB.validateSettings({});
      expect(result.BLUR_RADIUS).toBe(6);
      expect(result.TRANSITION_DURATION).toBe(200);
      expect(result.HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(result.REVEAL_MODE).toBe('hover');
      expect(result.ENABLED).toBe(true);
      expect(result.THOROUGH_BLUR).toBe(false);
      expect(Object.keys(result.BLUR_CATEGORIES)).toHaveLength(5);
      expect(Object.keys(result.SHORTCUTS)).toHaveLength(3);
    });
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  describe('immutability', () => {
    test('top-level blsi namespace is extensible (modules attach to it)', () => {
      // blsi is NOT frozen — other modules (BlurEngine, Storage, etc.) attach to it.
      // Internal objects (DEFAULT_SETTINGS, STORAGE, COMMAND, etc.) are still frozen.
      expect(typeof PB).toBe('object');
    });

    test('category objects are frozen', () => {
      expect(Object.isFrozen(PB.STORAGE)).toBe(true);
      expect(Object.isFrozen(PB.COMMAND)).toBe(true);
      expect(Object.isFrozen(PB.POPUP)).toBe(true);
    });
  });

  // ── validateSettings boundary values ──────────────────────────────────────

  describe('validateSettings boundary values', () => {
    test('BLUR_RADIUS accepts min boundary (2)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 2 });
      expect(s.BLUR_RADIUS).toBe(2);
    });

    test('BLUR_RADIUS accepts max boundary (30)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 30 });
      expect(s.BLUR_RADIUS).toBe(30);
    });

    test('BLUR_RADIUS rejects below min (1)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 1 });
      expect(s.BLUR_RADIUS).toBe(PB.DEFAULT_SETTINGS.BLUR_RADIUS);
    });

    test('BLUR_RADIUS rejects above max (31)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 31 });
      expect(s.BLUR_RADIUS).toBe(PB.DEFAULT_SETTINGS.BLUR_RADIUS);
    });

    test('SHORTCUTS rejects empty keys array', () => {
      const s = PB.validateSettings({
        SHORTCUTS: { TOGGLE_BLUR_ALL: { primaryModifier: 'AltLeft', keys: [] } }
      });
      // Should fall back to default since keys.length === 0
      expect(s.SHORTCUTS.TOGGLE_BLUR_ALL.keys.length).toBeGreaterThan(0);
    });

    test('SHORTCUTS rejects keys exceeding limit (11)', () => {
      const keys = Array.from({ length: 11 }, (_, i) => ({ key: 'k', code: 'Key' + i }));
      const s = PB.validateSettings({
        SHORTCUTS: { TOGGLE_BLUR_ALL: { primaryModifier: 'AltLeft', keys } }
      });
      expect(s.SHORTCUTS.TOGGLE_BLUR_ALL.keys.length).toBeLessThanOrEqual(10);
    });

    test('deepMerge stops at depth limit', () => {
      const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
      const base = { a: { b: { c: { d: { e: { f: { g: 'base' } } } } } } };
      const result = PB.deepMerge(base, deep);
      // At depth 6, override should be returned directly instead of recursing
      expect(result.a.b.c.d.e.f).toEqual({ g: 'deep' });
    });

    test('PICKER_MODE defaults to sticky', () => {
      expect(PB.DEFAULT_SETTINGS.PICKER_MODE).toBe('sticky');
    });

    test('PICKER_MODE validates against enum', () => {
      const s1 = PB.validateSettings({ PICKER_MODE: 'sticky' });
      expect(s1.PICKER_MODE).toBe('sticky');
      const s2 = PB.validateSettings({ PICKER_MODE: 'dynamic' });
      expect(s2.PICKER_MODE).toBe('dynamic');
      const s3 = PB.validateSettings({ PICKER_MODE: 'invalid' });
      expect(s3.PICKER_MODE).toBe(PB.DEFAULT_SETTINGS.PICKER_MODE);
    });

    test('PICKER_MODES enum exists', () => {
      expect(PB.PICKER_MODES.STICKY).toBe('sticky');
      expect(PB.PICKER_MODES.DYNAMIC).toBe('dynamic');
    });

    test('BLUR_MODE validates against enum', () => {
      const s1 = PB.validateSettings({ BLUR_MODE: 'gaussian' });
      expect(s1.BLUR_MODE).toBe('gaussian');
      const s2 = PB.validateSettings({ BLUR_MODE: 'frosted' });
      expect(s2.BLUR_MODE).toBe('frosted');
      const s3 = PB.validateSettings({ BLUR_MODE: 'invalid' });
      expect(s3.BLUR_MODE).toBe(PB.DEFAULT_SETTINGS.BLUR_MODE);
    });
  });
});
