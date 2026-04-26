/**
 * action_registry.js — Single source of truth for shortcut-driven actions.
 *
 * Every shortcut-triggered action is declared here. Action IDs use kebab-case
 * to match manifest.json `commands` names exactly (no separate mapping needed).
 *
 * Adding a new action:
 *   1. Add an entry to ACTIONS below.
 *   2. Add a handler to content_script.shortcut_action_map keyed by action.id.
 *   3. Optional: add a matching `commands` entry in manifest.json if you want
 *      the chord to also fire via chrome.commands.
 *
 * Exposed as blsi.Actions (IIFE — no ES module syntax).
 * Must load after constants.js (needs blsi namespace).
 */

const Actions = (() => {
  'use strict';

  const ACTIONS = Object.freeze({
    'toggle-blur-all': Object.freeze({
      id:             'toggle-blur-all',
      label:          'Toggle blur on all page content',
      description:    'Enable or disable page-wide category blur on the current page',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyB', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType:    'TOGGLE_BLUR_ALL',
      chromeCommand:  'toggle-blur-all',
    }),

    'toggle-picker': Object.freeze({
      id:             'toggle-picker',
      label:          'Toggle element picker',
      description:    'Enter or exit the click-to-blur element picker',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyP', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType:    'TOGGLE_PICKER',
      chromeCommand:  'toggle-picker',
    }),

    'clear-all': Object.freeze({
      id:             'clear-all',
      label:          'Clear all blur on this page',
      description:    'Remove every blur and reset page-wide blur state',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyU', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType:    'CLEAR_ALL_BLUR',
      chromeCommand:  'clear-all-blur',
    }),

    'screenshot': Object.freeze({
      id:             'screenshot',
      label:          'Take screenshot',
      description:    'Capture viewport screenshot with blur applied',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyS', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType:    'CAPTURE_VIEWPORT',
      chromeCommand:  null,
    }),

    'blur-selection': Object.freeze({
      id:             'blur-selection',
      label:          'Blur selected text',
      description:    'Blur the text currently selected on the page',
      defaultBinding: Object.freeze([
        Object.freeze({ code: 'KeyX', mods: Object.freeze(['Alt', 'Shift']) }),
      ]),
      messageType:    'BLUR_SELECTION',
      chromeCommand:  null,
    }),
  });

  function list() { return Object.values(ACTIONS); }
  function get(id) { return ACTIONS[id]; }
  function ids() { return Object.keys(ACTIONS); }

  /**
   * Build a fresh mutable copy of every action's default binding,
   * keyed by action id (kebab-case). Used by build_default_model() for shortcuts.
   */
  function defaultBindings() {
    const out = {};
    for (const action of list()) {
      out[action.id] = {
        binding: action.defaultBinding.map(chord => ({
          code: chord.code,
          mods: [...chord.mods],
        })),
      };
    }
    return out;
  }

  return { ACTIONS, list, get, ids, defaultBindings };
})();

blsi.Actions = Actions;
