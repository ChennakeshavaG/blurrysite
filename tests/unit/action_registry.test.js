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

// USER IMPACT: settings UI shows all 4 actions with correct labels and default shortcuts; background message routing never ambiguous
describe('blsi.Actions (action registry)', () => {
  // USER IMPACT: settings UI enumerates all actions from the registry — missing an action means no UI row and no shortcut for that feature
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
    expect(blsi.Actions.get('toggle-blur-all')).toBeDefined();
    expect(blsi.Actions.get('toggle-picker')).toBeDefined();
    expect(blsi.Actions.get('clear-all')).toBeDefined();
    expect(blsi.Actions.get('screenshot')).toBeDefined();
  });

  // USER IMPACT: settings UI shows correct human-readable labels and descriptions for every action row
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

  // USER IMPACT: frozen registry prevents runtime code from corrupting action definitions that the settings UI and shortcut handler rely on
  test('ACTIONS, each action entry, and each defaultBinding are frozen', () => {
    expect(Object.isFrozen(blsi.Actions.ACTIONS)).toBe(true);
    for (const action of blsi.Actions.list()) {
      expect(Object.isFrozen(action)).toBe(true);
      expect(Object.isFrozen(action.defaultBinding)).toBe(true);
    }
  });

  // USER IMPACT: user changes shortcuts in settings — the original defaults remain intact so a "reset to defaults" always has clean data to restore
  test('defaultBindings() returns a mutable clone', () => {
    const one = blsi.Actions.defaultBindings();
    const two = blsi.Actions.defaultBindings();
    // Different object instances
    expect(one).not.toBe(two);
    // Mutating one must not affect the registry
    one['toggle-blur-all'].binding[0].mods.push('Meta');
    expect(blsi.Actions.get('toggle-blur-all').defaultBinding[0].mods).not.toContain('Meta');
    expect(two['toggle-blur-all'].binding[0].mods).not.toContain('Meta');
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

  // USER IMPACT: background.js message routing is unambiguous — each action dispatches to exactly one handler
  test.each(['messageType', 'chromeCommand'])('%s is unique across all actions', (prop) => {
    const seen = new Set();
    for (const action of blsi.Actions.list()) {
      expect(seen.has(action[prop])).toBe(false);
      seen.add(action[prop]);
    }
  });

  test('get(unknown) returns undefined', () => {
    expect(blsi.Actions.get('DOES_NOT_EXIST')).toBeUndefined();
  });
});
