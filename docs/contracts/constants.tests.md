# constants Test Contract

## Overview

Unit tests for `src/constants.js`. The module exposes `globalThis.blsi` (the shared namespace) with message-type constants, enum objects, `DEFAULT_MODEL`, and utility functions: `build_default_model()`, `deep_merge()`, `is_valid()`, `category_of()`, `validate_model()`, and `is_valid_shortcut_entry()`.

Loaded implicitly by `tests/setup.js` via `require('../../src/constants.js')` — no per-file load guard needed.

---

## Setup & Teardown

- No `beforeEach` / `afterEach` hooks in this file.
- `jest.clearAllMocks()` is called globally by `tests/setup.js` before each test.
- `DEFAULT_MODEL` is frozen; tests that mutate settings always call `build_default_model()` first to obtain a writable clone.

---

## Test Groups

### command category

- `exposes all command message types` — asserts `blsi.command.toggle_blur_all === 'TOGGLE_BLUR_ALL'`, `toggle_picker`, `clear_all_blur`, `restore`, `context_blur`, `context_unblur` match their string literals exactly.

### popup category

- `exposes all popup message types` — asserts `blsi.popup.get_status === 'GET_STATUS'` and `blsi.popup.unblur_item === 'UNBLUR_ITEM'`.

### is_valid

- `returns true for known message types` — `'TOGGLE_BLUR_ALL'` and `'GET_STATUS'` return `true`.
- `returns false for unknown strings` — `'UNKNOWN_TYPE'` and `''` return `false`.
- `returns false for non-string input` — `null`, `undefined`, and `42` all return `false`.

### category_of

- `returns correct category for command types` — `'TOGGLE_BLUR_ALL'` and `'RESTORE'` map to `'command'`.
- `returns correct category for popup types` — `'GET_STATUS'` maps to `'popup'`.
- `returns null for unknown types` — `'UNKNOWN'` and `''` return `null`.

### DEFAULT_MODEL

- `has top-level sections` — `global_default_settings`, `blur_all`, `pick_and_blur`, `auto_detect_pii`, `automate` are defined; `site_rules` is an array.
- `settings has correct default values` — `blur_radius: 8`, `transition_duration: 300`, `highlight_color: '#f59e0b'`, `reveal_mode: 'hover'`, `enabled: true`, `thorough_blur: false`, `language: 'auto'`.
- `blur_all.settings.blur_categories has correct defaults` — `text: true`, `media: true`, `form: false`, `table: true`, `structure: true`; exactly 5 keys.
- `settings does not contain blur_categories` — `global_default_settings.blur_categories` is `undefined`.
- `blur_all.settings.blur_mode defaults to blur` — value is `'blur'`.
- `pick_and_blur defaults` — `status: false`, `settings.picker_mode: null`, `settings.blur_type: 'blur'`.
- `auto_detect_pii defaults` — `settings.email: true`, `settings.numeric: true`, `settings.pii_mode: 'blur'`.
- `automate defaults` — `idle.value: 5`, `idle.unit: 'min'`, `tab_switch.enabled: false`.
- `automate_blur is not in DEFAULT_MODEL` — `DEFAULT_MODEL.automate_blur` is `undefined` (session storage only).
- `is frozen` — `Object.isFrozen(DEFAULT_MODEL)` and `Object.isFrozen(DEFAULT_MODEL.global_default_settings)` are both `true`.

### build_default_model

- `returns a mutable deep clone with shortcuts` — mutations to the clone do not affect `DEFAULT_MODEL`.
- `includes shortcuts from action registry` — `shortcuts` object has entries for `'toggle-blur-all'`, `'toggle-picker'`, `'clear-all'`; all keys are kebab-case action IDs.
- `nested objects are cloned (not shared)` — mutating `blur_categories.form` on the clone does not affect `DEFAULT_MODEL`.

### deep_merge

- `merges flat keys` — `{a:1,b:2}` merged with `{b:3}` yields `{a:1,b:3}`.
- `merges nested objects` — nested key override preserves unmentioned sibling keys.
- `blocks prototype pollution keys` — `__proto__` and `constructor` overrides are silently ignored; `result.evil` is `undefined`; `result.constructor` remains `Object`.
- `does not mutate base` — frozen base object is not modified.
- `stops at depth limit` — deep nesting beyond the limit is handled; the test verifies up to 7 levels deep without error.

### validate_model

- `returns full defaults for null input` — `blur_radius: 8`, `enabled: true`, `blur_categories.text: true`, `shortcuts` defined.
- `preserves valid settings values` — custom `blur_radius: 15`, `enabled: false`, `blur_categories.form: true` survive round-trip.
- `replaces out-of-range blur_radius with default` — `blur_radius: 999` → fallback to `8`.
- `replaces invalid reveal_mode with default` — `'invalid'` → `'hover'`.
- `language accepts auto, en, hi_IN, ta_IN` — all four values pass through unchanged.
- `language rejects unsupported codes and falls back to auto` — `'fr'`, `''`, and `null` all produce `'auto'`.
- `fills missing sections with defaults` — empty object `{}` produces all required top-level sections with correct defaults.
- `migrates blur_categories from old settings key to blur_all.settings` — when `blur_categories` lives under `global_default_settings`, it is moved to `blur_all.settings.blur_categories` and removed from the old location.
- `validates shortcut entries in shortcuts section` — a malformed entry `{ bad: true }` is replaced with the default binding (non-empty array).

### Enums (test.each)

- `blur_modes enum is frozen`
- `reveal_modes enum is frozen`
- `picker_modes enum is frozen`
- `pick_blur_modes enum is frozen`
- `pii_modes enum is frozen`
- `idle_units enum is frozen`
- `pattern_types enum is frozen`

(All seven asserted via `Object.isFrozen`.)

- `picker_modes: sticky_page and sticky_screen use hyphenated values` — `picker_modes.sticky_page === 'sticky-page'`, `picker_modes.sticky_screen === 'sticky-screen'`.
- `pick_blur_modes excludes redacted and censored` — both keys are `undefined` (these are Blur All-only types).
- `idle_units excludes hr` — `idle_units.hr` is `undefined` (Chrome idle API cap ~3000 s).

### is_valid_shortcut_entry

- `accepts valid binding` — `{ binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] }` returns `true`.
- `rejects empty binding array` — `{ binding: [] }` returns `false`.
- `rejects mods.length === 0` — a chord with empty `mods` returns `false`.
- `rejects Ctrl+Alt (AltGr collision)` — `['Control', 'Alt']` combination returns `false`.
- `rejects unknown modifier names` — `['Option']` is not a valid mod; returns `false`.
- `rejects null input` — `null` returns `false`.

### immutability

- `top-level blsi namespace is extensible (modules attach to it)` — `typeof PB === 'object'`.
- `command and popup category objects are frozen` — both `blsi.command` and `blsi.popup` are frozen.

### validate_model boundary values

- `blur_radius accepts min boundary (2)` — value `2` passes through.
- `blur_radius accepts max boundary (32)` — value `32` passes through.
- `blur_radius rejects below min (1)` — value `1` falls back to default `8`.
- `blur_radius rejects above max (33)` — value `33` falls back to default `8`.
- `blur_mode (in blur_all.settings) validates against enum` — `'blur'` passes; `'invalid'` falls back to `'blur'`.
- `blur_mode migrates legacy values: gaussian→blur, masked→solid→censored` — `'gaussian'` → `'blur'`; `'masked'` → `'censored'`; `'solid'` → `'censored'`.
- `pick_and_blur blur_type migrates legacy gaussian→blur` — `'gaussian'` in `pick_and_blur.settings.blur_type` → `'blur'`.
- `picker_mode validates against enum` — `'sticky-page'` passes; `'invalid'` → `null`; `null` → `null`.
- `pii_mode validates against enum` — `'redacted'` passes; `'bogus'` → `'blur'`.
- `pii_mode migrates legacy values: gaussian→blur, asterisked→hidden→starred` — `'gaussian'` → `'blur'`; `'asterisked'` → `'starred'`; `'hidden'` → `'starred'`.
- `automate.idle: hr unit rejected — falls back to min` — `unit: 'hr'` becomes `'min'`.
- `automate.idle: value 0 (below min 1) falls back to 5` — `value: 0` becomes `5`.
- `shortcuts: rejects empty binding array` — empty binding is replaced with the default (length > 0).
- `shortcuts: accepts valid binding` — valid `[{code:'KeyK', mods:['Control','Shift']}]` passes through.
- `site_rules: blur_all:false is preserved (not coerced to null)` — popup toggle-off path writes `false`; validate_model must not coerce it.
- `site_rules: blur_all:true is preserved` — explicit `true` passes through.
- `site_rules: blur_all:null (inherit) is preserved` — `null` (inherit-from-global) passes through.
- `site_rules: dynamic item with selectors[] array passes validation` — item with `selectors: ['#foo', '.bar']` survives; first selector accessible.
- `site_rules: dynamic item with legacy selector string passes validation` — item with `selector: '#foo'` (single string, old shape) survives.
- `site_rules: dynamic item with empty selectors[] is stripped` — `selectors: []` causes the item to be removed from the validated array.

---

## Edge Cases Covered

- Prototype pollution via `__proto__` and `constructor` keys in `deep_merge`.
- Frozen objects passed as `deep_merge` base — result is a new object; base is untouched.
- `validate_model(null)` and `validate_model({})` both produce complete, valid models.
- Legacy blur mode names (`gaussian`, `masked`, `solid`, `asterisked`, `hidden`) migrated to current enum values.
- `blur_categories` key location migration (old: `global_default_settings`, new: `blur_all.settings`).
- `site_rules` item filter: empty `selectors[]` stripped; both `selector` (string) and `selectors` (array) shapes accepted.
- `blur_all: false` in site_rules must survive — not coerced to `null` — because it is how the user disables blur for a site.
- `picker_mode: null` is a valid "not set" state and must not be replaced with a default.
- `idle.value = 0` below minimum; `idle.unit = 'hr'` outside allowed set.
- Shortcut entry validation: malformed entries replaced with action defaults.

---

## Coverage Gaps

- No test for `deep_merge` with arrays as values — behaviour when overlay contains an array key is unspecified.
- No test for `validate_model` with a `site_rules` entry that has `hostname_type` missing or invalid.
- No test for the `css` or `ids` sub-objects on `blsi` (CSS class name constants and DOM id constants).
- No test for `modifier_codes` or `reveal_dfs_max_depth` constants.
- No test for `SUPPORTED_LANGUAGES` array contents or length.
- `is_valid_shortcut_entry`: no test for a chord with `mods` not an array (e.g. `mods: 'Alt'` string).
- `validate_model`: no test for what happens when `shortcuts` key is entirely absent from the input (should fill with defaults from action registry).
- `build_default_model`: no test verifying that `site_rules` is an empty array in the clone.
