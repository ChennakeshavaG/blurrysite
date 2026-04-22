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
      { blur_mode: model.blur_all.settings.blur_mode },
      // pick_and_blur section
      {
        pick_blur_enabled: model.pick_and_blur.status,
        picker_mode:       model.pick_and_blur.settings.picker_mode,
        pick_blur_type:    model.pick_and_blur.settings.blur_type,
        pick_blur_color:   model.pick_and_blur.settings.blur_color,
      },
      // auto_detect_pii section
      {
        pii_enabled: model.auto_detect_pii.status,
        pii_email:   model.auto_detect_pii.settings.email,
        pii_numeric: model.auto_detect_pii.settings.numeric,
        pii_mode:    model.auto_detect_pii.settings.pii_mode,
      },
      // automate section
      {
        automate_timer:      model.automate.settings.timer,
        automate_idle:       model.automate.settings.idle,
        automate_tab_switch: model.automate.settings.tab_switch,
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
      'reveal_mode', 'enabled', 'thorough_blur', 'language', 'tab_privacy', 'blur_categories',
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
        blurAllPatch = { settings: { blur_mode: val } };
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
      } else if (key === 'automate_timer') {
        automateSettingsPatch.timer = val;
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

    // Apply all patches — collect promises to run them
    const writes = [];
    if (hasGlobal)          writes.push(blsi.Model.save_settings(globalPatch));
    if (blurAllPatch)       writes.push(blsi.Model.patch_section('blur_all', blurAllPatch));
    if (pickBlurStatusPatch !== null) {
      writes.push(blsi.Model.patch_section('pick_and_blur', { status: pickBlurStatusPatch }));
    }
    if (hasPickBlurSettings) {
      writes.push(blsi.Model.patch_section('pick_and_blur', { settings: pickBlurSettingsPatch }));
    }
    if (piiStatusPatch !== null) {
      writes.push(blsi.Model.patch_section('auto_detect_pii', { status: piiStatusPatch }));
    }
    if (hasPiiSettings) {
      writes.push(blsi.Model.patch_section('auto_detect_pii', { settings: piiSettingsPatch }));
    }
    if (hasAutomateSettings) {
      writes.push(blsi.Model.patch_section('automate', { settings: automateSettingsPatch }));
    }
    if (shortcutsPatch) {
      writes.push(blsi.Model.patch_section('shortcuts', shortcutsPatch));
    }

    await Promise.all(writes);

    // Update local _model from the authoritative cache after all writes
    _model = blsi.Model.get();
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
    saveSettings, onExternalChange,
  };
})();

window.BlurrySitePopupState = BlurrySitePopupState;
