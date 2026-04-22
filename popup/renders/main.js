const BlurrySitePopupRender = (() => {
  'use strict';

  function _t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  const _TYPE_KEY = {
    gaussian: 'htb_chip_gaussian',
    frosted:  'htb_chip_frosted',
    redacted: 'htb_chip_redacted',
    masked:   'htb_chip_masked',
    color:    'htb_chip_color',
  };

  const _PII_KEY = {
    gaussian:   'pii_chip_gaussian',
    frosted:    'pii_chip_frosted',
    redacted:   'pii_chip_redacted',
    asterisked: 'pii_chip_asterisked',
  };

  const _CAT_KEY = {
    text:      'cat_text',
    media:     'cat_media',
    form:      'cat_form',
    table:     'cat_table',
    structure: 'cat_structure',
  };

  const _REVEAL_SHORT = { click: 'Click', hover: 'Hover', none: 'Off' };

  const _PICKER_MODE_KEY = {
    'dynamic':       'mode_badge_dynamic',
    'sticky-page':   'mode_badge_sticky_page',
    'sticky-screen': 'mode_badge_sticky_screen',
  };

  const _PICKER_MODE_LABEL = {
    'dynamic':       'Dynamic',
    'sticky-page':   'Page',
    'sticky-screen': 'Screen',
  };

  // ── Timer countdown helpers ────────────────────────────────────────────────

  function _toSecsPr(value, unit) {
    if (unit === 'hr')  return value * 3600;
    if (unit === 'min') return value * 60;
    return value;
  }

  function _fmtCountdown(secs) {
    if (secs <= 0) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const ss = s < 10 ? '0' + s : String(s);
    if (h > 0) {
      const mm = m < 10 ? '0' + m : String(m);
      return h + ':' + mm + ':' + ss;
    }
    return m + ':' + ss;
  }

  /**
   * Update the timer summary cell (#bl-automate-timer-val).
   * Returns true if the timer is still counting down.
   */
  function updateTimerCountdown(timer) {
    const el = document.getElementById('bl-automate-timer-val');
    if (!el) return false;

    if (!timer.enabled || !timer.started_at) {
      el.textContent = (timer.enabled && timer.value > 0)
        ? timer.value + ' ' + _t('automate_unit_' + timer.unit)
        : _t('automate_off');
      return false;
    }

    const totalSecs = _toSecsPr(timer.value, timer.unit);
    const remaining = Math.max(0, totalSecs - (Date.now() - timer.started_at) / 1000);

    if (remaining <= 0) {
      el.textContent = _t('automate_timer_triggered');
      return false;
    }

    const timeStr = _fmtCountdown(remaining);
    el.textContent = chrome.i18n.getMessage('automate_timer_remaining', [timeStr]) ||
      '\u23F1 ' + timeStr + ' remaining';
    return true;
  }

  function _summaryRow(label, value) {
    const row = document.createElement('div');
    row.className = 'bl-summary-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'bl-summary-row__label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'bl-summary-row__value';
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  // ── How to Blur section ────────────────────────────────────────────────────

  function renderHtbSection(settings, isBlurAll) {
    const chipsEl   = document.getElementById('bl-htb-chips');
    const summaryEl = document.getElementById('bl-htb-summary');
    if (!chipsEl || !summaryEl) return;

    const activeType = isBlurAll ? settings.blur_mode : settings.pick_blur_type;
    const types      = isBlurAll
      ? ['gaussian', 'frosted', 'redacted', 'masked']
      : ['gaussian', 'frosted', 'color'];

    chipsEl.innerHTML = '';
    for (const t of types) {
      const btn = document.createElement('button');
      btn.className = 'bl-chip' + (t === activeType ? ' bl-chip--active' : '');
      btn.dataset.type = t;
      btn.textContent = _t(_TYPE_KEY[t]);
      chipsEl.appendChild(btn);
    }

    summaryEl.innerHTML = '';

    if (isBlurAll) {
      const cats = settings.blur_categories || {};
      const catLabels = Object.keys(_CAT_KEY)
        .filter(k => cats[k])
        .map(k => _t(_CAT_KEY[k]));
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_covers'),
        catLabels.length ? catLabels.join(', ') : _t('automate_off'),
      ));
    }

    if (activeType !== 'color' && activeType !== 'redacted' && activeType !== 'masked') {
      const r = settings.blur_radius;
      const strengthKey = r <= 4 ? 'htb_strength_subtle' : r <= 9 ? 'htb_strength_moderate' : 'htb_strength_strong';
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_strength'),
        _t(strengthKey) + ' (' + r + 'px)',
      ));
    }

    if (activeType !== 'color') {
      const revealKeyMap = { hover: 'reveal_hover', click: 'reveal_click', none: 'reveal_none' };
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_reveal'),
        _t(revealKeyMap[settings.reveal_mode] || 'reveal_none'),
      ));
    }

    if (activeType === 'color') {
      const colorHex = (settings.pick_blur_color && settings.pick_blur_color.hex) || '#000000';
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_color'),
        colorHex,
      ));
    }
  }

  // ── PII section ────────────────────────────────────────────────────────────

  function renderPiiSection(settings) {
    const toggleEl = document.getElementById('bl-pii-master');
    const chipsEl  = document.getElementById('bl-pii-chips');
    if (!toggleEl || !chipsEl) return;

    toggleEl.checked = !!(settings.pii_email || settings.pii_numeric);

    chipsEl.innerHTML = '';
    for (const t of ['gaussian', 'frosted', 'redacted', 'asterisked']) {
      const btn = document.createElement('button');
      const isActive = t === settings.pii_mode;
      btn.className = 'bl-chip' + (isActive ? ' bl-chip--active bl-glow-active' : '');
      btn.dataset.piiMode = t;
      btn.textContent = _t(_PII_KEY[t]);
      chipsEl.appendChild(btn);
    }
  }

  // ── Automate section ───────────────────────────────────────────────────────

  function renderAutomateSection(settings) {
    const summaryEl = document.getElementById('bl-automate-summary');
    if (!summaryEl) return;
    summaryEl.innerHTML = '';

    const timer      = settings.automate_timer      || { value: 0, unit: 'min', enabled: false, started_at: null };
    const idle       = settings.automate_idle       || { value: 5, unit: 'min', enabled: false };
    const tab_switch = settings.automate_tab_switch || { enabled: false };

    const timerRow = document.createElement('div');
    timerRow.className = 'bl-summary-row';
    const timerLabel = document.createElement('span');
    timerLabel.className = 'bl-summary-row__label';
    timerLabel.textContent = _t('automate_timer');
    const timerValEl = document.createElement('span');
    timerValEl.className = 'bl-summary-row__value';
    timerValEl.id = 'bl-automate-timer-val';
    timerRow.appendChild(timerLabel);
    timerRow.appendChild(timerValEl);
    summaryEl.appendChild(timerRow);
    updateTimerCountdown(timer);

    const idleVal = (idle.enabled && idle.value > 0)
      ? idle.value + ' ' + _t('automate_unit_' + idle.unit)
      : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_idle'), idleVal));

    const tabVal = tab_switch.enabled ? _t('automate_on') : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_tab_switch'), tabVal));
  }

  // ── Shared mode block helpers ──────────────────────────────────────────────

  function _makeDot(isOn) {
    const dot = document.createElement('span');
    dot.className = 'bl-mode-block__dot' + (isOn ? ' is-on' : ' is-off');
    return dot;
  }

  function _makeToggle(id, checked) {
    const label = document.createElement('label');
    label.className = 'bl-toggle bl-mode-block__toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
    const track = document.createElement('span');
    track.className = 'bl-toggle__track';
    label.appendChild(input);
    label.appendChild(track);
    return label;
  }

  function _renderOptRow(label, opts) {
    const row = document.createElement('div');
    row.className = 'bl-opt-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'bl-opt-row__label';
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const optsEl = document.createElement('div');
    optsEl.className = 'bl-opt-row__opts';
    opts.forEach((opt, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'bl-opt-sep';
        optsEl.appendChild(sep);
      }
      const span = document.createElement('span');
      span.className = 'bl-opt' + (opt.active ? ' bl-opt--on' : '');
      span.textContent = opt.text;
      optsEl.appendChild(span);
    });
    row.appendChild(optsEl);
    return row;
  }

  function _renderPickerModeButtons(settings, disabled) {
    const wrap = document.createElement('div');
    wrap.className = 'bl-chips bl-picker-mode-chips';
    for (const [mode, key] of Object.entries(_PICKER_MODE_KEY)) {
      const btn = document.createElement('button');
      btn.className = 'bl-chip';
      btn.dataset.pickerMode = mode;
      btn.textContent = _t(key);
      btn.disabled = !!disabled;
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function _renderModeActions(mode, clearEnabled, actionsDisabled, showClearAll) {
    const row = document.createElement('div');
    row.className = 'bl-mode-actions';

    if (showClearAll) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'bl-btn-ghost';
      clearBtn.dataset.action = 'clear-all';
      clearBtn.dataset.mode = mode;
      clearBtn.disabled = !clearEnabled || !!actionsDisabled;
      clearBtn.textContent = _t('btn_clear_all');
      row.appendChild(clearBtn);
    }

    const modifyBtn = document.createElement('button');
    modifyBtn.className = 'bl-btn-text';
    modifyBtn.style.marginLeft = 'auto';
    modifyBtn.dataset.action = 'htb-modify';
    modifyBtn.dataset.mode = mode;
    modifyBtn.disabled = !!actionsDisabled;
    modifyBtn.textContent = _t('btn_modify');
    row.appendChild(modifyBtn);

    return row;
  }

  // ── Blur All block ─────────────────────────────────────────────────────────

  function _renderBlurAllCollapsedSummary(settings, isOn) {
    const p = document.createElement('p');
    p.className = 'bl-mode-compact';

    const cats = settings.blur_categories || {};
    const catCount = Object.values(cats).filter(Boolean).length;
    const modeLabel = _t(_TYPE_KEY[settings.blur_mode] || 'htb_chip_gaussian');
    const revealLabel = _REVEAL_SHORT[settings.reveal_mode] || 'Off';
    const parts = [modeLabel, catCount + ' cats', revealLabel];

    parts.forEach((text, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'bl-compact-sep';
        p.appendChild(sep);
      }
      const span = document.createElement('span');
      span.textContent = text;
      p.appendChild(span);
    });
    return p;
  }

  function _renderBlurAllExpandedTable(settings) {
    const wrap = document.createElement('div');
    wrap.className = 'bl-mode-table';
    wrap.appendChild(_renderOptRow(
      _t('htb_label_mode'),
      ['gaussian', 'frosted', 'redacted', 'masked'].map(t => ({
        text: _t(_TYPE_KEY[t]), active: t === settings.blur_mode,
      }))
    ));
    wrap.appendChild(_renderOptRow(
      _t('htb_label_covers'),
      Object.keys(_CAT_KEY).map(k => ({
        text: _t(_CAT_KEY[k]), active: !!(settings.blur_categories && settings.blur_categories[k]),
      }))
    ));
    wrap.appendChild(_renderOptRow(
      _t('htb_label_reveal'),
      ['click', 'hover', 'none'].map(r => ({
        text: _REVEAL_SHORT[r], active: settings.reveal_mode === r,
      }))
    ));
    return wrap;
  }

  function _renderBlurAllBlock(el, settings, isExpanded, isPageBlurred) {
    el.innerHTML = '';
    el.className = 'bl-mode-block bl-mode-block--blur-all' +
      (isExpanded ? ' bl-mode-block--expanded' : ' bl-mode-block--collapsed');

    if (!isExpanded) {
      // Collapsed: dot + title + chevron + compact summary
      const header = document.createElement('div');
      header.className = 'bl-mode-block__header';
      header.appendChild(_makeDot(!!isPageBlurred));
      const title = document.createElement('span');
      title.className = 'bl-mode-block__title';
      title.textContent = _t('btn_blur_all');
      header.appendChild(title);
      el.appendChild(header);
      el.appendChild(_renderBlurAllCollapsedSummary(settings, !!isPageBlurred));
      return;
    }

    // Expanded: header (dot + title + toggle) + read-only table + actions
    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';
    header.appendChild(_makeDot(!!isPageBlurred));
    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_blur_all');
    header.appendChild(title);
    header.appendChild(_makeToggle('bl-blur-all-toggle', !!isPageBlurred));
    el.appendChild(header);

    el.appendChild(_renderBlurAllExpandedTable(settings));
    el.appendChild(_renderModeActions('blur-all', false, !isPageBlurred, false));
  }

  // ── Pick & Blur block ──────────────────────────────────────────────────────

  function _renderPickBlurInfo(settings, blurItems) {
    const wrap = document.createElement('div');
    wrap.className = 'bl-mode-table';

    // Item count line
    const countEl = document.createElement('p');
    countEl.className = 'bl-pick-count';
    countEl.textContent = blurItems.length > 0
      ? (chrome.i18n.getMessage('mode_pick_item_count', [String(blurItems.length)]) ||
        blurItems.length + ' items blurred')
      : _t('mode_pick_blur_empty');
    wrap.appendChild(countEl);

    // Settings summary line
    if (blurItems.length > 0) {
      const pickerMode = _PICKER_MODE_LABEL[settings.picker_mode || 'sticky-page'] || 'Page';
      const typeLabel  = _t(_TYPE_KEY[settings.pick_blur_type || 'gaussian']);
      const r = settings.blur_radius;
      const strengthLabel = r <= 4 ? _t('htb_strength_subtle') : r <= 9 ? _t('htb_strength_moderate') : _t('htb_strength_strong');

      const infoEl = document.createElement('p');
      infoEl.className = 'bl-pick-info';
      infoEl.textContent = 'Picker: ' + pickerMode + ' · Type: ' + typeLabel + ' · ' + strengthLabel;
      wrap.appendChild(infoEl);
    }

    return wrap;
  }

  function _renderPickBlurBlock(el, settings, isExpanded, blurItems, pickBlurEnabled) {
    blurItems = blurItems || [];
    el.innerHTML = '';
    el.className = 'bl-mode-block bl-mode-block--pick-blur' +
      (isExpanded ? ' bl-mode-block--expanded' : ' bl-mode-block--collapsed');

    if (!isExpanded) {
      // Collapsed: dot + title + chevron + item count
      const header = document.createElement('div');
      header.className = 'bl-mode-block__header';
      header.appendChild(_makeDot(!!pickBlurEnabled));
      const title = document.createElement('span');
      title.className = 'bl-mode-block__title';
      title.textContent = _t('btn_picker');
      header.appendChild(title);
      el.appendChild(header);

      const countEl = document.createElement('p');
      countEl.className = 'bl-mode-compact';
      countEl.textContent = blurItems.length > 0
        ? (chrome.i18n.getMessage('mode_pick_item_count', [String(blurItems.length)]) ||
          blurItems.length + ' elements')
        : _t('mode_pick_blur_empty');
      el.appendChild(countEl);
      return;
    }

    // Expanded: header (dot + title + toggle) + read-only info + actions
    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';
    header.appendChild(_makeDot(!!pickBlurEnabled));
    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_picker');
    header.appendChild(title);
    header.appendChild(_makeToggle('bl-pick-blur-toggle', !!pickBlurEnabled));
    el.appendChild(header);

    el.appendChild(_renderPickBlurInfo(settings, blurItems));
    el.appendChild(_renderPickerModeButtons(settings, !pickBlurEnabled));
    el.appendChild(_renderModeActions('pick-blur', blurItems.length > 0, !pickBlurEnabled, true));
  }

  // ── Modes section ──────────────────────────────────────────────────────────

  function renderModesSection(settings, blurItems, isPageBlurred, expandedMode) {
    blurItems = blurItems || [];
    const blurAllEl  = document.getElementById('bl-mode-blur-all');
    const pickBlurEl = document.getElementById('bl-mode-pick-blur');
    if (!blurAllEl || !pickBlurEl) return;

    _renderBlurAllBlock(blurAllEl, settings, expandedMode === 'blur-all', isPageBlurred);
    _renderPickBlurBlock(pickBlurEl, settings, expandedMode === 'pick-blur', blurItems, settings.pick_blur_enabled);
  }

  // ── Render all sections ────────────────────────────────────────────────────

  function renderAll(settings, blurItems, isPageBlurred, expandedMode) {
    renderModesSection(settings, blurItems, isPageBlurred, expandedMode);
    renderPiiSection(settings);
    renderAutomateSection(settings);
  }

  return { renderAll, renderHtbSection, renderPiiSection, renderAutomateSection, renderModesSection, updateTimerCountdown };
})();

window.BlurrySitePopupRender = BlurrySitePopupRender;
