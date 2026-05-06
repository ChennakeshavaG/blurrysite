const BlurrySitePopupRenderTriggers = (() => {
  'use strict';

  var _t                = BlurrySitePopupShared.t;
  var _makeToggleInput  = BlurrySitePopupShared.makeToggle;
  var _updateSliderFill = BlurrySitePopupShared.updateFill;
  var _isRuleManaged    = BlurrySitePopupShared.isRuleManaged;

  // ── Time conversion helpers (migrated from automate.js) ───────────────────

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

  // ── DOM helpers ────────────────────────────────────────────────────────────

  function _makeSliderSection(idPrefix, valueSecs, minSecs, maxSecs) {
    var section = document.createElement('div');
    section.className = 'bl-auto-slider-section';

    var valEl = document.createElement('span');
    valEl.className = 'bl-auto-slider-val bl-auto-slider-val--idle';
    valEl.textContent = _secsToLabel(valueSecs);
    section.appendChild(valEl);

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'bl-auto-slider bl-auto-slider--idle';
    slider.id = idPrefix + '-slider';
    slider.min = String(minSecs);
    slider.max = String(maxSecs);
    slider.value = String(Math.max(minSecs, Math.min(maxSecs, valueSecs)));
    section.appendChild(slider);

    var rangeLabels = document.createElement('div');
    rangeLabels.className = 'bl-auto-range-labels';
    var minSpan = document.createElement('span');
    minSpan.textContent = '15 s';
    var maxSpan = document.createElement('span');
    maxSpan.textContent = '60 min';
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

  function _isOverridden(ctx, key) {
    return !!(ctx && ctx.ruleOverrides && ctx.ruleOverrides[key]);
  }

  function _makeManagedBadge(onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bl-managed-badge';
    btn.textContent = _t('popup_badge_managed_by_rule') || 'Managed by site rule';
    btn.title = btn.textContent;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function renderSection(containerEl, settings, onSave, ctx) {
    if (!containerEl) return;
    containerEl.replaceChildren();

    // ── Section header (outside card) ──
    var header = document.createElement('div');
    header.className = 'bl-section__header';
    var title = document.createElement('span');
    title.className = 'bl-section__title bl-triggers-title';
    title.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    var titleText = document.createElement('span');
    titleText.textContent = _t('section_smart_triggers');
    title.appendChild(titleText);
    header.appendChild(title);
    containerEl.appendChild(header);

    var desc = document.createElement('p');
    desc.className = 'bl-section__desc';
    desc.textContent = _t('section_smart_triggers_desc');
    containerEl.appendChild(desc);

    // ── Tab Switch card ──
    var tsCard = document.createElement('div');
    tsCard.className = 'bl-trigger-card bl-trigger-card--tab-switch';

    var modelTs = (settings.automate && settings.automate.settings && settings.automate.settings.tab_switch) || { enabled: false };
    var resolvedTs = ctx && ctx.resolved && ctx.resolved.automate_tab_switch;
    var tsEnabled = resolvedTs && typeof resolvedTs.enabled === 'boolean' ? resolvedTs.enabled : !!modelTs.enabled;
    var tsManaged = _isOverridden(ctx, 'automate_tab_switch');

    var tsTog = _makeToggleInput('bl-trigger-tab-switch', tsEnabled, _t('trigger_tab_switch'));
    if (tsManaged) tsTog.input.disabled = true;

    var tsRow = document.createElement('div');
    tsRow.className = 'bl-feature-row';
    var tsLabel = document.createElement('span');
    tsLabel.className = 'bl-feature-row__label';
    tsLabel.textContent = _t('trigger_tab_switch');
    tsLabel.dataset.tooltipCaption = _t('trigger_tab_switch_desc');
    tsRow.appendChild(tsLabel);
    if (tsManaged) tsRow.appendChild(_makeManagedBadge(ctx && ctx.onOpenManagingRule));
    tsRow.appendChild(tsTog.label);
    tsCard.appendChild(tsRow);

    if (!tsManaged) {
      tsTog.input.addEventListener('change', function () {
        onSave({ automate: { settings: { tab_switch: { enabled: tsTog.input.checked } } } });
      });
    }

    containerEl.appendChild(tsCard);

    // ── Idle Timer card ──
    var idleCard = document.createElement('div');
    idleCard.className = 'bl-trigger-card bl-trigger-card--idle';

    var modelIdle = (settings.automate && settings.automate.settings && settings.automate.settings.idle) || { value: 5, unit: 'min', enabled: false };
    var resolvedIdle = ctx && ctx.resolved && ctx.resolved.automate_idle;
    var idleEnabled = resolvedIdle && typeof resolvedIdle.enabled === 'boolean' ? resolvedIdle.enabled : !!modelIdle.enabled;
    var idleManaged = _isOverridden(ctx, 'automate_idle');
    var initialSecs = Math.max(15, Math.min(3600, _toSecs(modelIdle.value, modelIdle.unit)));

    var idleTog = _makeToggleInput('bl-trigger-idle', idleEnabled, _t('trigger_idle_timer'));
    if (idleManaged) idleTog.input.disabled = true;

    var idleRow = document.createElement('div');
    idleRow.className = 'bl-feature-row';
    var idleLabel = document.createElement('span');
    idleLabel.className = 'bl-feature-row__label';
    idleLabel.textContent = _t('trigger_idle_timer');
    idleLabel.dataset.tooltipCaption = _t('trigger_idle_timer_desc');
    idleRow.appendChild(idleLabel);
    if (idleManaged) idleRow.appendChild(_makeManagedBadge(ctx && ctx.onOpenManagingRule));
    idleRow.appendChild(idleTog.label);
    idleCard.appendChild(idleRow);

    // ── Idle slider (hidden when off) ──
    var sliderEl = _makeSliderSection('bl-trigger-idle', initialSecs, 15, 3600);
    idleCard.appendChild(sliderEl.section);

    if (!idleEnabled) sliderEl.section.hidden = true;
    if (idleManaged) sliderEl.slider.disabled = true;

    if (!idleManaged) {
      idleTog.input.addEventListener('change', function () {
        var active = idleTog.input.checked;
        sliderEl.section.hidden = !active;
        sliderEl.slider.disabled = !active;
        var vu = _secsToValueUnit(Number(sliderEl.slider.value), false);
        onSave({ automate: { settings: { idle: { value: vu.value, unit: vu.unit, enabled: active } } } });
      });

      sliderEl.slider.addEventListener('change', function () {
        var vu = _secsToValueUnit(Number(sliderEl.slider.value), false);
        onSave({ automate: { settings: { idle: { value: vu.value, unit: vu.unit, enabled: idleTog.input.checked } } } });
      });
    }

    containerEl.appendChild(idleCard);
  }

  return { renderSection: renderSection };
})();

window.BlurrySitePopupRenderTriggers = BlurrySitePopupRenderTriggers;
