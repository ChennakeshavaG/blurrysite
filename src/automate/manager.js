/**
 * automate/manager.js — Automate orchestrator.
 *
 * The single owner of automate-driven Overlay show/hide AND automate
 * transition toasts (idle / tab_switch / screen_share). Reacts to:
 *   - chrome.storage.session changes (idle / tab_switch / screen_share /
 *     suppressed_tabs) via blsi.Automate.State.on_session_change (caches
 *     guaranteed fresh before callback fires)
 *   - chrome.storage.local changes that may flip automate gates (popup edits
 *     to automate.*.enabled, site_rules) via blsi.Model.on_automate_change
 *   - Explicit URL change notifications from content_script (SPA navigation)
 *
 * Reads `blsi.Model.resolve_automate(host, url, tab_id)` for its slim
 * automate-decision snapshot. Never calls the engine. Never reads the full
 * `resolve()`. Engine remains responsible for stamp + CSS render path.
 *
 * Loaded in CONTENT context only. Main-frame only at the call site
 * (content_script.init() guards on IS_MAIN_FRAME before invoking Manager.init).
 *
 * Contract: docs/contracts/automate/manager.md
 *
 * Exposed as blsi.Automate.Manager (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  let _initialized              = false;
  let _tab_id                   = null;
  let _get_host_url             = null;   // function() → { host, url }
  let _ss_stop_actions          = null;   // async function() → Array<{label,onClick,variant?}> — screen-share only
  let _ss_resume_action         = null;   // async function() → Array<{label,onClick}> — undo suspend
  let _last_active      = false;  // tracks Overlay state to detect transitions
  // Toast transition tracking — seeded on first _evaluate so the bootstrap
  // call doesn't fire toasts for state that already existed when the tab
  // opened. Subsequent storage events trigger real transitions.
  let _seeded                  = false;
  let _last_idle_phase         = 'active';
  let _last_tab_switch_phase   = 'off';
  let _last_ss_blurring        = false;

  // ── Toast helpers ─────────────────────────────────────────────────────────

  function _toast() {
    return (typeof blsi !== 'undefined' && blsi.Toast && typeof blsi.Toast.show === 'function')
      ? blsi.Toast
      : null;
  }

  function _i18n_msg(key) {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
      return chrome.i18n.getMessage(key) || '';
    }
    return '';
  }

  function _toast_msg(key, override_key, rule_overrides) {
    const base = _i18n_msg(key);
    if (override_key && rule_overrides && rule_overrides[override_key]) {
      const suffix = _i18n_msg('toast_suffix_site_rule') || '(site rule)';
      return base + ' ' + suffix;
    }
    return base;
  }

  function _state() {
    return (typeof blsi !== 'undefined' && blsi.Automate && blsi.Automate.State) || null;
  }

  // ── Evaluation pipeline ───────────────────────────────────────────────────

  function _evaluate() {
    if (!_initialized || !_get_host_url) return;
    if (typeof blsi === 'undefined' || !blsi.Model) return;

    // Master switch — extension disabled means no automate render even when
    // settings (still in storage) would say a trigger is firing.
    const m = blsi.Model.get();
    if (!m || !m.global_default_settings || m.global_default_settings.enabled === false) {
      _apply({ automate_blur_active: false }, /*master_off=*/ true);
      return;
    }

    let ctx;
    try { ctx = _get_host_url(); }
    catch (_) { return; }  // host source threw — skip; storage subscriber stays alive.
    if (!ctx || typeof ctx.host !== 'string') {
      // No host yet (rare — content_script init guards this) — skip silently.
      return;
    }
    const r = blsi.Model.resolve_automate(ctx.host, ctx.url || '', _tab_id);
    _apply(r, false);
  }

  function _apply(r, master_off) {
    const Overlay = (typeof blsi !== 'undefined' && blsi.Automate && blsi.Automate.Overlay) || null;
    const active = !!(r && r.automate_blur_active);
    if (Overlay) {
      if (active) Overlay.show();
      else        Overlay.hide();
    }
    _last_active = active;

    // Toasts: skip the very first evaluation (bootstrap seeds tracking values
    // without alerting the user about pre-existing state). Also skip when the
    // master switch is off — no toasts when the extension itself is disabled.
    if (master_off) {
      // If the persistent screen-share toast was up when the extension was
      // turned off, dismiss it explicitly. The falling-edge cleanup in
      // _fire_toasts is unreachable on the master_off path and Toast.show's
      // own auto-dismiss is suppressed by `persistent: true`.
      if (_last_ss_blurring) {
        const T = _toast();
        if (T && typeof T.dismiss === 'function') T.dismiss();
      }
      _seed_tracking(r);
      return;
    }
    if (!_seeded) {
      _seed_tracking(r);
      _seeded = true;
      return;
    }
    _fire_toasts(r);
    _seed_tracking(r);
  }

  function _seed_tracking(r) {
    const State = _state();
    _last_idle_phase = State ? State.read_idle() : 'active';
    _last_tab_switch_phase = (State && typeof _tab_id === 'number')
      ? State.read_tab_switch(_tab_id)
      : 'off';
    _last_ss_blurring = !!(r && r.automate_blur_triggers && r.automate_blur_triggers.screen_share);
  }

  function _fire_toasts(r) {
    const Toast = _toast();
    if (!Toast) return;  // Toast module not yet loaded — first storage event after load will catch up.
    const State = _state();
    if (!State) return;

    const overrides = (r && r._rule_overrides_automate) || {};
    const triggers  = (r && r.automate_blur_triggers)    || {};
    const idle_phase = State.read_idle();
    const ts_phase   = (typeof _tab_id === 'number') ? State.read_tab_switch(_tab_id) : 'off';
    const ss_blurring = !!triggers.screen_share;

    // 1. Idle toast — info-only on rising edge; dismissed on the falling edge
    //    when the user becomes active again. Duration is controlled by
    //    `blsi.idle_toast_duration_seconds` (0 = persistent forever; N = N
    //    seconds auto-dismiss). Skipped while screen-share holds the slot —
    //    SS has higher priority.
    if (triggers.idle &&
        idle_phase !== _last_idle_phase &&
        (idle_phase === State.PHASES.idle.idle || idle_phase === State.PHASES.idle.locked) &&
        !ss_blurring) {
      const idle_dur_s = (typeof blsi !== 'undefined' && typeof blsi.idle_toast_duration_seconds === 'number')
        ? blsi.idle_toast_duration_seconds
        : 0;
      const idle_msg = _toast_msg('automate_toast_idle', 'automate_idle', overrides);
      if (idle_dur_s <= 0) {
        Toast.show(idle_msg, undefined, undefined, { persistent: true });
      } else {
        Toast.show(idle_msg, idle_dur_s * 1000);
      }
    } else if (!triggers.idle && _last_idle_phase !== 'active' && idle_phase === 'active' && !ss_blurring) {
      // Falling edge: idle cleared and screen-share isn't holding the toast slot.
      const T = _toast();
      if (T && typeof T.dismiss === 'function') T.dismiss();
    }

    // 2. Tab-switch toast — short 3s notification, no actions.
    if (triggers.tab_switch &&
        ts_phase !== _last_tab_switch_phase &&
        ts_phase === State.PHASES.tab_switch.fired) {
      Toast.show(_toast_msg('automate_toast_tab_switch', 'automate_tab_switch', overrides), 3000);
    }

    // 3. Screen-share toast — fires on the rising edge of ss_blurring.
    //    `override: true` forces replacement of any current toast (e.g. an
    //    idle persistent toast from a prior eval) so screen-share's actionable
    //    UI always wins. Without override the persistent-blocks-replacement
    //    rule in Toast.show would silently drop this call.
    if (ss_blurring && !_last_ss_blurring) {
      const message = _toast_msg('automate_toast_screen_share', 'automate_screen_share', overrides);
      if (typeof _ss_stop_actions === 'function') {
        // ss_stop_actions returns a Promise. Re-check _initialized + look up
        // Toast again inside .then so a destroy() racing with the Promise
        // doesn't fire the toast on a torn-down Manager (or worse, on the next
        // re-initialized session).
        Promise.resolve(_ss_stop_actions()).then(function (actions) {
          if (!_initialized) return;
          const T = _toast();
          if (T) T.show(message, undefined, Array.isArray(actions) ? actions : [], { persistent: true, override: true });
        }).catch(function () {
          if (!_initialized) return;
          const T = _toast();
          if (T) T.show(message, undefined, undefined, { persistent: true, override: true });
        });
      } else {
        Toast.show(message, undefined, undefined, { persistent: true, override: true });
      }
    }

    // 3b. Screen-share falling edge — suspended (share still live) or ended.
    if (!ss_blurring && _last_ss_blurring) {
      const T = _toast();
      if (T && typeof T.dismiss === 'function') T.dismiss();
      var ss_state = r && r.screen_share_state;
      var ss_suspended = !!(r && r.screen_share_suspended);
      if (ss_suspended && ss_state && ss_state.active && typeof _ss_resume_action === 'function') {
        var actions = _ss_resume_action();
        // persistent: true so clearIfTransient (called by Shortcuts.destroy
        // during the _sync → applyState cycle) does not remove this toast.
        // Manual setTimeout provides the 8s auto-dismiss.
        Toast.show(_i18n_msg('notif_suspended'), undefined, Array.isArray(actions) ? actions : [], { persistent: true, override: true });
        setTimeout(function () {
          if (!_initialized) return;
          var Tc = _toast();
          if (Tc && typeof Tc.dismiss === 'function') Tc.dismiss();
        }, 8000);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init(opts) {
    const next_tab_id      = (opts && typeof opts.tab_id === 'number') ? opts.tab_id : null;
    const next_get         = (opts && typeof opts.get_host_url === 'function') ? opts.get_host_url : null;
    const next_ss_actions  = (opts && typeof opts.ss_stop_actions === 'function') ? opts.ss_stop_actions : null;
    const next_ss_resume   = (opts && typeof opts.ss_resume_action === 'function') ? opts.ss_resume_action : null;
    if (next_get === null) return;  // can't operate without a host source

    if (_initialized) destroy();

    _tab_id                  = next_tab_id;
    _get_host_url            = next_get;
    _ss_stop_actions         = next_ss_actions;
    _ss_resume_action        = next_ss_resume;
    _initialized             = true;
    _seeded                  = false;  // first _evaluate seeds tracking without firing toasts.

    // Session state changes (idle / tab_switch / screen_share / suppressed_tabs)
    // — State fires this AFTER all caches are updated, eliminating the race
    // where Manager reads stale data from a separately-ordered onChanged listener.
    var State = (typeof blsi !== 'undefined' && blsi.Automate && blsi.Automate.State) || null;
    if (State && typeof State.on_session_change === 'function') {
      State.on_session_change(_evaluate);
    }

    // Local model changes (automate.*.enabled toggles, site_rules) — these
    // flip automate gates without touching session storage.
    if (blsi.Model && typeof blsi.Model.on_automate_change === 'function') {
      blsi.Model.on_automate_change(_evaluate);
    }

    // Initial evaluation — paints the correct Overlay state on bootstrap.
    _evaluate();
  }

  function destroy() {
    if (!_initialized) return;
    _initialized              = false;
    _tab_id                   = null;
    _get_host_url             = null;
    _ss_stop_actions          = null;
    _ss_resume_action         = null;
    _last_active              = false;
    _seeded           = false;
    _last_idle_phase  = 'active';
    _last_tab_switch_phase = 'off';
    _last_ss_blurring = false;
    const Overlay = (typeof blsi !== 'undefined' && blsi.Automate && blsi.Automate.Overlay) || null;
    if (Overlay) Overlay.hide();
    // Note: we cannot unregister State.on_session_change or
    // Model.on_automate_change (both are single-slot, no unsubscribe).
    // Subsequent _evaluate calls early-return via the _initialized guard.
  }

  function on_url_change(host, url) {
    if (!_initialized) return;
    void host; void url;  // _get_host_url returns the live values
    _evaluate();
  }

  // Test hooks — read-only.
  function _isActive() { return _last_active; }

  const Manager = Object.freeze({
    init,
    destroy,
    on_url_change,
    _evaluate,
    _isActive,
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.Manager = Manager;
  }
})();
