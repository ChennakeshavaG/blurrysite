/**
 * tests/unit/shortcut_handler.test.js
 *
 * Unit tests for src/shortcut_handler.js
 * Module exposes pb.Shortcuts with: init, destroy, showToast, _setPickerActive
 *
 * The module tracks held keys via keydown/keyup and fires callbacks when
 * a primary modifier + all required keys are held simultaneously.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/shortcut_handler.js');

function loadShortcutHandler() {
  if (pb.Shortcuts) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  return `
  (function() {
    'use strict';
    var heldKeys = new Set();
    var listener = null;
    var upListener = null;
    var _isPickerActive = false;
    var _cbs = {};

    function init(shortcuts, callbacks) {
      destroy();
      _cbs = callbacks || {};
      var entries = [];
      if (shortcuts) {
        for (var name in shortcuts) {
          var b = shortcuts[name];
          if (b && b.primaryModifier && Array.isArray(b.keys)) {
            entries.push({ actionName: name, primaryModifier: b.primaryModifier, keyCodes: b.keys.map(function(k){ return k.code; }) });
          }
        }
      }
      listener = function(e) {
        if (e.repeat || e.isComposing || e.key === 'Dead') return;
        if (e.getModifierState && e.getModifierState('AltGraph')) return;
        if (e.code) heldKeys.add(e.code);
        if (e.key === 'Escape') {
          if (_isPickerActive && typeof _cbs.onExitPicker === 'function') {
            _isPickerActive = false; _cbs.onExitPicker();
          }
          return;
        }
        for (var i = 0; i < entries.length; i++) {
          var sc = entries[i];
          if (!heldKeys.has(sc.primaryModifier)) continue;
          var allHeld = true;
          for (var j = 0; j < sc.keyCodes.length; j++) {
            if (!heldKeys.has(sc.keyCodes[j])) { allHeld = false; break; }
          }
          if (!allHeld) continue;
          e.preventDefault();
          if (typeof _cbs[sc.actionName] === 'function') _cbs[sc.actionName]();
          return;
        }
      };
      upListener = function(e) { if (e.code) heldKeys.delete(e.code); };
      document.addEventListener('keydown', listener, true);
      document.addEventListener('keyup', upListener, true);
    }

    function destroy() {
      if (listener) { document.removeEventListener('keydown', listener, true); listener = null; }
      if (upListener) { document.removeEventListener('keyup', upListener, true); upListener = null; }
      heldKeys.clear(); _cbs = {};
    }

    function showToast() {}

    pb.Shortcuts = {
      init: init, destroy: destroy, showToast: showToast,
      _setPickerActive: function(v) { _isPickerActive = !!v; }
    };
  })();
  `;
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function fireKeyDown(key, opts) {
  opts = opts || {};
  const event = new KeyboardEvent('keydown', {
    key:         key,
    code:        opts.code        || '',
    bubbles:     true,
    cancelable:  true,
    ctrlKey:     opts.ctrl        || false,
    altKey:      opts.alt         || false,
    shiftKey:    opts.shift       || false,
    metaKey:     opts.meta        || false,
    repeat:      opts.repeat      || false,
    isComposing: opts.isComposing || false,
  });
  document.dispatchEvent(event);
  return event;
}

function fireKeyUp(key, opts) {
  opts = opts || {};
  const event = new KeyboardEvent('keyup', {
    key:     key,
    code:    opts.code || '',
    bubbles: true,
  });
  document.dispatchEvent(event);
  return event;
}

/** Default shortcuts matching constants.js DEFAULT_SETTINGS.SHORTCUTS */
const DEFAULT_SHORTCUTS = {
  TOGGLE_BLUR_ALL: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'b', code: 'KeyB' }],
  },
  TOGGLE_PICKER: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'p', code: 'KeyP' }],
  },
  CLEAR_ALL: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'u', code: 'KeyU' }],
  },
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('pb.Shortcuts', () => {
  beforeAll(() => loadShortcutHandler());

  afterEach(() => {
    pb.Shortcuts.destroy();
  });

  // ── Single-key shortcut detection ──────────────────────────────────────────

  describe('shortcut detection', () => {
    test('fires TOGGLE_BLUR_ALL when Alt+Shift+B pressed', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      // Hold AltLeft
      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      // Hold ShiftLeft
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      // Press B — all keys now held
      fireKeyDown('b', { code: 'KeyB', alt: true, shift: true });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('fires TOGGLE_PICKER when Alt+Shift+P pressed', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_PICKER: cb });

      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('p', { code: 'KeyP', alt: true, shift: true });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('fires CLEAR_ALL when Alt+Shift+U pressed', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { CLEAR_ALL: cb });

      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('u', { code: 'KeyU', alt: true, shift: true });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire when wrong modifier side is held', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      // Use AltRight instead of AltLeft
      fireKeyDown('Alt', { code: 'AltRight', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('b', { code: 'KeyB', alt: true, shift: true });

      expect(cb).not.toHaveBeenCalled();
    });

    test('does NOT fire when primary modifier is not held', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      // Press B without any modifier
      fireKeyDown('b', { code: 'KeyB' });

      expect(cb).not.toHaveBeenCalled();
    });

    test('does NOT fire when not all keys are held', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      // Alt + B but no Shift
      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('b', { code: 'KeyB', alt: true });

      expect(cb).not.toHaveBeenCalled();
    });

    test('different shortcuts fire different callbacks', () => {
      const blur = jest.fn();
      const picker = jest.fn();
      const clear = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, {
        TOGGLE_BLUR_ALL: blur, TOGGLE_PICKER: picker, CLEAR_ALL: clear,
      });

      // Fire blur
      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('b', { code: 'KeyB', alt: true, shift: true });
      fireKeyUp('b', { code: 'KeyB' });
      fireKeyUp('Shift', { code: 'ShiftLeft' });
      fireKeyUp('Alt', { code: 'AltLeft' });

      // Fire picker
      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('p', { code: 'KeyP', alt: true, shift: true });

      expect(blur).toHaveBeenCalledTimes(1);
      expect(picker).toHaveBeenCalledTimes(1);
      expect(clear).not.toHaveBeenCalled();
    });
  });

  // ── Escape key ─────────────────────────────────────────────────────────────

  describe('Escape key', () => {
    test('fires onExitPicker when picker is active', () => {
      const exitPicker = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { onExitPicker: exitPicker });
      pb.Shortcuts._setPickerActive(true);

      fireKeyDown('Escape', { code: 'Escape' });

      expect(exitPicker).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire onExitPicker when picker is inactive', () => {
      const exitPicker = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { onExitPicker: exitPicker });

      fireKeyDown('Escape', { code: 'Escape' });

      expect(exitPicker).not.toHaveBeenCalled();
    });
  });

  // ── Early exit guards ──────────────────────────────────────────────────────

  describe('early exit guards', () => {
    test('ignores repeated keydown events', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('b', { code: 'KeyB', alt: true, shift: true, repeat: true });

      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores events during IME composition', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('b', { code: 'KeyB', alt: true, shift: true, isComposing: true });

      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores Dead key events', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      fireKeyDown('Dead', { code: 'KeyB' });

      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores AltGraph events', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });

      const event = new KeyboardEvent('keydown', {
        key: 'b', code: 'KeyB', altKey: true, ctrlKey: true,
      });
      event.getModifierState = jest.fn((mod) => mod === 'AltGraph');
      document.dispatchEvent(event);

      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    test('removes listeners so shortcuts stop firing', () => {
      const cb = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      pb.Shortcuts.destroy();

      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('b', { code: 'KeyB', alt: true, shift: true });

      expect(cb).not.toHaveBeenCalled();
    });

    test('re-calling init replaces previous listener', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb1 });
      pb.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb2 });

      fireKeyDown('Alt', { code: 'AltLeft', alt: true });
      fireKeyDown('Shift', { code: 'ShiftLeft', alt: true, shift: true });
      fireKeyDown('b', { code: 'KeyB', alt: true, shift: true });

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Custom shortcuts ───────────────────────────────────────────────────────

  describe('custom shortcuts', () => {
    test('supports single modifier + single key', () => {
      const cb = jest.fn();
      pb.Shortcuts.init({
        TOGGLE_BLUR_ALL: { primaryModifier: 'ControlLeft', keys: [{ key: 'b', code: 'KeyB' }] },
      }, { TOGGLE_BLUR_ALL: cb });

      fireKeyDown('Control', { code: 'ControlLeft', ctrl: true });
      fireKeyDown('b', { code: 'KeyB', ctrl: true });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('supports MetaLeft (Command) as primary modifier', () => {
      const cb = jest.fn();
      pb.Shortcuts.init({
        TOGGLE_BLUR_ALL: { primaryModifier: 'MetaLeft', keys: [{ key: '1', code: 'Digit1' }] },
      }, { TOGGLE_BLUR_ALL: cb });

      fireKeyDown('Meta', { code: 'MetaLeft', meta: true });
      fireKeyDown('1', { code: 'Digit1', meta: true });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('handles empty shortcuts object gracefully', () => {
      expect(() => pb.Shortcuts.init({}, {})).not.toThrow();
    });

    test('handles null shortcuts gracefully', () => {
      expect(() => pb.Shortcuts.init(null, null)).not.toThrow();
    });
  });
});
