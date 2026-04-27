const BlurrySitePopupState = (() => {
  'use strict';

  // ── Private state ─────────────────────────────────────────────────────────
  let _model             = null;   // full blsi.Model snapshot
  let _blurItems         = [];
  let _hostname          = '';
  let _url               = '';
  let _tabId             = null;   // active tab id — passed to Store.resolve so
                                   // per-tab automate suppression and the
                                   // sharing-tab self-skip are honored.
  let _activeRule        = null;
  let _isPageBlurred     = false;
  let _neutralAfterClear = false;

  // ── Public getters ────────────────────────────────────────────────────────
  function get() {
    const m = _model || blsi.build_default_model();
    // Resolve once per get() so renders can show rule-merged values + know
    // which fields a site rule is overriding for the current tab.
    const resolved = (_hostname || _url)
      ? blsi.Model.resolve(_hostname || '', _url || '', _tabId)
      : null;
    const ruleOverrides = (resolved && resolved._rule_overrides) || {};
    const ruleMatch     = (resolved && resolved._rule_match) || null;
    const triggers = (resolved && resolved.automate_blur_triggers) || { idle: false, tab_switch: false, screen_share: false };
    return {
      settings: Object.assign({}, m, {
        automate_blur_active:   !!(resolved && resolved.automate_blur_active),
        automate_blur_triggers: triggers,
        automate_blur_skipped:  !!(resolved && resolved.automate_blur_skipped),
        automate_blur_skip_reason: resolved ? resolved.automate_blur_skip_reason : null,
        screen_share_state:        resolved ? resolved.screen_share_state : null,
        screen_share_suppressed_for_host: !!(resolved && resolved.screen_share_suppressed_for_host),
        screen_share_suppressed_for_tab:  !!(resolved && resolved.screen_share_suppressed_for_tab),
        // Surface resolve-only rule metadata so render files can call
        // BlurrySitePopupShared.isRuleManaged(settings) without needing ctx.
        _rule_match:     ruleMatch,
        _rule_overrides: ruleOverrides,
      }),
      resolved,
      ruleOverrides,
      ruleMatch,
      blurItems:         _blurItems,
      hostname:          _hostname,
      tabId:             _tabId,
      isPageBlurred:     _isPageBlurred,
      neutralAfterClear: _neutralAfterClear,
      activeRule:        _activeRule,
    };
  }

  // ── Setters ───────────────────────────────────────────────────────────────
  function setNeutralAfterClear(b)   { _neutralAfterClear = !!b; }

  // True when current host is governed by a non-empty site-rule snapshot.
  // Mirrors BlurrySitePopupShared.isRuleManaged but reads internal state
  // so saveSettings() can guard without depending on render-side helpers.
  function _ruleManagedHere() {
    if (!_hostname && !_url) return false;
    var resolved = blsi.Model.resolve(_hostname || '', _url || '', _tabId);
    if (!resolved || !resolved._rule_match) return false;
    var ov = resolved._rule_overrides;
    return !!(ov && Object.keys(ov).length > 0);
  }

  // ── Save settings (model-shaped patch → patch_section per top-level key) ──
  async function saveSettings(patch) {
    if (!patch || typeof patch !== 'object') return;
    var sanitized = patch;
    if (_ruleManagedHere()) {
      // Strip snapshot-managed sections — rule owns them. global_default_settings
      // is never snapshot-captured, so it always passes through.
      sanitized = {};
      for (var key of Object.keys(patch)) {
        if (key === 'blur_all' || key === 'pick_and_blur' ||
            key === 'auto_detect_pii' || key === 'automate') {
          continue;
        }
        sanitized[key] = patch[key];
      }
      if (!Object.keys(sanitized).length) {
        if (blsi.Logger) blsi.Logger.warn('[popup_state] saveSettings: rule-managed host — patch dropped');
        return;
      }
    }
    await Promise.all(Object.keys(sanitized).map(section => blsi.Model.patch_section(section, sanitized[section])));
    refreshFromStorage();
  }

  // ── Compute which site rule (if any) matches the current page ────────────
  // Mirrors resolve() priority: wildcard/regex first, then exact hostname.
  // Only rules with a non-empty snapshot count.
  function _computeActiveRule() {
    if (!_hostname && !_url) return null;
    const rules = blsi.Model.get_rules();
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (!r.snapshot || Object.keys(r.snapshot).length === 0) continue;
      if (r.hostname_type === blsi.pattern_types.exact) {
        if (r.hostname_value === _hostname) return r;
      } else if (_url && blsi.UrlMatcher
                 && blsi.UrlMatcher.matchesPattern(_url, r.hostname_value, r.hostname_type)) {
        return r;
      }
    }
    return null;
  }

  // ── Refresh all hostname-specific state from storage cache ───────────────
  /**
   * Re-reads _model, _blurItems, and _isPageBlurred from the authoritative
   * storage cache. Call after any blsi.Model write so UI derives from storage,
   * not from optimistic local state.
   */
  function refreshFromStorage() {
    _model = blsi.Model.get();
    _activeRule = _computeActiveRule();
    if (_hostname) {
      // Always load items so popup can render the "paused" count when pick-blur is off.
      // Application is gated downstream in storage_model.resolve() / content_script.
      _blurItems = blsi.Model.get_blur_items(_hostname);
      // resolve() owns engage — combines extension on/off, manual blur,
      // snapshot overrides, and automate triggers (per-tab/per-site suppression included).
      const resolved = blsi.Model.resolve(_hostname, _url || '', _tabId);
      _isPageBlurred = !!(resolved && resolved.engage);
    } else {
      _isPageBlurred = _model ? _model.blur_all.status : false;
    }
  }

  // ── Clear automate blur for current hostname ──────────────────────────────
  // Clears idle + tab_switch entries for this hostname AND removes per-tab
  // suppression for the active tab so a "Turn off" click doesn't leave
  // hidden state. Screen-share is global — leave that record alone.
  async function clearAutomateBlur() {
    if (!_hostname) return;
    await blsi.Model.clear_automate_blur(_hostname);
    if (typeof _tabId === 'number') {
      await blsi.Model.remove_suppressed_tab(_tabId);
    }
    refreshFromStorage();
  }

  // ── Suppress/unsuppress screen-share blur ────────────────────────────────
  // scope ∈ 'tab' | 'site_session' | 'feature'
  async function suppressScreenShare(scope) {
    await blsi.Model.suppress_screen_share(scope, { hostname: _hostname, tab_id: _tabId });
    refreshFromStorage();
  }

  async function unsuppressScreenShare(scope) {
    await blsi.Model.unsuppress_screen_share(scope, { hostname: _hostname, tab_id: _tabId });
    refreshFromStorage();
  }

  // ── External change subscription ──────────────────────────────────────────
  /**
   * Subscribe to storage changes from other contexts.
   * cb(newModel, oldModel) — update local state + re-render.
   */
  function onExternalChange(cb) {
    blsi.Model.on_change(cb);
  }

  // ── Storage init ──────────────────────────────────────────────────────────
  async function load(hostname, url, tabId) {
    _hostname = hostname || '';
    _url = url || '';
    _tabId = (typeof tabId === 'number' && Number.isFinite(tabId)) ? tabId : null;
    await blsi.Model.init_cache();
    refreshFromStorage();
  }

  // ── Per-page blur writes ──────────────────────────────────────────────────
  async function saveBlurState(checked) {
    await blsi.Model.save_blur_state(checked);
    refreshFromStorage();
  }

  async function removeBlurItem(itemId) {
    if (!_hostname || !itemId) return;
    await blsi.Model.remove_blur_item(_hostname, itemId);
    refreshFromStorage();
  }

  async function clearHost() {
    if (!_hostname) return;
    await blsi.Model.clear_host(_hostname);
    refreshFromStorage();
  }

  // ── Site rules ────────────────────────────────────────────────────────────
  async function saveRules(newRules) {
    await blsi.Model.save_rules(newRules);
  }

  function captureSnapshot() {
    return blsi.Model.capture_snapshot(_hostname || '');
  }

  async function saveSiteSnapshot(hostname_value, hostname_type, snapshot) {
    return blsi.Model.save_site_snapshot(hostname_value, hostname_type, snapshot);
  }

  async function getRules() {
    return blsi.Model.get_rules();
  }

  // ── Export / Import ───────────────────────────────────────────────────────
  function exportModel() {
    return blsi.Model.get();
  }

  async function importSettings(model) {
    for (const section of Object.keys(model)) {
      await blsi.Model.patch_section(section, model[section]);
    }
    refreshFromStorage();
  }

  return {
    get,
    setNeutralAfterClear,
    load,
    saveSettings, saveBlurState, removeBlurItem, clearHost,
    saveRules, captureSnapshot, saveSiteSnapshot, getRules,
    clearAutomateBlur, suppressScreenShare, unsuppressScreenShare,
    onExternalChange, refreshFromStorage,
    exportModel, importSettings,
  };
})();

window.BlurrySitePopupState = BlurrySitePopupState;
