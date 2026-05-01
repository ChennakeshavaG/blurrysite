const BlurrySitePopupRender = (() => {
  'use strict';

  var _t = BlurrySitePopupShared.t;

  const _TYPE_KEY = {
    blur:     'htb_chip_blur',
    frosted:  'htb_chip_frosted',
    redacted: 'htb_chip_redacted',
    censored: 'htb_chip_censored',
    color:    'htb_chip_color',
  };

  const _PII_KEY = {
    blur:     'pii_chip_blur',
    frosted:  'pii_chip_frosted',
    redacted: 'pii_chip_redacted',
    starred:  'pii_chip_starred',
  };

  const _CAT_KEY = {
    text:      'cat_text',
    media:     'cat_media',
    form:      'cat_form',
    table:     'cat_table',
    structure: 'cat_structure',
  };

  const _PICKER_MODE_KEY = {
    'dynamic':       'mode_badge_dynamic',
    'sticky-page':   'mode_badge_sticky_page',
    'sticky-screen': 'mode_badge_sticky_screen',
  };

  const _PICKER_MODE_ASSET = {
    'dynamic':       chrome.runtime.getURL('popup/assets/tooltip_dynamic.svg'),
    'sticky-page':   chrome.runtime.getURL('popup/assets/tooltip_sticky_page.svg'),
    'sticky-screen': chrome.runtime.getURL('popup/assets/tooltip_sticky_screen.svg'),
  };

  const _MODE_ASSET = {
    blur:     chrome.runtime.getURL('popup/assets/mode_blur.svg'),
    frosted:  chrome.runtime.getURL('popup/assets/mode_frosted.svg'),
    redacted: chrome.runtime.getURL('popup/assets/mode_redacted.svg'),
    censored: chrome.runtime.getURL('popup/assets/mode_censored.svg'),
    starred:  chrome.runtime.getURL('popup/assets/mode_starred.svg'),
    color:    chrome.runtime.getURL('popup/assets/mode_color.svg'),
  };

  const _PICKER_MODE_DESC = {
    'dynamic':       'tooltip_mode_dynamic',
    'sticky-page':   'tooltip_mode_sticky_page',
    'sticky-screen': 'tooltip_mode_sticky_screen',
  };

  function _summaryRow(label, value) {
    const row = document.createElement('div');
    row.className = 'bl-summary-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'bl-summary-row__label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'bl-summary-row__value';
    if (value instanceof Node) {
      valueEl.appendChild(value);
    } else {
      valueEl.textContent = value;
    }
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  // ── How to Blur section ────────────────────────────────────────────────────

  function renderHtbSection(settings, isBlurAll) {
    const chipsEl   = document.getElementById('bl-htb-chips');
    const summaryEl = document.getElementById('bl-htb-summary');
    if (!chipsEl || !summaryEl) return;

    const activeType = isBlurAll ? settings.blur_all.settings.blur_mode : settings.pick_and_blur.settings.blur_type;
    const types      = isBlurAll
      ? ['blur', 'frosted', 'redacted', 'censored']
      : ['blur', 'frosted', 'color'];

    chipsEl.replaceChildren();
    for (const t of types) {
      const btn = document.createElement('button');
      btn.className = 'bl-chip' + (t === activeType ? ' bl-chip--active' : '');
      btn.dataset.type = t;
      btn.textContent = _t(_TYPE_KEY[t]);
      if (_MODE_ASSET[t]) btn.dataset.tooltipMedia = _MODE_ASSET[t];
      chipsEl.appendChild(btn);
    }

    summaryEl.replaceChildren();

    if (isBlurAll) {
      const cats = settings.blur_all.settings.blur_categories || {};
      const catLabels = Object.keys(_CAT_KEY)
        .filter(k => cats[k])
        .map(k => _t(_CAT_KEY[k]));
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_covers'),
        catLabels.length ? catLabels.join(', ') : _t('automate_off'),
      ));
    }

    if (activeType !== 'color' && activeType !== 'redacted' && activeType !== 'censored') {
      const r = settings.global_default_settings.blur_radius;
      const strengthKey = r <= 4 ? 'htb_strength_subtle' : r <= 9 ? 'htb_strength_moderate' : 'htb_strength_strong';
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_strength'),
        _t(strengthKey),
      ));
    }

    if (activeType !== 'color') {
      const revealKeyMap = { hover: 'reveal_hover', click: 'reveal_click', none: 'reveal_none' };
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_reveal'),
        _t(revealKeyMap[settings.global_default_settings.reveal_mode] || 'reveal_none'),
      ));
    }

    if (activeType === 'color') {
      const colorHex = (settings.pick_and_blur.settings.blur_color && settings.pick_and_blur.settings.blur_color.hex) || '#000000';
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_color'),
        colorHex,
      ));
    }
  }

  // ── PII section ────────────────────────────────────────────────────────────

  function renderPiiSection(settings, onSave, ctx) {
    const toggleEl   = document.getElementById('bl-pii-master');
    const chipsEl    = document.getElementById('bl-pii-chips');
    const colorRowEl = document.getElementById('bl-pii-color-row');
    if (!toggleEl || !chipsEl) return;

    const ov = (ctx && ctx.ruleOverrides) || {};
    const resolved = ctx && ctx.resolved;
    // For the master toggle, if any of the four PII fields is rule-overridden,
    // gate the whole section to read-only. Display value uses resolved when available.
    const piiManaged = !!(ov.pii_email || ov.pii_numeric || ov.pii_mode || ov.pii_redaction_color);
    const emailVal   = resolved && typeof resolved.pii_email === 'boolean' ? resolved.pii_email : settings.auto_detect_pii.settings.email;
    const numericVal = resolved && typeof resolved.pii_numeric === 'boolean' ? resolved.pii_numeric : settings.auto_detect_pii.settings.numeric;
    const modeVal    = (resolved && resolved.pii_mode) || settings.auto_detect_pii.settings.pii_mode;
    const colorVal   = (resolved && resolved.pii_redaction_color) || settings.auto_detect_pii.settings.pii_redaction_color || '#000000';

    const masterOn = !!(emailVal || numericVal);
    toggleEl.checked = masterOn;
    toggleEl.disabled = piiManaged;

    chipsEl.replaceChildren();
    for (const t of ['blur', 'frosted', 'redacted', 'starred']) {
      const btn = document.createElement('button');
      const isActive = t === modeVal;
      btn.className = 'bl-chip' + (isActive ? ' bl-chip--active' + (masterOn ? ' bl-glow-active' : '') : '');
      btn.dataset.piiMode = t;
      btn.textContent = _t(_PII_KEY[t]);
      if (_MODE_ASSET[t]) btn.dataset.tooltipMedia = _MODE_ASSET[t];
      if (ov.pii_mode) btn.disabled = true;
      chipsEl.appendChild(btn);
    }

    // Render / clear the "Managed by site rule" badge on the PII section.
    let pii = document.getElementById('bl-pii');
    if (pii) {
      let badge = pii.querySelector('.bl-managed-badge');
      if (piiManaged) {
        if (!badge) {
          badge = document.createElement('button');
          badge.type = 'button';
          badge.className = 'bl-managed-badge';
          badge.textContent = _t('popup_badge_managed_by_rule') || 'Managed by site rule';
          badge.title = badge.textContent;
          if (ctx && ctx.onOpenManagingRule) badge.addEventListener('click', ctx.onOpenManagingRule);
          pii.appendChild(badge);
        }
      } else if (badge) {
        badge.remove();
      }
    }

    if (colorRowEl) {
      const isRedacted = modeVal === 'redacted';
      colorRowEl.hidden = !isRedacted;
      if (isRedacted && onSave) {
        let colorInput = colorRowEl.querySelector('input[type="color"]');
        if (!colorInput) {
          colorInput = document.createElement('input');
          colorInput.type = 'color';
          colorInput.className = 'bl-color-input';
          colorInput.addEventListener('input', function () {
            if (!colorInput.disabled) {
              onSave({ auto_detect_pii: { settings: { pii_redaction_color: colorInput.value } } });
            }
          });
          const colorLabel = document.createElement('span');
          colorLabel.className = 'bl-form-row__label';
          colorLabel.textContent = _t('setting_redaction_color');
          const row = document.createElement('div');
          row.className = 'bl-color-row';
          row.appendChild(colorInput);
          row.appendChild(colorLabel);
          colorRowEl.appendChild(row);
        }
        // Update value without recreating the element — keeps picker open during drag.
        colorInput.value = colorVal;
        colorInput.disabled = !!ov.pii_redaction_color;
      } else {
        colorRowEl.replaceChildren();
      }
    }
  }

  // ── Notification area (site-rule + automate active pills) ─────────────────

  function renderNotifArea(activeRule, settings, onOpenSiteRules, onClearAutomate, ctx) {
    const el = document.getElementById('bl-notif-area');
    if (!el) return;
    el.replaceChildren();

    ctx = ctx || {};
    const onSuppressSS   = ctx.onSuppressScreenShare;
    const onUnsuppressSS = ctx.onUnsuppressScreenShare;

    // ── Site rule pill (top of stack) ────────────────────────────────────
    if (activeRule) {
      const pill = document.createElement('div');
      pill.className = 'bl-notif-pill';

      const dot = document.createElement('span');
      dot.className = 'bl-notif-dot';
      pill.appendChild(dot);

      const text = document.createElement('span');
      text.className = 'bl-notif-text';
      text.textContent = _t('rule_active_banner') + ': ' + activeRule.hostname_value;
      pill.appendChild(text);

      const viewBtn = document.createElement('button');
      viewBtn.className = 'bl-notif-btn';
      viewBtn.textContent = _t('rule_active_view') + ' →';
      viewBtn.addEventListener('click', function() { if (onOpenSiteRules) onOpenSiteRules(); });
      pill.appendChild(viewBtn);

      el.appendChild(pill);
    }

    // ── Automate card (below pill) ───────────────────────────────────────
    const triggers     = settings.automate_blur_triggers || {};
    const skipReason   = settings.automate_blur_skip_reason || null;
    const ssState      = settings.screen_share_state || null;
    const ssSuppressedHost = !!settings.screen_share_suppressed_for_host;
    const ssSuppressedTab  = !!settings.screen_share_suppressed_for_tab;
    const ssShareLive  = !!(ssState && ssState.active);

    // Surface current suppression state even when no triggers fire — user
    // needs the Undo affordance after dismissing a toast.
    const showCard = !!(settings.automate_blur_active || settings.automate_blur_skipped
      || ssSuppressedHost || ssSuppressedTab);
    if (!showCard) return;

    const card = document.createElement('div');
    card.className = 'bl-notif-card';

    // Suppression status row (Undo affordance)
    if (ssSuppressedTab && ssShareLive) {
      card.appendChild(_suppressionRow(_t('notif_suppressed_for_tab'), function () {
        if (onUnsuppressSS) onUnsuppressSS('tab');
      }));
    } else if (ssSuppressedHost && ssShareLive) {
      card.appendChild(_suppressionRow(_t('notif_suppressed_for_site'), function () {
        if (onUnsuppressSS) onUnsuppressSS('site_session');
      }));
    }

    // Active triggers list
    if (settings.automate_blur_active) {
      const list = document.createElement('div');
      list.className = 'bl-notif-card__triggers';
      if (triggers.screen_share)
        list.appendChild(_triggerRow(_t('notif_screen_share_active'), _shareElapsed(ssState)));
      if (triggers.idle)
        list.appendChild(_triggerRow(_t('automate_idle'), null));
      if (triggers.tab_switch)
        list.appendChild(_triggerRow(_t('automate_tab_switch'), null));
      card.appendChild(list);
    } else if (settings.automate_blur_skipped) {
      // Skipped (info-only — no actions).
      const reasonKey = skipReason === 'site_rule' ? 'notif_skipped_reason_site_rule'
        : skipReason === 'manual'    ? 'notif_skipped_reason_manual'
        : skipReason === 'pick_blur' ? 'notif_skipped_reason_pick_blur'
        : null;
      const info = document.createElement('div');
      info.className = 'bl-notif-card__info';
      info.textContent = _t('notif_screen_share_active') +
        (reasonKey ? ' — ' + _t(reasonKey) : '');
      card.appendChild(info);
    }

    // Stop-screen-share action row (only when a screen-share trigger is
    // currently active and there's no upstream skip — mirrors toast).
    if (triggers.screen_share && onSuppressSS && !ssSuppressedTab) {
      const actions = document.createElement('div');
      actions.className = 'bl-notif-card__actions';
      actions.appendChild(_cardBtn(_t('automate_stop_per_tab'),         function () { onSuppressSS('tab'); }));
      actions.appendChild(_cardBtn(_t('automate_stop_site_session'),    function () { onSuppressSS('site_session'); }));
      actions.appendChild(_cardBtn(_t('automate_disable_feature'),      function () { onSuppressSS('feature'); }, 'warn'));
      card.appendChild(actions);
    }

    // Stop idle / tab-switch action row.
    if ((triggers.idle || triggers.tab_switch) && onClearAutomate) {
      const off = document.createElement('div');
      off.className = 'bl-notif-card__off';
      const offBtn = document.createElement('button');
      offBtn.className = 'bl-notif-btn';
      offBtn.textContent = _t('automate_turn_off');
      offBtn.addEventListener('click', function () { onClearAutomate(); });
      off.appendChild(offBtn);
      card.appendChild(off);
    }

    el.appendChild(card);
  }

  function _triggerRow(name, detail) {
    const row = document.createElement('div');
    row.className = 'bl-notif-card__trigger';
    const dot = document.createElement('span');
    dot.className = 'bl-notif-dot';
    row.appendChild(dot);
    const label = document.createElement('span');
    label.className = 'bl-notif-text';
    label.textContent = detail ? (name + ' — ' + detail) : name;
    row.appendChild(label);
    return row;
  }

  function _suppressionRow(text, onUndo) {
    const row = document.createElement('div');
    row.className = 'bl-notif-card__suppress';
    const label = document.createElement('span');
    label.className = 'bl-notif-text';
    label.textContent = text;
    row.appendChild(label);
    const undoBtn = document.createElement('button');
    undoBtn.className = 'bl-notif-btn';
    undoBtn.textContent = _t('notif_suppressed_undo');
    undoBtn.addEventListener('click', function () { onUndo(); });
    row.appendChild(undoBtn);
    return row;
  }

  function _cardBtn(text, onClick, variant) {
    const b = document.createElement('button');
    b.className = 'bl-notif-btn' + (variant === 'warn' ? ' bl-notif-btn--warn' : '');
    b.textContent = text;
    b.addEventListener('click', function () { onClick(); });
    return b;
  }

  function _shareElapsed(ssState) {
    if (!ssState || typeof ssState.started_at !== 'number') return null;
    const sec = Math.max(0, Math.floor((Date.now() - ssState.started_at) / 1000));
    if (sec < 60) return _t('notif_sharing_for') + ' ' + sec + 's';
    return _t('notif_sharing_for') + ' ' + Math.floor(sec / 60) + 'm';
  }

  // ── Automate section ───────────────────────────────────────────────────────

  function renderAutomateSection(settings, onClearAutomate) {
    const summaryEl = document.getElementById('bl-automate-summary');
    if (!summaryEl) return;
    summaryEl.replaceChildren();

    const idle       = settings.automate.settings.idle        || { value: 5, unit: 'min', enabled: false };
    const tab_switch = settings.automate.settings.tab_switch  || { enabled: false };
    const ss         = settings.automate.settings.screen_share || { enabled: false };

    const idleVal = (idle.enabled && idle.value > 0)
      ? idle.value + ' ' + _t('automate_unit_' + idle.unit)
      : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_idle'), idleVal));

    const tabVal = tab_switch.enabled ? _t('automate_on') : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_tab_switch'), tabVal));

    const ssVal = ss.enabled ? _t('automate_on') : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_screen_share'), ssVal));
  }

  // ── Shared mode block helpers ──────────────────────────────────────────────

  function _makeDot(isOn) {
    const dot = document.createElement('span');
    dot.className = 'bl-mode-block__dot' + (isOn ? ' is-on' : ' is-off');
    return dot;
  }

  function _makeToggle(id, checked, ariaLabel) {
    const label = document.createElement('label');
    label.className = 'bl-toggle bl-mode-block__toggle';
    if (ariaLabel) label.setAttribute('aria-label', ariaLabel);
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

  function _renderPickerModeButtons(settings) {
    const currentMode = settings.pick_and_blur.settings.picker_mode;
    const wrap = document.createElement('div');
    wrap.className = 'bl-chips bl-picker-mode-chips';
    for (const [mode, key] of Object.entries(_PICKER_MODE_KEY)) {
      const btn = document.createElement('button');
      btn.className = 'bl-chip' + (mode === currentMode ? ' bl-chip--active' : '');
      btn.dataset.pickerMode = mode;
      btn.textContent = _t(key);
      if (_PICKER_MODE_ASSET[mode]) {
        btn.dataset.tooltipMedia   = _PICKER_MODE_ASSET[mode];
        btn.dataset.tooltipLabel   = _t(key);
        btn.dataset.tooltipCaption = _t(_PICKER_MODE_DESC[mode]);
      }
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function _renderPickBlurActions(blurItems, pickBlurEnabled) {
    const row = document.createElement('div');
    row.className = 'bl-mode-actions';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'bl-btn-ghost';
    clearBtn.dataset.action = 'clear-all';
    clearBtn.dataset.mode = 'pick-blur';
    clearBtn.disabled = blurItems.length === 0;
    clearBtn.textContent = _t('btn_clear_all');
    row.appendChild(clearBtn);

    if (pickBlurEnabled) {
      const openBtn = document.createElement('button');
      openBtn.className = 'bl-btn-ghost';
      openBtn.dataset.action = 'open-picker';
      openBtn.textContent = _t('mode_open_picker');
      row.appendChild(openBtn);
    }

    const modifyBtn = document.createElement('button');
    modifyBtn.className = 'bl-btn-text';
    modifyBtn.style.marginLeft = 'auto';
    modifyBtn.dataset.action = 'htb-modify';
    modifyBtn.dataset.mode = 'pick-blur';
    modifyBtn.textContent = _t('btn_modify');
    row.appendChild(modifyBtn);

    return row;
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

  function _renderBlurAllTable(settings) {
    const wrap = document.createElement('div');
    wrap.className = 'bl-mode-table';

    const revealKeyMap = { hover: 'reveal_hover', click: 'reveal_click', none: 'reveal_none' };
    wrap.appendChild(_summaryRow(
      _t('htb_label_reveal'),
      _t(revealKeyMap[settings.global_default_settings.reveal_mode] || 'reveal_none'),
    ));

    const blurMode = settings.blur_all.settings.blur_mode;
    let modeValue;
    if (blurMode === 'redacted') {
      modeValue = document.createElement('span');
      modeValue.className = 'bl-summary-row__value-with-swatch';
      const text = document.createTextNode(_t(_TYPE_KEY.redacted) + ' ');
      const swatch = document.createElement('span');
      swatch.className = 'bl-color-swatch';
      swatch.style.background = settings.global_default_settings.redaction_color || '#000000';
      modeValue.appendChild(text);
      modeValue.appendChild(swatch);
    } else {
      modeValue = _t(_TYPE_KEY[blurMode] || _TYPE_KEY.blur);
    }
    wrap.appendChild(_summaryRow(_t('htb_label_mode'), modeValue));

    const r = settings.global_default_settings.blur_radius;
    const strengthKey = r <= 4 ? 'htb_strength_subtle' : r <= 9 ? 'htb_strength_moderate' : 'htb_strength_strong';
    wrap.appendChild(_summaryRow(_t('htb_label_strength'), _t(strengthKey)));

    const cats = settings.blur_all.settings.blur_categories || {};
    const catLabels = Object.keys(_CAT_KEY).filter(k => cats[k]).map(k => _t(_CAT_KEY[k]));
    wrap.appendChild(_summaryRow(
      _t('htb_label_covers'),
      catLabels.length ? catLabels.join(', ') : _t('automate_off'),
    ));

    return wrap;
  }

  function _renderBlurAllBlock(el, settings, isPageBlurred) {
    el.replaceChildren();
    el.className = 'bl-mode-block bl-mode-block--blur-all' + (!isPageBlurred ? ' bl-mode-block--off' : '');

    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';
    header.appendChild(_makeDot(!!isPageBlurred));
    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_blur_all');
    header.appendChild(title);
    header.appendChild(_makeToggle('bl-blur-all-toggle', !!isPageBlurred, _t('btn_blur_all')));
    el.appendChild(header);

    if (isPageBlurred) {
      el.appendChild(_renderBlurAllTable(settings));
      el.appendChild(_renderModeActions('blur-all', false, false, false));
    } else {
      const hint = document.createElement('p');
      hint.className = 'bl-pick-count';
      hint.textContent = _t('mode_blur_all_off_hint');
      el.appendChild(hint);
    }
  }

  // ── Pick & Blur block ──────────────────────────────────────────────────────

  function _renderPickItemList(blurItems) {
    const list = document.createElement('div');
    list.className = 'bl-pick-list';
    blurItems.forEach(function(item) {
      const row = document.createElement('div');
      row.className = 'bl-item-row';
      row.dataset.highlightType = item.type;
      if (item.type === 'dynamic') {
        row.dataset.highlightSelectors = JSON.stringify(
          Array.isArray(item.selectors) ? item.selectors : (item.selector ? [item.selector] : [])
        );
      } else {
        row.dataset.highlightId = item.id || '';
      }

      const dot = document.createElement('span');
      dot.className = 'bl-item-dot ' + (item.type === 'sticky' ? 'bl-item-dot--cyan' : 'bl-item-dot--amber');
      row.appendChild(dot);

      const nameEl = document.createElement('span');
      nameEl.className = 'bl-item-selector';
      nameEl.textContent = item.name || item.selector || item.id || '?';
      nameEl.title = item.type === 'dynamic' ? (item.selector || '') : (item.id || '');
      row.appendChild(nameEl);

      const typeEl = document.createElement('span');
      typeEl.className = 'bl-item-type';
      typeEl.textContent = item.type === 'sticky' && (item.anchor || 'page') === 'screen'
        ? _t('item_type_sticky_screen')
        : item.type === 'sticky'
        ? _t('item_type_sticky_page')
        : _t('item_type_dynamic');
      row.appendChild(typeEl);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'bl-item-remove';
      removeBtn.type = 'button';
      removeBtn.title = _t('item_remove_title');
      removeBtn.setAttribute('aria-label', _t('item_remove_aria'));
      removeBtn.dataset.itemId = item.type === 'dynamic'
        ? (item.selectors ? item.selectors[0] : item.selector)
        : item.id;
      var trashDoc = new DOMParser().parseFromString(
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
          '<path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>' +
          '<path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>' +
        '</svg>',
        'image/svg+xml'
      );
      removeBtn.appendChild(document.adoptNode(trashDoc.documentElement));
      row.appendChild(removeBtn);

      list.appendChild(row);
    });
    return list;
  }

  function _renderPickBlurInfo(settings, blurItems, pickBlurEnabled) {
    const wrap = document.createElement('div');
    wrap.className = 'bl-mode-table';

    if (pickBlurEnabled && blurItems.length > 0) {
      wrap.appendChild(_renderPickItemList(blurItems));
      wrap.appendChild(_summaryRow(_t('htb_label_mode'), _t(_TYPE_KEY[settings.pick_and_blur.settings.blur_type || 'blur'])));
      const r = settings.global_default_settings.blur_radius;
      const strengthKey = r <= 4 ? 'htb_strength_subtle' : r <= 9 ? 'htb_strength_moderate' : 'htb_strength_strong';
      wrap.appendChild(_summaryRow(_t('htb_label_strength'), _t(strengthKey)));
    } else {
      const countEl = document.createElement('p');
      countEl.className = 'bl-pick-count';
      if (!pickBlurEnabled) {
        countEl.textContent = blurItems.length > 0
          ? _t('mode_pick_off_paused').replace('$COUNT$', String(blurItems.length))
          : _t('mode_pick_off_hint');
      } else {
        countEl.textContent = _t('mode_pick_blur_empty');
      }
      wrap.appendChild(countEl);
    }

    return wrap;
  }

  function _renderPickBlurBlock(el, settings, blurItems, pickBlurEnabled) {
    blurItems = blurItems || [];
    el.replaceChildren();
    el.className = 'bl-mode-block bl-mode-block--pick-blur' + (!pickBlurEnabled ? ' bl-mode-block--off' : '');

    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';
    header.appendChild(_makeDot(!!pickBlurEnabled));
    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_picker');
    header.appendChild(title);
    header.appendChild(_makeToggle('bl-pick-blur-toggle', !!pickBlurEnabled, _t('btn_picker')));
    el.appendChild(header);

    el.appendChild(_renderPickBlurInfo(settings, blurItems, !!pickBlurEnabled));
    if (pickBlurEnabled) {
      el.appendChild(_renderPickerModeButtons(settings));
      el.appendChild(_renderPickBlurActions(blurItems, true));
    }
  }

  // ── Modes section ──────────────────────────────────────────────────────────

  function renderModesSection(settings, blurItems, isPageBlurred) {
    blurItems = blurItems || [];
    const blurAllEl  = document.getElementById('bl-mode-blur-all');
    const pickBlurEl = document.getElementById('bl-mode-pick-blur');
    if (!blurAllEl || !pickBlurEl) return;

    _renderBlurAllBlock(blurAllEl, settings, isPageBlurred);
    _renderPickBlurBlock(pickBlurEl, settings, blurItems, settings.pick_and_blur.status);
  }

  // ── Render all sections ────────────────────────────────────────────────────

  function renderAll(settings, blurItems, isPageBlurred, onSave, onClearAutomate, activeRule, onOpenSiteRules, ctx) {
    ctx = ctx || {};
    // Compose a settings view that includes resolve-only rule metadata so
    // BlurrySitePopupShared.isRuleManaged() can read it from one place.
    var ruleSettings = Object.assign({}, settings, {
      _rule_match: ctx.ruleMatch || null,
      _rule_overrides: ctx.ruleOverrides || {},
    });
    var ruleManaged = BlurrySitePopupShared.isRuleManaged(ruleSettings);
    document.body.classList.toggle('bl-rule-managed', ruleManaged);

    if (ruleManaged) {
      // Banner replaces the modes/PII/automate UI on rule-managed hosts.
      _renderRuleManagedBanner(ctx.ruleMatch, ctx.onOpenManagingRule || onOpenSiteRules);
      _clearRuleManagedSections();
      return;
    }

    renderNotifArea(activeRule, settings, onOpenSiteRules, onClearAutomate, ctx);
    renderModesSection(settings, blurItems, isPageBlurred);
    renderPiiSection(settings, onSave, ctx);
    renderAutomateSection(settings, onClearAutomate);
  }

  function _renderRuleManagedBanner(ruleMatch, onOpen) {
    var notif = document.getElementById('bl-notif-area');
    if (notif) notif.replaceChildren();
    var blurAllEl  = document.getElementById('bl-mode-blur-all');
    if (blurAllEl) blurAllEl.replaceChildren();
    var pickBlurEl = document.getElementById('bl-mode-pick-blur');
    if (pickBlurEl) pickBlurEl.replaceChildren();
    if (!notif || !ruleMatch) return;

    var banner = BlurrySitePopupShared.makeBanner({
      hostname_value: ruleMatch.hostname_value,
      hostname_type:  ruleMatch.hostname_type,
      onEdit: function () { if (onOpen) onOpen({ focusRule: ruleMatch }); },
    });
    notif.appendChild(banner);
  }

  function _clearRuleManagedSections() {
    var ids = ['bl-pii-chips', 'bl-pii-color-row', 'bl-automate-summary'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.replaceChildren();
    }
  }

  return { renderAll, renderHtbSection, renderPiiSection, renderAutomateSection, renderModesSection, renderNotifArea };
})();

window.BlurrySitePopupRender = BlurrySitePopupRender;
