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

/* === TEST QUALITY ANNOTATIONS ===
 * FILE COVERS:
 *   - codeLabel() mapping: letters (KeyA-KeyZ), digits (Digit0-Digit9), symbols, named keys
 *     (Enter/Esc/Tab/Space), arrow keys (Unicode glyphs), F1-F12, NumpadEnter, unknown fallback
 *   - modLabel() truthy-check for all 4 core modifiers
 *   - chordLabel() assembly: multi-modifier, single modifier, empty mods, null/empty input guard
 *   - bindingLabel(): single-chord delegation, multi-chord space-join, empty/null guard
 *   - chordKey() canonical form: mod-order independence, code distinction, mod-set distinction, format contract
 *   - bindingKey(): multi-chord space-join, empty array
 *
 * REDUNDANT TESTS:
 *   - "letters: KeyA → A, KeyZ → Z", "digits: Digit0 → 0, Digit9 → 9", "symbols: Minus/Equal...",
 *     "named keys: Enter/Escape/Tab/Space", "arrow keys: Unicode glyphs", "function keys: F1/F12",
 *     "numpad: NumpadEnter" all follow the identical codeLabel(code) → expected string pattern —
 *     all 7 could be collapsed into a single test.each table.
 *   - "distinguishes different codes" and "distinguishes different mod sets" both assert
 *     chordKey inequality and could be merged into one test with two not.toBe assertions.
 *   - "chordLabel: single modifier chord" and "chordLabel: Alt+Shift+B renders as expected"
 *     both exercise chordLabel platform branching — parameterizable.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - All codeLabel mapping tests → one test.each table per category (letters, digits,
 *     symbols, named, arrows, Fkeys, numpad).
 *   - chordKey distinction tests → test.each([['different codes', chord1, chord2],
 *     ['different mods', chord3, chord4]]) with shared not.toBe assertion.
 *   - chordLabel platform tests → test.each with [chord, macExpected, winExpected] tuples,
 *     branching on IS_MAC inside a single assertion body.
 *
 * MISSING COVERAGE:
 *   - No test that modLabel returns the exact glyph (⌘⇧⌥⌃) on Mac vs spelled-out
 *     (Ctrl/Shift/Alt/Win) on Windows — current tests only assert toBeTruthy().
 *   - No test that chordLabel respects mod display order (sortModsForDisplay contract).
 *   - Only NumpadEnter is tested out of 15+ numpad entries; no coverage for Numpad0-Numpad9,
 *     NumpadAdd, NumpadSubtract, NumpadMultiply, NumpadDivide, NumpadDecimal.
 *   - No test for an unknown/unsupported modifier string passed to modLabel() — fallback behavior.
 */

'use strict';

// Shortcut label is loaded by tests/setup.js.

describe('blsi.ShortcutLabel', () => {
  // USER IMPACT: settings UI and toast notifications display human-readable shortcut labels instead of raw KeyboardEvent.code strings
  test('is exposed as blsi.ShortcutLabel', () => {
    expect(blsi.ShortcutLabel).toBeDefined();
    expect(typeof blsi.ShortcutLabel.codeLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.modLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.chordLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.bindingLabel).toBe('function');
    expect(typeof blsi.ShortcutLabel.chordKey).toBe('function');
    expect(typeof blsi.ShortcutLabel.bindingKey).toBe('function');
  });

  // USER IMPACT: settings UI shows "B" not "KeyB", "↑" not "ArrowUp" for keyboard shortcut labels
  describe('codeLabel', () => {
    const Label = () => blsi.ShortcutLabel;

    // OPTIMIZE: all 7 codeLabel tests below follow identical codeLabel(input) → expected pattern; convert to a single test.each table grouped by category
    // REDUNDANT: "letters: KeyA → A, KeyZ → Z" duplicates the pattern of the 6 tests below; only the input/expected pairs differ
    test('letters: KeyA → "A", KeyZ → "Z"', () => {
      expect(Label().codeLabel('KeyA')).toBe('A');
      expect(Label().codeLabel('KeyZ')).toBe('Z');
    });

    // REDUNDANT: same codeLabel mapping pattern as "letters" test above
    test('digits: Digit0 → "0", Digit9 → "9"', () => {
      expect(Label().codeLabel('Digit0')).toBe('0');
      expect(Label().codeLabel('Digit9')).toBe('9');
    });

    // REDUNDANT: same codeLabel mapping pattern as "letters" test above
    test('symbols: Minus, Equal, BracketLeft, Slash', () => {
      expect(Label().codeLabel('Minus')).toBe('-');
      expect(Label().codeLabel('Equal')).toBe('=');
      expect(Label().codeLabel('BracketLeft')).toBe('[');
      expect(Label().codeLabel('Slash')).toBe('/');
    });

    // REDUNDANT: same codeLabel mapping pattern as "letters" test above
    test('named keys: Enter, Escape, Tab, Space', () => {
      expect(Label().codeLabel('Enter')).toBe('Enter');
      expect(Label().codeLabel('Escape')).toBe('Esc');
      expect(Label().codeLabel('Tab')).toBe('Tab');
      expect(Label().codeLabel('Space')).toBe('Space');
    });

    // REDUNDANT: same codeLabel mapping pattern as "letters" test above
    test('arrow keys: Unicode glyphs', () => {
      expect(Label().codeLabel('ArrowUp')).toBe('↑');
      expect(Label().codeLabel('ArrowDown')).toBe('↓');
      expect(Label().codeLabel('ArrowLeft')).toBe('←');
      expect(Label().codeLabel('ArrowRight')).toBe('→');
    });

    // REDUNDANT: same codeLabel mapping pattern as "letters" test above
    test('function keys: F1..F12', () => {
      expect(Label().codeLabel('F1')).toBe('F1');
      expect(Label().codeLabel('F12')).toBe('F12');
    });

    // REDUNDANT: same codeLabel mapping pattern as "letters" test above
    test('numpad: NumpadEnter', () => {
      expect(Label().codeLabel('NumpadEnter')).toBe('Num⏎');
    });

    test('unknown code falls back to the code string', () => {
      expect(Label().codeLabel('MediaTrackNext')).toBe('MediaTrackNext');
    });
    // MISSING: only NumpadEnter is exercised from the numpad table; Numpad0-9, NumpadAdd, NumpadSubtract, NumpadMultiply, NumpadDivide, NumpadDecimal have no coverage
  });

  // USER IMPACT: Mac users see ⌘⇧⌥⌃ glyphs; Windows/Linux users see Ctrl/Shift/Alt/Win text in shortcut labels
  describe('modLabel and chord rendering — platform-aware', () => {
    // The IS_MAC flag is computed once at module load from navigator.platform.
    // jsdom's navigator.platform is usually "" or "MacIntel" depending on version;
    // we test the BRANCH that is active without forcing a reload.

    // MISSING: modLabel is only asserted toBeTruthy — no assertion on exact glyph (Mac) or exact spelled-out label (Windows)
    test('modLabel returns something for each core modifier', () => {
      const L = blsi.ShortcutLabel;
      expect(L.modLabel('Alt')).toBeTruthy();
      expect(L.modLabel('Control')).toBeTruthy();
      expect(L.modLabel('Shift')).toBeTruthy();
      expect(L.modLabel('Meta')).toBeTruthy();
    });

    // OPTIMIZE: "chordLabel Alt+Shift+B" and "chordLabel single modifier" below share the same platform-branch pattern; parameterize with test.each([chord, macExpected, winExpected])
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

    // REDUNDANT: same platform-branch structure as "chordLabel Alt+Shift+B" above; only chord differs
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
    // MISSING: no test that chordLabel mod display order is stable (sortModsForDisplay contract) — e.g. Ctrl before Shift before Alt on Windows
    // MISSING: no test for an unknown modifier string (e.g. 'Hyper') passed to modLabel() — fallback behavior undefined
  });

  // USER IMPACT: complete shortcut label (e.g. "Alt+Shift+B" or "⌥⇧B") renders correctly in settings panel and toast notifications
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

  // USER IMPACT: conflict detection in the shortcuts settings page correctly identifies duplicate bindings regardless of how the user entered the mod keys
  describe('chordKey — canonical form for conflict detection', () => {
    const L = () => blsi.ShortcutLabel;

    test('produces identical keys regardless of input mod order', () => {
      const a = L().chordKey({ code: 'KeyB', mods: ['Alt', 'Shift'] });
      const b = L().chordKey({ code: 'KeyB', mods: ['Shift', 'Alt'] });
      expect(a).toBe(b);
    });

    // OPTIMIZE: "distinguishes different codes" and "distinguishes different mod sets" both assert chordKey inequality; merge into one test.each([['different codes', chord1, chord2], ['different mods', chord3, chord4]])
    // REDUNDANT: "distinguishes different codes" and "distinguishes different mod sets" share identical assertion structure (not.toBe); only the input chords differ
    test('distinguishes different codes', () => {
      expect(L().chordKey({ code: 'KeyB', mods: ['Alt'] }))
        .not.toBe(L().chordKey({ code: 'KeyC', mods: ['Alt'] }));
    });

    // REDUNDANT: same not.toBe assertion pattern as "distinguishes different codes" above
    test('distinguishes different mod sets', () => {
      expect(L().chordKey({ code: 'KeyB', mods: ['Alt'] }))
        .not.toBe(L().chordKey({ code: 'KeyB', mods: ['Alt', 'Shift'] }));
    });

    test('format is "<sorted mods joined by +>|<code>"', () => {
      expect(L().chordKey({ code: 'KeyB', mods: ['Shift', 'Alt'] }))
        .toBe('Alt+Shift|KeyB');
    });
  });

  // USER IMPACT: multi-chord Gmail-style sequences (e.g. "g i") are compared canonically so duplicate bindings are detected in settings
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
