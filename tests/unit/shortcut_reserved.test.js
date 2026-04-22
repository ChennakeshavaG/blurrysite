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

'use strict';

// Loaded by tests/setup.js.

// USER IMPACT: user tries to bind a browser-reserved shortcut (e.g. Ctrl+T) — settings UI shows a "reserved" warning before saving
describe('blsi.ShortcutLabel reserved API', () => {
  test('RESERVED, isReserved, lookup exposed on blsi.ShortcutLabel', () => {
    expect(typeof blsi.ShortcutLabel.isReserved).toBe('function');
    expect(typeof blsi.ShortcutLabel.lookup).toBe('function');
    expect(Array.isArray(blsi.ShortcutLabel.RESERVED)).toBe(true);
  });

  test('Ctrl+T is reserved — lookup returns label matching /tab/i', () => {
    const entry = blsi.ShortcutLabel.lookup({ code: 'KeyT', mods: ['Control'] });
    expect(entry).not.toBeNull();
    expect(entry.label).toMatch(/tab/i);
  });

  // All 'any'-platform entries must be reserved regardless of runtime platform.
  test.each([
    ['Ctrl+N',       { code: 'KeyN', mods: ['Control'] }],
    ['Ctrl+W',       { code: 'KeyW', mods: ['Control'] }],
    ['Ctrl+Tab',     { code: 'Tab',  mods: ['Control'] }],
    ['Ctrl+Shift+T', { code: 'KeyT', mods: ['Control', 'Shift'] }],
    ['Ctrl+Shift+N', { code: 'KeyN', mods: ['Control', 'Shift'] }],
    ['F5',           { code: 'F5',   mods: [] }],
    ['F11',          { code: 'F11',  mods: [] }],
    ['F12',          { code: 'F12',  mods: [] }],
  ])('%s is reserved (cross-platform)', (_label, chord) => {
    expect(blsi.ShortcutLabel.isReserved(chord)).toBe(true);
  });

  test('custom bindings are not reserved', () => {
    expect(blsi.ShortcutLabel.isReserved({ code: 'KeyB', mods: ['Alt', 'Shift'] })).toBe(false);
    expect(blsi.ShortcutLabel.isReserved({ code: 'KeyK', mods: ['Control', 'Shift'] })).toBe(false);
  });

  test('lookup returns null for non-reserved chords', () => {
    expect(blsi.ShortcutLabel.lookup({ code: 'KeyQ', mods: ['Alt', 'Shift'] })).toBeNull();
  });

  // Defensive guards — must not throw on bad input.
  test('isReserved(null) returns false without throwing', () => {
    expect(blsi.ShortcutLabel.isReserved(null)).toBe(false);
  });

  test('lookup(undefined) returns null without throwing', () => {
    expect(blsi.ShortcutLabel.lookup(undefined)).toBeNull();
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
