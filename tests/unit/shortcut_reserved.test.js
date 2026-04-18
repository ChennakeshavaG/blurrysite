/**
 * tests/unit/shortcut_reserved.test.js
 *
 * Unit tests for the reserved chord API on blsi.ShortcutLabel.
 * (Formerly src/shortcut_reserved.js — merged into shortcut_label.js.)
 *
 * Contract:
 *   - RESERVED is a frozen array of { key, label, platform } entries.
 *   - isReserved(chord) returns true for chords that match (after platform filter).
 *   - lookup(chord) returns { label } or null.
 *   - Mac-only entries only fire on Mac, Win-only only on non-Mac, 'any' everywhere.
 */

/* === TEST QUALITY ANNOTATIONS ===
 * FILE COVERS:
 *   - API surface: isReserved, lookup, RESERVED exposed on blsi.ShortcutLabel
 *   - Positive isReserved checks: Ctrl+T, Ctrl+W, F5, F12
 *   - Positive lookup check: Ctrl+T label regex match
 *   - Negative isReserved checks: Alt+Shift+B (TOGGLE_BLUR_ALL default), Ctrl+Shift+K
 *   - Negative lookup: returns null for non-reserved chord
 *   - Mod-order agnostic: [Shift,Control] same as [Control,Shift]
 *   - Platform conditional: Meta+Q reserved only on Mac
 *   - RESERVED array is frozen
 *
 * REDUNDANT TESTS:
 *   - "Ctrl+W is reserved", "F5 is reserved", "F12 is reserved" follow the exact same
 *     isReserved(chord) === true pattern as "Ctrl+T is reserved" — all 4 are test.each candidates.
 *   - "Alt+Shift+B is NOT reserved" and "Control+Shift+KeyK is NOT reserved" are both
 *     negative isReserved assertions; could be merged into a single test with two expect calls,
 *     or expressed as a test.each negative table.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Reserved positive tests → test.each([['Ctrl+T', {code:'KeyT', mods:['Control']}], ...])
 *   - Negative tests → test.each([['Alt+Shift+B', {...}], ['Ctrl+Shift+K', {...}]])
 *   - Platform-conditional test — consider separate IS_MAC=true and IS_MAC=false branches
 *     via module reload with mocked navigator.platform to cover both paths in one run.
 *
 * MISSING COVERAGE:
 *   - Only 4-5 reserved entries out of 13+ are exercised by isReserved positive tests.
 *   - No test that each RESERVED entry has the required shape: { key, label, platform }.
 *   - lookup() return value is only tested via regex match — no assertion on exact label string.
 *   - No test for null or undefined chord passed to isReserved() (defensive / crash guard).
 *   - No test for null or undefined chord passed to lookup() (defensive / crash guard).
 */

'use strict';

// Loaded by tests/setup.js.

// USER IMPACT: user tries to bind a browser-reserved shortcut (e.g. Ctrl+T) — settings UI shows a "reserved" warning before saving
describe('blsi.ShortcutLabel reserved API', () => {
  test('RESERVED, isReserved, lookup exposed on blsi.ShortcutLabel', () => {
    expect(typeof blsi.ShortcutLabel.isReserved).toBe('function');
    expect(typeof blsi.ShortcutLabel.lookup).toBe('function');
    expect(Array.isArray(blsi.ShortcutLabel.RESERVED)).toBe(true);
  });

  // OPTIMIZE: "Ctrl+T", "Ctrl+W", "F5", "F12" isReserved positive tests are structurally identical; convert to test.each([['Ctrl+T',{code:'KeyT',mods:['Control']}],...])
  test('Ctrl+T is reserved (cross-platform browser shortcut)', () => {
    const entry = blsi.ShortcutLabel.lookup({ code: 'KeyT', mods: ['Control'] });
    expect(entry).not.toBeNull();
    expect(entry.label).toMatch(/tab/i);
  });

  // REDUNDANT: same isReserved === true pattern as "Ctrl+T is reserved" above
  test('Ctrl+W is reserved', () => {
    expect(blsi.ShortcutLabel.isReserved({ code: 'KeyW', mods: ['Control'] })).toBe(true);
  });

  // REDUNDANT: same isReserved === true pattern as "Ctrl+T is reserved" above
  test('F5 is reserved (reload)', () => {
    expect(blsi.ShortcutLabel.isReserved({ code: 'F5', mods: [] })).toBe(true);
  });

  // REDUNDANT: same isReserved === true pattern as "Ctrl+T is reserved" above
  test('F12 is reserved (DevTools)', () => {
    expect(blsi.ShortcutLabel.isReserved({ code: 'F12', mods: [] })).toBe(true);
  });

  // USER IMPACT: platform-specific reserved chord detection — Mac users see warnings for Cmd+Q; Windows users do not
  // OPTIMIZE: negative tests below could be test.each([['Alt+Shift+B',{code:'KeyB',mods:['Alt','Shift']}],['Ctrl+Shift+K',{code:'KeyK',mods:['Control','Shift']}]])
  // REDUNDANT: "Alt+Shift+B is NOT reserved" and "Control+Shift+KeyK is NOT reserved" are both isReserved === false assertions; one test with two expect calls suffices
  test('Alt+Shift+B is NOT reserved (the default TOGGLE_BLUR_ALL binding)', () => {
    expect(blsi.ShortcutLabel.isReserved({ code: 'KeyB', mods: ['Alt', 'Shift'] })).toBe(false);
  });

  // REDUNDANT: same isReserved === false pattern as "Alt+Shift+B is NOT reserved" above
  test('Control+Shift+KeyK is NOT reserved', () => {
    expect(blsi.ShortcutLabel.isReserved({ code: 'KeyK', mods: ['Control', 'Shift'] })).toBe(false);
  });

  test('lookup returns null for non-reserved chords', () => {
    expect(blsi.ShortcutLabel.lookup({ code: 'KeyQ', mods: ['Alt', 'Shift'] })).toBeNull();
  });

  // USER IMPACT: mod-order agnostic matching — "Shift+Ctrl+T" and "Ctrl+Shift+T" both trigger the reserved warning
  test('mod-order agnostic: [Shift, Control] treated same as [Control, Shift]', () => {
    const a = blsi.ShortcutLabel.isReserved({ code: 'KeyT', mods: ['Shift', 'Control'] });
    const b = blsi.ShortcutLabel.isReserved({ code: 'KeyT', mods: ['Control', 'Shift'] });
    expect(a).toBe(b);
  });

  test('platform-conditional entry: Meta+Q fires only on Mac', () => {
    const isMac = blsi.ShortcutLabel.IS_MAC;
    const isReserved = blsi.ShortcutLabel.isReserved({ code: 'KeyQ', mods: ['Meta'] });
    if (isMac) {
      expect(isReserved).toBe(true);
    } else {
      expect(isReserved).toBe(false);
    }
  });

  test('RESERVED entries are frozen', () => {
    expect(Object.isFrozen(blsi.ShortcutLabel.RESERVED)).toBe(true);
  });
  // MISSING: no test that each RESERVED entry has required shape { key, label, platform }
  // MISSING: no test for null/undefined chord passed to isReserved() — crash guard
  // MISSING: no test for null/undefined chord passed to lookup() — crash guard
  // MISSING: only 4 of 13+ reserved entries are exercised by positive isReserved tests
});
