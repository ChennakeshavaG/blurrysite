# storage_model Test Contract

## Overview

Unit tests for `src/storage_model.js`, covering the full public API of `blsi.Model`. The suite
validates storage initialization and seeding, in-memory cache consistency, per-host and global
blur-state management, blur item CRUD (dynamic + sticky), URL-rule CRUD (exact / wildcard /
regex), automate-blur session-storage operations, snapshot capture and persistence, and the
`resolve()` function that content_script consumes on every page load. Validation/coercion logic
inside `blsi.validate_model()` is also exercised, including snapshot passthrough and
repair-to-default behaviour. 714 unit tests total across all modules; this file contributes
the storage_model group.

---

## Setup & Teardown

### Global bootstrap (`beforeAll`)

`loadStorageModel()` is called once. It first loads `src/url_matcher.js` (dependency of
`resolve()`), then loads `src/storage_model.js` via `require()` for Istanbul coverage
instrumentation. If the file does not exist it falls back to an inline IIFE stub
(`buildStubSource()`) that exposes the full public API as `jest.fn()` mocks.

### Per-test reset (`beforeEach` — top-level)

```js
mockSet();               // chrome.storage.local.set resolves via callback immediately
blsi.Model._reset_cache(); // sets internal cache to null → next get() returns DEFAULT_MODEL
```

Some nested `describe` blocks add their own `beforeEach` that additionally calls `mockGet(m)` and
`await blsi.Model.init_cache()` so tests start from a fully-seeded, known-good model state.

### Helper stubs

| Helper | What it does |
|---|---|
| `mockGet(modelData)` | Configures `chrome.storage.local.get` to return `{ blsi_model: modelData }`, or `{}` when `null`. |
| `mockSet()` | Configures `chrome.storage.local.set` to invoke the callback synchronously (no error). |
| `makeModel(overrides)` | Shallow-merges `overrides` onto `blsi.build_default_model()`. |
| `_fireStorageChanged(changes, area?)` | Dispatches a synthetic `chrome.storage.onChanged` event captured in `tests/setup.js`. Default area is `'local'`. |

`jest.clearAllMocks()` is called before selected tests that need a clean `chrome.storage.local.set`
call-count (via explicit `jest.clearAllMocks(); mockSet();` pair inside the test body).

---

## Test Groups

### `init_cache`

- `seeds default model when storage is empty` — when storage returns no `blsi_model`, `init_cache` writes a full default model (with `global_default_settings.blur_radius === 8`) to `chrome.storage.local.set`.
- `loads and validates existing model from storage` — when a model is already stored, `init_cache` populates the in-memory cache from it; subsequent `get()` returns the stored values (e.g. `blur_radius: 12`).
- `_reset_cache sets cache to null so next get() returns default` — after `_reset_cache()`, `get()` returns the build-default value of 8, not any previously cached value.

### `get`

- `returns default model when cache is null (not yet init_cached)` — `get()` is synchronous and safe before `init_cache`; returns a fully-populated default model.
- `returns cached model after init_cache` — after `init_cache()` with a stored radius of 18, `get()` reflects 18.

### `patch_section`

- `deep-merges patch into specified section` — `patch_section('global_default_settings', { blur_radius: 20 })` updates only `blur_radius` in the cached model.
- `does not mutate other sections` — after patching `global_default_settings`, `blur_all.status` and `blur_all.settings.blur_mode` remain at their default values.
- `calls validate_model (invalid value is coerced to default)` — a `blur_radius: 999` is out of range; the post-patch model's `blur_radius` is coerced back to 8 by `validate_model`.

### `save_settings`

- `merges patch into model.settings` — `save_settings({ reveal_mode: 'click' })` sets `global_default_settings.reveal_mode` to `'click'` while preserving `blur_radius`.
- `rejects null input — no storage write` — passing `null` must not call `chrome.storage.local.set`.
- `rejects non-object input — no storage write` — passing a string must not call `chrome.storage.local.set`.

### `get_site_entry / set_site_entry`

- `get_site_entry returns null when hostname not in site_rules` — returns `null` for an unseen hostname.
- `set_site_entry creates new exact entry` — new entry has `hostname_value === 'example.com'`, `hostname_type === blsi.pattern_types.exact`, and any provided fields (e.g. `blur_all: true`).
- `set_site_entry upserts (second call merges)` — a second call with different keys merges into the existing entry; prior keys are preserved.

### `save_blur_state / get_blur_state / get_cached_blur_state`

- `save_blur_state writes per-host blur_all flag` — after `save_blur_state('example.com', true)`, `get_site_entry` reports `blur_all: true`.
- `get_cached_blur_state returns per-host boolean after save` — `get_cached_blur_state` returns `true` after a `true` write.
- `get_cached_blur_state inherits global blur_all.status when no per-host entry` — when `blur_all.status` is `false` and the host has no entry, returns `false`.
- `get_cached_blur_state returns per-host value when entry exists` — per-host `true` overrides global `false`.
- `save_blur_state rejects empty hostname` — empty string hostname suppresses the storage write.
- `save_blur_state writes per-host blur_all=false explicitly (turns off)` — writing `false` after `true` is correctly persisted (no short-circuit on falsy value).
- `save_blur_state false is persisted to storage (write is not skipped)` — `chrome.storage.local.set` is called; the written `site_rules` entry has `blur_all: false`.
- `save_blur_state false: existing items survive the write (validate_model must not strip them)` — toggling blur-all off after saving an item must not remove items from the stored site entry.

### `save_blur_item`

- `appends a dynamic item to the host entry` — saving `{ type: 'dynamic', selector: '#foo', name: 'Foo' }` results in `get_blur_items` returning one item with `selector === '#foo'`.
- `deduplicates dynamic items by selector` — saving two items with the same `selector` yields only one entry.
- `accepts dynamic item with new selectors[] array shape` — item with `selectors: ['body > div:nth-of-type(1)', '#foo']` (no `selector`) is stored; `items[0].selectors[0]` matches.
- `deduplicates new-shape selectors[] items by selectors[0]` — duplicate `selectors[0]` values are collapsed to one entry.
- `rejects dynamic item with empty selectors array` — `selectors: []` suppresses the storage write.
- `deduplicates sticky items by id` — two saves with the same `id` yield one item.
- `enforces per-host limit of 10` — an 11th item is rejected (no write).
- `rejects invalid item type` — unknown `type: 'bad'` suppresses the storage write.
- `rejects null item` — `null` item suppresses the storage write.
- `rejects empty hostname` — empty string hostname suppresses the storage write.
- `rejects __proto__ hostname (prototype pollution guard)` — `__proto__` is blocked.
- `rejects constructor hostname (prototype pollution guard)` — `constructor` is blocked.

### `remove_blur_item`

- `removes dynamic item by selector` — after saving items `#a` and `#b`, removing `#a` leaves only `#b`.
- `is a no-op when hostname not found` — remove on an unknown hostname does not call `chrome.storage.local.set`.

### `clear_host`

- `wipes items and blur_all for hostname, leaves other hosts intact` — after clearing `example.com`, `get_blur_items` returns `[]` and `get_cached_blur_state` returns the global default; `other.com` items survive.
- `returns early for invalid hostname` — empty string suppresses the storage write.

### `get_rules / save_rules`

- `get_rules returns only wildcard/regex entries (not exact)` — `set_site_entry` for an exact host does not appear in `get_rules`; only wildcard rules do.
- `save_rules writes wildcard entries` — two rules (wildcard + regex) can be saved and retrieved.
- `save_rules clears previous wildcard/regex entries` — a second `save_rules` replaces the previous wildcard set; old entry is gone.
- `save_rules preserves exact entries when replacing wildcard rules` — exact entries created via `set_site_entry` survive a `save_rules` call.
- `save_rules ignores non-array input` — `null` and string input suppress the storage write.
- `save_rules sanitizes entries — filters out items with empty hostname_value` — whitespace-only `hostname_value` is stripped; valid entries survive.

### `resolve`

- `returns flat object with all expected keys` — flat resolved object includes `blur_radius`, `enabled`, `reveal_mode`, `blur_categories`, `blur_mode`, `blur_all_active`, `blur_items`, `pick_blur_enabled`, `picker_mode`, `shortcuts`.
- `exact site_rule overrides global blur_all_active` — per-host `blur_all: true` overrides global `blur_all.status: false`.
- `global blur_all_active used when no per-host entry` — global `blur_all.status: true` propagates to `blur_all_active`.
- `exact hostname site_rule snapshot overrides global blur_mode` — a site entry with `snapshot.blur_all.settings.blur_mode: 'frosted'` overrides the global `blur_mode`.
- `blur_items returns items for the exact hostname` — items saved under a hostname appear in `resolved.blur_items` when `pick_and_blur.status` is `true`.
- `blur_items is empty when pick_and_blur.status is false` — items are gated on feature status; `pick_blur_enabled` is also `false`.
- `wildcard site_rule snapshot overrides global blur_mode (first match wins)` — a wildcard rule snapshot with `blur_mode: 'redacted'` overrides the global default.

### `on_change`

- `subscriber is called when storage changes from an external context` — after `on_change(cb)`, firing `_fireStorageChanged` with a new model invokes `cb` exactly once with the new model.
- `subscriber receives the validated new model as the first argument` — `cb` receives an object with correct `global_default_settings.blur_radius`.
- `self-echo suppressed — subscriber NOT called when newValue equals cache` — after `patch_section` updates cache, re-firing the same model value via `_fireStorageChanged` does not call `cb`.
- `subscriber not called for non-local storage areas` — `_fireStorageChanged` in area `'sync'` is ignored.
- `subscriber not called for unrelated storage key changes` — changes to keys other than `blsi_model` are ignored.

### `automate_blur`

This group uses its own `beforeEach` that seeds and inits a default model.

- `save_automate_blur sets a trigger for a hostname` — `save_automate_blur('example.com', 'idle', true)` results in `get_automate_blur` returning `{ idle: true, tab_switch: false, screen_share: false }`.
- `save_automate_blur rejects unknown trigger` — unknown trigger name is rejected; all triggers remain `false`.
- `save_automate_blur rejects invalid hostname` — `__proto__` hostname is blocked; no state changes.
- `patch_automate_blur updates multiple triggers atomically` — `{ idle: false, screen_share: true }` applied in one call updates both fields while leaving `tab_switch: false`.
- `clear_automate_blur removes the hostname entry` — after clear, `get_automate_blur` returns the all-false default.
- `resolve includes automate_blur_active and automate_blur_triggers` — after `save_automate_blur('example.com', 'idle', true)`, `resolved.automate_blur_active === true` and `resolved.automate_blur_triggers.idle === true`.
- `resolve: blur_all_active is true when only automate fires (manual = false)` — `blur_all_active` is `true`; `automate_blur_only` is `true`; `automate_blur_skipped` is `false`.
- `resolve: automate_blur_only resets all blur-relevant keys to defaults from global settings` — when `automate_blur_only`, `blur_mode`, `blur_categories`, `blur_radius`, `thorough_blur`, `reveal_mode`, `transition_duration`, `redaction_color`, `highlight_color` all equal `DEFAULT_MODEL` values even when the user has customized them.
- `resolve: automate_blur_only resets all blur-relevant keys to defaults even when exact site_rule overrides them` — per-site overrides (non-default `blur_mode`, `blur_radius`, `thorough_blur`, etc.) are also ignored under `automate_blur_only`.
- `resolve: automate_blur_skipped = true when blur_all is already enabled` — manual `blur_all: true` + automate firing sets `automate_blur_skipped: true` and `automate_blur_only: false`; `blur_all_active` is still `true`.
- `resolve: automate_blur_skipped = true when pick_and_blur is enabled` — `pick_and_blur.status: true` + automate firing sets `automate_blur_skipped: true`; `blur_all_active` stays `false` (pick-blur handles it separately).
- `resolve: automate_blur_only and automate_blur_skipped are false when automate not firing` — both flags are `false` by default.
- `resolve: manual blur preserved after automate cleared` — after patching idle trigger to `false`, `blur_all_active` remains `true` from the persisted manual `blur_all: true`.
- `clear_host also clears automate_blur for that hostname` — after `clear_host`, `get_automate_blur` returns the all-false default.
- `save_automate_blur is a no-op when value already matches cache` — second call with the same `(hostname, trigger, value)` triple does not invoke `chrome.storage.session.set`.
- `save_automate_blur writes when value flips back` — flipping `idle: true → false` issues exactly one session write.
- `patch_automate_blur is a no-op when patch results in identical entry` — applying the same `{idle, tab_switch}` patch twice issues only one session write.
- `patch_automate_blur writes when at least one trigger flips` — changing one trigger while leaving the other unchanged still issues a write.

### `capture_snapshot`

This group uses its own `beforeEach` that seeds and inits a default model.

- `returns an object with nested sections present` — snapshot has `blur_all.settings`, `pick_and_blur.settings`, `pick_and_blur.items`, `auto_detect_pii.settings`, `automate.settings`. No `settings` block (global_default_settings dropped).
- `returns exactly 4 top-level sections — no extra keys` — only `blur_all`, `pick_and_blur`, `auto_detect_pii`, `automate` are present.
- `PII section captures email/numeric/pii_mode/pii_redaction_color` — all four PII fields read from `auto_detect_pii.settings.*` match defaults.
- `automate idle captures full shape (value + unit + enabled); tab_switch/screen_share enabled only` — `idle: { value, unit, enabled }`; the other two triggers carry only `enabled`.
- `snapshot values match default model values` — `blur_mode`, `blur_categories`, `blur_type`, `blur_color`, `pick_and_blur.status` match defaults; `pick_and_blur.items` defaults to `[]`.
- `capture reflects in-flight settings changes` — after `patch_section` calls (e.g. `blur_all.settings.blur_mode = 'frosted'`, `automate.settings.idle = { value: 24, unit: 'min', enabled: true }`), the next `capture_snapshot()` reflects those changes.
- `captures pick_and_blur.items for the supplied hostname` — `capture_snapshot('example.com')` returns the host's items array; no hostname / unknown hostname → `items: []`.
- `blur_categories is a deep copy — mutating snapshot does not affect cache` — mutating the returned snapshot's `blur_categories` does not alter the in-memory model.
- `pick_blur_color is a deep copy — mutating snapshot does not affect cache` — mutating `blur_color.hex` on the returned snapshot does not alter the in-memory model.

### `save_site_snapshot`

This group uses its own `beforeEach` that seeds and inits a default model.

- `creates a new exact rule with the snapshot in .snapshot` — `save_site_snapshot('github.com', exact, snap)` creates a rule; `get_site_snapshot` returns the stored snapshot with correct `blur_all.settings.blur_mode` and `pick_and_blur.items: []`.
- `updates .snapshot on an existing exact rule` — saves snapshot onto a rule that already has `blur_all: true`; `blur_all` is preserved and `snapshot.blur_all.settings.blur_mode` is set.
- `replaces previous snapshot on a second save` — a second `save_site_snapshot` with a different `blur_mode` replaces the old snapshot; only the new value survives.
- `works for wildcard rules created via save_rules` — wildcard rules created by `save_rules` can have snapshots saved and retrieved via `get_site_snapshot`.
- `partial snapshot is auto-filled from current global before write` — caller-provided fields preserved; missing fields filled from current global (`automate.idle.value`/`unit`); all four sections present; no `settings` block.
- `is a no-op for invalid hostname_value` — empty string hostname suppresses the storage write.
- `is a no-op for invalid (null) snapshot` — `null` snapshot suppresses the storage write.

### `get_site_snapshot`

This group uses its own `beforeEach` that seeds and inits a default model.

- `returns null when rule does not exist` — unknown hostname returns `null`.
- `returns null when rule exists but settings is empty` — rule created by `set_site_entry` without a snapshot returns `null`.
- `returns snapshot object after save_site_snapshot` — after save, the snapshot contains correct `blur_all.settings.blur_mode` and `blur_all.settings.blur_categories`.

### `validate_model snapshot passthrough`

- `passes through all snapshot sections in site_rules[i].snapshot` — `validate_model` preserves `blur_all`, `pick_and_blur` (settings + items), and `automate` sections with all nested keys intact (no `settings` block).
- `validate_model fills partial snapshots to capture_snapshot full shape (DEFAULT_MODEL values)` — caller-provided field preserved; every missing key is populated from `DEFAULT_MODEL`; `pick_and_blur.items` defaults to `[]`; `automate.settings.idle` carries full `{ value, unit, enabled }`; tab_switch / screen_share take `enabled` only.
- `validate_model drops legacy snapshot.settings block entirely` — a stale `settings` block from the previous schema is silently removed; `blur_all` validation continues to work.
- `validate_model repairs invalid blur_categories values with defaults` — non-boolean values (`'yes'`, `null`) are coerced to their `DEFAULT_MODEL` defaults; valid booleans are preserved as-is.
- `validate_model repairs invalid pick_blur_color values with defaults` — invalid `hex` (`'not-a-hex'`) and out-of-range `opacity` (`5.0`) are both coerced to `DEFAULT_MODEL` defaults.
- `empty snapshot {} survives validate_model as empty {}` — a rule with `snapshot: {}` is not modified by validation.

### `resolve with full snapshot overrides`

This group uses its own `beforeEach` that seeds and inits a default model.

- `snapshot in exact site_rule overrides all snapshot sections in resolved output` — a full snapshot (`blur_all` + `pick_and_blur`) stored via `save_site_snapshot` causes `resolve` to return the saved `blur_mode`, `blur_categories`, `pick_blur_type`, `pick_blur_color`, and `pick_blur_enabled`.
- `snapshot in wildcard site_rule overrides global snapshot keys` — a wildcard rule snapshot with `blur_mode: 'redacted'` overrides the global default for a matching subdomain.
- `exact rule snapshot wins over wildcard snapshot (exact has higher priority)` — when both an exact rule (`blur_mode: 'redacted'`) and a wildcard rule (`blur_mode: 'frosted'`) match, the exact rule's value wins.
- `non-snapshot keys in resolved output come from global/feature settings when no override` — keys not present in the snapshot (e.g. `blur_all_active`, `blur_items`) continue to be derived from the global model state.
- `snapshot.pick_and_blur.items REPLACE host-keyed items at resolve` — when the snapshot pins an items array, it overrides `pick_and_blur.items[hostname]` and stamps `_rule_overrides.blur_items`.
- `snapshot.automate.idle.value/unit override global at resolve` — full idle shape (value + unit + enabled) flows from snapshot into `resolved.automate_idle`.
- `PII fields in snapshot override global PII settings` — `pii_email`, `pii_numeric`, `pii_mode`, `pii_redaction_color` flow from snapshot into resolved + are flagged in `_rule_overrides`.
- `automate trigger.enabled in snapshot overrides global, preserves idle.value/unit` — rule's `automate.settings.idle.enabled = true` flips the resolved enable while `value`/`unit` keep their global values; same for tab_switch / screen_share. `_rule_overrides.automate_*` set.
- `_rule_match exposes the matching rule for popup deep-link` — wildcard match returns `{ hostname_value: '*.github.com', hostname_type: 'wildcard' }`.
- `exact rule snapshot wins over wildcard for _rule_match` — when both match, `_rule_match` reports the exact rule.
- `_rule_overrides empty when no rule matches` — for an unmatched host, `_rule_overrides` is `{}` and `_rule_match` is `null`.

---

## Edge Cases Covered

- Empty or null hostname rejected across all write operations (`save_blur_state`, `save_blur_item`, `save_site_snapshot`, `clear_host`).
- Prototype-pollution hostnames (`__proto__`, `constructor`) explicitly blocked in `save_blur_item` and `save_automate_blur`.
- Per-host blur-all limit of 10 items enforced; 11th write is a no-op.
- Dynamic items deduplicated by `selector` (legacy shape) and by `selectors[0]` (new array shape).
- Sticky items deduplicated by `id`.
- Items with `selectors: []` rejected.
- `save_blur_state(host, false)` correctly persists `false` (not silently skipped as falsy).
- Toggling blur-all off does not strip existing blur items (validate_model side-effect guard).
- `save_rules(null)` and `save_rules('string')` are no-ops; whitespace-only `hostname_value` entries are filtered.
- `save_rules` preserves exact entries; only wildcard/regex entries are replaced.
- `on_change` suppresses self-echo (own writes do not trigger subscriber).
- `on_change` ignores `'sync'` storage area and unrelated storage keys.
- `capture_snapshot` returns deep copies — mutating the result does not corrupt the cache.
- `capture_snapshot` reflects in-flight model changes.
- `validate_model` coerces out-of-range `blur_radius` (999) to default 8.
- `validate_model` strips unknown snapshot keys; repairs non-boolean `blur_categories` and invalid `pick_blur_color`.
- Empty snapshot `{}` passes through `validate_model` unmodified.
- `automate_blur_only` forces all blur-relevant keys to defaults even when global settings or exact site-rule overrides are in effect.
- `automate_blur_skipped` is set when blur-all or pick-and-blur is already active (avoids double-blur).
- Manual blur survives after automate trigger is cleared (only automate keys are cleared, not `blur_all`).
- `clear_host` atomically clears both `site_rules` entry and `automate_blur` session entry.

---

## Coverage Gaps

- `debounced_patch` is not directly tested (only `patch_section` is exercised).
- `get_all_site_rules` is not tested as a standalone call; site rules are queried indirectly via `get_site_entry` and `get_rules`.
- `clear_all` (wipe all hosts and reset model) has no test; only single-host `clear_host` is covered.
- `get_blur_items` is exercised as a side-effect of `save_blur_item` / `remove_blur_item` tests but has no dedicated isolation test (e.g. missing hostname, empty items array).
- `save_automate_blur` with the `screen_share` trigger and `tab_switch` trigger are exercised only via `patch_automate_blur`; individual `save_automate_blur` calls for those two triggers are not tested in isolation.
- Concurrent write races (two `patch_section` calls in flight simultaneously) are not tested.
- `chrome.storage.local.get` returning a runtime error (e.g. extension context invalidated) is not tested; no error-path test for `init_cache`.
- `save_blur_item` sticky-type geometry validation (negative `x`/`y`, zero `width`/`height`) is not tested.
- `save_rules` with a `regex` type entry is saved and counted but its matching behaviour via `resolve` is not exercised in this file (covered by `url_matcher.test.js`).
- `resolve` with multiple matching wildcard rules to verify first-match-wins ordering beyond the one existing test.
- `_reset_cache` interaction with an active `on_change` subscriber is not tested.
