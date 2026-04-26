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

  // ── Save settings (model-shaped patch → patch_section per top-level key) ──
  async function saveSettings(patch) {
    if (!patch || typeof patch !== 'object') return;
    await Promise.all(Object.keys(patch).map(section => blsi.Model.patch_section(section, patch[section])));
    refreshFromStorage();
  }

  // ── Compute which site rule (if any) matches the current page ────────────
  function _computeActiveRule() {
    if (!_hostname) return null;
    // wildcard/regex rules first — mirrors resolve() priority
    if (_url && blsi.UrlMatcher) {
      const nonExact = blsi.Model.get_rules();
      for (let i = 0; i < nonExact.length; i++) {
        if (blsi.UrlMatcher.matchesPattern(_url, nonExact[i].hostname_value, nonExact[i].hostname_type)) {
          return nonExact[i];
        }
      }
    }
    // exact hostname — only entries with a non-empty snapshot are explicit site rules
    const exact = blsi.Model.get_site_entry(_hostname);
    if (exact && exact.snapshot && Object.keys(exact.snapshot).length > 0) return exact;
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
      const entry = blsi.Model.get_site_entry(_hostname);
      // Always load items so popup can render the "paused" count when pick-blur is off.
      // Application is gated downstream in storage_model.resolve() / content_script.
      _blurItems = blsi.Model.get_blur_items(_hostname);
      const manualBlur = (entry && entry.blur_all !== null)
        ? !!entry.blur_all
        : _model.blur_all.status;
      // Derive automate-blur state via resolve() so per-tab + per-site
      // suppression and the screen-share session record are factored in.
      const resolved = blsi.Model.resolve(_hostname, _url || '', _tabId);
      _isPageBlurred = manualBlur || !!(resolved && resolved.automate_blur_active);
    } else {
      // No hostname (e.g. chrome://newtab): derive blur state from global default only.
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
    if (!_hostname) return;
    await blsi.Model.save_blur_state(_hostname, checked);
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
    return blsi.Model.capture_snapshot();
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
