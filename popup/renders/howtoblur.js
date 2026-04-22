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

  function _t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _updateFill(input) {
    var pct = ((+input.value - +input.min) / (+input.max - +input.min) * 100).toFixed(1);
    input.style.setProperty('--bl-slider-pct', pct + '%');
  }

  function _makeLabel(text) {
    var el = document.createElement('div');
    el.className = 'bl-htb-group__label';
    el.textContent = text;
    return el;
  }

  function _makeDivider() {
    var hr = document.createElement('hr');
    hr.className = 'bl-divider';
    return hr;
  }

  // ── Section builders ─────────────────────────────────────────────────────────

  /**
   * Type chips — Blur All: Gaussian/Frosted/Redacted/Masked
   *              Pick & Blur: Gaussian/Frosted/Color
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
      ? ['gaussian', 'frosted', 'redacted', 'masked']
      : ['gaussian', 'frosted', 'color'];

    var labelKeys = {
      gaussian: 'htb_chip_gaussian',
      frosted:  'htb_chip_frosted',
      redacted: 'htb_chip_redacted',
      masked:   'htb_chip_masked',
      color:    'htb_chip_color',
    };

    for (var i = 0; i < types.length; i++) {
      (function (type) {
        var btn = document.createElement('button');
        btn.className = 'bl-chip' + (type === activeType ? ' bl-chip--active' : '');
        btn.textContent = _t(labelKeys[type]);
        btn.addEventListener('click', function () {
          // Update active chip visually
          var allChips = chips.querySelectorAll('.bl-chip');
          for (var j = 0; j < allChips.length; j++) {
            allChips[j].classList.toggle('bl-chip--active', allChips[j] === btn);
          }

          // Save setting
          var patch = isBlurAll
            ? { blur_mode: type }
            : { pick_blur_type: type };
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
    var hideStrength = (activeType === 'redacted' || activeType === 'masked' || activeType === 'color');
    var hideReveal   = (activeType === 'color');
    var hideCats     = !isBlurAll;
    var showColor    = (!isBlurAll && activeType === 'color');

    if (refs.catsDivider)  { refs.catsDivider.hidden  = hideCats; }
    if (refs.catsGroup)    { refs.catsGroup.hidden     = hideCats; }
    if (refs.strengthDiv)  { refs.strengthDiv.hidden   = hideStrength; }
    if (refs.revealDiv)    { refs.revealDiv.hidden      = hideReveal; }
    if (refs.colorDiv)     { refs.colorDiv.hidden       = !showColor; }
  }

  /**
   * Categories grid — Blur All mode only.
   */
  function _buildCategories(settings, onSave) {
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

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!(settings.blur_categories && settings.blur_categories[def.key]);
        cb.addEventListener('change', function () {
          var merged = {};
          var cats = settings.blur_categories || {};
          for (var k in cats) {
            if (Object.prototype.hasOwnProperty.call(cats, k)) {
              merged[k] = cats[k];
            }
          }
          merged[def.key] = cb.checked;
          onSave({ blur_categories: merged });
        });

        var span = document.createElement('span');
        span.textContent = _t(def.labelKey);

        label.appendChild(cb);
        label.appendChild(span);
        grid.appendChild(label);
      })(catDefs[i]);
    }

    group.appendChild(grid);
    return group;
  }

  /**
   * Strength slider — range 2–20, hidden for redacted/masked/color.
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
    slider.max   = '20';
    slider.step  = '1';
    slider.value = String(settings.blur_radius || 6);

    var valEl = document.createElement('span');
    valEl.className = 'bl-slider-val';
    valEl.textContent = slider.value + 'px';

    // Set initial fill
    _updateFill(slider);

    slider.addEventListener('input', function () {
      var v = +slider.value;
      valEl.textContent = v + 'px';
      _updateFill(slider);
      onSave({ blur_radius: v });
    });

    wrap.appendChild(slider);
    wrap.appendChild(valEl);
    group.appendChild(wrap);

    // Subtle / Moderate / Strong labels
    var labelsRow = document.createElement('div');
    labelsRow.className = 'bl-slider-labels';
    var lSubtle = document.createElement('span');
    lSubtle.textContent = _t('htb_strength_subtle');
    var lMod = document.createElement('span');
    lMod.textContent = _t('htb_strength_moderate');
    var lStrong = document.createElement('span');
    lStrong.textContent = _t('htb_strength_strong');
    labelsRow.appendChild(lSubtle);
    labelsRow.appendChild(lMod);
    labelsRow.appendChild(lStrong);
    group.appendChild(labelsRow);

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

    var current = settings.reveal_mode || 'hover';

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
          onSave({ reveal_mode: opt.value });
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

    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'bl-toggle';

    var toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = !!settings.thorough_blur;
    toggleInput.addEventListener('change', function () {
      onSave({ thorough_blur: toggleInput.checked });
    });

    var track = document.createElement('span');
    track.className = 'bl-toggle__track';

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(track);

    row.appendChild(labelWrap);
    row.appendChild(toggleLabel);
    group.appendChild(row);

    var hint = document.createElement('p');
    hint.className = 'bl-section__hint';
    hint.textContent = _t('setting_thorough_hint');
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

    var colorCurrent  = (settings.pick_blur_color && settings.pick_blur_color.hex)     || '#000000';
    var opacityCurrent = (settings.pick_blur_color && typeof settings.pick_blur_color.opacity === 'number')
      ? settings.pick_blur_color.opacity
      : 1.0;

    // Color swatch row
    var colorRow = document.createElement('div');
    colorRow.className = 'bl-color-row';

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'bl-color-input';
    colorInput.value = colorCurrent;
    colorInput.addEventListener('input', function () {
      var opVal = (settings.pick_blur_color && typeof settings.pick_blur_color.opacity === 'number')
        ? settings.pick_blur_color.opacity
        : 1.0;
      onSave({ pick_blur_color: { hex: colorInput.value, opacity: opVal } });
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
      onSave({ pick_blur_color: { hex: hexVal, opacity: pct / 100 } });
    });

    opWrap.appendChild(opSlider);
    opWrap.appendChild(opValEl);
    group.appendChild(opWrap);

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
    containerEl.innerHTML = '';

    if (isBlurAll === undefined) isBlurAll = true;
    var activeType = isBlurAll ? (settings.blur_mode || 'gaussian') : (settings.pick_blur_type || 'gaussian');

    var hideCats     = !isBlurAll;
    var hideStrength = (activeType === 'redacted' || activeType === 'masked' || activeType === 'color');
    var hideReveal   = (activeType === 'color');
    var showColor    = (!isBlurAll && activeType === 'color');

    // Collect references for dynamic show/hide after chip clicks
    var sectionRefs = {};

    // ── 1. Reveal mode (first — no leading divider) ────────────────────────────
    var revealDiv = document.createElement('div');
    var revealGroup = _buildReveal(settings, onSave);
    revealDiv.appendChild(revealGroup);
    revealDiv.hidden = hideReveal;
    containerEl.appendChild(revealDiv);
    sectionRefs.revealDiv = revealDiv;

    // ── 2. Thorough blur (always visible) ──────────────────────────────────────
    containerEl.appendChild(_makeDivider());
    containerEl.appendChild(_buildThoroughBlur(settings, onSave));

    // ── 3. Type chips (Blur Look) ──────────────────────────────────────────────
    containerEl.appendChild(_makeDivider());
    var typeGroup = _buildTypeChips(settings, isBlurAll, activeType, onSave, sectionRefs);
    containerEl.appendChild(typeGroup);

    // ── 4. Categories (Blur All only) ──────────────────────────────────────────
    var catsDivider = _makeDivider();
    catsDivider.hidden = hideCats;
    containerEl.appendChild(catsDivider);
    sectionRefs.catsDivider = catsDivider;

    var catsGroup = _buildCategories(settings, onSave);
    catsGroup.hidden = hideCats;
    containerEl.appendChild(catsGroup);
    sectionRefs.catsGroup = catsGroup;

    // ── 5. Strength slider ─────────────────────────────────────────────────────
    var strengthDiv = document.createElement('div');
    var strengthDivider = _makeDivider();
    var strengthGroup = _buildStrength(settings, onSave);
    strengthDiv.appendChild(strengthDivider);
    strengthDiv.appendChild(strengthGroup);
    strengthDiv.hidden = hideStrength;
    containerEl.appendChild(strengthDiv);
    sectionRefs.strengthDiv = strengthDiv;

    // ── 6. Color picker (Pick & Blur + Color type only) ────────────────────────
    var colorDiv = document.createElement('div');
    var colorDivider = _makeDivider();
    var colorGroup = _buildColorPicker(settings, onSave);
    colorDiv.appendChild(colorDivider);
    colorDiv.appendChild(colorGroup);
    colorDiv.hidden = !showColor;
    containerEl.appendChild(colorDiv);
    sectionRefs.colorDiv = colorDiv;
  }

  return { renderBody: renderBody };
})();

window.BlurrySitePopupRenderHtb = BlurrySitePopupRenderHtb;
