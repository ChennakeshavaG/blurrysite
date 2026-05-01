/**
 * automate/visibility.js — Per-tab Page Lifecycle observer.
 *
 * Listens to visibilitychange + window.focus/blur. Derives an active /
 * passive / hidden state (Page Lifecycle), maps it to 'armed' | 'fired',
 * and writes via blsi.Automate.State.write_tab_switch(tab_id, phase).
 *
 * Replaces the tab-switch portion of src/auto_blur.js. No hand-rolled
 * debounces — same-value writes are absorbed by State's idempotency.
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
  let _on_vis      = null;
  let _on_focus    = null;
  let _on_blur     = null;
  let _current_phase = (State && State.PHASES.tab_switch.armed) || 'armed';

  function _is_active() {
    if (typeof document === 'undefined') return true;
    if (document.visibilityState === 'hidden') return false;
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
    return true;
  }

  function _derive_phase() {
    if (!State) return 'armed';
    return _is_active() ? State.PHASES.tab_switch.armed : State.PHASES.tab_switch.fired;
  }

  function _evaluate_and_write() {
    if (!State || typeof _tab_id !== 'number') return;
    const phase = _derive_phase();
    if (phase === _current_phase) return;
    _current_phase = phase;
    // D4: absence === armed/off. Only write 'fired' as a real entry; 'armed'
    // strips the entry (write_tab_switch with 'off' is the absence write).
    const PH = State.PHASES.tab_switch;
    if (phase === PH.fired) State.write_tab_switch(_tab_id, PH.fired);
    else                    State.write_tab_switch(_tab_id, PH.off);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init(opts) {
    const next_tab_id = opts && typeof opts.tab_id === 'number' ? opts.tab_id : null;
    if (next_tab_id === null) return;

    if (_initialized && next_tab_id === _tab_id) return;
    if (_initialized && next_tab_id !== _tab_id) destroy();

    _tab_id = next_tab_id;
    _initialized = true;

    _on_vis   = _evaluate_and_write;
    _on_focus = _evaluate_and_write;
    _on_blur  = _evaluate_and_write;

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', _on_vis, true);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('focus', _on_focus, true);
      window.addEventListener('blur',  _on_blur,  true);
    }

    // Seed the entry on init.
    _current_phase = null;     // force the first write through
    _evaluate_and_write();
  }

  function destroy() {
    if (typeof document !== 'undefined' && document.removeEventListener && _on_vis) {
      document.removeEventListener('visibilitychange', _on_vis, true);
    }
    if (typeof window !== 'undefined' && window.removeEventListener) {
      if (_on_focus) window.removeEventListener('focus', _on_focus, true);
      if (_on_blur)  window.removeEventListener('blur',  _on_blur,  true);
    }
    if (State && typeof _tab_id === 'number') {
      State.clear_tab_switch(_tab_id);
    }
    _on_vis = null;
    _on_focus = null;
    _on_blur = null;
    _tab_id = null;
    _initialized = false;
    _current_phase = (State && State.PHASES.tab_switch.armed) || 'armed';
  }

  function getCurrentPhase() { return _current_phase; }

  const Visibility = Object.freeze({ init, destroy, getCurrentPhase });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.Visibility = Visibility;
  }
})();
