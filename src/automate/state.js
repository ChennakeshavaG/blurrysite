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
  //
  // Why a cache exists at all:
  //   read_idle() / read_tab_switch() are synchronous because their primary
  //   caller — storage_model.resolve() — is sync, and resolve() in turn is
  //   called from popup render paths that are also sync. chrome.storage.session
  //   has no sync API, so we keep the latest value mirrored in a variable.
  //
  // Cache lifecycle (module load → steady state):
  //
  //   1. Variable declaration installs DEFAULTS:
  //        _idle_cache       = 'active'
  //        _tab_switch_cache = {}
  //      Any sync read before hydration completes returns these defaults.
  //
  //   2. Bottom of IIFE installs the onChanged LISTENER first, then calls
  //      _hydrate(). Listener-first ordering matters: a write landing between
  //      hydrate-issue and hydrate-callback would otherwise be dropped.
  //
  //   3. _hydrate() issues a one-shot async chrome.storage.session.get and
  //      OVERWRITES the defaults with persisted values if any exist (e.g. a
  //      background SW just woke up, or a tab opened mid-session after another
  //      context wrote 'idle' / a tab_switch entry). Storage empty → defaults
  //      survive.
  //
  //   4. From here on, the LISTENER is the sole external updater — every
  //      cross-context write to KEYS.idle / KEYS.tab_switch_by_tab fires
  //      _on_storage_changed which re-syncs the cache. Hydrate never runs
  //      again.
  //
  //   5. Local writes via write_idle() / write_tab_switch() take a fast path:
  //      they update the cache SYNCHRONOUSLY (so the same-tick read sees the
  //      new value), then issue chrome.storage.session.set. The onChanged
  //      echo fires the listener too, but its "value differs from cache"
  //      guard short-circuits it.

  let _idle_cache = PHASES.idle.active;             // default before SW reports
  let _tab_switch_cache = Object.create(null);      // { [tab_id]: phase }

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
      const new_v = changes[KEYS.idle].newValue;
      if (typeof new_v === 'string' && new_v !== _idle_cache) {
        _idle_cache = new_v;
      }
    }
    if (KEYS.tab_switch_by_tab in changes) {
      const raw = changes[KEYS.tab_switch_by_tab].newValue;
      _tab_switch_cache = (raw && typeof raw === 'object') ? raw : Object.create(null);
    }
  }

  // Listener BEFORE hydrate — see lifecycle note above.
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

  // Test-only — reset caches without writing to storage.
  function _reset() {
    _idle_cache = PHASES.idle.active;
    _tab_switch_cache = Object.create(null);
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
    _reset,
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.State = State;
  }
})();
