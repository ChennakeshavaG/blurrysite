/**
 * shortcut_handler.js — PrivacyBlur Keyboard Shortcut Handler
 *
 * Handles user-configurable shortcuts with a primary modifier + N additional
 * keys pressed simultaneously. Shortcuts are dynamically inferred from the
 * settings object — no hardcoded shortcuts exist in this module.
 *
 * Each shortcut is defined as:
 *   { primaryModifier: 'AltLeft', keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'b', code: 'KeyB' }] }
 *
 * Detection logic:
 *  1. Track all currently held keys via keydown/keyup + a Set<code>.
 *  2. On every keydown, check each registered shortcut:
 *     a. Is the primaryModifier held? (via heldKeys Set + event modifier properties)
 *     b. Are ALL keys in the shortcut's keys[] array held?
 *     c. If both → fire the action callback, preventDefault, show toast.
 *  3. Escape always calls onExitPicker when picker is active.
 *  4. Window blur clears the heldKeys Set (prevents phantom held keys).
 *
 * Exposed as window.PrivacyBlurShortcuts (IIFE — no ES module syntax).
 */

const PrivacyBlurShortcuts = (() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /** Set of event.code values currently held down. */
  let heldKeys = new Set();

  /** The keydown/keyup/blur listeners currently attached, or null. */
  let activeKeydownListener = null;
  let activeKeyupListener   = null;
  let activeBlurListener    = null;

  /** Reference to the current toast element so we can remove it early. */
  let currentToastEl = null;

  /** Whether the element picker is currently active (set by content_script). */
  let _isPickerActive = false;

  /** Registered shortcuts: array of { actionName, primaryModifier, keys, parsedKeys }. */
  let registeredShortcuts = [];

  /** Registered callbacks: { actionName: fn, onExitPicker: fn }. */
  let registeredCallbacks = {};

  // -------------------------------------------------------------------------
  // Action labels for toast messages
  // -------------------------------------------------------------------------

  const ACTION_LABELS = {
    TOGGLE_BLUR_ALL: 'Blur All triggered',
    TOGGLE_PICKER:   'Picker toggled',
    CLEAR_ALL:       'Page cleared',
  };

  // -------------------------------------------------------------------------
  // Modifier detection helpers
  // -------------------------------------------------------------------------

  /** Modifier codes that map to event boolean properties. */
  const MODIFIER_PROPERTY_MAP = {
    ShiftLeft:    'shiftKey',
    ShiftRight:   'shiftKey',
    ControlLeft:  'ctrlKey',
    ControlRight: 'ctrlKey',
    AltLeft:      'altKey',
    AltRight:     'altKey',
    MetaLeft:     'metaKey',
    MetaRight:    'metaKey',
  };

  /** Set of all modifier key codes (used to distinguish modifiers from regular keys). */
  const MODIFIER_CODES = new Set([
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
    'CapsLock', 'Fn',
  ]);

  /**
   * Checks whether the primary modifier is currently held.
   * Uses both the event's modifier boolean (is Shift/Ctrl/Alt/Meta active?)
   * and the heldKeys Set (is the SPECIFIC left/right key held?).
   */
  function isPrimaryModifierHeld(event, modifierCode) {
    // CapsLock: use getModifierState (toggle-based)
    if (modifierCode === 'CapsLock') {
      return event.getModifierState && event.getModifierState('CapsLock');
    }

    // Standard modifiers: check the event boolean first (is the class active?)
    const prop = MODIFIER_PROPERTY_MAP[modifierCode];
    if (!prop || !event[prop]) return false;

    // Then check the specific side via heldKeys
    return heldKeys.has(modifierCode);
  }

  // -------------------------------------------------------------------------
  // Toast notification (kept from previous implementation)
  // -------------------------------------------------------------------------

  function showToast(text, duration) {
    if (duration === undefined) duration = 1500;
    if (currentToastEl && currentToastEl.parentNode) {
      if (currentToastEl._removeTimer) clearTimeout(currentToastEl._removeTimer);
      currentToastEl.parentNode.removeChild(currentToastEl);
      currentToastEl = null;
    }

    const toast = document.createElement("div");
    toast.className = "pb-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const msgSpan = document.createElement("span");
    msgSpan.className = "pb-toast__message";
    msgSpan.textContent = text;
    toast.appendChild(msgSpan);

    document.body.appendChild(toast);
    currentToastEl = toast;

    const removeTimer = setTimeout(() => {
      toast.classList.add("pb-toast--exiting");
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        if (currentToastEl === toast) currentToastEl = null;
      }, 250);
    }, duration);

    toast._removeTimer = removeTimer;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Attaches keyboard listeners and registers shortcuts.
   * Safe to call multiple times — detaches previous listeners first.
   *
   * @param {object} shortcuts  - { ACTION_NAME: { primaryModifier, keys: [{ key, code }] } }
   *   Dynamically inferred from settings. No hardcoded actions.
   *
   * @param {object} callbacks  - { ACTION_NAME: fn, onExitPicker: fn }
   *   Each key matches an action name from shortcuts. onExitPicker fires on Escape.
   */
  function init(shortcuts, callbacks) {
    destroy();

    registeredCallbacks = callbacks || {};

    // Parse shortcuts into a flat lookup array for fast iteration on keydown.
    registeredShortcuts = [];
    if (shortcuts && typeof shortcuts === 'object') {
      for (const [actionName, binding] of Object.entries(shortcuts)) {
        if (!binding || !binding.primaryModifier || !Array.isArray(binding.keys)) continue;
        registeredShortcuts.push({
          actionName,
          primaryModifier: binding.primaryModifier,
          // Pre-extract codes for O(1) Set lookups during matching.
          keyCodes: binding.keys.map(k => k.code).filter(Boolean),
        });
      }
    }

    // ── Keydown handler ─────────────────────────────────────────────────────
    function onKeyDown(event) {
      // Early exits (W3C UI Events spec)
      if (event.repeat) return;
      if (event.isComposing) return;
      if (event.key === 'Dead') return;
      if (event.getModifierState && event.getModifierState('AltGraph')) return;

      // Track this key as held
      if (event.code) heldKeys.add(event.code);

      // Escape: exit picker (always, regardless of shortcut config)
      if (event.key === 'Escape') {
        if (_isPickerActive && typeof registeredCallbacks.onExitPicker === 'function') {
          _isPickerActive = false;
          registeredCallbacks.onExitPicker();
        }
        return;
      }

      // Check each registered shortcut
      for (let i = 0; i < registeredShortcuts.length; i++) {
        const sc = registeredShortcuts[i];

        // Is the primary modifier held?
        if (!isPrimaryModifierHeld(event, sc.primaryModifier)) continue;

        // Are ALL required keys held?
        let allHeld = true;
        for (let j = 0; j < sc.keyCodes.length; j++) {
          if (!heldKeys.has(sc.keyCodes[j])) {
            allHeld = false;
            break;
          }
        }
        if (!allHeld) continue;

        // Match found — fire action
        event.preventDefault();

        if (typeof registeredCallbacks[sc.actionName] === 'function') {
          registeredCallbacks[sc.actionName]();
        }

        const label = ACTION_LABELS[sc.actionName] || sc.actionName;
        showToast('PrivacyBlur: ' + label, 1500);
        return;
      }
    }

    // ── Keyup handler ─────────────────────────────────────────────────────
    function onKeyUp(event) {
      if (event.code) heldKeys.delete(event.code);
    }

    // ── Window blur handler ───────────────────────────────────────────────
    function onWindowBlur() {
      heldKeys.clear();
    }

    // Attach at capture phase so we intercept before page scripts
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);

    activeKeydownListener = onKeyDown;
    activeKeyupListener   = onKeyUp;
    activeBlurListener    = onWindowBlur;
  }

  /**
   * Removes all listeners and resets state.
   */
  function destroy() {
    if (activeKeydownListener) {
      document.removeEventListener('keydown', activeKeydownListener, true);
      activeKeydownListener = null;
    }
    if (activeKeyupListener) {
      document.removeEventListener('keyup', activeKeyupListener, true);
      activeKeyupListener = null;
    }
    if (activeBlurListener) {
      window.removeEventListener('blur', activeBlurListener);
      activeBlurListener = null;
    }

    heldKeys.clear();
    registeredShortcuts = [];
    registeredCallbacks = {};

    if (currentToastEl && currentToastEl.parentNode) {
      if (currentToastEl._removeTimer) clearTimeout(currentToastEl._removeTimer);
      currentToastEl.parentNode.removeChild(currentToastEl);
      currentToastEl = null;
    }
  }

  // -------------------------------------------------------------------------
  // Expose public API
  // -------------------------------------------------------------------------
  return {
    init,
    destroy,
    showToast,
    _setPickerActive(v) { _isPickerActive = !!v; },
  };
})();

window.PrivacyBlurShortcuts = PrivacyBlurShortcuts;
