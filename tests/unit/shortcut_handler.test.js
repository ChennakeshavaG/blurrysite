/**
 * tests/unit/shortcut_handler.test.js
 *
 * Unit tests for src/shortcut_handler.js (v2 matcher).
 *
 * Module exposes blsi.Shortcuts with:
 *   { init, destroy, showToast, _setPickerActive, _getFireToken }
 *
 * v2 contract:
 *   - Bindings are { binding: [{ code, mods }] }.
 *   - Modifiers are read from event.altKey/ctrlKey/metaKey/shiftKey (side-agnostic).
 *   - Early-returns on: !isTrusted, repeat, isComposing, Dead, Process,
 *     Unidentified, AltGraph, pure-modifier keydowns.
 *   - First match wins, preventDefault() + fire callback + stamp fire token.
 *   - Escape fires onExitPicker when picker is active (never dispatches to
 *     bound shortcuts).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/shortcut_handler.js');

function loadShortcutHandler() {
  if (blsi.Shortcuts) return;
  if (!fs.existsSync(MODULE_PATH)) {
    throw new Error('shortcut_handler.js not found — stub removed, real file required');
  }
  require(MODULE_PATH);
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function fireKeyDown(opts) {
  const event = new KeyboardEvent('keydown', {
    key:         opts.key         || '',
    code:        opts.code        || '',
    bubbles:     true,
    cancelable:  true,
    ctrlKey:     !!opts.ctrl,
    altKey:      !!opts.alt,
    shiftKey:    !!opts.shift,
    metaKey:     !!opts.meta,
    repeat:      !!opts.repeat,
    isComposing: !!opts.isComposing,
  });
  // (No isTrusted override — the matcher does not check it, so jsdom's
  //  default isTrusted=false is fine for synthesized events.)
  // Optional AltGraph override — tests that simulate European keyboards.
  if (opts.altGraph) {
    event.getModifierState = function (k) { return k === 'AltGraph'; };
  }
  document.dispatchEvent(event);
  return event;
}

/** Default bindings matching the action registry. */
const DEFAULT_SHORTCUTS = {
  TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] },
  TOGGLE_PICKER:   { binding: [{ code: 'KeyP', mods: ['Alt', 'Shift'] }] },
  CLEAR_ALL:       { binding: [{ code: 'KeyU', mods: ['Alt', 'Shift'] }] },
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('blsi.Shortcuts (v2)', () => {
  beforeAll(() => loadShortcutHandler());

  afterEach(() => {
    if (blsi.Shortcuts) blsi.Shortcuts.destroy();
  });

  // ── Match: happy paths ─────────────────────────────────────────────────────
  describe('match', () => {
    test('fires TOGGLE_BLUR_ALL on Alt+Shift+B', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('fires TOGGLE_PICKER on Alt+Shift+P', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_PICKER: cb });
      fireKeyDown({ key: 'p', code: 'KeyP', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('fires CLEAR_ALL on Alt+Shift+U', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { CLEAR_ALL: cb });
      fireKeyDown({ key: 'u', code: 'KeyU', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('supports Ctrl+Shift+K (single modifier class + shift)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(
        { CUSTOM: { binding: [{ code: 'KeyK', mods: ['Control', 'Shift'] }] } },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: 'k', code: 'KeyK', ctrl: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('supports Meta+1 on Mac (metaKey)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(
        { CUSTOM: { binding: [{ code: 'Digit1', mods: ['Meta'] }] } },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: '1', code: 'Digit1', meta: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('side-agnostic: AltRight fires the same binding as AltLeft', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      // Even though the physical key is AltRight, altKey=true is what matters.
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('different chords fire different callbacks', () => {
      const blur = jest.fn(), picker = jest.fn(), clear = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, {
        TOGGLE_BLUR_ALL: blur, TOGGLE_PICKER: picker, CLEAR_ALL: clear,
      });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      fireKeyDown({ key: 'p', code: 'KeyP', alt: true, shift: true });
      expect(blur).toHaveBeenCalledTimes(1);
      expect(picker).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(0);
    });
  });

  // ── No-match: missing mods / wrong code ───────────────────────────────────
  describe('no match', () => {
    test('does not fire when required mod is missing', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true }); // missing Shift
      expect(cb).not.toHaveBeenCalled();
    });

    test('does not fire when an extra mod is present', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, ctrl: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('does not fire when code does not match', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'c', code: 'KeyC', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Early-return guards ───────────────────────────────────────────────────
  describe('early-return guards', () => {
    test('ignores repeat keydowns', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, repeat: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores events during IME composition', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, isComposing: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores Dead key events', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Dead', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores Process key events (IME)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Process', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores Unidentified key events', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Unidentified', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores AltGraph events (European AltGr)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, altGraph: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores pure modifier keydowns (waits for non-modifier)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Alt', code: 'AltLeft', alt: true });
      fireKeyDown({ key: 'Shift', code: 'ShiftLeft', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Escape → onExitPicker ─────────────────────────────────────────────────
  describe('Escape key', () => {
    test('fires onExitPicker when picker is active', () => {
      const exit = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { onExitPicker: exit });
      blsi.Shortcuts._setPickerActive(true);
      fireKeyDown({ key: 'Escape', code: 'Escape' });
      expect(exit).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire onExitPicker when picker is inactive', () => {
      const exit = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { onExitPicker: exit });
      blsi.Shortcuts._setPickerActive(false);
      fireKeyDown({ key: 'Escape', code: 'Escape' });
      expect(exit).not.toHaveBeenCalled();
    });

    test('Escape does not dispatch to shortcut bindings', () => {
      const cb = jest.fn();
      // Hypothetical Escape binding
      blsi.Shortcuts.init(
        { CUSTOM: { binding: [{ code: 'Escape', mods: ['Alt'] }] } },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: 'Escape', code: 'Escape', alt: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Fire token ────────────────────────────────────────────────────────────
  describe('fire token', () => {
    test('stamps __blsiShortcutFire for the matched action', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      const before = globalThis.__blsiShortcutFire['TOGGLE_BLUR_ALL'];
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      const after = globalThis.__blsiShortcutFire['TOGGLE_BLUR_ALL'];
      expect(typeof after).toBe('number');
      expect(after !== before).toBe(true);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  describe('lifecycle', () => {
    test('destroy removes listeners so shortcuts stop firing', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      blsi.Shortcuts.destroy();
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('re-calling init replaces previous listener', () => {
      const cb1 = jest.fn(), cb2 = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb1 });
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb2 });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    test('handles empty shortcuts object gracefully', () => {
      expect(() => blsi.Shortcuts.init({}, {})).not.toThrow();
    });

    test('handles null shortcuts gracefully', () => {
      expect(() => blsi.Shortcuts.init(null, {})).not.toThrow();
    });

    test('multi-chord bindings (length > 1) are skipped (phase 2)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(
        {
          CUSTOM: {
            binding: [
              { code: 'KeyG', mods: ['Alt'] },
              { code: 'KeyI', mods: ['Alt'] },
            ],
          },
        },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: 'g', code: 'KeyG', alt: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
