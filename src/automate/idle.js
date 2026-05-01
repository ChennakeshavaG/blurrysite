/**
 * automate/idle.js — Background-only OS-level idle observer.
 *
 * Wires chrome.idle.onStateChanged → blsi.Automate.State.write_idle.
 * Threshold seeded from blsi_model.automate.settings.idle and hot-updated
 * via chrome.storage.onChanged so popup changes propagate without listener
 * churn. Replaces the per-tab DOM-event timer that lived in src/auto_blur.js.
 *
 * Loaded in BACKGROUND service worker only (importScripts in background.js).
 *
 * Contract: docs/contracts/automate/idle.md
 *
 * Exposed as blsi.Automate.Idle (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  const State = (globalThis.blsi && globalThis.blsi.Automate && globalThis.blsi.Automate.State) || null;
  const MIN_THRESHOLD_SECONDS = 15;   // chrome.idle floor
  const MAX_THRESHOLD_SECONDS = 3600; // chrome.idle ceiling
  const DEFAULT_THRESHOLD_SECONDS = 300; // 5 min — matches DEFAULT_MODEL.idle.value=5,unit='min'
  const MODEL_KEY = 'blsi_model';

  let _initialized           = false;
  let _idle_listener         = null;
  let _storage_listener      = null;
  let _current_phase         = (State && State.PHASES.idle.active) || 'active';
  let _current_threshold     = DEFAULT_THRESHOLD_SECONDS;

  function _api_available() {
    return typeof chrome !== 'undefined' &&
      chrome.idle &&
      typeof chrome.idle.setDetectionInterval === 'function' &&
      chrome.idle.onStateChanged &&
      typeof chrome.idle.onStateChanged.addListener === 'function';
  }

  function _resolve_seconds_from_model(model) {
    try {
      const idle = model && model.automate && model.automate.settings && model.automate.settings.idle;
      if (!idle) return DEFAULT_THRESHOLD_SECONDS;
      const value = (typeof idle.value === 'number') ? idle.value : 5;
      const unit  = (idle.unit === 'min' || idle.unit === 'sec') ? idle.unit : 'min';
      const seconds = unit === 'min' ? value * 60 : value;
      return Math.max(MIN_THRESHOLD_SECONDS, Math.min(MAX_THRESHOLD_SECONDS, seconds));
    } catch (_) {
      return DEFAULT_THRESHOLD_SECONDS;
    }
  }

  function _on_idle_state_changed(state) {
    if (!State) return;
    const PH = State.PHASES.idle;
    if (state !== PH.active && state !== PH.idle && state !== PH.locked) return;
    _current_phase = state;
    State.write_idle(state);
  }

  function _seed_threshold_from_storage() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(MODEL_KEY, function (r) {
      const seconds = _resolve_seconds_from_model(r && r[MODEL_KEY]);
      setThreshold(seconds);
    });
  }

  function _seed_phase_from_query() {
    if (!chrome.idle || typeof chrome.idle.queryState !== 'function') return;
    chrome.idle.queryState(_current_threshold, function (state) {
      if (typeof state === 'string') _on_idle_state_changed(state);
    });
  }

  function _on_storage_changed(changes, area) {
    if (area !== 'local' || !(MODEL_KEY in changes)) return;
    const new_model = changes[MODEL_KEY].newValue;
    const seconds = _resolve_seconds_from_model(new_model);
    if (seconds !== _current_threshold) setThreshold(seconds);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init() {
    if (_initialized) return;
    if (!_api_available() || !State) return;
    _initialized = true;

    _idle_listener = _on_idle_state_changed;
    chrome.idle.onStateChanged.addListener(_idle_listener);

    _storage_listener = _on_storage_changed;
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(_storage_listener);
    }

    _seed_threshold_from_storage();
    _seed_phase_from_query();
  }

  function destroy() {
    if (_idle_listener && chrome.idle && chrome.idle.onStateChanged) {
      chrome.idle.onStateChanged.removeListener(_idle_listener);
    }
    if (_storage_listener && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.removeListener(_storage_listener);
    }
    _idle_listener = null;
    _storage_listener = null;
    _initialized = false;
  }

  function setThreshold(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    const clamped = Math.max(MIN_THRESHOLD_SECONDS, Math.min(MAX_THRESHOLD_SECONDS, seconds));
    if (clamped !== seconds && typeof console !== 'undefined') {
      console.warn('[blsi.Automate.Idle] threshold clamped from', seconds, 'to', clamped, 'seconds');
    }
    _current_threshold = clamped;
    if (chrome.idle && typeof chrome.idle.setDetectionInterval === 'function') {
      chrome.idle.setDetectionInterval(clamped);
    }
  }

  function getCurrentPhase() { return _current_phase; }

  const Idle = Object.freeze({ init, destroy, setThreshold, getCurrentPhase });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.Idle = Idle;
  }
})();
