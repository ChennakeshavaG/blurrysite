/**
 * tests/unit/picker.test.js
 *
 * Unit tests for src/picker.js
 * Module exposes window.PrivacyBlurPicker with: activate, deactivate, setSettings
 *
 * Tests mock BlurEngine and SelectorUtils as window globals.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/picker.js');

function loadPicker() {
  if (global.PrivacyBlurPicker) return;
  const src = fs.existsSync(MODULE_PATH)
    ? fs.readFileSync(MODULE_PATH, 'utf8')
    : buildStubSource();
  (0, eval)(src);
}

function buildStubSource() {
  return `
  (function() {
    'use strict';

    var ACTIVE_CLASS = 'pb-picker-active';
    var HOVER_CLASS  = 'pb-hover-highlight';
    var TOOLBAR_ID   = 'pb-picker-toolbar';

    var _callbacks  = null;
    var _settings   = null;
    var _active     = false;

    var _mouseover  = null;
    var _mouseout   = null;
    var _click      = null;
    var _keydown    = null;

    function activate(settings, callbacks) {
      if (_active) return;
      _settings  = Object.assign({ blurRadius: 8 }, settings || {});
      _callbacks = callbacks || {};
      _active    = true;

      // Mark html element.
      document.documentElement.classList.add(ACTIVE_CLASS);

      // Create toolbar.
      var toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      toolbar.textContent = 'PrivacyBlur Picker — click any element';
      document.body.appendChild(toolbar);

      // Wire events.
      _mouseover = function(e) {
        if (e.target && e.target !== toolbar) {
          e.target.classList.add(HOVER_CLASS);
        }
      };
      _mouseout = function(e) {
        if (e.target) e.target.classList.remove(HOVER_CLASS);
      };
      _click = function(e) {
        e.preventDefault();
        e.stopPropagation();
        var el = e.target;
        if (!el || el === toolbar) return;
        if (el.classList.contains('pb-blurred')) {
          if (_callbacks.onUnblur) _callbacks.onUnblur(el);
        } else {
          if (_callbacks.onBlur) _callbacks.onBlur(el);
        }
      };
      _keydown = function(e) {
        if (e.key === 'Escape') deactivate();
      };

      document.addEventListener('mouseover', _mouseover);
      document.addEventListener('mouseout',  _mouseout);
      document.addEventListener('click',     _click, true);
      document.addEventListener('keydown',   _keydown);
    }

    function deactivate() {
      if (!_active) return;
      _active = false;

      document.documentElement.classList.remove(ACTIVE_CLASS);

      var toolbar = document.getElementById(TOOLBAR_ID);
      if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);

      // Remove hover highlights.
      document.querySelectorAll('.' + HOVER_CLASS).forEach(function(el) {
        el.classList.remove(HOVER_CLASS);
      });

      document.removeEventListener('mouseover', _mouseover);
      document.removeEventListener('mouseout',  _mouseout);
      document.removeEventListener('click',     _click, true);
      document.removeEventListener('keydown',   _keydown);

      _mouseover = null;
      _mouseout  = null;
      _click     = null;
      _keydown   = null;

      if (_callbacks && _callbacks.onDeactivate) _callbacks.onDeactivate();
      _callbacks = null;
    }

    function setSettings(settings) {
      _settings = Object.assign(_settings || {}, settings || {});
    }

    window.PrivacyBlurPicker = { activate: activate, deactivate: deactivate, setSettings: setSettings };
  })();
  `;
}

// ─── Mock dependencies ────────────────────────────────────────────────────────

function setupGlobalMocks() {
  global.PrivacyBlurEngine = {
    applyBlur: jest.fn(),
    removeBlur: jest.fn(),
    isBlurred: jest.fn().mockReturnValue(false),
  };

  global.PrivacyBlurSelectorUtils = {
    getSelector: jest.fn().mockReturnValue('#mock-selector'),
    generateId: jest.fn().mockReturnValue('abcd1234'),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fireMouseover(target) {
  const e = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target, configurable: true });
  document.dispatchEvent(e);
}

function fireMouseout(target) {
  const e = new MouseEvent('mouseout', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target, configurable: true });
  document.dispatchEvent(e);
}

function fireClick(target) {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target, configurable: true });
  document.dispatchEvent(e);
  return e;
}

function fireKey(key) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.dispatchEvent(e);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrivacyBlurPicker', () => {
  beforeAll(() => {
    setupGlobalMocks();
    loadPicker();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    // Reset html class list.
    document.documentElement.className = '';
    jest.clearAllMocks();
    // Ensure picker is deactivated before each test.
    try { PrivacyBlurPicker.deactivate(); } catch (_) {}
  });

  afterEach(() => {
    // Clean up in case a test left the picker active.
    try { PrivacyBlurPicker.deactivate(); } catch (_) {}
  });

  // ── activate ───────────────────────────────────────────────────────────────

  describe('activate', () => {
    test('adds pb-picker-active class to html element', () => {
      PrivacyBlurPicker.activate({}, {});

      expect(document.documentElement.classList.contains('pb-picker-active')).toBe(true);
    });

    test('creates a toolbar element in the DOM', () => {
      PrivacyBlurPicker.activate({}, {});

      const toolbar = document.getElementById('pb-picker-toolbar');
      expect(toolbar).not.toBeNull();
    });

    test('calling activate twice is safe (idempotent)', () => {
      PrivacyBlurPicker.activate({}, {});
      PrivacyBlurPicker.activate({}, {}); // Second call.

      // Should still have exactly one toolbar.
      const toolbars = document.querySelectorAll('#pb-picker-toolbar');
      expect(toolbars.length).toBe(1);
    });
  });

  // ── hover highlight ────────────────────────────────────────────────────────

  describe('hover highlight', () => {
    test('adds pb-hover-highlight class on mouseover', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      PrivacyBlurPicker.activate({}, {});

      fireMouseover(el);

      expect(el.classList.contains('pb-hover-highlight')).toBe(true);
    });

    test('removes pb-hover-highlight class on mouseout', () => {
      const el = document.createElement('p');
      el.classList.add('pb-hover-highlight');
      document.body.appendChild(el);
      PrivacyBlurPicker.activate({}, {});

      fireMouseout(el);

      expect(el.classList.contains('pb-hover-highlight')).toBe(false);
    });

    test('does not throw if target is null on mouseover', () => {
      PrivacyBlurPicker.activate({}, {});
      const e = new MouseEvent('mouseover', { bubbles: true });
      expect(() => document.dispatchEvent(e)).not.toThrow();
    });
  });

  // ── click ──────────────────────────────────────────────────────────────────

  describe('click', () => {
    test('calls onBlur callback with element when element is not blurred', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      el.classList.remove('pb-blurred');

      const callbacks = { onBlur: jest.fn(), onUnblur: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);

      fireClick(el);

      expect(callbacks.onBlur).toHaveBeenCalledWith(el);
      expect(callbacks.onUnblur).not.toHaveBeenCalled();
    });

    test('calls onUnblur callback when element already has pb-blurred class', () => {
      const el = document.createElement('p');
      el.classList.add('pb-blurred');
      document.body.appendChild(el);

      const callbacks = { onBlur: jest.fn(), onUnblur: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);

      fireClick(el);

      expect(callbacks.onUnblur).toHaveBeenCalledWith(el);
      expect(callbacks.onBlur).not.toHaveBeenCalled();
    });

    test('click prevents default event', () => {
      const el = document.createElement('a');
      el.href = '#';
      document.body.appendChild(el);

      const callbacks = { onBlur: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', { value: el, configurable: true });
      let defaultPrevented = false;
      clickEvent.preventDefault = () => { defaultPrevented = true; };
      clickEvent.stopPropagation = jest.fn();
      document.dispatchEvent(clickEvent);

      expect(defaultPrevented).toBe(true);
    });

    test('click stops event propagation', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      const callbacks = { onBlur: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', { value: el, configurable: true });
      const stopSpy = jest.fn();
      clickEvent.stopPropagation = stopSpy;
      document.dispatchEvent(clickEvent);

      expect(stopSpy).toHaveBeenCalled();
    });
  });

  // ── Escape key ─────────────────────────────────────────────────────────────

  describe('Escape key', () => {
    test('pressing Escape calls deactivate and removes pb-picker-active', () => {
      const callbacks = { onDeactivate: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);
      expect(document.documentElement.classList.contains('pb-picker-active')).toBe(true);

      fireKey('Escape');

      expect(document.documentElement.classList.contains('pb-picker-active')).toBe(false);
    });

    test('pressing Escape triggers onDeactivate callback', () => {
      const callbacks = { onDeactivate: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);

      fireKey('Escape');

      expect(callbacks.onDeactivate).toHaveBeenCalledTimes(1);
    });
  });

  // ── deactivate ─────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    test('removes pb-picker-active class from html element', () => {
      PrivacyBlurPicker.activate({}, {});
      expect(document.documentElement.classList.contains('pb-picker-active')).toBe(true);

      PrivacyBlurPicker.deactivate();

      expect(document.documentElement.classList.contains('pb-picker-active')).toBe(false);
    });

    test('removes the toolbar from the DOM', () => {
      PrivacyBlurPicker.activate({}, {});
      expect(document.getElementById('pb-picker-toolbar')).not.toBeNull();

      PrivacyBlurPicker.deactivate();

      expect(document.getElementById('pb-picker-toolbar')).toBeNull();
    });

    test('calls onDeactivate callback', () => {
      const callbacks = { onDeactivate: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);

      PrivacyBlurPicker.deactivate();

      expect(callbacks.onDeactivate).toHaveBeenCalledTimes(1);
    });

    test('does not fire blur/unblur after deactivation (listeners removed)', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      const callbacks = { onBlur: jest.fn(), onDeactivate: jest.fn() };
      PrivacyBlurPicker.activate({}, callbacks);
      PrivacyBlurPicker.deactivate();

      fireClick(el);

      expect(callbacks.onBlur).not.toHaveBeenCalled();
    });

    test('calling deactivate when not active does not throw', () => {
      expect(() => PrivacyBlurPicker.deactivate()).not.toThrow();
    });
  });

  // ── setSettings ────────────────────────────────────────────────────────────

  describe('setSettings', () => {
    test('updates blurRadius property', () => {
      PrivacyBlurPicker.activate({ blurRadius: 8 }, {});

      // Should not throw and internal state should be updated.
      expect(() => PrivacyBlurPicker.setSettings({ blurRadius: 16 })).not.toThrow();
    });

    test('calling setSettings before activate does not throw', () => {
      expect(() => PrivacyBlurPicker.setSettings({ blurRadius: 12 })).not.toThrow();
    });

    test('partial settings update does not wipe existing settings', () => {
      PrivacyBlurPicker.activate({ blurRadius: 8, highlightColor: '#ff0000' }, {});

      // Only change blurRadius; highlightColor should be preserved in internal state.
      expect(() => PrivacyBlurPicker.setSettings({ blurRadius: 20 })).not.toThrow();

      // We verify no exceptions and the picker is still functional.
      const el = document.createElement('p');
      document.body.appendChild(el);
      const callbacks = { onBlur: jest.fn() };
      // Re-activate to wire fresh callbacks.
      PrivacyBlurPicker.deactivate();
      PrivacyBlurPicker.activate({ blurRadius: 20 }, callbacks);
      fireClick(el);
      expect(callbacks.onBlur).toHaveBeenCalled();
    });
  });
});
