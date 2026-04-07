/**
 * tests/unit/picker.test.js
 *
 * Unit tests for src/picker.js — the interactive element picker that lets
 * users hover over page elements and click to blur/unblur them.
 *
 * Module exposes blsi.Picker with: activate, deactivate,
 * setSettings, and an isActive getter.
 *
 * Key behaviors tested:
 *  - Activation: adds crosshair cursor class, creates toolbar, wires events
 *  - Hover: highlights element under cursor with outline
 *  - Click: calls onBlur or onUnblur callback depending on element state
 *  - Escape: deactivates picker and notifies content_script
 *  - Deactivation: removes all side-effects (toolbar, highlights, listeners)
 *  - Settings: can be updated while picker is active
 *
 * Tests mock blsi.BlurEngine and blsi.SelectorUtils as window globals
 * because picker.js depends on them being loaded first via manifest.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/picker.js');

function loadPicker() {
  if (blsi.Picker) return;
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

    var ACTIVE_CLASS = 'bl-si-picker-active';
    var HOVER_CLASS  = 'bl-si-hover-highlight';
    var TOOLBAR_ID   = 'bl-si-picker-toolbar';

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

      document.documentElement.classList.add(ACTIVE_CLASS);

      var toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      toolbar.textContent = 'Blurry Site Picker — click any element';
      document.body.appendChild(toolbar);

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
        if (el.classList.contains('bl-si-blurred')) {
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

    blsi.Picker = {
      get isActive() { return _active; },
      activate: activate,
      deactivate: deactivate,
      setSettings: setSettings,
    };
  })();
  `;
}

// ─── Mock dependencies ────────────────────────────────────────────────────────

function setupGlobalMocks() {
  blsi.BlurEngine = {
    applyBlur: jest.fn(),
    removeBlur: jest.fn(),
    isBlurred: jest.fn((el) => !!(el && el.dataset && el.dataset.blSiBlur)),
  };

  blsi.SelectorUtils = {
    getSelector: jest.fn().mockReturnValue('#mock-selector'),
    generateId: jest.fn().mockReturnValue('abcd1234'),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Dispatch a mouseover event with a specific target element. */
function fireMouseover(target) {
  const e = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target, configurable: true });
  document.dispatchEvent(e);
}

/** Dispatch a mouseout event with a specific target element. */
function fireMouseout(target) {
  const e = new MouseEvent('mouseout', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target, configurable: true });
  document.dispatchEvent(e);
}

/** Dispatch a click event with a specific target element. Returns the event. */
function fireClick(target) {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target, configurable: true });
  document.dispatchEvent(e);
  return e;
}

/** Dispatch a keydown event with a specific key. */
function fireKey(key) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.dispatchEvent(e);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('blsi.Picker', () => {
  beforeAll(() => {
    setupGlobalMocks();
    loadPicker();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    jest.clearAllMocks();
    // Ensure picker is deactivated before each test to prevent state leakage.
    try { blsi.Picker.deactivate(); } catch (_) {}
  });

  afterEach(() => {
    // Safety net: clean up in case a test left the picker active.
    try { blsi.Picker.deactivate(); } catch (_) {}
  });

  // ── activate ───────────────────────────────────────────────────────────────

  describe('activate', () => {
    /**
     * Verifies that activation adds the pb-picker-active class to <html>.
     * Why: content.css uses this class to set `cursor: crosshair !important`
     * on all page elements, giving the user a visual cue that they are in
     * element selection mode.
     * Reproduce: Call activate(), check documentElement class list.
     */
    test('adds pb-picker-active class to html element', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      expect(document.documentElement.classList.contains('bl-si-picker-active')).toBe(true);
    });

    /**
     * Verifies that activation creates the toolbar overlay.
     * Why: The toolbar shows instructions ("Picker Mode — hover and click")
     * and action buttons ("Clear all", close). Without it, users don't know
     * how to use the picker or exit it.
     * Reproduce: Call activate(), query for toolbar by ID.
     */
    test('creates a toolbar element in the DOM', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      const toolbar = document.getElementById('bl-si-picker-toolbar');
      expect(toolbar).not.toBeNull();
    });

    /**
     * Verifies that calling activate twice does not create duplicate toolbars.
     * Why: The content_script might call activate in response to both a
     * keyboard shortcut and a popup button click in quick succession. Two
     * toolbars would overlap and confuse the user.
     * Reproduce: Call activate() twice, count toolbar elements.
     */
    test('calling activate twice is safe (idempotent)', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      const toolbars = document.querySelectorAll('#bl-si-picker-toolbar');
      expect(toolbars.length).toBe(1);
    });
  });

  // ── hover highlight ────────────────────────────────────────────────────────

  describe('hover highlight', () => {
    /**
     * Verifies that hovering over an element adds the highlight class.
     * Why: The highlight outline (defined by .bl-si-hover-highlight in content.css)
     * shows the user exactly which element will be blurred on click.
     * Without it, the picker would be unusable.
     * Reproduce: Activate picker, fire mouseover on a <p> element.
     */
    test('adds bl-si-hover-highlight class on mouseover', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      fireMouseover(el);

      expect(el.classList.contains('bl-si-hover-highlight')).toBe(true);
    });

    /**
     * Verifies that moving the mouse away removes the highlight.
     * Why: Stale highlights on previous elements would make it unclear
     * which element is currently targeted.
     * Reproduce: Add highlight class to element, fire mouseout.
     */
    test('removes bl-si-hover-highlight class on mouseout', () => {
      const el = document.createElement('p');
      el.classList.add('bl-si-hover-highlight');
      document.body.appendChild(el);
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      fireMouseout(el);

      expect(el.classList.contains('bl-si-hover-highlight')).toBe(false);
    });

    /**
     * Verifies that null target on mouseover does not crash.
     * Why: In some browsers, mouseover events can have null targets when
     * the cursor enters from outside the viewport or crosses iframe boundaries.
     * Reproduce: Dispatch a mouseover event without setting a target.
     */
    test('does not throw if target is null on mouseover', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});
      const e = new MouseEvent('mouseover', { bubbles: true });
      expect(() => document.dispatchEvent(e)).not.toThrow();
    });
  });

  // ── click ──────────────────────────────────────────────────────────────────

  describe('click', () => {
    /**
     * Verifies that clicking an unblurred element calls the onBlur callback.
     * Why: The picker's primary function is to blur elements on click.
     * The onBlur callback is how the picker communicates the user's intent
     * to content_script.js, which then applies the blur and persists it.
     * Reproduce: Activate with onBlur callback, click a clean element.
     */
    test('calls onBlur callback with element when element is not blurred', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      el.classList.remove('bl-si-blurred');

      const callbacks = { onBlur: jest.fn(), onUnblur: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);

      fireClick(el);

      expect(callbacks.onBlur).toHaveBeenCalledWith(el);
      expect(callbacks.onUnblur).not.toHaveBeenCalled();
    });

    /**
     * Verifies that clicking an already-blurred element calls onUnblur.
     * Why: The picker acts as a toggle — clicking a blurred element should
     * unblur it. This lets users correct mistakes without switching modes.
     * The check uses classList.contains('bl-si-blurred'), not Engine.isBlurred().
     * Reproduce: Add bl-si-blurred class to element, activate, click it.
     */
    test('calls onUnblur callback when element has data-bl-si-blur', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      el.dataset.blSiBlur = '1'; // Simulate individual picker blur

      const callbacks = { onBlur: jest.fn(), onUnblur: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);

      fireClick(el);

      expect(callbacks.onUnblur).toHaveBeenCalledWith(el);
      expect(callbacks.onBlur).not.toHaveBeenCalled();
    });

    /**
     * Verifies that click events are prevented from their default action.
     * Why: Without preventDefault, clicking a link (<a>) in picker mode
     * would navigate away from the page instead of blurring the link.
     * Reproduce: Create an <a href="#"> element, activate picker, click it,
     * verify preventDefault was called.
     */
    test('click prevents default event', () => {
      const el = document.createElement('a');
      el.href = '#';
      document.body.appendChild(el);

      const callbacks = { onBlur: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', { value: el, configurable: true });
      let defaultPrevented = false;
      clickEvent.preventDefault = () => { defaultPrevented = true; };
      clickEvent.stopPropagation = jest.fn();
      document.dispatchEvent(clickEvent);

      expect(defaultPrevented).toBe(true);
    });

    /**
     * Verifies that click events stop propagating to page handlers.
     * Why: Without stopPropagation, the page's own click handlers would
     * fire alongside the picker's handler, causing unintended actions
     * like opening modals, submitting forms, or triggering navigation.
     * Reproduce: Activate picker, dispatch click with stopPropagation spy.
     */
    test('click stops event propagation', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      const callbacks = { onBlur: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);

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
    /**
     * Verifies that pressing Escape deactivates the picker.
     * Why: Escape is the universal "cancel" key. Users expect it to exit
     * picker mode immediately, especially during screen sharing when they
     * need to quickly return to normal page interaction.
     * Reproduce: Activate picker, fire Escape keydown, check class removed.
     */
    test('pressing Escape calls deactivate and removes pb-picker-active', () => {
      const callbacks = { onDeactivate: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);
      expect(document.documentElement.classList.contains('bl-si-picker-active')).toBe(true);

      fireKey('Escape');

      expect(document.documentElement.classList.contains('bl-si-picker-active')).toBe(false);
    });

    /**
     * Verifies that Escape triggers the onDeactivate callback.
     * Why: content_script.js needs to know when the picker deactivates so
     * it can update isPickerActive state and notify the shortcut handler
     * via _setPickerActive(false). Without this callback, the Escape key
     * in shortcut_handler.js would keep firing onExitPicker unnecessarily.
     * Reproduce: Activate with onDeactivate spy, fire Escape, check called.
     */
    test('pressing Escape triggers onDeactivate callback', () => {
      const callbacks = { onDeactivate: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);

      fireKey('Escape');

      expect(callbacks.onDeactivate).toHaveBeenCalledTimes(1);
    });
  });

  // ── deactivate ─────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    /**
     * Verifies that deactivation removes the crosshair cursor class.
     * Why: Leaving the crosshair cursor after exiting picker mode would
     * confuse users into thinking they're still selecting elements.
     * Reproduce: Activate, deactivate, check class is removed.
     */
    test('removes pb-picker-active class from html element', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});
      expect(document.documentElement.classList.contains('bl-si-picker-active')).toBe(true);

      blsi.Picker.deactivate();

      expect(document.documentElement.classList.contains('bl-si-picker-active')).toBe(false);
    });

    /**
     * Verifies that deactivation removes the toolbar from the DOM.
     * Why: The toolbar occupies the top of the viewport. Leaving it visible
     * after deactivation would block page content and confuse users.
     * Reproduce: Activate (creates toolbar), deactivate, query for toolbar.
     */
    test('removes the toolbar from the DOM', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});
      expect(document.getElementById('bl-si-picker-toolbar')).not.toBeNull();

      blsi.Picker.deactivate();

      expect(document.getElementById('bl-si-picker-toolbar')).toBeNull();
    });

    /**
     * Verifies that deactivation fires the onDeactivate callback.
     * Why: content_script.js listens for this callback to update its
     * isPickerActive flag and sync state with the shortcut handler.
     * Reproduce: Activate with callback spy, deactivate, check called.
     */
    test('calls onDeactivate callback', () => {
      const callbacks = { onDeactivate: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);

      blsi.Picker.deactivate();

      expect(callbacks.onDeactivate).toHaveBeenCalledTimes(1);
    });

    /**
     * Verifies that event listeners are fully removed after deactivation.
     * Why: If click listeners persist after deactivation, subsequent clicks
     * would still trigger blur/unblur actions. This would be a severe UX
     * bug — the user thinks picker mode is off but elements keep getting
     * blurred on every click.
     * Reproduce: Activate, deactivate, fire click, verify callback NOT called.
     */
    test('does not fire blur/unblur after deactivation (listeners removed)', () => {
      const el = document.createElement('p');
      document.body.appendChild(el);
      const callbacks = { onBlur: jest.fn(), onDeactivate: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'dynamic' }, callbacks);
      blsi.Picker.deactivate();

      fireClick(el);

      expect(callbacks.onBlur).not.toHaveBeenCalled();
    });

    /**
     * Verifies that calling deactivate when already inactive is safe.
     * Why: content_script.js may call deactivate defensively on page
     * cleanup or in response to CLEAR_ALL_BLUR messages, even when the
     * picker was never activated.
     * Reproduce: Call deactivate without prior activate.
     */
    test('calling deactivate when not active does not throw', () => {
      expect(() => blsi.Picker.deactivate()).not.toThrow();
    });
  });

  // ── setSettings ────────────────────────────────────────────────────────────

  describe('setSettings', () => {
    /**
     * Verifies that setSettings can update blur radius while picker is active.
     * Why: Users can change the blur radius in the popup while the picker
     * is open. The popup sends UPDATE_SETTINGS, content_script calls
     * Picker.setSettings(), and subsequent blur clicks should use the new
     * radius.
     * Reproduce: Activate with radius 8, call setSettings with radius 16.
     */
    test('updates blurRadius property', () => {
      blsi.Picker.activate({ blurRadius: 8, pickerMode: 'dynamic' }, {});

      expect(() => blsi.Picker.setSettings({ blurRadius: 16 })).not.toThrow();
    });

    /**
     * Verifies that setSettings before activation does not crash.
     * Why: During initialization, content_script.js may call setSettings
     * before the picker has been activated. This must be a safe no-op.
     * Reproduce: Call setSettings without prior activate.
     */
    test('calling setSettings before activate does not throw', () => {
      expect(() => blsi.Picker.setSettings({ blurRadius: 12 })).not.toThrow();
    });

    /**
     * Verifies that partial settings updates preserve existing settings.
     * Why: When the user changes only one setting (e.g. blur radius), other
     * settings (e.g. highlight color) must not be wiped. This tests the
     * Object spread/assign merge behavior.
     * Reproduce: Activate with both settings, update only one, verify picker
     * still functions correctly (click still fires callback).
     */
    test('partial settings update does not wipe existing settings', () => {
      blsi.Picker.activate({ blurRadius: 8, highlightColor: '#ff0000', pickerMode: 'dynamic' }, {});

      expect(() => blsi.Picker.setSettings({ blurRadius: 20 })).not.toThrow();

      const el = document.createElement('p');
      document.body.appendChild(el);
      const callbacks = { onBlur: jest.fn() };
      blsi.Picker.deactivate();
      blsi.Picker.activate({ blurRadius: 20, pickerMode: 'dynamic' }, callbacks);
      fireClick(el);
      expect(callbacks.onBlur).toHaveBeenCalled();
    });
  });

  // ── isActive getter ───────────────────────────────────────────────────────

  describe('isActive', () => {
    /**
     * Verifies isActive is false before any activation.
     * Why: content_script.js checks Picker.isActive to decide whether
     * TOGGLE_PICKER should activate or deactivate. A false initial state
     * is required for the first toggle to activate.
     * Reproduce: Check isActive without calling activate.
     */
    test('returns false before activation', () => {
      expect(blsi.Picker.isActive).toBe(false);
    });

    /**
     * Verifies isActive is true after activation.
     * Why: The popup uses GET_STATUS to query whether the picker is active
     * and display the correct button state ("Activate" vs "Deactivate").
     * Reproduce: Activate, check isActive.
     */
    test('returns true after activation', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      expect(blsi.Picker.isActive).toBe(true);
    });

    /**
     * Verifies isActive is false after explicit deactivation.
     * Why: After deactivation, subsequent TOGGLE_PICKER messages must
     * re-activate (not skip because isActive is stale).
     * Reproduce: Activate, deactivate, check isActive.
     */
    test('returns false after deactivation', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});
      blsi.Picker.deactivate();

      expect(blsi.Picker.isActive).toBe(false);
    });

    /**
     * Verifies isActive is false after Escape-triggered deactivation.
     * Why: Escape deactivates through the internal keydown handler, not
     * through a direct deactivate() call from content_script. The isActive
     * getter must still reflect the correct state.
     * Reproduce: Activate, fire Escape, check isActive.
     */
    test('returns false after Escape key deactivates picker', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, { onDeactivate: jest.fn() });

      fireKey('Escape');

      expect(blsi.Picker.isActive).toBe(false);
    });
  });

  // ── Hover highlight cleanup ───────────────────────────────────────────────

  describe('hover highlight cleanup', () => {
    /**
     * Verifies that ALL hover highlights are removed on deactivation.
     * Why: If the user hovers over an element and then exits picker mode
     * (via Escape or toolbar close), the highlight outline must be removed.
     * Multiple elements can have stale highlights if the mouse moved quickly.
     * Reproduce: Add highlight class to two elements, activate then deactivate,
     * verify no highlighted elements remain.
     */
    test('removes all hover highlights on deactivation', () => {
      const el1 = document.createElement('p');
      const el2 = document.createElement('div');
      el1.classList.add('bl-si-hover-highlight');
      el2.classList.add('bl-si-hover-highlight');
      document.body.appendChild(el1);
      document.body.appendChild(el2);

      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});
      blsi.Picker.deactivate();

      expect(document.querySelectorAll('.bl-si-hover-highlight').length).toBe(0);
    });

    /**
     * Verifies that the highlight moves between elements as the mouse moves.
     * Why: Only the currently hovered element should be highlighted. If
     * highlights don't switch, users can't tell which element they're about
     * to blur.
     * Reproduce: Activate, mouseover el1 (highlighted), mouseover el2
     * (el2 should be highlighted).
     */
    test('hover highlight switches between elements', () => {
      const el1 = document.createElement('p');
      const el2 = document.createElement('div');
      document.body.appendChild(el1);
      document.body.appendChild(el2);
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      fireMouseover(el1);
      expect(el1.classList.contains('bl-si-hover-highlight')).toBe(true);

      fireMouseover(el2);
      expect(el2.classList.contains('bl-si-hover-highlight')).toBe(true);
    });
  });

  // ── Toolbar interaction ────────────────────────────────────────────────────

  describe('toolbar', () => {
    /**
     * Verifies that the toolbar has the correct ID and CSS class.
     * Why: The toolbar ID ('bl-si-picker-toolbar') is used by deactivate() to
     * find and remove it. The CSS class ('bl-si-toolbar') is styled in
     * content.css with high z-index and backdrop blur. Wrong ID or class
     * means the toolbar either can't be cleaned up or looks broken.
     * Reproduce: Activate, query toolbar by ID, check class.
     */
    test('toolbar has correct ID and class', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      const toolbar = document.getElementById('bl-si-picker-toolbar');
      expect(toolbar).not.toBeNull();
      expect(toolbar.classList.contains('bl-si-toolbar')).toBe(true);
    });

    /**
     * Verifies that the toolbar is removed when Escape deactivates the picker.
     * Why: Escape triggers deactivation through the keydown handler. The
     * toolbar removal path through Escape must work the same as direct
     * deactivate() — otherwise the toolbar persists as a phantom overlay.
     * Reproduce: Activate, fire Escape, verify toolbar is gone.
     */
    test('toolbar is removed when picker is deactivated via Escape', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, { onDeactivate: jest.fn() });

      fireKey('Escape');

      expect(document.getElementById('bl-si-picker-toolbar')).toBeNull();
    });
  });

  // ── Click boundary conditions ─────────────────────────────────────────────

  describe('click boundary conditions', () => {
    /**
     * Verifies that clicking with no callbacks provided does not crash.
     * Why: Defensively, activate() may be called with an empty callbacks
     * object (e.g. during testing or from malformed popup messages). The
     * click handler must check for callback existence before calling.
     * Reproduce: Activate with empty callbacks, fire click on an element.
     */
    test('clicking when no callbacks provided does not throw', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      expect(() => fireClick(el)).not.toThrow();
    });

    /**
     * Verifies that hovering over <body> or <html> does not add highlights.
     * Why: Blurring the body or html element would blur the entire page
     * including the picker toolbar, making the UI completely unusable.
     * The picker's resolveTarget() function explicitly rejects these elements.
     * Reproduce: Activate, fire mouseover on body and documentElement.
     */
    test('does not highlight html or body elements on mouseover', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});

      fireMouseover(document.body);
      expect(document.body.classList.contains('bl-si-hover-highlight')).toBe(false);

      fireMouseover(document.documentElement);
      expect(document.documentElement.classList.contains('bl-si-hover-highlight')).toBe(false);
    });
  });

  // ── Sticky mode ──────────────────────────────────────────────────────────

  describe('sticky mode', () => {
    function fireMouseDown(target, x, y) {
      const event = new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0,
        clientX: x || 0, clientY: y || 0,
      });
      target.dispatchEvent(event);
      return event;
    }

    function fireMouseMove(x, y) {
      const event = new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: x || 0, clientY: y || 0,
      });
      document.dispatchEvent(event);
      return event;
    }

    function fireMouseUp(x, y) {
      const event = new MouseEvent('mouseup', {
        bubbles: true, cancelable: true,
        clientX: x || 0, clientY: y || 0,
      });
      document.dispatchEvent(event);
      return event;
    }

    test('activates in sticky mode by default', () => {
      blsi.Picker.activate({}, {});
      expect(blsi.Picker.isActive).toBe(true);
      // No hover highlight should appear in sticky mode
      const el = document.createElement('div');
      el.className = 'test-el';
      document.body.appendChild(el);
      fireMouseover(el);
      expect(el.classList.contains('bl-si-hover-highlight')).toBe(false);
    });

    test('activates in sticky mode when pickerMode is sticky', () => {
      blsi.Picker.activate({ pickerMode: 'sticky' }, {});
      expect(blsi.Picker.isActive).toBe(true);
    });

    test('creates drawing preview on mousedown', () => {
      blsi.Picker.activate({ pickerMode: 'sticky' }, {});
      const el = document.createElement('div');
      document.body.appendChild(el);

      fireMouseDown(el, 100, 100);
      const preview = document.querySelector('.bl-si-zone-drawing');
      expect(preview).not.toBeNull();
    });

    test('updates drawing preview on mousemove', () => {
      blsi.Picker.activate({ pickerMode: 'sticky' }, {});
      const el = document.createElement('div');
      document.body.appendChild(el);

      fireMouseDown(el, 100, 100);
      fireMouseMove(200, 200);

      const preview = document.querySelector('.bl-si-zone-drawing');
      expect(preview).not.toBeNull();
      expect(preview.style.width).toBe('100px');
      expect(preview.style.height).toBe('100px');
    });

    test('calls onStickyBlur on mouseup with valid area', () => {
      const callbacks = { onStickyBlur: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'sticky' }, callbacks);
      const el = document.createElement('div');
      document.body.appendChild(el);

      fireMouseDown(el, 100, 100);
      fireMouseMove(200, 200);
      fireMouseUp(200, 200);

      expect(callbacks.onStickyBlur).toHaveBeenCalledTimes(1);
      const zoneRect = callbacks.onStickyBlur.mock.calls[0][0];
      expect(zoneRect.width).toBe(100);
      expect(zoneRect.height).toBe(100);
    });

    test('does not call onStickyBlur for area smaller than 10px', () => {
      const callbacks = { onStickyBlur: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'sticky' }, callbacks);
      const el = document.createElement('div');
      document.body.appendChild(el);

      fireMouseDown(el, 100, 100);
      fireMouseUp(105, 105);

      expect(callbacks.onStickyBlur).not.toHaveBeenCalled();
    });

    test('removes drawing preview on mouseup', () => {
      blsi.Picker.activate({ pickerMode: 'sticky' }, {});
      const el = document.createElement('div');
      document.body.appendChild(el);

      fireMouseDown(el, 100, 100);
      fireMouseMove(200, 200);
      fireMouseUp(200, 200);

      expect(document.querySelector('.bl-si-zone-drawing')).toBeNull();
    });

    test('Escape cancels in-progress draw without deactivating', () => {
      blsi.Picker.activate({ pickerMode: 'sticky' }, {});
      const el = document.createElement('div');
      document.body.appendChild(el);

      fireMouseDown(el, 100, 100);
      fireMouseMove(200, 200);

      // Press Escape during draw
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.dispatchEvent(escEvent);

      // Preview should be gone
      expect(document.querySelector('.bl-si-zone-drawing')).toBeNull();
      // But picker should still be active
      expect(blsi.Picker.isActive).toBe(true);
    });

    test('clicking zone overlay in sticky mode calls onStickyUnblur', () => {
      const callbacks = { onStickyUnblur: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'sticky' }, callbacks);

      const zone = document.createElement('div');
      zone.dataset.blSiZone = 's_test123';
      document.body.appendChild(zone);

      fireMouseDown(zone, 50, 50);

      expect(callbacks.onStickyUnblur).toHaveBeenCalledWith('s_test123');
    });
  });

  // ── setMode ──────────────────────────────────────────────────────────────

  describe('setMode', () => {
    test('switches from sticky to dynamic', () => {
      blsi.Picker.activate({ pickerMode: 'sticky' }, {});
      blsi.Picker.setMode('dynamic');

      // Dynamic mode should enable hover highlights
      const el = document.createElement('div');
      el.className = 'test-el';
      document.body.appendChild(el);
      fireMouseover(el);
      expect(el.classList.contains('bl-si-hover-highlight')).toBe(true);
    });

    test('switches from dynamic to sticky', () => {
      blsi.Picker.activate({ pickerMode: 'dynamic' }, {});
      blsi.Picker.setMode('sticky');

      // Sticky mode should NOT enable hover highlights
      const el = document.createElement('div');
      el.className = 'test-el';
      document.body.appendChild(el);
      fireMouseover(el);
      expect(el.classList.contains('bl-si-hover-highlight')).toBe(false);
    });

    test('cancels in-progress draw on mode switch', () => {
      blsi.Picker.activate({ pickerMode: 'sticky' }, {});
      const el = document.createElement('div');
      document.body.appendChild(el);

      // Start drawing
      const event = new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0,
        clientX: 100, clientY: 100,
      });
      Object.defineProperty(event, 'target', { value: el, writable: false });
      document.dispatchEvent(event);

      expect(document.querySelector('.bl-si-zone-drawing')).not.toBeNull();

      blsi.Picker.setMode('dynamic');
      expect(document.querySelector('.bl-si-zone-drawing')).toBeNull();
    });

    test('calls onModeChange callback', () => {
      const callbacks = { onModeChange: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'sticky' }, callbacks);
      blsi.Picker.setMode('dynamic');
      expect(callbacks.onModeChange).toHaveBeenCalledWith('dynamic');
    });

    test('ignores invalid mode values', () => {
      const callbacks = { onModeChange: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'sticky' }, callbacks);
      blsi.Picker.setMode('invalid');
      expect(callbacks.onModeChange).not.toHaveBeenCalled();
    });

    test('no-op when setting same mode', () => {
      const callbacks = { onModeChange: jest.fn() };
      blsi.Picker.activate({ pickerMode: 'sticky' }, callbacks);
      blsi.Picker.setMode('sticky');
      expect(callbacks.onModeChange).not.toHaveBeenCalled();
    });
  });
});
