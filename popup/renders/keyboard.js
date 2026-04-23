/**
 * keyboard.js — Shortcuts sub-page body renderer
 *
 * Card-based layout: each action gets a card with icon, label, description,
 * keycap-style binding badge, and an inline capture mode for recording new chords.
 *
 * Exposed as window.BlurrySitePopupRenderShortcuts.
 * Must load after action_registry.js and shortcut_label.js.
 */

const BlurrySitePopupRenderShortcuts = (() => {
  'use strict';

  var _t = BlurrySitePopupShared.t;

  /** i18n key pairs per action id */
  var ACTION_I18N = {
    'toggle-blur-all': { label: 'shortcut_toggle_blur_all', hint: 'shortcut_toggle_blur_all_hint' },
    'toggle-picker':   { label: 'shortcut_toggle_picker',   hint: 'shortcut_toggle_picker_hint' },
    'clear-all':       { label: 'shortcut_clear_all',       hint: 'shortcut_clear_all_hint' },
    'screenshot':      { label: 'shortcut_screenshot',       hint: 'shortcut_screenshot_hint' },
  };

  /** Accent CSS variable per action (references theme tokens) */
  var ACTION_ACCENT = {
    'toggle-blur-all': 'var(--bl-indigo)',
    'toggle-picker':   'var(--bl-purple)',
    'clear-all':       'var(--bl-danger)',
    'screenshot':      'var(--bl-sky)',
  };

  /** SVG icon markup per action (18×18, stroke-width 2, inside 32px badge) */
  var ACTION_ICONS = {
    'toggle-blur-all': '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 8s3-4.5 7-4.5S15 8 15 8s-3 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    'toggle-picker':   '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="4"/><line x1="8" y1="1" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="15"/><line x1="1" y1="8" x2="4" y2="8"/><line x1="12" y1="8" x2="15" y2="8"/></svg>',
    'clear-all':       '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3.5l1.5 1.5L6.5 12H4.5L3 10.5 9.5 4z"/><line x1="1" y1="14" x2="15" y2="14"/></svg>',
    'screenshot':      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="5" width="14" height="9" rx="1.5"/><path d="M5.5 5L7 3h2l1.5 2"/><circle cx="8" cy="9.5" r="2"/></svg>',
  };

  /**
   * KeyboardEvent.code values treated as modifier-only — skipped during capture.
   */
  var MODIFIER_CODES = new Set([
    'AltLeft', 'AltRight',
    'ControlLeft', 'ControlRight',
    'MetaLeft', 'MetaRight',
    'ShiftLeft', 'ShiftRight',
    'CapsLock', 'NumLock', 'ScrollLock',
    'OSLeft', 'OSRight',
  ]);

  /** Ordered modifier names to check on a keydown event. */
  var TRACKED_MODS = ['Alt', 'Control', 'Meta', 'Shift'];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _currentBinding(action, settings) {
    var entry = settings.shortcuts && settings.shortcuts[action.id];
    return entry ? entry.binding : action.defaultBinding;
  }

  /**
   * Build DOM elements for a single chord rendered as keycap badges.
   * Returns an array: [...modKeycaps, sep, codeKeycap].
   * Falls back gracefully if ShortcutLabel helpers are unavailable.
   *
   * @param {Array<{code: string, mods: Array<string>}>} binding
   * @returns {Array<HTMLElement>}
   */
  function _buildKeycaps(binding) {
    if (!Array.isArray(binding) || binding.length === 0) return [];
    var chord = binding[0]; // phase 1: single-chord bindings only
    var mods = chord.mods || [];
    var SL = blsi.ShortcutLabel;
    var labels = mods.map(function(m) { return SL.modLabel(m); });
    labels.push(SL.codeLabel(chord.code));

    var els = [];
    for (var i = 0; i < labels.length; i++) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'bl-sc-key-sep';
        sep.textContent = '+';
        els.push(sep);
      }
      var cap = document.createElement('kbd');
      cap.className = 'bl-sc-keycap';
      cap.textContent = labels[i];
      els.push(cap);
    }
    return els;
  }

  // ── Row builders ──────────────────────────────────────────────────────────────

  /**
   * Build the normal (non-capture) card state for a row.
   */
  function _buildNormalRow(rowEl, action, settings, onSave, activateCapture) {
    rowEl.innerHTML = '';
    rowEl.className = 'bl-sc-row';

    var i18nKeys = ACTION_I18N[action.id] || {};
    var label    = _t(i18nKeys.label) || action.label;
    var hint     = _t(i18nKeys.hint)  || action.description;
    var accent   = ACTION_ACCENT[action.id] || 'var(--bl-text-muted)';

    // ── Card inner ────────────────────────────────────────────────────────────

    var innerEl = document.createElement('div');
    innerEl.className = 'bl-sc-card-inner';

    // Icon
    var iconEl = document.createElement('span');
    iconEl.className = 'bl-sc-card-icon';
    iconEl.style.color = accent;
    iconEl.innerHTML = ACTION_ICONS[action.id] || '';
    innerEl.appendChild(iconEl);

    // Label + description
    var textEl = document.createElement('div');
    textEl.className = 'bl-sc-card-text';

    var labelEl = document.createElement('span');
    labelEl.className = 'bl-sc-card-label';
    labelEl.textContent = label;
    textEl.appendChild(labelEl);

    var descEl = document.createElement('span');
    descEl.className = 'bl-sc-card-desc';
    descEl.textContent = hint;
    textEl.appendChild(descEl);

    innerEl.appendChild(textEl);
    rowEl.appendChild(innerEl);

    // Keycap binding — centered row between card header and footer
    var binding = _currentBinding(action, settings);
    var hasBinding = Array.isArray(binding) && binding.length > 0;

    var bindingRowEl = document.createElement('div');
    bindingRowEl.className = 'bl-sc-binding-row';

    var bindingEl = document.createElement('div');
    if (hasBinding) {
      bindingEl.className = 'bl-sc-row__binding';
      var keycaps = _buildKeycaps(binding);
      for (var ki = 0; ki < keycaps.length; ki++) {
        bindingEl.appendChild(keycaps[ki]);
      }
    } else {
      bindingEl.className = 'bl-sc-row__binding bl-sc-row__binding--none';
      bindingEl.textContent = _t('shortcut_modal_placeholder');
    }
    bindingRowEl.appendChild(bindingEl);
    rowEl.appendChild(bindingRowEl);

    // ── Card footer: reset (left) + change (right) ────────────────────────────

    var footerEl = document.createElement('div');
    footerEl.className = 'bl-sc-card-footer';

    var resetBtn = document.createElement('button');
    resetBtn.className = 'bl-sc-reset-btn';
    resetBtn.textContent = _t('shortcut_reset');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', function() {
      var defaultBinding = action.defaultBinding.map(function(c) {
        return { code: c.code, mods: Array.isArray(c.mods) ? c.mods.slice() : [] };
      });
      onSave({ shortcuts: { [action.id]: { binding: defaultBinding } } });
      var patchedSettings = Object.assign({}, settings, {
        shortcuts: Object.assign({}, settings.shortcuts, {
          [action.id]: { binding: defaultBinding },
        }),
      });
      _buildNormalRow(rowEl, action, patchedSettings, onSave, activateCapture);
    });
    footerEl.appendChild(resetBtn);

    var changeBtn = document.createElement('button');
    changeBtn.className = 'bl-sc-change-btn';
    changeBtn.textContent = _t('shortcut_customize');
    changeBtn.type = 'button';
    changeBtn.style.setProperty('--bl-sc-accent', accent);
    changeBtn.addEventListener('click', function() { activateCapture(action); });
    footerEl.appendChild(changeBtn);

    rowEl.appendChild(footerEl);
  }

  /**
   * Build the capture (recording) state for a row.
   * Replaces card content with the capture UI and attaches a document keydown
   * listener at capture phase. Cleans up on save / cancel / escape.
   */
  function _buildCaptureRow(rowEl, action, settings, onSave, activateCapture, cancelCapture) {
    rowEl.innerHTML = '';
    rowEl.className = 'bl-sc-row bl-sc-row--capturing';

    var recordedChord = null;

    var i18nKeys = ACTION_I18N[action.id] || {};
    var label    = _t(i18nKeys.label) || action.label;
    var accent   = ACTION_ACCENT[action.id] || 'var(--bl-text-muted)';

    // ── Card inner (icon + label only — no description in capture mode) ───────

    var innerEl = document.createElement('div');
    innerEl.className = 'bl-sc-card-inner';

    var iconEl = document.createElement('span');
    iconEl.className = 'bl-sc-card-icon';
    iconEl.style.color = accent;
    iconEl.innerHTML = ACTION_ICONS[action.id] || '';
    innerEl.appendChild(iconEl);

    var labelEl = document.createElement('span');
    labelEl.className = 'bl-sc-card-label';
    labelEl.textContent = label;
    innerEl.appendChild(labelEl);

    rowEl.appendChild(innerEl);

    // ── Capture UI ────────────────────────────────────────────────────────────

    var captureEl = document.createElement('div');
    captureEl.className = 'bl-sc-capture';

    var promptEl = document.createElement('p');
    promptEl.className = 'bl-sc-capture__prompt';
    promptEl.textContent = _t('shortcut_modal_prompt');
    captureEl.appendChild(promptEl);

    var previewEl = document.createElement('div');
    previewEl.className = 'bl-sc-capture__preview bl-sc-capture__preview--empty';
    previewEl.textContent = _t('shortcut_modal_placeholder');
    captureEl.appendChild(previewEl);

    var warningEl = document.createElement('div');
    warningEl.className = 'bl-sc-capture__warning';
    warningEl.hidden = true;
    captureEl.appendChild(warningEl);

    var actionsEl = document.createElement('div');
    actionsEl.className = 'bl-sc-capture__actions';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'bl-sc-save-btn';
    saveBtn.textContent = _t('modal_save');
    saveBtn.type = 'button';
    saveBtn.disabled = true;
    actionsEl.appendChild(saveBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'bl-sc-cancel-btn';
    cancelBtn.textContent = _t('modal_cancel');
    cancelBtn.type = 'button';
    actionsEl.appendChild(cancelBtn);

    captureEl.appendChild(actionsEl);
    rowEl.appendChild(captureEl);

    // ── Keydown capture handler ───────────────────────────────────────────────

    function onKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        cleanup();
        cancelCapture(action);
        return;
      }

      if (MODIFIER_CODES.has(e.code)) return;

      var mods = TRACKED_MODS.filter(function(m) { return e.getModifierState(m); });

      if (mods.length === 0) {
        previewEl.className = 'bl-sc-capture__preview bl-sc-capture__preview--empty';
        previewEl.textContent = _t('shortcut_modal_no_modifier');
        warningEl.hidden = true;
        saveBtn.disabled = true;
        recordedChord = null;
        return;
      }

      recordedChord = { code: e.code, mods: mods };

      // Render keycaps in preview
      previewEl.className = 'bl-sc-capture__preview';
      previewEl.innerHTML = '';
      var keycaps = _buildKeycaps([recordedChord]);
      for (var ki = 0; ki < keycaps.length; ki++) {
        previewEl.appendChild(keycaps[ki]);
      }

      if (blsi.ShortcutLabel.isReserved(recordedChord)) {
        var reserved = blsi.ShortcutLabel.lookup(recordedChord);
        warningEl.textContent = (reserved && reserved.label)
          ? '⚠️ Reserved: ' + reserved.label + ' — saving anyway will override it.'
          : '⚠️ This chord is reserved by the browser.';
        warningEl.hidden = false;
      } else {
        warningEl.hidden = true;
      }

      saveBtn.disabled = false;
    }

    document.addEventListener('keydown', onKeyDown, true);

    function cleanup() {
      document.removeEventListener('keydown', onKeyDown, true);
    }

    // ── Save ─────────────────────────────────────────────────────────────────

    saveBtn.addEventListener('click', function() {
      if (!recordedChord) return;
      cleanup();
      var chord = recordedChord;
      onSave({ shortcuts: { [action.id]: { binding: [chord] } } });
      var patchedSettings = Object.assign({}, settings, {
        shortcuts: Object.assign({}, settings.shortcuts, {
          [action.id]: { binding: [chord] },
        }),
      });
      _buildNormalRow(rowEl, action, patchedSettings, onSave, activateCapture);
    });

    // ── Cancel ───────────────────────────────────────────────────────────────

    cancelBtn.addEventListener('click', function() {
      cleanup();
      cancelCapture(action);
    });
  }

  // ── Main renderBody ───────────────────────────────────────────────────────────

  /**
   * Render the Shortcuts sub-page body into containerEl.
   *
   * @param {HTMLElement} containerEl - The .bl-subpage__body div
   * @param {object}      settings    - Full settings object (read-only)
   * @param {function}    onSave      - Called with partial settings patch
   */
  function renderBody(containerEl, settings, onSave) {
    containerEl.innerHTML = '';

    var actions = blsi.Actions.list();

    var activeCaptureAction = null;
    var rowEls = {};

    function cancelCapture(action) {
      activeCaptureAction = null;
      var rowEl = rowEls[action.id];
      if (rowEl) _buildNormalRow(rowEl, action, settings, onSave, activateCapture);
    }

    function activateCapture(action) {
      if (activeCaptureAction && activeCaptureAction.id !== action.id) {
        var prev = activeCaptureAction;
        activeCaptureAction = null;
        var prevRowEl = rowEls[prev.id];
        if (prevRowEl) _buildNormalRow(prevRowEl, prev, settings, onSave, activateCapture);
      }
      activeCaptureAction = action;
      var rowEl = rowEls[action.id];
      if (rowEl) _buildCaptureRow(rowEl, action, settings, onSave, activateCapture, cancelCapture);
    }

    // ── Reset All header ──────────────────────────────────────────────────────

    var headerEl = document.createElement('div');
    headerEl.className = 'bl-sc-header';

    var resetAllBtn = document.createElement('button');
    resetAllBtn.className = 'bl-sc-reset-all-btn';
    resetAllBtn.textContent = _t('shortcut_reset_all');
    resetAllBtn.type = 'button';
    resetAllBtn.addEventListener('click', function() {
      activeCaptureAction = null;
      var allDefaults = blsi.Actions.defaultBindings();
      onSave({ shortcuts: allDefaults });
      var resetSettings = Object.assign({}, settings, { shortcuts: allDefaults });
      for (var ai = 0; ai < actions.length; ai++) {
        var a = actions[ai];
        var rowEl = rowEls[a.id];
        if (rowEl) _buildNormalRow(rowEl, a, resetSettings, onSave, activateCapture);
      }
    });
    headerEl.appendChild(resetAllBtn);
    containerEl.appendChild(headerEl);

    // ── Action card list ──────────────────────────────────────────────────────

    var listEl = document.createElement('div');
    listEl.className = 'bl-sc-list';

    for (var i = 0; i < actions.length; i++) {
      var action = actions[i];
      var rowEl = document.createElement('div');
      rowEl.className = 'bl-sc-row';
      rowEls[action.id] = rowEl;
      _buildNormalRow(rowEl, action, settings, onSave, activateCapture);
      listEl.appendChild(rowEl);
    }

    containerEl.appendChild(listEl);
  }

  return { renderBody };
})();

window.BlurrySitePopupRenderShortcuts = BlurrySitePopupRenderShortcuts;
