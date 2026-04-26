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

  // ── Managed-by-site-rule badge ─────────────────────────────────────────────

  function _makeManagedBadge(onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bl-managed-badge';
    btn.textContent = _t('popup_badge_managed_by_rule') || 'Managed by site rule';
    btn.title = btn.textContent;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function _isOverridden(ctx, key) {
    return !!(ctx && ctx.ruleOverrides && ctx.ruleOverrides[key]);
  }

  // ── Block builders ──────────────────────────────────────────────────────────

  function _buildScreenShareBlock(settings, onSave, ctx) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    // Read enabled value: prefer resolved (rule-merged) when available.
    var modelSs = (settings.automate && settings.automate.settings && settings.automate.settings.screen_share) || { enabled: false };
    var resolvedSs = ctx && ctx.resolved && ctx.resolved.automate_screen_share;
    var enabledVal = resolvedSs && typeof resolvedSs.enabled === 'boolean' ? resolvedSs.enabled : !!modelSs.enabled;
    var managed = _isOverridden(ctx, 'automate_screen_share');

    var tog = _makeToggleInput('bl-auto-screen-share-toggle', enabledVal, _t('automate_screen_share'));
    if (managed) tog.input.disabled = true;

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
    if (managed) block.appendChild(_makeManagedBadge(ctx && ctx.onOpenManagingRule));

    if (!enabledVal) block.classList.add('bl-auto-block--inactive');
    if (managed)    block.classList.add('bl-auto-block--managed');

    if (!managed) {
      tog.input.addEventListener('change', function () {
        block.classList.toggle('bl-auto-block--inactive', !tog.input.checked);
        onSave({ automate: { settings: { screen_share: { enabled: tog.input.checked } } } });
      });
    }

    return block;
  }

  function _buildTabSwitchBlock(settings, onSave, ctx) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var modelTs = (settings.automate && settings.automate.settings && settings.automate.settings.tab_switch) || { enabled: false };
    var resolvedTs = ctx && ctx.resolved && ctx.resolved.automate_tab_switch;
    var enabledVal = resolvedTs && typeof resolvedTs.enabled === 'boolean' ? resolvedTs.enabled : !!modelTs.enabled;
    var managed = _isOverridden(ctx, 'automate_tab_switch');

    var tog = _makeToggleInput('bl-auto-tab-switch-toggle', enabledVal, _t('setting_auto_blur_tab'));
    if (managed) tog.input.disabled = true;

    block.appendChild(_makeBlockHeader(
      _svgIcon([
        { tag: 'path', attrs: { d: 'M16 3l4 4-4 4M4 7h16' } },
        { tag: 'path', attrs: { d: 'M8 21l-4-4 4-4M20 17H4' } },
      ]),
      _t('setting_auto_blur_tab'),
      tog
    ));
    block.appendChild(_makeDesc(_t('setting_auto_blur_tab_hint')));
    if (managed) block.appendChild(_makeManagedBadge(ctx && ctx.onOpenManagingRule));
    if (managed) block.classList.add('bl-auto-block--managed');

    if (!managed) {
      tog.input.addEventListener('change', function () {
        onSave({ automate: { settings: { tab_switch: { enabled: tog.input.checked } } } });
      });
    }

    return block;
  }

  function _buildIdleBlock(settings, onSave, ctx) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var modelIdle = (settings.automate && settings.automate.settings && settings.automate.settings.idle) || { value: 5, unit: 'min', enabled: false };
    // Idle .value/.unit always come from globals (snapshot only carries .enabled).
    var resolvedIdle = ctx && ctx.resolved && ctx.resolved.automate_idle;
    var enabledVal = resolvedIdle && typeof resolvedIdle.enabled === 'boolean' ? resolvedIdle.enabled : !!modelIdle.enabled;
    var managed = _isOverridden(ctx, 'automate_idle');
    var idle = { value: modelIdle.value, unit: modelIdle.unit, enabled: enabledVal };
    var initialSecs = Math.max(15, Math.min(3600, _toSecs(idle.value, idle.unit)));
    var tog = _makeToggleInput('bl-auto-idle-toggle', idle.enabled, _t('automate_idle'));
    if (managed) tog.input.disabled = true;

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
    if (managed) block.appendChild(_makeManagedBadge(ctx && ctx.onOpenManagingRule));
    if (managed) block.classList.add('bl-auto-block--managed');

    var sliderEl = _makeSliderSection('bl-auto-idle', initialSecs, 15, 3600, 'idle', '15 s', '60 min');
    block.appendChild(sliderEl.section);

    if (!idle.enabled) block.classList.add('bl-auto-block--inactive');
    if (!idle.enabled || managed) sliderEl.slider.disabled = true;

    if (!managed) {
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
    }

    return block;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function renderBody(containerEl, settings, onSave, ctx) {
    containerEl.replaceChildren();
    containerEl.appendChild(_buildScreenShareBlock(settings, onSave, ctx));
    containerEl.appendChild(_buildTabSwitchBlock(settings, onSave, ctx));
    containerEl.appendChild(_buildIdleBlock(settings, onSave, ctx));
    var footer = document.createElement('p');
    footer.className = 'bl-section__hint';
    footer.textContent = _t('automate_footer');
    containerEl.appendChild(footer);
  }

  return { renderBody };
})();

window.BlurrySitePopupRenderAutomate = BlurrySitePopupRenderAutomate;
