/**
 * shortcut_reserved.js — Minimal browser-reserved shortcut warning list
 *
 * Provides a small, curated list of chords that most browsers or the host OS
 * will intercept before our shortcut handler runs, or that would break the
 * browser if we preventDefault() them. The capture modal shows a WARNING
 * when the user tries to bind one of these, but still allows the save —
 * users can override intentionally (VS Code / JetBrains philosophy).
 *
 * This is not a deny list. It is a hint list.
 *
 * Ctrl+Alt+* chords are a separate correctness concern (AltGr on European
 * layouts) and are rejected in the capture UI, not merely warned about.
 *
 * Exposed as blsi.ShortcutReserved (IIFE — no ES module syntax).
 * Must load after shortcut_label.js (needs blsi.ShortcutLabel.chordKey).
 */

const ShortcutReserved = (() => {
  'use strict';

  /**
   * Chord keys in the canonical format produced by ShortcutLabel.chordKey:
   *   "<sorted mods joined by '+'>|<code>"
   *
   * Each entry is tagged with a platform: 'any', 'mac', 'win'. At query
   * time we filter by the current platform so Mac users don't get warnings
   * about Alt+F4 and Windows users don't get warnings about Meta+KeyQ.
   */
  const RESERVED = Object.freeze([
    // Cross-platform browser shortcuts (Chrome, Firefox, Edge)
    { key: 'Control|KeyT',            label: 'New tab',            platform: 'any' },
    { key: 'Control|KeyN',            label: 'New window',         platform: 'any' },
    { key: 'Control|KeyW',            label: 'Close tab',          platform: 'any' },
    { key: 'Control|Tab',             label: 'Next tab',           platform: 'any' },
    { key: 'Control+Shift|KeyT',      label: 'Reopen closed tab',  platform: 'any' },
    { key: 'Control+Shift|KeyN',      label: 'Incognito window',   platform: 'any' },
    { key: '|F5',                     label: 'Reload',             platform: 'any' },
    { key: '|F11',                    label: 'Fullscreen',         platform: 'any' },
    { key: '|F12',                    label: 'DevTools',           platform: 'any' },

    // Windows / Linux
    { key: 'Alt|F4',                  label: 'Close window',       platform: 'win' },

    // macOS
    { key: 'Meta|KeyQ',               label: 'Quit application',   platform: 'mac' },
    { key: 'Meta|KeyW',               label: 'Close window',       platform: 'mac' },
    { key: 'Meta|KeyM',               label: 'Minimize window',    platform: 'mac' },
    { key: 'Meta|KeyH',               label: 'Hide application',   platform: 'mac' },
  ]);

  /**
   * Look up whether a single chord collides with a known browser-reserved
   * chord on the current platform.
   *
   * @param {{code: string, mods: Array<string>}} chord
   * @returns {{label: string} | null} Reserved chord metadata or null.
   */
  function lookup(chord) {
    if (!chord || !blsi.ShortcutLabel) return null;
    const key = blsi.ShortcutLabel.chordKey(chord);
    const isMac = blsi.ShortcutLabel.IS_MAC;
    for (const entry of RESERVED) {
      if (entry.key !== key) continue;
      if (entry.platform === 'any') return { label: entry.label };
      if (entry.platform === 'mac' && isMac) return { label: entry.label };
      if (entry.platform === 'win' && !isMac) return { label: entry.label };
    }
    return null;
  }

  /**
   * @param {{code: string, mods: Array<string>}} chord
   * @returns {boolean}
   */
  function isReserved(chord) {
    return lookup(chord) !== null;
  }

  return {
    RESERVED,
    lookup,
    isReserved,
  };
})();

blsi.ShortcutReserved = ShortcutReserved;
