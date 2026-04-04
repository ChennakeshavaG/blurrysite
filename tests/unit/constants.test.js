/**
 * tests/unit/constants.test.js
 *
 * Unit tests for src/constants.js
 * Module exposes globalThis.PrivacyBlur with message type constants,
 * DEFAULTS, isValid(), and categoryOf().
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

  // ── DEFAULTS ──────────────────────────────────────────────────────────────

  describe('DEFAULTS', () => {
    test('contains all expected keys', () => {
      expect(PB.DEFAULTS.CHORD_KEY1).toBe('k');
      expect(PB.DEFAULTS.CHORD_KEY2).toBe('v');
      expect(PB.DEFAULTS.CHORD_CODE1).toBeNull();
      expect(PB.DEFAULTS.CHORD_CODE2).toBeNull();
      expect(PB.DEFAULTS.CHORD_MODIFIER).toBe('ctrl');
      expect(PB.DEFAULTS.BLUR_RADIUS).toBe(8);
      expect(PB.DEFAULTS.TRANSITION_DURATION).toBe(200);
      expect(PB.DEFAULTS.HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(PB.DEFAULTS.REVEAL_ON_HOVER).toBe(false);
      expect(PB.DEFAULTS.ENABLED).toBe(true);
    });

    test('is frozen (immutable)', () => {
      expect(Object.isFrozen(PB.DEFAULTS)).toBe(true);
    });
  });

  // ── Object is frozen ──────────────────────────────────────────────────────

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
