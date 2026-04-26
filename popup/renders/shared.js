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

  return { t: t, makeToggle: makeToggle, updateFill: updateFill, makeDivider: makeDivider };
})();

window.BlurrySitePopupShared = BlurrySitePopupShared;
