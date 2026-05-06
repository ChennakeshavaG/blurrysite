/**
 * shortcut_handler.js — Blurry Site Keyboard Shortcut Handler (v2)
 *
 * Matches user-configurable shortcuts against KeyboardEvent and fires action
 * callbacks. All action metadata (labels, default bindings, chrome.commands
 * ids) lives in src/action_registry.js — this module is a pure matcher.
 * Toast rendering is delegated to blsi.Toast.
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
 *     First match wins, preventDefault + fire callback + show toast.
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

  const _log = blsi.Logger ? blsi.Logger.scope('shortcuts') : null;

  // ── Internal state ─────────────────────────────────────────────────────────

  /** The keydown/blur listeners currently attached, or null. */
  let activeKeydownListener = null;
  let activeBlurListener    = null;

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
        if (blsi.Toast) blsi.Toast.show(toastText, 3000);
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

    if (blsi.Toast && typeof blsi.Toast.clearIfTransient === 'function') {
      blsi.Toast.clearIfTransient();
    }
  }

  return {
    init,
    destroy,
    _setPickerActive(v) { _isPickerActive = !!v; },
    // Exposed for content_script dedup between JS matcher and chrome.commands.
    _getFireToken() { return FIRE_TOKEN; },
  };
})();

blsi.Shortcuts = Shortcuts;
