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

### `load(hostname, url) → Promise<void>`
Initializes hostname/url, calls `blsi.Model.init_cache()`, then `refreshFromStorage()`.

### `get() → { settings, blurItems, hostname, isPageBlurred, neutralAfterClear, activeRule }`
Returns current snapshot. `settings` is the model object plus two runtime extras:
- `automate_blur_active` — boolean, any trigger active
- `automate_blur_triggers` — `{ idle, tab_switch, screen_share }`

When `_model` is null, falls back to `blsi.build_default_model()`.

### `setNeutralAfterClear(b) → void`
Sets internal flag (coerced boolean).

### `refreshFromStorage() → void`
Re-reads `_model`, `_activeRule`, `_blurItems`, `_isPageBlurred` from `blsi.Model` cache. Called after every write. `_blurItems` is always loaded from storage regardless of `pick_and_blur.status`.

### `saveSettings(patch) → Promise<void>`
Top-level keys of `patch` must be model sections (`global_default_settings`, `blur_all`, `pick_and_blur`, `auto_detect_pii`, `automate`, `shortcuts`, `site_rules`). Calls `patch_section` per key in parallel, then `refreshFromStorage()`.

Edge: `patch` falsy or non-object → no-op.

### `saveBlurState(checked) → Promise<void>`
Writes blur-all status for `_hostname`. No-op when `_hostname` empty.

### `removeBlurItem(itemId) → Promise<void>`
Removes one pick-blur item. No-op when `_hostname` or `itemId` falsy.

### `clearHost() → Promise<void>`
Clears all per-host state for `_hostname`. No-op when empty.

### `clearAutomateBlur() → Promise<void>`
Clears all automate triggers for `_hostname`.

### `clearScreenShareBlur() → Promise<void>`
Clears only the `screen_share` automate trigger for `_hostname`.

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
- `_hostname === ''` (e.g. `chrome://newtab`): `refreshFromStorage()` derives `_isPageBlurred` from `_model.blur_all.status` only; per-host writes (`saveBlurState`, `removeBlurItem`, `clearHost`, `clearAutomateBlur`, `clearScreenShareBlur`) all no-op.
- `_model` null before `load()`: `get()` returns default model so renderers can run during boot.
- Active rule precedence: regex/wildcard rules win over exact-host snapshot. Exact-host entries with empty snapshot don't count as "rules" — they're just per-host blur state.

## Side effects
All writes go to `chrome.storage.local` (model) or `chrome.storage.session` (automate_blur) via `blsi.Model`. No direct `chrome.storage.*` access in this module.
