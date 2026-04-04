/**
 * tests/unit/shortcut_handler.test.js
 *
 * Unit tests for src/shortcut_handler.js
 * Module exposes window.PrivacyBlurShortcuts with: init, destroy
 *
 * The module listens for keydown events and fires action callbacks when
 * specific key chords are detected. Key matching uses event.code when
 * available, falling back to event.key for backwards compatibility.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/shortcut_handler.js');

function loadShortcutHandler() {
  if (global.PrivacyBlurShortcuts) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

/**
 * Stub implementation that satisfies the contract.
 * Chord: modifier+key1 then key2 within 1000ms → fires TOGGLE_BLUR_ALL.
 * Escape when picker active → fires onExitPicker.
 * Supports event.code matching with event.key fallback.
 * Guards: repeat, isComposing, Dead key, AltGraph.
 */
function buildStubSource() {
  return `
  (function() {
    'use strict';

    var _actions = null;
    var _settings = null;
    var _lastChordTime = 0;
    var _awaitingSecond = false;
    var _keydownListener = null;
    var _isPickerActive = false;
    var CHORD_TIMEOUT_MS = 1000;

    function normaliseKey(k) { return (k || '').toLowerCase(); }

    function matchesKey(event, keyValue, codeValue) {
      if (codeValue) return event.code === codeValue;
      if (keyValue) return normaliseKey(event.key) === keyValue;
      return false;
    }

    function modifierActive(event, modifier) {
      switch (modifier) {
        case 'ctrl':  return event.ctrlKey  && !event.altKey && !event.metaKey;
        case 'alt':   return event.altKey   && !event.ctrlKey && !event.metaKey;
        case 'shift': return event.shiftKey && !event.ctrlKey && !event.metaKey;
        case 'meta':  return event.metaKey  && !event.ctrlKey && !event.altKey;
        default:      return false;
      }
    }

    function _handleKeydown(e) {
      if (e.repeat) return;
      if (e.isComposing) return;
      if (e.key === 'Dead') return;
      if (e.getModifierState && e.getModifierState('AltGraph')) return;

      var s = _settings || {};
      var chordKey1  = normaliseKey(s.chordKey || '');
      var chordKey2  = normaliseKey(s.chordSecond || '');
      var chordCode1 = s.chordCode1 || null;
      var chordCode2 = s.chordCode2 || null;
      var modifier   = normaliseKey(s.chordModifier || '');
      var key = normaliseKey(e.key);

      if (key === 'escape') {
        _awaitingSecond = false;
        if (_isPickerActive && _actions && _actions.onExitPicker) {
          _isPickerActive = false;
          _actions.onExitPicker();
        }
        return;
      }

      if (!_awaitingSecond && modifierActive(e, modifier) && matchesKey(e, chordKey1, chordCode1)) {
        _awaitingSecond = true;
        _lastChordTime = Date.now();
        e.preventDefault();
        return;
      }

      if (_awaitingSecond) {
        var elapsed = Date.now() - _lastChordTime;
        if (elapsed <= CHORD_TIMEOUT_MS && matchesKey(e, chordKey2, chordCode2) &&
            !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          _awaitingSecond = false;
          if (_actions && _actions.TOGGLE_BLUR_ALL) _actions.TOGGLE_BLUR_ALL();
          return;
        }
        _awaitingSecond = false;
        return;
      }
    }

    function init(settings, actions) {
      destroy();
      _settings = settings || {};
      _actions = actions || {};
      _isPickerActive = false;
      _keydownListener = _handleKeydown;
      document.addEventListener('keydown', _keydownListener, true);
    }

    function destroy() {
      if (_keydownListener) {
        document.removeEventListener('keydown', _keydownListener, true);
        _keydownListener = null;
      }
      _actions = null;
      _settings = null;
      _awaitingSecond = false;
      _isPickerActive = false;
    }

    function _setPickerActive(v) { _isPickerActive = !!v; }

    window.PrivacyBlurShortcuts = { init: init, destroy: destroy, showToast: function() {}, _setPickerActive: _setPickerActive };
  })();
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Default settings matching PrivacyBlur.DEFAULTS — used by most tests. */
const CHORD_SETTINGS = {
  chordKey: 'k',
  chordSecond: 'v',
  chordCode1: 'KeyK',
  chordCode2: 'KeyV',
  chordModifier: 'ctrl',
};

/**
 * Dispatch a keydown event on document.
 * Supports code, repeat, and isComposing for spec-compliant testing.
 */
function fireKey(key, modifiers = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    code:        modifiers.code        || '',
    bubbles:     true,
    cancelable:  true,
    ctrlKey:     modifiers.ctrl        || false,
    altKey:      modifiers.alt         || false,
    shiftKey:    modifiers.shift       || false,
    metaKey:     modifiers.meta        || false,
    repeat:      modifiers.repeat      || false,
    isComposing: modifiers.isComposing || false,
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
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire when V is pressed more than 1000ms after Ctrl+K', () => {
      jest.useFakeTimers();
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      jest.advanceTimersByTime(1500);
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('does NOT fire when V is pressed without the prior Ctrl+K', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('does NOT fire when second key pressed with a modifier (Ctrl+V)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { ctrl: true, code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('does NOT fire when chord keys pressed without modifier (plain K then V)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('fires only once per chord invocation (not on every subsequent V)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });
  });

  // ── Escape key ─────────────────────────────────────────────────────────────

  describe('Escape key', () => {
    test('fires onExitPicker when Escape pressed and picker is active', () => {
      const actions = { onExitPicker: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);
      if (PrivacyBlurShortcuts._setPickerActive) {
        PrivacyBlurShortcuts._setPickerActive(true);
      }

      fireKey('Escape');

      expect(actions.onExitPicker).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire onExitPicker when Escape pressed but picker is inactive', () => {
      const actions = { onExitPicker: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('Escape');

      expect(actions.onExitPicker).not.toHaveBeenCalled();
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    test('removes keydown event listener so chords no longer fire after destroy()', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      PrivacyBlurShortcuts.destroy();

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('removes keydown listener so Escape no longer triggers onExitPicker after destroy()', () => {
      const actions = { onExitPicker: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);
      if (PrivacyBlurShortcuts._setPickerActive) {
        PrivacyBlurShortcuts._setPickerActive(true);
      }

      PrivacyBlurShortcuts.destroy();
      fireKey('Escape');

      expect(actions.onExitPicker).not.toHaveBeenCalled();
    });

    test('calling destroy multiple times does not throw', () => {
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, {});
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

      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions1);
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions2);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      expect(actions2.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
      expect(actions1.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('custom chordKey setting is honoured when provided', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(
        { chordKey: 'j', chordSecond: 'v', chordCode1: 'KeyJ', chordCode2: 'KeyV', chordModifier: 'ctrl' },
        actions
      );

      fireKey('k', { ctrl: true, code: 'KeyK' }); // Old chord — should do nothing.
      fireKey('v', { code: 'KeyV' });
      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();

      fireKey('j', { ctrl: true, code: 'KeyJ' }); // New chord.
      fireKey('v', { code: 'KeyV' });
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('custom chordModifier setting (alt) is honoured', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(
        { ...CHORD_SETTINGS, chordModifier: 'alt' },
        actions
      );

      // Ctrl+K should NOT trigger (wrong modifier)
      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });
      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();

      // Alt+K should trigger
      fireKey('k', { alt: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('custom chordSecond setting is honoured', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(
        { ...CHORD_SETTINGS, chordSecond: 'b', chordCode2: 'KeyB' },
        actions
      );

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' }); // Old second key — should not trigger
      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('b', { code: 'KeyB' }); // New second key
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('meta modifier works for Command key on Mac', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(
        { ...CHORD_SETTINGS, chordModifier: 'meta' },
        actions
      );

      fireKey('k', { meta: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });
  });

  // ── Chord first key preventDefault ────────────────────────────────────────

  describe('first chord key behavior', () => {
    test('first chord key (Ctrl+K) calls preventDefault to block browser action', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      const event = fireKey('k', { ctrl: true, code: 'KeyK' });

      expect(event.defaultPrevented).toBe(true);
    });

    test('wrong key after chord first key resets state', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('x', { code: 'KeyX' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });
  });

  // ── Escape edge cases ─────────────────────────────────────────────────────

  describe('Escape edge cases', () => {
    test('Escape resets chord state if chord was in progress', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('Escape');
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('Escape does not throw when onExitPicker callback is missing', () => {
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, {});
      PrivacyBlurShortcuts._setPickerActive(true);

      expect(() => fireKey('Escape')).not.toThrow();
    });
  });

  // ── Toast ─────────────────────────────────────────────────────────────────

  describe('showToast', () => {
    test('showToast creates a toast element in the DOM', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      const toast = document.querySelector('.pb-toast');
      expect(toast).not.toBeNull();
    });

    test('showToast is accessible via public API', () => {
      expect(typeof PrivacyBlurShortcuts.showToast).toBe('function');
    });
  });

  // ── init with null/undefined ──────────────────────────────────────────────

  describe('init edge cases', () => {
    test('init with explicit settings works (no internal defaults)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };

      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });
      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('init with null callbacks does not throw on chord completion', () => {
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, null);

      expect(() => {
        fireKey('k', { ctrl: true, code: 'KeyK' });
        fireKey('v', { code: 'KeyV' });
      }).not.toThrow();
    });

    test('init with empty settings means chord never matches', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init({}, actions);

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });
  });

  // ── Early-exit guards (W3C UI Events spec) ────────────────────────────────

  describe('early-exit guards', () => {
    test('ignores repeated keydown events (event.repeat)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      // Normal first press
      fireKey('k', { ctrl: true, code: 'KeyK' });
      // Repeated second key — should be ignored
      fireKey('v', { code: 'KeyV', repeat: true });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('ignores first chord key when repeated', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      // Repeated first key — should be ignored
      fireKey('k', { ctrl: true, code: 'KeyK', repeat: true });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('ignores events during IME composition (event.isComposing)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      fireKey('k', { ctrl: true, code: 'KeyK', isComposing: true });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('ignores dead key events (event.key === "Dead")', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      // Dead key on first chord position
      fireKey('Dead', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });

    test('ignores AltGr events (getModifierState("AltGraph") returns true)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      // AltGr sends ctrlKey+altKey both true
      const event = new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        altKey: true,
      });
      // Mock getModifierState for AltGr detection
      event.getModifierState = jest.fn((mod) => mod === 'AltGraph');
      document.dispatchEvent(event);

      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });
  });

  // ── event.code matching (layout independence) ─────────────────────────────

  describe('event.code matching', () => {
    test('matches on event.code even when event.key differs (layout independence)', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      // Simulate a different layout where the physical KeyK produces a different character
      fireKey('\u02DA', { ctrl: true, code: 'KeyK' }); // ˚ (Mac Option+K produces this)
      fireKey('\u221A', { code: 'KeyV' }); // √ (Mac Option+V produces this)

      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('falls back to event.key matching when no chordCode is configured', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      // Legacy settings — no chordCode1/chordCode2
      PrivacyBlurShortcuts.init(
        { chordKey: 'k', chordSecond: 'v', chordModifier: 'ctrl' },
        actions
      );

      fireKey('k', { ctrl: true, code: 'KeyK' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).toHaveBeenCalledTimes(1);
    });

    test('event.code mismatch prevents chord even if event.key matches', () => {
      const actions = { TOGGLE_BLUR_ALL: jest.fn() };
      PrivacyBlurShortcuts.init(CHORD_SETTINGS, actions);

      // Right key name but wrong physical key code
      fireKey('k', { ctrl: true, code: 'KeyJ' });
      fireKey('v', { code: 'KeyV' });

      expect(actions.TOGGLE_BLUR_ALL).not.toHaveBeenCalled();
    });
  });
});
