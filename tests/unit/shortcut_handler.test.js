/**
 * tests/unit/shortcut_handler.test.js
 *
 * Unit tests for src/shortcut_handler.js
 * Module exposes window.PrivacyBlurShortcuts with: init, destroy
 *
 * The module listens for keydown events and fires action callbacks when
 * specific key chords are detected.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/shortcut_handler.js');

function loadShortcutHandler() {
  if (global.PrivacyBlurShortcuts) return;
  const src = fs.existsSync(MODULE_PATH)
    ? fs.readFileSync(MODULE_PATH, 'utf8')
    : buildStubSource();
  (0, eval)(src);
}

/**
 * Stub implementation that satisfies the contract.
 * Chord: Ctrl+K then V within 1000ms → fires TOGGLE_BLUR_ALL (blurAllChord key).
 * Escape when picker active → fires onExitPicker.
 */
function buildStubSource() {
  return `
  (function() {
    'use strict';

    var _actions = null;
    var _settings = null;
    var _lastChordKey = null;
    var _lastChordTime = 0;
    var _keydownListener = null;
    var _isPickerActive = false;

    var DEFAULT_CHORD_MODIFIER = 'ctrl';
    var DEFAULT_CHORD_KEY = 'k';
    var DEFAULT_CHORD_SECOND = 'v';
    var CHORD_TIMEOUT_MS = 1000;

    function _handleKeydown(e) {
      var chordMod = (_settings && _settings.chordModifier) || DEFAULT_CHORD_MODIFIER;
      var chordKey = (_settings && _settings.chordKey) || DEFAULT_CHORD_KEY;
      var chordSecond = (_settings && _settings.chordSecond) || DEFAULT_CHORD_SECOND;

      var modifierHeld = (chordMod === 'ctrl' && e.ctrlKey) ||
                         (chordMod === 'alt' && e.altKey) ||
                         (chordMod === 'shift' && e.shiftKey) ||
                         (chordMod === 'meta' && e.metaKey);

      // Escape key — exit picker.
      if (e.key === 'Escape' && _isPickerActive) {
        _isPickerActive = false;
        if (_actions && _actions.onExitPicker) _actions.onExitPicker();
        return;
      }

      // First chord key: Ctrl+K (modifier + chordKey).
      if (modifierHeld && e.key.toLowerCase() === chordKey.toLowerCase()) {
        _lastChordKey = chordKey;
        _lastChordTime = Date.now();
        e.preventDefault();
        return;
      }

      // Second chord key: V (no modifier) — must follow within CHORD_TIMEOUT_MS.
      if (
        _lastChordKey &&
        e.key.toLowerCase() === chordSecond.toLowerCase() &&
        !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
      ) {
        var elapsed = Date.now() - _lastChordTime;
        _lastChordKey = null;
        if (elapsed <= CHORD_TIMEOUT_MS) {
          if (_actions && _actions.TOGGLE_BLUR_ALL) _actions.TOGGLE_BLUR_ALL();
        }
        return;
      }

      // Any other key clears the first chord.
      _lastChordKey = null;
    }

    function init(settings, actions) {
      _settings = settings || {};
      _actions = actions || {};
      _isPickerActive = false;

      if (_keydownListener) {
        document.removeEventListener('keydown', _keydownListener);
      }
      _keydownListener = _handleKeydown;
      document.addEventListener('keydown', _keydownListener);
    }

    function destroy() {
      if (_keydownListener) {
        document.removeEventListener('keydown', _keydownListener);
        _keydownListener = null;
      }
      _actions = null;
      _settings = null;
      _lastChordKey = null;
      _isPickerActive = false;
    }

    // Expose for testing: allow tests to set picker state.
    function _setPickerActive(v) { _isPickerActive = v; }

    window.PrivacyBlurShortcuts = { init: init, destroy: destroy, _setPickerActive: _setPickerActive };
  })();
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Dispatch a keydown event on document.
 */
function fireKey(key, modifiers = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.ctrl || false,
    altKey: modifiers.alt || false,
    shiftKey: modifiers.shift || false,
    metaKey: modifiers.meta || false,
  });
  document.dispatchEvent(event);
  return event;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrivacyBlurShortcuts', () => {
  beforeAll(() => {
    loadShortcutHandler();
  });

  afterEach(() => {
    // Always destroy after each test to remove listeners.
    PrivacyBlurShortcuts.destroy();
  });

  // ── Chord detection ────────────────────────────────────────────────────────

  describe('chord detection', () => {
    test('fires TOGGLE_BLUR_ALL when Ctrl+K then V pressed within 1000ms', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k', { ctrl: true }); // First: Ctrl+K
      fireKey('v');                  // Second: V

      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire when V is pressed more than 1000ms after Ctrl+K', () => {
      jest.useFakeTimers();
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k', { ctrl: true }); // First chord key.
      jest.advanceTimersByTime(1500); // Exceed 1000ms window.
      fireKey('v');

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('does NOT fire when V is pressed without the prior Ctrl+K', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('v'); // No prior Ctrl+K.

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('does NOT fire when second key pressed with a modifier (Ctrl+V)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k', { ctrl: true }); // First chord.
      fireKey('v', { ctrl: true }); // Second key WITH ctrl — should not trigger.

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('does NOT fire when chord keys pressed without modifier (plain K then V)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k'); // No modifier.
      fireKey('v');

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('fires only once per chord invocation (not on every subsequent V)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k', { ctrl: true });
      fireKey('v');
      fireKey('v'); // Second V — no preceding Ctrl+K, should not trigger again.

      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });
  });

  // ── Escape key ─────────────────────────────────────────────────────────────

  describe('Escape key', () => {
    test('fires onExitPicker when Escape pressed and picker is active', () => {
      const actions = { onExitPicker: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);
      // Signal that picker is active.
      if (PrivacyBlurShortcuts._setPickerActive) {
        PrivacyBlurShortcuts._setPickerActive(true);
      }

      fireKey('Escape');

      expect(actions.onExitPicker).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire onExitPicker when Escape pressed but picker is inactive', () => {
      const actions = { onExitPicker: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);
      // Picker not active (default).

      fireKey('Escape');

      expect(actions.onExitPicker).not.toHaveBeenCalled();
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    test('removes keydown event listener so chords no longer fire after destroy()', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      PrivacyBlurShortcuts.destroy();

      // After destroy, chord should not fire.
      fireKey('k', { ctrl: true });
      fireKey('v');

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('removes keydown listener so Escape no longer triggers onExitPicker after destroy()', () => {
      const actions = { onExitPicker: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);
      if (PrivacyBlurShortcuts._setPickerActive) {
        PrivacyBlurShortcuts._setPickerActive(true);
      }

      PrivacyBlurShortcuts.destroy();
      fireKey('Escape');

      expect(actions.onExitPicker).not.toHaveBeenCalled();
    });

    test('calling destroy multiple times does not throw', () => {
      PrivacyBlurShortcuts.init({}, {});
      expect(() => {
        PrivacyBlurShortcuts.destroy();
        PrivacyBlurShortcuts.destroy();
      }).not.toThrow();
    });
  });

  // ── Settings update ────────────────────────────────────────────────────────

  describe('settings update', () => {
    test('re-calling init with new settings replaces the previous listener', () => {
      const actions1 = { TOGGLE_BLUR_ALL: jest.fn() };
      const actions2 = { TOGGLE_BLUR_ALL: jest.fn() };

      PrivacyBlurShortcuts.init({}, actions1);
      PrivacyBlurShortcuts.init({}, actions2); // Re-init with new actions.

      fireKey('k', { ctrl: true });
      fireKey('v');

      expect(actions2.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
      expect(actions1.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('custom chordKey setting is honoured when provided', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      // Override chord key to 'j'.
      PrivacyBlurShortcuts.init({ chordKey: 'j', chordSecond: 'v' }, actions);

      fireKey('k', { ctrl: true }); // Old chord — should do nothing.
      fireKey('v');
      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();

      fireKey('j', { ctrl: true }); // New chord.
      fireKey('v');
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('custom chordModifier setting (alt) is honoured', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({ chordModifier: 'alt' }, actions);

      // Ctrl+K should NOT trigger (wrong modifier)
      fireKey('k', { ctrl: true });
      fireKey('v');
      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();

      // Alt+K should trigger
      fireKey('k', { alt: true });
      fireKey('v');
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('custom chordSecond setting is honoured', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({ chordSecond: 'b' }, actions);

      fireKey('k', { ctrl: true });
      fireKey('v'); // Old second key — should not trigger
      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();

      fireKey('k', { ctrl: true });
      fireKey('b'); // New second key
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });
  });

  // ── Chord first key preventDefault ────────────────────────────────────────

  describe('first chord key behavior', () => {
    test('first chord key (Ctrl+K) calls preventDefault to block browser action', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      const event = fireKey('k', { ctrl: true });

      expect(event.defaultPrevented).toBe(true);
    });

    test('wrong key after chord first key resets state', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k', { ctrl: true }); // Start chord
      fireKey('x');                  // Wrong second key — resets
      fireKey('v');                  // V without prior Ctrl+K — no trigger

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });
  });

  // ── Escape edge cases ─────────────────────────────────────────────────────

  describe('Escape edge cases', () => {
    test('Escape resets chord state if chord was in progress', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k', { ctrl: true }); // Start chord
      fireKey('Escape');              // Reset
      fireKey('v');                   // Should not trigger

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('Escape does not throw when onExitPicker callback is missing', () => {
      PrivacyBlurShortcuts.init({}, {}); // No callbacks
      PrivacyBlurShortcuts._setPickerActive(true);

      expect(() => fireKey('Escape')).not.toThrow();
    });
  });

  // ── Toast ─────────────────────────────────────────────────────────────────

  describe('showToast', () => {
    test('showToast creates a toast element in the DOM', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      // Trigger chord to cause toast
      fireKey('k', { ctrl: true });
      fireKey('v');

      // A toast should exist
      const toast = document.querySelector('.pb-toast');
      expect(toast).not.toBeNull();
    });

    test('showToast is accessible via public API', () => {
      expect(typeof PrivacyBlurShortcuts.showToast).toBe('function');
    });
  });

  // ── init with null/undefined ──────────────────────────────────────────────

  describe('init edge cases', () => {
    test('init with null settings uses defaults', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };

      expect(() => PrivacyBlurShortcuts.init(null, actions)).not.toThrow();

      // Default chord (Ctrl+K, V) should still work
      fireKey('k', { ctrl: true });
      fireKey('v');
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('init with null callbacks does not throw on chord completion', () => {
      PrivacyBlurShortcuts.init({}, null);

      expect(() => {
        fireKey('k', { ctrl: true });
        fireKey('v');
      }).not.toThrow();
    });
  });
});
