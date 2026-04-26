const BlurrySitePopupShared = (() => {
  'use strict';

  function t(key) {
    if (blsi && blsi.ContentI18n) return blsi.ContentI18n.t(key);
    return chrome.i18n.getMessage(key) || key;
  }

  function makeToggle(id, checked, ariaLabel) {
    var label = document.createElement('label');
    label.className = 'bl-toggle';
    if (ariaLabel) label.setAttribute('aria-label', ariaLabel);
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
    var track = document.createElement('span');
    track.className = 'bl-toggle__track';
    label.appendChild(input);
    label.appendChild(track);
    return { label: label, input: input };
  }

  // min/max are optional — fall back to input.min / input.max when omitted.
  // Supports both howtoblur (no args) and automate (explicit range in seconds).
  function updateFill(input, min, max) {
    var lo = (min !== undefined) ? min : +input.min;
    var hi = (max !== undefined) ? max : +input.max;
    var pct = ((+input.value - lo) / (hi - lo) * 100).toFixed(1);
    input.style.setProperty('--bl-slider-pct', pct + '%');
  }

  function makeDivider() {
    var hr = document.createElement('hr');
    hr.className = 'bl-divider';
    return hr;
  }

  // True when current host is governed by a site rule with a non-empty snapshot.
  // Empty {} sentinel rules (rule pins blur_all toggle only) return false —
  // user can still edit global settings on those hosts.
  function isRuleManaged(settings) {
    if (!settings) return false;
    if (!settings._rule_match) return false;
    var ov = settings._rule_overrides;
    return !!(ov && Object.keys(ov).length > 0);
  }

  function makeBanner(opts) {
    var hostname_value = opts.hostname_value || '';
    var hostname_type = opts.hostname_type || '';
    var onEdit = opts.onEdit || function () {};

    var banner = document.createElement('div');
    banner.className = 'bl-rule-banner';

    var row = document.createElement('div');
    row.className = 'bl-rule-banner__row';

    var icon = document.createElement('span');
    icon.className = 'bl-rule-banner__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🔒';

    var body = document.createElement('div');
    body.className = 'bl-rule-banner__body';

    var title = document.createElement('div');
    title.className = 'bl-rule-banner__title';
    title.textContent = t('site_rule_managed_banner_title');

    var desc = document.createElement('div');
    desc.className = 'bl-rule-banner__desc';
    var msg = chrome.i18n.getMessage('site_rule_managed_banner_body', [hostname_value, hostname_type])
      || (hostname_value + ' (' + hostname_type + ')');
    desc.textContent = msg;

    body.appendChild(title);
    body.appendChild(desc);
    row.appendChild(icon);
    row.appendChild(body);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bl-rule-banner__cta';
    btn.textContent = t('site_rule_managed_edit_cta');
    btn.addEventListener('click', function () { onEdit({ hostname_value: hostname_value, hostname_type: hostname_type }); });

    banner.appendChild(row);
    banner.appendChild(btn);
    return banner;
  }

  return {
    t: t,
    makeToggle: makeToggle,
    updateFill: updateFill,
    makeDivider: makeDivider,
    isRuleManaged: isRuleManaged,
    makeBanner: makeBanner,
  };
})();

window.BlurrySitePopupShared = BlurrySitePopupShared;
