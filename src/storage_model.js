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
  const ITEM_LIMIT = 10;
  const RULES_LIMIT = 200;

  // ── Private state ──────────────────────────────────────────────────────────
  var _cache = null; // null = not yet initialised
  var _on_change = null;           // legacy single subscriber (function(newModel, oldModel) | null)
  var _on_automate_change = null;  // automate Manager subscriber (function(newModel, oldModel) | null)

  // Idle (global) + tab_switch (per-tab) live in chrome.storage.session under
  // keys owned by blsi.Automate.State. We don't mirror them here — resolve()
  // reads them at call-time from State.read_idle() / read_tab_switch(tab_id).

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

  // ── Storage listener ───────────────────────────────────────────────────────
  function _on_storage_changed(changes, area) {
    if (!chrome.runtime || !chrome.runtime.id) {
      chrome.storage.onChanged.removeListener(_on_storage_changed);
      return;
    }
    if (area === "local" && STORAGE_KEY in changes) {
      var new_val = changes[STORAGE_KEY].newValue || null;
      if (_deep_equal(_cache, new_val)) return; // self-echo
      var old_model = _cache;
      _cache = new_val ? blsi.validate_model(new_val) : null;
      if (_on_change) _on_change(_cache, old_model);
      // Local model changes can flip automate gates (automate.*.enabled,
      // site_rules) — Manager re-evaluates and uses output diff to skip no-ops.
      if (_on_automate_change) _on_automate_change(_cache, old_model);
    }
    // Session changes (idle / tab_switch / screen_share / suppressed_tabs) are
    // handled entirely by blsi.Automate.State — its single onChanged listener
    // updates all caches before firing subscribers. State.on_session_notify
    // relays into _on_change so content_script re-resolves.
  }
  chrome.storage.onChanged.addListener(_on_storage_changed);

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
    // Session state (idle, tab_switch, screen_share, suppressed_tabs) is owned
    // by blsi.Automate.State which self-hydrates. Register a relay so that
    // session changes fire _on_change (content_script re-resolve) and
    // _on_automate_change (Manager re-evaluate).
    var State = (typeof blsi !== "undefined" && blsi.Automate && blsi.Automate.State) || null;
    if (State && typeof State.on_session_notify === "function") {
      State.on_session_notify(function () {
        if (_on_change) _on_change(_cache, _cache);
        if (_on_automate_change) _on_automate_change(_cache, _cache);
      });
    }
  }

  /**
   * Register a storage-change callback. Single subscriber — calling twice
   * replaces the first (logs a warning). Fires in two cases:
   *   - Local model change:   cb(newModel, oldModel)  — both are full model objects
   *   - Session/automate change: cb(currentModel, currentModel) — same ref for both
   *     args because session state lives in State, not the model.
   * _cache is already updated before cb fires, so Model.get() inside cb returns newModel.
   */
  function on_change(cb) {
    if (_on_change && _on_change !== cb) {
      console.warn("[blsi] on_change: replacing existing subscriber — only one allowed");
    }
    _on_change = cb;
  }

  /**
   * Register the automate Manager's storage subscriber. Single subscriber —
   * calling twice replaces the first (logs a warning). Fires in the same
   * conditions as on_change today; later refactors may narrow this to
   * "automate-relevant changes only".
   */
  function on_automate_change(cb) {
    if (_on_automate_change && _on_automate_change !== cb) {
      console.warn("[blsi] on_automate_change: replacing existing subscriber — only one allowed");
    }
    _on_automate_change = cb;
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

  // ── Snapshot ───────────────────────────────────────────────────────────────

  /**
   * Capture a settings snapshot from the current cached global model.
   * Returns { blur_all, pick_and_blur, auto_detect_pii, automate } mirroring
   * the feature-grouped model sections with deep copies of nested objects.
   * Includes pick_and_blur.items for the supplied hostname (deep-copied) and
   * the full automate.settings.idle shape (value + unit + enabled).
   * Excludes: site_rules, shortcuts, global_default_settings.
   *
   * @param {string} [hostname]  When provided, captures the host's pick-blur
   *   items into snapshot.pick_and_blur.items. Omitted/empty → items: [].
   */
  function capture_snapshot(hostname) {
    var m = get();
    var items = [];
    if (typeof hostname === "string" && hostname) {
      items = JSON.parse(
        JSON.stringify((m.pick_and_blur.items || {})[hostname] || []),
      );
    }
    return {
      blur_all: {
        status: m.blur_all.status,
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
        items: items,
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
          idle: {
            value: m.automate.settings.idle.value,
            unit: m.automate.settings.idle.unit,
            enabled: m.automate.settings.idle.enabled,
          },
          tab_switch: { enabled: m.automate.settings.tab_switch.enabled },
          screen_share: { enabled: m.automate.settings.screen_share.enabled },
        },
      },
    };
  }

  // Fill any missing keys/sections from the current global so the persisted
  // snapshot mirrors capture_snapshot()'s full shape. Used by save_site_snapshot
  // to enforce the full-snapshot contract regardless of caller payload.
  function _fill_snapshot_to_full(partial) {
    var full = capture_snapshot();
    var out = blsi.deep_merge(full, partial);
    return out;
  }

  /**
   * Save a settings snapshot for a rule (hostname_value + hostname_type).
   * For wildcard/regex rules, ensure the rule exists via save_rules() first.
   *
   * Non-empty snapshots are auto-filled to the full capture_snapshot() shape;
   * partial inputs are merged over the current global so rule-managed UX has
   * a complete field set. Empty {} stays empty (sentinel for "rule pins
   * blur_all toggle only — no setting overrides").
   *
   * @param {string} hostname_value  e.g. 'github.com' or '*.example.com'
   * @param {string} hostname_type   blsi.pattern_types value
   * @param {object} snapshot        { blur_all, pick_and_blur, auto_detect_pii, automate } | {}
   */
  async function save_site_snapshot(hostname_value, hostname_type, snapshot) {
    if (!hostname_value || typeof hostname_value !== "string") return;
    if (!snapshot || typeof snapshot !== "object") return;
    // Full-snapshot enforcement: non-empty snapshots auto-fill from current
    // global via capture_snapshot() so rule-managed UX has a complete contract.
    // Empty {} stays empty (sentinel for "rule pins blur_all toggle only").
    var snap_to_write = Object.keys(snapshot).length === 0
      ? {}
      : _fill_snapshot_to_full(snapshot);
    var current = get();
    var rules = current.site_rules.slice();
    var idx = _find_rule_idx(hostname_value, hostname_type);
    if (idx >= 0) {
      var updated = Object.assign({}, rules[idx], {
        snapshot: snap_to_write,
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
        snapshot: snap_to_write,
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
  // Stamps resolved._rule_overrides[<flat-key>] = true for each key written
  // so downstream UI can detect rule-driven fields without re-walking storage.
  function _apply_snapshot(snapshot, resolved) {
    if (!snapshot || typeof snapshot !== "object") return;
    if (!resolved._rule_overrides) resolved._rule_overrides = {};
    var ov = resolved._rule_overrides;

    if (snapshot.blur_all && typeof snapshot.blur_all === "object") {
      if (typeof snapshot.blur_all.status === "boolean") {
        resolved.blur_all_status = snapshot.blur_all.status;
        ov.blur_all_status = true;
      }
      if (
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
      // Items REPLACE host-keyed items when present. Empty array still wins —
      // sentinel for "rule pins this host to no pick-blur items".
      if (Array.isArray(pb.items)) {
        resolved.blur_items = resolved.pick_blur_enabled ? pb.items.slice() : [];
        ov.blur_items = true;
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
      if (a.idle && typeof a.idle === "object") {
        var idle_patch = {};
        if (a.idle.enabled !== undefined) idle_patch.enabled = !!a.idle.enabled;
        if (typeof a.idle.value === "number") idle_patch.value = a.idle.value;
        if (typeof a.idle.unit === "string") idle_patch.unit = a.idle.unit;
        if (Object.keys(idle_patch).length) {
          resolved.automate_idle = Object.assign(
            {},
            resolved.automate_idle,
            idle_patch,
          );
          ov.automate_idle = true;
        }
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
   * Private — runs the global → feature → site_rule snapshot fold. Both
   * resolve_settings (engine surface) and resolve_automate (Manager surface)
   * call this independently. Note: the `resolve()` shim calls BOTH resolvers
   * which means the fold runs twice per shim invocation. Acceptable today
   * because the fold is fast (~tens of microseconds) and `resolve()` is only
   * used by popup; if it ever becomes a hotspot, refactor `resolve()` to call
   * `_common_fold` once and pass the result into the two resolvers.
   *
   * Returns a flat object containing every setting key (post-fold) plus
   * `_rule_overrides` and `_rule_match`. Does NOT compute the engage flag
   * or any automate decision fields — those belong to the dedicated resolvers.
   */
  function _common_fold(hostname, url) {
    var m = get();
    var resolved = {};

    // ── 0. Rule-tracking maps (consumed by popup + content_script UX) ─────
    resolved._rule_overrides = {};
    resolved._rule_match = null;

    // ── 1. Global settings ─────────────────────────────────────────────────
    Object.assign(resolved, m.global_default_settings);

    // ── 2. blur_all feature settings ──────────────────────────────────────
    resolved.blur_all_status = m.blur_all.status;
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

    // ── 5b. blur items (must be on resolved before snapshot apply so a rule
    //       can REPLACE the host-keyed items with its own snapshot.items)
    resolved.blur_items = m.pick_and_blur.status
      ? (m.pick_and_blur.items || {})[hostname] || []
      : [];

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
    for (var j = 0; j < site_rules.length; j++) {
      var er = site_rules[j];
      if (
        er.hostname_type === blsi.pattern_types.exact &&
        er.hostname_value === hostname &&
        er.snapshot && Object.keys(er.snapshot).length
      ) {
        _apply_snapshot(er.snapshot, resolved);
        resolved._rule_match = {
          hostname_value: er.hostname_value,
          hostname_type: er.hostname_type,
        };
        break;
      }
    }

    return resolved;
  }

  /**
   * Engine surface — folded settings + `engage` gate. Does NOT compute any
   * automate decision fields (`automate_blur_active` etc.) — those belong to
   * `resolve_automate()`. As a result, `engage` does NOT include automate as
   * a blur reason: when only automate is firing, engine teardown runs and
   * the Overlay (driven by Manager) is the sole render path.
   *
   * @param {string} hostname
   * @param {string} url
   * @param {number|null} [tab_id]  Accepted for API symmetry; unused here.
   * @returns {object} Flat resolved settings object suitable for engine.handleSite()
   */
  function resolve_settings(hostname, url, tab_id) {
    var resolved = _common_fold(hostname, url);

    // engage — gate for the page-wide engine layer. False when the extension
    // is disabled OR when blur-all is not active. Pick-blur is reconciled
    // unconditionally by the engine (independent of engage), so it does not
    // appear here. Automate is rendered exclusively via the Overlay
    // (blsi.Automate.Manager), not the engine, so it is also excluded.
    var manual_blur = !!resolved.blur_all_status;
    resolved.engage = (resolved.enabled !== false) && manual_blur;

    void tab_id;  // tab_id reserved for future use (e.g., per-tab settings)
    return resolved;
  }

  /**
   * Manager surface — slim slice with only the automate-decision fields.
   * Computed against the same fold as `resolve_settings`. Engine never reads
   * this; Manager never reads `resolve()` or `resolve_settings()`.
   */
  function resolve_automate(hostname, url, tab_id) {
    var folded = _common_fold(hostname, url);

    // ── automate active state (session storage via blsi.Automate.State) ───
    var has_tab_id = typeof tab_id === "number" && Number.isFinite(tab_id);
    var State = (typeof blsi !== "undefined" && blsi.Automate && blsi.Automate.State) || null;
    var _sup_tabs = State ? State.get_suppressed_tabs() : [];
    var tab_suppressed = has_tab_id && _sup_tabs.indexOf(tab_id) >= 0;
    var PH = State ? State.PHASES : null;
    var idle_phase = State ? State.read_idle() : "active";
    var suspended = State ? State.read_suspended() : {};
    var idle_feature_on = !!(folded.automate_idle && folded.automate_idle.enabled) && !suspended.idle;
    var idle_raw = idle_feature_on && PH && (idle_phase === PH.idle.idle || idle_phase === PH.idle.locked);
    var ts_phase = (State && has_tab_id) ? State.read_tab_switch(tab_id) : "off";
    var ts_feature_on = !!(folded.automate_tab_switch && folded.automate_tab_switch.enabled) && !suspended.tab_switch;
    var tab_switch_raw = ts_feature_on && PH && ts_phase === PH.tab_switch.fired;

    // Per-trigger ignore lists (idle + tab_switch)
    var idle_ignore = State ? State.read_idle_ignore() : { ignore_tabs: [], ignore_sites: [] };
    var idle_tab_ignored = has_tab_id && idle_ignore.ignore_tabs.indexOf(tab_id) >= 0;
    var idle_site_ignored = idle_ignore.ignore_sites.indexOf(hostname) >= 0;

    var ts_ignore = State ? State.read_tab_switch_ignore() : { ignore_tabs: [], ignore_sites: [] };
    var ts_tab_ignored = has_tab_id && ts_ignore.ignore_tabs.indexOf(tab_id) >= 0;
    var ts_site_ignored = ts_ignore.ignore_sites.indexOf(hostname) >= 0;

    var ss = State ? State.get_screen_share_state(tab_id) : { active: false, sharing_tab_id: null, started_at: null, suppressed_sites: [], _sharing_tab_ids: [] };
    var ss_feature_enabled = !!(folded.automate_screen_share && folded.automate_screen_share.enabled) && !suspended.screen_share;
    var ss_site_suppressed = ss.suppressed_sites.indexOf(hostname) >= 0;
    var ss_is_sharing_tab = has_tab_id && ss._sharing_tab_ids && ss._sharing_tab_ids.indexOf(tab_id) >= 0;
    var ss_blur_raw =
      ss.active &&
      ss_feature_enabled &&
      !ss_site_suppressed &&
      !ss_is_sharing_tab;

    var idle_eff = idle_raw && !idle_tab_ignored && !idle_site_ignored;
    var tab_switch_eff = tab_switch_raw && !ts_tab_ignored && !ts_site_ignored;
    var ss_eff = !tab_suppressed && ss_blur_raw;

    var automate_blur_active = !!(idle_eff || tab_switch_eff || ss_eff);

    // skipped vs only depends on whether a manual blur reason is also active.
    var manual_blur = !!folded.blur_all_status;
    var pick_blur_present = !!folded.pick_blur_enabled;
    var blur_present = manual_blur || pick_blur_present;
    var automate_blur_only = automate_blur_active && !blur_present;
    var automate_blur_skipped = automate_blur_active && blur_present;
    var automate_blur_skip_reason = !automate_blur_skipped
      ? null
      : folded._rule_match
      ? "site_rule"
      : manual_blur
      ? "manual"
      : "pick_blur";

    return {
      automate_blur_active:              automate_blur_active,
      automate_blur_triggers: {
        idle:         idle_eff,
        tab_switch:   tab_switch_eff,
        screen_share: ss_eff,
      },
      automate_blur_only:                automate_blur_only,
      automate_blur_skipped:             automate_blur_skipped,
      automate_blur_skip_reason:         automate_blur_skip_reason,
      screen_share_state: {
        active:         ss.active,
        sharing_tab_id: ss.sharing_tab_id,
        started_at:     ss.started_at,
        is_sharing_tab: ss_is_sharing_tab,
      },
      idle_suppressed_for_tab:            idle_tab_ignored,
      idle_suppressed_for_site:           idle_site_ignored,
      tab_switch_suppressed_for_tab:      ts_tab_ignored,
      tab_switch_suppressed_for_site:     ts_site_ignored,
      screen_share_suppressed_for_host:   ss_site_suppressed,
      screen_share_suppressed_for_tab:    tab_suppressed,
      idle_suspended:                    !!suspended.idle,
      tab_switch_suspended:              !!suspended.tab_switch,
      screen_share_suspended:            !!suspended.screen_share,
      automate_idle:                     folded.automate_idle,
      automate_tab_switch:               folded.automate_tab_switch,
      automate_screen_share:             folded.automate_screen_share,
      _rule_match:                       folded._rule_match,
      _rule_overrides_automate: {
        automate_idle:         !!(folded._rule_overrides && folded._rule_overrides.automate_idle),
        automate_tab_switch:   !!(folded._rule_overrides && folded._rule_overrides.automate_tab_switch),
        automate_screen_share: !!(folded._rule_overrides && folded._rule_overrides.automate_screen_share),
      },
    };
  }

  /**
   * Backward-compat shim. Returns the union of `resolve_settings` and
   * `resolve_automate`. Used by:
   *   - popup (popup_state.js) — needs full union for the automate notif card
   *   - existing call sites that haven't migrated to the split resolvers yet
   *
   * Internally folds twice (once per resolver). Acceptable because the fold
   * is fast and this shim should fade as call sites migrate. Engine never
   * uses this; it calls `resolve_settings` directly via content_script.
   */
  function resolve(hostname, url, tab_id) {
    return Object.assign({}, resolve_settings(hostname, url, tab_id), resolve_automate(hostname, url, tab_id));
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

  async function save_blur_state(is_active) {
    await patch_section("blur_all", { status: !!is_active });
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
    var pb_items = Object.assign({}, current.pick_and_blur.items || {});
    delete pb_items[hostname];
    await _write(Object.assign({}, current, {
      pick_and_blur: Object.assign({}, current.pick_and_blur, { items: pb_items }),
    }));
  }

  // ── Screen-share / suppression wrappers ────────────────────────────────────
  // Session state lives in blsi.Automate.State. These thin wrappers exist so
  // popup (which doesn't load state.js) can call Model.suppress_screen_share
  // etc. without a direct State dependency.

  function _state() {
    return (typeof blsi !== "undefined" && blsi.Automate && blsi.Automate.State) || null;
  }

  function get_screen_share_state() {
    var S = _state();
    return S ? S.get_screen_share_state() : { active: false, sharing_tab_id: null, started_at: null, suppressed_sites: [] };
  }

  function get_suppressed_tabs() {
    var S = _state();
    return S ? S.get_suppressed_tabs() : [];
  }

  function remove_suppressed_tab(tab_id) {
    var S = _state();
    return S ? S.remove_suppressed_tab(tab_id) : Promise.resolve();
  }

  async function suppress_screen_share(scope, ctx) {
    ctx = ctx || {};
    var S = _state();
    if (scope === "tab") {
      return S ? S.add_suppressed_tab(ctx.tab_id) : Promise.resolve();
    }
    if (scope === "site_session") {
      return S ? S.suppress_screen_share_site(ctx.hostname) : Promise.resolve();
    }
    if (scope === "feature") {
      if (!S) return Promise.resolve();
      await S.suspend_trigger('screen_share');
      return S.set_screen_share_inactive();
    }
  }

  async function unsuppress_screen_share(scope, ctx) {
    ctx = ctx || {};
    var S = _state();
    if (scope === "tab") {
      return S ? S.remove_suppressed_tab(ctx.tab_id) : Promise.resolve();
    }
    if (scope === "site_session") {
      return S ? S.unsuppress_screen_share_site(ctx.hostname) : Promise.resolve();
    }
    if (scope === "feature") {
      return S ? S.resume_trigger('screen_share') : Promise.resolve();
    }
  }

  async function suppress_idle(scope, ctx) {
    ctx = ctx || {};
    var S = _state();
    if (scope === "tab") {
      return S ? S.add_idle_ignore_tab(ctx.tab_id) : Promise.resolve();
    }
    if (scope === "site_session") {
      return S ? S.add_idle_ignore_site(ctx.hostname) : Promise.resolve();
    }
    if (scope === "feature") {
      return S ? S.suspend_trigger('idle') : Promise.resolve();
    }
  }

  async function unsuppress_idle(scope, ctx) {
    ctx = ctx || {};
    var S = _state();
    if (scope === "tab") {
      return S ? S.remove_idle_ignore_tab(ctx.tab_id) : Promise.resolve();
    }
    if (scope === "site_session") {
      return S ? S.remove_idle_ignore_site(ctx.hostname) : Promise.resolve();
    }
    if (scope === "feature") {
      return S ? S.resume_trigger('idle') : Promise.resolve();
    }
  }

  async function suppress_tab_switch(scope, ctx) {
    ctx = ctx || {};
    var S = _state();
    if (scope === "tab") {
      return S ? S.add_tab_switch_ignore_tab(ctx.tab_id) : Promise.resolve();
    }
    if (scope === "site_session") {
      return S ? S.add_tab_switch_ignore_site(ctx.hostname) : Promise.resolve();
    }
    if (scope === "feature") {
      return S ? S.suspend_trigger('tab_switch') : Promise.resolve();
    }
  }

  async function unsuppress_tab_switch(scope, ctx) {
    ctx = ctx || {};
    var S = _state();
    if (scope === "tab") {
      return S ? S.remove_tab_switch_ignore_tab(ctx.tab_id) : Promise.resolve();
    }
    if (scope === "site_session") {
      return S ? S.remove_tab_switch_ignore_site(ctx.hostname) : Promise.resolve();
    }
    if (scope === "feature") {
      return S ? S.resume_trigger('tab_switch') : Promise.resolve();
    }
  }

  // ── URL rules ──────────────────────────────────────────────────────────────

  function get_rules() {
    return (get().site_rules || []).slice();
  }

  async function save_rules(rules) {
    if (!Array.isArray(rules)) return;
    var current = get();
    var valid_types = {};
    valid_types[blsi.pattern_types.exact] = true;
    valid_types[blsi.pattern_types.wildcard] = true;
    valid_types[blsi.pattern_types.regex] = true;
    var next_rules = rules
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
        return {
          hostname_value: r.hostname_value.trim().slice(0, 500),
          hostname_type: valid_types[r.hostname_type]
            ? r.hostname_type
            : blsi.pattern_types.wildcard,
          snapshot:
            r.snapshot &&
            typeof r.snapshot === "object" &&
            !Array.isArray(r.snapshot)
              ? r.snapshot
              : {},
        };
      });
    await _write(Object.assign({}, current, { site_rules: next_rules }));
  }

  // ── Test utility ───────────────────────────────────────────────────────────
  function _reset_cache() {
    _cache = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    // Init / subscribe
    init_cache,
    on_change,
    on_automate_change,
    get,
    // Model writes
    patch_section,
    save_settings,
    // Snapshot
    capture_snapshot,
    save_site_snapshot,
    get_site_snapshot,
    // Resolve (content_script)
    resolve,
    resolve_settings,
    resolve_automate,
    // Blur items
    get_blur_items,
    save_blur_state,
    save_blur_item,
    remove_blur_item,
    clear_host,
    // Screen-share / suppression wrappers (delegate to blsi.Automate.State)
    get_screen_share_state,
    get_suppressed_tabs,
    remove_suppressed_tab,
    suppress_idle,
    unsuppress_idle,
    suppress_tab_switch,
    unsuppress_tab_switch,
    suppress_screen_share,
    unsuppress_screen_share,
    // URL rules
    get_rules,
    save_rules,
    // Test
    _reset_cache,
  };
})();

blsi.Model = StorageModel;
