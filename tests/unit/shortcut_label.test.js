/**
 * tests/unit/shortcut_label.test.js
 *
 * Unit tests for src/shortcut_label.js (blsi.ShortcutLabel).
 *
 * Covers:
 *  - codeLabel() mapping for letters, digits, symbols, special keys
 *  - modLabel() platform-aware rendering (Mac glyphs vs Windows spelled-out)
 *  - chordLabel() assembly
 *  - bindingLabel() multi-chord
 *  - chordKey() canonical form for conflict detection
 *  - bindingKey() multi-chord canonical form
 */

'use strict';

// Shortcut label is loaded by tests/setup.js.

describe('blsi.ShortcutLabel', () => {
  test('is exposed as blsi.ShortcutLabel', () => {
    expect(blsi.ShortcutLabel).toBeDefined();
    expect(typeof blsi.ShortcutLabel.codeLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.modLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.chordLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.bindingLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.chordKey).toBe('function');
    expect(typeof blsi.ShortcutLabel.bindingKey).toBe('function');
  });

  describe('codeLabel', () => {
    const Label = () => blsi.ShortcutLabel;

    test('letters: KeyA → "A", KeyZ → "Z"', () => {
      expect(Label().codeLabel('KeyA')).toBe('A');
      expect(Label().codeLabel('KeyZ')).toBe('Z');
    });

    test('digits: Digit0 → "0", Digit9 → "9"', () => {
      expect(Label().codeLabel('Digit0')).toBe('0');
      expect(Label().codeLabel('Digit9')).toBe('9');
    });

    test('symbols: Minus, Equal, BracketLeft, Slash', () => {
      expect(Label().codeLabel('Minus')).toBe('-');
      expect(Label().codeLabel('Equal')).toBe('=');
      expect(Label().codeLabel('BracketLeft')).toBe('[');
      expect(Label().codeLabel('Slash')).toBe('/');
    });

    test('named keys: Enter, Escape, Tab, Space', () => {
      expect(Label().codeLabel('Enter')).toBe('Enter');
      expect(Label().codeLabel('Escape')).toBe('Esc');
      expect(Label().codeLabel('Tab')).toBe('Tab');
      expect(Label().codeLabel('Space')).toBe('Space');
    });

    test('arrow keys: Unicode glyphs', () => {
      expect(Label().codeLabel('ArrowUp')).toBe('↑');
      expect(Label().codeLabel('ArrowDown')).toBe('↓');
      expect(Label().codeLabel('ArrowLeft')).toBe('←');
      expect(Label().codeLabel('ArrowRight')).toBe('→');
    });

    test('function keys: F1..F12', () => {
      expect(Label().codeLabel('F1')).toBe('F1');
      expect(Label().codeLabel('F12')).toBe('F12');
    });

    test('numpad: NumpadEnter', () => {
      expect(Label().codeLabel('NumpadEnter')).toBe('Num⏎');
    });

    test('unknown code falls back to the code string', () => {
      expect(Label().codeLabel('MediaTrackNext')).toBe('MediaTrackNext');
    });
  });

  describe('modLabel and chord rendering — platform-aware', () => {
    // The IS_MAC flag is computed once at module load from navigator.platform.
    // jsdom's navigator.platform is usually "" or "MacIntel" depending on version;
    // we test the BRANCH that is active without forcing a reload.

    test('modLabel returns something for each core modifier', () => {
      const L = blsi.ShortcutLabel;
      expect(L.modLabel('Alt')).toBeTruthy();
      expect(L.modLabel('Control')).toBeTruthy();
      expect(L.modLabel('Shift')).toBeTruthy();
      expect(L.modLabel('Meta')).toBeTruthy();
    });

    test('chordLabel: Alt+Shift+B renders as expected for the active platform', () => {
      const L = blsi.ShortcutLabel;
      const chord = { code: 'KeyB', mods: ['Alt', 'Shift'] };
      const label = L.chordLabel(chord);
      if (L.IS_MAC) {
        expect(label).toBe('⌥⇧B');
      } else {
        expect(label).toBe('Alt+Shift+B');
      }
    });

    test('chordLabel: single modifier chord', () => {
      const L = blsi.ShortcutLabel;
      const label = L.chordLabel({ code: 'KeyK', mods: ['Control'] });
      if (L.IS_MAC) expect(label).toBe('⌃K');
      else expect(label).toBe('Ctrl+K');
    });

    test('chordLabel: empty mods renders just the code', () => {
      const L = blsi.ShortcutLabel;
      expect(L.chordLabel({ code: 'Enter', mods: [] })).toBe('Enter');
    });

    test('chordLabel: handles missing input gracefully', () => {
      const L = blsi.ShortcutLabel;
      expect(L.chordLabel(null)).toBe('');
      expect(L.chordLabel({})).toBe('');
    });
  });

  describe('bindingLabel', () => {
    test('single-chord binding matches chordLabel', () => {
      const L = blsi.ShortcutLabel;
      const binding = [{ code: 'KeyB', mods: ['Alt', 'Shift'] }];
      expect(L.bindingLabel(binding)).toBe(L.chordLabel(binding[0]));
    });

    test('multi-chord binding is space-separated', () => {
      const L = blsi.ShortcutLabel;
      const binding = [
        { code: 'KeyG', mods: ['Alt'] },
        { code: 'KeyI', mods: ['Alt'] },
      ];
      const label = L.bindingLabel(binding);
      expect(label.split(' ')).toHaveLength(2);
    });

    test('empty binding returns empty string', () => {
      expect(blsi.ShortcutLabel.bindingLabel([])).toBe('');
      expect(blsi.ShortcutLabel.bindingLabel(null)).toBe('');
    });
  });

  describe('chordKey — canonical form for conflict detection', () => {
    const L = () => blsi.ShortcutLabel;

    test('produces identical keys regardless of input mod order', () => {
      const a = L().chordKey({ code: 'KeyB', mods: ['Alt', 'Shift'] });
      const b = L().chordKey({ code: 'KeyB', mods: ['Shift', 'Alt'] });
      expect(a).toBe(b);
    });

    test('distinguishes different codes', () => {
      expect(L().chordKey({ code: 'KeyB', mods: ['Alt'] }))
        .not.toBe(L().chordKey({ code: 'KeyC', mods: ['Alt'] }));
    });

    test('distinguishes different mod sets', () => {
      expect(L().chordKey({ code: 'KeyB', mods: ['Alt'] }))
        .not.toBe(L().chordKey({ code: 'KeyB', mods: ['Alt', 'Shift'] }));
    });

    test('format is "<sorted mods joined by +>|<code>"', () => {
      expect(L().chordKey({ code: 'KeyB', mods: ['Shift', 'Alt'] }))
        .toBe('Alt+Shift|KeyB');
    });
  });

  describe('bindingKey — canonical form for multi-chord conflict detection', () => {
    test('joins chord keys with a space', () => {
      const L = blsi.ShortcutLabel;
      const key = L.bindingKey([
        { code: 'KeyG', mods: ['Alt'] },
        { code: 'KeyI', mods: ['Alt'] },
      ]);
      expect(key).toBe('Alt|KeyG Alt|KeyI');
    });

    test('empty array → empty string', () => {
      expect(blsi.ShortcutLabel.bindingKey([])).toBe('');
    });
  });
});
