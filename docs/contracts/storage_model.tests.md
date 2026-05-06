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

### `save_blur_state`

- `writes blur_all.status globally` — `save_blur_state(true)` flips `model.blur_all.status` to `true`.
- `false flip is persisted to storage` — `chrome.storage.local.set` is called with `model.blur_all.status === false`.

### `save_blur_item`

- `appends a dynamic item to the host entry` — saving `{ type: 'dynamic', selector: '#foo', name: 'Foo' }` results in `get_blur_items` returning one item with `selector === '#foo'`.
- `deduplicates dynamic items by selector` — saving two items with the same `selector` yields only one entry.
- `accepts dynamic item with new selectors[] array shape` — item with `selectors: ['body > div:nth-of-type(1)', '#foo']` (no `selector`) is stored; `items[0].selectors[0]` matches.
- `deduplicates new-shape selectors[] items by selectors[0]` — duplicate `selectors[0]` values are collapsed to one entry.
- `rejects dynamic item with empty selectors array` — `selectors: []` suppresses the storage write.
- `deduplicates sticky items by id` — two saves with the same `id` yield one item.
- `enforces per-host limit of 10 (constant from blsi.max_pick_blur_items_per_host)` — first 10 saves return `{ ok: true }`; 11th returns `{ ok: false, reason: 'cap' }` and the storage write is suppressed.
- `returns reason "duplicate" when item with same id already saved` — second save of the same selector returns `{ ok: false, reason: 'duplicate' }`.
- `returns reason "invalid" when item shape is bad` — items with unknown `type` return `{ ok: false, reason: 'invalid' }`.
- `rejects invalid item type` — unknown `type: 'bad'` suppresses the storage write.
- `rejects null item` — `null` item suppresses the storage write.
- `rejects empty hostname` — empty string hostname suppresses the storage write.
- `rejects __proto__ hostname (prototype pollution guard)` — `__proto__` is blocked.
- `rejects constructor hostname (prototype pollution guard)` — `constructor` is blocked.

### `remove_blur_item`

- `removes dynamic item by selector` — after saving items `#a` and `#b`, removing `#a` leaves only `#b`.
- `is a no-op when hostname not found` — remove on an unknown hostname does not call `chrome.storage.local.set`.

### `clear_host`

- `wipes pick-blur items for hostname, leaves other hosts intact` — after clearing `example.com`, `get_blur_items` returns `[]`; `other.com` items survive.
- `returns early for invalid hostname` — empty string suppresses the storage write.

### `get_rules / save_rules`

- `get_rules returns every site rule (exact, wildcard, regex)` — all entries surface regardless of `hostname_type`.
- `save_rules writes mixed entries` — exact + wildcard + regex are all persisted.
- `save_rules clears previous entries (full replace)` — second `save_rules` replaces the entire list; no auto-merge with prior state.
- `save_rules ignores non-array input` — `null` and string input suppress the storage write.
- `save_rules sanitizes entries — filters out items with empty hostname_value` — whitespace-only `hostname_value` is stripped; valid entries survive.

### `resolve`

- `returns flat object with all expected keys` — flat resolved object includes `blur_radius`, `enabled`, `reveal_mode`, `blur_categories`, `blur_mode`, `engage`, `blur_items`, `pick_blur_enabled`, `picker_mode`, `shortcuts`.
- `global engage used when no rule matches` — global `blur_all.status: true` propagates to `engage`.
- `exact hostname site_rule snapshot overrides global blur_mode` — a site rule with `snapshot.blur_all.settings.blur_mode: 'frosted'` overrides the global `blur_mode`.
- `snapshot blur_all.status=true forces engage even when global is off` — snapshot can pin a host on regardless of global toggle.
- `snapshot blur_all.status=false suppresses engage even when global is on` — snapshot can pin a host off regardless of global toggle.
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

This group uses its own `beforeEach` that seeds and inits a default model with idle and tab_switch enabled.

- `idle phase "idle" + feature-on → idle trigger fires` — `State.write_idle('idle')` results in `automate_blur_active === true` and `automate_blur_triggers.idle === true`.
- `idle phase "locked" also flips active` — locked phase treated as idle for trigger purposes.
- `idle phase "active" → no automate firing` — active phase does not fire any trigger.
- `idle feature OFF: phase "idle" does NOT flip active` — `idle.enabled: false` suppresses idle trigger even when phase is 'idle'.
- `tab_switch fired (per-tab) + feature-on → tab_switch trigger` — `State.write_tab_switch(7, 'fired')` with tab_id 7 fires the trigger for that tab.
- `tab_switch fired on a different tab does NOT affect this tab` — per-tab isolation: tab 7 fired does not affect tab 99.
- `tab_switch feature OFF: fired phase does NOT flip active` — `tab_switch.enabled: false` suppresses the trigger.
- `per-tab suppression via idle ignore_tabs silences idle for that tab` — `State.add_idle_ignore_tab(7)` silences idle for tab 7; other tabs still affected. `idle_suppressed_for_tab` is `true` for the silenced tab, `false` for others.
- `per-site suppression via idle ignore_sites silences idle for that site` — `State.add_idle_ignore_site('example.com')` silences idle for that hostname; other sites still affected. `idle_suppressed_for_site` is `true` for the silenced site, `false` for others.
- `engage is FALSE when only automate fires (engine no longer activates for automate)` — post-engine/automate-split, `engage` tracks blur-all only. `automate_blur_active` reflects the live trigger.
- `automate fires independently when blur_all already on` — global `blur_all.status: true` + automate firing keeps `automate_blur_active: true` AND `engage: true`. Manual blur and automate are independent — Overlay layers on top.
- `automate fires independently when pick_and_blur enabled` — `pick_and_blur.status: true` + screen-share firing sets `automate_blur_active: true`. Pick-blur reconciles via engine.handleSite; engage tracks blur-all only.
- `automate_blur_active is false when nothing firing` — flag is `false` by default.
- `manual blur preserved after automate cleared` — after clearing idle trigger, `engage` remains `true` from the persisted manual `blur_all: true`.

### `screen_share session record`

This group uses its own `beforeEach` that seeds and inits a default model with `screen_share.enabled = true`, and resets `Automate.State`.

- `set_screen_share_active stamps active flag, sharing tab id, and started_at` — `set_screen_share_active(42)` sets `active: true`, `sharing_tab_id: 42`, `started_at` ≥ current time, `suppressed_sites: []`.
- `set_screen_share_inactive clears the record` — after activating then deactivating, `active: false`, `sharing_tab_id: null`, `started_at: null`.
- `resolve: sharing tab itself does NOT receive screen-share blur` — the tab whose id matches `sharing_tab_id` has `triggers.screen_share === false`; other tabs have `true`.
- `resolve: feature disabled silences screen-share blur even when record is active` — `screen_share.enabled: false` suppresses the trigger even when session record is active.
- `suppress_screen_share("site_session") silences screen-share for that hostname only` — suppressing `example.com` sets `screen_share_suppressed_for_host: true` and silences the trigger for that host; `other.test` still fires.
- `suppress_screen_share("tab") silences screen_share for that tab (idle has own ignore)` — tab-scoped suppression silences screen_share for that tab only; idle trigger on the same tab is unaffected; other tabs still fire screen_share.
- `suppress_screen_share("feature") suspends the trigger but preserves the live share record` — suspending the feature writes `read_suspended().screen_share === true` and leaves `enabled` as `true` in the persisted model. **The live screen-share session record is preserved** (`ss.active === true`, `_sharing_tab_ids` still contains the sharing tab) — the suspend-gate alone is enough to silence receiver tabs via `resolve_automate`, and keeping the record means Resume re-blurs the still-running share without requiring the user to restart sharing. Real share teardown remains owned by `screen_share_bg.js` port disconnect.
- `unsuppress_screen_share reverses tab + site_session suppressions` — after suppressing both scopes then unsuppressing both, `screen_share_suppressed_for_host` and `screen_share_suppressed_for_tab` return to `false`; trigger fires again.
- `set_screen_share_active resets per-tab suppression list (mitigates tab-id reuse)` — starting a new share clears stale per-tab suppression entries from the previous share session.
- `resolve: screen_share fires independently when an exact rule blurs and ss is also live` — when a site rule pins blur-all on and screen_share is also active, both `engage: true` AND `automate_blur_triggers.screen_share: true` — manual blur (rule-driven) and automate layer independently.

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
- `updates .snapshot on an existing rule (does not duplicate)` — second `save_site_snapshot` call mutates the existing rule's snapshot in place; `get_rules` shows one entry.
- `replaces previous snapshot on a second save` — a second `save_site_snapshot` with a different `blur_mode` replaces the old snapshot; only the new value survives.
- `works for wildcard rules created via save_rules` — wildcard rules created by `save_rules` can have snapshots saved and retrieved via `get_site_snapshot`.
- `partial snapshot is auto-filled from current global before write` — caller-provided fields preserved; missing fields filled from current global (`automate.idle.value`/`unit`); all four sections present; no `settings` block.
- `is a no-op for invalid hostname_value` — empty string hostname suppresses the storage write.
- `is a no-op for invalid (null) snapshot` — `null` snapshot suppresses the storage write.

### `get_site_snapshot`

This group uses its own `beforeEach` that seeds and inits a default model.

- `returns null when rule does not exist` — unknown hostname returns `null`.
- `returns null when rule exists but snapshot is empty` — rule with `snapshot: {}` (set via `save_rules`) returns `null`.
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
- `non-snapshot keys in resolved output come from global/feature settings when no override` — keys not present in the snapshot (e.g. `engage`, `blur_items`) continue to be derived from the global model state.
- `snapshot.pick_and_blur.items REPLACE host-keyed items at resolve` — when the snapshot pins an items array, it overrides `pick_and_blur.items[hostname]` and stamps `_rule_overrides.blur_items`.
- `snapshot.automate.idle.value/unit override global at resolve` — full idle shape (value + unit + enabled) flows from snapshot into `resolved.automate_idle`.
- `PII fields in snapshot override global PII settings` — `pii_email`, `pii_numeric`, `pii_mode`, `pii_redaction_color` flow from snapshot into resolved + are flagged in `_rule_overrides`.
- `automate trigger.enabled in snapshot overrides global, preserves idle.value/unit` — rule's `automate.settings.idle.enabled = true` flips the resolved enable while `value`/`unit` keep their global values; same for tab_switch / screen_share. `_rule_overrides.automate_*` set.
- `_rule_match exposes the matching rule for popup deep-link` — wildcard match returns `{ hostname_value: '*.github.com', hostname_type: 'wildcard' }`.
- `exact rule snapshot wins over wildcard for _rule_match` — when both match, `_rule_match` reports the exact rule.
- `_rule_overrides empty when no rule matches` — for an unmatched host, `_rule_overrides` is `{}` and `_rule_match` is `null`.

### `resolve_automate`

Slim resolver consumed by the automate Manager. Step 1 of the engine/automate split — currently a thin slice over `resolve()`.

- `returns only the automate-decision fields` — `automate_blur_active`, `automate_blur_triggers`, `screen_share_state`, `screen_share_suppressed_for_*`, `idle_suppressed_for_tab`, `idle_suppressed_for_site`, `tab_switch_suppressed_for_tab`, `tab_switch_suppressed_for_site`, `automate_idle`, `automate_tab_switch`, `automate_screen_share`, `_rule_match` are present; manual-blur / settings-tree fields (`engage`, `blur_mode`, `blur_radius`, `blur_categories`, `blur_items`, `shortcuts`, `pii_*`) are absent. No skip-related fields.
- `values match resolve() output for automate keys` — derivation parity with the full resolver across all returned fields.
- `reflects per-host site-rule fold of automate gates` — site_rule snapshot flipping `automate.settings.idle.enabled = false` propagates into `resolved.automate_idle.enabled`.
- `omits tab_id → screen_share self-skip cannot apply` — calling with `tab_id = null` produces `screen_share_state.is_sharing_tab = false` (matches popup callers without an active tab id).

---

## Edge Cases Covered

- Empty or null hostname rejected across all per-host write operations (`save_blur_item`, `save_site_snapshot`, `clear_host`).
- Prototype-pollution hostnames (`__proto__`, `constructor`) explicitly blocked in `save_blur_item` and `save_automate_blur`.
- Per-host blur-all limit of 10 items enforced; 11th write is a no-op.
- Dynamic items deduplicated by `selector` (legacy shape) and by `selectors[0]` (new array shape).
- Sticky items deduplicated by `id`.
- Items with `selectors: []` rejected.
- `save_blur_state(false)` correctly persists `false` to global `blur_all.status` (not silently skipped as falsy).
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
- Each automate trigger fires independently of manual blur — there is no skip path or "automate-only" classification.
- Manual blur survives after automate trigger is cleared (only automate keys are cleared, not `blur_all`).
- `clear_host` atomically clears both `site_rules` entry and `automate_blur` session entry.

---

## Coverage Gaps

- `debounced_patch` is not directly tested (only `patch_section` is exercised).
- Site rules are queried via `get_rules` (returns every entry).
- `clear_all` (wipe all hosts and reset model) has no test; only single-host `clear_host` is covered.
- `get_blur_items` is exercised as a side-effect of `save_blur_item` / `remove_blur_item` tests but has no dedicated isolation test (e.g. missing hostname, empty items array).
- `save_automate_blur` with the `screen_share` trigger and `tab_switch` trigger are exercised only via `patch_automate_blur`; individual `save_automate_blur` calls for those two triggers are not tested in isolation.
- Concurrent write races (two `patch_section` calls in flight simultaneously) are not tested.
- `chrome.storage.local.get` returning a runtime error (e.g. extension context invalidated) is not tested; no error-path test for `init_cache`.
- `save_blur_item` sticky-type geometry validation (negative `x`/`y`, zero `width`/`height`) is not tested.
- `save_rules` with a `regex` type entry is saved and counted but its matching behaviour via `resolve` is not exercised in this file (covered by `url_matcher.test.js`).
- `resolve` with multiple matching wildcard rules to verify first-match-wins ordering beyond the one existing test.
- `_reset_cache` interaction with an active `on_change` subscriber is not tested.
