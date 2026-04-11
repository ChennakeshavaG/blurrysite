/**
 * tests/unit/shortcut_reserved.test.js
 *
 * Unit tests for src/shortcut_reserved.js (blsi.ShortcutReserved).
 *
 * Contract:
 *   - RESERVED is a frozen array of { key, label, platform } entries.
 *   - isReserved(chord) returns true for chords that match (after platform filter).
 *   - lookup(chord) returns { label } or null.
 *   - Mac-only entries only fire on Mac, Win-only only on non-Mac, 'any' everywhere.
 */

'use strict';

// Loaded by tests/setup.js.

describe('blsi.ShortcutReserved', () => {
  test('is exposed as blsi.ShortcutReserved', () => {
    expect(blsi.ShortcutReserved).toBeDefined();
    expect(typeof blsi.ShortcutReserved.isReserved).toBe('function');
    expect(typeof blsi.ShortcutReserved.lookup).toBe('function');
    expect(Array.isArray(blsi.ShortcutReserved.RESERVED)).toBe(true);
  });

  test('Ctrl+T is reserved (cross-platform browser shortcut)', () => {
    const entry = blsi.ShortcutReserved.lookup({ code: 'KeyT', mods: ['Control'] });
    expect(entry).not.toBeNull();
    expect(entry.label).toMatch(/tab/i);
  });

  test('Ctrl+W is reserved', () => {
    expect(blsi.ShortcutReserved.isReserved({ code: 'KeyW', mods: ['Control'] })).toBe(true);
  });

  test('F5 is reserved (reload)', () => {
    expect(blsi.ShortcutReserved.isReserved({ code: 'F5', mods: [] })).toBe(true);
  });

  test('F12 is reserved (DevTools)', () => {
    expect(blsi.ShortcutReserved.isReserved({ code: 'F12', mods: [] })).toBe(true);
  });

  test('Alt+Shift+B is NOT reserved (the default TOGGLE_BLUR_ALL binding)', () => {
    expect(blsi.ShortcutReserved.isReserved({ code: 'KeyB', mods: ['Alt', 'Shift'] })).toBe(false);
  });

  test('Control+Shift+KeyK is NOT reserved', () => {
    expect(blsi.ShortcutReserved.isReserved({ code: 'KeyK', mods: ['Control', 'Shift'] })).toBe(false);
  });

  test('lookup returns null for non-reserved chords', () => {
    expect(blsi.ShortcutReserved.lookup({ code: 'KeyQ', mods: ['Alt', 'Shift'] })).toBeNull();
  });

  test('mod-order agnostic: [Shift, Control] treated same as [Control, Shift]', () => {
    const a = blsi.ShortcutReserved.isReserved({ code: 'KeyT', mods: ['Shift', 'Control'] });
    const b = blsi.ShortcutReserved.isReserved({ code: 'KeyT', mods: ['Control', 'Shift'] });
    expect(a).toBe(b);
  });

  test('platform-conditional entry: Meta+Q fires only on Mac', () => {
    // The result depends on the runtime platform (IS_MAC in ShortcutLabel).
    // We just verify the logic — whichever platform we're on, the result is
    // internally consistent.
    const isMac = blsi.ShortcutLabel.IS_MAC;
    const isReserved = blsi.ShortcutReserved.isReserved({ code: 'KeyQ', mods: ['Meta'] });
    if (isMac) {
      expect(isReserved).toBe(true);
    } else {
      expect(isReserved).toBe(false);
    }
  });

  test('RESERVED entries are frozen', () => {
    expect(Object.isFrozen(blsi.ShortcutReserved.RESERVED)).toBe(true);
  });
});
