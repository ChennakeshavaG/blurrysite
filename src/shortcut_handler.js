/**
 * shortcut_handler.js — Blurry Site Keyboard Shortcut Handler (v2)
 *
 * Matches user-configurable shortcuts against KeyboardEvent and fires action
 * callbacks. All action metadata (labels, default bindings, chrome.commands
 * ids) lives in src/action_registry.js — this module is a pure matcher +
 * toast renderer.
 *
 * Binding shape (enforced by validateSettings):
 *   { binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] }
 *
 * Matching logic:
 *  1. Early-return on repeat, isComposing, Dead/Process/Unidentified, AltGr,
 *     synthetic events, and pure-modifier keydowns (wait for the primary key).
 *  2. Read modifier state from event.altKey / ctrlKey / metaKey / shiftKey —
 *     NOT from a held-keys Set. MDN says these are the authoritative source.
 *     This folds AltLeft/AltRight together automatically, as users expect.
 *  3. For each registered binding, compare {code, mods} against the event.
 *     First match wins, preventDefault + fire callback + showToast.
 *  4. Escape is special-cased: when picker is active, fire onExitPicker and
 *     do not dispatch to any bound shortcut.
 *
 * Phase 2 note: `binding` is an array to accommodate sequence chords (g i).
 * Phase 1 only matches when `binding.length === 1`. Longer bindings are
 * silently skipped by the matcher (logger warns).
 *
 * Exposed as blsi.Shortcuts (IIFE — no ES module syntax).
 */

const Shortcuts = (() => {
  'use strict';

  const _CSS = (blsi.css) || {};
  const _log = blsi.Logger ? blsi.Logger.scope('shortcuts') : null;

  // ── Internal state ─────────────────────────────────────────────────────────

  /** The keydown/blur listeners currently attached, or null. */
  let activeKeydownListener = null;
  let activeBlurListener    = null;

  /** Reference to the current toast element so we can remove it early. */
  let currentToastEl = null;

  /** Whether the element picker is currently active (set by content_script). */
  let _isPickerActive = false;

  /**
   * Registered single-chord shortcuts. Array of:
   *   { actionId, code, mods: string[] (sorted), bindingKey: string }
   * Multi-chord (sequence) bindings are skipped in phase 1.
   */
  let registeredShortcuts = [];

  /** Registered callbacks: { ACTION_ID: fn, onExitPicker: fn }. */
  let registeredCallbacks = {};

  /**
   * Monotonic fire token — records the last time each action fired. Used by
   * content_script.handleMessage to dedup the JS path against chrome.commands
   * relays. The JS matcher is canonical; chrome.commands is the fallback for
   * users who customize via chrome://extensions/shortcuts, and duplicates
   * within a short window are dropped by the message handler.
   */
  const FIRE_TOKEN = globalThis.__blsiShortcutFire = globalThis.__blsiShortcutFire || {};

  // ── Modifier extraction ────────────────────────────────────────────────────

  /** The subset of mods to consider. Always sorted alphabetically. */
  const _MOD_NAMES = ['Alt', 'Control', 'Meta', 'Shift'];

  /**
   * Read the normalized modifier set for an event. Returns a sorted array
   * from {"Alt","Control","Meta","Shift"}. Left/right is folded away.
   */
  function modsFromEvent(event) {
    const mods = [];
    if (event.altKey)   mods.push('Alt');
    if (event.ctrlKey)  mods.push('Control');
    if (event.metaKey)  mods.push('Meta');
    if (event.shiftKey) mods.push('Shift');
    return mods; // Already alphabetical because the pushes are in that order.
  }

  function sameModSet(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ── Toast notification ─────────────────────────────────────────────────────

  function _dismissToast(toast) {
    if (toast._removeTimer) clearTimeout(toast._removeTimer);
    toast.classList.add(_CSS.toast_exiting || 'bl-si-toast--exiting');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (currentToastEl === toast) currentToastEl = null;
    }, 250);
  }

  /**
   * @param {string}   text
   * @param {number}   [duration=15000]
   * @param {Array<{label:string, onClick:function, variant?:string}>} [actions]
   *   Optional action buttons shown in a second row below the message.
   *   variant 'warn' renders with amber styling.
   * @param {{persistent?:boolean}} [opts]
   *   persistent: skip auto-dismiss timer; block replacement by non-persistent toasts.
   */
  function showToast(text, duration, actions, opts) {
    if (duration === undefined) duration = 15000;
    if (currentToastEl && currentToastEl.parentNode) {
      if (currentToastEl._persistent) return;
      if (currentToastEl._removeTimer) clearTimeout(currentToastEl._removeTimer);
      currentToastEl.parentNode.removeChild(currentToastEl);
      currentToastEl = null;
    }

    const toast = document.createElement('div');
    toast.className = _CSS.toast || 'bl-si-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    // ── Top row: logo + message + close ────────────────────────────────────
    const topRow = document.createElement('div');
    topRow.className = 'bl-si-toast__top';

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const logo = document.createElement('img');
      logo.src = chrome.runtime.getURL('icons/icon32.png');
      logo.className = 'bl-si-toast__logo';
      logo.setAttribute('aria-hidden', 'true');
      logo.alt = '';
      topRow.appendChild(logo);
    }

    const msgSpan = document.createElement('span');
    msgSpan.className = _CSS.toast_message || 'bl-si-toast__message';
    msgSpan.textContent = text;
    topRow.appendChild(msgSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bl-si-toast__close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label',
      chrome.i18n.getMessage('aria_toast_dismiss') || 'Dismiss');
    closeBtn.addEventListener('click', () => _dismissToast(toast));
    topRow.appendChild(closeBtn);

    toast.appendChild(topRow);

    // ── Actions row (optional) ──────────────────────────────────────────────
    const actionList = Array.isArray(actions) ? actions : [];
    if (actionList.length > 0) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'bl-si-toast__actions';
      actionList.forEach(function(action) {
        if (!action || !action.label || typeof action.onClick !== 'function') return;
        const btn = document.createElement('button');
        btn.className = 'bl-si-toast__action' +
          (action.variant === 'warn' ? ' bl-si-toast__action--warn' : '');
        btn.textContent = action.label;
        if (action.tooltip) btn.title = action.tooltip;
        btn.addEventListener('click', function() {
          _dismissToast(toast);
          action.onClick();
        });
        actionsRow.appendChild(btn);
      });
      toast.appendChild(actionsRow);
    }

    document.body.appendChild(toast);
    currentToastEl = toast;

    if (opts && opts.persistent) {
      toast._persistent = true;
    } else {
      toast._removeTimer = setTimeout(() => _dismissToast(toast), duration);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Attach keyboard listeners and register shortcuts.
   * Safe to call multiple times — detaches previous listeners first.
   *
   * @param {object} shortcuts - { ACTION_ID: { binding: [{code, mods}, ...] } }
   *   Shape is enforced by constants.validateSettings. Multi-chord (length > 1)
   *   bindings are skipped in phase 1.
   * @param {object} callbacks - { ACTION_ID: fn, onExitPicker: fn }
   */
  function init(shortcuts, callbacks) {
    destroy();

    registeredCallbacks = callbacks || {};
    registeredShortcuts = [];

    if (shortcuts && typeof shortcuts === 'object') {
      for (const [actionId, entry] of Object.entries(shortcuts)) {
        if (!entry || !Array.isArray(entry.binding) || entry.binding.length === 0) continue;
        if (entry.binding.length > 1) {
          if (_log) _log.warn('multi-chord binding skipped (phase 2 feature)', { actionId });
          continue;
        }
        const chord = entry.binding[0];
        if (!chord || typeof chord.code !== 'string' || !Array.isArray(chord.mods)) continue;
        const mods = [...chord.mods].sort();
        registeredShortcuts.push({
          actionId,
          code: chord.code,
          mods,
          bindingKey: mods.join('+') + '|' + chord.code,
        });
      }
    }

    if (_log) _log.flow('init', { count: registeredShortcuts.length });

    function onKeyDown(event) {
      // ── Early-return guards (W3C UI Events spec + empirical) ──────────────
      if (event.repeat) return;
      if (event.isComposing) return;
      if (event.key === 'Dead') return;
      if (event.key === 'Process') return;
      if (event.key === 'Unidentified') return;
      if (event.getModifierState && event.getModifierState('AltGraph')) return;

      // ── Escape special case: picker exit ─────────────────────────────────
      if (event.code === 'Escape') {
        if (_isPickerActive && typeof registeredCallbacks.onExitPicker === 'function') {
          _isPickerActive = false;
          registeredCallbacks.onExitPicker();
        }
        return;
      }

      // ── Skip pure modifier keydowns ──────────────────────────────────────
      // Wait for the user to press a non-modifier key before matching.
      if (blsi.modifier_codes && blsi.modifier_codes.has(event.code)) return;

      // ── Match against registered bindings ────────────────────────────────
      const eventMods = modsFromEvent(event);
      for (let i = 0; i < registeredShortcuts.length; i++) {
        const sc = registeredShortcuts[i];
        if (sc.code !== event.code) continue;
        if (!sameModSet(sc.mods, eventMods)) continue;

        // Match: fire + preventDefault + toast. The fire token for dedup
        // against chrome.commands relays is stamped inside handleMessage on
        // entry, NOT here — otherwise this path would stamp the token BEFORE
        // the callback re-enters handleMessage, and handleMessage would see
        // its own fresh stamp and drop the call.
        event.preventDefault();

        if (_log) _log.flow('fire', { actionId: sc.actionId, chord: sc.bindingKey });

        const cb = registeredCallbacks[sc.actionId];
        if (typeof cb === 'function') cb();

        const action = (blsi.Actions && blsi.Actions.get) ? blsi.Actions.get(sc.actionId) : null;
        const toastText = 'Blurry Site — ' + (action ? action.label : sc.actionId);
        showToast(toastText);
        return;
      }
    }

    function onWindowBlur() {
      // No held-key state any more, but keep the hook so future sequence
      // support can clear in-progress sequence state here.
    }

    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onWindowBlur);

    activeKeydownListener = onKeyDown;
    activeBlurListener    = onWindowBlur;
  }

  /** Removes all listeners and resets state. */
  function destroy() {
    if (activeKeydownListener) {
      document.removeEventListener('keydown', activeKeydownListener, true);
      activeKeydownListener = null;
    }
    if (activeBlurListener) {
      window.removeEventListener('blur', activeBlurListener);
      activeBlurListener = null;
    }

    registeredShortcuts = [];
    registeredCallbacks = {};

    if (currentToastEl && currentToastEl.parentNode) {
      if (currentToastEl._removeTimer) clearTimeout(currentToastEl._removeTimer);
      currentToastEl.parentNode.removeChild(currentToastEl);
      currentToastEl = null;
    }
  }

  return {
    init,
    destroy,
    showToast,
    _setPickerActive(v) { _isPickerActive = !!v; },
    // Exposed for content_script dedup between JS matcher and chrome.commands.
    _getFireToken() { return FIRE_TOKEN; },
  };
})();

blsi.Shortcuts = Shortcuts;
