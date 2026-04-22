/**
 * keyboard.js — Shortcuts sub-page body renderer
 *
 * Renders a list of all shortcut actions from blsi.Actions, each with
 * its current binding display, a Change button (activates inline capture
 * mode), and a Reset link.
 *
 * Inline capture mode:
 *   - listens for keydown on document (capture phase)
 *   - records chord = { code, mods } — requires at least one modifier
 *   - shows live chord preview via blsi.ShortcutLabel.chordLabel
 *   - warns if chord is in blsi.ShortcutLabel.RESERVED (does not block)
 *   - Save → calls onSave({ SHORTCUTS: { [action.id]: { binding: [chord] } } })
 *   - Cancel / Escape → restores normal row display
 *
 * Exposed as window.BlurrySitePopupRenderShortcuts.
 * Must load after action_registry.js and shortcut_label.js.
 */

const BlurrySitePopupRenderShortcuts = (() => {
  'use strict';

  /** i18n helper */
  function _t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  /**
   * Set of KeyboardEvent.code values that represent modifier-only keypresses.
   * These are skipped during capture — we wait for an actual key with a modifier.
   */
  const MODIFIER_CODES = new Set([
    'AltLeft', 'AltRight',
    'ControlLeft', 'ControlRight',
    'MetaLeft', 'MetaRight',
    'ShiftLeft', 'ShiftRight',
    'CapsLock', 'NumLock', 'ScrollLock',
    'OSLeft', 'OSRight',
  ]);

  /**
   * Ordered list of modifiers to check on a keydown event.
   * Matches the mods shape used in settings.SHORTCUTS.
   */
  const TRACKED_MODS = ['Alt', 'Control', 'Meta', 'Shift'];

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Get the current binding for an action from settings.
   * Falls back to action.defaultBinding if no override exists.
   *
   * @param {object} action - Action object from blsi.Actions.list()
   * @param {object} settings - Full settings object (read-only)
   * @returns {Array<{code: string, mods: Array<string>}>}
   */
  function _currentBinding(action, settings) {
    const entry = settings.shortcuts && settings.shortcuts[action.id];
    return entry ? entry.binding : action.defaultBinding;
  }

  /**
   * Render the binding display text for an action's current binding.
   * Returns empty string if binding is missing or empty.
   *
   * @param {Array<{code: string, mods: Array<string>}>} binding
   * @returns {string}
   */
  function _bindingText(binding) {
    if (!Array.isArray(binding) || binding.length === 0) return '';
    return blsi.ShortcutLabel.bindingLabel(binding);
  }

  // ── Row builders ───────────────────────────────────────────────────────────

  /**
   * Build the "normal" (non-capture) state for a row.
   * Appends elements into rowEl.
   *
   * @param {HTMLElement} rowEl - .bl-sc-row element
   * @param {object} action - Action from blsi.Actions
   * @param {object} settings - Full settings
   * @param {function} onSave - Callback for partial settings patch
   * @param {function} activateCapture - Called when "Change" is clicked
   */
  function _buildNormalRow(rowEl, action, settings, onSave, activateCapture) {
    rowEl.innerHTML = '';

    const topEl = document.createElement('div');
    topEl.className = 'bl-sc-row__top';

    // Label
    const labelEl = document.createElement('span');
    labelEl.className = 'bl-sc-row__label';
    labelEl.textContent = action.label;
    topEl.appendChild(labelEl);

    // Binding display
    const binding = _currentBinding(action, settings);
    const bindingText = _bindingText(binding);
    const bindingEl = document.createElement('span');
    if (bindingText) {
      bindingEl.className = 'bl-sc-row__binding';
      bindingEl.textContent = bindingText;
    } else {
      bindingEl.className = 'bl-sc-row__binding bl-sc-row__binding--none';
      bindingEl.textContent = _t('shortcut_modal_placeholder');
    }
    topEl.appendChild(bindingEl);

    // Change button
    const changeBtn = document.createElement('button');
    changeBtn.className = 'bl-sc-change-btn';
    changeBtn.textContent = _t('shortcut_customize');
    changeBtn.type = 'button';
    changeBtn.addEventListener('click', () => activateCapture(action));
    topEl.appendChild(changeBtn);

    rowEl.appendChild(topEl);

    // Reset link (below the top row)
    const resetBtn = document.createElement('button');
    resetBtn.className = 'bl-sc-reset-btn';
    resetBtn.textContent = _t('shortcut_reset');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => {
      onSave({
        shortcuts: {
          [action.id]: { binding: action.defaultBinding.map(function(c) {
            return { code: c.code, mods: Array.isArray(c.mods) ? [...c.mods] : [] };
          }) },
        },
      });
      // Update binding display inline by rebuilding the normal row with the default binding
      const patchedSettings = Object.assign({}, settings, {
        shortcuts: Object.assign({}, settings.shortcuts, {
          [action.id]: { binding: action.defaultBinding.map(function(c) {
            return { code: c.code, mods: Array.isArray(c.mods) ? [...c.mods] : [] };
          }) },
        }),
      });
      _buildNormalRow(rowEl, action, patchedSettings, onSave, activateCapture);
    });
    rowEl.appendChild(resetBtn);
  }

  /**
   * Build the "capture" (recording) state for a row.
   * Replaces row content with the capture UI and attaches a document keydown
   * listener. Cleans up listener on save / cancel / escape.
   *
   * @param {HTMLElement} rowEl - .bl-sc-row element
   * @param {object} action - Action from blsi.Actions
   * @param {object} settings - Full settings (read-only)
   * @param {function} onSave - Callback for partial settings patch
   * @param {function} activateCapture - Passed through for re-activation after save
   * @param {function} cancelCapture - Called to exit capture mode cleanly
   */
  function _buildCaptureRow(rowEl, action, settings, onSave, activateCapture, cancelCapture) {
    rowEl.innerHTML = '';

    // Keep a reference to the recorded chord
    let recordedChord = null;

    // ── Top row: label only (no binding display / buttons — replaced by capture UI) ──
    const topEl = document.createElement('div');
    topEl.className = 'bl-sc-row__top';

    const labelEl = document.createElement('span');
    labelEl.className = 'bl-sc-row__label';
    labelEl.textContent = action.label;
    topEl.appendChild(labelEl);

    rowEl.appendChild(topEl);

    // ── Capture UI block ──────────────────────────────────────────────────────
    const captureEl = document.createElement('div');
    captureEl.className = 'bl-sc-capture';

    // Prompt
    const promptEl = document.createElement('p');
    promptEl.className = 'bl-sc-capture__prompt';
    promptEl.textContent = _t('shortcut_modal_prompt');
    captureEl.appendChild(promptEl);

    // Preview
    const previewEl = document.createElement('div');
    previewEl.className = 'bl-sc-capture__preview bl-sc-capture__preview--empty';
    previewEl.textContent = _t('shortcut_modal_placeholder');
    captureEl.appendChild(previewEl);

    // Warning (hidden initially)
    const warningEl = document.createElement('div');
    warningEl.className = 'bl-sc-capture__warning';
    warningEl.hidden = true;
    captureEl.appendChild(warningEl);

    // Action buttons
    const actionsEl = document.createElement('div');
    actionsEl.className = 'bl-sc-capture__actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'bl-sc-save-btn';
    saveBtn.textContent = _t('modal_save');
    saveBtn.type = 'button';
    saveBtn.disabled = true;
    actionsEl.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'bl-sc-cancel-btn';
    cancelBtn.textContent = _t('modal_cancel');
    cancelBtn.type = 'button';
    actionsEl.appendChild(cancelBtn);

    captureEl.appendChild(actionsEl);
    rowEl.appendChild(captureEl);

    // ── Keydown capture handler ───────────────────────────────────────────────

    function onKeyDown(e) {
      // Always prevent default in capture mode so browser shortcuts don't fire
      e.preventDefault();
      e.stopPropagation();

      // Escape → cancel
      if (e.code === 'Escape') {
        cleanup();
        cancelCapture(action);
        return;
      }

      // Skip modifier-only keypresses — wait for a real key
      if (MODIFIER_CODES.has(e.code)) {
        return;
      }

      // Collect held modifiers
      const mods = TRACKED_MODS.filter(function(m) {
        return e.getModifierState(m);
      });

      // Require at least one modifier
      if (mods.length === 0) {
        previewEl.className = 'bl-sc-capture__preview bl-sc-capture__preview--empty';
        previewEl.textContent = _t('shortcut_modal_no_modifier');
        warningEl.hidden = true;
        saveBtn.disabled = true;
        recordedChord = null;
        return;
      }

      // Record chord
      recordedChord = { code: e.code, mods: mods };

      // Update preview
      previewEl.className = 'bl-sc-capture__preview';
      previewEl.textContent = blsi.ShortcutLabel.chordLabel(recordedChord);

      // Check reserved
      if (blsi.ShortcutLabel.isReserved(recordedChord)) {
        const reserved = blsi.ShortcutLabel.lookup(recordedChord);
        warningEl.textContent = (reserved && reserved.label)
          ? '\u26a0\ufe0f Reserved: ' + reserved.label + ' — saving anyway will override it.'
          : '\u26a0\ufe0f This chord is reserved by the browser.';
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
      const chord = recordedChord;
      onSave({
        shortcuts: {
          [action.id]: { binding: [chord] },
        },
      });
      // Rebuild normal row with the new binding reflected
      const patchedSettings = Object.assign({}, settings, {
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

  // ── Main renderBody ────────────────────────────────────────────────────────

  /**
   * Render the Shortcuts sub-page body into containerEl.
   *
   * @param {HTMLElement} containerEl - The .bl-subpage__body div
   * @param {object}      settings    - Full settings object (read-only)
   * @param {function}    onSave      - Called with partial settings patch; popup.js deep-merges & saves
   */
  function renderBody(containerEl, settings, onSave) {
    containerEl.innerHTML = '';

    const actions = blsi.Actions.list();

    // Track which row is currently in capture mode so we can cancel it
    // when the user clicks "Change" on a different row.
    let activeCaptureAction = null;
    // Map of action.id → rowEl for cancel lookup
    const rowEls = {};

    /**
     * Exit capture mode for the given action, restoring its normal display.
     * Called by cancelBtn click, Escape key, and when another row is activated.
     */
    function cancelCapture(action) {
      activeCaptureAction = null;
      const rowEl = rowEls[action.id];
      if (rowEl) {
        _buildNormalRow(rowEl, action, settings, onSave, activateCapture);
      }
    }

    /**
     * Activate capture mode for a given action.
     * If another row is in capture mode, cancel it first.
     */
    function activateCapture(action) {
      // Cancel any active capture first
      if (activeCaptureAction && activeCaptureAction.id !== action.id) {
        const prevAction = activeCaptureAction;
        activeCaptureAction = null;
        const prevRowEl = rowEls[prevAction.id];
        if (prevRowEl) {
          _buildNormalRow(prevRowEl, prevAction, settings, onSave, activateCapture);
        }
      }
      activeCaptureAction = action;
      const rowEl = rowEls[action.id];
      if (rowEl) {
        _buildCaptureRow(rowEl, action, settings, onSave, activateCapture, cancelCapture);
      }
    }

    // ── Build the list ──────────────────────────────────────────────────────

    const listEl = document.createElement('div');
    listEl.className = 'bl-sc-list';

    for (var i = 0; i < actions.length; i++) {
      const action = actions[i];
      const rowEl = document.createElement('div');
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
