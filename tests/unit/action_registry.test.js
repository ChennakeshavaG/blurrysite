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

/* === TEST QUALITY ANNOTATIONS ===
 * FILE COVERS:
 *   - API surface: list, get, ids, defaultBindings, ACTIONS exposed on blsi.Actions
 *   - Exactly 4 actions registered
 *   - All 4 core actions present by id
 *   - Full metadata shape: id, label, description, messageType, chromeCommand, defaultBinding array
 *   - Each defaultBinding chord has { code, mods } with valid mod strings
 *   - ACTIONS object frozen; individual action entries and defaultBinding arrays frozen
 *   - defaultBindings() deep clone: mutations do not affect registry or other clones
 *   - defaultBindings() produces correct settings shape { binding: [...] }
 *   - messageType uniqueness across all actions
 *   - chromeCommand uniqueness across all actions
 *   - get(unknown) returns undefined
 *
 * REDUNDANT TESTS:
 *   - "ACTIONS object is frozen" and "individual action entries are frozen" both verify
 *     Object.isFrozen — could be a single test that iterates the registry and checks the
 *     top-level object plus every entry and every defaultBinding array.
 *   - "messageType uniquely maps to each action" and "chromeCommand uniquely maps to each
 *     action" use the exact same Set-dedup loop pattern; only the property name differs —
 *     a test.each(['messageType', 'chromeCommand']) would express this cleanly.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Frozen tests → one loop: check ACTIONS, then each action, then action.defaultBinding.
 *   - Uniqueness tests → test.each(['messageType', 'chromeCommand']) with a shared
 *     Set-dedup assertion body.
 *   - Metadata shape test → strengthen with non-empty string assertions on label and
 *     description so an action with label: '' would be caught.
 *
 * MISSING COVERAGE:
 *   - No test that action.id === key in ACTIONS (self-reference consistency check).
 *   - No test for duplicate mods in a chord (e.g. mods: ['Alt', 'Alt']) — should not exist
 *     in any defaultBinding chord.
 *   - label and description are asserted to be strings but not checked for non-empty content.
 *   - No test that each defaultBinding chord count is exactly 1 (phase 1 constraint).
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
    expect(blsi.Actions.get('TOGGLE_BLUR_ALL')).toBeDefined();
    expect(blsi.Actions.get('TOGGLE_PICKER')).toBeDefined();
    expect(blsi.Actions.get('CLEAR_ALL')).toBeDefined();
    expect(blsi.Actions.get('SCREENSHOT')).toBeDefined();
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

  // MISSING: label and description checked for typeof 'string' but not for non-empty content
  // MISSING: no assertion that action.id === the key in ACTIONS (self-reference consistency)
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

  // MISSING: no assertion that defaultBinding chord count is exactly 1 (phase 1 constraint)
  // MISSING: no test that any defaultBinding chord has no duplicate mods (e.g. mods:['Alt','Alt'])
  // USER IMPACT: frozen registry prevents runtime code from corrupting action definitions that the settings UI and shortcut handler rely on
  // OPTIMIZE: "ACTIONS object is frozen" and "individual action entries are frozen" could be one test iterating the registry: check ACTIONS, then each action, then each action.defaultBinding
  // REDUNDANT: "ACTIONS object is frozen" and "individual action entries are frozen" both assert Object.isFrozen — only the target object differs
  test('ACTIONS object is frozen', () => {
    expect(Object.isFrozen(blsi.Actions.ACTIONS)).toBe(true);
  });

  // REDUNDANT: same Object.isFrozen assertion pattern as "ACTIONS object is frozen" above
  test('individual action entries are frozen', () => {
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

  // USER IMPACT: background.js message routing is unambiguous — each action dispatches to exactly one handler
  // OPTIMIZE: "messageType uniquely maps" and "chromeCommand uniquely maps" share identical Set-dedup loop; convert to test.each(['messageType', 'chromeCommand'])
  // REDUNDANT: "messageType uniquely maps to each action" and "chromeCommand uniquely maps to each action" use the exact same Set-dedup pattern; only the property name differs
  test('messageType uniquely maps to each action', () => {
    const seen = new Set();
    for (const action of blsi.Actions.list()) {
      expect(seen.has(action.messageType)).toBe(false);
      seen.add(action.messageType);
    }
  });

  // REDUNDANT: same Set-dedup pattern as "messageType uniquely maps to each action" above
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
  // MISSING: no test that action.id === key in ACTIONS for every registered action
  // MISSING: no test that label and description are non-empty strings (typeof check passes for '')
  // MISSING: no test that defaultBinding chord count equals 1 per action (phase 1 constraint)
});
