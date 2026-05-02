# storage_model Contract

## Overview

Single source of truth for extension persistent state. Accesses `chrome.storage.local` (key: `blsi_model`) and `chrome.storage.session` (keys: `blsi_screen_share`, `blsi_automate_suppressed_tabs`) directly — no background relay. Maintains in-memory caches (`_cache`, `_screen_share_cache`, `_suppressed_tabs_cache`) that mirror storage. Idle + tab_switch session keys live in `blsi.Automate.State` (sibling module); `resolve()` reads them at call time. `_write()` validates before persisting and rolls back the cache on failure. `resolve(hostname, url, tab_id?)` computes derived settings including `engage` (page-wide engine gate; folds extension on/off + manual + automate), screen-share trigger state, and suppression flags. Single pub-sub subscriber via `on_change`.

## Module State

| Variable | Description |
|---|---|
| `_cache` | `Object\|null` — full `blsi_model` in-memory; null before `init_cache()` |
| `_screen_share_cache` | `Object` — mirrors `blsi_screen_share` session storage; single global record `{ active, sharing_tab_id, started_at, suppressed_sites }` |
| `_suppressed_tabs_cache` | `number[]` — mirrors `blsi_automate_suppressed_tabs` session storage; tab ids silenced for ALL automate triggers |
| `_on_change` | `Function\|null` — legacy single storage-change subscriber (used by content_script's engine path until full migration) |
| `_on_automate_change` | `Function\|null` — automate Manager's storage-change subscriber (independent slot; fires on the same triggers as `_on_change` today) |
| `STORAGE_KEY` | `'blsi_model'` |
| `SCREEN_SHARE_SESSION_KEY` | `'blsi_screen_share'` |
| `SUPPRESSED_TABS_SESSION_KEY` | `'blsi_automate_suppressed_tabs'` |
| `ITEM_LIMIT` | `10` — max blur items per hostname |
| `RULES_LIMIT` | `200` — max non-exact site rules |

## Public API

### init_cache()

**What**: Loads `blsi_model` from local storage and the screen-share + suppressed-tabs session keys into caches. Idle + tab_switch caches live in `blsi.Automate.State` and self-hydrate. Must be called once before any `get()` or `patch_section()`.  
**Returns**: `Promise<void>`  
**Side effects**: Populates `_cache` (validates + migrates via `blsi.validate_model`); populates `_screen_share_cache`, `_suppressed_tabs_cache`; writes back if migration changed the model.  
**Handles**: Empty storage → seeds from `blsi.build_default_model()`. Missing session keys default to `_default_screen_share_state()` / `[]`.

### on_automate_change(listener)

**What**: Register the automate Manager's storage-change callback. Step 2 of the engine/automate split — gives `blsi.Automate.Manager` an independent subscription slot so engine and Manager can react in parallel without sharing a single `on_change` callback.  
**Params**: `listener(newModel, oldModel)` — same shape as `on_change`.  
**Returns**: void.  
**Side effects**: Single subscriber — calling twice replaces the first and logs a warning.  
**Fires when**: Today, in the same conditions as `on_change` (local model change OR any session-storage automate key change). Later refactors may narrow to "automate-relevant changes only" — current shape is conservative so Manager output-diffs catch no-ops.

### on_change(listener)

**What**: Registers a callback fired whenever the cached model changes.  
**Params**: `listener(newModel, oldModel)` — called with both model snapshots  
**Side effects**: Replaces previous subscriber (single subscriber only; replacement logs a warning)  
**Handles**: Called with `(cache, cache)` for session-only changes (idle / tab_switch / screen-share updates that don't change the main model).

### get()

**What**: Returns the full cached model (no I/O).  
**Returns**: `Object` — the current `_cache`; returns `blsi.build_default_model()` if `_cache` is null (before init).

### resolve(hostname, url, tab_id?)

**What**: Computes effective resolved settings for a hostname/URL/tab via ordered merge.  
**Params**: `hostname` (string), `url` (string), `tab_id` (number|null|undefined — optional). When `tab_id` is provided, per-tab automate suppression and the sharing-tab self-skip are applied. Popup callers should pass the active tab id; popup paths that don't have one pass `null` and accept hostname-level state only.  
**Returns**: Flat resolved settings object — all settings keys flattened, plus derived keys.  
**Merge order** (later entries override earlier):
1. `blsi.DEFAULT_MODEL` values
2. `global_default_settings`
3. Feature section settings (blur_all incl. `blur_all_status` from `blur_all.status`, pick_and_blur, auto_detect_pii, automate)
4. `blur_items` for hostname (pulled from `pick_and_blur.items[hostname]`, gated on `pick_and_blur.status`)
5. Wildcard/regex site rule snapshot apply (first match wins) — may REPLACE `blur_items` if the snapshot pins its own `pick_and_blur.items` array; may override `blur_all_status` if `snapshot.blur_all.status` is boolean
6. Exact hostname site rule snapshot apply — same REPLACE / override semantics
7. Automate trigger state — `blsi.Automate.State.read_idle()` (global) gated on `automate.idle.enabled`; `State.read_tab_switch(tab_id)` (per-tab) gated on `automate.tab_switch.enabled`; `_screen_share_cache` (single global record). Per-tab suppression silences all three triggers; per-site suppression silences screen-share only.
8. Derived key computation: `manual_blur = !!resolved.blur_all_status`; `engage = (resolved.enabled !== false) && manual_blur` (post-engine/automate-split — automate no longer folds into engage; pick-blur reconcile is unconditional inside `engine.handleSite`).

> **Note**: a previous version of this resolver also overrode 8 blur-relevant keys with `DEFAULT_MODEL` values when automate was the only active trigger ("automate_blur_only override"). That override has been removed — engine no longer activates for automate-only state, so the user's manual blur preferences cannot bleed into a render path that doesn't run.

**Screen-share trigger** (`automate_blur_triggers.screen_share`):

```
ss_blur_for_me_raw = ss.active
                     && tab_id !== ss.sharing_tab_id
                     && !ss.suppressed_sites.includes(hostname)
                     && model.automate.settings.screen_share.enabled
ss_blur_for_me     = !suppressed_tabs.includes(tab_id) && ss_blur_for_me_raw
```

Per-tab suppression silences all three triggers for that tab; per-site suppression silences screen-share only.

**Derived keys on output**: `engage`, `automate_blur_active`, `automate_blur_triggers`, `automate_blur_only`, `automate_blur_skipped`, `automate_blur_skip_reason`, `screen_share_state`, `screen_share_suppressed_for_host`, `screen_share_suppressed_for_tab`, `_rule_overrides`, `_rule_match`.  
**`engage`**: `(resolved.enabled !== false) && manual_blur` where `manual_blur = !!resolved.blur_all_status`. The page-wide engine gate read by `engine.js handleMainDocument` / `handleShadowRoot` / `handleIframe`. Post-engine/automate-split: automate is rendered via `blsi.Automate.Overlay` driven by `blsi.Automate.Manager` — engine teardown runs when only automate is firing. Pick-blur reconcile + CSS injection runs unconditionally inside `engine.handleSite`, independent of `engage`.  
**`automate_blur_skip_reason`**: `'site_rule' | 'manual' | 'pick_blur' | null`. Set when `automate_blur_skipped === true`; ordered priority site_rule > manual > pick_blur.  
**`screen_share_state`**: `{ active, sharing_tab_id, started_at, is_sharing_tab }` — passed to popup notif card for the "sharing for Xm" label.  
**`_rule_overrides`** / **`_rule_match`**: same as before; used by popup for "Managed by site rule" badges and deep-linking.

> **Note** (post-split): `resolve()` is now a thin shim over `resolve_settings()` + `resolve_automate()`. Engine code paths should call `resolve_settings()` directly to avoid the redundant automate fold. `resolve()` is retained for popup and any legacy callers that need the union.

### resolve_settings(hostname, url, tab_id?)

**What**: Engine surface — folded settings + the `engage` gate. Mirrors most of what `resolve()` returns but **excludes all automate-decision fields** (`automate_blur_active`, `automate_blur_triggers`, `automate_blur_only`, `automate_blur_skipped`, `automate_blur_skip_reason`, `screen_share_state`, `screen_share_suppressed_*`).

**Params**: same as `resolve()`. `tab_id` accepted for API symmetry; currently unused (resolve_settings does not consult per-tab automate state).

**Returns**: Flat resolved settings object — global + feature settings + site_rule overrides + `engage`. Includes `automate_idle`, `automate_tab_switch`, `automate_screen_share` (gate settings, post-rule fold) — these are settings, not decision fields.

**Engage formula**: `(enabled !== false) && manual_blur` where `manual_blur = !!resolved.blur_all_status`. **No automate term, no pick-blur term.** Automate is rendered via `blsi.Automate.Overlay` driven by `blsi.Automate.Manager` — engine teardown runs when only automate is firing. Pick-blur item reconcile + CSS injection runs unconditionally inside `engine.handleSite`, independent of `engage` (matches the historical behavior — `engage` only ever gated the blur-all CSS injection / stamp pass).

**Used by**: `content_script._sync` (engine path).

### resolve_automate(hostname, url, tab_id?)

**What**: Slim resolver that returns ONLY the automate-decision fields. Consumed by `blsi.Automate.Manager` (the new automate orchestrator) which reacts to `chrome.storage.session` transitions independently of the engine.

**Step 1 of the engine/automate split.** Currently a thin wrapper over `resolve()` — runs the full fold and projects the automate slice. Step 5 will refactor the underlying fold so `resolve()` and `resolve_automate()` no longer duplicate the global → site_rule → snapshot pass. Until then there is no perf win; this exists to give the Manager a focused, stable surface so the rest of the split can land incrementally.

**Params**: same as `resolve()`.

**Returns**: `{ automate_blur_active, automate_blur_triggers, automate_blur_only, automate_blur_skipped, automate_blur_skip_reason, screen_share_state, screen_share_suppressed_for_host, screen_share_suppressed_for_tab, automate_idle, automate_tab_switch, automate_screen_share, _rule_match, _rule_overrides_automate }`. `_rule_overrides_automate` is a slim slice over `resolve()._rule_overrides` carrying only the three automate gate keys (`automate_idle`, `automate_tab_switch`, `automate_screen_share`) — Manager uses these to decide whether each automate toast should carry a "(site rule)" suffix. No manual-blur fields, no `blur_items`, no `shortcuts`, no `engage`. Engine never calls this; Manager never calls `resolve()`.

### patch_section(section, delta)

**What**: Deep-merges `delta` into the named top-level section and persists.  
**Params**: `section` (string) — top-level key; `delta` (object) — partial patch  
**Returns**: `Promise<void>`  
**Side effects**: Validates via `blsi.validate_model` before write; updates `_cache`; on failure rolls back `_cache` to pre-patch state.

### debounced_patch(section, delta, delay?)

**What**: Batched version of `patch_section`; merges rapid calls within `delay` ms into one write.  
**Params**: `delay` (number, optional) — default 150ms  
**Returns**: `void` (fire-and-forget; use `patch_section` when you need the write to complete before continuing)

### save_settings(patch)

**What**: Merges a partial patch into `global_default_settings`.  
**Params**: `patch` (object) — partial settings; non-object inputs are guarded  
**Returns**: `Promise<void>`  
**Handles**: Non-object `patch` → logged warning, no-op.

### save_blur_state(is_active)

**What**: Flips the global `blur_all.status`. Toggling on any tab affects every tab — there are no per-host blur-all overrides outside of explicit site rules created via the Site Rules form.  
**Params**: `is_active` (boolean)  
**Returns**: `Promise<void>`

### get_blur_items(host)

**What**: Returns the array of blur items for a host from cache.  
**Params**: `host` (string)  
**Returns**: `Array` — blur items; empty array if no entry

### save_blur_item(hostname, item)

**What**: Saves a blur item for a hostname; deduplicates by item ID before insert; enforces `ITEM_LIMIT`.  
**Params**: `hostname` (string), `item` (object) — dynamic or sticky item shape  
**Returns**: `Promise<void>`  
**Handles**: Validates hostname and item; deduplicates (replaces existing entry with same ID); trims to `ITEM_LIMIT` (oldest entries removed first).

### remove_blur_item(hostname, item_id)

**What**: Removes a blur item by ID.  
**Returns**: `Promise<void>` — no-op if hostname not found.

### capture_snapshot(hostname?)

**What**: Reads current global settings from cache and returns a nested snapshot object.  
**Params**: `hostname` (string, optional) — when provided, captures the host's pick-blur items into `pick_and_blur.items`. Omitted/empty → `items: []`.  
**Returns**: `{ blur_all, pick_and_blur, auto_detect_pii, automate }` — deep-copies `blur_categories`, `blur_color`, `pick_and_blur.items`. `blur_all` carries `{ status, settings }` (status from global `blur_all.status` so a saved snapshot can pin a host on/off). The `automate.settings.idle` block carries the full `{ value, unit, enabled }` shape; `tab_switch` and `screen_share` carry only `enabled`.  
**Excludes**: site_rules, shortcuts, global_default_settings (entire section)

### save_site_snapshot(hostname_value, hostname_type, snapshot)

**What**: Sets the `.snapshot` field on the matching site rule entry.  
**Params**: `hostname_value`, `hostname_type`, `snapshot` (nested snapshot object — full or `{}`)  
**Returns**: `Promise<void>`  
**Handles**: Creates entry if not found; works for all `hostname_type` values.  
**Full-snapshot enforcement**: non-empty `snapshot` is auto-filled to the full `capture_snapshot()` shape — partial inputs are deep-merged over the current global so every snapshot field has a value. Empty `{}` stays empty (sentinel meaning "rule pins blur_all toggle only — no setting overrides"). The auto-fill calls `capture_snapshot()` with no hostname arg, so missing `pick_and_blur.items` defaults to `[]`. Callers that want host items pinned must pass them explicitly in the snapshot payload (typically captured via `capture_snapshot(hostname)`).

### clear_site_snapshot(hostname_value, hostname_type)

**What**: Resets `.snapshot` to `{}` for the matching rule.  
**Returns**: `Promise<void>` — no-op if rule not found.

### get_site_snapshot(hostname_value, hostname_type)

**What**: Returns the snapshot object for the matching rule.  
**Returns**: `Object|null` — `null` if rule not found OR if snapshot is empty `{}`.  
**Synchronous** (reads from `_cache`).

### Automate trigger state — idle & tab_switch

Idle (global) and tab_switch (per-tab) state moved to `blsi.Automate.State`
(see `docs/contracts/automate/state.md`). `storage_model.resolve()` reads
both at call time via `State.read_idle()` and `State.read_tab_switch(tab_id)`.

The legacy per-hostname `blsi_automate_blur` key + the
`save_automate_blur` / `patch_automate_blur` / `clear_automate_blur` /
`get_automate_blur` API are removed. Callers writing trigger state should use
`blsi.Automate.State.write_idle` / `write_tab_switch` directly.

### get_screen_share_state()

**What**: Returns the global screen-share session record (single source of truth).  
**Returns**: `{ active, sharing_tab_id, started_at, suppressed_sites }` — copy of `_screen_share_cache` (suppressed_sites array cloned).  
**Synchronous** — no I/O.

### set_screen_share_active(sharing_tab_id)

**What**: Mark a screen share as active. Each new share starts with cleared suppression maps so a stale per-site suppression from a prior share never silently carries over. Also clears the global per-tab suppression list to mitigate Chrome tab-id reuse on closed tabs.  
**Params**: `sharing_tab_id` (number|null)  
**Returns**: `Promise<void>`  
**Side effects**: Writes both `blsi_screen_share` and `blsi_automate_suppressed_tabs` session keys.

### set_screen_share_inactive()

**What**: Reset the screen-share record to its empty default.  
**Returns**: `Promise<void>`

### suppress_screen_share(scope, ctx)

**What**: Suppress screen-share blur at a chosen scope.  
**Params**:  
- `scope`: `'tab' | 'site_session' | 'feature'`  
- `ctx`: `{ hostname?, tab_id? }`  

**Routing**:
- `'tab'` — push `tab_id` to `blsi_automate_suppressed_tabs` (silences ALL automate triggers for that tab, not just screen-share).  
- `'site_session'` — push `hostname` to `blsi_screen_share.suppressed_sites[]` (screen-share only; session-scoped).  
- `'feature'` — set `automate.settings.screen_share.enabled = false` in the model AND clear the screen-share session record.  

**Returns**: `Promise<void>`  
**Handles**: No-op if the value is already suppressed at that scope; invalid hostnames / tab ids → no-op.

### unsuppress_screen_share(scope, ctx)

**What**: Reverse a prior `suppress_screen_share` at the same scope.  
**Params**: same shape as `suppress_screen_share`.  
**Returns**: `Promise<void>`.

### get_suppressed_tabs()

**What**: Returns the current list of tab ids silenced for ALL automate triggers.  
**Returns**: `number[]` (copy of cache).  
**Synchronous**.

### add_suppressed_tab(tab_id)

**What**: Low-level write — push a tab id into the global suppression list.  
**Params**: `tab_id` (number).  
**Returns**: `Promise<void>` (no-op for non-numbers / already-suppressed ids).

### remove_suppressed_tab(tab_id)

**What**: Inverse of `add_suppressed_tab`. Used by `chrome.tabs.onRemoved` cleanup in `background.js` and by popup Undo affordance.  
**Returns**: `Promise<void>`.

### clear_suppressed_tabs()

**What**: Empty the per-tab suppression list.  
**Returns**: `Promise<void>` — no-op when already empty.

### clear_host(hostname)

**What**: Clears pick-blur items for the host in local storage. Does not touch automate trigger state — that's per-tab/global, not per-host.  
**Returns**: `Promise<void>`  
**Note**: Preserves site_rules entries — does not touch them. blur_all is global; clear it via `save_blur_state(false)` if needed.

### get_rules() / save_rules(rules)

**What**: Site rules CRUD. Returns/accepts every entry in `site_rules[]` regardless of `hostname_type`.  
**`get_rules`**: shallow copy of `_cache.site_rules`.  
**`save_rules`**: full-replace. Validates each entry (`hostname_value` trimmed/sliced, `hostname_type` falls back to `wildcard` if invalid, `snapshot` defaults to `{}`); enforces `RULES_LIMIT`. No exact-preservation, no auto-merge with prior state.

### _reset_cache()

**What**: Test-only — clears `_cache`, `_screen_share_cache`, and `_suppressed_tabs_cache` so tests start clean. Idle/tab_switch caches live in `blsi.Automate.State` — call `State._reset()` separately when needed.  
**Returns**: `void`

## Internal Functions

### _write(next)

**What**: Validates model via `blsi.validate_model()`, updates `_cache` synchronously, writes to `chrome.storage.local`, rolls back `_cache` on failure.  
**Critical**: `_cache` is updated BEFORE the async write — all sync reads see the new value immediately.

### `chrome.storage.onChanged` listener

**What**: Handles storage changes from other contexts. Checks both `local` (model) and `session` (screen-share, suppressed tabs, plus the State module's idle / tab_switch keys for re-fire). Self-echo guard via `_deep_equal` prevents redundant subscriber fires. For session-only changes, calls subscriber with `(cache, cache)`.

### _deep_equal(a, b)

**What**: Recursive structural equality; handles null, arrays, objects. Used for self-echo guard.

### _is_valid_hostname(h)

**What**: Guards against prototype pollution (`__proto__`, `constructor`, `prototype`); valid length 1–253.

### _is_valid_item(item)

**What**: Validates dynamic and sticky item shapes; supports both legacy (`selector: string`) and new (`selectors: string[]`) dynamic shapes; `selectors` max 6, each max 2000 chars.

### _get_item_id(item)

**What**: Returns `selectors[0]` for new dynamic shape, `selector` for legacy, `id` for sticky.

### _find_rule_idx(hostname_value, hostname_type)

**What**: Linear scan; composite key match on both fields; returns `-1` if not found.

### _apply_snapshot(snapshot, resolved)

**What**: In-place merge of snapshot into the resolved object; maps nested snapshot shape to flat resolved keys. Stamps `resolved._rule_overrides[flat_key] = true` for every key it writes so downstream UI can detect rule-driven fields without re-walking storage. Handles `blur_all.{status, settings.*}`, `pick_and_blur.{status, settings.*, items}`, `auto_detect_pii.settings.*`, and `automate.settings.{idle, tab_switch, screen_share}`. `blur_all.status` (boolean) overrides `resolved.blur_all_status`. For `automate.settings.idle` the snapshot may carry any subset of `{ value, unit, enabled }` — each present field merges into the resolved `automate_idle` shape (`tab_switch` / `screen_share` still take `enabled` only). `pick_and_blur.items` is REPLACE semantics — when present (any array, including `[]`) it overwrites `resolved.blur_items`, gated on the post-snapshot `resolved.pick_blur_enabled`. Stamps `_rule_overrides.blur_items` when applied.

**Snapshot shape**: under the full-snapshot contract (enforced at write-time by `save_site_snapshot` and at load-time by `validate_model`), non-empty snapshots always carry every key produced by `capture_snapshot()` (no `settings` block — that was global_default_settings, dropped). Empty `{}` is the sentinel for "no setting overrides" — `_apply_snapshot` skips silently. Per-key existence checks remain in place for defense-in-depth in case callers bypass the contract.

### _fill_snapshot_to_full(partial)

**What**: Returns a full snapshot by deep-merging `partial` over `capture_snapshot()`'s output (current global, with no hostname → `pick_and_blur.items: []`). Used by `save_site_snapshot` to enforce the full-snapshot contract before write. Private — exposed as a tested behaviour but not part of the public API. Note: callers that need items pinned must include `pick_and_blur.items` in `partial` (typically via `capture_snapshot(hostname)`); otherwise the auto-fill produces `items: []`.

## Storage Schema

| Storage | Key | Contents | Owner |
|---|---|---|---|
| `chrome.storage.local` | `blsi_model` | Full feature-grouped model (see Settings Shape in CLAUDE.md) | `storage_model` |
| `chrome.storage.session` | `blsi_screen_share` | Single global record `{ active, sharing_tab_id, started_at, suppressed_sites }` | `storage_model` |
| `chrome.storage.session` | `blsi_automate_suppressed_tabs` | `number[]` of tab ids silenced for ALL automate triggers | `storage_model` |
| `chrome.storage.session` | `blsi_automate_idle` | One of `'active'\|'idle'\|'locked'` (chrome.idle phase) — global | `automate/state.js` |
| `chrome.storage.session` | `blsi_automate_tab_switch_by_tab` | `{ [tab_id]: 'fired' }` (absent === armed/off) | `automate/state.js` |

## Invariants

- `_cache` is `null` before `init_cache()` completes; never `null` after.
- `_write()` always validates before persisting; `_cache` rolls back on failure.
- `resolve()` always returns a complete flat object (all keys present).
- Pattern rules (wildcard/regex) always precede exact rules in `site_rules[]`.
- `ITEM_LIMIT = 10` per hostname; enforced on every `save_blur_item`.
- `RULES_LIMIT = 200` for non-exact rules; enforced on every `save_rules`.
- `on_change` has at most one active subscriber at any time.
- Automate triggers NEVER write `blur_all` — idle/tab_switch state lives in `blsi.Automate.State` session keys; screen-share lives in the global session record.
