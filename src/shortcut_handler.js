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
 * Exposed as window.PrivacyBlurShortcuts (IIFE — no ES module syntax).
 */

const PrivacyBlurShortcuts = (() => {

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
      currentToastEl.parentNode.removeChild(currentToastEl);
      currentToastEl = null;
    }

    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    Object.assign(toast.style, {
      position:        "fixed",
      top:             "16px",
      right:           "16px",
      zIndex:          "2147483647",       // max possible z-index
      padding:         "8px 16px",
      background:      "rgba(30, 30, 30, 0.9)",
      color:           "#ffffff",
      fontFamily:      "system-ui, -apple-system, sans-serif",
      fontSize:        "13px",
      lineHeight:      "1.4",
      borderRadius:    "6px",
      boxShadow:       "0 4px 12px rgba(0,0,0,0.3)",
      pointerEvents:   "none",
      userSelect:      "none",
      transition:      "opacity 200ms ease",
      opacity:         "1"
    });

    toast.textContent = text;
    document.body.appendChild(toast);
    currentToastEl = toast;

    // Fade out and remove
    const removeTimer = setTimeout(() => {
      toast.style.opacity = "0";

      // Remove from DOM after the CSS transition completes
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

  /**
   * Checks whether a keyboard event matches the configured modifier key.
   * Supported values: "ctrl", "alt", "shift", "meta".
   * @param {KeyboardEvent} event
   * @param {string}        modifier - One of the above strings
   * @returns {boolean}
   */
  function modifierActive(event, modifier) {
    switch (normaliseKey(modifier)) {
      case "ctrl":  return event.ctrlKey  && !event.altKey && !event.metaKey;
      case "alt":   return event.altKey   && !event.ctrlKey && !event.metaKey;
      case "shift": return event.shiftKey && !event.ctrlKey && !event.metaKey;
      case "meta":  return event.metaKey  && !event.ctrlKey && !event.altKey;
      default:      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Attaches keyboard listeners and activates chord detection.
   * Safe to call multiple times — will detach the previous listener first.
   *
   * @param {object} settings  - Shortcut settings (flat or from storage_manager.js)
   *   @param {string} [settings.chordKey]       - First key (e.g. "k"), default "k"
   *   @param {string} [settings.chordSecond]    - Second key (e.g. "v"), default "v"
   *   @param {string} [settings.chordModifier]  - Modifier name ("ctrl"), default "ctrl"
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
    const chordKey1 = normaliseKey(cfg.chordKey      || "k");
    const chordKey2 = normaliseKey(cfg.chordSecond   || "v");
    const modifier  = normaliseKey(cfg.chordModifier || "ctrl");

    /**
     * Main keydown handler — attached to document at the capture phase so
     * it fires before any page scripts can intercept the event.
     */
    function onKeyDown(event) {
      const key = normaliseKey(event.key);

      // ---- Escape: exit picker mode only when picker is active ----
      if (key === "escape") {
        resetChordState();
        if (_isPickerActive && typeof callbacks.onExitPicker === "function") {
          _isPickerActive = false;
          callbacks.onExitPicker();
        }
        return;
      }

      // ---- Chord first key: modifier + chordKey1 ----
      if (!awaitingChordSecond && modifierActive(event, modifier) && key === chordKey1) {
        // Prevent browser from acting on Ctrl+K (address bar, link popup, etc.)
        event.preventDefault();

        awaitingChordSecond = true;
        lastChordKeyTime    = Date.now();

        // Notify optional listener so the content script can show a hint
        if (typeof callbacks.onChordStart === "function") {
          callbacks.onChordStart();
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
          key === chordKey2 &&
          !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
        ) {
          // Intentionally do NOT call event.preventDefault() here so that
          // legitimate typing (e.g., the user types "v" into a text field)
          // is not blocked. The chord only fires when we are already in
          // "awaiting second key" state, which itself required Ctrl+K.

          resetChordState();

          if (typeof callbacks.TOGGLE_BLUR_ALL === "function") {
            callbacks.TOGGLE_BLUR_ALL();
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
