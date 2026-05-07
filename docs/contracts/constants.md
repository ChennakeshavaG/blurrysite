# constants Contract

## Overview

Single source of truth for message types, default model, enums, and utility functions shared across all contexts (background SW, content scripts, popup). IIFE assigns to `globalThis.blsi` — works in both `window` (content scripts) and `self` (service worker). Other modules attach to the same `blsi` object after this loads (`Object.assign(globalThis.blsi || {}, Constants)`).

## Module State (Private)

| Variable | Description |
|---|---|
| `_all_types` | `Set<string>` — all message type strings (command + popup); built at module init |
| `_type_to_category` | `Object` (null prototype) — maps type string → category name (`'command'` \| `'popup'`) |
| `_valid_mods` | `Set<string>` — valid modifier names: `Alt`, `Control`, `Meta`, `Shift` |

## Message Type Objects

### `command` (Object, frozen)

Background → content script (command relay + context menu) **and** content → background (screen share relay):

| Key | Value | Direction |
|---|---|---|
| `toggle_blur_all` | `'TOGGLE_BLUR_ALL'` | bg → content |
| `toggle_picker` | `'TOGGLE_PICKER'` | bg → content |
| `clear_all_blur` | `'CLEAR_ALL_BLUR'` | bg → content |
| `restore` | `'RESTORE'` | bg → content |
| `context_blur` | `'CONTEXT_BLUR'` | bg → content |
| `context_unblur` | `'CONTEXT_UNBLUR'` | bg → content |
| `blur_selection` | `'BLUR_SELECTION'` | bg → content |
| `capture_viewport` | `'CAPTURE_VIEWPORT'` | bg → content |
| `toggle_panel` | `'TOGGLE_PANEL'` | bg → content (PWA) |
| `screen_share_started` | `'SCREEN_SHARE_STARTED'` | content → bg |
| `screen_share_ended` | `'SCREEN_SHARE_ENDED'` | content → bg |
| `screen_share_notify` | `'SCREEN_SHARE_NOTIFY'` | bg → content (broadcast — toast ping; tabs re-resolve from session storage) |
| `who_am_i` | `'WHO_AM_I'` | content → bg (replies with `sender.tab.id` so content can self-identify) |

### `popup` (Object, frozen)

Popup → content script:

| Key | Value |
|---|---|
| `get_status` | `'GET_STATUS'` |
| `unblur_item` | `'UNBLUR_ITEM'` |
| `highlight_item` | `'HIGHLIGHT_ITEM'` |
| `clear_highlight` | `'CLEAR_HIGHLIGHT'` |

## Public API

### is_valid(type)

**What**: Checks if a string is a known message type.  
**Params**: `type` (string)  
**Returns**: `boolean` — `true` if in `command` or `popup`  
**Side effects**: none  

### category_of(type)

**What**: Returns which category a message type belongs to.  
**Params**: `type` (string)  
**Returns**: `'command'` | `'popup'` | `null`

## Enums (all frozen)

### `reveal_modes`
`{ none: 'none', click: 'click', hover: 'hover' }` — controls temporary element reveal.

### `blur_modes`
`{ blur: 'blur', frosted: 'frosted', redacted: 'redacted', censored: 'censored' }` — blur-all visual modes. `censored` uses the disc font (bl-si-censored-disc).

### `picker_modes`
`{ dynamic: 'dynamic', sticky_page: 'sticky-page', sticky_screen: 'sticky-screen' }` — picker strategy. `sticky_page` scrolls with the document; `sticky_screen` is viewport-fixed. Legacy `'sticky'` migrated to `'sticky-page'` in `validate_model`.

### `pick_blur_modes`
`{ blur: 'blur', frosted: 'frosted', color: 'color' }` — blur types for Pick & Blur (no `redacted`/`censored`).

### `pii_modes`
`{ blur: 'blur', frosted: 'frosted', redacted: 'redacted', starred: 'starred' }` — visual modes for PII detection rendering.

### `idle_units`
`{ sec: 'sec', min: 'min' }` — `'hr'` excluded: Chrome idle API hard cap ~3000 s (50 min).

### `pattern_types`
`{ wildcard: 'wildcard', regex: 'regex', exact: 'exact' }` — site rule hostname_type values.

### `supported_languages`
`['auto', 'en', 'hi_IN', 'ta_IN']` — valid values for `global_default_settings.language`.

## Constants

### `css` (Object, frozen)

CSS class name constants shared across blur_engine, content_script, picker, shortcut_handler. Must match `styles/content.css` exactly.

| Key | Value |
|---|---|
| `canvas_overlay` | `'bl-si-canvas-overlay'` |
| `hover_highlight` | `'bl-si-hover-highlight'` |
| `picker_active` | `'bl-si-picker-active'` |
| `toast` | `'bl-si-toast'` |
| `toast_message` | `'bl-si-toast__message'` |
| `toast_exiting` | `'bl-si-toast--exiting'` |
| `toolbar` | `'bl-si-toolbar'` |
| `toolbar_label` | `'bl-si-toolbar-label'` |
| `toolbar_btn` | `'bl-si-toolbar-btn'` |
| `toolbar_btn_clear` | `'bl-si-toolbar-btn--clear'` |
| `toolbar_btn_close` | `'bl-si-toolbar-btn--close'` |
| `zone_overlay` | `'bl-si-zone-overlay'` |
| `zone_drawing` | `'bl-si-zone-drawing'` |
| `zone_highlight` | `'bl-si-zone-highlight'` |
| `zone_label` | `'bl-si-zone-label'` |

### `ids` (Object, frozen)

| Key | Value |
|---|---|
| `picker_toolbar` | `'bl-si-picker-toolbar'` |
| `svg_filters` | `'bl-si-svg-filters'` |

### `reveal_dfs_max_depth`
`2` — max depth for reveal ancestor chain walk.

### `max_pick_blur_items_per_host`
`10` — per-host cap on Pick & Blur items. Enforced by `blsi.Model.save_blur_item` (rejects with `{ ok: false, reason: 'cap' }` when reached). Surfaced by the popup pick-blur block (inline "10/10 — max reached" message at cap) and by an in-page toast fired by picker / context-menu callbacks when a save is rejected for cap. Single source of truth — never hardcode `10` elsewhere.

### `idle_toast_duration_seconds`
`0` (forever / persistent) by default. Controls the in-page idle automate toast lifecycle:
- `0` → persistent toast (no auto-dismiss; dismissed on the idle falling edge when the user becomes active, or via the close button).
- `N` (positive integer) → `N`-second auto-dismiss. The falling-edge dismiss still applies if the toast is still on screen.

Tunable for UX experiments. Other automate toasts are fixed: tab-switch is 3s (no actions), screen-share is persistent (with stop-share actions). Single source of truth — `blsi.Automate.Manager` reads this directly.

### `modifier_codes` (Set, frozen)

All `KeyboardEvent.code` strings for modifier keys. Left/right kept separate (browser reports both). Used by `shortcut_handler` to skip pure-modifier keydowns.

Values: `AltLeft`, `AltRight`, `ControlLeft`, `ControlRight`, `ShiftLeft`, `ShiftRight`, `MetaLeft`, `MetaRight`, `OSLeft`, `OSRight` (older Chrome/FF alias for Meta), `CapsLock`, `Fn`, `FnLock`.

## DEFAULT_MODEL (Object, deeply frozen)

Single source of truth for the `blsi_model` storage shape. Feature-grouped. **Shortcuts are NOT included** — built lazily in `build_default_model()` from `blsi.Actions.defaultBindings()`.

```js
{
  global_default_settings: {
    blur_radius:         8,          // int 2–20
    transition_duration: 300,        // int 0–2000 ms
    highlight_color:     '#f59e0b',  // 6-char hex
    redaction_color:     '#000000',  // 6-char hex
    reveal_mode:         'hover',    // reveal_modes
    enabled:             true,
    thorough_blur:       false,
    language:            'auto',     // supported_languages
    tab_privacy:         false,
  },
  blur_all: {
    status: false,
    settings: {
      blur_mode: 'blur',             // blur_modes
      blur_categories: { text: true, media: true, form: false, table: true, structure: true },
    },
  },
  pick_and_blur: {
    status: false,
    settings: {
      picker_mode: null,             // picker_modes or null
      blur_type: 'blur',             // pick_blur_modes
      blur_color: { hex: '#000000', opacity: 1.0 },
    },
  },
  auto_detect_pii: {
    settings: {
      email:               false,
      numeric:             false,
      pii_mode:            'blur',   // pii_modes
      pii_redaction_color: '#000000',
    },
  },
  automate: {
    settings: {
      screen_share: { enabled: true },
      idle:         { value: 5, unit: 'min', enabled: false },
      tab_switch:   { enabled: false },
    },
  },
  site_rules: [],
  // shortcuts: absent — built lazily
}
```

## Public API Functions

### deep_merge(base, override, depth?)

**What**: Recursive object merge with prototype-pollution protection and depth limit.  
**Params**: `base` (object), `override` (object), `depth` (optional, default 0)  
**Returns**: New merged object  
**Handles**:
- `depth > 5` → returns `override` directly (depth cap)
- Arrays are replaced, not merged
- Skips keys `__proto__`, `constructor`, `prototype`
- Only recurses when both sides are non-null, non-array objects

### build_default_model()

**What**: Returns a deep-mutable clone of `DEFAULT_MODEL` with shortcuts filled in.  
**Params**: none  
**Returns**: `Object` — full mutable model with `shortcuts` key  
**Side effects**: Uses `JSON.parse(JSON.stringify(DEFAULT_MODEL))` for deep clone; reads `globalThis.blsi.Actions` if available (empty object `{}` if `action_registry.js` not yet loaded).  
**Note**: Safe to call before `action_registry.js` loads — shortcuts degrade to `{}`.

### is_valid_shortcut_entry(entry)

**What**: Validates a v2 shortcut entry shape `{ binding: [{code, mods}] }`.  
**Params**: `entry` (any)  
**Returns**: `boolean`  
**Rules**:
- `entry.binding` must be non-empty array, length 1–4
- Each chord: non-empty `code` string; `mods` array where each element ∈ `{Alt, Control, Meta, Shift}`; at least 1 mod
- Rejects bare `Ctrl+Alt+X` (no Shift, no Meta) — AltGr collision on European keyboards

### validate_model(model)

**What**: Validates and repairs every section of a stored `blsi_model` object. Missing or invalid values fall back to `build_default_model()` defaults.  
**Params**: `model` (any)  
**Returns**: Clean, complete model object with all required keys  
**Handles**: Non-object input → returns `build_default_model()`

**Section-by-section validation:**

**`global_default_settings`**:
- Reads from `model.global_default_settings` OR legacy `model.settings` (backwards compat migration)
- `blur_radius`: int 2–20; else default
- `transition_duration`: int 0–2000; else default
- `highlight_color` / `redaction_color`: `/^#[0-9a-fA-F]{6}$/`; else default
- `reveal_mode`: must be in `reveal_modes` values; else default
- `enabled`, `thorough_blur`, `tab_privacy`: must be boolean; else default
- `language`: must be in `supported_languages`; else default

**`blur_all`**:
- Enum migration: `gaussian` → `blur`, `masked` → `censored`, `solid` → `censored`
- `blur_categories`: reads from `blur_all.settings.blur_categories` first; falls back to `global_default_settings.blur_categories` or legacy `settings.blur_categories` for one-time migration; each key boolean-validated

**`pick_and_blur`**:
- Picker mode migration: legacy `'sticky'` → `picker_modes.sticky_page`
- Blur type migration: `'gaussian'` → `'blur'`
- `picker_mode`: `null` is valid (no mode selected); invalid values coerce to `null`
- `blur_color.hex`: `/^#[0-9a-fA-F]{6}$/`; `blur_color.opacity`: number 0–1

**`auto_detect_pii`**:
- Enum migration: `gaussian` → `blur`, `asterisked` → `starred`, `hidden` → `starred`
- `email`, `numeric`: boolean
- `pii_mode`: must be in `pii_modes` values
- `pii_redaction_color`: hex validated

**`automate`**:
- `screen_share.enabled`, `tab_switch.enabled`: boolean
- `idle.value`: int 1–99; `idle.unit`: must be in `idle_units`; `idle.enabled`: boolean
- **chrome.idle floor clamp**: when the resolved unit is `'sec'` and value < 15, value is clamped up to 15. `'min'` values are inherently ≥60s so no clamp applies. Matches `chrome.idle.setDetectionInterval`'s 15s floor.

**`shortcuts`**:
- Iterates over `build_default_model().shortcuts` keys (action ids from `blsi.Actions`)
- Valid entries pass through with mods sorted; invalid entries replaced with default binding

**`site_rules`**:
- Filters: non-object rules, empty `hostname_value`, prototype-polluting names rejected
- Sliced to 200 entries
- Each rule: `hostname_value` trimmed + sliced to 500 chars; `hostname_type` validated against `pattern_types`; `snapshot` validated below
- `snapshot`: nested validation — `blur_all.status` (boolean), `blur_all.settings.blur_categories` validated; `pick_and_blur.settings.blur_color` validated; `pick_and_blur.items` filtered via `_is_valid_snapshot_item` + capped at 10; `automate.settings.idle` accepts `{ value (1–99), unit (idle_units), enabled }` — `tab_switch` / `screen_share` accept `enabled` only. **Legacy `settings` block dropped silently.** **Full-snapshot fill**: empty `{}` stays empty (rule has no overrides); non-empty snapshots are filled to the complete `capture_snapshot()` shape — every missing key populated from `DEFAULT_MODEL` so resolve never sees a partial. `pick_and_blur.items` defaults to `[]`; `automate.settings.idle` defaults to the full `{ value, unit, enabled }` from `DEFAULT_MODEL`.

## Invariants

- `command` and `popup` are frozen — never mutated at runtime.
- `DEFAULT_MODEL` is deeply frozen — `build_default_model()` must clone before modifying.
- `deep_merge` never mutates `base` or `override` — always returns a new object.
- `validate_model` always returns a complete model — never returns null, never throws.
- Enum migrations in `validate_model` are one-time: old values only map forward, never backward.
- `is_valid_shortcut_entry` rejects Ctrl+Alt+X (no Shift) — AltGr protection.
- `build_default_model().shortcuts` returns `{}` if `blsi.Actions` not yet loaded — callers handle this.
- `blsi` object is extended, not replaced: `Object.assign(globalThis.blsi || {}, Constants)` — safe even if `action_registry.js` loaded first.
