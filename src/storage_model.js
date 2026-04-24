/**
 * storage_model.js — Blurry Site Storage Model
 *
 * Single source of truth for all persisted state. Uses one chrome.storage.local
 * key ("blsi_model") with a feature-grouped shape:
 *   { settings, blur_all, pick_and_blur, auto_detect_pii, automate, shortcuts, site_rules }
 *
 * Architecture:
 *   INPUT  (popup / automate / content_script) → writes via Model.*
 *   STORAGE change fires onChange(newModel, oldModel)
 *   OUTPUT (content_script) → Model.resolve(hostname, url) → Engine.handleSite(resolved)
 *
 * Self-echo detection: cache is updated synchronously BEFORE the async storage
 * write. When chrome.storage.onChanged fires back, we deep-compare against cache —
 * if they match, the change was ours and subscribers are NOT notified.
 *
 * Popup debouncing: callers use Model.debounced_patch(section, delta) for slider/toggle
 * changes that fire rapidly (e.g. blur-radius drag). Direct writes use Model.patch_section().
 *
 * Exposed as blsi.Model (IIFE — no ES module syntax).
 * Must load after: constants.js, action_registry.js, url_matcher.js.
 */

const StorageModel = (() => {
  'use strict';

  const STORAGE_KEY         = 'blsi_model';
  const AUTOMATE_SESSION_KEY = 'blsi_automate_blur';
  const ITEM_LIMIT   = 10;
  const RULES_LIMIT  = 200;

  // ── Private cache + subscriber ─────────────────────────────────────────────
  var _cache          = null;   // null = not yet initialised
  var _automate_cache = {};     // mirrors chrome.storage.session blsi_automate_blur
  var _on_change      = null;   // function(newModel, oldModel) | null

  // ── Chrome storage wrappers ────────────────────────────────────────────────
  function _storage_get() {
    return new Promise(function(resolve) {
      chrome.storage.local.get(STORAGE_KEY, function(result) {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  function _storage_set(model) {
    return new Promise(function(resolve) {
      var payload = {};
      payload[STORAGE_KEY] = model;
      chrome.storage.local.set(payload, function() { resolve(); });
    });
  }

  // ── Session storage helpers (automate_blur lives here; cleared on browser close) ─
  function _session_get() {
    return new Promise(function(resolve) {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(AUTOMATE_SESSION_KEY, function(r) {
          resolve((r && r[AUTOMATE_SESSION_KEY]) || {});
        });
      } else {
        resolve({});
      }
    });
  }

  function _session_set(data) {
    return new Promise(function(resolve) {
      if (chrome.storage && chrome.storage.session) {
        var payload = {};
        payload[AUTOMATE_SESSION_KEY] = data;
        chrome.storage.session.set(payload, function() { resolve(); });
      } else {
        resolve();
      }
    });
  }

  function _deep_equal(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == b;
    if (typeof a !== typeof b || typeof a !== 'object') return false;
    var a_arr = Array.isArray(a), b_arr = Array.isArray(b);
    if (a_arr !== b_arr) return false;
    if (a_arr) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!_deep_equal(a[i], b[i])) return false;
      }
      return true;
    }
    var a_keys = Object.keys(a), b_keys = Object.keys(b);
    if (a_keys.length !== b_keys.length) return false;
    for (var k = 0; k < a_keys.length; k++) {
      var key = a_keys[k];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!_deep_equal(a[key], b[key])) return false;
    }
    return true;
  }

  // ── chrome.storage.onChanged — self-echo detection ─────────────────────────
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && STORAGE_KEY in changes) {
      var new_val = changes[STORAGE_KEY].newValue || null;
      // Self-echo: our own write already updated _cache to this value
      if (_deep_equal(_cache, new_val)) return;
      var old_model = _cache;
      _cache = new_val ? blsi.validate_model(new_val) : null;
      if (_on_change) _on_change(_cache, old_model);
    }

    if (area === 'session' && AUTOMATE_SESSION_KEY in changes) {
      var new_automate = changes[AUTOMATE_SESSION_KEY].newValue || {};
      // Self-echo: our own _session_set already updated _automate_cache
      if (_deep_equal(_automate_cache, new_automate)) return;
      _automate_cache = new_automate;
      // Notify subscriber so content_script re-resolves and re-syncs blur state
      if (_on_change) _on_change(_cache, _cache);
    }
  });

  // ── Public: init + subscribe ───────────────────────────────────────────────

  /**
   * Load model from storage into cache. Call once at startup before subscribing.
   * Seeds default model if storage is empty.
   */
  async function init_cache() {
    var raw = await _storage_get();
    if (raw) {
      _cache = blsi.validate_model(raw);
      if (!_deep_equal(raw, _cache)) await _storage_set(_cache);
    } else {
      _cache = blsi.build_default_model();
      await _storage_set(_cache);
    }
    // Load per-hostname automate trigger state from session storage.
    // Session storage is cleared on browser close → no stale triggers across restarts.
    _automate_cache = await _session_get();
  }

  /** Subscribe to real (non-echo) storage changes from other contexts. */
  function on_change(cb) { _on_change = cb; }

  /** Synchronous read of current cached model. */
  function get() {
    return _cache || blsi.build_default_model();
  }

  // ── Private: validated write ───────────────────────────────────────────────
  async function _write(next) {
    var validated = blsi.validate_model(next);
    var _prev = _cache;
    _cache = validated;
    try {
      await _storage_set(validated);
    } catch (e) {
      _cache = _prev;
      throw e;
    }
  }

  // ── Debounce helper ────────────────────────────────────────────────────────
  var _debounce_timers = {};

  /**
   * Debounced section patch — coalesces rapid writes (e.g. slider drags).
   * @param {string} section  Top-level model key to patch ('settings', 'blur_all', etc.)
   * @param {object} patch    Partial object deep-merged into section
   * @param {number} delay_ms Debounce window in ms (default 150)
   */
  function debounced_patch(section, patch, delay_ms) {
    if (delay_ms === undefined) delay_ms = 150;
    var _patch = Object.assign({}, patch);
    clearTimeout(_debounce_timers[section]);
    _debounce_timers[section] = setTimeout(function() {
      delete _debounce_timers[section];
      patch_section(section, _patch);
    }, delay_ms);
  }

  // ── Public: model-level writes ─────────────────────────────────────────────

  /**
   * Deep-merge patch into one top-level section and write the full model.
   * @param {string} section  e.g. 'settings', 'blur_all', 'pick_and_blur'
   * @param {object} patch    Partial section object
   */
  async function patch_section(section, patch) {
    var current = get();
    var next    = Object.assign({}, current);
    next[section] = blsi.deep_merge(current[section] || {}, patch);
    await _write(next);
  }

  // ── Snapshot key set ──────────────────────────────────────────────────────
  // Keys captured from global settings into a site rule snapshot.
  // Source of truth: docs/site-rules-snapshot-plan.md §Snapshot Key Set.
  var SNAPSHOT_KEYS = [
    'blur_radius',
    'blur_mode',
    'reveal_mode',
    'thorough_blur',
    'blur_categories',   // object — deep copy
    'pick_blur_type',
    'pick_blur_color',   // object — deep copy
    'pii_mode',
  ];

  // ── Private: site_rules helpers ────────────────────────────────────────────
  function _find_exact_idx(hostname) {
    var rules = get().site_rules || [];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].hostname_type === blsi.pattern_types.exact &&
          rules[i].hostname_value === hostname) return i;
    }
    return -1;
  }

  /**
   * Find rule index by hostname_value + hostname_type (works for all rule types).
   * Returns -1 if not found.
   */
  function _find_rule_idx(hostname_value, hostname_type) {
    var rules = get().site_rules || [];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].hostname_value === hostname_value &&
          rules[i].hostname_type  === hostname_type) return i;
    }
    return -1;
  }

  // ── Public: site_rules API ─────────────────────────────────────────────────

  function get_all_site_rules() { return (get().site_rules || []).slice(); }

  function get_site_entry(hostname) {
    var idx = _find_exact_idx(hostname);
    return idx >= 0 ? get().site_rules[idx] : null;
  }

  async function set_site_entry(hostname, patch) {
    var current = get();
    var rules   = current.site_rules.slice();
    var idx     = _find_exact_idx(hostname);
    var base    = idx >= 0 ? rules[idx] : {
      hostname_value: hostname,
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      settings:       {},
    };
    var merged = blsi.deep_merge(base, patch);
    var next_rules = idx >= 0
      ? rules.map(function(r, i) { return i === idx ? merged : r; })
      : rules.concat([merged]);
    await _write(Object.assign({}, current, { site_rules: next_rules }));
  }

  async function remove_site_entry(hostname) {
    var current = get();
    var next_rules = current.site_rules.filter(function(r) {
      return !(r.hostname_type === blsi.pattern_types.exact && r.hostname_value === hostname);
    });
    if (next_rules.length === current.site_rules.length) return;
    await _write(Object.assign({}, current, { site_rules: next_rules }));
  }

  // ── Public: snapshot API ──────────────────────────────────────────────────

  /**
   * Capture a settings snapshot from the current cached global model.
   * Returns a plain object containing only SNAPSHOT_KEYS, with deep copies
   * of any nested objects (blur_categories, pick_blur_color).
   *
   * Key mapping from model sections:
   *   blur_radius     ← m.settings.blur_radius
   *   blur_mode       ← m.blur_all.settings.blur_mode
   *   reveal_mode     ← m.settings.reveal_mode
   *   thorough_blur   ← m.settings.thorough_blur
   *   blur_categories ← m.blur_all.settings.blur_categories  (deep copy)
   *   pick_blur_type  ← m.pick_and_blur.settings.blur_type
   *   pick_blur_color ← m.pick_and_blur.settings.blur_color  (deep copy)
   *   pii_mode        ← m.auto_detect_pii.settings.pii_mode
   */
  function capture_snapshot() {
    var m = get();
    var snap = {};
    snap.blur_radius    = m.settings.blur_radius;
    snap.blur_mode      = m.blur_all.settings.blur_mode;
    snap.reveal_mode    = m.settings.reveal_mode;
    snap.thorough_blur  = m.settings.thorough_blur;
    snap.blur_categories = JSON.parse(JSON.stringify(m.blur_all.settings.blur_categories));
    snap.pick_blur_type  = m.pick_and_blur.settings.blur_type;
    snap.pick_blur_color = JSON.parse(JSON.stringify(m.pick_and_blur.settings.blur_color));
    snap.pii_mode        = m.auto_detect_pii.settings.pii_mode;
    return snap;
  }

  /**
   * Save a settings snapshot for a site rule identified by hostname_value + hostname_type.
   * Finds the matching rule entry (creates it for exact rules if missing) and sets
   * its .settings to the provided snapshot.
   *
   * For wildcard/regex rules the caller is responsible for ensuring the rule exists
   * (via save_rules) before calling this. If not found, a new exact-type entry is
   * created (consistent with set_site_entry behaviour).
   *
   * @param {string} hostname_value  e.g. 'github.com' or '*.example.com'
   * @param {string} hostname_type   blsi.pattern_types value: 'exact'|'wildcard'|'regex'
   * @param {object} snapshot        Plain object with SNAPSHOT_KEYS
   */
  async function save_site_snapshot(hostname_value, hostname_type, snapshot) {
    if (!hostname_value || typeof hostname_value !== 'string') return;
    if (!snapshot || typeof snapshot !== 'object') return;
    var current = get();
    var rules   = current.site_rules.slice();
    var idx     = _find_rule_idx(hostname_value, hostname_type);
    if (idx >= 0) {
      var updated = Object.assign({}, rules[idx], { settings: Object.assign({}, snapshot) });
      var next_rules = rules.map(function(r, i) { return i === idx ? updated : r; });
      await _write(Object.assign({}, current, { site_rules: next_rules }));
    } else {
      // Rule not found — create new exact entry (wildcard/regex callers should
      // pre-create via save_rules; this fallback keeps exact-type APIs consistent).
      var new_entry = {
        hostname_value: hostname_value,
        hostname_type:  hostname_type || blsi.pattern_types.exact,
        blur_all:       null,
        items:          [],
        settings:       Object.assign({}, snapshot),
      };
      await _write(Object.assign({}, current, { site_rules: rules.concat([new_entry]) }));
    }
  }

  /**
   * Clear (reset to {}) the settings snapshot for a site rule.
   * No-op if the rule doesn't exist.
   *
   * @param {string} hostname_value
   * @param {string} hostname_type
   */
  async function clear_site_snapshot(hostname_value, hostname_type) {
    if (!hostname_value || typeof hostname_value !== 'string') return;
    var current = get();
    var rules   = current.site_rules.slice();
    var idx     = _find_rule_idx(hostname_value, hostname_type);
    if (idx < 0) return;
    var updated    = Object.assign({}, rules[idx], { settings: {} });
    var next_rules = rules.map(function(r, i) { return i === idx ? updated : r; });
    await _write(Object.assign({}, current, { site_rules: next_rules }));
  }

  /**
   * Return the .settings snapshot for a site rule, or null if the rule doesn't
   * exist or its settings is empty ({}).
   *
   * @param {string} hostname_value
   * @param {string} hostname_type
   * @returns {object|null}
   */
  function get_site_snapshot(hostname_value, hostname_type) {
    var rules = get().site_rules || [];
    var idx   = _find_rule_idx(hostname_value, hostname_type);
    if (idx < 0) return null;
    var s = rules[idx].settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    if (Object.keys(s).length === 0) return null;
    return Object.assign({}, s);
  }

  // ── Public: resolve (content_script entry point) ───────────────────────────
  /**
   * Merge global model + URL-matched rule + exact hostname entry into one flat
   * settings object ready for Engine.handleSite().
   *
   * Merge order (later wins):
   *   defaults → global settings → blur_all.settings → feature settings →
   *   first matching wildcard/regex site_rule.settings → exact hostname site_rule.settings
   *
   * @param {string} hostname  e.g. 'example.com'
   * @param {string} url       Full URL for wildcard/regex rule matching
   * @returns {object} Flat resolved settings object
   */
  function resolve(hostname, url) {
    var m = get();
    var resolved = {};

    // ── 1. Global settings ─────────────────────────────────────────────────
    Object.assign(resolved, m.settings);

    // ── 2. blur_all feature settings ──────────────────────────────────────
    resolved.blur_mode       = m.blur_all.settings.blur_mode;
    resolved.blur_categories = m.blur_all.settings.blur_categories;

    // ── 3. pick_and_blur feature settings ─────────────────────────────────
    resolved.pick_blur_enabled = m.pick_and_blur.status;
    resolved.picker_mode       = m.pick_and_blur.settings.picker_mode;
    resolved.pick_blur_type    = m.pick_and_blur.settings.blur_type;
    resolved.pick_blur_color   = m.pick_and_blur.settings.blur_color;

    // ── 4. auto_detect_pii feature settings ───────────────────────────────
    resolved.pii_enabled          = m.auto_detect_pii.status;
    resolved.pii_email            = m.auto_detect_pii.settings.email;
    resolved.pii_numeric          = m.auto_detect_pii.settings.numeric;
    resolved.pii_mode             = m.auto_detect_pii.settings.pii_mode;
    resolved.pii_redaction_color  = m.auto_detect_pii.settings.pii_redaction_color;

    // ── 5. shortcuts ───────────────────────────────────────────────────────
    resolved.shortcuts = m.shortcuts || {};

    // ── 6. wildcard / regex site_rule override (first match wins) ─────────
    var site_rules = m.site_rules || [];
    if (url && globalThis.blsi && blsi.UrlMatcher) {
      for (var i = 0; i < site_rules.length; i++) {
        var rule = site_rules[i];
        if (rule.hostname_type === blsi.pattern_types.exact) continue;
        if (blsi.UrlMatcher.matchesPattern(url, rule.hostname_value, rule.hostname_type)) {
          if (rule.settings && typeof rule.settings === 'object') {
            Object.assign(resolved, rule.settings);
          }
          break;
        }
      }
    }

    // ── 7. exact hostname site_rule ────────────────────────────────────────
    var exact = null;
    for (var j = 0; j < site_rules.length; j++) {
      if (site_rules[j].hostname_type === blsi.pattern_types.exact &&
          site_rules[j].hostname_value === hostname) {
        exact = site_rules[j];
        break;
      }
    }
    if (exact && exact.settings && typeof exact.settings === 'object') {
      Object.assign(resolved, exact.settings);
    }

    // ── 8. blur items for this hostname ────────────────────────────────────
    // Gated on pick_and_blur.status — items are "paused" (not applied) when off.
    resolved.blur_items = (exact && m.pick_and_blur.status) ? (exact.items || []) : [];

    // ── 9. automate ────────────────────────────────────────────────────────
    // Feature config (what triggers are enabled and their settings).
    resolved.automate_screen_share = m.automate.settings.screen_share;
    resolved.automate_idle         = m.automate.settings.idle;
    resolved.automate_tab_switch   = m.automate.settings.tab_switch;

    // Trigger state — _automate_cache mirrors chrome.storage.session
    // blsi_automate_blur. Cleared on browser close → no stale triggers.
    var automate_entry = (_automate_cache || {})[hostname] || {};
    resolved.automate_blur_active   = !!(automate_entry.idle || automate_entry.tab_switch || automate_entry.screen_share);
    resolved.automate_blur_triggers = {
      idle:         !!automate_entry.idle,
      tab_switch:   !!automate_entry.tab_switch,
      screen_share: !!automate_entry.screen_share,
    };

    // blur_all_active — exact.blur_all overrides global; null = inherit global.
    // Automate applies blur only when neither blur-all nor pick-and-blur is
    // already active. When it does apply, default settings are used so it
    // never overwrites the user's intentional blur configuration.
    var manual_blur         = exact
      ? (exact.blur_all !== null ? !!exact.blur_all : m.blur_all.status)
      : m.blur_all.status;
    var blur_present        = manual_blur || m.pick_and_blur.status;
    var automate_needs_blur = resolved.automate_blur_active && !blur_present;

    resolved.blur_all_active       = manual_blur || automate_needs_blur;
    resolved.automate_blur_only    = !!automate_needs_blur;
    resolved.automate_blur_skipped = resolved.automate_blur_active && !!blur_present;

    if (automate_needs_blur) {
      var _def = blsi.DEFAULT_MODEL;
      var _ds  = _def.settings;
      var _dbs = _def.blur_all.settings;
      resolved.blur_mode           = _dbs.blur_mode;
      resolved.blur_categories     = _dbs.blur_categories;
      resolved.blur_radius         = _ds.blur_radius;
      resolved.thorough_blur       = _ds.thorough_blur;
      resolved.reveal_mode         = _ds.reveal_mode;
      resolved.transition_duration = _ds.transition_duration;
      resolved.redaction_color     = _ds.redaction_color;
      resolved.highlight_color     = _ds.highlight_color;
    }

    return resolved;
  }

  // ── Public: blur items (compat + content_script use) ──────────────────────
  function _is_valid_hostname(h) {
    return typeof h === 'string' && h.length > 0 && h.length <= 253 &&
      h !== '__proto__' && h !== 'constructor' && h !== 'prototype';
  }

  function _get_item_id(item) {
    if (item.type === 'dynamic') {
      return item.selectors ? item.selectors[0] : item.selector;
    }
    return item.id;
  }

  function _is_valid_item(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'dynamic') {
      var name_ok = typeof item.name === 'string' && item.name.length <= 100;
      // New shape: selectors array
      if (Array.isArray(item.selectors)) {
        return name_ok && item.selectors.length > 0 && item.selectors.length <= 6 &&
          item.selectors.every(function(s) {
            return typeof s === 'string' && s.length > 0 && s.length <= 2000;
          });
      }
      // Legacy shape: single selector string
      return name_ok && typeof item.selector === 'string' &&
        item.selector.length > 0 && item.selector.length <= 2000;
    }
    if (item.type === 'sticky') {
      return typeof item.id === 'string' && item.id.length > 0 &&
        typeof item.name === 'string' && item.name.length <= 100 &&
        typeof item.x === 'number' && typeof item.y === 'number' &&
        typeof item.width === 'number' && typeof item.height === 'number';
    }
    return false;
  }

  async function get_blur_items(hostname) {
    var entry = get_site_entry(hostname);
    return entry ? (entry.items || []).slice() : [];
  }

  function get_cached_blur_state(hostname) {
    var entry = get_site_entry(hostname);
    if (entry && typeof entry.blur_all === 'boolean') return entry.blur_all;
    return get().blur_all.status;
  }

  async function save_blur_state(hostname, is_active) {
    if (!_is_valid_hostname(hostname)) return;
    await set_site_entry(hostname, { blur_all: !!is_active });
  }

  // ── Public: automate_blur CRUD (session storage) ──────────────────────────
  // Data lives in chrome.storage.session (blsi_automate_blur key) — cleared on
  // browser close, so stale trigger state never survives restarts or crashes.

  async function save_automate_blur(hostname, trigger, is_active) {
    if (!_is_valid_hostname(hostname)) return;
    var valid = { idle: true, tab_switch: true, screen_share: true };
    if (!valid[trigger]) return;
    var ab    = Object.assign({}, _automate_cache || {});
    var entry = Object.assign({ idle: false, tab_switch: false, screen_share: false }, ab[hostname] || {});
    entry[trigger] = !!is_active;
    ab[hostname] = entry;
    _automate_cache = ab;   // update in-memory cache immediately (self-echo guard in onChanged)
    await _session_set(ab);
  }

  async function patch_automate_blur(hostname, patch) {
    if (!_is_valid_hostname(hostname)) return;
    var ab    = Object.assign({}, _automate_cache || {});
    var entry = Object.assign({ idle: false, tab_switch: false, screen_share: false }, ab[hostname] || {});
    var valid = { idle: true, tab_switch: true, screen_share: true };
    for (var k in patch) { if (valid[k]) entry[k] = !!patch[k]; }
    ab[hostname] = entry;
    _automate_cache = ab;
    await _session_set(ab);
  }

  async function clear_automate_blur(hostname) {
    if (!_is_valid_hostname(hostname)) return;
    var ab = Object.assign({}, _automate_cache || {});
    delete ab[hostname];
    _automate_cache = ab;
    await _session_set(ab);
  }

  function get_automate_blur(hostname) {
    var entry = (_automate_cache || {})[hostname] || {};
    return {
      idle:         !!entry.idle,
      tab_switch:   !!entry.tab_switch,
      screen_share: !!entry.screen_share,
    };
  }

  async function save_blur_item(hostname, item) {
    if (!_is_valid_hostname(hostname) || !_is_valid_item(item)) return;
    var entry = get_site_entry(hostname);
    var items = entry ? entry.items : [];
    if (items.length >= ITEM_LIMIT) return;
    var new_id = _get_item_id(item);
    if (items.some(function(e) { return _get_item_id(e) === new_id; })) return;
    await set_site_entry(hostname, { items: items.concat([item]) });
  }

  async function remove_blur_item(hostname, item_id) {
    if (!_is_valid_hostname(hostname)) return;
    var entry = get_site_entry(hostname);
    if (!entry) return;
    var next_items = entry.items.filter(function(e) { return _get_item_id(e) !== item_id; });
    await set_site_entry(hostname, { items: next_items });
  }

  async function clear_host(hostname) {
    if (!_is_valid_hostname(hostname)) return;
    var current = get();
    var rules   = current.site_rules.slice();
    var idx     = _find_exact_idx(hostname);
    var base    = idx >= 0 ? rules[idx] : {
      hostname_value: hostname,
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      settings:       {},
    };
    var merged     = blsi.deep_merge(base, { items: [], blur_all: null });
    var next_rules = idx >= 0
      ? rules.map(function(r, i) { return i === idx ? merged : r; })
      : rules.concat([merged]);
    await _write(Object.assign({}, current, { site_rules: next_rules }));
    await clear_automate_blur(hostname);
  }

  async function clear_all() {
    var current = get();
    var next_rules = current.site_rules.map(function(r) {
      if (r.hostname_type !== blsi.pattern_types.exact) return r;
      return Object.assign({}, r, { items: [], blur_all: null });
    });
    await _write(Object.assign({}, current, { site_rules: next_rules }));
    // Clear all automate trigger state from session storage
    _automate_cache = {};
    await _session_set({});
  }

  // ── Public: URL rules (wildcard / regex site_rules) ────────────────────────
  async function get_rules() {
    return get().site_rules.filter(function(r) {
      return r.hostname_type !== blsi.pattern_types.exact;
    });
  }

  async function save_rules(rules) {
    if (!Array.isArray(rules)) return;
    var current    = get();
    var exact_only = current.site_rules.filter(function(r) {
      return r.hostname_type === blsi.pattern_types.exact;
    });
    var pattern_rules = rules
      .filter(function(r) {
        return r && typeof r === 'object' &&
          typeof r.hostname_value === 'string' && r.hostname_value.trim().length > 0;
      })
      .slice(0, RULES_LIMIT)
      .map(function(r) {
        var ht = (r.hostname_type === blsi.pattern_types.regex || r.hostname_type === blsi.pattern_types.wildcard)
          ? r.hostname_type : blsi.pattern_types.wildcard;
        return {
          hostname_value: r.hostname_value.trim().slice(0, 500),
          hostname_type:  ht,
          blur_all:       null,
          items:          [],
          settings: (r.settings && typeof r.settings === 'object' && !Array.isArray(r.settings))
            ? r.settings : {},
        };
      });
    // Pattern rules come first so URL matching iterates them before exact entries
    await _write(Object.assign({}, current, { site_rules: pattern_rules.concat(exact_only) }));
  }

  // ── Public: direct settings save (popup use) ───────────────────────────────
  /**
   * Merge a partial settings patch into model.settings and write.
   * Popup calls this for global settings changes (blur_radius, language, etc.).
   */
  async function save_settings(patch) {
    if (!patch || typeof patch !== 'object') return;
    await patch_section('settings', patch);
  }

  // ── Test utility ───────────────────────────────────────────────────────────
  function _reset_cache() { _cache = null; _automate_cache = {}; }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    // Init / subscribe
    init_cache,
    on_change,
    get,
    // Model writes
    patch_section,
    debounced_patch,
    save_settings,
    // Site rules
    get_all_site_rules,
    get_site_entry,
    set_site_entry,
    remove_site_entry,
    // Snapshot API
    capture_snapshot,
    save_site_snapshot,
    clear_site_snapshot,
    get_site_snapshot,
    // Resolve (content_script)
    resolve,
    // Blur items
    get_blur_items,
    get_cached_blur_state,
    save_blur_state,
    save_blur_item,
    remove_blur_item,
    clear_host,
    clear_all,
    // Automate blur trigger state (session storage — cleared on browser close)
    save_automate_blur,
    patch_automate_blur,
    clear_automate_blur,
    get_automate_blur,
    // URL rules
    get_rules,
    save_rules,
    // Test
    _reset_cache,
  };
})();

blsi.Model = StorageModel;
