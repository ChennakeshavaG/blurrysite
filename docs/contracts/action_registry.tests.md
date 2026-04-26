# action_registry Test Contract

## Overview

Tests for `src/action_registry.js` (`blsi.Actions`). Verifies that the registry exposes its full public API, contains exactly the expected set of actions with correct metadata shapes, is immutable at runtime, and produces correctly cloned default bindings. The registry is the single source of truth for shortcut-driven actions consumed by the settings UI, shortcut handler, and background message router.

## Setup & Teardown

- Module loaded once via `tests/setup.js` (no per-test load or teardown).
- No `beforeEach` / `afterEach` — registry is read-only; no state to reset between tests.

## Test Groups

### blsi.Actions (action registry)

- `is exposed as blsi.Actions` — `blsi.Actions` is defined and exposes `list`, `get`, `ids`, and `defaultBindings` as functions.
- `contains exactly 5 actions` — `ids()` returns an array of exactly 5 entries.
- `all core actions are registered` — `get()` returns a truthy value for each of the five canonical ids: `'toggle-blur-all'`, `'toggle-picker'`, `'clear-all'`, `'screenshot'`, `'blur-selection'`.
- `each action has the full metadata shape` — every entry returned by `list()` has string `id`, `label`, `description`, `messageType`; `chromeCommand` is `null` or string; `defaultBinding` is a non-empty array.
- `each defaultBinding chord has {code, mods}` — every chord in every action's `defaultBinding` has a non-empty string `code` and a `mods` array whose elements are exclusively drawn from `['Alt', 'Control', 'Meta', 'Shift']`; each chord has at least one modifier.
- `ACTIONS, each action entry, and each defaultBinding are frozen` — `Object.isFrozen` is `true` for `blsi.Actions.ACTIONS`, for each action object, and for each action's `defaultBinding` array.
- `defaultBindings() returns a mutable clone` — two successive calls return distinct object instances; mutating the binding array on one clone does not alter the frozen registry or the other clone.
- `defaultBindings() produces the new settings shape` — for every action id, the returned object has a `binding` array whose first element has both `code` and `mods` defined.
- `messageType is unique across all actions` — no two actions share the same `messageType` string.
- `non-null chromeCommand is unique across all actions` — among actions where `chromeCommand` is not `null`, no two share the same command string.
- `get(unknown) returns undefined` — `get('DOES_NOT_EXIST')` returns `undefined`.

## Edge Cases Covered

- `chromeCommand === null` is a valid value (actions with no browser-level command); uniqueness check skips `null` values rather than treating them as equal.
- Mutability isolation: `defaultBindings()` clones deeply enough that pushing a modifier into the returned binding does not affect the frozen source.

## Coverage Gaps

- No test for `ids()` return type — only length is asserted; element type (`string`) is not checked explicitly.
- No test for `list()` return type — implicitly an array (iterated with `for...of`) but not asserted with `Array.isArray`.
- No test for `get()` called with `undefined` or non-string arguments — behavior on malformed input is unspecified.
- No test verifying that the action `label` and `description` fields are non-empty strings.
- No test verifying that `defaultBinding` chord `mods` arrays are sorted (contract requires sorted subset of modifier names).
- No test for the `'blur-selection'` action's specific default binding key/modifier combination.
