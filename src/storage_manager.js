/**
 * storage_manager.js — Blurry Site Storage Manager
 *
 * Single source of truth for all persisted state. Maintains a synchronous
 * local cache of chrome.storage.local. All reads/writes go through this module.
 *
 * Self-echo detection: on every write, the cache is updated synchronously
 * BEFORE the async chrome.storage.local.set(). When chrome.storage.onChanged
 * fires back, we compare newValue against the cache — if they match, the
 * change originated from this context and subscribers are NOT notified.
 *
 * Subscribers receive only real changes (from other tabs/contexts) via
 * onChange(callback). The callback receives (key, newValue, oldValue).
 *
 * Storage schema:
 * {
 *   "settings": { BLUR_RADIUS, TRANSITION_DURATION, ... (UPPER_SNAKE_CASE) },
 *   "rules": [ { id, name, pattern, patternType, settings }, ... ],
 *   "blurred_items": { "hostname": [{ type, name, selector|id, ... }, ...] },
 *   "blur_all_hosts": { "hostname": true }
 * }
 *
 * Exposed as blsi.Storage (IIFE — no ES module syntax).
 */

const Storage = (() => {
  'use strict';

  const MSG = blsi;

  // -------------------------------------------------------------------------
  // Private: validation helpers
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
  // Private: local cache + change notification
  // -------------------------------------------------------------------------

  /** Local cache mirroring chrome.storage.local for tracked keys. */
  var _cache = {
    settings: null,
    rules: null,
    blurred_items: null,
    blur_all_hosts: null,
  };

  /** Tracked storage keys. */
  var _TRACKED_KEYS = ['settings', 'rules', 'blurred_items', 'blur_all_hosts'];

  /** Subscriber callback: function(key, newValue, oldValue) */
  var _onChange = null;

  /** Deep equality check via JSON (safe for our plain data types). */
  function _deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == b;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // -------------------------------------------------------------------------
  // Private: Promise wrapper for chrome.storage.local
  // -------------------------------------------------------------------------

  function _storageGet(key) {
    return new Promise(function(resolve) {
      chrome.storage.local.get(key, function(result) { resolve(result); });
    });
  }

  function _storageSet(data) {
    return new Promise(function(resolve) {
      chrome.storage.local.set(data, function() { resolve(); });
    });
  }

  // -------------------------------------------------------------------------
  // chrome.storage.onChanged — self-echo detection via cache comparison
  // -------------------------------------------------------------------------

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;

    for (var i = 0; i < _TRACKED_KEYS.length; i++) {
      var key = _TRACKED_KEYS[i];
      if (!(key in changes)) continue;

      var newValue = changes[key].newValue;
      if (newValue === undefined) newValue = null;

      // Self-echo: our own write already updated the cache to this value
      if (_deepEqual(_cache[key], newValue)) continue;

      // Real change from another context — update cache and notify
      var oldValue = _cache[key];
      _cache[key] = newValue;

      if (_onChange) {
        _onChange(key, newValue, oldValue);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Public: cache initialization + subscription
  // -------------------------------------------------------------------------

  /**
   * Populate cache from storage. Call once at startup before subscribing.
   */
  async function initCache() {
    var result = await _storageGet(_TRACKED_KEYS);
    _cache.settings = result.settings || null;
    _cache.rules = result.rules || null;
    _cache.blurred_items = result.blurred_items || null;
    _cache.blur_all_hosts = result.blur_all_hosts || null;
  }

  /**
   * Reset all cache entries to null. Used by tests between runs to force
   * re-reads from the (mocked) storage layer. Safe in production but unused.
   */
  function _resetCache() {
    _cache.settings = null;
    _cache.rules = null;
    _cache.blurred_items = null;
    _cache.blur_all_hosts = null;
  }

  /**
   * Subscribe to real (non-echo) storage changes.
   * callback(key, newValue, oldValue)
   */
  function onChange(callback) {
    _onChange = callback;
  }

  /**
   * Synchronous read of blur-all state from cache.
   */
  function getCachedBlurState(hostname) {
    var hosts = _cache.blur_all_hosts || {};
    return !!hosts[hostname];
  }

  // -------------------------------------------------------------------------
  // Public API — blur items
  // -------------------------------------------------------------------------

  async function saveBlurItem(hostname, item) {
    if (!hostname || !item) return;
    if (!_isValidHostname(hostname) || !_isValidBlurItem(item)) return;

    // Shallow-copy cache to avoid mutating it before we're ready
    var map;
    if (_cache.blurred_items !== null) {
      map = Object.assign({}, _cache.blurred_items);
    } else {
      var result = await _storageGet('blurred_items');
      map = result.blurred_items || {};
    }

    var list = (map[hostname] || []).slice();
    if (list.length >= PER_HOST_ITEM_LIMIT) return;

    var newId = _getItemId(item);
    if (!list.some(function(existing) { return _getItemId(existing) === newId; })) {
      list.push(item);
    }

    map[hostname] = list;

    // Synchronous cache update BEFORE async write
    _cache.blurred_items = map;
    await _storageSet({ blurred_items: map });
  }

  async function removeBlurItem(hostname, itemId) {
    if (!hostname || !itemId) return;
    if (!_isValidHostname(hostname)) return;

    var map;
    if (_cache.blurred_items !== null) {
      map = Object.assign({}, _cache.blurred_items);
    } else {
      var result = await _storageGet('blurred_items');
      map = result.blurred_items || {};
    }

    // .filter() already returns a new array — no .slice() needed
    var list = (map[hostname] || []).filter(
      function(item) { return _getItemId(item) !== itemId; }
    );

    if (list.length > 0) {
      map[hostname] = list;
    } else {
      delete map[hostname];
    }

    _cache.blurred_items = map;
    await _storageSet({ blurred_items: map });
  }

  async function getBlurItems(hostname) {
    if (!hostname) return [];
    if (_cache.blurred_items !== null) {
      return (_cache.blurred_items[hostname] || []).slice();
    }
    var result = await _storageGet('blurred_items');
    var map = result.blurred_items || {};
    _cache.blurred_items = map;
    return (map[hostname] || []).slice();
  }

  async function clearHost(hostname) {
    if (!hostname) return;
    if (!_isValidHostname(hostname)) return;

    var map;
    if (_cache.blurred_items !== null) {
      map = Object.assign({}, _cache.blurred_items);
    } else {
      var result = await _storageGet('blurred_items');
      map = result.blurred_items || {};
    }

    delete map[hostname];

    _cache.blurred_items = map;
    await _storageSet({ blurred_items: map });
  }

  async function clearAll() {
    _cache.blurred_items = {};
    await _storageSet({ blurred_items: {} });
  }

  // -------------------------------------------------------------------------
  // Public API — settings
  // -------------------------------------------------------------------------

  async function getSettings() {
    var saved;
    if (_cache.settings !== null) {
      saved = _cache.settings;
    } else {
      var result = await _storageGet('settings');
      saved = result.settings || {};
      _cache.settings = saved;
    }
    var merged = MSG.deepMerge(MSG.DEFAULT_SETTINGS, saved);
    return MSG.validateSettings(merged);
  }

  async function saveSettings(fullSettings) {
    if (!fullSettings || typeof fullSettings !== 'object') return;
    var validated = MSG.validateSettings(fullSettings);

    _cache.settings = validated;
    await _storageSet({ settings: validated });
  }

  // -------------------------------------------------------------------------
  // Public API — URL rules
  // -------------------------------------------------------------------------

  async function getRules() {
    if (_cache.rules !== null) {
      return Array.isArray(_cache.rules) ? _cache.rules.slice() : [];
    }
    var result = await _storageGet('rules');
    var rules = Array.isArray(result.rules) ? result.rules : [];
    _cache.rules = rules;
    return rules.slice();
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

    _cache.rules = sanitized;
    await _storageSet({ rules: sanitized });
  }

  // -------------------------------------------------------------------------
  // Public API — blur-all state per hostname
  // -------------------------------------------------------------------------

  async function getBlurState(hostname) {
    if (!hostname) return false;
    if (_cache.blur_all_hosts !== null) {
      return !!(_cache.blur_all_hosts[hostname]);
    }
    var result = await _storageGet('blur_all_hosts');
    var hosts = result.blur_all_hosts || {};
    _cache.blur_all_hosts = hosts;
    return !!hosts[hostname];
  }

  async function saveBlurState(hostname, blurAll) {
    if (!hostname) return;
    if (!_isValidHostname(hostname)) return;

    var hosts;
    if (_cache.blur_all_hosts !== null) {
      hosts = Object.assign({}, _cache.blur_all_hosts);
    } else {
      var result = await _storageGet('blur_all_hosts');
      hosts = result.blur_all_hosts || {};
    }

    if (blurAll) {
      hosts[hostname] = true;
    } else {
      delete hosts[hostname];
    }

    _cache.blur_all_hosts = hosts;
    await _storageSet({ blur_all_hosts: hosts });
  }

  // -------------------------------------------------------------------------
  // Expose public API
  // -------------------------------------------------------------------------
  return {
    initCache,
    _resetCache,
    onChange,
    getCachedBlurState,
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

blsi.Storage = Storage;
