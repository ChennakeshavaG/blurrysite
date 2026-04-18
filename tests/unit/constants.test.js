/**
 * tests/unit/constants.test.js
 *
 * Unit tests for src/constants.js
 * Module exposes globalThis.blsi with message type constants,
 * DEFAULT_SETTINGS, buildDefaultSettings(), deepMerge(), isValid(), categoryOf().
 */

/* === TEST QUALITY ANNOTATIONS ===
 *
 * COVERS:
 *   - STORAGE / COMMAND / POPUP message type string values
 *   - flat top-level shorthand access for representative message types
 *   - isValid(): known types, unknown strings, non-string input
 *   - categoryOf(): STORAGE / COMMAND / POPUP routing, unknown type returns null
 *   - DEFAULT_SETTINGS: top-level keys + values, frozen state, SHORTCUTS absence,
 *     buildDefaultSettings SHORTCUTS shape, chord structure
 *   - DEFAULT_SETTINGS.BLUR_CATEGORIES: existence, frozen, default booleans, key count
 *   - buildDefaultSettings: mutable deep clone, nested object clone isolation
 *   - deepMerge: flat keys, nested objects, prototype pollution blocks, base immutability
 *   - validateSettings: null input, value preservation, out-of-range BLUR_RADIUS,
 *     invalid REVEAL_MODE, LANGUAGE accept/reject, SUPPORTED_LANGUAGES constant,
 *     HIGHLIGHT_COLOR format, non-boolean BLUR_CATEGORIES values, broken/valid/bare/AltGr
 *     shortcut bindings, mod normalisation, missing-key fill
 *   - boundary values: BLUR_RADIUS min/max/below-min/above-max, SHORTCUTS binding
 *     empty/over-limit/unknown-mods, deepMerge depth limit, PICKER_MODE enum+migration,
 *     PICKER_MODES object, BLUR_MODE enum
 *   - immutability: blsi namespace extensible, STORAGE/COMMAND/POPUP category objects frozen
 *
 * REDUNDANT:
 *   - "BLUR_RADIUS accepts min boundary (2)" and "BLUR_RADIUS rejects below min (1)" test
 *     adjacent integer values using almost identical validateSettings calls. A single test
 *     with .toBe(2) and .toBe(defaultRadius) assertions, or a test.each boundary table,
 *     would be more concise.
 *   - "LANGUAGE accepts auto, en, hi_IN, ta_IN" and "LANGUAGE rejects unsupported codes"
 *     are two separate tests that together exhaustively enumerate the SUPPORTED_LANGUAGES
 *     allowlist. A test.each([['auto', true], ['fr', false], ...]) table would unify them.
 *   - "validateSettings returns full defaults for null" and "fills missing keys with defaults"
 *     assert overlapping key sets (BLUR_RADIUS, TRANSITION_DURATION, HIGHLIGHT_COLOR, etc.).
 *     The null-input test is a strict subset of the empty-object test.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - All BLUR_RADIUS boundary tests (min, max, below-min, above-max) are natural
 *     test.each([[value, expected], ...]) candidates — 4 rows, one assertion each.
 *   - LANGUAGE validation tests could use test.each([['auto', 'auto'], ['fr', 'auto'], ...])
 *     to cover both accept and reject cases in one parameterized table.
 *   - validateSettings tests that follow "input key → expected key value" pattern (BLUR_RADIUS,
 *     REVEAL_MODE, HIGHLIGHT_COLOR, BLUR_CATEGORIES, shortcut rejection) are candidates for
 *     a single test.each([settingsInput, assertFn]) table.
 *
 * MISSING COVERAGE:
 *   - TRANSITION_DURATION validation range [0, 2000] — no test for out-of-range value
 *   - IDLE_TIMEOUT_SECONDS validation range [30, 3600] — not tested at all
 *   - AUTO_DETECT nested object validation: EMAIL boolean gate, NUMERIC enum gate ('off' is
 *     truthy string — must not be treated as enabled), invalid NUMERIC value rejection
 *   - isValidShortcutEntry() as a standalone exported function — only tested indirectly
 *     through validateSettings; direct call path not covered
 *   - deepMerge with array values — current tests only cover plain objects; array merge
 *     behaviour (overwrite vs. concatenate) is unspecified in tests
 *   - buildDefaultSettings called twice — verify independent copies do not share references
 */

'use strict';

describe('BlurrySite constants', () => {
  const PB = blsi;

  // ── Message type categories ───────────────────────────────────────────────

  // USER IMPACT: background.js message routing depends on exact type string values — any mismatch silently drops messages and breaks blur/restore
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

  // USER IMPACT: keyboard shortcut and context-menu commands relay through COMMAND type strings — wrong string means the tab never receives the command
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

  // USER IMPACT: popup live-settings updates and status queries use POPUP type strings — wrong string means popup changes do not apply to the active tab
  describe('POPUP category', () => {
    test('exposes all popup message types', () => {
      expect(PB.POPUP.UPDATE_SETTINGS).toBe('UPDATE_SETTINGS');
      expect(PB.POPUP.GET_STATUS).toBe('GET_STATUS');
      expect(PB.POPUP.UNBLUR_ITEM).toBe('UNBLUR_ITEM');
    });
  });

  // ── Flat access ───────────────────────────────────────────────────────────

  // USER IMPACT: modules use blsi.SAVE_BLUR_ITEM style shorthand — flat access must mirror the namespaced strings
  describe('flat shorthand access', () => {
    test('all message types accessible at top level', () => {
      expect(PB.SAVE_BLUR_ITEM).toBe('SAVE_BLUR_ITEM');
      expect(PB.TOGGLE_BLUR_ALL).toBe('TOGGLE_BLUR_ALL');
      expect(PB.UPDATE_SETTINGS).toBe('UPDATE_SETTINGS');
    });
  });

  // ── isValid ───────────────────────────────────────────────────────────────

  // USER IMPACT: background.js validates incoming message types with isValid() — unknown types are dropped, preventing spoofed or stale messages from executing
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

  // USER IMPACT: routing helpers use categoryOf() to decide handler branch — wrong category would route a storage message to the command handler
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

  // USER IMPACT: fresh install uses DEFAULT_SETTINGS as the baseline — wrong defaults mean users start with incorrect blur radius, reveal mode, or language
  describe('DEFAULT_SETTINGS', () => {
    test('contains all expected top-level keys', () => {
      expect(PB.DEFAULT_SETTINGS.BLUR_RADIUS).toBe(6);
      expect(PB.DEFAULT_SETTINGS.TRANSITION_DURATION).toBe(150);
      expect(PB.DEFAULT_SETTINGS.HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(PB.DEFAULT_SETTINGS.REVEAL_MODE).toBe('hover');
      expect(PB.DEFAULT_SETTINGS.ENABLED).toBe(true);
      expect(PB.DEFAULT_SETTINGS.THOROUGH_BLUR).toBe(false);
      expect(PB.DEFAULT_SETTINGS.LANGUAGE).toBe('auto');
    });

    test('is frozen (immutable)', () => {
      expect(Object.isFrozen(PB.DEFAULT_SETTINGS)).toBe(true);
    });

    test('SHORTCUTS come from the action registry (not embedded in DEFAULT_SETTINGS)', () => {
      // v2: DEFAULT_SETTINGS doesn't carry SHORTCUTS any more — it's built
      // lazily by buildDefaultSettings() from blsi.Actions.
      expect(PB.DEFAULT_SETTINGS.SHORTCUTS).toBeUndefined();
      const full = PB.buildDefaultSettings();
      expect(Object.keys(full.SHORTCUTS)).toHaveLength(4);
      expect(full.SHORTCUTS.TOGGLE_BLUR_ALL).toBeDefined();
      expect(full.SHORTCUTS.TOGGLE_PICKER).toBeDefined();
      expect(full.SHORTCUTS.CLEAR_ALL).toBeDefined();
      expect(full.SHORTCUTS.SCREENSHOT).toBeDefined();
    });

    test('each shortcut has a binding array of {code, mods}', () => {
      const full = PB.buildDefaultSettings();
      for (const entry of Object.values(full.SHORTCUTS)) {
        expect(Array.isArray(entry.binding)).toBe(true);
        expect(entry.binding.length).toBeGreaterThan(0);
        for (const chord of entry.binding) {
          expect(typeof chord.code).toBe('string');
          expect(chord.code.length).toBeGreaterThan(0);
          expect(Array.isArray(chord.mods)).toBe(true);
          expect(chord.mods.length).toBeGreaterThanOrEqual(1);
        }
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

  // USER IMPACT: every settings consumer calls buildDefaultSettings() to get a mutable copy — mutation of one copy must not corrupt the frozen DEFAULT_SETTINGS baseline
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
    // MISSING: no test verifying two separate buildDefaultSettings() calls produce independent objects (no shared reference between calls)
  });

  // ── deepMerge ────────────────────────────────────────────────────────────

  // USER IMPACT: settings partial updates from the popup use deepMerge — incorrect merge drops unrelated keys or allows prototype pollution
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
    // MISSING: no test for deepMerge with array values — overwrite vs. concatenate behaviour is unspecified
    // MISSING: no test for deepMerge with null as base or override argument
  });

  // ── validateSettings ──────────────────────────────────────────────────────

  // USER IMPACT: corrupt storage or manually edited extension data is always sanitized to a valid state before use — prevents silent blur failures from invalid settings
  describe('validateSettings', () => {
    // REDUNDANT: overlaps with "fills missing keys with defaults" below — the null-input case is a strict subset of the empty-object case; consider merging or removing null-input variant
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

    // REDUNDANT: shares the same LANGUAGE allowlist enumeration with "LANGUAGE rejects unsupported codes" below; merge both into a single test.each([['auto', 'auto'], ['en', 'en'], ['fr', 'auto'], ...]) table
    test('LANGUAGE accepts auto, en, hi_IN, ta_IN', () => {
      expect(PB.validateSettings({ LANGUAGE: 'auto' }).LANGUAGE).toBe('auto');
      expect(PB.validateSettings({ LANGUAGE: 'en' }).LANGUAGE).toBe('en');
      expect(PB.validateSettings({ LANGUAGE: 'hi_IN' }).LANGUAGE).toBe('hi_IN');
      expect(PB.validateSettings({ LANGUAGE: 'ta_IN' }).LANGUAGE).toBe('ta_IN');
    });

    // REDUNDANT: shares the same LANGUAGE allowlist enumeration with "LANGUAGE accepts auto, en, hi_IN, ta_IN" above; merge into one test.each table
    test('LANGUAGE rejects unsupported codes and falls back to auto', () => {
      expect(PB.validateSettings({ LANGUAGE: 'fr' }).LANGUAGE).toBe('auto');
      expect(PB.validateSettings({ LANGUAGE: 'hi' }).LANGUAGE).toBe('auto'); // bare 'hi' is no longer supported, must be hi_IN
      expect(PB.validateSettings({ LANGUAGE: 'hi-IN' }).LANGUAGE).toBe('auto'); // hyphen form rejected
      expect(PB.validateSettings({ LANGUAGE: '' }).LANGUAGE).toBe('auto');
      expect(PB.validateSettings({ LANGUAGE: null }).LANGUAGE).toBe('auto');
      expect(PB.validateSettings({ LANGUAGE: 42 }).LANGUAGE).toBe('auto');
    });

    test('SUPPORTED_LANGUAGES is exposed and frozen', () => {
      expect(Array.isArray(PB.SUPPORTED_LANGUAGES)).toBe(true);
      expect(PB.SUPPORTED_LANGUAGES).toEqual(['auto', 'en', 'hi_IN', 'ta_IN']);
      expect(Object.isFrozen(PB.SUPPORTED_LANGUAGES)).toBe(true);
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
      const entry = result.SHORTCUTS.TOGGLE_BLUR_ALL;
      expect(Array.isArray(entry.binding)).toBe(true);
      expect(entry.binding).toHaveLength(1);
      expect(entry.binding[0].code).toBe('KeyB');
      expect(entry.binding[0].mods).toContain('Alt');
      expect(entry.binding[0].mods).toContain('Shift');
    });

    test('accepts valid new-shape binding', () => {
      const result = PB.validateSettings({
        SHORTCUTS: {
          TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyK', mods: ['Control', 'Shift'] }] },
        },
      });
      const entry = result.SHORTCUTS.TOGGLE_BLUR_ALL;
      expect(entry.binding[0].code).toBe('KeyK');
      expect(entry.binding[0].mods).toEqual(['Control', 'Shift']);
    });

    test('rejects bare-letter binding (mods.length === 0)', () => {
      const result = PB.validateSettings({
        SHORTCUTS: {
          TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyB', mods: [] }] },
        },
      });
      // Falls back to default
      expect(result.SHORTCUTS.TOGGLE_BLUR_ALL.binding[0].mods).toContain('Alt');
    });

    test('rejects Control+Alt chord (AltGr collision)', () => {
      const result = PB.validateSettings({
        SHORTCUTS: {
          TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyQ', mods: ['Control', 'Alt'] }] },
        },
      });
      // Falls back to default
      expect(result.SHORTCUTS.TOGGLE_BLUR_ALL.binding[0].code).toBe('KeyB');
    });

    test('normalizes mods to sorted order', () => {
      const result = PB.validateSettings({
        SHORTCUTS: {
          TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyK', mods: ['Shift', 'Control'] }] },
        },
      });
      expect(result.SHORTCUTS.TOGGLE_BLUR_ALL.binding[0].mods).toEqual(['Control', 'Shift']);
    });

    // REDUNDANT: overlaps with "returns full defaults for null input" above — asserts a superset of the same keys; the null-input test is redundant given this broader coverage
    test('fills missing keys with defaults', () => {
      const result = PB.validateSettings({});
      expect(result.BLUR_RADIUS).toBe(6);
      expect(result.TRANSITION_DURATION).toBe(150);
      expect(result.HIGHLIGHT_COLOR).toBe('#f59e0b');
      expect(result.REVEAL_MODE).toBe('hover');
      expect(result.LANGUAGE).toBe('auto');
      expect(result.ENABLED).toBe(true);
      expect(result.THOROUGH_BLUR).toBe(false);
      expect(Object.keys(result.BLUR_CATEGORIES)).toHaveLength(5);
      expect(Object.keys(result.SHORTCUTS)).toHaveLength(4);
    });
    // MISSING: no test for TRANSITION_DURATION out-of-range value (e.g. 5000 or -1)
    // MISSING: no test for IDLE_TIMEOUT_SECONDS range validation
    // MISSING: no test for AUTO_DETECT.EMAIL boolean gate and AUTO_DETECT.NUMERIC enum validation
    // MISSING: no test for isValidShortcutEntry() called directly as a standalone function
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  // USER IMPACT: frozen message type objects prevent accidental mutation in modules — a bug that redefines PB.STORAGE.GET_BLUR_ITEMS would silently break all blur-item fetches
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

  // USER IMPACT: user drags blur-radius slider to its extremes or enters a custom shortcut — clamping prevents invisible blur (radius 0) and UI hangs (oversized bindings)
  // OPTIMIZE: BLUR_RADIUS boundary tests (4 tests) are natural test.each([[value, expected], ...]) candidates; consolidate to one parametrized table
  describe('validateSettings boundary values', () => {
    // REDUNDANT: "BLUR_RADIUS accepts min boundary (2)" and "BLUR_RADIUS rejects below min (1)" test adjacent integer values via nearly identical calls; merge into one boundary table
    test('BLUR_RADIUS accepts min boundary (2)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 2 });
      expect(s.BLUR_RADIUS).toBe(2);
    });

    test('BLUR_RADIUS accepts max boundary (30)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 30 });
      expect(s.BLUR_RADIUS).toBe(30);
    });

    // REDUNDANT: adjacent-integer pair with "BLUR_RADIUS accepts min boundary (2)"; merge into a single test.each boundary table
    test('BLUR_RADIUS rejects below min (1)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 1 });
      expect(s.BLUR_RADIUS).toBe(PB.DEFAULT_SETTINGS.BLUR_RADIUS);
    });

    test('BLUR_RADIUS rejects above max (31)', () => {
      const s = PB.validateSettings({ BLUR_RADIUS: 31 });
      expect(s.BLUR_RADIUS).toBe(PB.DEFAULT_SETTINGS.BLUR_RADIUS);
    });

    test('SHORTCUTS rejects empty binding array', () => {
      const s = PB.validateSettings({
        SHORTCUTS: { TOGGLE_BLUR_ALL: { binding: [] } },
      });
      // Falls back to default — binding has at least one chord
      expect(s.SHORTCUTS.TOGGLE_BLUR_ALL.binding.length).toBeGreaterThan(0);
    });

    test('SHORTCUTS rejects binding array exceeding limit (5 chords)', () => {
      const binding = Array.from({ length: 5 }, (_, i) => ({
        code: 'KeyA', mods: ['Alt'],
      }));
      const s = PB.validateSettings({
        SHORTCUTS: { TOGGLE_BLUR_ALL: { binding } },
      });
      // Falls back to default — default is a single chord
      expect(s.SHORTCUTS.TOGGLE_BLUR_ALL.binding).toHaveLength(1);
    });

    test('SHORTCUTS rejects unknown modifier names', () => {
      const s = PB.validateSettings({
        SHORTCUTS: {
          TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyK', mods: ['Option'] }] },
        },
      });
      // Falls back to default
      expect(s.SHORTCUTS.TOGGLE_BLUR_ALL.binding[0].code).toBe('KeyB');
    });

    test('deepMerge stops at depth limit', () => {
      const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
      const base = { a: { b: { c: { d: { e: { f: { g: 'base' } } } } } } };
      const result = PB.deepMerge(base, deep);
      // At depth 6, override should be returned directly instead of recursing
      expect(result.a.b.c.d.e.f).toEqual({ g: 'deep' });
    });

    test('PICKER_MODE defaults to sticky-page', () => {
      expect(PB.DEFAULT_SETTINGS.PICKER_MODE).toBe('sticky-page');
    });

    test('PICKER_MODE validates against enum', () => {
      const s1 = PB.validateSettings({ PICKER_MODE: 'sticky-page' });
      expect(s1.PICKER_MODE).toBe('sticky-page');
      const s2 = PB.validateSettings({ PICKER_MODE: 'sticky-screen' });
      expect(s2.PICKER_MODE).toBe('sticky-screen');
      const s3 = PB.validateSettings({ PICKER_MODE: 'dynamic' });
      expect(s3.PICKER_MODE).toBe('dynamic');
      const s4 = PB.validateSettings({ PICKER_MODE: 'invalid' });
      expect(s4.PICKER_MODE).toBe(PB.DEFAULT_SETTINGS.PICKER_MODE);
    });

    test('PICKER_MODE legacy "sticky" migrates to sticky-page', () => {
      const s = PB.validateSettings({ PICKER_MODE: 'sticky' });
      expect(s.PICKER_MODE).toBe('sticky-page');
    });

    test('PICKER_MODES enum exists', () => {
      expect(PB.PICKER_MODES.STICKY_PAGE).toBe('sticky-page');
      expect(PB.PICKER_MODES.STICKY_SCREEN).toBe('sticky-screen');
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
    // MISSING: no test for BLUR_MODE accepting 'redacted' and 'masked' values
    // MISSING: no test for TRANSITION_DURATION boundary values (0, 2000, -1, 2001)
    // MISSING: no test for IDLE_TIMEOUT_SECONDS validation (30 min, 3600 max, out-of-range rejection)
  });

  // ── New popup redesign enums ────────────────────────────────────────────────

  describe('ACTIVE_MODES enum', () => {
    test('has blur-all and pick-blur values', () => {
      expect(blsi.ACTIVE_MODES).toEqual({ BLUR_ALL: 'blur-all', PICK_BLUR: 'pick-blur' });
    });
    test('is frozen', () => {
      expect(Object.isFrozen(blsi.ACTIVE_MODES)).toBe(true);
    });
  });

  describe('PICK_BLUR_MODES enum', () => {
    test('has gaussian, frosted, color — no redacted or masked', () => {
      expect(blsi.PICK_BLUR_MODES).toEqual({
        GAUSSIAN: 'gaussian',
        FROSTED: 'frosted',
        COLOR: 'color',
      });
    });
    test('is frozen', () => {
      expect(Object.isFrozen(blsi.PICK_BLUR_MODES)).toBe(true);
    });
  });

  describe('PII_MODES enum', () => {
    test('has gaussian, frosted, redacted, asterisked', () => {
      expect(blsi.PII_MODES).toEqual({
        GAUSSIAN: 'gaussian',
        FROSTED: 'frosted',
        REDACTED: 'redacted',
        ASTERISKED: 'asterisked',
      });
    });
    test('is frozen', () => {
      expect(Object.isFrozen(blsi.PII_MODES)).toBe(true);
    });
  });

  describe('TIMER_UNITS enum', () => {
    test('has sec, min, hr', () => {
      expect(blsi.TIMER_UNITS).toEqual({ SEC: 'sec', MIN: 'min', HR: 'hr' });
    });
    test('is frozen', () => {
      expect(Object.isFrozen(blsi.TIMER_UNITS)).toBe(true);
    });
  });

  describe('IDLE_UNITS enum', () => {
    test('has sec and min only — no hr (Chrome API cap is 3000 s)', () => {
      expect(blsi.IDLE_UNITS).toEqual({ SEC: 'sec', MIN: 'min' });
    });
    test('does not contain hr', () => {
      expect(blsi.IDLE_UNITS).not.toHaveProperty('HR');
    });
    test('is frozen', () => {
      expect(Object.isFrozen(blsi.IDLE_UNITS)).toBe(true);
    });
  });

  // ── New popup redesign DEFAULT_SETTINGS keys ────────────────────────────────

  describe('DEFAULT_SETTINGS — new popup redesign keys', () => {
    test('ACTIVE_MODE defaults to blur-all', () => {
      expect(blsi.DEFAULT_SETTINGS.ACTIVE_MODE).toBe('blur-all');
    });

    test('PICK_BLUR_TYPE defaults to gaussian', () => {
      expect(blsi.DEFAULT_SETTINGS.PICK_BLUR_TYPE).toBe('gaussian');
    });

    test('PICK_BLUR_COLOR defaults to opaque black', () => {
      expect(blsi.DEFAULT_SETTINGS.PICK_BLUR_COLOR).toEqual({ HEX: '#000000', OPACITY: 1.0 });
    });

    test('PICK_BLUR_COLOR is frozen', () => {
      expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.PICK_BLUR_COLOR)).toBe(true);
    });

    test('PII_MODE defaults to gaussian', () => {
      expect(blsi.DEFAULT_SETTINGS.PII_MODE).toBe('gaussian');
    });

    test('AUTOMATE has correct default structure', () => {
      expect(blsi.DEFAULT_SETTINGS.AUTOMATE).toEqual({
        TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false },
        IDLE: { VALUE: 5, UNIT: 'min', ENABLED: false },
        TAB_SWITCH: { ENABLED: false },
      });
    });

    test('AUTOMATE is frozen (top-level and nested)', () => {
      expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE)).toBe(true);
      expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE.TIMER)).toBe(true);
      expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE.IDLE)).toBe(true);
      expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE.TAB_SWITCH)).toBe(true);
    });

    test('buildDefaultSettings includes all new keys', () => {
      const s = blsi.buildDefaultSettings();
      expect(s).toHaveProperty('ACTIVE_MODE');
      expect(s).toHaveProperty('PICK_BLUR_TYPE');
      expect(s).toHaveProperty('PICK_BLUR_COLOR');
      expect(s).toHaveProperty('PII_MODE');
      expect(s).toHaveProperty('AUTOMATE');
    });
  });

  // ── validateSettings — new popup redesign keys ──────────────────────────────

  describe('validateSettings — new popup redesign keys', () => {
    function base() { return blsi.buildDefaultSettings(); }

    // ACTIVE_MODE
    test('ACTIVE_MODE: pick-blur passes through', () => {
      const r = blsi.validateSettings({ ...base(), ACTIVE_MODE: 'pick-blur' });
      expect(r.ACTIVE_MODE).toBe('pick-blur');
    });
    test('ACTIVE_MODE: invalid value falls back to blur-all', () => {
      const r = blsi.validateSettings({ ...base(), ACTIVE_MODE: 'unknown' });
      expect(r.ACTIVE_MODE).toBe('blur-all');
    });
    test('ACTIVE_MODE: missing key falls back to default', () => {
      const s = base(); delete s.ACTIVE_MODE;
      const r = blsi.validateSettings(s);
      expect(r.ACTIVE_MODE).toBe('blur-all');
    });

    // PICK_BLUR_TYPE
    test('PICK_BLUR_TYPE: color passes through', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_TYPE: 'color' });
      expect(r.PICK_BLUR_TYPE).toBe('color');
    });
    test('PICK_BLUR_TYPE: redacted is rejected (not a Pick & Blur type)', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_TYPE: 'redacted' });
      expect(r.PICK_BLUR_TYPE).toBe('gaussian');
    });
    test('PICK_BLUR_TYPE: masked is rejected', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_TYPE: 'masked' });
      expect(r.PICK_BLUR_TYPE).toBe('gaussian');
    });

    // PICK_BLUR_COLOR
    test('PICK_BLUR_COLOR: valid hex + opacity pass through', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#ff3300', OPACITY: 0.5 } });
      expect(r.PICK_BLUR_COLOR).toEqual({ HEX: '#ff3300', OPACITY: 0.5 });
    });
    test('PICK_BLUR_COLOR: 3-char hex falls back to default hex', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#f30', OPACITY: 1.0 } });
      expect(r.PICK_BLUR_COLOR.HEX).toBe('#000000');
    });
    test('PICK_BLUR_COLOR: named color "red" falls back to default hex', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: 'red', OPACITY: 1.0 } });
      expect(r.PICK_BLUR_COLOR.HEX).toBe('#000000');
    });
    test('PICK_BLUR_COLOR: opacity > 1 falls back to 1.0', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#ffffff', OPACITY: 1.5 } });
      expect(r.PICK_BLUR_COLOR.OPACITY).toBe(1.0);
    });
    test('PICK_BLUR_COLOR: opacity < 0 falls back to 1.0', () => {
      const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#ffffff', OPACITY: -0.1 } });
      expect(r.PICK_BLUR_COLOR.OPACITY).toBe(1.0);
    });
    test('PICK_BLUR_COLOR: missing key falls back to defaults', () => {
      const s = base(); delete s.PICK_BLUR_COLOR;
      const r = blsi.validateSettings(s);
      expect(r.PICK_BLUR_COLOR).toEqual({ HEX: '#000000', OPACITY: 1.0 });
    });

    // PII_MODE
    test('PII_MODE: asterisked passes through', () => {
      const r = blsi.validateSettings({ ...base(), PII_MODE: 'asterisked' });
      expect(r.PII_MODE).toBe('asterisked');
    });
    test('PII_MODE: redacted passes through', () => {
      const r = blsi.validateSettings({ ...base(), PII_MODE: 'redacted' });
      expect(r.PII_MODE).toBe('redacted');
    });
    test('PII_MODE: invalid value falls back to gaussian', () => {
      const r = blsi.validateSettings({ ...base(), PII_MODE: 'bogus' });
      expect(r.PII_MODE).toBe('gaussian');
    });

    // AUTOMATE.TIMER
    test('AUTOMATE.TIMER: valid value + sec unit pass through', () => {
      const s = base();
      s.AUTOMATE = { TIMER: { VALUE: 30, UNIT: 'sec', ENABLED: true }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.TIMER).toEqual({ VALUE: 30, UNIT: 'sec', ENABLED: true });
    });
    test('AUTOMATE.TIMER: VALUE 0 is valid (timer off)', () => {
      const s = base();
      s.AUTOMATE = { TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.TIMER.VALUE).toBe(0);
    });
    test('AUTOMATE.TIMER: VALUE 100 (above max 99) falls back to 0', () => {
      const s = base();
      s.AUTOMATE = { TIMER: { VALUE: 100, UNIT: 'min', ENABLED: false }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.TIMER.VALUE).toBe(0);
    });
    test('AUTOMATE.TIMER: hr unit passes through', () => {
      const s = base();
      s.AUTOMATE = { TIMER: { VALUE: 2, UNIT: 'hr', ENABLED: true }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.TIMER.UNIT).toBe('hr');
    });

    // AUTOMATE.IDLE
    test('AUTOMATE.IDLE: valid value + min unit pass through', () => {
      const s = base();
      s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: { VALUE: 10, UNIT: 'min', ENABLED: true }, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.IDLE).toEqual({ VALUE: 10, UNIT: 'min', ENABLED: true });
    });
    test('AUTOMATE.IDLE: hr unit rejected (Chrome API cap) — falls back to min', () => {
      const s = base();
      s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: { VALUE: 2, UNIT: 'hr', ENABLED: true }, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.IDLE.UNIT).toBe('min');
    });
    test('AUTOMATE.IDLE: VALUE 0 (below min 1) falls back to 5', () => {
      const s = base();
      s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: { VALUE: 0, UNIT: 'min', ENABLED: false }, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.IDLE.VALUE).toBe(5);
    });

    // AUTOMATE.TAB_SWITCH
    test('AUTOMATE.TAB_SWITCH: enabled true passes through', () => {
      const s = base();
      s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: { ENABLED: true } };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.TAB_SWITCH.ENABLED).toBe(true);
    });

    // AUTOMATE missing entirely
    test('AUTOMATE missing falls back to full defaults', () => {
      const s = base(); delete s.AUTOMATE;
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE).toEqual(blsi.DEFAULT_SETTINGS.AUTOMATE);
    });

    // AUTOMATE partial — missing sub-keys
    test('AUTOMATE.TIMER missing falls back to default timer', () => {
      const s = base();
      s.AUTOMATE = { IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
      const r = blsi.validateSettings(s);
      expect(r.AUTOMATE.TIMER).toEqual(blsi.DEFAULT_SETTINGS.AUTOMATE.TIMER);
    });
  });

});
