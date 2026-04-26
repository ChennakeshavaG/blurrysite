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
  const SCREEN_SHARE_SESSION_KEY = "blsi_screen_share";
  const SUPPRESSED_TABS_SESSION_KEY = "blsi_automate_suppressed_tabs";
  const ITEM_LIMIT = 10;
  const RULES_LIMIT = 200;

  function _default_screen_share_state() {
    return {
      active: false,
      sharing_tab_id: null,
      started_at: null,
      suppressed_sites: [],
    };
  }

  // ── Private state ──────────────────────────────────────────────────────────
  var _cache = null; // null = not yet initialised
  var _automate_cache = {}; // mirrors chrome.storage.session blsi_automate_blur — { idle, tab_switch } only
  var _screen_share_cache = _default_screen_share_state();
  var _suppressed_tabs_cache = []; // array of tab ids — silences ALL automate triggers per tab
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
  function _session_get_key(key, fallback) {
    return new Promise(function (resolve) {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(key, function (r) {
          resolve(r && r[key] !== undefined ? r[key] : fallback);
        });
      } else {
        resolve(fallback);
      }
    });
  }

  function _session_set_key(key, value) {
    return new Promise(function (resolve, reject) {
      if (chrome.storage && chrome.storage.session) {
        var payload = {};
        payload[key] = value;
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
  async function _session_write_automate(data) {
    var prev = _automate_cache;
    try {
      await _session_set_key(AUTOMATE_SESSION_KEY, data);
    } catch (e) {
      _automate_cache = prev;
      console.warn("[blsi] session write failed:", e.message);
    }
  }

  async function _session_write_screen_share(data) {
    var prev = _screen_share_cache;
    try {
      await _session_set_key(SCREEN_SHARE_SESSION_KEY, data);
    } catch (e) {
      _screen_share_cache = prev;
      console.warn("[blsi] screen-share session write failed:", e.message);
    }
  }

  async function _session_write_suppressed_tabs(data) {
    var prev = _suppressed_tabs_cache;
    try {
      await _session_set_key(SUPPRESSED_TABS_SESSION_KEY, data);
    } catch (e) {
      _suppressed_tabs_cache = prev;
      console.warn("[blsi] suppressed-tabs session write failed:", e.message);
    }
  }

  function _normalize_automate_entry(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    // Strip legacy `screen_share` sub-key — screen-share state lives in
    // SCREEN_SHARE_SESSION_KEY now. Preserve only idle + tab_switch.
    return { idle: !!src.idle, tab_switch: !!src.tab_switch };
  }

  function _normalize_automate_map(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var out = {};
    var dirty = false;
    for (var host in src) {
      if (!Object.prototype.hasOwnProperty.call(src, host)) continue;
      var entry = src[host];
      var norm = _normalize_automate_entry(entry);
      // Drop entries that became empty after stripping screen_share.
      if (!norm.idle && !norm.tab_switch) { dirty = true; continue; }
      // Detect any shape change (extra keys, screen_share sub-key, etc.).
      if (entry && (entry.screen_share !== undefined ||
          Object.keys(entry).length !== 2 ||
          entry.idle !== norm.idle || entry.tab_switch !== norm.tab_switch)) {
        dirty = true;
      }
      out[host] = norm;
    }
    return { map: out, dirty: dirty };
  }

  function _normalize_screen_share(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    return {
      active: !!src.active,
      sharing_tab_id: typeof src.sharing_tab_id === "number" ? src.sharing_tab_id : null,
      started_at: typeof src.started_at === "number" ? src.started_at : null,
      suppressed_sites: Array.isArray(src.suppressed_sites)
        ? src.suppressed_sites.filter(function (s) { return typeof s === "string" && s; })
        : [],
    };
  }

  function _normalize_suppressed_tabs(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (n) { return typeof n === "number" && Number.isFinite(n); });
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

    if (area === "session") {
      var fired = false;
      if (AUTOMATE_SESSION_KEY in changes) {
        var na = _normalize_automate_map(changes[AUTOMATE_SESSION_KEY].newValue || {}).map;
        if (!_deep_equal(_automate_cache, na)) {
          _automate_cache = na;
          fired = true;
        }
      }
      if (SCREEN_SHARE_SESSION_KEY in changes) {
        var nss = _normalize_screen_share(changes[SCREEN_SHARE_SESSION_KEY].newValue || _default_screen_share_state());
        if (!_deep_equal(_screen_share_cache, nss)) {
          _screen_share_cache = nss;
          fired = true;
        }
      }
      if (SUPPRESSED_TABS_SESSION_KEY in changes) {
        var nst = _normalize_suppressed_tabs(changes[SUPPRESSED_TABS_SESSION_KEY].newValue || []);
        if (!_deep_equal(_suppressed_tabs_cache, nst)) {
          _suppressed_tabs_cache = nst;
          fired = true;
        }
      }
      if (fired && _on_change) _on_change(_cache, _cache);
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
    var raw_automate = await _session_get_key(AUTOMATE_SESSION_KEY, {});
    var norm_automate = _normalize_automate_map(raw_automate);
    _automate_cache = norm_automate.map;
    if (norm_automate.dirty) {
      // One-time migration write: strip legacy `screen_share` sub-keys + empty entries.
      await _session_write_automate(_automate_cache);
    }
    _screen_share_cache = _normalize_screen_share(
      await _session_get_key(SCREEN_SHARE_SESSION_KEY, _default_screen_share_state())
    );
    _suppressed_tabs_cache = _normalize_suppressed_tabs(
      await _session_get_key(SUPPRESSED_TABS_SESSION_KEY, [])
    );
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
   * Returns { settings, blur_all, pick_and_blur, auto_detect_pii, automate }
   * mirroring the global model structure with deep copies of nested objects.
   * Excludes: site_rules, shortcuts, enabled, language, idle.value/unit,
   * pick_and_blur.items.
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
      auto_detect_pii: {
        settings: {
          email: m.auto_detect_pii.settings.email,
          numeric: m.auto_detect_pii.settings.numeric,
          pii_mode: m.auto_detect_pii.settings.pii_mode,
          pii_redaction_color: m.auto_detect_pii.settings.pii_redaction_color,
        },
      },
      automate: {
        settings: {
          idle: { enabled: m.automate.settings.idle.enabled },
          tab_switch: { enabled: m.automate.settings.tab_switch.enabled },
          screen_share: { enabled: m.automate.settings.screen_share.enabled },
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

  // Allowlist of keys permitted under snapshot.settings. Mirrors the keys
  // produced by capture_snapshot() / accepted by validate_model snapshot
  // validation. Keeps _rule_overrides honest — only fields the user can
  // actually manage per-site land in the map.
  var _SNAPSHOT_SETTINGS_KEYS = [
    "blur_radius",
    "reveal_mode",
    "thorough_blur",
    "highlight_color",
    "redaction_color",
    "tab_privacy",
    "transition_duration",
  ];

  // Merges a stored snapshot into a resolved settings object in-place.
  // Stamps resolved._rule_overrides[<flat-key>] = true for each key written
  // so downstream UI can detect rule-driven fields without re-walking storage.
  function _apply_snapshot(snapshot, resolved) {
    if (!snapshot || typeof snapshot !== "object") return;
    if (!resolved._rule_overrides) resolved._rule_overrides = {};
    var ov = resolved._rule_overrides;

    if (snapshot.settings && typeof snapshot.settings === "object") {
      var ss = snapshot.settings;
      for (var ki = 0; ki < _SNAPSHOT_SETTINGS_KEYS.length; ki++) {
        var sk = _SNAPSHOT_SETTINGS_KEYS[ki];
        if (Object.prototype.hasOwnProperty.call(ss, sk) && ss[sk] !== undefined) {
          resolved[sk] = ss[sk];
          ov[sk] = true;
        }
      }
    }
    if (
      snapshot.blur_all &&
      snapshot.blur_all.settings &&
      typeof snapshot.blur_all.settings === "object"
    ) {
      var ba = snapshot.blur_all.settings;
      if (ba.blur_mode !== undefined) {
        resolved.blur_mode = ba.blur_mode;
        ov.blur_mode = true;
      }
      if (ba.blur_categories !== undefined) {
        resolved.blur_categories = ba.blur_categories;
        ov.blur_categories = true;
      }
    }
    if (snapshot.pick_and_blur) {
      var pb = snapshot.pick_and_blur;
      if (typeof pb.status === "boolean") {
        resolved.pick_blur_enabled = pb.status;
        ov.pick_blur_enabled = true;
      }
      if (pb.settings && typeof pb.settings === "object") {
        if (pb.settings.blur_type !== undefined) {
          resolved.pick_blur_type = pb.settings.blur_type;
          ov.pick_blur_type = true;
        }
        if (pb.settings.blur_color !== undefined) {
          resolved.pick_blur_color = pb.settings.blur_color;
          ov.pick_blur_color = true;
        }
        if (pb.settings.picker_mode !== undefined) {
          resolved.picker_mode = pb.settings.picker_mode;
          ov.picker_mode = true;
        }
      }
    }
    if (snapshot.auto_detect_pii && snapshot.auto_detect_pii.settings) {
      var p = snapshot.auto_detect_pii.settings;
      if (p.email !== undefined) {
        resolved.pii_email = p.email;
        ov.pii_email = true;
      }
      if (p.numeric !== undefined) {
        resolved.pii_numeric = p.numeric;
        ov.pii_numeric = true;
      }
      if (p.pii_mode !== undefined) {
        resolved.pii_mode = p.pii_mode;
        ov.pii_mode = true;
      }
      if (p.pii_redaction_color !== undefined) {
        resolved.pii_redaction_color = p.pii_redaction_color;
        ov.pii_redaction_color = true;
      }
    }
    if (snapshot.automate && snapshot.automate.settings) {
      var a = snapshot.automate.settings;
      if (a.idle && a.idle.enabled !== undefined) {
        resolved.automate_idle = Object.assign({}, resolved.automate_idle, {
          enabled: !!a.idle.enabled,
        });
        ov.automate_idle = true;
      }
      if (a.tab_switch && a.tab_switch.enabled !== undefined) {
        resolved.automate_tab_switch = Object.assign(
          {},
          resolved.automate_tab_switch,
          { enabled: !!a.tab_switch.enabled },
        );
        ov.automate_tab_switch = true;
      }
      if (a.screen_share && a.screen_share.enabled !== undefined) {
        resolved.automate_screen_share = Object.assign(
          {},
          resolved.automate_screen_share,
          { enabled: !!a.screen_share.enabled },
        );
        ov.automate_screen_share = true;
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
   * @param {number|null} [tab_id]  Optional. When provided, per-tab automate
   *   suppression and per-tab sharing-tab identity are honored. Pass null
   *   from popup callers if active tab id is unknown.
   * @returns {object} Flat resolved settings object
   */
  function resolve(hostname, url, tab_id) {
    var m = get();
    var resolved = {};

    // ── 0. Rule-tracking maps (consumed by popup + content_script UX) ─────
    resolved._rule_overrides = {};
    resolved._rule_match = null;

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

    // ── 5. automate trigger settings (must be on resolved before snapshot
    //      apply so a rule can override .enabled while preserving value/unit)
    resolved.automate_screen_share = m.automate.settings.screen_share;
    resolved.automate_idle = m.automate.settings.idle;
    resolved.automate_tab_switch = m.automate.settings.tab_switch;

    // ── 6. shortcuts ───────────────────────────────────────────────────────
    resolved.shortcuts = m.shortcuts || {};

    // ── 7. wildcard / regex site_rule override (first match wins) ─────────
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
          resolved._rule_match = {
            hostname_value: rule.hostname_value,
            hostname_type: rule.hostname_type,
          };
          break;
        }
      }
    }

    // ── 8. exact hostname site_rule ────────────────────────────────────────
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
    if (exact && exact.snapshot && Object.keys(exact.snapshot).length) {
      _apply_snapshot(exact.snapshot, resolved);
      // Exact snapshot trumps wildcard for the deep-link target.
      resolved._rule_match = {
        hostname_value: exact.hostname_value,
        hostname_type: exact.hostname_type,
      };
    }

    // ── 9. blur items for this hostname ────────────────────────────────────
    // Gated on pick_and_blur.status — items are "paused" (not applied) when off.
    resolved.blur_items = m.pick_and_blur.status
      ? (m.pick_and_blur.items || {})[hostname] || []
      : [];

    // ── 10. automate active state (session cache) ─────────────────────────
    var automate_entry = (_automate_cache || {})[hostname] || {};
    var has_tab_id = typeof tab_id === "number" && Number.isFinite(tab_id);
    var tab_suppressed = has_tab_id && _suppressed_tabs_cache.indexOf(tab_id) >= 0;

    var idle_raw = !!automate_entry.idle;
    var tab_switch_raw = !!automate_entry.tab_switch;

    // Screen-share: derived from single global record + suppression maps.
    var ss = _screen_share_cache || _default_screen_share_state();
    var ss_feature_enabled = !!(resolved.automate_screen_share && resolved.automate_screen_share.enabled);
    var ss_site_suppressed = ss.suppressed_sites.indexOf(hostname) >= 0;
    var ss_is_sharing_tab = has_tab_id && ss.sharing_tab_id === tab_id;
    var ss_blur_raw =
      ss.active &&
      ss_feature_enabled &&
      !ss_site_suppressed &&
      !ss_is_sharing_tab;

    var idle_eff = !tab_suppressed && idle_raw;
    var tab_switch_eff = !tab_suppressed && tab_switch_raw;
    var ss_eff = !tab_suppressed && ss_blur_raw;

    resolved.automate_blur_active = !!(idle_eff || tab_switch_eff || ss_eff);
    resolved.automate_blur_triggers = {
      idle: idle_eff,
      tab_switch: tab_switch_eff,
      screen_share: ss_eff,
    };
    resolved.screen_share_suppressed_for_host = ss_site_suppressed;
    resolved.screen_share_suppressed_for_tab = tab_suppressed;
    resolved.screen_share_state = {
      active: ss.active,
      sharing_tab_id: ss.sharing_tab_id,
      started_at: ss.started_at,
      is_sharing_tab: ss_is_sharing_tab,
    };

    // blur_all_active — exact.blur_all overrides global; null = inherit global.
    var manual_blur = exact
      ? exact.blur_all !== null
        ? !!exact.blur_all
        : m.blur_all.status
      : m.blur_all.status;
    var pick_blur_present = m.pick_and_blur.status;
    var blur_present = manual_blur || pick_blur_present;
    var automate_needs_blur = resolved.automate_blur_active && !blur_present;

    resolved.blur_all_active = manual_blur || automate_needs_blur;
    resolved.automate_blur_only = !!automate_needs_blur;
    resolved.automate_blur_skipped =
      resolved.automate_blur_active && !!blur_present;
    resolved.automate_blur_skip_reason = !resolved.automate_blur_skipped
      ? null
      : resolved._rule_match
      ? "site_rule"
      : manual_blur
      ? "manual"
      : "pick_blur";

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
  // Hostname-keyed { idle, tab_switch } only. Screen-share state lives in
  // SCREEN_SHARE_SESSION_KEY (single global record) — see methods below.

  async function save_automate_blur(hostname, trigger, is_active) {
    if (!_is_valid_hostname(hostname)) return;
    var valid = { idle: true, tab_switch: true };
    if (!valid[trigger]) return;
    var ab = Object.assign({}, _automate_cache || {});
    var entry = Object.assign({ idle: false, tab_switch: false }, ab[hostname] || {});
    entry[trigger] = !!is_active;
    ab[hostname] = entry;
    _automate_cache = ab; // update in-memory cache immediately (self-echo guard in onChanged)
    await _session_write_automate(ab);
  }

  async function patch_automate_blur(hostname, patch) {
    if (!_is_valid_hostname(hostname)) return;
    var ab = Object.assign({}, _automate_cache || {});
    var entry = Object.assign({ idle: false, tab_switch: false }, ab[hostname] || {});
    var valid = { idle: true, tab_switch: true };
    for (var k in patch) {
      if (valid[k]) entry[k] = !!patch[k];
    }
    ab[hostname] = entry;
    _automate_cache = ab;
    await _session_write_automate(ab);
  }

  async function clear_automate_blur(hostname) {
    if (!_is_valid_hostname(hostname)) return;
    var ab = Object.assign({}, _automate_cache || {});
    delete ab[hostname];
    _automate_cache = ab;
    await _session_write_automate(ab);
  }

  function get_automate_blur(hostname) {
    var entry = (_automate_cache || {})[hostname] || {};
    return { idle: !!entry.idle, tab_switch: !!entry.tab_switch };
  }

  // ── Screen-share session state (single global record) ─────────────────────

  function get_screen_share_state() {
    var s = _screen_share_cache || _default_screen_share_state();
    return {
      active: !!s.active,
      sharing_tab_id: typeof s.sharing_tab_id === "number" ? s.sharing_tab_id : null,
      started_at: typeof s.started_at === "number" ? s.started_at : null,
      suppressed_sites: s.suppressed_sites.slice(),
    };
  }

  /**
   * Mark a screen share as active. Each new share starts with cleared
   * suppression maps so a stale per-site suppress from a previous share never
   * silently carries over. Also clears the global per-tab suppression list to
   * mitigate Chrome tab-id reuse on closed tabs.
   */
  async function set_screen_share_active(sharing_tab_id) {
    var next = {
      active: true,
      sharing_tab_id: typeof sharing_tab_id === "number" ? sharing_tab_id : null,
      started_at: Date.now(),
      suppressed_sites: [],
    };
    _screen_share_cache = next;
    _suppressed_tabs_cache = [];
    await Promise.all([
      _session_write_screen_share(next),
      _session_write_suppressed_tabs([]),
    ]);
  }

  async function set_screen_share_inactive() {
    var next = _default_screen_share_state();
    _screen_share_cache = next;
    await _session_write_screen_share(next);
  }

  function get_suppressed_tabs() {
    return _suppressed_tabs_cache.slice();
  }

  /**
   * Add a tab id to the global per-tab automate suppression list. Affects
   * ALL automate triggers (idle, tab_switch, screen_share) for that tab.
   * No-op if tab_id is already suppressed or not a number.
   */
  async function add_suppressed_tab(tab_id) {
    if (typeof tab_id !== "number" || !Number.isFinite(tab_id)) return;
    if (_suppressed_tabs_cache.indexOf(tab_id) >= 0) return;
    var next = _suppressed_tabs_cache.concat([tab_id]);
    _suppressed_tabs_cache = next;
    await _session_write_suppressed_tabs(next);
  }

  async function remove_suppressed_tab(tab_id) {
    if (typeof tab_id !== "number") return;
    if (_suppressed_tabs_cache.indexOf(tab_id) < 0) return;
    var next = _suppressed_tabs_cache.filter(function (t) { return t !== tab_id; });
    _suppressed_tabs_cache = next;
    await _session_write_suppressed_tabs(next);
  }

  async function clear_suppressed_tabs() {
    if (!_suppressed_tabs_cache.length) return;
    _suppressed_tabs_cache = [];
    await _session_write_suppressed_tabs([]);
  }

  /**
   * Suppress screen-share blur at a chosen scope.
   *
   * @param {'tab'|'site_session'|'feature'} scope
   * @param {object} ctx — { hostname, tab_id }
   */
  async function suppress_screen_share(scope, ctx) {
    ctx = ctx || {};
    if (scope === "tab") {
      await add_suppressed_tab(ctx.tab_id);
      return;
    }
    if (scope === "site_session") {
      if (!_is_valid_hostname(ctx.hostname)) return;
      var ss = _screen_share_cache || _default_screen_share_state();
      if (ss.suppressed_sites.indexOf(ctx.hostname) >= 0) return;
      var next = Object.assign({}, ss, {
        suppressed_sites: ss.suppressed_sites.concat([ctx.hostname]),
      });
      _screen_share_cache = next;
      await _session_write_screen_share(next);
      return;
    }
    if (scope === "feature") {
      await patch_section("automate", { settings: { screen_share: { enabled: false } } });
      await set_screen_share_inactive();
      return;
    }
  }

  async function unsuppress_screen_share(scope, ctx) {
    ctx = ctx || {};
    if (scope === "tab") {
      await remove_suppressed_tab(ctx.tab_id);
      return;
    }
    if (scope === "site_session") {
      if (!_is_valid_hostname(ctx.hostname)) return;
      var ss = _screen_share_cache || _default_screen_share_state();
      if (ss.suppressed_sites.indexOf(ctx.hostname) < 0) return;
      var next = Object.assign({}, ss, {
        suppressed_sites: ss.suppressed_sites.filter(function (h) { return h !== ctx.hostname; }),
      });
      _screen_share_cache = next;
      await _session_write_screen_share(next);
      return;
    }
    if (scope === "feature") {
      await patch_section("automate", { settings: { screen_share: { enabled: true } } });
      return;
    }
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
    _screen_share_cache = _default_screen_share_state();
    _suppressed_tabs_cache = [];
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
    // Screen-share session record + suppression APIs
    get_screen_share_state,
    set_screen_share_active,
    set_screen_share_inactive,
    suppress_screen_share,
    unsuppress_screen_share,
    get_suppressed_tabs,
    add_suppressed_tab,
    remove_suppressed_tab,
    clear_suppressed_tabs,
    // URL rules
    get_rules,
    save_rules,
    // Test
    _reset_cache,
  };
})();

blsi.Model = StorageModel;
