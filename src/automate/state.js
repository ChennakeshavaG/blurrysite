/**
 * automate/state.js — Shared state surface for the Automate module.
 *
 * Single source of truth for ALL automate session state:
 *   - idle phase (global)
 *   - tab_switch phase (per-tab)
 *   - screen_share map (per-tab)
 *   - suppressed_tabs list (per-tab)
 *   - phase enums per trigger
 *   - chrome.storage.session key names
 *   - synchronous read/write helpers backed by in-memory caches
 *   - single onChanged listener that updates ALL caches before notifying
 *
 * Loaded in BOTH contexts:
 *   - background (importScripts at top of background.js, before automate/idle.js)
 *   - content (manifest content_scripts, before automate/visibility.js)
 *
 * Contract: docs/contracts/automate/state.md
 *
 * Exposed as blsi.Automate.State (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  var PHASES = Object.freeze({
    idle: Object.freeze({ active: 'active', idle: 'idle', locked: 'locked' }),
    tab_switch: Object.freeze({ off: 'off', armed: 'armed', fired: 'fired' }),
  });

  var KEYS = Object.freeze({
    idle:               'blsi_automate_idle',
    tab_switch_by_tab:  'blsi_automate_tab_switch_by_tab',
    screen_share:       'blsi_screen_share',
    suppressed_tabs:    'blsi_automate_suppressed_tabs',
  });

  // ── Defaults & normalizers ──────────────────────────────────────────────

  function _default_screen_share() { return {}; }

  function _normalize_ss_entry(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      started_at: typeof v.started_at === 'number' ? v.started_at : null,
      suppressed_sites: Array.isArray(v.suppressed_sites)
        ? v.suppressed_sites.filter(function (s) { return typeof s === 'string' && s; })
        : [],
    };
  }

  function _normalize_screen_share(raw) {
    if (!raw || typeof raw !== 'object') return {};
    // Migrate old single-record shape
    if ('active' in raw) {
      if (!raw.active || typeof raw.sharing_tab_id !== 'number') return {};
      var entry = {};
      entry[String(raw.sharing_tab_id)] = {
        started_at: typeof raw.started_at === 'number' ? raw.started_at : null,
        suppressed_sites: Array.isArray(raw.suppressed_sites)
          ? raw.suppressed_sites.filter(function (s) { return typeof s === 'string' && s; })
          : [],
      };
      return entry;
    }
    // New per-tab map shape
    var out = {};
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!/^\d+$/.test(k)) continue;
      var e = _normalize_ss_entry(raw[k]);
      if (e) out[k] = e;
    }
    return out;
  }

  function _normalize_suppressed_tabs(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (n) { return typeof n === 'number' && Number.isFinite(n); });
  }

  // ── Normalizers for idle / tab_switch object shape ────────────────────

  function _default_idle() { return { status: PHASES.idle.active, ignore_tabs: [], ignore_sites: [] }; }
  function _default_tab_switch() { return { status: Object.create(null), ignore_tabs: [], ignore_sites: [] }; }

  function _normalize_idle(raw) {
    if (typeof raw === 'string') return { status: raw, ignore_tabs: [], ignore_sites: [] };
    if (!raw || typeof raw !== 'object') return _default_idle();
    return {
      status: typeof raw.status === 'string' ? raw.status : PHASES.idle.active,
      ignore_tabs: _normalize_number_array(raw.ignore_tabs),
      ignore_sites: _normalize_string_array(raw.ignore_sites),
    };
  }

  function _normalize_tab_switch(raw) {
    if (!raw || typeof raw !== 'object') return _default_tab_switch();
    // Migration: old flat map { '42': 'fired' } — all keys numeric
    if (!('status' in raw) && !('ignore_tabs' in raw) && !('ignore_sites' in raw)) {
      return { status: raw, ignore_tabs: [], ignore_sites: [] };
    }
    var status_map = (raw.status && typeof raw.status === 'object') ? raw.status : Object.create(null);
    return {
      status: status_map,
      ignore_tabs: _normalize_number_array(raw.ignore_tabs),
      ignore_sites: _normalize_string_array(raw.ignore_sites),
    };
  }

  function _normalize_number_array(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (n) { return typeof n === 'number' && Number.isFinite(n); });
  }

  function _normalize_string_array(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (s) { return typeof s === 'string' && s; });
  }

  // ── In-memory caches ────────────────────────────────────────────────────

  var _idle_cache           = _default_idle();
  var _tab_switch_cache     = _default_tab_switch();
  var _screen_share_cache   = {};
  var _suppressed_tabs_cache = [];

  // ── Subscribers ─────────────────────────────────────────────────────────
  // on_session_change  — Manager path (automate evaluation; cache guaranteed fresh)
  // on_session_notify  — Model relay (content_script/popup re-render)

  var _on_session_change = null;
  var _on_session_notify = null;

  function _fire_subscribers() {
    if (_on_session_change) _on_session_change();
    if (_on_session_notify) _on_session_notify();
  }

  // ── Session storage helpers ─────────────────────────────────────────────

  function _has_session() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session;
  }

  function _session_set(key, value) {
    if (!_has_session()) return Promise.resolve();
    return new Promise(function (resolve) {
      var payload = {};
      payload[key] = value;
      chrome.storage.session.set(payload, function () {
        if (chrome.runtime.lastError) {
          console.warn('[blsi.State] session write failed:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  function _session_set_multi(obj) {
    if (!_has_session()) return Promise.resolve();
    return new Promise(function (resolve) {
      chrome.storage.session.set(obj, function () {
        if (chrome.runtime.lastError) {
          console.warn('[blsi.State] session write failed:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  // ── Hydration ───────────────────────────────────────────────────────────

  function _hydrate() {
    if (!_has_session()) return;
    chrome.storage.session.get(
      [KEYS.idle, KEYS.tab_switch_by_tab, KEYS.screen_share, KEYS.suppressed_tabs],
      function (r) {
        if (chrome.runtime.lastError || !r) return;
        if (r[KEYS.idle] != null) _idle_cache = _normalize_idle(r[KEYS.idle]);
        if (r[KEYS.tab_switch_by_tab] != null) {
          _tab_switch_cache = _normalize_tab_switch(r[KEYS.tab_switch_by_tab]);
        }
        if (r[KEYS.screen_share]) {
          _screen_share_cache = _normalize_screen_share(r[KEYS.screen_share]);
        }
        if (r[KEYS.suppressed_tabs]) {
          _suppressed_tabs_cache = _normalize_suppressed_tabs(r[KEYS.suppressed_tabs]);
        }
      }
    );
  }

  // ── Storage listener ────────────────────────────────────────────────────
  // Single listener for ALL session keys. Updates every cache BEFORE firing
  // subscribers — eliminates the race where Manager reads stale data.

  function _on_storage_changed(changes, area) {
    if (area !== 'session') return;
    if (!chrome.runtime || !chrome.runtime.id) {
      chrome.storage.onChanged.removeListener(_on_storage_changed);
      return;
    }
    var fired = false;

    if (KEYS.idle in changes) {
      var new_idle = _normalize_idle(changes[KEYS.idle].newValue);
      if (new_idle.status !== _idle_cache.status ||
          new_idle.ignore_tabs.length !== _idle_cache.ignore_tabs.length ||
          new_idle.ignore_sites.length !== _idle_cache.ignore_sites.length) {
        _idle_cache = new_idle;
        fired = true;
      }
    }
    if (KEYS.tab_switch_by_tab in changes) {
      _tab_switch_cache = _normalize_tab_switch(changes[KEYS.tab_switch_by_tab].newValue);
      fired = true;
    }
    if (KEYS.screen_share in changes) {
      _screen_share_cache = _normalize_screen_share(
        changes[KEYS.screen_share].newValue || _default_screen_share()
      );
      fired = true;
    }
    if (KEYS.suppressed_tabs in changes) {
      _suppressed_tabs_cache = _normalize_suppressed_tabs(
        changes[KEYS.suppressed_tabs].newValue || []
      );
      fired = true;
    }

    if (fired) _fire_subscribers();
  }

  // Listener BEFORE hydrate — a write landing between hydrate-issue and
  // hydrate-callback would otherwise be dropped.
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(_on_storage_changed);
    _hydrate();
  }

  // ── Idle read/write ─────────────────────────────────────────────────────

  function read_idle() { return _idle_cache.status; }

  function read_idle_ignore() {
    return { ignore_tabs: _idle_cache.ignore_tabs.slice(), ignore_sites: _idle_cache.ignore_sites.slice() };
  }

  function write_idle(phase) {
    if (typeof phase !== 'string') return Promise.resolve(false);
    if (_idle_cache.status === phase) return Promise.resolve(false);
    _idle_cache = { status: phase, ignore_tabs: _idle_cache.ignore_tabs, ignore_sites: _idle_cache.ignore_sites };
    _fire_subscribers();
    return _session_set(KEYS.idle, _idle_cache).then(function () { return true; });
  }

  function add_idle_ignore_tab(tab_id) {
    if (typeof tab_id !== 'number' || !Number.isFinite(tab_id)) return Promise.resolve();
    if (_idle_cache.ignore_tabs.indexOf(tab_id) >= 0) return Promise.resolve();
    _idle_cache = { status: _idle_cache.status, ignore_tabs: _idle_cache.ignore_tabs.concat([tab_id]), ignore_sites: _idle_cache.ignore_sites };
    _fire_subscribers();
    return _session_set(KEYS.idle, _idle_cache);
  }

  function remove_idle_ignore_tab(tab_id) {
    if (typeof tab_id !== 'number') return Promise.resolve();
    if (_idle_cache.ignore_tabs.indexOf(tab_id) < 0) return Promise.resolve();
    _idle_cache = { status: _idle_cache.status, ignore_tabs: _idle_cache.ignore_tabs.filter(function (t) { return t !== tab_id; }), ignore_sites: _idle_cache.ignore_sites };
    _fire_subscribers();
    return _session_set(KEYS.idle, _idle_cache);
  }

  function add_idle_ignore_site(hostname) {
    if (typeof hostname !== 'string' || !hostname) return Promise.resolve();
    if (_idle_cache.ignore_sites.indexOf(hostname) >= 0) return Promise.resolve();
    _idle_cache = { status: _idle_cache.status, ignore_tabs: _idle_cache.ignore_tabs, ignore_sites: _idle_cache.ignore_sites.concat([hostname]) };
    _fire_subscribers();
    return _session_set(KEYS.idle, _idle_cache);
  }

  function remove_idle_ignore_site(hostname) {
    if (typeof hostname !== 'string' || !hostname) return Promise.resolve();
    if (_idle_cache.ignore_sites.indexOf(hostname) < 0) return Promise.resolve();
    _idle_cache = { status: _idle_cache.status, ignore_tabs: _idle_cache.ignore_tabs, ignore_sites: _idle_cache.ignore_sites.filter(function (h) { return h !== hostname; }) };
    _fire_subscribers();
    return _session_set(KEYS.idle, _idle_cache);
  }

  // ── Tab-switch read/write ───────────────────────────────────────────────

  function read_tab_switch(tab_id) {
    if (typeof tab_id !== 'number') return PHASES.tab_switch.off;
    return _tab_switch_cache.status[tab_id] || PHASES.tab_switch.off;
  }

  function read_all_tab_switch() { return Object.assign({}, _tab_switch_cache.status); }

  function read_tab_switch_ignore() {
    return { ignore_tabs: _tab_switch_cache.ignore_tabs.slice(), ignore_sites: _tab_switch_cache.ignore_sites.slice() };
  }

  function write_tab_switch(tab_id, phase) {
    if (typeof tab_id !== 'number' || typeof phase !== 'string') return Promise.resolve(false);
    if (_tab_switch_cache.status[tab_id] === phase) return Promise.resolve(false);
    if (phase === PHASES.tab_switch.off && !(tab_id in _tab_switch_cache.status)) return Promise.resolve(false);
    var next_status = Object.assign({}, _tab_switch_cache.status);
    if (phase === PHASES.tab_switch.off) {
      delete next_status[tab_id];
    } else {
      next_status[String(tab_id)] = phase;
    }
    _tab_switch_cache = { status: next_status, ignore_tabs: _tab_switch_cache.ignore_tabs, ignore_sites: _tab_switch_cache.ignore_sites };
    _fire_subscribers();
    return _session_set(KEYS.tab_switch_by_tab, _tab_switch_cache).then(function () { return true; });
  }

  function clear_tab_switch(tab_id) { return write_tab_switch(tab_id, PHASES.tab_switch.off); }

  function add_tab_switch_ignore_tab(tab_id) {
    if (typeof tab_id !== 'number' || !Number.isFinite(tab_id)) return Promise.resolve();
    if (_tab_switch_cache.ignore_tabs.indexOf(tab_id) >= 0) return Promise.resolve();
    _tab_switch_cache = { status: _tab_switch_cache.status, ignore_tabs: _tab_switch_cache.ignore_tabs.concat([tab_id]), ignore_sites: _tab_switch_cache.ignore_sites };
    _fire_subscribers();
    return _session_set(KEYS.tab_switch_by_tab, _tab_switch_cache);
  }

  function remove_tab_switch_ignore_tab(tab_id) {
    if (typeof tab_id !== 'number') return Promise.resolve();
    if (_tab_switch_cache.ignore_tabs.indexOf(tab_id) < 0) return Promise.resolve();
    _tab_switch_cache = { status: _tab_switch_cache.status, ignore_tabs: _tab_switch_cache.ignore_tabs.filter(function (t) { return t !== tab_id; }), ignore_sites: _tab_switch_cache.ignore_sites };
    _fire_subscribers();
    return _session_set(KEYS.tab_switch_by_tab, _tab_switch_cache);
  }

  function add_tab_switch_ignore_site(hostname) {
    if (typeof hostname !== 'string' || !hostname) return Promise.resolve();
    if (_tab_switch_cache.ignore_sites.indexOf(hostname) >= 0) return Promise.resolve();
    _tab_switch_cache = { status: _tab_switch_cache.status, ignore_tabs: _tab_switch_cache.ignore_tabs, ignore_sites: _tab_switch_cache.ignore_sites.concat([hostname]) };
    _fire_subscribers();
    return _session_set(KEYS.tab_switch_by_tab, _tab_switch_cache);
  }

  function remove_tab_switch_ignore_site(hostname) {
    if (typeof hostname !== 'string' || !hostname) return Promise.resolve();
    if (_tab_switch_cache.ignore_sites.indexOf(hostname) < 0) return Promise.resolve();
    _tab_switch_cache = { status: _tab_switch_cache.status, ignore_tabs: _tab_switch_cache.ignore_tabs, ignore_sites: _tab_switch_cache.ignore_sites.filter(function (h) { return h !== hostname; }) };
    _fire_subscribers();
    return _session_set(KEYS.tab_switch_by_tab, _tab_switch_cache);
  }

  // ── Screen-share read/write ─────────────────────────────────────────────

  function get_screen_share_state(opt_tab_id) {
    var map = _screen_share_cache;
    var keys = Object.keys(map);
    var active = keys.length > 0;
    var all_suppressed = [];
    var first_tab_id = null;
    for (var i = 0; i < keys.length; i++) {
      var tid = Number(keys[i]);
      var entry = map[keys[i]];
      if (first_tab_id === null) first_tab_id = tid;
      var sites = entry.suppressed_sites;
      for (var j = 0; j < sites.length; j++) {
        if (all_suppressed.indexOf(sites[j]) < 0) all_suppressed.push(sites[j]);
      }
    }
    var report_tab = (typeof opt_tab_id === 'number' && map[String(opt_tab_id)])
      ? opt_tab_id : first_tab_id;
    var report_entry = report_tab !== null ? map[String(report_tab)] : null;
    return {
      active:           active,
      sharing_tab_id:   report_tab,
      started_at:       report_entry ? report_entry.started_at : null,
      suppressed_sites: all_suppressed,
      _sharing_tab_ids: keys.map(Number),
    };
  }

  function set_screen_share_active(tabId) {
    if (typeof tabId !== 'number') return Promise.resolve();
    var next = Object.assign({}, _screen_share_cache);
    next[String(tabId)] = { started_at: Date.now(), suppressed_sites: [] };
    _screen_share_cache = next;
    _suppressed_tabs_cache = [];
    _fire_subscribers();
    var payload = {};
    payload[KEYS.screen_share] = next;
    payload[KEYS.suppressed_tabs] = [];
    return _session_set_multi(payload);
  }

  function set_screen_share_inactive(opt_tabId) {
    if (typeof opt_tabId === 'number') {
      var key = String(opt_tabId);
      if (!(key in _screen_share_cache)) return Promise.resolve();
      var next = Object.assign({}, _screen_share_cache);
      delete next[key];
      _screen_share_cache = next;
      _fire_subscribers();
      return _session_set(KEYS.screen_share, next);
    }
    _screen_share_cache = {};
    _fire_subscribers();
    return _session_set(KEYS.screen_share, {});
  }

  function suppress_screen_share_site(hostname, opt_tabId) {
    if (typeof hostname !== 'string' || !hostname) return Promise.resolve();
    var next = Object.assign({}, _screen_share_cache);
    var changed = false;
    var keys = typeof opt_tabId === 'number' ? [String(opt_tabId)] : Object.keys(next);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!next[k]) continue;
      if (next[k].suppressed_sites.indexOf(hostname) >= 0) continue;
      next[k] = Object.assign({}, next[k], {
        suppressed_sites: next[k].suppressed_sites.concat([hostname]),
      });
      changed = true;
    }
    if (!changed) return Promise.resolve();
    _screen_share_cache = next;
    _fire_subscribers();
    return _session_set(KEYS.screen_share, next);
  }

  function unsuppress_screen_share_site(hostname, opt_tabId) {
    if (typeof hostname !== 'string' || !hostname) return Promise.resolve();
    var next = Object.assign({}, _screen_share_cache);
    var changed = false;
    var keys = typeof opt_tabId === 'number' ? [String(opt_tabId)] : Object.keys(next);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!next[k]) continue;
      if (next[k].suppressed_sites.indexOf(hostname) < 0) continue;
      next[k] = Object.assign({}, next[k], {
        suppressed_sites: next[k].suppressed_sites.filter(function (h) { return h !== hostname; }),
      });
      changed = true;
    }
    if (!changed) return Promise.resolve();
    _screen_share_cache = next;
    _fire_subscribers();
    return _session_set(KEYS.screen_share, next);
  }

  // ── Suppressed-tabs read/write ──────────────────────────────────────────

  function get_suppressed_tabs() { return _suppressed_tabs_cache.slice(); }

  function add_suppressed_tab(tab_id) {
    if (typeof tab_id !== 'number' || !Number.isFinite(tab_id)) return Promise.resolve();
    if (_suppressed_tabs_cache.indexOf(tab_id) >= 0) return Promise.resolve();
    var next = _suppressed_tabs_cache.concat([tab_id]);
    _suppressed_tabs_cache = next;
    _fire_subscribers();
    return _session_set(KEYS.suppressed_tabs, next);
  }

  function remove_suppressed_tab(tab_id) {
    if (typeof tab_id !== 'number') return Promise.resolve();
    if (_suppressed_tabs_cache.indexOf(tab_id) < 0) return Promise.resolve();
    var next = _suppressed_tabs_cache.filter(function (t) { return t !== tab_id; });
    _suppressed_tabs_cache = next;
    _fire_subscribers();
    return _session_set(KEYS.suppressed_tabs, next);
  }

  function clear_suppressed_tabs() {
    if (!_suppressed_tabs_cache.length) return Promise.resolve();
    _suppressed_tabs_cache = [];
    _fire_subscribers();
    return _session_set(KEYS.suppressed_tabs, []);
  }

  // ── Subscriber registration ─────────────────────────────────────────────

  function on_session_change(cb) { _on_session_change = cb; }
  function on_session_notify(cb) { _on_session_notify = cb; }

  // ── Test-only reset ─────────────────────────────────────────────────────

  function _reset() {
    _idle_cache = _default_idle();
    _tab_switch_cache = _default_tab_switch();
    _screen_share_cache = {};
    _suppressed_tabs_cache = [];
    _on_session_change = null;
    _on_session_notify = null;
  }

  // ── Export ──────────────────────────────────────────────────────────────

  var State = Object.freeze({
    PHASES,
    KEYS,
    // idle
    read_idle,
    read_idle_ignore,
    write_idle,
    add_idle_ignore_tab,
    remove_idle_ignore_tab,
    add_idle_ignore_site,
    remove_idle_ignore_site,
    // tab_switch
    read_tab_switch,
    read_all_tab_switch,
    read_tab_switch_ignore,
    write_tab_switch,
    clear_tab_switch,
    add_tab_switch_ignore_tab,
    remove_tab_switch_ignore_tab,
    add_tab_switch_ignore_site,
    remove_tab_switch_ignore_site,
    // screen_share
    get_screen_share_state,
    set_screen_share_active,
    set_screen_share_inactive,
    suppress_screen_share_site,
    unsuppress_screen_share_site,
    // suppressed_tabs
    get_suppressed_tabs,
    add_suppressed_tab,
    remove_suppressed_tab,
    clear_suppressed_tabs,
    // subscribers
    on_session_change,
    on_session_notify,
    // test
    _reset,
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.State = State;
  }
})();
