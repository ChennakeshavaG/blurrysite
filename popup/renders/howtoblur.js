/**
 * howtoblur.js — How to Blur sub-page body renderer
 *
 * Renders the interactive "Modify" sub-page body for the How to Blur section.
 * Controls: type chips, categories grid, strength slider, reveal segmented
 * control, thorough blur toggle, and (Pick & Blur color type only) color picker.
 *
 * Exposed as window.BlurrySitePopupRenderHtb (IIFE — no ES module syntax).
 */

const BlurrySitePopupRenderHtb = (() => {
  'use strict';

  var _t           = BlurrySitePopupShared.t;
  var _makeToggle  = BlurrySitePopupShared.makeToggle;
  var _updateFill  = BlurrySitePopupShared.updateFill;
  var _makeDivider = BlurrySitePopupShared.makeDivider;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _makeLabel(text) {
    var el = document.createElement('div');
    el.className = 'bl-htb-group__label';
    el.textContent = text;
    return el;
  }

  // ── Section builders ─────────────────────────────────────────────────────────

  /**
   * Type chips — Blur All: Blur/Frosted/Redacted/Censored
   *              Pick & Blur: Blur/Frosted/Color
   * Clicking a chip calls onSave with new blur_mode or pick_blur_type
   * and updates sibling section visibility.
   */
  function _buildTypeChips(settings, isBlurAll, activeType, onSave, sectionRefs) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';
    group.appendChild(_makeLabel(_t('setting_blur_mode')));

    var chips = document.createElement('div');
    chips.className = 'bl-chips';

    var types = isBlurAll
      ? ['blur', 'frosted', 'redacted', 'censored']
      : ['blur', 'frosted', 'color'];

    var labelKeys = {
      blur:     'htb_chip_blur',
      frosted:  'htb_chip_frosted',
      redacted: 'htb_chip_redacted',
      censored: 'htb_chip_censored',
      color:    'htb_chip_color',
    };

    var modeAssets = {
      blur:     chrome.runtime.getURL('popup/assets/mode_blur.svg'),
      frosted:  chrome.runtime.getURL('popup/assets/mode_frosted.svg'),
      redacted: chrome.runtime.getURL('popup/assets/mode_redacted.svg'),
      censored: chrome.runtime.getURL('popup/assets/mode_censored.svg'),
      color:    chrome.runtime.getURL('popup/assets/mode_color.svg'),
    };

    for (var i = 0; i < types.length; i++) {
      (function (type) {
        var btn = document.createElement('button');
        btn.className = 'bl-chip' + (type === activeType ? ' bl-chip--active' : '');
        btn.textContent = _t(labelKeys[type]);
        if (modeAssets[type]) btn.dataset.tooltipMedia = modeAssets[type];
        btn.addEventListener('click', function () {
          // Update active chip visually
          var allChips = chips.querySelectorAll('.bl-chip');
          for (var j = 0; j < allChips.length; j++) {
            allChips[j].classList.toggle('bl-chip--active', allChips[j] === btn);
          }

          // Save setting
          var patch = isBlurAll
            ? { blur_all: { settings: { blur_mode: type } } }
            : { pick_and_blur: { settings: { blur_type: type } } };
          onSave(patch);

          // Update sibling visibility based on new type
          _updateVisibility(type, isBlurAll, sectionRefs);
        });
        chips.appendChild(btn);
      })(types[i]);
    }

    group.appendChild(chips);
    return group;
  }

  /**
   * Update visibility of strength, reveal, categories, and color-picker
   * sections when the active type changes (without a full re-render).
   */
  function _updateVisibility(activeType, isBlurAll, refs) {
    var hideStrength       = (activeType === 'redacted' || activeType === 'censored' || activeType === 'color');
    var hideCats           = !isBlurAll;
    var showColor          = (!isBlurAll && activeType === 'color');
    var showRedactionColor = (isBlurAll && activeType === 'redacted');

    if (refs.catsDivider)        { refs.catsDivider.hidden        = hideCats; }
    if (refs.catsGroup)          { refs.catsGroup.hidden           = hideCats; }
    if (refs.strengthDiv)        { refs.strengthDiv.hidden         = hideStrength; }
    if (refs.colorDiv)           { refs.colorDiv.hidden             = !showColor; }
    if (refs.redactionColorDiv)  { refs.redactionColorDiv.hidden    = !showRedactionColor; }

    if (refs.catsGroup) {
      var mediaItem = refs.catsGroup.querySelector('[data-bl-cat-key="media"]');
      if (mediaItem) mediaItem.hidden = (activeType === 'censored');
    }
  }

  /**
   * Categories grid — Blur All mode only.
   * activeType hides the media item when mode is censored (not applicable).
   */
  function _buildCategories(settings, onSave, activeType) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';
    group.appendChild(_makeLabel(_t('group_categories')));

    var grid = document.createElement('div');
    grid.className = 'bl-categories-grid';

    var catDefs = [
      { key: 'text',      labelKey: 'cat_text' },
      { key: 'media',     labelKey: 'cat_media' },
      { key: 'table',     labelKey: 'cat_table' },
      { key: 'structure', labelKey: 'cat_structure' },
      { key: 'form',      labelKey: 'cat_form' },
    ];

    for (var i = 0; i < catDefs.length; i++) {
      (function (def) {
        var label = document.createElement('label');
        label.className = 'bl-cat-item';
        label.dataset.blCatKey = def.key;

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        var _cats = settings.blur_all && settings.blur_all.settings && settings.blur_all.settings.blur_categories;
        cb.checked = !!(_cats && _cats[def.key]);
        cb.addEventListener('change', function () {
          // Read live DOM state from every checkbox in the grid so sequential
          // changes don't overwrite each other via a stale settings closure.
          var merged = {};
          var items = grid.querySelectorAll('input[type="checkbox"]');
          for (var j = 0; j < catDefs.length; j++) {
            merged[catDefs[j].key] = items[j] ? items[j].checked : false;
          }
          // At least one category must remain selected.
          var anyOn = Object.keys(merged).some(function (k) { return merged[k]; });
          if (!anyOn) { cb.checked = true; return; }
          onSave({ blur_all: { settings: { blur_categories: merged } } });
        });

        var span = document.createElement('span');
        span.textContent = _t(def.labelKey);

        label.appendChild(cb);
        label.appendChild(span);

        if (def.key === 'media') label.hidden = (activeType === 'censored');

        grid.appendChild(label);
      })(catDefs[i]);
    }

    group.appendChild(grid);
    return group;
  }

  /**
   * Strength slider — range 2–20, hidden for redacted/censored/color.
   */
  function _buildStrength(settings, onSave) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';
    group.appendChild(_makeLabel(_t('setting_blur_radius')));

    var wrap = document.createElement('div');
    wrap.className = 'bl-slider-wrap';

    var slider = document.createElement('input');
    slider.type  = 'range';
    slider.className = 'bl-slider';
    slider.min   = '2';
    slider.max   = '32';
    slider.step  = '1';
    slider.value = String((settings.global_default_settings && settings.global_default_settings.blur_radius) || 6);

    var valEl = document.createElement('span');
    valEl.className = 'bl-slider-val';
    valEl.textContent = slider.value + 'px';

    // Set initial fill
    _updateFill(slider);

    slider.addEventListener('input', function () {
      var v = +slider.value;
      valEl.textContent = v + 'px';
      _updateFill(slider);
      onSave({ global_default_settings: { blur_radius: v } });
    });

    wrap.appendChild(slider);
    wrap.appendChild(valEl);
    group.appendChild(wrap);

    var ticksRow = document.createElement('div');
    ticksRow.className = 'bl-slider-ticks';
    for (var j = 0; j < 3; j++) {
      var tick = document.createElement('span');
      tick.className = 'bl-slider-tick';
      ticksRow.appendChild(tick);
    }
    group.appendChild(ticksRow);

    return group;
  }

  /**
   * Reveal mode — segmented control: Hover / Click / None.
   * Hidden when activeType === 'color'.
   */
  function _buildReveal(settings, onSave) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';
    group.appendChild(_makeLabel(_t('setting_reveal_mode')));

    var seg = document.createElement('div');
    seg.className = 'bl-segmented';

    var opts = [
      { value: 'hover', labelKey: 'reveal_hover' },
      { value: 'click', labelKey: 'reveal_click' },
      { value: 'none',  labelKey: 'reveal_none'  },
    ];

    var current = (settings.global_default_settings && settings.global_default_settings.reveal_mode) || 'hover';

    for (var i = 0; i < opts.length; i++) {
      (function (opt) {
        var btn = document.createElement('button');
        btn.className = 'bl-segmented__opt' + (opt.value === current ? ' is-active' : '');
        // Use first word only (e.g. "Hover to peek" → "Hover")
        var fullLabel = _t(opt.labelKey);
        btn.textContent = fullLabel.split(' ')[0];
        btn.title = fullLabel;

        btn.addEventListener('click', function () {
          var allOpts = seg.querySelectorAll('.bl-segmented__opt');
          for (var j = 0; j < allOpts.length; j++) {
            allOpts[j].classList.toggle('is-active', allOpts[j] === btn);
          }
          onSave({ global_default_settings: { reveal_mode: opt.value } });
        });

        seg.appendChild(btn);
      })(opts[i]);
    }

    group.appendChild(seg);
    return group;
  }

  /**
   * Thorough blur toggle — always visible.
   */
  function _buildThoroughBlur(settings, onSave) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';

    var row = document.createElement('div');
    row.className = 'bl-form-row';

    var labelWrap = document.createElement('div');
    var labelText = document.createElement('span');
    labelText.className = 'bl-form-row__label';
    labelText.textContent = _t('setting_thorough_blur');
    labelWrap.appendChild(labelText);

    var tog = _makeToggle('bl-htb-thorough-toggle', !!(settings.global_default_settings && settings.global_default_settings.thorough_blur), _t('setting_thorough_blur'));
    tog.input.addEventListener('change', function () {
      onSave({ global_default_settings: { thorough_blur: tog.input.checked } });
    });

    row.appendChild(labelWrap);
    row.appendChild(tog.label);
    group.appendChild(row);

    var hint = document.createElement('p');
    hint.className = 'bl-section__hint';
    hint.textContent = _t('setting_thorough_hint');
    group.appendChild(hint);

    return group;
  }

  /**
   * Transition toggle — always visible; instant (0ms) vs smooth (150ms).
   */
  function _buildTransition(settings, onSave) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';

    var row = document.createElement('div');
    row.className = 'bl-form-row';

    var labelWrap = document.createElement('div');
    var labelText = document.createElement('span');
    labelText.className = 'bl-form-row__label';
    labelText.textContent = _t('setting_transition');
    labelWrap.appendChild(labelText);

    var _td = settings.global_default_settings && settings.global_default_settings.transition_duration;
    var isSmooth = (typeof _td === 'number') ? _td > 0 : true;

    var tog = _makeToggle('bl-htb-transition-toggle', isSmooth, _t('setting_transition'));
    tog.input.addEventListener('change', function () {
      onSave({ global_default_settings: { transition_duration: tog.input.checked ? 150 : 0 } });
    });

    row.appendChild(labelWrap);
    row.appendChild(tog.label);
    group.appendChild(row);

    var hint = document.createElement('p');
    hint.className = 'bl-section__hint';
    hint.textContent = _t('setting_transition_hint');
    group.appendChild(hint);

    return group;
  }

  /**
   * Color picker — shown only in Pick & Blur + Color type.
   */
  function _buildColorPicker(settings, onSave) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';
    group.appendChild(_makeLabel(_t('htb_label_color')));

    var _bc = settings.pick_and_blur && settings.pick_and_blur.settings && settings.pick_and_blur.settings.blur_color;
    var colorCurrent   = (_bc && _bc.hex) || '#000000';
    var opacityCurrent = (_bc && typeof _bc.opacity === 'number') ? _bc.opacity : 1.0;

    // Color swatch row
    var colorRow = document.createElement('div');
    colorRow.className = 'bl-color-row';

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'bl-color-input';
    colorInput.value = colorCurrent;
    colorInput.addEventListener('input', function () {
      // Read opacity from the live slider to avoid stale closure overwriting user's change.
      onSave({ pick_and_blur: { settings: { blur_color: { hex: colorInput.value, opacity: +opSlider.value / 100 } } } });
    });

    var colorLabel = document.createElement('span');
    colorLabel.className = 'bl-form-row__label';
    colorLabel.textContent = _t('setting_redaction_color');

    colorRow.appendChild(colorInput);
    colorRow.appendChild(colorLabel);
    group.appendChild(colorRow);

    // Opacity slider
    var opacityLabel = document.createElement('div');
    opacityLabel.className = 'bl-htb-group__label';
    opacityLabel.style.marginTop = '10px';
    opacityLabel.textContent = _t('htb_opacity');
    group.appendChild(opacityLabel);

    var opWrap = document.createElement('div');
    opWrap.className = 'bl-slider-wrap';

    var opSlider = document.createElement('input');
    opSlider.type  = 'range';
    opSlider.className = 'bl-slider';
    opSlider.min   = '0';
    opSlider.max   = '100';
    opSlider.step  = '1';
    opSlider.value = String(Math.round(opacityCurrent * 100));

    var opValEl = document.createElement('span');
    opValEl.className = 'bl-slider-val';
    opValEl.textContent = opSlider.value + '%';

    _updateFill(opSlider);

    opSlider.addEventListener('input', function () {
      var pct = +opSlider.value;
      opValEl.textContent = pct + '%';
      _updateFill(opSlider);
      var hexVal = colorInput.value;
      onSave({ pick_and_blur: { settings: { blur_color: { hex: hexVal, opacity: pct / 100 } } } });
    });

    opWrap.appendChild(opSlider);
    opWrap.appendChild(opValEl);
    group.appendChild(opWrap);

    return group;
  }

  /**
   * Redaction color picker — Blur All + Redacted mode only.
   * No opacity slider: redaction is always opaque.
   */
  function _buildRedactionColorPicker(settings, onSave) {
    var group = document.createElement('div');
    group.className = 'bl-htb-group';
    group.appendChild(_makeLabel(_t('htb_label_color')));

    var colorRow = document.createElement('div');
    colorRow.className = 'bl-color-row';

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'bl-color-input';
    colorInput.value = (settings.global_default_settings && settings.global_default_settings.redaction_color) || '#000000';
    colorInput.addEventListener('input', function () {
      onSave({ global_default_settings: { redaction_color: colorInput.value } });
    });

    var colorLabel = document.createElement('span');
    colorLabel.className = 'bl-form-row__label';
    colorLabel.textContent = _t('setting_redaction_color');

    colorRow.appendChild(colorInput);
    colorRow.appendChild(colorLabel);
    group.appendChild(colorRow);
    return group;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * renderBody(containerEl, settings, onSave)
   *
   * Populates `containerEl` (the .bl-subpage__body div) with all How-to-Blur
   * controls. Clears and rebuilds on every call. Safe to call multiple times.
   *
   * @param {Element} containerEl  - Container to populate
   * @param {object}  settings     - Full current settings object (read-only)
   * @param {function} onSave      - Called with a partial settings patch
   */
  function renderBody(containerEl, settings, onSave, isBlurAll) {
    containerEl.replaceChildren();

    if (isBlurAll === undefined) isBlurAll = true;
    var activeType = isBlurAll
      ? ((settings.blur_all && settings.blur_all.settings && settings.blur_all.settings.blur_mode) || 'blur')
      : ((settings.pick_and_blur && settings.pick_and_blur.settings && settings.pick_and_blur.settings.blur_type) || 'blur');

    var hideCats           = !isBlurAll;
    var hideStrength       = (activeType === 'redacted' || activeType === 'censored' || activeType === 'color');
    var showColor          = (!isBlurAll && activeType === 'color');
    var showRedactionColor = (isBlurAll && activeType === 'redacted');

    // Collect references for dynamic show/hide after chip clicks
    var sectionRefs = {};

    // ── 1. Reveal mode (first — no leading divider) ────────────────────────────
    var revealDiv = document.createElement('div');
    var revealGroup = _buildReveal(settings, onSave);
    revealDiv.appendChild(revealGroup);
    containerEl.appendChild(revealDiv);
    sectionRefs.revealDiv = revealDiv;

    // ── 1.5. Transition (instant vs smooth) ───────────────────────────────────
    containerEl.appendChild(_makeDivider());
    containerEl.appendChild(_buildTransition(settings, onSave));

    // ── 2. Type chips (Blur Look) ──────────────────────────────────────────────
    containerEl.appendChild(_makeDivider());
    var typeGroup = _buildTypeChips(settings, isBlurAll, activeType, onSave, sectionRefs);
    containerEl.appendChild(typeGroup);

    // ── 3. Strength / Redaction color (mutually exclusive, same slot) ──────────
    var strengthDiv = document.createElement('div');
    strengthDiv.appendChild(_makeDivider());
    strengthDiv.appendChild(_buildStrength(settings, onSave));
    strengthDiv.hidden = hideStrength;
    containerEl.appendChild(strengthDiv);
    sectionRefs.strengthDiv = strengthDiv;

    var redactionColorDiv = document.createElement('div');
    redactionColorDiv.appendChild(_makeDivider());
    redactionColorDiv.appendChild(_buildRedactionColorPicker(settings, onSave));
    redactionColorDiv.hidden = !showRedactionColor;
    containerEl.appendChild(redactionColorDiv);
    sectionRefs.redactionColorDiv = redactionColorDiv;

    // ── 4. Categories (Blur All only) ──────────────────────────────────────────
    var catsDivider = _makeDivider();
    catsDivider.hidden = hideCats;
    containerEl.appendChild(catsDivider);
    sectionRefs.catsDivider = catsDivider;

    var catsGroup = _buildCategories(settings, onSave, activeType);
    catsGroup.hidden = hideCats;
    containerEl.appendChild(catsGroup);
    sectionRefs.catsGroup = catsGroup;

    // ── 5. Thorough blur (Blur All only) ──────────────────────────────────────
    if (isBlurAll) {
      containerEl.appendChild(_makeDivider());
      containerEl.appendChild(_buildThoroughBlur(settings, onSave));
    }

    // ── 6. Color picker (Pick & Blur + Color type only) ────────────────────────
    var colorDiv = document.createElement('div');
    colorDiv.appendChild(_makeDivider());
    colorDiv.appendChild(_buildColorPicker(settings, onSave));
    colorDiv.hidden = !showColor;
    containerEl.appendChild(colorDiv);
    sectionRefs.colorDiv = colorDiv;
  }

  return { renderBody: renderBody };
})();

window.BlurrySitePopupRenderHtb = BlurrySitePopupRenderHtb;
