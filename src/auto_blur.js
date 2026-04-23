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

  // Debounce timer for visibilitychange — prevents a tab drag-to-new-window
  // (hide→show within ~10ms) from being misread as a genuine tab switch.
  let _hiddenTimer = null;

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

    if (_onVisChange) {
      document.removeEventListener('visibilitychange', _onVisChange);
      _onVisChange = null;
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
