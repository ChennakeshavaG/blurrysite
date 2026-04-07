/**
 * logger.js — Blurry Site Debug Logger
 *
 * Shared logger with a persistent toggle in chrome.storage.local.
 * Enable:  blsi.Logger.enable()   or set pb_debug=true in storage
 * Disable: blsi.Logger.disable()
 * Check:   blsi.Logger.enabled
 *
 * Exposed as blsi.Logger (IIFE — no ES module syntax).
 * Must load after constants.js (needs pb namespace).
 */

const Logger = (() => {
  'use strict';

  let _enabled = false;
  const PREFIX = '[PB]';

  // Load persisted state on init
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('blsi_debug', (result) => {
        if (result && result.blsi_debug === true) _enabled = true;
      });
    }
  } catch (_) {}

  function log(...args) {
    if (_enabled) console.log(PREFIX, ...args);
  }

  function warn(...args) {
    if (_enabled) console.warn(PREFIX, ...args);
  }

  function error(...args) {
    // Errors always log regardless of toggle
    console.error(PREFIX, ...args);
  }

  function enable() {
    _enabled = true;
    try {
      chrome.storage.local.set({ blsi_debug: true });
    } catch (_) {}
    console.log(PREFIX, 'Debug logging enabled');
  }

  function disable() {
    _enabled = false;
    try {
      chrome.storage.local.set({ blsi_debug: false });
    } catch (_) {}
    console.log(PREFIX, 'Debug logging disabled');
  }

  return {
    log,
    warn,
    error,
    enable,
    disable,
    get enabled() { return _enabled; },
  };
})();

blsi.Logger = Logger;
