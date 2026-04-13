/**
 * tests/unit/action_registry.test.js
 *
 * Unit tests for src/action_registry.js (blsi.Actions).
 *
 * Registry contract:
 *   - ACTIONS is a frozen object map keyed by action id.
 *   - Each entry has { id, label, description, defaultBinding, messageType, chromeCommand }.
 *   - list() returns an array of action objects.
 *   - get(id) returns the action or undefined.
 *   - ids() returns an array of action ids.
 *   - defaultBindings() returns a mutable clone of each action's default binding
 *     wrapped in { binding: [...] }, ready for settings.SHORTCUTS.
 */

'use strict';

// action_registry.js is loaded by tests/setup.js.

describe('blsi.Actions (action registry)', () => {
  test('is exposed as blsi.Actions', () => {
    expect(blsi.Actions).toBeDefined();
    expect(typeof blsi.Actions.list).toBe('function');
    expect(typeof blsi.Actions.get).toBe('function');
    expect(typeof blsi.Actions.ids).toBe('function');
    expect(typeof blsi.Actions.defaultBindings).toBe('function');
  });

  test('contains exactly 4 actions', () => {
    expect(blsi.Actions.ids()).toHaveLength(4);
  });

  test('all core actions are registered', () => {
    expect(blsi.Actions.get('TOGGLE_BLUR_ALL')).toBeDefined();
    expect(blsi.Actions.get('TOGGLE_PICKER')).toBeDefined();
    expect(blsi.Actions.get('CLEAR_ALL')).toBeDefined();
    expect(blsi.Actions.get('SCREENSHOT')).toBeDefined();
  });

  test('each action has the full metadata shape', () => {
    for (const action of blsi.Actions.list()) {
      expect(typeof action.id).toBe('string');
      expect(typeof action.label).toBe('string');
      expect(typeof action.description).toBe('string');
      expect(typeof action.messageType).toBe('string');
      expect(action.chromeCommand === null || typeof action.chromeCommand === 'string').toBe(true);
      expect(Array.isArray(action.defaultBinding)).toBe(true);
      expect(action.defaultBinding.length).toBeGreaterThan(0);
    }
  });

  test('each defaultBinding chord has {code, mods}', () => {
    for (const action of blsi.Actions.list()) {
      for (const chord of action.defaultBinding) {
        expect(typeof chord.code).toBe('string');
        expect(chord.code.length).toBeGreaterThan(0);
        expect(Array.isArray(chord.mods)).toBe(true);
        expect(chord.mods.length).toBeGreaterThanOrEqual(1);
        for (const mod of chord.mods) {
          expect(['Alt', 'Control', 'Meta', 'Shift']).toContain(mod);
        }
      }
    }
  });

  test('ACTIONS object is frozen', () => {
    expect(Object.isFrozen(blsi.Actions.ACTIONS)).toBe(true);
  });

  test('individual action entries are frozen', () => {
    for (const action of blsi.Actions.list()) {
      expect(Object.isFrozen(action)).toBe(true);
      expect(Object.isFrozen(action.defaultBinding)).toBe(true);
    }
  });

  test('defaultBindings() returns a mutable clone', () => {
    const one = blsi.Actions.defaultBindings();
    const two = blsi.Actions.defaultBindings();
    // Different object instances
    expect(one).not.toBe(two);
    // Mutating one must not affect the registry
    one.TOGGLE_BLUR_ALL.binding[0].mods.push('Meta');
    expect(blsi.Actions.get('TOGGLE_BLUR_ALL').defaultBinding[0].mods).not.toContain('Meta');
    expect(two.TOGGLE_BLUR_ALL.binding[0].mods).not.toContain('Meta');
  });

  test('defaultBindings() produces the new settings shape', () => {
    const defaults = blsi.Actions.defaultBindings();
    for (const id of blsi.Actions.ids()) {
      const entry = defaults[id];
      expect(entry).toBeDefined();
      expect(Array.isArray(entry.binding)).toBe(true);
      expect(entry.binding[0].code).toBeDefined();
      expect(entry.binding[0].mods).toBeDefined();
    }
  });

  test('messageType uniquely maps to each action', () => {
    const seen = new Set();
    for (const action of blsi.Actions.list()) {
      expect(seen.has(action.messageType)).toBe(false);
      seen.add(action.messageType);
    }
  });

  test('chromeCommand uniquely maps to each action', () => {
    const seen = new Set();
    for (const action of blsi.Actions.list()) {
      expect(seen.has(action.chromeCommand)).toBe(false);
      seen.add(action.chromeCommand);
    }
  });

  test('get(unknown) returns undefined', () => {
    expect(blsi.Actions.get('DOES_NOT_EXIST')).toBeUndefined();
  });
});
