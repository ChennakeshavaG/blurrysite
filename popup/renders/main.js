const BlurrySitePopupRender = (() => {
  'use strict';

  var _t = BlurrySitePopupShared.t;
  var _shareTimer = null;
  var _idleTimer = null;
  var _idleStartedAt = null;

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

  // ── Notification area (site-rule pill + per-trigger sub-cards) ────────────

  function renderNotifArea(activeRule, settings, onOpenSiteRules, ctx) {
    if (_shareTimer) { clearInterval(_shareTimer); _shareTimer = null; }
    if (_idleTimer) { clearInterval(_idleTimer); _idleTimer = null; }
    const el = document.getElementById('bl-notif-area');
    if (!el) return;
    el.replaceChildren();

    ctx = ctx || {};
    const onSuppressSS   = ctx.onSuppressScreenShare;
    const onUnsuppressSS = ctx.onUnsuppressScreenShare;
    const onSuppressIdle      = ctx.onSuppressIdle;
    const onUnsuppressIdle    = ctx.onUnsuppressIdle;
    const onSuppressTS        = ctx.onSuppressTabSwitch;
    const onUnsuppressTS      = ctx.onUnsuppressTabSwitch;

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

    // ── Automate sub-cards (one per trigger) ────────────────────────────
    var triggers     = settings.automate_blur_triggers || {};
    var skipReason   = settings.automate_blur_skip_reason || null;
    var ssState      = settings.screen_share_state || null;
    var ssSuppressedHost = !!settings.screen_share_suppressed_for_host;
    var ssSuppressedTab  = !!settings.screen_share_suppressed_for_tab;
    var idleSuppressedTab  = !!settings.idle_suppressed_for_tab;
    var idleSuppressedSite = !!settings.idle_suppressed_for_site;
    var tsSuppressedTab    = !!settings.tab_switch_suppressed_for_tab;
    var tsSuppressedSite   = !!settings.tab_switch_suppressed_for_site;
    var ssShareLive  = !!(ssState && ssState.active);
    var ssIsSharingTab = !!(ssState && ssState.is_sharing_tab);

    var idleSettings = settings.automate && settings.automate.settings
                       && settings.automate.settings.idle;
    var idleEnabled  = !!(idleSettings && idleSettings.enabled);
    var idleSuspended  = !!settings.idle_suspended;
    var tsSuspended    = !!settings.tab_switch_suspended;
    var ssSuspended    = !!settings.screen_share_suspended;

    var showAny = !!(settings.automate_blur_active || settings.automate_blur_skipped
      || ssSuppressedHost || ssSuppressedTab || ssIsSharingTab
      || idleSuppressedTab || idleSuppressedSite
      || tsSuppressedTab || tsSuppressedSite
      || idleEnabled
      || idleSuspended || tsSuspended || ssSuspended);
    if (!showAny) return;

    // Sharing-tab card — this tab IS the one sharing its screen
    if (ssIsSharingTab && ssShareLive) {
      el.appendChild(_buildTriggerSubCard({
        triggerLabel: _t('notif_sharing_this_screen'),
        elapsed: _shareElapsed(ssState),
        onTimerSetup: function (elapsedEl) {
          if (elapsedEl && ssState) {
            _shareTimer = setInterval(function () {
              var txt = _shareElapsed(ssState);
              if (txt) elapsedEl.textContent = ' — ' + txt;
            }, 1000);
          }
        },
        actions: onSuppressSS
          ? [{ label: _t('automate_disable_feature'), onClick: function () { onSuppressSS('feature'); }, tooltip: _t('automate_tooltip_turn_off') }]
          : null,
      }));
      return;
    }

    // Screen-share sub-card
    if (triggers.screen_share || ((ssSuppressedTab || ssSuppressedHost) && ssShareLive)) {
      var ssCfg = { triggerLabel: _t('notif_screen_share_active'), elapsed: _shareElapsed(ssState) };
      ssCfg.onTimerSetup = function (elapsedEl) {
        if (elapsedEl && ssState) {
          _shareTimer = setInterval(function () {
            var txt = _shareElapsed(ssState);
            if (txt) elapsedEl.textContent = ' — ' + txt;
          }, 1000);
        }
      };
      if (ssSuppressedTab && ssShareLive) {
        ssCfg.suppression = { label: _t('notif_suppressed_for_tab'), onUndo: function () { if (onUnsuppressSS) onUnsuppressSS('tab'); } };
      } else if (ssSuppressedHost && ssShareLive) {
        ssCfg.suppression = { label: _t('notif_suppressed_for_site'), onUndo: function () { if (onUnsuppressSS) onUnsuppressSS('site_session'); } };
      } else if (triggers.screen_share && onSuppressSS && !ssSuppressedTab) {
        ssCfg.actions = [
          { label: _t('automate_stop_per_tab'),      onClick: function () { onSuppressSS('tab'); }, tooltip: _t('automate_tooltip_skip_tab') },
          { label: _t('automate_stop_site_session'),  onClick: function () { onSuppressSS('site_session'); }, tooltip: _t('automate_tooltip_skip_site') },
          { label: _t('automate_disable_feature'),    onClick: function () { onSuppressSS('feature'); }, tooltip: _t('automate_tooltip_turn_off') },
        ];
      }
      el.appendChild(_buildTriggerSubCard(ssCfg));
    }

    // Screen-share suspended card
    if (ssSuspended && !triggers.screen_share && !ssSuppressedTab && !ssSuppressedHost) {
      el.appendChild(_buildTriggerSubCard({
        triggerLabel: _t('notif_screen_share_active'),
        suppression: { label: _t('notif_suspended'), onUndo: function () { if (onUnsuppressSS) onUnsuppressSS('feature'); } },
      }));
    }

    // Idle sub-card — info (pre-trigger) / triggered / suppressed / suspended
    if (idleEnabled || triggers.idle || idleSuppressedTab || idleSuppressedSite || idleSuspended) {
      if (triggers.idle && !_idleStartedAt) _idleStartedAt = Date.now();
      if (!triggers.idle) _idleStartedAt = null;

      var idleCfg;
      if (idleSuppressedTab) {
        idleCfg = { triggerLabel: _t('automate_idle') };
        idleCfg.suppression = { label: _t('automate_idle') + ' — ' + _t('notif_suppressed_for_tab'), onUndo: function () { if (onUnsuppressIdle) onUnsuppressIdle('tab'); } };
      } else if (idleSuppressedSite) {
        idleCfg = { triggerLabel: _t('automate_idle') };
        idleCfg.suppression = { label: _t('automate_idle') + ' — ' + _t('notif_suppressed_for_site'), onUndo: function () { if (onUnsuppressIdle) onUnsuppressIdle('site_session'); } };
      } else if (idleSuspended) {
        idleCfg = { triggerLabel: _t('automate_idle') };
        idleCfg.suppression = { label: _t('automate_idle') + ' — ' + _t('notif_suspended'), onUndo: function () { if (onUnsuppressIdle) onUnsuppressIdle('feature'); } };
      } else if (triggers.idle) {
        idleCfg = { triggerLabel: _t('automate_idle'), elapsed: _idleElapsed() };
        idleCfg.onTimerSetup = function (elapsedEl) {
          if (elapsedEl && _idleStartedAt) {
            _idleTimer = setInterval(function () {
              var txt = _idleElapsed();
              if (txt) elapsedEl.textContent = ' — ' + txt;
            }, 1000);
          }
        };
        if (onSuppressIdle && !idleSuppressedTab) {
          idleCfg.actions = [
            { label: _t('automate_stop_per_tab'),      onClick: function () { onSuppressIdle('tab'); }, tooltip: _t('automate_tooltip_skip_tab') },
            { label: _t('automate_stop_site_session'),  onClick: function () { onSuppressIdle('site_session'); }, tooltip: _t('automate_tooltip_skip_site') },
            { label: _t('automate_disable_feature'),    onClick: function () { onSuppressIdle('feature'); }, tooltip: _t('automate_tooltip_turn_off') },
          ];
        }
      } else {
        var durStr = (idleSettings.value || 5) + ' ' + (idleSettings.unit === 'sec' ? 'sec' : 'min');
        idleCfg = { infoText: _t('automate_idle_info', [durStr]) };
      }
      el.appendChild(_buildTriggerSubCard(idleCfg));
    }

    // Tab-switch sub-card
    if (triggers.tab_switch || tsSuppressedTab || tsSuppressedSite || tsSuspended) {
      var tsCfg = { triggerLabel: _t('automate_tab_switch') };
      if (tsSuppressedTab) {
        tsCfg.suppression = { label: _t('automate_tab_switch') + ' — ' + _t('notif_suppressed_for_tab'), onUndo: function () { if (onUnsuppressTS) onUnsuppressTS('tab'); } };
      } else if (tsSuppressedSite) {
        tsCfg.suppression = { label: _t('automate_tab_switch') + ' — ' + _t('notif_suppressed_for_site'), onUndo: function () { if (onUnsuppressTS) onUnsuppressTS('site_session'); } };
      } else if (tsSuspended) {
        tsCfg.suppression = { label: _t('automate_tab_switch') + ' — ' + _t('notif_suspended'), onUndo: function () { if (onUnsuppressTS) onUnsuppressTS('feature'); } };
      } else if (triggers.tab_switch && onSuppressTS && !tsSuppressedTab) {
        tsCfg.actions = [
          { label: _t('automate_stop_per_tab'),      onClick: function () { onSuppressTS('tab'); }, tooltip: _t('automate_tooltip_skip_tab') },
          { label: _t('automate_stop_site_session'),  onClick: function () { onSuppressTS('site_session'); }, tooltip: _t('automate_tooltip_skip_site') },
          { label: _t('automate_disable_feature'),    onClick: function () { onSuppressTS('feature'); }, tooltip: _t('automate_tooltip_turn_off') },
        ];
      }
      el.appendChild(_buildTriggerSubCard(tsCfg));
    }

    // Skipped state — info-only card (no active triggers)
    if (settings.automate_blur_skipped && !settings.automate_blur_active) {
      var reasonKey = skipReason === 'site_rule' ? 'notif_skipped_reason_site_rule'
        : skipReason === 'manual'    ? 'notif_skipped_reason_manual'
        : skipReason === 'pick_blur' ? 'notif_skipped_reason_pick_blur'
        : null;
      el.appendChild(_buildTriggerSubCard({
        infoText: _t('notif_automate_skipped') + (reasonKey ? ' — ' + _t(reasonKey) : ''),
      }));
    }
  }

  function _buildTriggerSubCard(cfg) {
    var card = document.createElement('div');
    card.className = 'bl-notif-card';

    if (cfg.suppression) {
      card.appendChild(_suppressionRow(cfg.suppression.label, cfg.suppression.onUndo));
    }

    if (cfg.triggerLabel && !cfg.suppression) {
      var list = document.createElement('div');
      list.className = 'bl-notif-card__triggers';
      var row = _triggerRow(cfg.triggerLabel, cfg.elapsed || null);
      list.appendChild(row);
      card.appendChild(list);
      if (cfg.onTimerSetup) {
        cfg.onTimerSetup(row.querySelector('.bl-notif-elapsed'));
      }
    }

    if (cfg.infoText) {
      var info = document.createElement('div');
      info.className = 'bl-notif-card__info';
      info.textContent = cfg.infoText;
      card.appendChild(info);
    }

    if (cfg.actions && cfg.actions.length) {
      var actions = document.createElement('div');
      actions.className = 'bl-notif-card__actions';
      for (var i = 0; i < cfg.actions.length; i++) {
        actions.appendChild(_cardBtn(cfg.actions[i].label, cfg.actions[i].onClick, cfg.actions[i].variant, cfg.actions[i].tooltip));
      }
      card.appendChild(actions);
    }

    return card;
  }

  function _triggerRow(name, detail) {
    const row = document.createElement('div');
    row.className = 'bl-notif-card__trigger';
    const dot = document.createElement('span');
    dot.className = 'bl-notif-dot';
    row.appendChild(dot);
    const label = document.createElement('span');
    label.className = 'bl-notif-text';
    label.textContent = name;
    row.appendChild(label);
    if (detail) {
      var elapsed = document.createElement('span');
      elapsed.className = 'bl-notif-elapsed';
      elapsed.textContent = ' — ' + detail;
      row.appendChild(elapsed);
    }
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

  function _cardBtn(text, onClick, variant, tooltip) {
    const b = document.createElement('button');
    b.className = 'bl-notif-btn' + (variant === 'warn' ? ' bl-notif-btn--warn' : '');
    b.textContent = text;
    if (tooltip) b.dataset.tooltipCaption = tooltip;
    b.addEventListener('click', function () { onClick(); });
    return b;
  }

  function _shareElapsed(ssState) {
    if (!ssState || typeof ssState.started_at !== 'number') return null;
    const sec = Math.max(0, Math.floor((Date.now() - ssState.started_at) / 1000));
    if (sec < 60) return _t('notif_sharing_for') + ' ' + sec + 's';
    return _t('notif_sharing_for') + ' ' + Math.floor(sec / 60) + 'm';
  }

  function _idleElapsed() {
    if (!_idleStartedAt) return null;
    var sec = Math.max(0, Math.floor((Date.now() - _idleStartedAt) / 1000));
    if (sec < 60) return sec + 's';
    return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
  }

  // ── Automate section ───────────────────────────────────────────────────────

  function renderAutomateSection(settings) {
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

    _renderPickBlurBlock(pickBlurEl, settings, blurItems, settings.pick_and_blur.status);
    _renderBlurAllBlock(blurAllEl, settings, isPageBlurred);
  }

  // ── Render all sections ────────────────────────────────────────────────────

  function renderAll(settings, blurItems, isPageBlurred, onSave, activeRule, onOpenSiteRules, ctx) {
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

    renderNotifArea(activeRule, settings, onOpenSiteRules, ctx);
    renderModesSection(settings, blurItems, isPageBlurred);
    renderPiiSection(settings, onSave, ctx);
    renderAutomateSection(settings);
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
