const BlurrySitePopupState = (() => {
  'use strict';

  // ── Private state ─────────────────────────────────────────────────────────
  let _model             = null;   // full blsi.Model snapshot
  let _blurItems         = [];
  let _hostname          = '';
  let _url               = '';
  let _activeRule        = null;
  let _isPageBlurred     = false;
  let _neutralAfterClear = false;

  // ── Public getters ────────────────────────────────────────────────────────
  function get() {
    const m = _model || blsi.build_default_model();
    const auto_entry = _hostname
      ? blsi.Model.get_automate_blur(_hostname)
      : { idle: false, tab_switch: false, screen_share: false };
    return {
      settings: Object.assign({}, m, {
        automate_blur_active:   !!(auto_entry.idle || auto_entry.tab_switch || auto_entry.screen_share),
        automate_blur_triggers: auto_entry,
      }),
      blurItems:         _blurItems,
      hostname:          _hostname,
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
      const automateEntry = blsi.Model.get_automate_blur(_hostname);
      const automateBlur = !!(automateEntry.idle || automateEntry.tab_switch || automateEntry.screen_share);
      _isPageBlurred = manualBlur || automateBlur;
    } else {
      // No hostname (e.g. chrome://newtab): derive blur state from global default only.
      _isPageBlurred = _model ? _model.blur_all.status : false;
    }
  }

  // ── Clear automate blur for current hostname ──────────────────────────────
  async function clearAutomateBlur() {
    if (!_hostname) return;
    await blsi.Model.clear_automate_blur(_hostname);
    refreshFromStorage();
  }

  // ── Clear screen share blur trigger only for current hostname ─────────────
  async function clearScreenShareBlur() {
    if (!_hostname) return;
    await blsi.Model.save_automate_blur(_hostname, 'screen_share', false);
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
  async function load(hostname, url) {
    _hostname = hostname || '';
    _url = url || '';
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
    clearAutomateBlur, clearScreenShareBlur, onExternalChange, refreshFromStorage,
    exportModel, importSettings,
  };
})();

window.BlurrySitePopupState = BlurrySitePopupState;
