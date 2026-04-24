const BlurrySitePopupState = (() => {
  'use strict';

  // ── Private state ─────────────────────────────────────────────────────────
  let _model             = null;   // full blsi.Model snapshot
  let _blurItems         = [];
  let _hostname          = '';
  let _isPageBlurred     = false;
  let _neutralAfterClear = false;

  // ── Flat settings view ────────────────────────────────────────────────────
  /**
   * Build a flat settings object from model sections for render files.
   * Render files expect a single flat object — this is the bridge.
   */
  function _build_flat_settings(model) {
    if (!model) {
      const d = blsi.build_default_model();
      return _build_flat_settings(d);
    }
    return Object.assign(
      {},
      // Global settings (blur_radius, reveal_mode, enabled, thorough_blur, etc.)
      model.settings,
      // blur_all section
      {
        blur_mode:       model.blur_all.settings.blur_mode,
        blur_categories: model.blur_all.settings.blur_categories,
      },
      // pick_and_blur section
      {
        pick_blur_enabled: model.pick_and_blur.status,
        picker_mode:       model.pick_and_blur.settings.picker_mode,
        pick_blur_type:    model.pick_and_blur.settings.blur_type,
        pick_blur_color:   model.pick_and_blur.settings.blur_color,
      },
      // auto_detect_pii section
      {
        pii_enabled:           model.auto_detect_pii.status,
        pii_email:             model.auto_detect_pii.settings.email,
        pii_numeric:           model.auto_detect_pii.settings.numeric,
        pii_mode:              model.auto_detect_pii.settings.pii_mode,
        pii_redaction_color:   model.auto_detect_pii.settings.pii_redaction_color,
      },
      // automate section
      {
        automate_screen_share: model.automate.settings.screen_share,
        automate_idle:         model.automate.settings.idle,
        automate_tab_switch:   model.automate.settings.tab_switch,
        automate_blur_active:  (function() {
          var t = _hostname ? blsi.Model.get_automate_blur(_hostname)
            : { idle: false, tab_switch: false, screen_share: false };
          return !!(t.idle || t.tab_switch || t.screen_share);
        }()),
        automate_blur_triggers: _hostname
          ? blsi.Model.get_automate_blur(_hostname)
          : { idle: false, tab_switch: false, screen_share: false },
      },
      // shortcuts
      { shortcuts: model.shortcuts || {} }
    );
  }

  // ── Public getters ────────────────────────────────────────────────────────
  function get() {
    return {
      settings:          _build_flat_settings(_model),
      blurItems:         _blurItems,
      hostname:          _hostname,
      isPageBlurred:     _isPageBlurred,
      neutralAfterClear: _neutralAfterClear,
    };
  }

  // ── Setters ───────────────────────────────────────────────────────────────
  function setModel(m)               { _model = m; }
  function setHostname(h)            { _hostname = h || ''; }
  function setBlurItems(items)       { _blurItems = items || []; }
  function setPageBlurred(bool)      { _isPageBlurred = !!bool; }
  function setNeutralAfterClear(b)   { _neutralAfterClear = !!b; }

  // ── Save settings (flat patch → model section routing) ───────────────────
  /**
   * Accept a flat settings patch and route each key to the correct model section.
   * Global settings keys → blsi.Model.save_settings()
   * Feature keys → blsi.Model.patch_section(section, {...})
   */
  async function saveSettings(patch) {
    if (!patch || typeof patch !== 'object') return;

    // ── Global settings keys (live directly in model.settings) ───────────
    const globalKeys = [
      'blur_radius', 'transition_duration', 'highlight_color', 'redaction_color',
      'reveal_mode', 'enabled', 'thorough_blur', 'language', 'tab_privacy',
    ];
    const globalPatch = {};
    let hasGlobal = false;

    // ── blur_all section keys ─────────────────────────────────────────────
    let blurAllPatch = null;

    // ── pick_and_blur section keys ────────────────────────────────────────
    let pickBlurStatusPatch = null;
    const pickBlurSettingsPatch = {};
    let hasPickBlurSettings = false;

    // ── auto_detect_pii section keys ──────────────────────────────────────
    let piiStatusPatch = null;
    const piiSettingsPatch = {};
    let hasPiiSettings = false;

    // ── automate section keys ─────────────────────────────────────────────
    const automateSettingsPatch = {};
    let hasAutomateSettings = false;

    // ── shortcuts ─────────────────────────────────────────────────────────
    let shortcutsPatch = null;

    for (const [key, val] of Object.entries(patch)) {
      if (globalKeys.includes(key)) {
        globalPatch[key] = val;
        hasGlobal = true;
      } else if (key === 'blur_mode') {
        if (!blurAllPatch) blurAllPatch = { settings: {} };
        blurAllPatch.settings.blur_mode = val;
      } else if (key === 'blur_categories') {
        if (!blurAllPatch) blurAllPatch = { settings: {} };
        blurAllPatch.settings.blur_categories = val;
      } else if (key === 'pick_blur_enabled') {
        pickBlurStatusPatch = val;
      } else if (key === 'picker_mode') {
        pickBlurSettingsPatch.picker_mode = val;
        hasPickBlurSettings = true;
      } else if (key === 'pick_blur_type') {
        pickBlurSettingsPatch.blur_type = val;
        hasPickBlurSettings = true;
      } else if (key === 'pick_blur_color') {
        pickBlurSettingsPatch.blur_color = val;
        hasPickBlurSettings = true;
      } else if (key === 'pii_enabled') {
        piiStatusPatch = val;
      } else if (key === 'pii_email') {
        piiSettingsPatch.email = val;
        hasPiiSettings = true;
      } else if (key === 'pii_numeric') {
        piiSettingsPatch.numeric = val;
        hasPiiSettings = true;
      } else if (key === 'pii_mode') {
        piiSettingsPatch.pii_mode = val;
        hasPiiSettings = true;
      } else if (key === 'pii_redaction_color') {
        piiSettingsPatch.pii_redaction_color = val;
        hasPiiSettings = true;
      } else if (key === 'automate_screen_share') {
        automateSettingsPatch.screen_share = val;
        hasAutomateSettings = true;
      } else if (key === 'automate_idle') {
        automateSettingsPatch.idle = val;
        hasAutomateSettings = true;
      } else if (key === 'automate_tab_switch') {
        automateSettingsPatch.tab_switch = val;
        hasAutomateSettings = true;
      } else if (key === 'shortcuts') {
        shortcutsPatch = val;
      }
    }

    // Apply all patches — collect promises to run them.
    // Status + settings for the same section are merged into one patch_section call
    // to avoid generating two storage writes → two onChanged events → concurrent
    // handleStorageChange executions in the content script (_activeItems Map race).
    const writes = [];
    if (hasGlobal)    writes.push(blsi.Model.save_settings(globalPatch));
    if (blurAllPatch) writes.push(blsi.Model.patch_section('blur_all', blurAllPatch));

    const pickBlurPatch = {};
    if (pickBlurStatusPatch !== null) pickBlurPatch.status = pickBlurStatusPatch;
    if (hasPickBlurSettings)          pickBlurPatch.settings = pickBlurSettingsPatch;
    if (Object.keys(pickBlurPatch).length) {
      writes.push(blsi.Model.patch_section('pick_and_blur', pickBlurPatch));
    }

    const piiPatch = {};
    if (piiStatusPatch !== null) piiPatch.status = piiStatusPatch;
    if (hasPiiSettings)          piiPatch.settings = piiSettingsPatch;
    if (Object.keys(piiPatch).length) {
      writes.push(blsi.Model.patch_section('auto_detect_pii', piiPatch));
    }

    if (hasAutomateSettings) {
      writes.push(blsi.Model.patch_section('automate', { settings: automateSettingsPatch }));
    }
    if (shortcutsPatch !== null) {
      writes.push(blsi.Model.patch_section('shortcuts', shortcutsPatch));
    }

    await Promise.all(writes);

    // Refresh all state from the authoritative cache after writes
    refreshFromStorage();
  }

  // ── Refresh all hostname-specific state from storage cache ───────────────
  /**
   * Re-reads _model, _blurItems, and _isPageBlurred from the authoritative
   * storage cache. Call after any blsi.Model write so UI derives from storage,
   * not from optimistic local state.
   */
  function refreshFromStorage() {
    _model = blsi.Model.get();
    const pickEnabled = !!(_model && _model.pick_and_blur && _model.pick_and_blur.status);
    if (_hostname) {
      const entry = blsi.Model.get_site_entry(_hostname);
      // Mirror the gate in storage_model.resolve(): items are only active when pick-blur is on.
      _blurItems = (entry && pickEnabled) ? (entry.items || []) : [];
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

  // ── External change subscription ──────────────────────────────────────────
  /**
   * Subscribe to storage changes from other contexts.
   * cb(newModel, oldModel) — update local state + re-render.
   */
  function onExternalChange(cb) {
    blsi.Model.on_change(cb);
  }

  return {
    get,
    setModel, setHostname, setBlurItems, setPageBlurred, setNeutralAfterClear,
    saveSettings, clearAutomateBlur, onExternalChange, refreshFromStorage,
  };
})();

window.BlurrySitePopupState = BlurrySitePopupState;
