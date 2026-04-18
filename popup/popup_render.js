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
    TEXT:      'cat_text',
    MEDIA:     'cat_media',
    FORM:      'cat_form',
    TABLE:     'cat_table',
    STRUCTURE: 'cat_structure',
  };

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

  function renderHtbSection(settings) {
    const chipsEl   = document.getElementById('bl-htb-chips');
    const summaryEl = document.getElementById('bl-htb-summary');
    if (!chipsEl || !summaryEl) return;

    const isBlurAll  = settings.ACTIVE_MODE === 'blur-all';
    const activeType = isBlurAll ? settings.BLUR_MODE : settings.PICK_BLUR_TYPE;
    const types      = isBlurAll
      ? ['gaussian', 'frosted', 'redacted', 'masked']
      : ['gaussian', 'frosted', 'color'];

    // Chips
    chipsEl.innerHTML = '';
    for (const t of types) {
      const btn = document.createElement('button');
      btn.className = 'bl-chip' + (t === activeType ? ' bl-chip--active' : '');
      btn.dataset.type = t;
      btn.textContent = _t(_TYPE_KEY[t]);
      chipsEl.appendChild(btn);
    }

    // Remove previous note if present
    const prevNote = chipsEl.parentNode.querySelector('.bl-htb-note');
    if (prevNote) prevNote.remove();

    // Pick-blur note
    if (!isBlurAll) {
      const note = document.createElement('p');
      note.className = 'bl-section__hint bl-htb-note';
      note.textContent = _t('htb_pick_blur_note');
      summaryEl.parentNode.insertBefore(note, summaryEl);
    }

    // Summary rows
    summaryEl.innerHTML = '';

    if (isBlurAll) {
      const cats = settings.BLUR_CATEGORIES;
      const catLabels = Object.keys(_CAT_KEY)
        .filter(k => cats[k])
        .map(k => _t(_CAT_KEY[k]));
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_covers'),
        catLabels.length ? catLabels.join(', ') : _t('automate_off'),
      ));
    }

    if (activeType !== 'color' && activeType !== 'redacted' && activeType !== 'masked') {
      const r = settings.BLUR_RADIUS;
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
        _t(revealKeyMap[settings.REVEAL_MODE] || 'reveal_none'),
      ));
    }

    if (activeType === 'color') {
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_color'),
        settings.PICK_BLUR_COLOR.HEX,
      ));
    }
  }

  // ── PII section ────────────────────────────────────────────────────────────

  function renderPiiSection(settings) {
    const toggleEl = document.getElementById('bl-pii-master');
    const chipsEl  = document.getElementById('bl-pii-chips');
    if (!toggleEl || !chipsEl) return;

    toggleEl.checked = settings.AUTO_DETECT.EMAIL || settings.AUTO_DETECT.NUMERIC;

    chipsEl.innerHTML = '';
    for (const t of ['gaussian', 'frosted', 'redacted', 'asterisked']) {
      const btn = document.createElement('button');
      const isActive = t === settings.PII_MODE;
      btn.className = 'bl-chip' + (isActive ? ' bl-chip--sky bl-chip--active' : '');
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

    const a = settings.AUTOMATE;

    const timerVal = (a.TIMER.ENABLED && a.TIMER.VALUE > 0)
      ? a.TIMER.VALUE + ' ' + _t('automate_unit_' + a.TIMER.UNIT)
      : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_timer'), timerVal));

    const idleVal = (a.IDLE.ENABLED && a.IDLE.VALUE > 0)
      ? a.IDLE.VALUE + ' ' + _t('automate_unit_' + a.IDLE.UNIT)
      : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_idle'), idleVal));

    const tabVal = a.TAB_SWITCH.ENABLED ? _t('automate_on') : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_tab_switch'), tabVal));
  }

  // ── Modes section ──────────────────────────────────────────────────────────

  function _renderBlurAllBlock(el, settings, isActive) {
    el.className = 'bl-mode-block bl-mode-block--blur-all' +
      (isActive ? ' bl-mode-block--active' : ' bl-mode-block--waiting');
    el.innerHTML = '';

    if (!isActive) {
      const title = document.createElement('span');
      title.className = 'bl-mode-block__title';
      title.textContent = _t('btn_blur_all');
      el.appendChild(title);
      return;
    }

    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';

    const dot = document.createElement('span');
    dot.className = 'bl-mode-block__dot bl-mode-block__dot--amber ' + (settings.ENABLED ? 'is-on' : 'is-off');
    header.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_blur_all');
    header.appendChild(title);

    const catCount = Object.values(settings.BLUR_CATEGORIES).filter(Boolean).length;
    const subtitle = document.createElement('span');
    subtitle.className = 'bl-mode-block__subtitle';
    subtitle.textContent = _t(_TYPE_KEY[settings.BLUR_MODE] || 'htb_chip_gaussian') +
      ' · ' + catCount + ' ' + _t('mode_blur_all_cats');
    header.appendChild(subtitle);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'bl-toggle bl-mode-block__toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.id = 'bl-blur-all-toggle';
    toggleInput.checked = settings.ENABLED;
    const toggleTrack = document.createElement('span');
    toggleTrack.className = 'bl-toggle__track';
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleTrack);
    header.appendChild(toggleLabel);

    el.appendChild(header);

    const body = document.createElement('p');
    body.className = 'bl-mode-block__body';
    body.textContent = settings.ENABLED
      ? _t('mode_blur_all_active_desc')
      : _t('mode_blur_all_off_hint');
    el.appendChild(body);
  }

  function _renderPickBlurBlock(el, settings, isActive) {
    el.className = 'bl-mode-block bl-mode-block--pick-blur' +
      (isActive ? ' bl-mode-block--active' : ' bl-mode-block--waiting');
    el.innerHTML = '';

    if (!isActive) {
      const title = document.createElement('span');
      title.className = 'bl-mode-block__title';
      title.textContent = _t('btn_picker');
      el.appendChild(title);
      return;
    }

    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';

    const dot = document.createElement('span');
    dot.className = 'bl-mode-block__dot bl-mode-block__dot--sky is-on';
    header.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_picker');
    header.appendChild(title);

    el.appendChild(header);

    const empty = document.createElement('div');
    empty.className = 'bl-mode-block__empty';

    const emptyText = document.createElement('p');
    emptyText.className = 'bl-mode-block__empty-text';
    emptyText.textContent = _t('mode_pick_blur_empty');
    empty.appendChild(emptyText);

    const openBtn = document.createElement('button');
    openBtn.className = 'bl-btn-primary bl-mode-block__open-picker';
    openBtn.id = 'bl-open-picker';
    openBtn.textContent = _t('mode_open_picker');
    empty.appendChild(openBtn);

    el.appendChild(empty);
  }

  function renderModesSection(settings) {
    const activeEl  = document.getElementById('bl-mode-active');
    const waitingEl = document.getElementById('bl-mode-waiting');
    if (!activeEl || !waitingEl) return;

    if (settings.ACTIVE_MODE === 'blur-all') {
      _renderBlurAllBlock(activeEl, settings, true);
      _renderPickBlurBlock(waitingEl, settings, false);
    } else {
      _renderPickBlurBlock(activeEl, settings, true);
      _renderBlurAllBlock(waitingEl, settings, false);
    }
  }

  // ── Render all sections ────────────────────────────────────────────────────

  function renderAll(settings) {
    renderModesSection(settings);
    renderHtbSection(settings);
    renderPiiSection(settings);
    renderAutomateSection(settings);
  }

  return { renderAll, renderHtbSection, renderPiiSection, renderAutomateSection, renderModesSection };
})();

window.BlurrySitePopupRender = BlurrySitePopupRender;
