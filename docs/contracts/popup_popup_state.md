# Contract: popup/popup_state.js

## Purpose
Sole owner of `blsi.Model` access in the popup. Caches a snapshot of the full model plus hostname-specific derived state (blur items, page-blur flag, active site rule). All popup writes flow through here; render files and `popup.js` never touch `blsi.Model` directly.

Window global: `BlurrySitePopupState`.

## Dependencies
- `blsi.Model` — storage_model APIs
- `blsi.UrlMatcher` — pattern matching for active-rule derivation
- `blsi.build_default_model` — fallback when `_model` not yet loaded

## Private state
- `_model` — full `blsi.Model` snapshot or `null` until `load()`
- `_blurItems` — array of pick-and-blur items for `_hostname`. Always reflects storage; **not gated by `pick_and_blur.status`** (popup needs the count to render the paused-items message).
- `_hostname`, `_url` — current tab context, set by `load()`
- `_activeRule` — site_rules entry matching current page (regex/wildcard first, then exact-host with non-empty snapshot)
- `_isPageBlurred` — manual blur OR any automate trigger
- `_neutralAfterClear` — UI flag for post-clear empty state

## Public API

### `load(hostname, url, tabId) → Promise<void>`
Initializes hostname/url/tabId, calls `blsi.Model.init_cache()`, then `refreshFromStorage()`. `tabId` is the active tab id from `chrome.tabs.query({ active: true })` — passed into every `blsi.Model.resolve()` call so per-tab automate suppression and the sharing-tab self-skip stay coherent. Pass `null` when no tab id is available; resolve will treat the popup as a non-suppressible non-sharing tab.

### `get() → { settings, resolved, ruleOverrides, ruleMatch, blurItems, hostname, tabId, isPageBlurred, neutralAfterClear, activeRule }`
Returns current snapshot. `settings` is the model object plus runtime extras derived from `Store.resolve(_hostname, _url, _tabId)`:
- `automate_blur_active` — boolean, any trigger active (after suppression filters)
- `automate_blur_triggers` — `{ idle, tab_switch, screen_share }`
- `automate_blur_skipped` — boolean
- `automate_blur_skip_reason` — `'site_rule' | 'manual' | 'pick_blur' | null`
- `screen_share_state` — `{ active, sharing_tab_id, started_at, is_sharing_tab }`
- `screen_share_suppressed_for_host` — boolean
- `screen_share_suppressed_for_tab` — boolean

When `_model` is null, falls back to `blsi.build_default_model()`.

### `setNeutralAfterClear(b) → void`
Sets internal flag (coerced boolean).

### `refreshFromStorage() → void`
Re-reads `_model`, `_activeRule`, `_blurItems`, `_isPageBlurred` from `blsi.Model` cache. Called after every write. `_blurItems` is always loaded from storage regardless of `pick_and_blur.status`.

### `saveSettings(patch) → Promise<void>`
Top-level keys of `patch` must be model sections (`global_default_settings`, `blur_all`, `pick_and_blur`, `auto_detect_pii`, `automate`, `shortcuts`, `site_rules`). Calls `patch_section` per key in parallel, then `refreshFromStorage()`.

**Rule-managed guard**: when the current host has a non-empty site-rule snapshot (detected via `blsi.Model.resolve()` → `_rule_match` truthy + `_rule_overrides` non-empty), snapshot-managed sections are stripped from the patch before write:
- `blur_all`, `pick_and_blur`, `auto_detect_pii`, `automate` — dropped entirely
- `global_default_settings`, `shortcuts`, `site_rules` pass through unchanged (the snapshot no longer captures any global_default_settings keys, so all per-user display knobs remain editable)

If everything was filtered, the call no-ops with a logger warning. Defence-in-depth — the popup UI hides controls that would generate these patches, but a stale render or external storage event could still trigger them.

Edge: `patch` falsy or non-object → no-op.

### `get().settings` rule metadata
The settings object returned by `get()` is extended with two fields read from `resolve()` so render files can call `BlurrySitePopupShared.isRuleManaged(settings)` directly:
- `settings._rule_match` — `{ hostname_value, hostname_type } | null` — the rule (wildcard/regex/exact) governing the current URL, or null.
- `settings._rule_overrides` — `{ [flat_key]: true }` — every resolved field set by a snapshot. Empty when no snapshot applies.

### `saveBlurState(checked) → Promise<void>`
Flips global `blur_all.status` via `blsi.Model.save_blur_state(checked)`. No `_hostname` arg — the toggle is global, every tab reflects the change.

### `removeBlurItem(itemId) → Promise<void>`
Removes one pick-blur item. No-op when `_hostname` or `itemId` falsy.

### `clearHost() → Promise<void>`
Clears all per-host state for `_hostname`. No-op when empty.

### `clearAutomateBlur() → Promise<void>`
Clears all automate triggers (idle + tab_switch) for `_hostname` AND removes the active tab id from the global per-tab automate suppression list — keeps the "Turn off" button predictable. Screen-share is global and is left alone.

### `suppressScreenShare(scope) → Promise<void>`
`scope ∈ 'tab' | 'site_session' | 'feature'`. Wraps `blsi.Model.suppress_screen_share(scope, { hostname: _hostname, tab_id: _tabId })` then refreshes.

### `unsuppressScreenShare(scope) → Promise<void>`
Inverse of `suppressScreenShare`. Used by the popup notif card's Undo affordance.

### `saveRules(newRules) → Promise<void>`
Replaces full site_rules array via `blsi.Model.save_rules`. Does not auto-refresh — caller decides (rules don't change derived popup state directly).

### `captureSnapshot() → object`
Wraps `blsi.Model.capture_snapshot()`.

### `saveSiteSnapshot(hostname_value, hostname_type, snapshot) → Promise<void>`
Wraps `blsi.Model.save_site_snapshot`.

### `getRules() → Promise<Array>`
Wraps `blsi.Model.get_rules()`.

### `exportModel() → object`
Returns raw `blsi.Model.get()` snapshot for JSON export. No runtime extras.

### `importSettings(model) → Promise<void>`
Sequentially patches every top-level key of `model` via `patch_section`, then refreshes.

### `onExternalChange(cb) → void`
Subscribes `cb(newModel, oldModel)` to `blsi.Model.on_change` — fires when storage mutates from another context (content script, other popup).

## Edge cases
- `_hostname === ''` (e.g. `chrome://newtab`): `refreshFromStorage()` derives `_isPageBlurred` from `_model.blur_all.status` only; per-host writes (`removeBlurItem`, `clearHost`, `clearAutomateBlur`) no-op. `saveBlurState` is global and works regardless of `_hostname`.
- `_tabId == null`: `Store.resolve` treats the popup as a non-suppressible non-sharing tab — per-tab Undo state in the notif card silently won't fire (popup just always reads as "not suppressed").
- `_model` null before `load()`: `get()` returns default model so renderers can run during boot.
- Active rule precedence: `_computeActiveRule` iterates `site_rules[]` once — first non-empty-snapshot rule that matches wins (URL match for wildcard/regex; hostname equality for exact). Empty-snapshot rules don't count as "rules" — they have no overrides.

## Side effects
All writes go to `chrome.storage.local` (model) or `chrome.storage.session` (`blsi_automate_blur`, `blsi_screen_share`, `blsi_automate_suppressed_tabs`) via `blsi.Model`. No direct `chrome.storage.*` access in this module.
