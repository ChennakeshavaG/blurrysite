/**
 * shortcut_handler.js — PrivacyBlur Keyboard Shortcut Handler
 *
 * Handles the chord shortcut sequence (e.g. Ctrl+K → V within 1 second)
 * which cannot be expressed through the Manifest Commands API.
 * The Commands API covers Alt+Shift+B/P/U; this module handles the chord.
 *
 * Chord detection logic:
 *  1. User presses [modifier]+[chordKey1]  (e.g. Ctrl+K)
 *     → record the key + timestamp, show a visual hint
 *     → preventDefault so the browser doesn't open its own Ctrl+K dialog
 *  2. If the user presses [chordKey2] (e.g. V) within 1000 ms of step 1:
 *     → fire callbacks.TOGGLE_BLUR_ALL
 *     → show a "Blur All triggered" toast for 1.5 s
 *     → reset chord state
 *  3. Any other key within 1 s, or timeout, resets chord state silently.
 *  4. Escape calls callbacks.onExitPicker only when picker is active.
 *
 * Key matching uses event.code (physical key, layout-independent) when
 * available, falling back to event.key for backwards compatibility with
 * settings saved before code values were captured.
 *
 * Exposed as window.PrivacyBlurShortcuts (IIFE — no ES module syntax).
 */

const PrivacyBlurShortcuts = (() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /** The keydown listener currently attached to document, or null */
  let activeListener = null;

  /** Timestamp (ms) of the last chord first-key press */
  let lastChordKeyTime = 0;

  /** Whether we are waiting for the chord's second key */
  let awaitingChordSecond = false;

  /** Timeout handle for clearing chord state after 1 second */
  let chordTimeoutId = null;

  /** Reference to the current toast element so we can remove it early */
  let currentToastEl = null;

  /** Whether the element picker is currently active (set by content_script) */
  let _isPickerActive = false;

  // -------------------------------------------------------------------------
  // Private: toast notification
  // -------------------------------------------------------------------------

  /**
   * Shows a brief, non-interactive toast notification at the top-right of
   * the viewport. Automatically disappears after `duration` milliseconds.
   * @param {string} text     - Message to display
   * @param {number} duration - Display duration in ms (default 1500)
   */
  function showToast(text, duration = 1500) {
    // Remove any existing toast immediately
    if (currentToastEl && currentToastEl.parentNode) {
      if (currentToastEl._removeTimer) {
        clearTimeout(currentToastEl._removeTimer);
      }
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

    // Fade out and remove
    const removeTimer = setTimeout(() => {
      toast.classList.add("pb-toast--exiting");

      // Remove from DOM after the CSS animation completes
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        if (currentToastEl === toast) {
          currentToastEl = null;
        }
      }, 250);
    }, duration);

    // Store on the element so we can cancel it if a new toast replaces this one
    toast._removeTimer = removeTimer;
  }

  // -------------------------------------------------------------------------
  // Private: chord state management
  // -------------------------------------------------------------------------

  /**
   * Resets all chord detection state.
   * Called when a chord times out or an unexpected key is pressed.
   */
  function resetChordState() {
    awaitingChordSecond = false;
    lastChordKeyTime    = 0;

    if (chordTimeoutId !== null) {
      clearTimeout(chordTimeoutId);
      chordTimeoutId = null;
    }
  }

  /**
   * Normalises a key string to lowercase for case-insensitive comparison.
   * @param {string} key
   * @returns {string}
   */
  function normaliseKey(key) {
    return (key || "").toLowerCase();
  }

  // -------------------------------------------------------------------------
  // Private: KeyboardEvent helpers (W3C UI Events spec-compliant)
  // -------------------------------------------------------------------------

  /**
   * Checks whether a keyboard event matches the configured modifier key.
   * Uses the browser's normalised modifier boolean properties:
   *   ctrlKey  — Control on all platforms
   *   altKey   — Alt (Win/Linux) / Option (Mac)
   *   shiftKey — Shift on all platforms
   *   metaKey  — Meta/Win (Win/Linux) / Command (Mac)
   *
   * Each check is exclusive — the named modifier must be active and the
   * other non-Shift modifiers must NOT be active (Shift is allowed to
   * co-exist since it only changes key casing, not intent).
   *
   * @param {KeyboardEvent} event
   * @param {string}        modifier - "ctrl", "alt", "shift", or "meta"
   * @returns {boolean}
   */
  function modifierActive(event, modifier) {
    switch (modifier) {
      case "ctrl":  return event.ctrlKey  && !event.altKey && !event.metaKey;
      case "alt":   return event.altKey   && !event.ctrlKey && !event.metaKey;
      case "shift": return event.shiftKey && !event.ctrlKey && !event.metaKey;
      case "meta":  return event.metaKey  && !event.ctrlKey && !event.altKey;
      default:      return false;
    }
  }

  /**
   * Checks whether a keyboard event matches a configured chord key.
   *
   * Prefers event.code (physical key position, layout-independent) when a
   * code value is stored. Falls back to event.key (logical key) for
   * backwards compatibility with settings saved before code capture.
   *
   * @param {KeyboardEvent} event
   * @param {string}        keyValue  - Stored event.key value (lowercase), may be empty
   * @param {string|null}   codeValue - Stored event.code value, or null
   * @returns {boolean}
   */
  function matchesKey(event, keyValue, codeValue) {
    if (codeValue) {
      return event.code === codeValue;
    }
    if (keyValue) {
      return normaliseKey(event.key) === keyValue;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Attaches keyboard listeners and activates chord detection.
   * Safe to call multiple times — will detach the previous listener first.
   *
   * This function does NOT apply defaults — callers must pass complete
   * settings. Defaults are centralised in constants.js and applied at
   * the storage/settings layer.
   *
   * @param {object} settings  - Shortcut settings (flat shape from content_script)
   *   @param {string} [settings.chordKey]       - First key display value (e.g. "k")
   *   @param {string} [settings.chordSecond]    - Second key display value (e.g. "v")
   *   @param {string} [settings.chordCode1]     - First key event.code (e.g. "KeyK")
   *   @param {string} [settings.chordCode2]     - Second key event.code (e.g. "KeyV")
   *   @param {string} [settings.chordModifier]  - Modifier name ("ctrl"/"alt"/"shift"/"meta")
   *
   * @param {object} callbacks - Functions fired on shortcut events
   *   @param {Function} [callbacks.TOGGLE_BLUR_ALL] - Chord completed → blur all
   *   @param {Function} [callbacks.onExitPicker]    - Escape pressed when picker active
   *   @param {Function} [callbacks.onChordStart]    - First key detected (optional)
   */
  function init(settings, callbacks) {
    // Remove any previously installed listener first
    destroy();

    const cfg = settings || {};
    const cbs = callbacks || {};
    const chordKey1  = normaliseKey(cfg.chordKey    || "");
    const chordKey2  = normaliseKey(cfg.chordSecond || "");
    const chordCode1 = cfg.chordCode1 || null;
    const chordCode2 = cfg.chordCode2 || null;
    const modifier   = normaliseKey(cfg.chordModifier || "");

    /**
     * Main keydown handler — attached to document at the capture phase so
     * it fires before any page scripts can intercept the event.
     */
    function onKeyDown(event) {
      // ---- Early exits for non-actionable events (W3C UI Events spec) ----

      // Repeated keydown from holding a key — ignore to prevent spamming.
      if (event.repeat) return;

      // IME composition in progress (CJK input, accent sequences, etc.).
      if (event.isComposing) return;

      // Dead key (accent/diacritic composition on European layouts).
      if (event.key === "Dead") return;

      // AltGr on European Windows keyboards sends ctrlKey + altKey
      // simultaneously. Detect via getModifierState to avoid false matches.
      if (event.getModifierState && event.getModifierState("AltGraph")) return;

      const key = normaliseKey(event.key);

      // ---- Escape: exit picker mode only when picker is active ----
      if (key === "escape") {
        resetChordState();
        if (_isPickerActive && typeof cbs.onExitPicker === "function") {
          _isPickerActive = false;
          cbs.onExitPicker();
        }
        return;
      }

      // ---- Chord first key: modifier + chordKey1 ----
      if (!awaitingChordSecond && modifierActive(event, modifier) && matchesKey(event, chordKey1, chordCode1)) {
        // Prevent browser from acting on Ctrl+K (address bar, link popup, etc.)
        event.preventDefault();

        awaitingChordSecond = true;
        lastChordKeyTime    = Date.now();

        // Notify optional listener so the content script can show a hint
        if (typeof cbs.onChordStart === "function") {
          cbs.onChordStart();
        }

        // Auto-reset after 1 second if the user does not press chordKey2
        chordTimeoutId = setTimeout(() => {
          resetChordState();
        }, 1000);

        return;
      }

      // ---- Chord second key: chordKey2 within 1 second (no modifier held) ----
      if (awaitingChordSecond) {
        const elapsed = Date.now() - lastChordKeyTime;

        if (
          elapsed <= 1000 &&
          matchesKey(event, chordKey2, chordCode2) &&
          !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
        ) {
          // Intentionally do NOT call event.preventDefault() here so that
          // legitimate typing (e.g., the user types "v" into a text field)
          // is not blocked. The chord only fires when we are already in
          // "awaiting second key" state, which itself required Ctrl+K.

          resetChordState();

          if (typeof cbs.TOGGLE_BLUR_ALL === "function") {
            cbs.TOGGLE_BLUR_ALL();
          }

          showToast("PrivacyBlur: Blur All triggered", 1500);
          return;
        }

        // Wrong key or timeout expired — reset and let the key propagate normally
        resetChordState();
        return;
      }
    }

    // Attach at capture phase (true) so we intercept before page scripts
    document.addEventListener("keydown", onKeyDown, true);

    // Keep a reference for cleanup
    activeListener = onKeyDown;
  }

  /**
   * Removes the keydown listener and resets all chord state.
   * Call this when the content script is torn down or the extension is disabled.
   */
  function destroy() {
    if (activeListener) {
      document.removeEventListener("keydown", activeListener, true);
      activeListener = null;
    }

    resetChordState();

    // Remove any visible toast
    if (currentToastEl && currentToastEl.parentNode) {
      if (currentToastEl._removeTimer) {
        clearTimeout(currentToastEl._removeTimer);
      }
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
    // Exposed for tests / popup UI to trigger a toast manually
    showToast,
    // Exposed for content_script to notify shortcut handler that picker is active
    _setPickerActive(v) { _isPickerActive = !!v; }
  };
})();

// Attach to window so content_script.js can access it
window.PrivacyBlurShortcuts = PrivacyBlurShortcuts;
