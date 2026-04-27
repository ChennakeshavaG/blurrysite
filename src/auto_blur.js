/**
 * auto_blur.js — Automatically blur the page on idle or tab switch.
 *
 * Listens for visibility changes (tab switch) and user activity (idle detection).
 * Triggers blur/unblur callbacks without owning any blur state itself.
 *
 * Exposed as blsi.AutoBlur (IIFE — no ES module syntax).
 */

const BlurrySiteAutoBlur = (() => {
  'use strict';

  let _idleTimer = null;
  let _isIdle = false;
  let _opts = null;

  // Bound handlers for cleanup
  let _onVisChange = null;
  let _onActivity = null;
  let _onWindowBlur = null;
  let _onWindowFocus = null;

  // Debounce timer for visibilitychange — prevents a tab drag-to-new-window
  // (hide→show within ~10ms) from being misread as a genuine tab switch.
  let _hiddenTimer = null;

  // Debounce timer for window.blur — absorbs URL-bar clicks and other quick
  // focus-pulls so only sustained focus loss (alt-tab, other window) fires.
  let _windowBlurTimer = null;
  const WINDOW_BLUR_DEBOUNCE_MS = 250;

  function _resetIdleTimer() {
    if (_idleTimer !== null) clearTimeout(_idleTimer);
    if (!_opts || !_opts.idle) return;

    _idleTimer = setTimeout(() => {
      if (!_isIdle) {
        _isIdle = true;
        if (_opts && _opts.onIdle) _opts.onIdle({ reason: 'idle' });
      }
    }, (_opts.idleTimeout || 300) * 1000);
  }

  function _handleActivity() {
    if (_isIdle && _opts) {
      _isIdle = false;
      if (_opts.onActive) _opts.onActive();
    }
    _resetIdleTimer();
  }

  function _handleVisChange() {
    if (!_opts || !_opts.tabSwitch) return;
    if (document.hidden) {
      // Delay the idle callback 150ms — if the tab becomes visible again before
      // the timer fires it was a drag-to-new-window, not a real tab switch.
      if (_hiddenTimer !== null) clearTimeout(_hiddenTimer);
      _hiddenTimer = setTimeout(() => {
        _hiddenTimer = null;
        if (!_isIdle && document.hidden) {
          _isIdle = true;
          if (_opts.onIdle) _opts.onIdle({ reason: 'tab_switch' });
        }
      }, 150);
    } else {
      if (_hiddenTimer !== null) {
        // Tab became visible before the 150ms elapsed → window drag, skip callbacks.
        clearTimeout(_hiddenTimer);
        _hiddenTimer = null;
        _resetIdleTimer();
        return;
      }
      if (_isIdle) {
        _isIdle = false;
        if (_opts.onActive) _opts.onActive();
      }
      _resetIdleTimer();
    }
  }

  function _handleWindowBlur() {
    if (!_opts || !_opts.tabSwitch) return;
    // Tab-switch within the same window already covered by visibilitychange;
    // window.blur catches alt-tab to another app or browser window where the
    // page stays visible. Debounced so URL-bar / quick-focus-pulls don't fire.
    if (_windowBlurTimer !== null) clearTimeout(_windowBlurTimer);
    _windowBlurTimer = setTimeout(() => {
      _windowBlurTimer = null;
      if (!_isIdle && !document.hasFocus()) {
        _isIdle = true;
        if (_opts.onIdle) _opts.onIdle({ reason: 'tab_switch' });
      }
    }, WINDOW_BLUR_DEBOUNCE_MS);
  }

  function _handleWindowFocus() {
    if (!_opts || !_opts.tabSwitch) return;
    if (_windowBlurTimer !== null) {
      clearTimeout(_windowBlurTimer);
      _windowBlurTimer = null;
      // Focus returned within debounce — non-event, no callbacks.
      _resetIdleTimer();
      return;
    }
    if (_isIdle && !document.hidden) {
      _isIdle = false;
      if (_opts.onActive) _opts.onActive();
    }
    _resetIdleTimer();
  }

  /**
   * Initialize auto-blur listeners.
   * @param {Object} opts
   * @param {number} opts.idleTimeout - Seconds before idle triggers (30-3600)
   * @param {boolean} opts.tabSwitch - Blur on tab switch
   * @param {boolean} opts.idle - Blur on idle
   * @param {Function} opts.onIdle - Called when page goes idle/hidden
   * @param {Function} opts.onActive - Called when user returns
   */
  function init(opts) {
    destroy(); // clean up any previous instance

    _opts = opts;
    _isIdle = false;

    if (opts.tabSwitch) {
      _onVisChange = _handleVisChange;
      document.addEventListener('visibilitychange', _onVisChange);
      _onWindowBlur = _handleWindowBlur;
      _onWindowFocus = _handleWindowFocus;
      window.addEventListener('blur', _onWindowBlur);
      window.addEventListener('focus', _onWindowFocus);
    }

    if (opts.idle) {
      _onActivity = _handleActivity;
      const activityEvents = ['mousemove', 'keydown', 'scroll', 'touchstart'];
      for (const evt of activityEvents) {
        document.addEventListener(evt, _onActivity, { passive: true });
      }
      _resetIdleTimer();
    }
  }

  /**
   * Remove all listeners and timers.
   */
  function destroy() {
    if (_idleTimer !== null) {
      clearTimeout(_idleTimer);
      _idleTimer = null;
    }

    if (_hiddenTimer !== null) {
      clearTimeout(_hiddenTimer);
      _hiddenTimer = null;
    }

    if (_windowBlurTimer !== null) {
      clearTimeout(_windowBlurTimer);
      _windowBlurTimer = null;
    }

    if (_onVisChange) {
      document.removeEventListener('visibilitychange', _onVisChange);
      _onVisChange = null;
    }

    if (_onWindowBlur) {
      window.removeEventListener('blur', _onWindowBlur);
      _onWindowBlur = null;
    }

    if (_onWindowFocus) {
      window.removeEventListener('focus', _onWindowFocus);
      _onWindowFocus = null;
    }

    if (_onActivity) {
      const activityEvents = ['mousemove', 'keydown', 'scroll', 'touchstart'];
      for (const evt of activityEvents) {
        document.removeEventListener(evt, _onActivity, { passive: true });
      }
      _onActivity = null;
    }

    _opts = null;
    _isIdle = false;
  }

  /**
   * Check if the page is currently considered idle.
   * @returns {boolean}
   */
  function isIdle() {
    return _isIdle;
  }

  return Object.freeze({ init, destroy, isIdle });
})();

blsi.AutoBlur = BlurrySiteAutoBlur;
