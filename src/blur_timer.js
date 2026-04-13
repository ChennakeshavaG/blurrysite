/**
 * blur_timer.js — Timed / temporary blur that auto-expires after N minutes.
 *
 * Uses content-script setTimeout for countdown tracking. The background
 * service worker uses chrome.alarms as a safety net (survives SW sleep).
 *
 * Exposed as blsi.BlurTimer (IIFE — no ES module syntax).
 */

const BlurrySiteBlurTimer = (() => {
  'use strict';

  let _timerId = null;
  let _endTime = 0;   // Date.now() + duration
  let _onExpire = null;

  /**
   * Start a countdown timer.
   * @param {number} minutes - Duration in minutes (1-480)
   * @param {Function} onExpire - Callback when timer expires
   */
  function start(minutes, onExpire) {
    if (typeof minutes !== 'number' || minutes <= 0) return;
    stop(); // clear any existing timer

    const ms = Math.min(minutes, 480) * 60 * 1000;
    _endTime = Date.now() + ms;
    _onExpire = onExpire || null;

    _timerId = setTimeout(() => {
      _timerId = null;
      _endTime = 0;
      if (_onExpire) _onExpire();
      _onExpire = null;
    }, ms);
  }

  /**
   * Cancel the active timer.
   */
  function stop() {
    if (_timerId !== null) {
      clearTimeout(_timerId);
      _timerId = null;
    }
    _endTime = 0;
    _onExpire = null;
  }

  /**
   * Get remaining seconds on the timer.
   * @returns {number} Remaining seconds, or 0 if no timer active.
   */
  function getRemaining() {
    if (!_timerId) return 0;
    const remaining = Math.max(0, Math.ceil((_endTime - Date.now()) / 1000));
    return remaining;
  }

  /**
   * Check if a timer is active.
   * @returns {boolean}
   */
  function isActive() {
    return _timerId !== null;
  }

  return Object.freeze({ start, stop, getRemaining, isActive });
})();

blsi.BlurTimer = BlurrySiteBlurTimer;
