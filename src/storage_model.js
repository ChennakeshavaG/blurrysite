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
 * Popup debouncing: callers use Model.debounced_save(patch, 150) for slider/toggle
 * changes that fire rapidly (e.g. blur-radius drag). Direct writes use Model.save().
 *
 * Exposed as blsi.Model (IIFE — no ES module syntax).
 * Must load after: constants.js, action_registry.js, url_matcher.js.
 */

const StorageModel = (() => {
  'use strict';

  const STORAGE_KEY  = 'blsi_model';
  const ITEM_LIMIT   = 10;
  const RULES_LIMIT  = 200;

  // ── Private cache + subscriber ─────────────────────────────────────────────
  var _cache     = null;   // null = not yet initialised
  var _on_change = null;   // function(newModel, oldModel) | null

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
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;

    var new_val = changes[STORAGE_KEY].newValue || null;
    // Self-echo: our own write already updated _cache to this value
    if (_deep_equal(_cache, new_val)) return;

    var old_model = _cache;
    _cache = new_val ? blsi.validate_model(new_val) : null;
    if (_on_change) _on_change(_cache, old_model);
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

  // ── Private: site_rules helpers ────────────────────────────────────────────
  function _find_exact_idx(hostname) {
    var rules = get().site_rules || [];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].hostname_type === blsi.pattern_types.exact &&
          rules[i].hostname_value === hostname) return i;
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
    resolved.blur_mode = m.blur_all.settings.blur_mode;

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

    // ── 5. automate feature settings ──────────────────────────────────────
    resolved.automate_screen_share = m.automate.settings.screen_share;
    resolved.automate_idle         = m.automate.settings.idle;
    resolved.automate_tab_switch   = m.automate.settings.tab_switch;

    // ── 5b. automate_blur — per-hostname transient trigger state ──────────
    var automate_entry = (m.automate_blur || {})[hostname] || {};
    resolved.automate_blur_active   = !!(automate_entry.idle || automate_entry.tab_switch || automate_entry.screen_share);
    resolved.automate_blur_triggers = {
      idle:         !!automate_entry.idle,
      tab_switch:   !!automate_entry.tab_switch,
      screen_share: !!automate_entry.screen_share,
    };

    // ── 6. shortcuts ───────────────────────────────────────────────────────
    resolved.shortcuts = m.shortcuts || {};

    // ── 7. wildcard / regex site_rule override (first match wins) ─────────
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

    // ── 8. exact hostname site_rule ────────────────────────────────────────
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

    // ── 9. blur_all_active for this hostname ───────────────────────────────
    // exact.blur_all overrides global default; null = inherit global.
    // automate_blur triggers OR on top — never clobber manual preference.
    var manual_blur = exact
      ? (exact.blur_all !== null ? !!exact.blur_all : m.blur_all.status)
      : m.blur_all.status;
    resolved.blur_all_active = manual_blur || resolved.automate_blur_active;

    // ── 10. blur items for this hostname ───────────────────────────────────
    // Gated on pick_and_blur.status — items are "paused" (not applied) when off.
    resolved.blur_items = (exact && m.pick_and_blur.status) ? (exact.items || []) : [];

    return resolved;
  }

  // ── Public: blur items (compat + content_script use) ──────────────────────
  function _is_valid_hostname(h) {
    return typeof h === 'string' && h.length > 0 && h.length <= 253 &&
      h !== '__proto__' && h !== 'constructor' && h !== 'prototype';
  }

  function _get_item_id(item) {
    return item.type === 'dynamic' ? item.selector : item.id;
  }

  function _is_valid_item(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'dynamic') {
      return typeof item.selector === 'string' && item.selector.length > 0 &&
        item.selector.length <= 2000 &&
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

  async function get_blur_items(hostname) {
    var entry = get_site_entry(hostname);
    return entry ? (entry.items || []).slice() : [];
  }

  function get_cached_blur_state(hostname) {
    var entry = get_site_entry(hostname);
    if (entry && typeof entry.blur_all === 'boolean') return entry.blur_all;
    return get().blur_all.status;
  }

  async function get_blur_state(hostname) {
    return get_cached_blur_state(hostname);
  }

  async function save_blur_state(hostname, is_active) {
    if (!_is_valid_hostname(hostname)) return;
    await set_site_entry(hostname, { blur_all: !!is_active });
  }

  // ── Public: automate_blur CRUD ─────────────────────────────────────────────

  async function save_automate_blur(hostname, trigger, is_active) {
    if (!_is_valid_hostname(hostname)) return;
    var valid = { idle: true, tab_switch: true, screen_share: true };
    if (!valid[trigger]) return;
    var current = get();
    var ab      = Object.assign({}, current.automate_blur || {});
    var entry   = Object.assign({ idle: false, tab_switch: false, screen_share: false }, ab[hostname] || {});
    entry[trigger] = !!is_active;
    ab[hostname] = entry;
    await _write(Object.assign({}, current, { automate_blur: ab }));
  }

  async function patch_automate_blur(hostname, patch) {
    if (!_is_valid_hostname(hostname)) return;
    var current = get();
    var ab      = Object.assign({}, current.automate_blur || {});
    var entry   = Object.assign({ idle: false, tab_switch: false, screen_share: false }, ab[hostname] || {});
    var valid   = { idle: true, tab_switch: true, screen_share: true };
    for (var k in patch) { if (valid[k]) entry[k] = !!patch[k]; }
    ab[hostname] = entry;
    await _write(Object.assign({}, current, { automate_blur: ab }));
  }

  async function clear_automate_blur(hostname) {
    if (!_is_valid_hostname(hostname)) return;
    var current = get();
    var ab = Object.assign({}, current.automate_blur || {});
    delete ab[hostname];
    await _write(Object.assign({}, current, { automate_blur: ab }));
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
    var ab = Object.assign({}, current.automate_blur || {});
    delete ab[hostname];
    await _write(Object.assign({}, current, { site_rules: next_rules, automate_blur: ab }));
  }

  async function clear_all() {
    var current = get();
    var next_rules = current.site_rules.map(function(r) {
      if (r.hostname_type !== blsi.pattern_types.exact) return r;
      return Object.assign({}, r, { items: [], blur_all: null });
    });
    await _write(Object.assign({}, current, { site_rules: next_rules, automate_blur: {} }));
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
  function _reset_cache() { _cache = null; }

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
    // Resolve (content_script)
    resolve,
    // Blur items
    get_blur_items,
    get_cached_blur_state,
    get_blur_state,
    save_blur_state,
    save_blur_item,
    remove_blur_item,
    clear_host,
    clear_all,
    // Automate blur trigger state
    save_automate_blur,
    patch_automate_blur,
    clear_automate_blur,
    // URL rules
    get_rules,
    save_rules,
    // Test
    _reset_cache,
  };
})();

blsi.Model = StorageModel;
