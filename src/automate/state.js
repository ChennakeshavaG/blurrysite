/**
 * automate/state.js — Shared state surface for the Automate module.
 *
 * Single source of truth for:
 *   - phase enums per trigger
 *   - chrome.storage.session key names
 *   - synchronous read/write helpers backed by an in-memory cache
 *   - cross-context onChanged listener that keeps the cache fresh
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

  const PHASES = Object.freeze({
    // chrome.idle.IdleState — kept verbatim. Single global string.
    idle: Object.freeze({
      active: 'active',
      idle:   'idle',
      locked: 'locked',
    }),
    // tab_switch is per-tab. armed = visible AND focused; fired = anything else.
    tab_switch: Object.freeze({
      off:    'off',
      armed:  'armed',
      fired:  'fired',
    }),
  });

  // chrome.storage.session keys. Authoritative names — sibling modules and
  // storage_model both read these via blsi.Automate.State.KEYS.
  const KEYS = Object.freeze({
    idle:               'blsi_automate_idle',
    tab_switch_by_tab:  'blsi_automate_tab_switch_by_tab',
    screen_share:       'blsi_screen_share',
    suppressed_tabs:    'blsi_automate_suppressed_tabs',
  });

  // ── In-memory caches (synchronous read surface) ───────────────────────────

  let _idle_cache = PHASES.idle.active;             // default before SW reports
  let _tab_switch_cache = Object.create(null);      // { [tab_id]: phase }
  let _change_listeners = [];                       // function(key, old, new)[]

  function _hydrate() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) return;
    chrome.storage.session.get([KEYS.idle, KEYS.tab_switch_by_tab], function (r) {
      if (typeof r[KEYS.idle] === 'string') _idle_cache = r[KEYS.idle];
      if (r[KEYS.tab_switch_by_tab] && typeof r[KEYS.tab_switch_by_tab] === 'object') {
        _tab_switch_cache = r[KEYS.tab_switch_by_tab];
      }
    });
  }

  function _on_storage_changed(changes, area) {
    if (area !== 'session') return;
    if (KEYS.idle in changes) {
      const old_v = _idle_cache;
      const new_v = changes[KEYS.idle].newValue;
      if (typeof new_v === 'string' && new_v !== old_v) {
        _idle_cache = new_v;
        _fire(KEYS.idle, old_v, new_v);
      }
    }
    if (KEYS.tab_switch_by_tab in changes) {
      const old_v = _tab_switch_cache;
      const raw = changes[KEYS.tab_switch_by_tab].newValue;
      const new_v = (raw && typeof raw === 'object') ? raw : Object.create(null);
      _tab_switch_cache = new_v;
      _fire(KEYS.tab_switch_by_tab, old_v, new_v);
    }
  }

  function _fire(key, old_v, new_v) {
    for (let i = 0; i < _change_listeners.length; i++) {
      try { _change_listeners[i](key, old_v, new_v); }
      catch (_) { /* swallow — one bad listener can't break others */ }
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(_on_storage_changed);
    _hydrate();
  }

  // ── Public read/write API ────────────────────────────────────────────────

  function read_idle() { return _idle_cache; }

  function read_tab_switch(tab_id) {
    if (typeof tab_id !== 'number') return PHASES.tab_switch.off;
    return _tab_switch_cache[tab_id] || PHASES.tab_switch.off;
  }

  function read_all_tab_switch() { return Object.assign({}, _tab_switch_cache); }

  // Idempotent — no-op if value equals current. Returns Promise<boolean>.
  function write_idle(phase) {
    if (typeof phase !== 'string') return Promise.resolve(false);
    if (_idle_cache === phase) return Promise.resolve(false);
    _idle_cache = phase;  // optimistic — onChanged echoes back as no-op
    return new Promise(function (resolve) {
      const payload = {}; payload[KEYS.idle] = phase;
      chrome.storage.session.set(payload, function () { resolve(true); });
    });
  }

  function write_tab_switch(tab_id, phase) {
    if (typeof tab_id !== 'number' || typeof phase !== 'string') return Promise.resolve(false);
    if (_tab_switch_cache[tab_id] === phase) return Promise.resolve(false);
    if (phase === PHASES.tab_switch.off && !(tab_id in _tab_switch_cache)) return Promise.resolve(false);
    const next = Object.assign({}, _tab_switch_cache);
    if (phase === PHASES.tab_switch.off) {
      delete next[tab_id];                         // strip 'off' to keep map small
    } else {
      next[String(tab_id)] = phase;
    }
    _tab_switch_cache = next;
    return new Promise(function (resolve) {
      const payload = {}; payload[KEYS.tab_switch_by_tab] = next;
      chrome.storage.session.set(payload, function () { resolve(true); });
    });
  }

  function clear_tab_switch(tab_id) { return write_tab_switch(tab_id, PHASES.tab_switch.off); }

  // Subscriber registry. Caller passes (key, old_v, new_v); returns unsubscribe.
  function on_change(fn) {
    if (typeof fn !== 'function') return function () {};
    _change_listeners.push(fn);
    return function unsubscribe() {
      const idx = _change_listeners.indexOf(fn);
      if (idx >= 0) _change_listeners.splice(idx, 1);
    };
  }

  // Test-only — reset caches without writing to storage.
  function _reset() {
    _idle_cache = PHASES.idle.active;
    _tab_switch_cache = Object.create(null);
    _change_listeners = [];
  }

  const State = Object.freeze({
    PHASES,
    KEYS,
    read_idle,
    read_tab_switch,
    read_all_tab_switch,
    write_idle,
    write_tab_switch,
    clear_tab_switch,
    on_change,
    _reset,
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.State = State;
  }
})();
