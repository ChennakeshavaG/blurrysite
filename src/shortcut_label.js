/**
 * shortcut_label.js — Platform-aware keyboard shortcut label rendering + reserved chord list
 *
 * Single source of truth for converting a stored chord ({code, mods}) into
 * a human-readable label. Used by:
 *   - popup settings rows
 *   - capture modal live preview
 *   - help overlay
 *   - toast messages (via Actions registry)
 *
 * Mac renders Unicode glyphs (⌘⇧⌥⌃) and concatenates without separators.
 * Windows/Linux spell out modifiers (Ctrl, Shift, Alt, Win) joined by `+`.
 *
 * Also exposes RESERVED / lookup / isReserved — a curated hint list of
 * browser-reserved chords shown as warnings in the capture UI (not a deny
 * list; users can override intentionally).
 *
 * Exposed as blsi.ShortcutLabel (IIFE — no ES module syntax).
 * Must load after constants.js (needs blsi namespace).
 */

const ShortcutLabel = (() => {
  'use strict';

  /**
   * Map of KeyboardEvent.code → human-readable label.
   * Any code not in this map falls back to the code string itself.
   */
  const CODE_TO_LABEL = Object.freeze({
    // Letters
    KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F',
    KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
    KeyM: 'M', KeyN: 'N', KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R',
    KeyS: 'S', KeyT: 'T', KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X',
    KeyY: 'Y', KeyZ: 'Z',

    // Digits
    Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
    Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',

    // Symbols
    Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/',
    Backquote: '`', Backslash: '\\',
    IntlBackslash: '\\', IntlRo: '\\', IntlYen: '¥',

    // Editing
    Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Space: 'Space',
    Backspace: '⌫', Delete: 'Del', Insert: 'Ins',

    // Navigation
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',

    // Function keys
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
    F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',

    // Numpad
    Numpad0: 'Num0', Numpad1: 'Num1', Numpad2: 'Num2', Numpad3: 'Num3',
    Numpad4: 'Num4', Numpad5: 'Num5', Numpad6: 'Num6', Numpad7: 'Num7',
    Numpad8: 'Num8', Numpad9: 'Num9',
    NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*',
    NumpadDivide: 'Num/', NumpadDecimal: 'Num.', NumpadEnter: 'Num⏎',
  });

  /** Platform detection — read once at module load. */
  const IS_MAC = (() => {
    try {
      return /Mac|iPhone|iPad|iPod/i.test(
        (navigator && (navigator.platform || navigator.userAgent)) || ''
      );
    } catch (_) {
      return false;
    }
  })();

  /** Mac glyphs for modifiers. */
  const MAC_MOD_GLYPH = Object.freeze({
    Control: '⌃',
    Alt: '⌥',
    Shift: '⇧',
    Meta: '⌘',
  });

  /** Windows/Linux spelled modifier names. */
  const WIN_MOD_NAME = Object.freeze({
    Control: 'Ctrl',
    Alt: 'Alt',
    Shift: 'Shift',
    Meta: 'Win',
  });

  /**
   * Render order for modifiers within a chord. Matches conventional display
   * on every platform: Ctrl/⌃ first, then Alt/⌥, then Shift/⇧, then Meta/⌘.
   * Mac convention is actually ⌃⌥⇧⌘ (Control, Option, Shift, Command).
   * Windows convention is Ctrl+Alt+Shift+Win.
   * We use the same order on both to keep the contract simple.
   */
  const MOD_ORDER = Object.freeze(['Control', 'Alt', 'Shift', 'Meta']);

  function sortModsForDisplay(mods) {
    const set = new Set(mods);
    return MOD_ORDER.filter((m) => set.has(m));
  }

  /**
   * Render a single modifier as a display string.
   * @param {string} mod One of "Alt", "Control", "Meta", "Shift".
   * @returns {string}
   */
  function modLabel(mod) {
    if (IS_MAC) return MAC_MOD_GLYPH[mod] || mod;
    return WIN_MOD_NAME[mod] || mod;
  }

  /**
   * Render a KeyboardEvent.code as a display string.
   * @param {string} code
   * @returns {string}
   */
  function codeLabel(code) {
    return CODE_TO_LABEL[code] || code;
  }

  /**
   * Render a single chord ({ code, mods }) as a display string.
   * Mac: "⌥⇧B". Windows/Linux: "Alt+Shift+B".
   * @param {{code: string, mods: Array<string>}} chord
   * @returns {string}
   */
  function chordLabel(chord) {
    if (!chord || typeof chord.code !== 'string') return '';
    const mods = Array.isArray(chord.mods) ? sortModsForDisplay(chord.mods) : [];
    const parts = mods.map(modLabel);
    parts.push(codeLabel(chord.code));
    return IS_MAC ? parts.join('') : parts.join('+');
  }

  /**
   * Render a full binding (array of chords) as a display string.
   * Single-chord: "Alt+Shift+B" / "⌥⇧B".
   * Sequence (phase 2): "Alt+G Alt+I" — chords joined by a space.
   * @param {Array<{code: string, mods: Array<string>}>} binding
   * @returns {string}
   */
  function bindingLabel(binding) {
    if (!Array.isArray(binding) || binding.length === 0) return '';
    return binding.map(chordLabel).join(' ');
  }

  /**
   * Canonical chord key for conflict detection. Two chords with the same
   * logical mods+code produce the same string regardless of mod order in
   * the input. Used as a Map key when scanning for duplicates.
   * Format: "Alt+Shift|KeyB" (sorted mods joined by '+', then '|', then code).
   *
   * @param {{code: string, mods: Array<string>}} chord
   * @returns {string}
   */
  function chordKey(chord) {
    if (!chord || typeof chord.code !== 'string') return '';
    const mods = Array.isArray(chord.mods) ? [...chord.mods].sort() : [];
    return mods.join('+') + '|' + chord.code;
  }

  /**
   * Canonical binding key — joins chord keys with a space. Used for
   * conflict detection across multi-chord sequences (phase 2).
   * @param {Array<{code: string, mods: Array<string>}>} binding
   * @returns {string}
   */
  function bindingKey(binding) {
    if (!Array.isArray(binding)) return '';
    return binding.map(chordKey).join(' ');
  }

  // ── Reserved chord list ──────────────────────────────────────────────────────
  // Chords that browsers or the host OS will intercept before the extension's
  // keydown handler runs. The capture UI shows a warning when the user tries
  // to bind one of these, but still allows the save.

  const RESERVED = Object.freeze([
    // Cross-platform browser shortcuts (Chrome, Firefox, Edge)
    { key: 'Control|KeyT',       label: 'New tab',           platform: 'any' },
    { key: 'Control|KeyN',       label: 'New window',        platform: 'any' },
    { key: 'Control|KeyW',       label: 'Close tab',         platform: 'any' },
    { key: 'Control|Tab',        label: 'Next tab',          platform: 'any' },
    { key: 'Control+Shift|KeyT', label: 'Reopen closed tab', platform: 'any' },
    { key: 'Control+Shift|KeyN', label: 'Incognito window',  platform: 'any' },
    { key: '|F5',                label: 'Reload',            platform: 'any' },
    { key: '|F11',               label: 'Fullscreen',        platform: 'any' },
    { key: '|F12',               label: 'DevTools',          platform: 'any' },
    // Windows / Linux
    { key: 'Alt|F4',             label: 'Close window',      platform: 'win' },
    // macOS
    { key: 'Meta|KeyQ',          label: 'Quit application',  platform: 'mac' },
    { key: 'Meta|KeyW',          label: 'Close window',      platform: 'mac' },
    { key: 'Meta|KeyM',          label: 'Minimize window',   platform: 'mac' },
    { key: 'Meta|KeyH',          label: 'Hide application',  platform: 'mac' },
  ]);

  function lookup(chord) {
    const key = chordKey(chord);
    if (!key) return null;
    for (const entry of RESERVED) {
      if (entry.key !== key) continue;
      if (entry.platform === 'any') return { label: entry.label };
      if (entry.platform === 'mac' && IS_MAC) return { label: entry.label };
      if (entry.platform === 'win' && !IS_MAC) return { label: entry.label };
    }
    return null;
  }

  function isReserved(chord) {
    return lookup(chord) !== null;
  }

  return {
    CODE_TO_LABEL,
    IS_MAC,
    modLabel,
    codeLabel,
    chordLabel,
    bindingLabel,
    chordKey,
    bindingKey,
    RESERVED,
    lookup,
    isReserved,
  };
})();

blsi.ShortcutLabel = ShortcutLabel;
