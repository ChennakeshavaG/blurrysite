const BlurrySitePopupRenderProtect = (() => {
  'use strict';

  var _t             = BlurrySitePopupShared.t;
  var _makeToggle    = BlurrySitePopupShared.makeToggle;
  var _isRuleManaged = BlurrySitePopupShared.isRuleManaged;

  var _PII_KEY = {
    blur:     'pii_chip_blur',
    frosted:  'pii_chip_frosted',
    redacted: 'pii_chip_redacted',
    starred:  'pii_chip_starred',
  };

  var _MODE_ASSET = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? {
    blur:     chrome.runtime.getURL('popup/assets/mode_blur.svg'),
    frosted:  chrome.runtime.getURL('popup/assets/mode_frosted.svg'),
    redacted: chrome.runtime.getURL('popup/assets/mode_redacted.svg'),
    starred:  chrome.runtime.getURL('popup/assets/mode_starred.svg'),
  } : {};

  function _makeDot(isOn) {
    var dot = document.createElement('span');
    dot.className = 'bl-mode-block__dot' + (isOn ? ' is-on' : '');
    return dot;
  }

  function _makeRow(dotOn, labelText, toggleEl) {
    var row = document.createElement('div');
    row.className = 'bl-feature-row';
    row.appendChild(_makeDot(dotOn));
    var label = document.createElement('span');
    label.className = 'bl-feature-row__label';
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(toggleEl);
    return row;
  }

  function _makeDesc(textKey) {
    var p = document.createElement('p');
    p.className = 'bl-protect-card__desc';
    p.textContent = _t(textKey);
    return p;
  }

  function _buildPiiChips(modeVal, masterOn, managed, onSave) {
    var chipsEl = document.createElement('div');
    chipsEl.className = 'bl-chips bl-protect-chips';
    chipsEl.setAttribute('role', 'list');
    for (var i = 0, modes = ['blur', 'frosted', 'redacted', 'starred']; i < modes.length; i++) {
      var t = modes[i];
      var btn = document.createElement('button');
      var isActive = t === modeVal;
      btn.className = 'bl-chip' + (isActive ? ' bl-chip--active' + (masterOn ? ' bl-glow-active' : '') : '');
      btn.dataset.piiMode = t;
      btn.textContent = _t(_PII_KEY[t]);
      if (_MODE_ASSET[t]) btn.dataset.tooltipMedia = _MODE_ASSET[t];
      if (managed) btn.disabled = true;
      chipsEl.appendChild(btn);
    }
    if (!managed && onSave) {
      chipsEl.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-pii-mode]');
        if (!chip || chip.disabled) return;
        onSave({ auto_detect_pii: { settings: { pii_mode: chip.dataset.piiMode } } });
      });
    }
    return chipsEl;
  }

  function _buildColorRow(colorVal, managed, onSave) {
    var wrapper = document.createElement('div');
    wrapper.className = 'bl-protect-color-row';
    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'bl-color-input';
    colorInput.value = colorVal;
    colorInput.disabled = managed;
    if (!managed && onSave) {
      colorInput.addEventListener('input', function () {
        onSave({ auto_detect_pii: { settings: { pii_redaction_color: colorInput.value } } });
      });
    }
    var colorLabel = document.createElement('span');
    colorLabel.className = 'bl-form-row__label';
    colorLabel.textContent = _t('setting_redaction_color');
    var row = document.createElement('div');
    row.className = 'bl-color-row';
    row.appendChild(colorInput);
    row.appendChild(colorLabel);
    wrapper.appendChild(row);
    return wrapper;
  }

  function renderSection(containerEl, settings, onSave, ctx) {
    if (!containerEl) return;
    containerEl.replaceChildren();

    var ruleManaged = _isRuleManaged(settings);
    var ov = (ctx && ctx.ruleOverrides) || {};
    var resolved = ctx && ctx.resolved;

    // ── Section header (outside card) ──
    var header = document.createElement('div');
    header.className = 'bl-section__header';
    var title = document.createElement('span');
    title.className = 'bl-section__title bl-protect-title';
    title.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>' +
      '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>' +
      '<line x1="1" y1="1" x2="23" y2="23"/>' +
      '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>' +
      '</svg>';
    var titleText = document.createElement('span');
    titleText.textContent = _t('section_stay_blurry');
    title.appendChild(titleText);
    header.appendChild(title);
    containerEl.appendChild(header);

    var desc = document.createElement('p');
    desc.className = 'bl-section__desc';
    desc.textContent = _t('section_stay_blurry_desc');
    containerEl.appendChild(desc);

    // ── Screen Share card (cyan-blue) ──
    var ssCard = document.createElement('div');
    ssCard.className = 'bl-protect-card bl-protect-card--screen-share';

    var ssModel = (settings.automate && settings.automate.settings && settings.automate.settings.screen_share) || { enabled: true };
    var resolvedSs = resolved && resolved.automate_screen_share;
    var ssEnabled = resolvedSs && typeof resolvedSs.enabled === 'boolean' ? resolvedSs.enabled : !!ssModel.enabled;
    var ssManaged = ruleManaged || !!(ov.automate_screen_share);

    var ssTog = _makeToggle('bl-protect-screen-share', ssEnabled, _t('protect_screen_share'));
    if (ssManaged) ssTog.input.disabled = true;
    ssCard.appendChild(_makeRow(ssEnabled, _t('protect_screen_share'), ssTog.label));
    ssCard.appendChild(_makeDesc('protect_screen_share_desc'));

    if (!ssManaged) {
      ssTog.input.addEventListener('change', function () {
        onSave({ automate: { settings: { screen_share: { enabled: ssTog.input.checked } } } });
      });
    }

    containerEl.appendChild(ssCard);

    // ── Sensitive Info card (mid-cyan) ──
    var piiCard = document.createElement('div');
    piiCard.className = 'bl-protect-card bl-protect-card--pii';

    var piiManaged = ruleManaged || !!(ov.pii_email || ov.pii_numeric || ov.pii_mode || ov.pii_redaction_color);
    var emailVal   = resolved && typeof resolved.pii_email === 'boolean' ? resolved.pii_email : settings.auto_detect_pii.settings.email;
    var numericVal = resolved && typeof resolved.pii_numeric === 'boolean' ? resolved.pii_numeric : settings.auto_detect_pii.settings.numeric;
    var modeVal    = (resolved && resolved.pii_mode) || settings.auto_detect_pii.settings.pii_mode;
    var colorVal   = (resolved && resolved.pii_redaction_color) || settings.auto_detect_pii.settings.pii_redaction_color || '#000000';
    var masterOn   = !!(emailVal || numericVal);

    var piiTog = _makeToggle('bl-protect-pii', masterOn, _t('protect_sensitive_info'));
    if (piiManaged) piiTog.input.disabled = true;
    piiCard.appendChild(_makeRow(masterOn, _t('protect_sensitive_info'), piiTog.label));
    piiCard.appendChild(_makeDesc('protect_sensitive_info_desc'));

    if (!piiManaged) {
      piiTog.input.addEventListener('change', function () {
        var on = piiTog.input.checked;
        onSave({ auto_detect_pii: { settings: { email: on, numeric: on } } });
      });
    }

    if (masterOn) {
      piiCard.appendChild(_buildPiiChips(modeVal, masterOn, !!(ov.pii_mode), onSave));
      if (modeVal === 'redacted') {
        piiCard.appendChild(_buildColorRow(colorVal, !!(ov.pii_redaction_color), onSave));
      }
    }

    containerEl.appendChild(piiCard);

    // ── Hide Tab Title card (cyan-green) ──
    var tpCard = document.createElement('div');
    tpCard.className = 'bl-protect-card bl-protect-card--tab-privacy';

    var tabPrivacy = !!(settings.global_default_settings && settings.global_default_settings.tab_privacy);
    var tpTog = _makeToggle('bl-protect-tab-privacy', tabPrivacy, _t('setting_tab_privacy'));
    if (ruleManaged) tpTog.input.disabled = true;
    tpCard.appendChild(_makeRow(tabPrivacy, _t('setting_tab_privacy'), tpTog.label));
    tpCard.appendChild(_makeDesc('setting_tab_privacy_hint'));

    if (!ruleManaged) {
      tpTog.input.addEventListener('change', function () {
        onSave({ global_default_settings: { tab_privacy: tpTog.input.checked } });
      });
    }

    containerEl.appendChild(tpCard);

    // ── Managed badge (after all cards) ──
    if (ruleManaged) {
      var badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'bl-managed-badge';
      badge.textContent = _t('popup_badge_managed_by_rule') || 'Managed by site rule';
      badge.title = badge.textContent;
      if (ctx && ctx.onOpenManagingRule) badge.addEventListener('click', ctx.onOpenManagingRule);
      containerEl.appendChild(badge);
    }
  }

  return { renderSection: renderSection };
})();

window.BlurrySitePopupRenderProtect = BlurrySitePopupRenderProtect;
