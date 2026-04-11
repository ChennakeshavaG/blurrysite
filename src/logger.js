/**
 * logger.js — Blurry Site Flow Logger
 *
 * Persistent toggle stored in chrome.storage.local under key `blsi_debug`.
 * When enabled, log/warn/flow output to the console with the [BLSI] prefix.
 * error() always logs regardless of toggle.
 *
 * Cross-context sync: any context (background, content, popup) that flips
 * the toggle propagates the new state to every other context via
 * chrome.storage.onChanged.
 *
 * Exposed as blsi.Logger (IIFE — no ES module syntax).
 * Must load after constants.js (needs blsi namespace).
 */

const Logger = (() => {
  'use strict';

  let _enabled = false;
  const PREFIX = '[BLSI]';
  const STORAGE_KEY = 'blsi_debug';

  // Load persisted state on init
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (result && result[STORAGE_KEY] === true) _enabled = true;
      });

      if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local' || !changes[STORAGE_KEY]) return;
          _enabled = changes[STORAGE_KEY].newValue === true;
        });
      }
    }
  } catch (_) {}

  function _ts() {
    const d = new Date();
    return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function log(...args) {
    if (_enabled) console.log(PREFIX, _ts(), ...args);
  }

  function warn(...args) {
    if (_enabled) console.warn(PREFIX, _ts(), ...args);
  }

  function error(...args) {
    console.error(PREFIX, _ts(), ...args);
  }

  function flow(tag, data) {
    if (!_enabled) return;
    if (data === undefined) {
      console.log(PREFIX, _ts(), '⟶', tag);
    } else {
      console.log(PREFIX, _ts(), '⟶', tag, data);
    }
  }

  function scope(name) {
    const tag = `[${name}]`;
    return {
      log:  (...args) => { if (_enabled) console.log(PREFIX, _ts(), tag, ...args); },
      warn: (...args) => { if (_enabled) console.warn(PREFIX, _ts(), tag, ...args); },
      error: (...args) => console.error(PREFIX, _ts(), tag, ...args),
      flow: (event, data) => {
        if (!_enabled) return;
        if (data === undefined) console.log(PREFIX, _ts(), tag, '⟶', event);
        else console.log(PREFIX, _ts(), tag, '⟶', event, data);
      },
      get enabled() { return _enabled; },
    };
  }

  function enable() {
    _enabled = true;
    try { chrome.storage.local.set({ [STORAGE_KEY]: true }); } catch (_) {}
    console.log(PREFIX, 'Flow logging ENABLED — open DevTools on any tab');
  }

  function disable() {
    _enabled = false;
    try { chrome.storage.local.set({ [STORAGE_KEY]: false }); } catch (_) {}
    console.log(PREFIX, 'Flow logging disabled');
  }

  return {
    log,
    warn,
    error,
    flow,
    scope,
    enable,
    disable,
    get enabled() { return _enabled; },
  };
})();

blsi.Logger = Logger;
