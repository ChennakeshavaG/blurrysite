'use strict';

/**
 * tests/unit/popup_render_shortcuts.test.js
 *
 * Unit tests for popup/renders/keyboard.js
 *
 * Covers three cases:
 *   1. Normal rows — all actions rendered, labels and bindings displayed
 *   2. Capture mode — Change button activates recording UI, keyboard events handled
 *   3. Save and reset — onSave called with correct patches, row rebuilt after
 *
 * Dependencies loaded by tests/setup.js:
 *   blsi.Actions (action_registry.js)
 *   blsi.ShortcutLabel (shortcut_label.js)
 *   chrome.i18n.getMessage (mocked)
 */

const fs   = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../popup/renders/keyboard.js');

function loadRenderShortcuts() {
  if (global.BlurrySitePopupRenderShortcuts) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  throw new Error('popup/renders/keyboard.js not found — cannot run tests against a stub');
}

/** Build a minimal settings object with default shortcuts from blsi.Actions. */
function makeSettings(overrides) {
  return Object.assign({ shortcuts: blsi.Actions.defaultBindings() }, overrides);
}

/**
 * Dispatch a keydown on document with optional getModifierState override.
 * opts.mods — array of modifier names that getModifierState returns true for.
 */
function fireKeyDown(opts) {
  const e = new KeyboardEvent('keydown', {
    key:         opts.key  || '',
    code:        opts.code || '',
    bubbles:     true,
    cancelable:  true,
    altKey:      (opts.mods || []).includes('Alt'),
    shiftKey:    (opts.mods || []).includes('Shift'),
    ctrlKey:     (opts.mods || []).includes('Control'),
    metaKey:     (opts.mods || []).includes('Meta'),
  });
  if (opts.mods) {
    e.getModifierState = (m) => opts.mods.includes(m);
  } else {
    e.getModifierState = () => false;
  }
  document.dispatchEvent(e);
  return e;
}

beforeAll(() => loadRenderShortcuts());

beforeEach(() => {
  document.body.innerHTML = '<div id="container"></div>';
  chrome.i18n.getMessage.mockImplementation((key) => key);
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ── Case 1: Normal rows ───────────────────────────────────────────────────────

describe('renderBody — normal rows', () => {
  test('renders one row per registered action', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    const rows = container.querySelectorAll('.bl-sc-row');
    expect(rows).toHaveLength(blsi.Actions.list().length);
  });

  test('each row has a Change button', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    const changeBtns = container.querySelectorAll('.bl-sc-change-btn');
    expect(changeBtns).toHaveLength(blsi.Actions.list().length);
  });

  test('each row has a Reset button', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    const resetBtns = container.querySelectorAll('.bl-sc-reset-btn');
    expect(resetBtns).toHaveLength(blsi.Actions.list().length);
  });

  test('row displays binding label when a binding is set', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    const firstRow = container.querySelector('.bl-sc-row');
    const binding = firstRow.querySelector('.bl-sc-row__binding:not(.bl-sc-row__binding--none)');
    expect(binding).toBeTruthy();
    expect(binding.textContent.length).toBeGreaterThan(0);
  });

  test('row shows --none placeholder when binding array is empty', () => {
    const firstActionId = blsi.Actions.list()[0].id;
    const settings = makeSettings({
      shortcuts: { [firstActionId]: { binding: [] } },
    });
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, settings, jest.fn());
    const firstRow = container.querySelector('.bl-sc-row');
    const placeholder = firstRow.querySelector('.bl-sc-row__binding--none');
    expect(placeholder).toBeTruthy();
  });
});

// ── Case 2: Capture mode ──────────────────────────────────────────────────────

describe('renderBody — capture mode', () => {
  test('clicking Change replaces row content with capture UI', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    container.querySelector('.bl-sc-change-btn').click();
    expect(container.querySelector('.bl-sc-capture')).toBeTruthy();
  });

  test('save button starts disabled in capture mode', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    container.querySelector('.bl-sc-change-btn').click();
    const saveBtn = container.querySelector('.bl-sc-save-btn');
    expect(saveBtn.disabled).toBe(true);
  });

  test('keydown with modifier enables save and updates preview', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    container.querySelector('.bl-sc-change-btn').click();

    fireKeyDown({ code: 'KeyM', key: 'm', mods: ['Alt', 'Shift'] });

    const saveBtn = container.querySelector('.bl-sc-save-btn');
    expect(saveBtn.disabled).toBe(false);
    const preview = container.querySelector('.bl-sc-capture__preview');
    expect(preview.classList.contains('bl-sc-capture__preview--empty')).toBe(false);
  });

  test('keydown without modifier keeps save disabled', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    container.querySelector('.bl-sc-change-btn').click();

    fireKeyDown({ code: 'KeyB', key: 'b' }); // no mods

    expect(container.querySelector('.bl-sc-save-btn').disabled).toBe(true);
  });

  test('Escape cancels capture and restores normal row', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    container.querySelector('.bl-sc-change-btn').click();
    expect(container.querySelector('.bl-sc-capture')).toBeTruthy();

    fireKeyDown({ code: 'Escape', key: 'Escape' });

    expect(container.querySelector('.bl-sc-capture')).toBeFalsy();
    expect(container.querySelector('.bl-sc-change-btn')).toBeTruthy();
  });

  test('Cancel button restores normal row without calling onSave', () => {
    const onSave = jest.fn();
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), onSave);
    container.querySelector('.bl-sc-change-btn').click();
    container.querySelector('.bl-sc-cancel-btn').click();

    expect(container.querySelector('.bl-sc-capture')).toBeFalsy();
    expect(onSave).not.toHaveBeenCalled();
  });

  test('opening capture on a second row cancels the first', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());
    const changeBtns = Array.from(container.querySelectorAll('.bl-sc-change-btn'));

    changeBtns[0].click();
    expect(container.querySelectorAll('.bl-sc-capture')).toHaveLength(1);

    // Opening second row's capture must close first
    changeBtns[1].click();
    const rows = container.querySelectorAll('.bl-sc-row');
    expect(rows[0].querySelector('.bl-sc-capture')).toBeFalsy();
    expect(rows[1].querySelector('.bl-sc-capture')).toBeTruthy();
    expect(container.querySelectorAll('.bl-sc-capture')).toHaveLength(1);
  });
});

// ── Case 3: Save and reset ────────────────────────────────────────────────────

describe('renderBody — save and reset', () => {
  test('clicking Save calls onSave with binding patch for the action', () => {
    const onSave = jest.fn();
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), onSave);

    container.querySelector('.bl-sc-change-btn').click();
    fireKeyDown({ code: 'KeyX', key: 'x', mods: ['Alt'] });
    container.querySelector('.bl-sc-save-btn').click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0][0];
    const firstActionId = blsi.Actions.list()[0].id;
    expect(patch.shortcuts[firstActionId]).toBeDefined();
    expect(patch.shortcuts[firstActionId].binding[0].code).toBe('KeyX');
    expect(patch.shortcuts[firstActionId].binding[0].mods).toContain('Alt');
  });

  test('clicking Reset calls onSave with the action default binding', () => {
    const onSave = jest.fn();
    const firstAction = blsi.Actions.list()[0];
    const settings = makeSettings({
      shortcuts: { [firstAction.id]: { binding: [{ code: 'KeyX', mods: ['Alt'] }] } },
    });
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, settings, onSave);

    container.querySelector('.bl-sc-reset-btn').click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0][0];
    const expected = firstAction.defaultBinding.map((c) => ({
      code: c.code,
      mods: Array.from(c.mods),
    }));
    expect(patch.shortcuts[firstAction.id].binding).toEqual(expected);
  });

  test('after save, row returns to normal mode showing the new binding', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());

    container.querySelector('.bl-sc-change-btn').click();
    fireKeyDown({ code: 'KeyQ', key: 'q', mods: ['Control'] });
    container.querySelector('.bl-sc-save-btn').click();

    expect(container.querySelector('.bl-sc-capture')).toBeFalsy();
    expect(container.querySelector('.bl-sc-change-btn')).toBeTruthy();
    // New binding should be visible (not the --none placeholder)
    const firstRow = container.querySelector('.bl-sc-row');
    expect(firstRow.querySelector('.bl-sc-row__binding--none')).toBeFalsy();
  });
});

// ── Case 4: Conflict detection ──────────────────────────────────────────────

describe('renderBody — conflict detection', () => {
  test('recording a chord assigned to another action blocks save and shows warning', () => {
    const container = document.getElementById('container');
    const actions = blsi.Actions.list();
    const secondDefault = actions[1].defaultBinding[0];
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());

    // Open capture on the first action
    container.querySelector('.bl-sc-change-btn').click();

    // Press the second action's default chord
    fireKeyDown({ code: secondDefault.code, key: '', mods: secondDefault.mods });

    const saveBtn = container.querySelector('.bl-sc-save-btn');
    expect(saveBtn.disabled).toBe(true);
    const warning = container.querySelector('.bl-sc-capture__warning');
    expect(warning.hidden).toBe(false);
  });

  test('recording the same chord already set on this action blocks save', () => {
    const container = document.getElementById('container');
    const firstAction = blsi.Actions.list()[0];
    const chord = firstAction.defaultBinding[0];
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());

    container.querySelector('.bl-sc-change-btn').click();
    fireKeyDown({ code: chord.code, key: '', mods: chord.mods });

    const saveBtn = container.querySelector('.bl-sc-save-btn');
    expect(saveBtn.disabled).toBe(true);
    const warning = container.querySelector('.bl-sc-capture__warning');
    expect(warning.hidden).toBe(false);
    expect(warning.classList.contains('bl-sc-capture__warning--info')).toBe(true);
  });

  test('recording a unique chord enables save with no warning', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());

    container.querySelector('.bl-sc-change-btn').click();
    fireKeyDown({ code: 'KeyZ', key: 'z', mods: ['Alt', 'Shift'] });

    const saveBtn = container.querySelector('.bl-sc-save-btn');
    expect(saveBtn.disabled).toBe(false);
    const warning = container.querySelector('.bl-sc-capture__warning');
    expect(warning.hidden).toBe(true);
  });

  test('reserved chord shows warning but does not block save', () => {
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), jest.fn());

    container.querySelector('.bl-sc-change-btn').click();
    fireKeyDown({ code: 'KeyT', key: 't', mods: ['Control'] });

    const saveBtn = container.querySelector('.bl-sc-save-btn');
    expect(saveBtn.disabled).toBe(false);
    const warning = container.querySelector('.bl-sc-capture__warning');
    expect(warning.hidden).toBe(false);
  });
});

// ── Case 5: Reset All confirmation ──────────────────────────────────────────

describe('renderBody — Reset All confirmation', () => {
  test('first click arms the button, does not call onSave', () => {
    const onSave = jest.fn();
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), onSave);

    const resetAllBtn = container.querySelector('.bl-sc-reset-all-btn');
    resetAllBtn.click();

    expect(onSave).not.toHaveBeenCalled();
    expect(resetAllBtn.classList.contains('bl-sc-reset-all-btn--armed')).toBe(true);
  });

  test('second click within window executes reset', () => {
    const onSave = jest.fn();
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), onSave);

    const resetAllBtn = container.querySelector('.bl-sc-reset-all-btn');
    resetAllBtn.click(); // arm
    resetAllBtn.click(); // execute

    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0][0];
    expect(patch.shortcuts).toBeDefined();
    expect(resetAllBtn.classList.contains('bl-sc-reset-all-btn--armed')).toBe(false);
  });

  test('armed state reverts after 3s timeout', () => {
    jest.useFakeTimers();
    const onSave = jest.fn();
    const container = document.getElementById('container');
    BlurrySitePopupRenderShortcuts.renderBody(container, makeSettings(), onSave);

    const resetAllBtn = container.querySelector('.bl-sc-reset-all-btn');
    resetAllBtn.click(); // arm
    expect(resetAllBtn.classList.contains('bl-sc-reset-all-btn--armed')).toBe(true);

    jest.advanceTimersByTime(3000);

    expect(resetAllBtn.classList.contains('bl-sc-reset-all-btn--armed')).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
