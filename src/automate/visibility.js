/**
 * automate/visibility.js — Per-tab presence observer.
 *
 * Watches whether the user is currently looking at this tab. "Looking at"
 * means: tab is visible AND the browser window has focus. Anything else
 * (switched to another tab, minimized, focused another window/app, docked
 * devtools, etc.) flips the tab to 'fired'.
 *
 * Three event sources cover the away-from-tab cases:
 *   - document 'visibilitychange' — tab switch / minimize / restore
 *   - window   'blur'             — another window or app stole focus
 *   - window   'focus'            — focus returned, re-evaluate
 *
 * We listen on the window (not focusin/focusout) because we care that the
 * WINDOW lost focus — focusin/focusout fire on every element-level focus
 * change inside the page (input clicks, tab-through), which is way noisier
 * than the signal we want.
 *
 * Result is written via blsi.Automate.State.write_tab_switch(tab_id, phase).
 * Only 'fired' is persisted; 'armed' writes 'off' which strips the entry
 * (absence in the map === armed/off — keeps the map small, since most tabs
 * are armed most of the time). State.write_tab_switch is idempotent, so
 * same-value events absorb at the State layer — no local dedup needed.
 *
 * Loaded in CONTENT context only (manifest content_scripts).
 *
 * Contract: docs/contracts/automate/visibility.md
 *
 * Exposed as blsi.Automate.Visibility (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  const State = (globalThis.blsi && globalThis.blsi.Automate && globalThis.blsi.Automate.State) || null;

  let _initialized = false;
  let _tab_id      = null;

  // Single handler registered on all three events. Re-derives the phase from
  // the live document state and writes through State. Same function reference
  // is used for add + remove, so addEventListener / removeEventListener match
  // by identity without needing alias variables.
  function _context_alive() {
    return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
  }

  function _evaluate_and_write() {
    if (!State || typeof _tab_id !== 'number') return;
    if (!_context_alive()) {
      _teardown_stale();
      return;
    }

    // Active = tab visible AND window focused. Both checks needed: a tab can
    // be 'visible' (rendered on screen) while the user has alt-tabbed to
    // another app — visibilityState alone would miss that. The non-browser
    // fallback (no document) defaults to active so test environments don't
    // spuriously fire.
    let active = true;
    if (typeof document !== 'undefined') {
      if (document.visibilityState === 'hidden') active = false;
      else if (typeof document.hasFocus === 'function' && !document.hasFocus()) active = false;
    }

    const PH = State.PHASES.tab_switch;
    State.write_tab_switch(_tab_id, active ? PH.off : PH.fired);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init(opts) {
    const next_tab_id = opts && typeof opts.tab_id === 'number' ? opts.tab_id : null;
    if (next_tab_id === null) return;

    if (_initialized && next_tab_id === _tab_id) return;
    if (_initialized && next_tab_id !== _tab_id) destroy();

    _tab_id = next_tab_id;
    _initialized = true;

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', _evaluate_and_write, true);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('focus', _evaluate_and_write, true);
      window.addEventListener('blur',  _evaluate_and_write, true);
    }

    // Seed storage on init — writes 'fired' if the tab opened hidden/unfocused,
    // skipped (idempotent at State layer) when armed.
    _evaluate_and_write();
  }

  function _remove_listeners() {
    if (typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('visibilitychange', _evaluate_and_write, true);
    }
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('focus', _evaluate_and_write, true);
      window.removeEventListener('blur',  _evaluate_and_write, true);
    }
  }

  function _teardown_stale() {
    _remove_listeners();
    _tab_id = null;
    _initialized = false;
  }

  function destroy() {
    _remove_listeners();
    if (State && typeof _tab_id === 'number') {
      State.clear_tab_switch(_tab_id);
    }
    _tab_id = null;
    _initialized = false;
  }

  const Visibility = Object.freeze({ init, destroy });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.Visibility = Visibility;
  }
})();
