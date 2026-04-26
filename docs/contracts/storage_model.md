# storage_model Contract

## Overview

Single source of truth for extension persistent state. Accesses `chrome.storage.local` (key: `blsi_model`) and `chrome.storage.session` (key: `blsi_automate_blur`) directly — no background relay. Maintains in-memory caches (`_cache`, `_automate_cache`) that mirror storage. `_write()` validates before persisting and rolls back the cache on failure. `resolve()` computes derived settings including `blur_all_active`. Single pub-sub subscriber via `on_change`.

## Module State

| Variable | Description |
|---|---|
| `_cache` | `Object\|null` — full `blsi_model` in-memory; null before `init_cache()` |
| `_automate_cache` | `Object` — mirrors `blsi_automate_blur` session storage |
| `_on_change` | `Function\|null` — single storage-change subscriber |
| `STORAGE_KEY` | `'blsi_model'` |
| `AUTOMATE_SESSION_KEY` | `'blsi_automate_blur'` |
| `ITEM_LIMIT` | `10` — max blur items per hostname |
| `RULES_LIMIT` | `200` — max non-exact site rules |

## Public API

### init_cache()

**What**: Loads `blsi_model` from local storage and `blsi_automate_blur` from session into caches. Must be called once before any `get()` or `patch_section()`.  
**Returns**: `Promise<void>`  
**Side effects**: Populates `_cache` (validates + migrates via `blsi.validate_model`); populates `_automate_cache`; writes back if migration changed the model.  
**Handles**: Empty storage → seeds from `blsi.build_default_model()`.

### on_change(listener)

**What**: Registers a callback fired whenever the cached model changes.  
**Params**: `listener(newModel, oldModel)` — called with both model snapshots  
**Side effects**: Replaces previous subscriber (single subscriber only; replacement logs a warning)  
**Handles**: Called with `(cache, cache)` for session-only changes (automate_blur updates that don't change the main model).

### get()

**What**: Returns the full cached model (no I/O).  
**Returns**: `Object` — the current `_cache`; returns `blsi.build_default_model()` if `_cache` is null (before init).

### resolve(hostname, url)

**What**: Computes effective resolved settings for a hostname/URL via 9-step ordered merge.  
**Params**: `hostname` (string), `url` (string)  
**Returns**: Flat resolved settings object — all settings keys flattened, plus derived keys  
**Merge order** (later entries override earlier):
1. `blsi.DEFAULT_MODEL` values
2. `global_default_settings`
3. Feature section settings (blur_all, pick_and_blur, auto_detect_pii, automate)
4. Wildcard/regex site rule match (first match wins)
5. Exact hostname site rule
6. Automate blur state from `_automate_cache`
7. `automate_blur_only` override (overrides 8 settings with DEFAULT_MODEL when automate is the only active trigger)
8. Snapshot application (if site rule has a snapshot)
9. Derived key computation

**Derived keys on output**: `blur_all_active`, `automate_blur_active`, `automate_blur_triggers`, `automate_blur_only`, `automate_blur_skipped`, `_rule_overrides`, `_rule_match`  
**`blur_all_active`**: `manual_blur || automate_any` where `automate_any = idle || tab_switch || screen_share`  
**`_rule_overrides`**: `{ [flat_key]: true }` map listing every resolved field that came from a site rule snapshot (e.g. `{ pii_email: true, automate_screen_share: true, blur_mode: true }`). Used by popup to render "Managed by site rule" badges + read-only controls; used by content_script to append `(site rule)` to toasts. Empty `{}` when no rule matched.  
**`_rule_match`**: `{ hostname_value, hostname_type } | null` — the rule whose snapshot fed `_rule_overrides`. Exact-rule match wins over wildcard/regex when both apply. Used to deep-link from the popup badge to the matching rule card.

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

### get_cached_blur_state(host)

**What**: Returns the current blur-all state for a host from cache.  
**Params**: `host` (string)  
**Returns**: `boolean|null` — `true`/`false` if explicitly set; `null` if no entry (means use global)

### save_blur_state(host, state)

**What**: Writes blur-all state for a host to storage.  
**Params**: `host` (string), `state` (boolean)  
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

### get_all_site_rules()

**What**: Returns all site rules from cache.  
**Returns**: `Array` — `site_rules` from `_cache`

### get_site_entry(hostname_value, hostname_type)

**What**: Finds a site rule by composite key.  
**Params**: `hostname_value` (string), `hostname_type` (`'exact'|'wildcard'|'regex'`)  
**Returns**: `Object|null`

### set_site_entry(hostname_value, hostname_type, patch)

**What**: Creates or updates a site rule entry via deep-merge.  
**Params**: `hostname_value`, `hostname_type`, `patch` (partial entry)  
**Returns**: `Promise<void>`  
**Handles**: Creates new entry if not found; uses `deep_merge` so callers can partial-patch.

### remove_site_entry(hostname_value, hostname_type)

**What**: Removes a site rule entry.  
**Returns**: `Promise<void>` — no-op if not found.

### capture_snapshot()

**What**: Reads current global settings from cache and returns a nested snapshot object.  
**Returns**: `{ settings, blur_all, pick_and_blur, auto_detect_pii, automate }` — deep-copies `blur_categories`, `blur_color`. The `automate` section captures only `{ idle, tab_switch, screen_share }.enabled` — NOT idle `value` / `unit` (those remain global-only).  
**Excludes**: site_rules, shortcuts, enabled, language, automate idle.value/unit, pick_and_blur.items

### save_site_snapshot(hostname_value, hostname_type, snapshot)

**What**: Sets the `.snapshot` field on the matching site rule entry.  
**Params**: `hostname_value`, `hostname_type`, `snapshot` (nested snapshot object)  
**Returns**: `Promise<void>`  
**Handles**: Creates entry if not found; works for all `hostname_type` values.

### clear_site_snapshot(hostname_value, hostname_type)

**What**: Resets `.snapshot` to `{}` for the matching rule.  
**Returns**: `Promise<void>` — no-op if rule not found.

### get_site_snapshot(hostname_value, hostname_type)

**What**: Returns the snapshot object for the matching rule.  
**Returns**: `Object|null` — `null` if rule not found OR if snapshot is empty `{}`.  
**Synchronous** (reads from `_cache`).

### get_automate_blur(hostname)

**What**: Returns the current automate trigger state for a hostname.  
**Params**: `hostname` (string)  
**Returns**: `{ idle: bool, tab_switch: bool, screen_share: bool }` from `_automate_cache`  
**Synchronous** — no I/O.

### save_automate_blur(hostname, trigger, bool)

**What**: Writes one automate trigger to session storage.  
**Params**: `hostname` (string), `trigger` (`'idle'|'tab_switch'|'screen_share'`), `bool` (boolean)  
**Returns**: `Promise<void>`  
**Handles**: Invalid trigger → logged warning, no-op; merges into existing entry (preserves other triggers).

### patch_automate_blur(hostname, patch)

**What**: Batch-writes multiple triggers in one session storage write.  
**Params**: `hostname` (string), `patch` (`{idle?, tab_switch?, screen_share?}`)  
**Returns**: `Promise<void>`  
**Handles**: Silently ignores invalid keys in patch.

### clear_automate_blur(hostname)

**What**: Removes all automate_blur state for a hostname from session storage.  
**Returns**: `Promise<void>`

### clear_host(hostname)

**What**: Clears `blur_all` + items for the host in local storage; clears automate_blur in session storage.  
**Returns**: `Promise<void>`  
**Note**: Preserves snapshots — does not clear `.snapshot` fields.

### clear_all()

**What**: Clears `blur_all` + items for ALL hosts in local storage; resets session storage to `{}`.  
**Returns**: `Promise<void>`

### get_rules() / save_rules(rules)

**What**: URL pattern rules CRUD. Pattern rules (wildcard/regex) always precede exact rules in `site_rules[]`.  
**`save_rules`**: Preserves existing exact-type rules; prepends pattern rules; enforces `RULES_LIMIT`; normalizes `hostname_value` (trim/slice); strips exact-type entries from incoming.

### _reset_cache()

**What**: Test-only — clears both `_cache` and `_automate_cache` so tests start clean.  
**Returns**: `void`

## Internal Functions

### _write(next)

**What**: Validates model via `blsi.validate_model()`, updates `_cache` synchronously, writes to `chrome.storage.local`, rolls back `_cache` on failure.  
**Critical**: `_cache` is updated BEFORE the async write — all sync reads see the new value immediately.

### _session_write(data)

**What**: Mirrors `_write` for session storage — updates `_automate_cache` synchronously, writes to `chrome.storage.session`, rolls back on failure.

### `chrome.storage.onChanged` listener

**What**: Handles storage changes from other contexts. Checks both `local` (model) and `session` (automate) areas. Self-echo guard via `_deep_equal` prevents redundant subscriber fires. For session-only changes, calls subscriber with `(cache, cache)`.

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

**What**: In-place merge of snapshot into the resolved object; maps nested snapshot shape to flat resolved keys. Stamps `resolved._rule_overrides[flat_key] = true` for every key it writes so downstream UI can detect rule-driven fields without re-walking storage. Handles the new `auto_detect_pii.settings.*` and `automate.settings.{idle,tab_switch,screen_share}.enabled` sections; the automate spread preserves global `value`/`unit` while the rule flips `enabled`.

## Storage Schema

| Storage | Key | Contents |
|---|---|---|
| `chrome.storage.local` | `blsi_model` | Full feature-grouped model (see Settings Shape in CLAUDE.md) |
| `chrome.storage.session` | `blsi_automate_blur` | `{ [hostname]: { idle, tab_switch, screen_share } }` — auto-cleared on browser close |

## Invariants

- `_cache` is `null` before `init_cache()` completes; never `null` after.
- `_write()` always validates before persisting; `_cache` rolls back on failure.
- `resolve()` always returns a complete flat object (all keys present).
- Pattern rules (wildcard/regex) always precede exact rules in `site_rules[]`.
- `ITEM_LIMIT = 10` per hostname; enforced on every `save_blur_item`.
- `RULES_LIMIT = 200` for non-exact rules; enforced on every `save_rules`.
- `on_change` has at most one active subscriber at any time.
- Automate triggers NEVER write `blur_all` — they only write to `blsi_automate_blur` session storage.
