---
paths:
  - "src/storage_model.js"
  - "src/automate/*.js"
  - "src/automate/screen_share.js"
  - "popup/**/*.js"
  - "popup/*.js"
  - "background.js"
  - "content_script.js"
---

# Critical: Settings Shape

Settings use **snake_case** keys everywhere. No two-shape duality — same shape in storage, background, content script, popup. Stored under single `blsi_model` storage key, accessed via `blsi.Model`.

**Popup namespace rule:** All popup code (render files, `popup.js`, `popup_state.js`) uses exact `blsi.DEFAULT_MODEL` nested shape — never flat alias. Old flat keys (`blur_mode`, `pick_blur_enabled`, `pick_blur_type`, `pii_email`, `pii_numeric`, `blur_radius`, `reveal_mode`, `redaction_color`, `thorough_blur`, `transition_duration`, `blur_categories`, `pick_blur_color`, `automate_idle`, `automate_tab_switch`, `automate_screen_share`, `enabled`) removed. Use nested model path everywhere (`settings.blur_all.settings.blur_mode`, `settings.global_default_settings.enabled`, etc.). `saveSettings(patch)` in `popup_state.js` takes model-shaped patch, routes each top-level key via `patch_section`.

**Top-level model shape:**
```js
{
  global_default_settings,  // global settings (snake_case keys)
  blur_all:          { status, settings },
  pick_and_blur:     { status, settings, items },  // items: hostname-keyed map of blur items
  auto_detect_pii:   { status, settings },
  automate:          { status, settings },
  shortcuts,         // per-action shortcut definitions
  site_rules,        // array of URL-rule entries — explicit, user-created via Site
                     // Rules form. Each entry: { hostname_value, hostname_type, snapshot }.
                     // Snapshot mirrors capture_snapshot() output and may include
                     // pick_and_blur.items pinned by the rule (REPLACE semantics at
                     // resolve time) and full automate.idle.value/unit. Partial inputs
                     // are auto-filled to the full shape at write (save_site_snapshot)
                     // and at load (validate_model). Empty {} = rule has no overrides.
                     // global_default_settings is NOT captured — display knobs stay editable.
                     // The popup blur-all toggle does NOT create site_rules entries —
                     // it writes to the global blur_all.status.
}
// Session-storage keys live OUTSIDE blsi_model:
//   chrome.storage.session['blsi_automate_idle']                — 'active'|'idle'|'locked' (global; owned by automate/state.js)
//   chrome.storage.session['blsi_automate_tab_switch_by_tab']   — { [tab_id]: 'fired' } (per-tab; owned by automate/state.js)
//   chrome.storage.session['blsi_screen_share']                 — per-tab map { [tab_id]: { started_at, suppressed_sites } } (see below)
//   chrome.storage.session['blsi_automate_suppressed_tabs']     — number[] (per-tab silence-all)
//   chrome.storage.session['blsi_automate_suspended']           — { idle: false, tab_switch: false, screen_share: false }
//     Session-only — browser restart clears it, all triggers auto-resume.
//     Written by blsi.Automate.State.suspend_trigger() / resume_trigger().
//     Read by resolve_automate() to gate feature-on checks.
```

**`pick_and_blur.items`** — hostname-keyed map storing all pick & blur items:
```js
pick_and_blur.items = {
  'gmail.com': [{ type: 'dynamic', selector: '#foo', name: 'Foo' }, ...],
  'github.com': [{ type: 'sticky', id: 'z1', x, y, width, height, anchor }, ...],
}
```
Default: `{}`. Each hostname's array is capped at 10 items. Empty arrays are stripped by `validate_model`. `get_blur_items(hostname)`, `save_blur_item(hostname, item)`, `remove_blur_item(hostname, item_id)` are the CRUD APIs.

**`shortcuts`** — per-action shortcut definitions (v2 shape):
```js
shortcuts = {
  'toggle-blur-all': { binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] },
  'toggle-picker':   { binding: [{ code: 'KeyP', mods: ['Alt', 'Shift'] }] },
  'clear-all':       { binding: [{ code: 'KeyU', mods: ['Alt', 'Shift'] }] },
  'screenshot':      { binding: [{ code: 'KeyS', mods: ['Alt', 'Shift'] }] },
}
```

- Keys are action ids from `blsi.Actions` — **kebab-case** (e.g. `'toggle-blur-all'`), matching `id` field in `action_registry.js`. Not message-type strings, not snake_case.
- `binding` is array of chords. Phase 1 always `length === 1`; phase 2 adds multi-chord sequences like `[{code: 'KeyG'}, {code: 'KeyI'}]` for Gmail-style `g i`.
- `code` is `KeyboardEvent.code` (physical key, layout-independent).
- `mods` is sorted subset of `{"Alt","Control","Meta","Shift"}`. Left/right folded — `AltLeft` and `AltRight` both map to `"Alt"`.
- Default shortcuts NOT in `constants.js` — come from `blsi.Actions.defaultBindings()`, merged by `blsi.build_default_model()`.

`content_script.js` passes `shortcuts` directly to `Shortcuts.init()` — no flattening needed.

**`reveal_mode`** — controls how blurred elements can be temporarily revealed: `'hover'` | `'click'` | `'none'`.

**`thorough_blur`** — boolean; when true, applies deeper blur processing.

**`picker_mode`** — controls picker strategy:
- `'sticky-page'` (default) — box anchored to document. Scrolls with page. Stored with `anchor: 'page'`.
- `'sticky-screen'` — box anchored to viewport. Fixed on screen during scroll. Stored with `anchor: 'screen'`. Best for screen-sharing/streaming.
- `'dynamic'` — tap element to blur it (selector-based, follows element).

Legacy `'sticky'` migrated to `'sticky-page'` in `blsi.validate_model()`. Sticky zones without `anchor` field default to `'page'` at restore time.

**All defaults live in `src/constants.js` → `blsi.DEFAULT_MODEL`.** No hardcoded defaults elsewhere.

### Settings Shape: blur_categories

**In `chrome.storage.local` (via `blsi.Model`) / background / content_script.js / popup.js:**
```js
settings.blur_categories = {
  text:      true,   // headings, paragraphs, spans, etc.
  media:     true,   // img, video, audio, canvas, svg, picture, figure
  form:      false,  // input, textarea, select, button, label, fieldset
  table:     true,   // table, thead, tbody, tr, td, th
  structure: true,   // div, section, article, nav, aside, header, footer, main, li
}
```

Defaults in `src/constants.js` → `blsi.DEFAULT_MODEL`. Per-category element lists in `src/core/categories.js` → `CATEGORY_SELECTORS`.

### Settings Shape: auto_detect

Controls automatic PII detection. Same shape everywhere — no flattening.

**In `chrome.storage.local` (via `blsi.Model`) / background / content_script.js / popup.js:**
```js
auto_detect_pii.settings = {
  email:   false,   // boolean — email addresses (local@domain.tld)
  numeric: false,   // boolean — financial numbers, phone-like groups, currency amounts
}
```

- `email` boolean. Default `false`.
- `numeric` boolean. Default `false`.

Defaults in `src/constants.js` → `blsi.DEFAULT_MODEL`.

Master toggle's `expandKeys` sets both `email` and `numeric` to `true`/`false` atomically.

PII blur **independent of blur-all**. PII spans carry `[data-bl-si-pii]` only — no `[data-bl-si-blur]`. `[data-bl-si-pii]:not([data-bl-si-reveal])` CSS rule in `content.css` drives blur. Enabling PII = spans stay blurred regardless of blur-all state.

### Settings Shape: pick_and_blur and automate keys

**`pick_blur_enabled`** — Pick & Blur mode independently enabled: `true` (default) | `false`. Blur All and Pick & Blur can be on simultaneously; no "active mode" concept. Persisted to storage.

**`pick_blur_type`** — blur type for Pick & Blur: `'blur'` (default) | `'frosted'` | `'color'`. No `'redacted'` or `'censored'` — unavailable for Pick & Blur. Use `blsi.pick_blur_modes` enum.

**`pick_blur_color`** — color for Pick & Blur `'color'` type:
```js
pick_and_blur.settings.pick_blur_color = { hex: '#000000', opacity: 1.0 }
// hex: 6-char hex string (validated: must match /^#[0-9a-fA-F]{6}$/)
// opacity: number 0–1 inclusive
```

**`pii_mode`** — blur type for auto-detect PII rendering: `'blur'` (default) | `'frosted'` | `'redacted'` | `'starred'`. Use `blsi.pii_modes` enum.

**`automate`** — automation trigger settings (feature-grouped under `automate.settings`):
```js
automate.settings = {
  screen_share: { enabled: true },                    // boolean only — ON by default; see screen share detection
  idle:         { value: 5, unit: 'min', enabled: false }, // value 1–99; unit from idle_units (no 'hr')
  tab_switch:   { enabled: false },
}
```
- `screen_share.enabled` — when true, `blsi.ScreenShare.init()` wraps `MediaDevices.prototype.getDisplayMedia` in page's MAIN world. On share start, `screen_share.js` opens a per-stream port (`blsi-ss-<streamId>`) + sends `SCREEN_SHARE_STARTED` with `streamId` (`stream.id` GUID); background **owns** the live-share state in a per-tab, per-stream session map (`blsi_screen_share = { [tab_id]: { streams: { [streamKey]: { started_at } }, suppressed_sites } }`) and broadcasts `SCREEN_SHARE_NOTIFY` (toast ping) to non-sharing tabs. Content tabs read the map via `chrome.storage.session.onChanged` in `storage_model.js` — they do NOT mirror screen-share state into their own per-hostname `automate_blur` entries. Tabs opened mid-share read the map on `init_cache`. On share end (or tab crash/close), port disconnect removes only that stream's entry (or the entire tab if it was the last stream) + broadcasts NOTIFY. Multiple streams from the same tab are tracked independently. Multiple tabs can share simultaneously. Sharing tabs NOT blurred (resolve-side check: `tab_id in _sharing_tab_ids`). **Smart skip**: if blur-all or pick-and-blur already enabled, automate defers (sets `automate_blur_skipped = true`, populates `automate_blur_skip_reason`), shows "Blur already active — automate skipped" toast.
- `idle.unit` accepts `blsi.idle_units` (`'sec'` | `'min'`) only — `'hr'` rejected (Chrome idle API cap ~3000 s). `value` min 1. UI warns when value exceeds 3000 s.
- `tab_switch.enabled` boolean only.

### Settings Shape: automate session storage (transient trigger state)

Three independent session keys, all in **`chrome.storage.session`** (auto-cleared on browser close/crash). Owned and read separately to keep concerns from leaking across each other.

**`blsi_automate_idle`** — object with global idle phase + per-trigger ignore lists:
```js
// chrome.storage.session['blsi_automate_idle']:
{
  status: 'idle',                    // 'active' | 'idle' | 'locked'
  ignore_tabs: [42, 1001],          // tab IDs suppressed for idle trigger
  ignore_sites: ['gmail.com'],      // hostnames suppressed for idle trigger
}
```
Mirrors the latest `chrome.idle.IdleState` in `.status`. Written by `blsi.Automate.Idle` (background-only listener). Cleared on browser close. Backward compat: bare string values from old installs are normalized to `{ status: val, ignore_tabs: [], ignore_sites: [] }`.

**`blsi_automate_tab_switch_by_tab`** — object with per-tab phase map + per-trigger ignore lists:
```js
// chrome.storage.session['blsi_automate_tab_switch_by_tab']:
{
  status: { '184729322': 'fired' },  // per-tab phase map (unchanged shape, nested under .status)
  ignore_tabs: [42],                 // tab IDs suppressed for tab_switch trigger
  ignore_sites: ['meet.google.com'], // hostnames suppressed for tab_switch trigger
}
```
Only `'fired'` is persisted in `.status`; absence === `'off'` (=== `'armed'` for resolve purposes — keeps the map small since most tabs are armed most of the time). Written by `blsi.Automate.Visibility` (content-only, per-tab Page Lifecycle observer). Backward compat: old flat maps (all keys numeric) normalized to `{ status: val, ignore_tabs: [], ignore_sites: [] }`.

**`blsi_screen_share`** — per-tab, per-stream map of live screen-share sessions. Owned by `automate/screen_share_bg.js` (background); `storage_model.js` mirrors it into `_screen_share_cache` for synchronous reads. Empty map `{}` = no active shares. Presence of a tab key with non-empty `streams` = that tab is sharing.

```js
// chrome.storage.session['blsi_screen_share']:
{
  '42': {
    streams: {
      'blsi-ss-a7f3c2d1': { started_at: 1714700000000 },
      'blsi-ss-b8e2f4c9': { started_at: 1714700005000 },
    },
    suppressed_sites: []
  },
  '1001': {
    streams: {
      'blsi-ss-c3d4e5f6': { started_at: 1714700010000 },
    },
    suppressed_sites: ['meet.google.com']
  }
}
```

Migration: old flat entries (`{ started_at, suppressed_sites }` without `.streams`) are normalized to `{ streams: { '_migrated': { started_at } }, suppressed_sites }` by `_normalize_ss_entry` in `state.js`. The `'_migrated'` key has no matching port — next disconnect or reconcile clears it.

`get_screen_share_state(opt_tab_id)` returns a backward-compatible summary: `{ active, sharing_tab_id, started_at, suppressed_sites, _sharing_tab_ids }`. `active` = any tab has streams with length > 0. `started_at` = earliest stream's `started_at` for the reported tab. `suppressed_sites` = union across all tabs. `_sharing_tab_ids` = all sharing tab ids.

**`blsi_automate_suppressed_tabs`** — `number[]` of tab ids silenced for **all** automate triggers. Set when a user picks "This tab" from the toast / popup notif card. `chrome.tabs.onRemoved` strips closed tab ids. Each new share clears this list (mitigates Chrome tab-id reuse).

**Resolve logic** — split into two resolvers post-engine/automate-split:

`resolve_settings(hostname, url, tab_id?)` — engine surface. Returns folded settings + `engage`:
```
manual_blur = !!resolved.blur_all_status
engage      = (resolved.enabled !== false) && manual_blur
```
**No automate term, no pick-blur term.** Pick-blur reconcile + CSS injection runs unconditionally inside `engine.handleSite`. Automate is rendered exclusively via the Overlay (driven by `blsi.Automate.Manager`), not the engine.

`resolve_automate(hostname, url, tab_id)` — Manager surface. Returns automate-decision fields:
```
tab_suppressed       = suppressed_tabs.includes(tab_id)

idle_eff             = !tab_suppressed && idle.enabled && State.read_idle() in {'idle','locked'}
tab_switch_eff       = !tab_suppressed && tab_switch.enabled && State.read_tab_switch(tab_id) === 'fired'

ss_blur_for_me_raw   = ss.active
                        && ss._sharing_tab_ids.indexOf(tab_id) < 0
                        && !ss.suppressed_sites.includes(host)
                        && model.automate.settings.screen_share.enabled
ss_eff               = !tab_suppressed && ss_blur_for_me_raw

automate_blur_active = idle_eff || tab_switch_eff || ss_eff
```

`resolve(hostname, url, tab_id)` is now a backward-compat shim returning `{...resolve_settings, ...resolve_automate}` for popup callers and any code that needs the union.

Automate triggers NEVER write `blur_all`. `onActive()` only clears idle/tab_switch — manual blur survives idle return.

Derived keys exposed by `resolve_automate` (mirrored on the `resolve()` shim):
- `automate_blur_active`, `automate_blur_triggers` — `{ idle, tab_switch, screen_share }` booleans (post-suppression)
- `automate_blur_only` — true when automate is **sole** blur reason (no manual blur, no pick-blur)
- `automate_blur_skipped` — true when automate fired but deferred (blur-all or pick-blur already on)
- `automate_blur_skip_reason` — `'site_rule' | 'manual' | 'pick_blur' | null`
- `screen_share_state` — `{ active, sharing_tab_id, started_at, is_sharing_tab }` (popup card label)
- `screen_share_suppressed_for_host`, `screen_share_suppressed_for_tab` — booleans (Undo affordance)
- `_rule_overrides_automate` — `{ automate_idle, automate_tab_switch, automate_screen_share }` booleans — used by Manager to attach "(site rule)" suffix to toasts

Idle + tab_switch session APIs live on `blsi.Automate.State`:
- `read_idle()` → `'active' | 'idle' | 'locked'` (global)
- `read_tab_switch(tab_id)` → `'off' | 'armed' | 'fired'` (per-tab; absence === armed/off)
- `write_idle(phase)` (background-only writer in production)
- `write_tab_switch(tab_id, phase)` / `clear_tab_switch(tab_id)` (per-tab)

`blsi.Model` screen-share + suppression session APIs:
- `get_screen_share_state()` → `{ active, sharing_tab_id, started_at, suppressed_sites }`
- `set_screen_share_active(tabId)` / `set_screen_share_inactive()` — owned by `background.js`; popup/content read-only
- `suppress_screen_share(scope, ctx)` / `unsuppress_screen_share(scope, ctx)` — `scope ∈ 'tab' | 'site_session' | 'feature'`
- `get_suppressed_tabs()` / `add_suppressed_tab` / `remove_suppressed_tab` / `clear_suppressed_tabs`
- `clear_host(hostname)` — clears pick-blur items only (idle/tab_switch are not per-host)
