/**
 * storage_manager.js — PrivacyBlur Storage Manager
 *
 * Provides a clean async API for reading and writing persisted blur state.
 *
 * READ operations use chrome.runtime.sendMessage → background.js
 * (background merges defaults, validates settings).
 *
 * WRITE operations use chrome.storage.local directly from content script.
 * This bypasses the MV3 service worker message port, which can close
 * unpredictably when the SW suspends mid-promise-chain.
 *
 * Storage schema:
 * {
 *   "settings": { BLUR_RADIUS, TRANSITION_DURATION, ... (UPPER_SNAKE_CASE) },
 *   "rules": [ { id, name, pattern, patternType, settings }, ... ],
 *   "blurred_items": { "hostname": [{ type, name, selector|id, ... }, ...] },
 *   "blur_all_hosts": { "hostname": true }
 * }
 *
 * Exposed as pb.Storage (IIFE — no ES module syntax).
 */

const Storage = (() => {
  'use strict';

  const MSG = pb;

  // -------------------------------------------------------------------------
  // Private: send a message to the background worker and return a Promise
  // Used for READ operations only.
  // -------------------------------------------------------------------------

  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Private: validation helpers (mirrored from background.js)
  // -------------------------------------------------------------------------

  function _isValidHostname(h) {
    return (
      typeof h === 'string' &&
      h.length > 0 &&
      h.length <= 253 &&
      h !== '__proto__' &&
      h !== 'constructor' &&
      h !== 'prototype'
    );
  }

  function _isValidSelector(s) {
    return typeof s === 'string' && s.length > 0 && s.length <= 2000;
  }

  function _isValidBlurItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'dynamic') {
      return _isValidSelector(item.selector) &&
             typeof item.name === 'string' && item.name.length <= 100;
    }
    if (item.type === 'sticky') {
      return typeof item.id === 'string' && item.id.length > 0 &&
             typeof item.name === 'string' && item.name.length <= 100 &&
             typeof item.x === 'number' && typeof item.y === 'number' &&
             typeof item.width === 'number' && typeof item.height === 'number';
    }
    return false;
  }

  function _getItemId(item) {
    return item.type === 'dynamic' ? item.selector : item.id;
  }

  var PER_HOST_ITEM_LIMIT = 10;

  // -------------------------------------------------------------------------
  // Private: Promise wrapper for chrome.storage.local
  // -------------------------------------------------------------------------

  function _storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => resolve(result));
    });
  }

  function _storageSet(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => resolve());
    });
  }

  // -------------------------------------------------------------------------
  // Public API — blur items (typed: dynamic selectors + sticky zones)
  // WRITES use direct chrome.storage.local
  // -------------------------------------------------------------------------

  async function saveBlurItem(hostname, item) {
    if (!hostname || !item) return;
    if (!_isValidHostname(hostname) || !_isValidBlurItem(item)) return;

    const result = await _storageGet('blurred_items');
    const map = result.blurred_items || {};
    const list = map[hostname] || [];

    if (list.length >= PER_HOST_ITEM_LIMIT) return;

    const newId = _getItemId(item);
    if (!list.some(existing => _getItemId(existing) === newId)) {
      list.push(item);
    }

    map[hostname] = list;
    await _storageSet({ blurred_items: map });
  }

  async function removeBlurItem(hostname, itemId) {
    if (!hostname || !itemId) return;
    if (!_isValidHostname(hostname)) return;

    const result = await _storageGet('blurred_items');
    const map = result.blurred_items || {};
    const list = (map[hostname] || []).filter(
      (item) => _getItemId(item) !== itemId
    );

    if (list.length > 0) {
      map[hostname] = list;
    } else {
      delete map[hostname];
    }

    await _storageSet({ blurred_items: map });
  }

  async function clearHost(hostname) {
    if (!hostname) return;
    if (!_isValidHostname(hostname)) return;

    const result = await _storageGet('blurred_items');
    const map = result.blurred_items || {};
    delete map[hostname];
    await _storageSet({ blurred_items: map });
  }

  async function clearAll() {
    await _storageSet({ blurred_items: {} });
  }

  // -------------------------------------------------------------------------
  // Public API — blur items READ (message-based, background merges defaults)
  // -------------------------------------------------------------------------

  async function getBlurItems(hostname) {
    if (!hostname) return [];
    const response = await send({ type: MSG.GET_BLUR_ITEMS, hostname });
    return (response && Array.isArray(response.items)) ? response.items : [];
  }

  // -------------------------------------------------------------------------
  // Public API — settings
  // READ: message-based (background merges defaults + validates)
  // WRITE: direct chrome.storage.local (validated locally)
  // -------------------------------------------------------------------------

  async function getSettings() {
    const response = await send({ type: MSG.GET_SETTINGS });
    return (response && response.settings)
      ? response.settings
      : MSG.buildDefaultSettings();
  }

  async function saveSettings(fullSettings) {
    if (!fullSettings || typeof fullSettings !== 'object') return;
    var validated = MSG.validateSettings(fullSettings);
    await _storageSet({ settings: validated });
  }

  // -------------------------------------------------------------------------
  // Public API — URL rules
  // READ: message-based
  // WRITE: direct chrome.storage.local (sanitized locally)
  // -------------------------------------------------------------------------

  async function getRules() {
    const response = await send({ type: MSG.GET_RULES });
    return (response && Array.isArray(response.rules)) ? response.rules : [];
  }

  async function saveRules(rules) {
    if (!Array.isArray(rules)) return;
    if (rules.length > 100) return;

    var sanitized = rules.filter(function(r) {
      return r && typeof r === 'object' &&
        typeof r.pattern === 'string' && r.pattern.trim().length > 0;
    }).map(function(r) {
      return {
        id:          (typeof r.id === 'string' && r.id.length <= 20) ? r.id : 'r_' + Math.random().toString(36).slice(2, 10),
        name:        (typeof r.name === 'string') ? r.name.slice(0, 100) : '',
        pattern:     r.pattern.trim().slice(0, 500),
        patternType: (r.patternType === MSG.PATTERN_TYPES.REGEX || r.patternType === MSG.PATTERN_TYPES.WILDCARD) ? r.patternType : MSG.PATTERN_TYPES.WILDCARD,
        settings:    (r.settings && typeof r.settings === 'object' && !Array.isArray(r.settings) && JSON.stringify(r.settings).length <= 2000) ? r.settings : {},
      };
    });

    await _storageSet({ rules: sanitized });
  }

  // -------------------------------------------------------------------------
  // Public API — blur-all state per hostname
  // READ: message-based
  // WRITE: direct chrome.storage.local
  // -------------------------------------------------------------------------

  async function getBlurState(hostname) {
    if (!hostname) return false;
    const response = await send({ type: MSG.GET_BLUR_STATE, hostname });
    return !!(response && response.blurAll);
  }

  async function saveBlurState(hostname, blurAll) {
    if (!hostname) return;
    if (!_isValidHostname(hostname)) return;

    const result = await _storageGet('blur_all_hosts');
    const hosts = result.blur_all_hosts || {};
    if (blurAll) {
      hosts[hostname] = true;
    } else {
      delete hosts[hostname];
    }
    await _storageSet({ blur_all_hosts: hosts });
  }

  // -------------------------------------------------------------------------
  // Expose public API
  // -------------------------------------------------------------------------
  return {
    saveBlurItem,
    removeBlurItem,
    getBlurItems,
    clearHost,
    clearAll,
    getSettings,
    saveSettings,
    getRules,
    saveRules,
    getBlurState,
    saveBlurState,
  };
})();

pb.Storage = Storage;
