/**
 * action_registry.js — Single source of truth for shortcut-driven actions
 *
 * Every shortcut-triggered action in the extension is declared here. Consumers
 * (shortcut_handler, content_script, background, popup) derive their wiring
 * from `Actions.list()` / `Actions.get(id)` / `Actions.defaultBindings()`.
 *
 * Adding a new action:
 *   1. Add an entry to ACTIONS below.
 *   2. Add a handler to content_script.shortcutActionMap (keyed by action.id).
 *   3. Optional: add a matching `commands` entry in manifest.json if you want
 *      the chord to also fire via chrome.commands.
 *
 * Exposed as blsi.Actions (IIFE — no ES module syntax).
 * Must load after constants.js (needs blsi namespace).
 */

const Actions = (() => {
  'use strict';

  /**
   * Canonical action registry. Keys are action ids (matches settings.SHORTCUTS
   * keys and the old MSG.COMMAND.* string values so callers can treat them
   * interchangeably). Every entry is frozen at module-load time.
   */
  const ACTIONS = Object.freeze({
    TOGGLE_BLUR_ALL: Object.freeze({
      id: 'TOGGLE_BLUR_ALL',
      label: 'Toggle blur on all page content',
      description: 'Enable or disable page-wide category blur on the current page',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyB', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType: 'TOGGLE_BLUR_ALL',
      chromeCommand: 'toggle-blur-all',
    }),

    TOGGLE_PICKER: Object.freeze({
      id: 'TOGGLE_PICKER',
      label: 'Toggle element picker',
      description: 'Enter or exit the click-to-blur element picker',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyP', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType: 'TOGGLE_PICKER',
      chromeCommand: 'toggle-picker',
    }),

    CLEAR_ALL: Object.freeze({
      id: 'CLEAR_ALL',
      label: 'Clear all blur on this page',
      description: 'Remove every blur and reset page-wide blur state',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyU', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType: 'CLEAR_ALL_BLUR',
      chromeCommand: 'clear-all-blur',
    }),
  });

  /** @returns {Array} Array of action objects in registration order. */
  function list() {
    return Object.values(ACTIONS);
  }

  /** @returns {object|undefined} The action object for `id`, or undefined. */
  function get(id) {
    return ACTIONS[id];
  }

  /** @returns {Array<string>} Array of action ids. */
  function ids() {
    return Object.keys(ACTIONS);
  }

  /**
   * Build a fresh, deeply-mutable copy of every action's default binding,
   * suitable for DEFAULT_SETTINGS.SHORTCUTS. The returned object is NOT
   * frozen — callers may mutate it safely.
   *
   * @returns {Object<string, {binding: Array<{code: string, mods: Array<string>}>}>}
   */
  function defaultBindings() {
    const out = {};
    for (const action of list()) {
      out[action.id] = {
        binding: action.defaultBinding.map((chord) => ({
          code: chord.code,
          mods: [...chord.mods],
        })),
      };
    }
    return out;
  }

  return {
    ACTIONS,
    list,
    get,
    ids,
    defaultBindings,
  };
})();

blsi.Actions = Actions;
