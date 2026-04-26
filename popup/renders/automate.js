const BlurrySitePopupRenderAutomate = (() => {
  'use strict';

  var _t                = BlurrySitePopupShared.t;
  var _makeToggleInput  = BlurrySitePopupShared.makeToggle;
  var _updateSliderFill = BlurrySitePopupShared.updateFill;

  // ── Time conversion helpers ────────────────────────────────────────────────

  function _toSecs(value, unit) {
    if (unit === 'hr')  return value * 3600;
    if (unit === 'min') return value * 60;
    return value;
  }

  function _secsToLabel(secs) {
    secs = Math.round(secs);
    if (secs < 60) return secs + ' ' + _t('automate_unit_sec');
    var m = Math.round(secs / 60);
    if (m < 60) return m + ' ' + _t('automate_unit_min');
    var h = Math.floor(secs / 3600);
    var rem = Math.round((secs % 3600) / 60);
    if (rem === 0) return h + ' ' + _t('automate_unit_hr');
    return h + ' ' + _t('automate_unit_hr') + ' ' + rem + ' ' + _t('automate_unit_min');
  }

  function _secsToValueUnit(secs, hasHr) {
    secs = Math.round(secs);
    if (secs < 60) return { value: Math.max(1, secs), unit: 'sec' };
    var mins = Math.round(secs / 60);
    if (!hasHr || mins <= 99) return { value: Math.min(99, Math.max(1, mins)), unit: 'min' };
    return { value: Math.min(99, Math.max(1, Math.round(secs / 3600))), unit: 'hr' };
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function _svgIcon(elements) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'bl-auto-block__icon');
    elements.forEach(function(el) {
      var elem = document.createElementNS(ns, el.tag);
      Object.keys(el.attrs).forEach(function(k) { elem.setAttribute(k, el.attrs[k]); });
      svg.appendChild(elem);
    });
    return svg;
  }

  function _makeBlockHeader(iconEl, labelText, toggleOrNull) {
    var header = document.createElement('div');
    header.className = 'bl-auto-block__header';
    header.appendChild(iconEl);
    var labelEl = document.createElement('span');
    labelEl.className = 'bl-auto-block__label';
    labelEl.textContent = labelText;
    header.appendChild(labelEl);
    if (toggleOrNull) header.appendChild(toggleOrNull.label);
    return header;
  }

  function _makeDesc(text) {
    var p = document.createElement('p');
    p.className = 'bl-auto-block__desc';
    p.textContent = text;
    return p;
  }

  function _makeSliderSection(idPrefix, valueSecs, minSecs, maxSecs, modifier, minLabel, maxLabel) {
    var section = document.createElement('div');
    section.className = 'bl-auto-slider-section';

    var valEl = document.createElement('span');
    valEl.className = 'bl-auto-slider-val bl-auto-slider-val--' + modifier;
    valEl.textContent = _secsToLabel(valueSecs);
    section.appendChild(valEl);

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'bl-auto-slider bl-auto-slider--' + modifier;
    slider.id = idPrefix + '-slider';
    slider.min = String(minSecs);
    slider.max = String(maxSecs);
    slider.value = String(Math.max(minSecs, Math.min(maxSecs, valueSecs)));
    section.appendChild(slider);

    var rangeLabels = document.createElement('div');
    rangeLabels.className = 'bl-auto-range-labels';
    var minSpan = document.createElement('span');
    minSpan.textContent = minLabel;
    var maxSpan = document.createElement('span');
    maxSpan.textContent = maxLabel;
    rangeLabels.appendChild(minSpan);
    rangeLabels.appendChild(maxSpan);
    section.appendChild(rangeLabels);

    _updateSliderFill(slider, minSecs, maxSecs);

    slider.addEventListener('input', function () {
      valEl.textContent = _secsToLabel(Number(slider.value));
      _updateSliderFill(slider, minSecs, maxSecs);
    });

    return { section: section, slider: slider };
  }

  // ── Block builders ──────────────────────────────────────────────────────────

  function _buildScreenShareBlock(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var ss = (settings.automate && settings.automate.settings && settings.automate.settings.screen_share) || { enabled: false };
    var tog = _makeToggleInput('bl-auto-screen-share-toggle', ss.enabled, _t('automate_screen_share'));

    block.appendChild(_makeBlockHeader(
      _svgIcon([
        { tag: 'rect', attrs: { x: '2', y: '3', width: '20', height: '14', rx: '2' } },
        { tag: 'path', attrs: { d: 'M8 21h8M12 17v4' } },
        { tag: 'path', attrs: { d: 'M10 8l2 2 4-4' } },
      ]),
      _t('automate_screen_share'),
      tog
    ));
    block.appendChild(_makeDesc(_t('automate_screen_share_desc')));

    if (!ss.enabled) {
      block.classList.add('bl-auto-block--inactive');
    }

    tog.input.addEventListener('change', function () {
      block.classList.toggle('bl-auto-block--inactive', !tog.input.checked);
      onSave({ automate: { settings: { screen_share: { enabled: tog.input.checked } } } });
    });

    return block;
  }

  function _buildTabSwitchBlock(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var tabSwitch = (settings.automate && settings.automate.settings && settings.automate.settings.tab_switch) || { enabled: false };
    var tog = _makeToggleInput('bl-auto-tab-switch-toggle', tabSwitch.enabled, _t('setting_auto_blur_tab'));

    block.appendChild(_makeBlockHeader(
      _svgIcon([
        { tag: 'path', attrs: { d: 'M16 3l4 4-4 4M4 7h16' } },
        { tag: 'path', attrs: { d: 'M8 21l-4-4 4-4M20 17H4' } },
      ]),
      _t('setting_auto_blur_tab'),
      tog
    ));
    block.appendChild(_makeDesc(_t('setting_auto_blur_tab_hint')));

    tog.input.addEventListener('change', function () {
      onSave({ automate: { settings: { tab_switch: { enabled: tog.input.checked } } } });
    });

    return block;
  }

  function _buildIdleBlock(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var idle = (settings.automate && settings.automate.settings && settings.automate.settings.idle) || { value: 5, unit: 'min', enabled: false };
    var initialSecs = Math.max(15, Math.min(3600, _toSecs(idle.value, idle.unit)));
    var tog = _makeToggleInput('bl-auto-idle-toggle', idle.enabled, _t('automate_idle'));

    // Hourglass icon
    block.appendChild(_makeBlockHeader(
      _svgIcon([
        { tag: 'path', attrs: { d: 'M5 2h14M5 22h14' } },
        { tag: 'path', attrs: { d: 'M17 2v4.17C17 8.22 15.84 10 14 10l-2 2-2-2C8.16 10 7 8.22 7 6.17V2' } },
        { tag: 'path', attrs: { d: 'M7 22v-4.17C7 15.78 8.16 14 10 14l2 2 2-2c1.84 0 3 1.78 3 3.83V22' } },
      ]),
      _t('automate_idle'),
      tog
    ));
    block.appendChild(_makeDesc(_t('setting_auto_blur_idle_hint')));

    var sliderEl = _makeSliderSection('bl-auto-idle', initialSecs, 15, 3600, 'idle', '15 s', '60 min');
    block.appendChild(sliderEl.section);

    if (!idle.enabled) {
      block.classList.add('bl-auto-block--inactive');
      sliderEl.slider.disabled = true;
    }

    tog.input.addEventListener('change', function () {
      var active = tog.input.checked;
      block.classList.toggle('bl-auto-block--inactive', !active);
      sliderEl.slider.disabled = !active;
      var vu = _secsToValueUnit(Number(sliderEl.slider.value), false);
      onSave({ automate: { settings: { idle: { value: vu.value, unit: vu.unit, enabled: active } } } });
    });

    sliderEl.slider.addEventListener('change', function () {
      var vu = _secsToValueUnit(Number(sliderEl.slider.value), false);
      onSave({ automate: { settings: { idle: { value: vu.value, unit: vu.unit, enabled: tog.input.checked } } } });
    });

    return block;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function renderBody(containerEl, settings, onSave) {
    containerEl.replaceChildren();
    containerEl.appendChild(_buildScreenShareBlock(settings, onSave));
    containerEl.appendChild(_buildTabSwitchBlock(settings, onSave));
    containerEl.appendChild(_buildIdleBlock(settings, onSave));
    var footer = document.createElement('p');
    footer.className = 'bl-section__hint';
    footer.textContent = _t('automate_footer');
    containerEl.appendChild(footer);
  }

  return { renderBody };
})();

window.BlurrySitePopupRenderAutomate = BlurrySitePopupRenderAutomate;
