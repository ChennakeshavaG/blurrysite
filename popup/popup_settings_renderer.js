/**
 * popup_settings_renderer.js — PrivacyBlur Reusable Settings Component
 *
 * POJO-driven renderer that takes config arrays and a settings object,
 * and builds the DOM for any settings panel. Used for:
 * - General / Advanced / Experimental sections
 * - Rule editor modal overrides
 *
 * Each config entry describes a setting's key, type, i18n keys, and options.
 * The renderer dispatches to type-specific creators (toggle, range, select, etc.)
 * and maintains a control map for bi-directional sync.
 *
 * Exposed as window.PrivacyBlurSettingsRenderer (IIFE — no ES module syntax).
 */

const PrivacyBlurSettingsRenderer = (() => {
  'use strict';

  const I18n = () => window.PrivacyBlurI18n;

  // ── Control registry ───────────────────────────────────────────────────────
  // Maps setting key → { control: HTMLElement, display: HTMLElement|null, config }

  /** @type {Map<string, { control: HTMLElement, display: HTMLElement|null, config: Object }>} */
  const _registry = new Map();

  // ── Dot-path utilities ─────────────────────────────────────────────────────

  function getByPath(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, obj);
  }

  function setByPath(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  // ── Shortcut code labels ───────────────────────────────────────────────────
  // Raw code → human-readable label. No i18n — stored for our ease.

  const CODE_LABELS = {
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt',
    MetaLeft: 'L-Cmd', MetaRight: 'R-Cmd',
    CapsLock: 'CapsLock', Fn: 'Fn',
  };

  function codeLabel(code) {
    return CODE_LABELS[code] || code;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Render a section of settings into a container element.
   *
   * @param {HTMLElement}   container — Parent DOM element to append rows into
   * @param {Object[]}      configs   — Array of setting config POJOs
   * @param {Object}         settings  — Current settings state object
   * @param {Function}       onChange  — Callback: (key: string, value: any) => void
   * @param {Object}         [opts]    — Options: { ruleMode: boolean } for rule override rendering
   */
  function renderSection(container, configs, settings, onChange, opts) {
    const ruleMode = opts && opts.ruleMode;
    let currentGroup = null;

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];

      // Group header when group changes
      if (config.group && config.group !== currentGroup) {
        currentGroup = config.group;
        const header = document.createElement('div');
        header.className = 'pb-setting-group';
        header.textContent = I18n().t('group_' + config.group);
        container.appendChild(header);
      }

      const row = _renderRow(config, settings, onChange, ruleMode);
      container.appendChild(row);
    }
  }

  /**
   * Update all registered controls to reflect a new settings state.
   * Call this when settings change externally (e.g., storage.onChanged).
   *
   * @param {Object} settings — New settings state
   */
  function updateAll(settings) {
    for (const [key, entry] of _registry) {
      const value = getByPath(settings, key);
      _syncControl(entry, value);
    }
  }

  /**
   * Clear the control registry. Call when tearing down the UI.
   */
  function destroy() {
    _registry.clear();
  }

  // ── Row rendering ──────────────────────────────────────────────────────────

  function _renderRow(config, settings, onChange, ruleMode) {
    const row = document.createElement('div');
    row.className = 'pb-setting pb-setting--' + config.type;
    row.dataset.key = config.key;

    // Label
    const label = document.createElement('label');
    label.className = 'pb-setting__label';
    label.textContent = I18n().t(config.i18nKey);

    if (config.i18nHintKey) {
      const hint = document.createElement('span');
      hint.className = 'pb-setting__hint';
      hint.textContent = I18n().t(config.i18nHintKey);
      label.appendChild(hint);
    }

    row.appendChild(label);

    const value = getByPath(settings, config.key);
    let controlEl = null;
    let displayEl = null;

    if (ruleMode && config.type !== 'shortcut') {
      // Rule mode: wrap with "Global default" / override select
      const result = _createRuleOverride(config, value, onChange);
      controlEl = result.wrapper;
      displayEl = result.display || null;
    } else {
      switch (config.type) {
        case 'toggle':
          controlEl = _createToggle(config, value, onChange);
          break;
        case 'range': {
          const r = _createRange(config, value, onChange);
          controlEl = r.wrapper;
          displayEl = r.display;
          break;
        }
        case 'select':
          controlEl = _createSelect(config, value, onChange);
          break;
        case 'color':
          controlEl = _createColor(config, value, onChange);
          break;
        case 'number': {
          const n = _createNumber(config, value, onChange);
          controlEl = n.wrapper;
          displayEl = n.display;
          break;
        }
        case 'shortcut':
          controlEl = _createShortcutDisplay(config, value, onChange);
          break;
      }
    }

    if (controlEl) {
      row.appendChild(controlEl);
      _registry.set(config.key, { control: controlEl, display: displayEl, config });
    }

    return row;
  }

  // ── Type-specific control creators ─────────────────────────────────────────

  function _createToggle(config, value, onChange) {
    const isBool = !config.options || config.options.falseValue === undefined;
    const checked = isBool ? !!value : (value === config.options.trueValue);

    const wrapper = document.createElement('label');
    wrapper.className = 'pb-toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      const newVal = isBool
        ? input.checked
        : (input.checked ? config.options.trueValue : config.options.falseValue);
      onChange(config.key, newVal);
    });

    const track = document.createElement('span');
    track.className = 'pb-toggle__track';
    const thumb = document.createElement('span');
    thumb.className = 'pb-toggle__thumb';
    track.appendChild(thumb);

    wrapper.appendChild(input);
    wrapper.appendChild(track);
    return wrapper;
  }

  function _createRange(config, value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pb-range-wrapper';

    const display = document.createElement('span');
    display.className = 'pb-setting__value';
    display.textContent = value + (config.options.unit || '');

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'pb-slider';
    input.min = config.options.min;
    input.max = config.options.max;
    input.step = config.options.step;
    input.value = value;
    input.dataset.unit = config.options.unit || '';

    input.addEventListener('input', () => {
      const v = Number(input.value);
      display.textContent = v + (config.options.unit || '');
      onChange(config.key, v);
    });

    wrapper.appendChild(display);
    wrapper.appendChild(input);
    return { wrapper, display };
  }

  function _createSelect(config, value, onChange) {
    const select = document.createElement('select');
    select.className = 'pb-select';

    for (const opt of config.options.values) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = I18n().t(opt.i18nKey);
      if (opt.value === value) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      onChange(config.key, select.value);
    });

    return select;
  }

  function _createColor(config, value, onChange) {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'pb-color';
    input.value = value || '#f59e0b';

    input.addEventListener('input', () => {
      onChange(config.key, input.value);
    });

    return input;
  }

  function _createNumber(config, value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pb-number-wrapper';

    const display = document.createElement('span');
    display.className = 'pb-setting__value';
    display.textContent = value === 0 ? '0' : String(value);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'pb-number';
    input.min = config.options.min;
    input.max = config.options.max;
    input.step = config.options.step;
    input.value = value;

    input.addEventListener('input', () => {
      const v = Math.max(config.options.min, Math.min(config.options.max, Number(input.value) || 0));
      display.textContent = v === 0 && config.options.min === 0 ? '0' : String(v);
      onChange(config.key, v);
    });

    wrapper.appendChild(display);
    wrapper.appendChild(input);
    return { wrapper, display };
  }

  function _createShortcutDisplay(config, value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pb-shortcut';

    const keysEl = document.createElement('span');
    keysEl.className = 'pb-shortcut__keys';
    _renderShortcutKeys(keysEl, value);

    const btn = document.createElement('button');
    btn.className = 'pb-shortcut__customize';
    btn.textContent = I18n().t('shortcut_customize');
    btn.addEventListener('click', () => {
      // Fire onChange with a special signal — popup.js handles modal opening
      onChange(config.key, { _openCapture: true, action: config.key.split('.')[1] });
    });

    wrapper.appendChild(keysEl);
    wrapper.appendChild(btn);
    return wrapper;
  }

  function _renderShortcutKeys(container, binding) {
    container.textContent = '';
    if (!binding || !binding.primaryModifier) return;

    const modKbd = document.createElement('kbd');
    modKbd.textContent = codeLabel(binding.primaryModifier);
    container.appendChild(modKbd);

    if (Array.isArray(binding.keys)) {
      for (const k of binding.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = CODE_LABELS[k.code] || (k.key || '').toUpperCase();
        container.appendChild(kbd);
      }
    }
  }

  // ── Rule override wrapper ──────────────────────────────────────────────────
  // In rule mode, each setting gets a "Global default" / custom value selector.
  // null/undefined in rule.settings means "inherit global."

  function _createRuleOverride(config, value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pb-rule-override';

    const hasOverride = value !== undefined && value !== null;

    if (config.type === 'toggle') {
      // Three-state select: Global default / On / Off
      const select = document.createElement('select');
      select.className = 'pb-select pb-select--sm';

      const optDefault = document.createElement('option');
      optDefault.value = '';
      optDefault.textContent = I18n().t('rule_global_default');
      select.appendChild(optDefault);

      const optOn = document.createElement('option');
      optOn.value = 'true';
      optOn.textContent = I18n().t('rule_override_on');
      select.appendChild(optOn);

      const optOff = document.createElement('option');
      optOff.value = 'false';
      optOff.textContent = I18n().t('rule_override_off');
      select.appendChild(optOff);

      if (hasOverride) {
        select.value = String(!!value);
      } else {
        select.value = '';
      }

      select.addEventListener('change', () => {
        if (select.value === '') {
          onChange(config.key, null); // inherit global
        } else {
          onChange(config.key, select.value === 'true');
        }
      });

      wrapper.appendChild(select);
      return { wrapper, display: null };
    }

    if (config.type === 'select') {
      const select = document.createElement('select');
      select.className = 'pb-select pb-select--sm';

      const optDefault = document.createElement('option');
      optDefault.value = '';
      optDefault.textContent = I18n().t('rule_global_default');
      select.appendChild(optDefault);

      for (const opt of config.options.values) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = I18n().t(opt.i18nKey);
        select.appendChild(option);
      }

      select.value = hasOverride ? value : '';

      select.addEventListener('change', () => {
        onChange(config.key, select.value || null);
      });

      wrapper.appendChild(select);
      return { wrapper, display: null };
    }

    if (config.type === 'range' || config.type === 'number') {
      // Checkbox to enable override + control
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'pb-rule-override__check';
      checkbox.checked = hasOverride;

      const controlContainer = document.createElement('div');
      controlContainer.className = 'pb-rule-override__control';
      controlContainer.style.display = hasOverride ? '' : 'none';

      let innerControl;
      let display = null;

      if (config.type === 'range') {
        const defaultVal = (value !== null && value !== undefined) ? value : config.options.min;
        const r = _createRange(config, defaultVal, (key, val) => {
          onChange(key, val);
        });
        innerControl = r.wrapper;
        display = r.display;
      } else {
        const defaultVal = (value !== null && value !== undefined) ? value : config.options.min;
        const n = _createNumber(config, defaultVal, (key, val) => {
          onChange(key, val);
        });
        innerControl = n.wrapper;
        display = n.display;
      }

      controlContainer.appendChild(innerControl);

      checkbox.addEventListener('change', () => {
        controlContainer.style.display = checkbox.checked ? '' : 'none';
        if (!checkbox.checked) {
          onChange(config.key, null); // inherit global
        } else {
          // Set to current control value
          const input = controlContainer.querySelector('input[type="range"], input[type="number"]');
          if (input) onChange(config.key, Number(input.value));
        }
      });

      wrapper.appendChild(checkbox);
      wrapper.appendChild(controlContainer);
      return { wrapper, display };
    }

    if (config.type === 'color') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'pb-rule-override__check';
      checkbox.checked = hasOverride;

      const input = _createColor(config, value || '#f59e0b', (key, val) => {
        onChange(key, val);
      });
      input.style.display = hasOverride ? '' : 'none';

      checkbox.addEventListener('change', () => {
        input.style.display = checkbox.checked ? '' : 'none';
        if (!checkbox.checked) {
          onChange(config.key, null);
        } else {
          onChange(config.key, input.value);
        }
      });

      wrapper.appendChild(checkbox);
      wrapper.appendChild(input);
      return { wrapper, display: null };
    }

    return { wrapper, display: null };
  }

  // ── Sync helper ────────────────────────────────────────────────────────────

  function _syncControl(entry, value) {
    const { control, display, config } = entry;

    if (config.type === 'toggle') {
      const input = control.querySelector('input[type="checkbox"]');
      if (input) {
        const isBool = !config.options || config.options.falseValue === undefined;
        input.checked = isBool ? !!value : (value === config.options.trueValue);
      }
    } else if (config.type === 'range' || config.type === 'number') {
      const input = control.querySelector('input[type="range"], input[type="number"]');
      if (input) input.value = value;
      if (display) display.textContent = value + (config.options.unit || '');
    } else if (config.type === 'select') {
      const select = control.querySelector ? control : control;
      if (select.tagName === 'SELECT') select.value = value;
      else {
        const sel = control.querySelector('select');
        if (sel) sel.value = value;
      }
    } else if (config.type === 'color') {
      const input = control.querySelector ? control.querySelector('input[type="color"]') : control;
      if (input && input.type === 'color') input.value = value;
    } else if (config.type === 'shortcut') {
      const keysEl = control.querySelector('.pb-shortcut__keys');
      if (keysEl) _renderShortcutKeys(keysEl, value);
    }
  }

  // ── Expose ─────────────────────────────────────────────────────────────────

  return {
    renderSection,
    updateAll,
    destroy,
    getByPath,
    setByPath,
    codeLabel,
    CODE_LABELS,
  };
})();

window.PrivacyBlurSettingsRenderer = PrivacyBlurSettingsRenderer;
