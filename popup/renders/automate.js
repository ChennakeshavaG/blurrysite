const BlurrySitePopupRenderAutomate = (() => {
  'use strict';

  function _t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  // ── Unit conversion helpers ─────────────────────────────────────────────────

  function _toSecs(value, unit) {
    if (unit === 'hr')  return value * 3600;
    if (unit === 'min') return value * 60;
    return value;
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function _makeToggle(id, checked) {
    var label = document.createElement('label');
    label.className = 'bl-toggle';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    var track = document.createElement('span');
    track.className = 'bl-toggle__track';
    label.appendChild(input);
    label.appendChild(track);
    return { label: label, input: input };
  }

  function _makeToggleRow(labelText, toggleId, checked, tooltip) {
    var row = document.createElement('div');
    row.className = 'bl-form-row';
    if (tooltip) row.title = tooltip;
    var labelEl = document.createElement('span');
    labelEl.className = 'bl-form-row__label';
    labelEl.textContent = labelText;
    var tog = _makeToggle(toggleId, checked);
    row.appendChild(labelEl);
    row.appendChild(tog.label);
    return { row: row, input: tog.input };
  }

  function _makeDesc(text) {
    var p = document.createElement('p');
    p.className = 'bl-auto-block__desc';
    p.textContent = text;
    return p;
  }

  /**
   * Build a number input + unit select row.
   * units: array of unit strings, e.g. ['sec','min','hr']
   * Returns { wrap, numInput, unitSel }
   */
  function _makeNumberUnit(idPrefix, value, unit, units) {
    var wrap = document.createElement('div');
    wrap.className = 'bl-auto-input-row';

    var numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.id = idPrefix + '-num';
    numInput.className = 'bl-auto-num';
    numInput.min = 1;
    numInput.max = 99;
    numInput.value = value > 0 ? value : 1;

    var unitSel = document.createElement('select');
    unitSel.id = idPrefix + '-unit';
    unitSel.className = 'bl-auto-unit';
    for (var i = 0; i < units.length; i++) {
      var opt = document.createElement('option');
      opt.value = units[i];
      opt.textContent = _t('automate_unit_' + units[i]);
      if (units[i] === unit) opt.selected = true;
      unitSel.appendChild(opt);
    }

    wrap.appendChild(numInput);
    wrap.appendChild(unitSel);
    return { wrap: wrap, numInput: numInput, unitSel: unitSel };
  }

  // ── Block builders ──────────────────────────────────────────────────────────

  function _buildTabSwitchBlock(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var tabSwitch = settings.automate_tab_switch || { enabled: false };
    var hint = _t('setting_auto_blur_tab_hint');
    var togRow = _makeToggleRow(
      _t('setting_auto_blur_tab'),
      'bl-auto-tab-switch-toggle',
      tabSwitch.enabled,
      hint
    );
    block.appendChild(togRow.row);
    block.appendChild(_makeDesc(hint));

    togRow.input.addEventListener('change', function () {
      onSave({ automate_tab_switch: { enabled: togRow.input.checked } });
    });

    return block;
  }

  function _buildIdleBlock(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var title = document.createElement('div');
    title.className = 'bl-auto-block__title';
    title.textContent = _t('automate_idle');
    block.appendChild(title);

    var idle = settings.automate_idle || { value: 5, unit: 'min', enabled: false };
    var idleHint = _t('setting_auto_blur_idle_hint');
    var togRow = _makeToggleRow(
      _t('setting_auto_blur_idle'),
      'bl-auto-idle-toggle',
      idle.enabled,
      idleHint
    );
    block.appendChild(togRow.row);
    block.appendChild(_makeDesc(idleHint));

    var nu = _makeNumberUnit(
      'bl-auto-idle',
      idle.value,
      idle.unit,
      ['sec', 'min']
    );
    block.appendChild(nu.wrap);

    // Warning shown when value exceeds Chrome API max (3000 s)
    var warnEl = document.createElement('p');
    warnEl.className = 'bl-auto-warn';
    warnEl.textContent = _t('automate_idle_max_warn');
    warnEl.hidden = true;
    block.appendChild(warnEl);

    function _checkIdleLimit() {
      var secs = _toSecs(Number(nu.numInput.value) || 1, nu.unitSel.value);
      warnEl.hidden = secs <= 3000;
    }
    _checkIdleLimit();

    function _saveIdle() {
      var val = Math.max(1, Math.min(99, Number(nu.numInput.value) || 1));
      nu.numInput.value = val;
      onSave({
        automate_idle: {
          value:   val,
          unit:    nu.unitSel.value,
          enabled: togRow.input.checked,
        },
      });
    }

    togRow.input.addEventListener('change', _saveIdle);
    nu.numInput.addEventListener('change', function () { _checkIdleLimit(); _saveIdle(); });
    nu.unitSel.addEventListener('change', function () { _checkIdleLimit(); _saveIdle(); });

    return block;
  }

  function _buildTimerBlock(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-auto-block';

    var title = document.createElement('div');
    title.className = 'bl-auto-block__title';
    title.textContent = _t('automate_timer');
    block.appendChild(title);

    // Description
    block.appendChild(_makeDesc(_t('setting_blur_timer_hint')));

    var timer = settings.automate_timer || { value: 0, unit: 'min', enabled: false, started_at: null };

    // Number + unit row, plus Start/Stop button
    var nu = _makeNumberUnit(
      'bl-auto-timer',
      timer.value,
      timer.unit,
      ['sec', 'min', 'hr']
    );

    var isRunning = !!(timer.enabled && timer.started_at);

    var startStopBtn = document.createElement('button');
    startStopBtn.className = isRunning
      ? 'bl-btn-primary bl-auto-start-stop bl-auto-start-stop--stop'
      : 'bl-btn-primary bl-auto-start-stop';
    startStopBtn.textContent = isRunning ? _t('automate_timer_stop') : _t('automate_timer_start');

    nu.wrap.appendChild(startStopBtn);
    block.appendChild(nu.wrap);

    // Validation error
    var errEl = document.createElement('p');
    errEl.className = 'bl-auto-error';
    errEl.textContent = _t('automate_timer_min_error');
    errEl.hidden = true;
    block.appendChild(errEl);

    // Disable inputs while running
    if (isRunning) {
      nu.numInput.disabled = true;
      nu.unitSel.disabled  = true;
    }

    function _validate() {
      var secs = _toSecs(Number(nu.numInput.value) || 1, nu.unitSel.value);
      var ok = secs >= 30;
      errEl.hidden = ok;
      startStopBtn.disabled = !ok;
      return ok;
    }

    nu.numInput.addEventListener('input', _validate);
    nu.unitSel.addEventListener('change', _validate);

    startStopBtn.addEventListener('click', function () {
      if (isRunning) {
        // Stop
        isRunning = false;
        startStopBtn.textContent = _t('automate_timer_start');
        startStopBtn.className = 'bl-btn-primary bl-auto-start-stop';
        nu.numInput.disabled = false;
        nu.unitSel.disabled  = false;
        onSave({
          automate_timer: {
            value:      Number(nu.numInput.value) || 1,
            unit:       nu.unitSel.value,
            enabled:    false,
            started_at: null,
          },
        });
      } else {
        // Start — validate first
        if (!_validate()) return;
        isRunning = true;
        startStopBtn.textContent = _t('automate_timer_stop');
        startStopBtn.className = 'bl-btn-primary bl-auto-start-stop bl-auto-start-stop--stop';
        nu.numInput.disabled = true;
        nu.unitSel.disabled  = true;
        errEl.hidden = true;
        onSave({
          automate_timer: {
            value:      Number(nu.numInput.value) || 1,
            unit:       nu.unitSel.value,
            enabled:    true,
            started_at: Date.now(),
          },
        });
      }
    });

    return block;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Render the Automate sub-page body.
   * @param {HTMLElement} containerEl  - the .bl-subpage__body div
   * @param {Object}      settings     - full settings object (read-only)
   * @param {Function}    onSave       - called with a partial settings patch
   */
  function renderBody(containerEl, settings, onSave) {
    containerEl.innerHTML = '';

    containerEl.appendChild(_buildTabSwitchBlock(settings, onSave));

    var div1 = document.createElement('hr');
    div1.className = 'bl-divider';
    containerEl.appendChild(div1);

    containerEl.appendChild(_buildIdleBlock(settings, onSave));

    var div2 = document.createElement('hr');
    div2.className = 'bl-divider';
    containerEl.appendChild(div2);

    containerEl.appendChild(_buildTimerBlock(settings, onSave));

    var footer = document.createElement('p');
    footer.className = 'bl-section__hint';
    footer.textContent = _t('automate_footer');
    containerEl.appendChild(footer);
  }

  return { renderBody };
})();

window.BlurrySitePopupRenderAutomate = BlurrySitePopupRenderAutomate;
