/**
 * storage_model.js — Blurry Site Storage Model
 *
 * Single source of truth for all persisted state. Uses one chrome.storage.local
 * key ("blsi_model") with a feature-grouped shape:
 *   { global_default_settings, blur_all, pick_and_blur, auto_detect_pii, automate, shortcuts, site_rules }
 * pick_and_blur.items — hostname-keyed map of blur items (moved out of site_rules).
 *
 * Self-echo guard: cache updated synchronously before the async storage write;
 * onChanged compares against cache and skips subscriber when values match.
 *
 * Exposed as blsi.Model (IIFE — no ES module syntax).
 * Must load after: constants.js, action_registry.js, url_matcher.js.
 */

const StorageModel = (() => {
  "use strict";

  const STORAGE_KEY = "blsi_model";
  const AUTOMATE_SESSION_KEY = "blsi_automate_blur";
  const ITEM_LIMIT = 10;
  const RULES_LIMIT = 200;

  // ── Private state ──────────────────────────────────────────────────────────
  var _cache = null; // null = not yet initialised
  var _automate_cache = {}; // mirrors chrome.storage.session blsi_automate_blur
  var _on_change = null; // function(newModel, oldModel) | null

  // ── Storage I/O ────────────────────────────────────────────────────────────
  function _storage_get() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (result) {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  function _storage_set(model) {
    return new Promise(function (resolve, reject) {
      var payload = {};
      payload[STORAGE_KEY] = model;
      chrome.storage.local.set(payload, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  // automate_blur lives in session storage — auto-cleared on browser close/crash
  function _session_get() {
    return new Promise(function (resolve) {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(AUTOMATE_SESSION_KEY, function (r) {
          resolve((r && r[AUTOMATE_SESSION_KEY]) || {});
        });
      } else {
        resolve({});
      }
    });
  }

  function _session_set(data) {
    return new Promise(function (resolve, reject) {
      if (chrome.storage && chrome.storage.session) {
        var payload = {};
        payload[AUTOMATE_SESSION_KEY] = data;
        chrome.storage.session.set(payload, function () {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function _deep_equal(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b || typeof a !== "object") return false;
    var a_arr = Array.isArray(a),
      b_arr = Array.isArray(b);
    if (a_arr !== b_arr) return false;
    if (a_arr) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!_deep_equal(a[i], b[i])) return false;
      }
      return true;
    }
    var a_keys = Object.keys(a);
    if (a_keys.length !== Object.keys(b).length) return false;
    for (var k = 0; k < a_keys.length; k++) {
      var key = a_keys[k];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!_deep_equal(a[key], b[key])) return false;
    }
    return true;
  }

  // Validates and writes next model; rolls back _cache if the storage write fails.
  async function _write(next) {
    var validated = blsi.validate_model(next);
    var prev = _cache;
    _cache = validated;
    try {
      await _storage_set(validated);
    } catch (e) {
      _cache = prev;
      console.warn("[blsi] local storage write failed:", e.message);
    }
  }

  // Writes automate session data; rolls back _automate_cache on failure.
  async function _session_write(data) {
    var prev = _automate_cache;
    try {
      await _session_set(data);
    } catch (e) {
      _automate_cache = prev;
      console.warn("[blsi] session write failed:", e.message);
    }
  }

  // ── Storage listener ───────────────────────────────────────────────────────
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && STORAGE_KEY in changes) {
      var new_val = changes[STORAGE_KEY].newValue || null;
      if (_deep_equal(_cache, new_val)) return; // self-echo
      var old_model = _cache;
      _cache = new_val ? blsi.validate_model(new_val) : null;
      if (_on_change) _on_change(_cache, old_model);
    }

    if (area === "session" && AUTOMATE_SESSION_KEY in changes) {
      var new_automate = changes[AUTOMATE_SESSION_KEY].newValue || {};
      if (_deep_equal(_automate_cache, new_automate)) return; // self-echo
      _automate_cache = new_automate;
      // Model unchanged — pass (cache, cache) so subscriber re-resolves automate state
      if (_on_change) _on_change(_cache, _cache);
    }
  });

  // ── Init / subscribe ───────────────────────────────────────────────────────

  /** Load model from storage. Call once at startup; seeds defaults if empty. */
  async function init_cache() {
    var raw = await _storage_get();
    if (raw) {
      _cache = blsi.validate_model(raw);
      if (!_deep_equal(raw, _cache)) await _write(_cache); // migration write
    } else {
      await _write(blsi.build_default_model()); // seed write
    }
    _automate_cache = await _session_get();
  }

  /**
   * Register a storage-change callback. Single subscriber — calling twice
   * replaces the first (logs a warning). Fires in two cases:
   *   - Local model change:   cb(newModel, oldModel)  — both are full model objects
   *   - Session/automate change: cb(currentModel, currentModel) — same ref for both
   *     args because only _automate_cache changed, not the model itself.
   * _cache is already updated before cb fires, so Model.get() inside cb returns newModel.
   */
  function on_change(cb) {
    if (_on_change && _on_change !== cb) {
      console.warn("[blsi] on_change: replacing existing subscriber — only one allowed");
    }
    _on_change = cb;
  }

  /** Synchronous read of current cached model. */
  function get() {
    return _cache || blsi.build_default_model();
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * Deep-merge patch into one top-level section and write the full model.
   * @param {string} section  e.g. 'blur_all', 'pick_and_blur'
   * @param {object} patch    Partial section object
   */
  async function patch_section(section, patch) {
    var current = get();
    var next = Object.assign({}, current);
    next[section] = blsi.deep_merge(current[section] || {}, patch);
    await _write(next);
  }

  /** Merges a partial patch into global_default_settings and writes. */
  async function save_settings(patch) {
    if (!patch || typeof patch !== "object") return;
    await patch_section("global_default_settings", patch);
  }

  // ── Site rules ─────────────────────────────────────────────────────────────

  // Returns -1 if no rule with matching hostname_value + hostname_type found.
  function _find_rule_idx(hostname_value, hostname_type) {
    var rules = get().site_rules || [];
    for (var i = 0; i < rules.length; i++) {
      if (
        rules[i].hostname_value === hostname_value &&
        rules[i].hostname_type === hostname_type
      )
        return i;
    }
    return -1;
  }

  function get_all_site_rules() {
    return (get().site_rules || []).slice();
  }

  function get_site_entry(hostname) {
    var idx = _find_rule_idx(hostname, blsi.pattern_types.exact);
    return idx >= 0 ? get().site_rules[idx] : null;
  }

  async function set_site_entry(hostname, patch) {
    var current = get();
    var rules = current.site_rules.slice();
    var idx = _find_rule_idx(hostname, blsi.pattern_types.exact);
    var base =
      idx >= 0
        ? rules[idx]
        : {
            hostname_value: hostname,
            hostname_type: blsi.pattern_types.exact,
            blur_all: null,
            snapshot: {},
          };
    var merged = blsi.deep_merge(base, patch);
    var next_rules =
      idx >= 0
        ? rules.map(function (r, i) {
            return i === idx ? merged : r;
          })
        : rules.concat([merged]);
    await _write(Object.assign({}, current, { site_rules: next_rules }));
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  /**
   * Capture a settings snapshot from the current cached global model.
   * Returns { settings, blur_all, pick_and_blur } mirroring the global model
   * structure with deep copies of blur_categories and blur_color.
   * Excludes: automate, site_rules, auto_detect_pii, shortcuts, enabled, language.
   */
  function capture_snapshot() {
    var m = get();
    return {
      settings: {
        blur_radius: m.global_default_settings.blur_radius,
        reveal_mode: m.global_default_settings.reveal_mode,
        thorough_blur: m.global_default_settings.thorough_blur,
        highlight_color: m.global_default_settings.highlight_color,
        redaction_color: m.global_default_settings.redaction_color,
        tab_privacy: m.global_default_settings.tab_privacy,
        transition_duration: m.global_default_settings.transition_duration,
      },
      blur_all: {
        settings: {
          blur_mode: m.blur_all.settings.blur_mode,
          blur_categories: JSON.parse(
            JSON.stringify(m.blur_all.settings.blur_categories),
          ),
        },
      },
      pick_and_blur: {
        status: m.pick_and_blur.status,
        settings: {
          blur_type: m.pick_and_blur.settings.blur_type,
          blur_color: JSON.parse(
            JSON.stringify(m.pick_and_blur.settings.blur_color),
          ),
          picker_mode: m.pick_and_blur.settings.picker_mode,
        },
      },
    };
  }

  /**
   * Save a settings snapshot for a rule (hostname_value + hostname_type).
   * For wildcard/regex rules, ensure the rule exists via save_rules() first.
   *
   * @param {string} hostname_value  e.g. 'github.com' or '*.example.com'
   * @param {string} hostname_type   blsi.pattern_types value
   * @param {object} snapshot        { settings, blur_all, pick_and_blur }
   */
  async function save_site_snapshot(hostname_value, hostname_type, snapshot) {
    if (!hostname_value || typeof hostname_value !== "string") return;
    if (!snapshot || typeof snapshot !== "object") return;
    var current = get();
    var rules = current.site_rules.slice();
    var idx = _find_rule_idx(hostname_value, hostname_type);
    if (idx >= 0) {
      var updated = Object.assign({}, rules[idx], {
        snapshot: Object.assign({}, snapshot),
      });
      var next_rules = rules.map(function (r, i) {
        return i === idx ? updated : r;
      });
      await _write(Object.assign({}, current, { site_rules: next_rules }));
    } else {
      // Rule not found — create new exact entry (wildcard/regex callers should
      // pre-create via save_rules; this fallback keeps exact-type APIs consistent).
      var new_entry = {
        hostname_value: hostname_value,
        hostname_type: hostname_type || blsi.pattern_types.exact,
        blur_all: null,
        snapshot: Object.assign({}, snapshot),
      };
      await _write(
        Object.assign({}, current, { site_rules: rules.concat([new_entry]) }),
      );
    }
  }

  /** Returns the .snapshot for a rule, or null if absent / empty. */
  function get_site_snapshot(hostname_value, hostname_type) {
    var rules = get().site_rules || [];
    var idx = _find_rule_idx(hostname_value, hostname_type);
    if (idx < 0) return null;
    var s = rules[idx].snapshot;
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    if (Object.keys(s).length === 0) return null;
    return Object.assign({}, s);
  }

  // ── Resolve ────────────────────────────────────────────────────────────────

  // Merges a stored snapshot into a resolved settings object in-place.
  function _apply_snapshot(snapshot, resolved) {
    if (!snapshot || typeof snapshot !== "object") return;
    if (snapshot.settings && typeof snapshot.settings === "object") {
      Object.assign(resolved, snapshot.settings);
    }
    if (
      snapshot.blur_all &&
      snapshot.blur_all.settings &&
      typeof snapshot.blur_all.settings === "object"
    ) {
      var ba = snapshot.blur_all.settings;
      if (ba.blur_mode !== undefined) resolved.blur_mode = ba.blur_mode;
      if (ba.blur_categories !== undefined)
        resolved.blur_categories = ba.blur_categories;
    }
    if (snapshot.pick_and_blur) {
      var pb = snapshot.pick_and_blur;
      if (typeof pb.status === "boolean")
        resolved.pick_blur_enabled = pb.status;
      if (pb.settings && typeof pb.settings === "object") {
        if (pb.settings.blur_type !== undefined)
          resolved.pick_blur_type = pb.settings.blur_type;
        if (pb.settings.blur_color !== undefined)
          resolved.pick_blur_color = pb.settings.blur_color;
        if (pb.settings.picker_mode !== undefined)
          resolved.picker_mode = pb.settings.picker_mode;
      }
    }
  }

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
    Object.assign(resolved, m.global_default_settings);

    // ── 2. blur_all feature settings ──────────────────────────────────────
    resolved.blur_mode = m.blur_all.settings.blur_mode;
    resolved.blur_categories = m.blur_all.settings.blur_categories;

    // ── 3. pick_and_blur feature settings ─────────────────────────────────
    resolved.pick_blur_enabled = m.pick_and_blur.status;
    resolved.picker_mode = m.pick_and_blur.settings.picker_mode;
    resolved.pick_blur_type = m.pick_and_blur.settings.blur_type;
    resolved.pick_blur_color = m.pick_and_blur.settings.blur_color;

    // ── 4. auto_detect_pii feature settings ───────────────────────────────
    resolved.pii_email = m.auto_detect_pii.settings.email;
    resolved.pii_numeric = m.auto_detect_pii.settings.numeric;
    resolved.pii_mode = m.auto_detect_pii.settings.pii_mode;
    resolved.pii_redaction_color =
      m.auto_detect_pii.settings.pii_redaction_color;

    // ── 5. shortcuts ───────────────────────────────────────────────────────
    resolved.shortcuts = m.shortcuts || {};

    // ── 6. wildcard / regex site_rule override (first match wins) ─────────
    var site_rules = m.site_rules || [];
    if (url && globalThis.blsi && blsi.UrlMatcher) {
      for (var i = 0; i < site_rules.length; i++) {
        var rule = site_rules[i];
        if (rule.hostname_type === blsi.pattern_types.exact) continue;
        if (
          blsi.UrlMatcher.matchesPattern(
            url,
            rule.hostname_value,
            rule.hostname_type,
          )
        ) {
          _apply_snapshot(rule.snapshot, resolved);
          break;
        }
      }
    }

    // ── 7. exact hostname site_rule ────────────────────────────────────────
    var exact = null;
    for (var j = 0; j < site_rules.length; j++) {
      if (
        site_rules[j].hostname_type === blsi.pattern_types.exact &&
        site_rules[j].hostname_value === hostname
      ) {
        exact = site_rules[j];
        break;
      }
    }
    _apply_snapshot(exact && exact.snapshot, resolved);

    // ── 8. blur items for this hostname ────────────────────────────────────
    // Gated on pick_and_blur.status — items are "paused" (not applied) when off.
    resolved.blur_items = m.pick_and_blur.status
      ? (m.pick_and_blur.items || {})[hostname] || []
      : [];

    // ── 9. automate ────────────────────────────────────────────────────────
    resolved.automate_screen_share = m.automate.settings.screen_share;
    resolved.automate_idle = m.automate.settings.idle;
    resolved.automate_tab_switch = m.automate.settings.tab_switch;

    var automate_entry = (_automate_cache || {})[hostname] || {};
    resolved.automate_blur_active = !!(
      automate_entry.idle ||
      automate_entry.tab_switch ||
      automate_entry.screen_share
    );
    resolved.automate_blur_triggers = {
      idle: !!automate_entry.idle,
      tab_switch: !!automate_entry.tab_switch,
      screen_share: !!automate_entry.screen_share,
    };

    // blur_all_active — exact.blur_all overrides global; null = inherit global.
    // Automate applies blur only when neither blur-all nor pick-and-blur is
    // already active. When it does apply, default settings are used so it
    // never overwrites the user's intentional blur configuration.
    var manual_blur = exact
      ? exact.blur_all !== null
        ? !!exact.blur_all
        : m.blur_all.status
      : m.blur_all.status;
    var blur_present = manual_blur || m.pick_and_blur.status;
    var automate_needs_blur = resolved.automate_blur_active && !blur_present;

    resolved.blur_all_active = manual_blur || automate_needs_blur;
    resolved.automate_blur_only = !!automate_needs_blur;
    resolved.automate_blur_skipped =
      resolved.automate_blur_active && !!blur_present;

    if (automate_needs_blur) {
      var def = blsi.DEFAULT_MODEL;
      var ds = def.global_default_settings;
      var dbs = def.blur_all.settings;
      resolved.blur_mode = dbs.blur_mode;
      resolved.blur_categories = dbs.blur_categories;
      resolved.blur_radius = ds.blur_radius;
      resolved.thorough_blur = ds.thorough_blur;
      resolved.reveal_mode = ds.reveal_mode;
      resolved.transition_duration = ds.transition_duration;
      resolved.redaction_color = ds.redaction_color;
      resolved.highlight_color = ds.highlight_color;
    }

    return resolved;
  }

  // ── Blur items ─────────────────────────────────────────────────────────────

  function _is_valid_hostname(h) {
    return (
      typeof h === "string" &&
      h.length > 0 &&
      h.length <= 253 &&
      h !== "__proto__" &&
      h !== "constructor" &&
      h !== "prototype"
    );
  }

  function _get_item_id(item) {
    if (item.type === "dynamic") {
      return item.selectors ? item.selectors[0] : item.selector;
    }
    return item.id;
  }

  function _is_valid_item(item) {
    if (!item || typeof item !== "object") return false;
    if (item.type === "dynamic") {
      var name_ok = typeof item.name === "string" && item.name.length <= 100;
      // New shape: selectors array
      if (Array.isArray(item.selectors)) {
        return (
          name_ok &&
          item.selectors.length > 0 &&
          item.selectors.length <= 6 &&
          item.selectors.every(function (s) {
            return typeof s === "string" && s.length > 0 && s.length <= 2000;
          })
        );
      }
      // Legacy shape: single selector string
      return (
        name_ok &&
        typeof item.selector === "string" &&
        item.selector.length > 0 &&
        item.selector.length <= 2000
      );
    }
    if (item.type === "sticky") {
      return (
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.name === "string" &&
        item.name.length <= 100 &&
        typeof item.x === "number" &&
        typeof item.y === "number" &&
        typeof item.width === "number" &&
        typeof item.height === "number"
      );
    }
    return false;
  }

  function get_blur_items(hostname) {
    var items = get().pick_and_blur.items || {};
    return (items[hostname] || []).slice();
  }

  function get_cached_blur_state(hostname) {
    var entry = get_site_entry(hostname);
    if (entry && typeof entry.blur_all === "boolean") return entry.blur_all;
    return get().blur_all.status;
  }

  async function save_blur_state(hostname, is_active) {
    if (!_is_valid_hostname(hostname)) return;
    await set_site_entry(hostname, { blur_all: !!is_active });
  }

  async function save_blur_item(hostname, item) {
    if (!_is_valid_hostname(hostname) || !_is_valid_item(item)) return;
    var current = get();
    var pb_items = Object.assign({}, current.pick_and_blur.items || {});
    var items = pb_items[hostname] ? pb_items[hostname].slice() : [];
    if (items.length >= ITEM_LIMIT) return;
    var new_id = _get_item_id(item);
    if (items.some(function(e) { return _get_item_id(e) === new_id; })) return;
    pb_items[hostname] = items.concat([item]);
    await _write(Object.assign({}, current, {
      pick_and_blur: Object.assign({}, current.pick_and_blur, { items: pb_items }),
    }));
  }

  async function remove_blur_item(hostname, item_id) {
    if (!_is_valid_hostname(hostname)) return;
    var current = get();
    var pb_items = current.pick_and_blur.items || {};
    if (!pb_items[hostname]) return;
    var next_items = pb_items[hostname].filter(function(e) { return _get_item_id(e) !== item_id; });
    var new_pb_items = Object.assign({}, pb_items, { [hostname]: next_items });
    await _write(Object.assign({}, current, {
      pick_and_blur: Object.assign({}, current.pick_and_blur, { items: new_pb_items }),
    }));
  }

  async function clear_host(hostname) {
    if (!_is_valid_hostname(hostname)) return;
    var current = get();

    // Reset blur_all in site entry (if one exists)
    var rules = current.site_rules.slice();
    var idx = _find_rule_idx(hostname, blsi.pattern_types.exact);
    var next_rules = idx >= 0
      ? rules.map(function(r, i) {
          return i === idx ? Object.assign({}, r, { blur_all: null }) : r;
        })
      : rules;

    // Remove items for this hostname from pick_and_blur.items
    var pb_items = Object.assign({}, current.pick_and_blur.items || {});
    delete pb_items[hostname];

    await _write(Object.assign({}, current, {
      site_rules: next_rules,
      pick_and_blur: Object.assign({}, current.pick_and_blur, { items: pb_items }),
    }));
    await clear_automate_blur(hostname);
  }

  // ── Automate blur ──────────────────────────────────────────────────────────

  async function save_automate_blur(hostname, trigger, is_active) {
    if (!_is_valid_hostname(hostname)) return;
    var valid = { idle: true, tab_switch: true, screen_share: true };
    if (!valid[trigger]) return;
    var ab = Object.assign({}, _automate_cache || {});
    var entry = Object.assign(
      { idle: false, tab_switch: false, screen_share: false },
      ab[hostname] || {},
    );
    entry[trigger] = !!is_active;
    ab[hostname] = entry;
    _automate_cache = ab; // update in-memory cache immediately (self-echo guard in onChanged)
    await _session_write(ab);
  }

  async function patch_automate_blur(hostname, patch) {
    if (!_is_valid_hostname(hostname)) return;
    var ab = Object.assign({}, _automate_cache || {});
    var entry = Object.assign(
      { idle: false, tab_switch: false, screen_share: false },
      ab[hostname] || {},
    );
    var valid = { idle: true, tab_switch: true, screen_share: true };
    for (var k in patch) {
      if (valid[k]) entry[k] = !!patch[k];
    }
    ab[hostname] = entry;
    _automate_cache = ab;
    await _session_write(ab);
  }

  async function clear_automate_blur(hostname) {
    if (!_is_valid_hostname(hostname)) return;
    var ab = Object.assign({}, _automate_cache || {});
    delete ab[hostname];
    _automate_cache = ab;
    await _session_write(ab);
  }

  function get_automate_blur(hostname) {
    var entry = (_automate_cache || {})[hostname] || {};
    return {
      idle: !!entry.idle,
      tab_switch: !!entry.tab_switch,
      screen_share: !!entry.screen_share,
    };
  }

  // ── URL rules ──────────────────────────────────────────────────────────────

  function get_rules() {
    return get().site_rules.filter(function (r) {
      return r.hostname_type !== blsi.pattern_types.exact;
    });
  }

  async function save_rules(rules) {
    if (!Array.isArray(rules)) return;
    var current = get();
    var exact_only = current.site_rules.filter(function (r) {
      return r.hostname_type === blsi.pattern_types.exact;
    });
    var pattern_rules = rules
      .filter(function (r) {
        return (
          r &&
          typeof r === "object" &&
          typeof r.hostname_value === "string" &&
          r.hostname_value.trim().length > 0
        );
      })
      .slice(0, RULES_LIMIT)
      .map(function (r) {
        var ht =
          r.hostname_type === blsi.pattern_types.regex ||
          r.hostname_type === blsi.pattern_types.wildcard
            ? r.hostname_type
            : blsi.pattern_types.wildcard;
        return {
          hostname_value: r.hostname_value.trim().slice(0, 500),
          hostname_type: ht,
          blur_all: null,
          snapshot:
            r.snapshot &&
            typeof r.snapshot === "object" &&
            !Array.isArray(r.snapshot)
              ? r.snapshot
              : {},
        };
      });
    // Pattern rules come first so URL matching iterates them before exact entries
    await _write(
      Object.assign({}, current, {
        site_rules: pattern_rules.concat(exact_only),
      }),
    );
  }

  // ── Test utility ───────────────────────────────────────────────────────────
  function _reset_cache() {
    _cache = null;
    _automate_cache = {};
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    // Init / subscribe
    init_cache,
    on_change,
    get,
    // Model writes
    patch_section,
    save_settings,
    // Site rules
    get_all_site_rules,
    get_site_entry,
    set_site_entry,
    // Snapshot
    capture_snapshot,
    save_site_snapshot,
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
