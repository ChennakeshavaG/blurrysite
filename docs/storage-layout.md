# Storage Layout — Deep Dive

Single reference for every persisted byte: shape, type, range, default, who reads, who writes, lifecycle. Covers `chrome.storage.local`, `chrome.storage.session`, and the resolved-settings object that downstream consumers actually see.

> **Source of truth**: `src/constants.js` (`DEFAULT_MODEL`, enums, `validate_model`) and `src/storage_model.js` (`blsi.Model`). This doc is a flattened view — code wins on conflict.

---

## 1. Map of all storage areas

| Area | Key | Owner | Lifetime | Purpose |
|---|---|---|---|---|
| `chrome.storage.local` | `blsi_model` | `blsi.Model` (content + popup) | Persistent until cleared | User intent — every setting, every site rule, every saved item |
| `chrome.storage.local` | `blsi_debug` | `blsi.Logger` | Persistent | Debug-log toggle (cross-context sync) |
| `chrome.storage.local` | `picker_toolbar_pos` | `picker.js` (currently unused; legacy) | Persistent | Reserved; pill always opens at top-center now |
| `chrome.storage.local` | `blsi_pwa_hint_shown` | `content_script.js` | Persistent | One-time PWA-mode hint flag |
| `chrome.storage.session` | `blsi_automate_idle` | `blsi.Automate.State` (background writer) | Browser session | Single global string — `'active' \| 'idle' \| 'locked'` from `chrome.idle.IdleState` |
| `chrome.storage.session` | `blsi_automate_tab_switch_by_tab` | `blsi.Automate.State` (content writer) | Browser session | Per-tab map `{ [tab_id]: 'fired' }` (absence === armed/off) |
| `chrome.storage.session` | `blsi_screen_share` | `background.js` | Browser session | Single global screen-share record |
| `chrome.storage.session` | `blsi_automate_suppressed_tabs` | `background.js` + `blsi.Model` | Browser session | `number[]` of tab ids silenced via "this tab" toast |

`chrome.storage.session` is wiped on every browser restart and on extension reload. `chrome.storage.local` survives both.

In-memory only (NOT in storage):
- `_sharePorts` — `Map<tabId, Port>` in background SW. Empties on SW eviction.
- `_screen_share_cache`, `_suppressed_tabs_cache` — synchronous mirrors inside `blsi.Model`.
- `_idle_cache`, `_tab_switch_cache` — synchronous mirrors inside `blsi.Automate.State`.

---

## 2. `chrome.storage.local["blsi_model"]` — the full tree

```
blsi_model = {
  global_default_settings, // display knobs that apply everywhere
  blur_all,                // { status, settings }   feature: blur the whole page
  pick_and_blur,           // { status, settings, items } feature: per-element / per-zone blur
  auto_detect_pii,         // { settings }           feature: regex-driven PII blur
  automate,                // { settings }           feature: trigger-driven blur
  shortcuts,               // per-action keyboard bindings
  site_rules,              // per-host overrides (snapshot-based)
}
```

Migration paths handled by `validate_model()`: legacy keys (`settings` → `global_default_settings`), legacy enums (`gaussian`→`blur`, `masked/solid`→`censored`, `asterisked/hidden`→`starred`, `sticky`→`sticky-page`), legacy item shape (`selector` → `selectors[]`).

### 2.1 `global_default_settings`

Display + extension-wide booleans. Snake_case throughout.

| Key | Type | Range / Enum | Default | Notes |
|---|---|---|---|---|
| `blur_radius` | number | 2–32 (px) | `8` | CSS var `--bl-si-radius`. Live-propagates without page-wide reapply. |
| `transition_duration` | number | 0–2000 (ms) | `300` | CSS var `--bl-si-transition-duration`. Reveal animation. |
| `highlight_color` | string | `^#[0-9a-fA-F]{6}$` | `#f59e0b` | CSS var `--bl-si-highlight-color`. Picker hover outline. |
| `redaction_color` | string | `^#[0-9a-fA-F]{6}$` | `#000000` | CSS var `--bl-si-redaction-color`. Used by `redacted` blur-all mode. |
| `reveal_mode` | enum | `'none' \| 'click' \| 'hover'` | `'hover'` | Reveal interaction mode. |
| `enabled` | boolean | — | `true` | Master kill switch. `false` → engine teardown, no shortcuts, no auto-blur. |
| `thorough_blur` | boolean | — | `false` | Deeper text-check pass; performance cost. |
| `language` | enum | `'auto' \| 'en' \| 'hi_IN' \| 'ta_IN'` | `'auto'` | UI + content-script i18n. |
| `tab_privacy` | boolean | — | `false` | Replaces tab title with `…` while extension is active. |

### 2.2 `blur_all`

Whole-page blur. The toggle that the popup's main button drives.

```
blur_all = {
  status: boolean,                  // GLOBAL on/off (no per-host duality — site_rules override at resolve)
  settings: {
    blur_mode: 'blur'|'frosted'|'redacted'|'censored',
    blur_categories: { text, media, form, table, structure },  // booleans, see below
  },
}
```

| Key | Type | Range / Enum | Default |
|---|---|---|---|
| `blur_all.status` | boolean | — | `false` |
| `blur_all.settings.blur_mode` | enum | `blur \| frosted \| redacted \| censored` | `'blur'` |
| `blur_all.settings.blur_categories.text` | boolean | — | `true` |
| `blur_all.settings.blur_categories.media` | boolean | — | `true` |
| `blur_all.settings.blur_categories.form` | boolean | — | `false` |
| `blur_all.settings.blur_categories.table` | boolean | — | `true` |
| `blur_all.settings.blur_categories.structure` | boolean | — | `true` |

`blur_categories` shape is fixed: exactly these 5 keys, all booleans. Per-category element lists in `src/core/categories.js` → `CATEGORY_SELECTORS`.

`censored` mode requires the `bl-si-censored-disc` font (see `src/fonts.js`).

### 2.3 `pick_and_blur`

Per-element + per-zone blur picker.

```
pick_and_blur = {
  status: boolean,                        // master toggle (master ON ≠ has items)
  settings: {
    picker_mode: 'dynamic'|'sticky-page'|'sticky-screen' | null,
    blur_type:   'blur'|'frosted'|'color',  // no redacted/censored
    blur_color:  { hex, opacity },          // only used when blur_type === 'color'
  },
  items: { [hostname]: Item[] },          // host-keyed map; arrays capped at 10 items each
}
```

| Key | Type | Range / Enum | Default |
|---|---|---|---|
| `pick_and_blur.status` | boolean | — | `false` |
| `pick_and_blur.settings.picker_mode` | enum or null | `dynamic \| sticky-page \| sticky-screen \| null` | `null` |
| `pick_and_blur.settings.blur_type` | enum | `blur \| frosted \| color` | `'blur'` |
| `pick_and_blur.settings.blur_color.hex` | string | `^#[0-9a-fA-F]{6}$` | `'#000000'` |
| `pick_and_blur.settings.blur_color.opacity` | number | 0–1 inclusive | `1.0` |
| `pick_and_blur.items` | object | host-keyed | `{}` |

`picker_mode = null` means "ask me on activation" — popup falls back to default. `'sticky'` legacy value migrated to `'sticky-page'` at validate time.

#### Item shapes

Two variants. Both live in `pick_and_blur.items[hostname]` (capped at 10 per host). `validate_model` strips invalid entries and empty arrays.

**Dynamic** (selector-based, follows the matched element):
```
{
  type: 'dynamic',
  name: string,                // human-readable label, ≤100 chars
  selectors: string[],         // ordered structural→semantic, length 1..6, each ≤2000 chars
  // Legacy: selector: string (pre-migration). Both shapes accepted by validator.
}
```

**Sticky** (rectangular zone):
```
{
  type: 'sticky',
  id: string,                  // 's_' + 8 hex chars, generated by content_script
  name: string,                // ≤100 chars
  anchor: 'page' | 'screen',   // page = scrolls with content; screen = position:fixed
  x, y, width, height: number, // px coordinates
  // Page anchor only:
  xPct, yPct, widthPct, heightPct: number,  // ratios of scroll dimensions, used to re-project on layout change
  scrollWidth, scrollHeight: number,         // captured at write time
}
```

Sticky `id` collisions are improbable (8 hex chars per host); not deduped.

### 2.4 `auto_detect_pii`

Regex PII scan. Note: NO `status` field — the feature is "on" when at least one of `email`/`numeric` is `true`.

```
auto_detect_pii = {
  settings: {
    email:               boolean,
    numeric:             boolean,
    pii_mode:            'blur'|'frosted'|'redacted'|'starred',
    pii_redaction_color: '#000000' style hex,
  },
}
```

| Key | Type | Range / Enum | Default |
|---|---|---|---|
| `auto_detect_pii.settings.email` | boolean | — | `true` |
| `auto_detect_pii.settings.numeric` | boolean | — | `true` |
| `auto_detect_pii.settings.pii_mode` | enum | `blur \| frosted \| redacted \| starred` | `'blur'` |
| `auto_detect_pii.settings.pii_redaction_color` | string | `^#[0-9a-fA-F]{6}$` | `'#000000'` |

`starred` mode requires the `bl-si-starred-asterisk` font.

### 2.5 `automate`

Trigger-driven blur. **`enabled` flags only — live trigger state lives in session storage.**

```
automate = {
  settings: {
    idle:         { value: 1..99, unit: 'sec'|'min', enabled: boolean },
    tab_switch:   { enabled: boolean },
    screen_share: { enabled: boolean },
  },
}
```

| Key | Type | Range / Enum | Default |
|---|---|---|---|
| `automate.settings.idle.value` | number | 1–99 | `5` |
| `automate.settings.idle.unit` | enum | `'sec' \| 'min'` | `'min'` |
| `automate.settings.idle.enabled` | boolean | — | `false` |
| `automate.settings.tab_switch.enabled` | boolean | — | `false` |
| `automate.settings.screen_share.enabled` | boolean | — | `false` |

`'hr'` rejected for unit — Chrome `chrome.idle` API hard-caps at ~3000 s (50 min). UI warns when `value*unit > 3000s`.

There is **no `status`** at the `automate` top level. Each trigger has its own `enabled`.

### 2.6 `shortcuts`

```
shortcuts = {
  'toggle-blur-all':  { binding: [{ code, mods }] },
  'toggle-picker':    { binding: [{ code, mods }] },
  'clear-all':        { binding: [{ code, mods }] },
  'screenshot':       { binding: [{ code, mods }] },
  'blur-selection':   { binding: [{ code, mods }] },
}
```

Keys: kebab-case action ids matching `blsi.Actions`.

| Field | Type | Constraint |
|---|---|---|
| `binding` | array | length 1–4 (phase 1 always 1; phase 2 multi-chord) |
| `binding[i].code` | string | `KeyboardEvent.code` (e.g. `'KeyB'`) |
| `binding[i].mods` | string[] | subset of `{'Alt','Control','Meta','Shift'}`, sorted, length ≥ 1 |

Reject rule: bare `Ctrl+Alt+X` (no Shift, no Meta) — collides with AltGr on European keyboards.

Defaults built lazily by `blsi.build_default_model()` from `blsi.Actions.defaultBindings()`.

### 2.7 `site_rules`

Per-host overrides. Snapshot-based — when a snapshot is non-empty, it fully replaces the corresponding sections at resolve time.

```
site_rules = [
  {
    hostname_value: string,                  // ≤500 chars
    hostname_type:  'exact' | 'wildcard' | 'regex',
    snapshot:       {} | FullSnapshot,       // empty {} = rule has no overrides
  },
  // capped at 200 entries
]
```

`FullSnapshot` mirrors `capture_snapshot()` output. Any non-empty snapshot is auto-padded by `validate_model` to the full shape:

```
snapshot = {
  blur_all: {
    status?: boolean,
    settings: { blur_mode, blur_categories },
  },
  pick_and_blur: {
    status: boolean,
    settings: { blur_type, picker_mode, blur_color },
    items: SnapshotItem[],   // up to 10; pinned by the rule, REPLACE semantics
  },
  auto_detect_pii: {
    settings: { email, numeric, pii_mode, pii_redaction_color },
  },
  automate: {
    settings: {
      idle:         { enabled, value, unit },
      tab_switch:   { enabled },
      screen_share: { enabled },
    },
  },
}
```

Excluded from snapshot (intentionally — these stay editable and global):
- `global_default_settings` (display knobs)
- `shortcuts`
- top-level `enabled`
- `pick_and_blur.items` keyed by other hostnames (only this rule's items are in the snapshot)

Resolve-time merge order (later wins):
```
defaults → global_default_settings → blur_all/feature settings →
  first-matching wildcard/regex site_rule.snapshot →
  exact-hostname site_rule.snapshot
```

---

## 3. `chrome.storage.session` — four independent keys

### 3.1 `blsi_automate_idle`

Single global string — the latest `chrome.idle.IdleState`. One of `'active' | 'idle' | 'locked'`.

Default: `'active'` (read fallback when nothing has been written).

Lifecycle:
- Written by `blsi.Automate.Idle` (background-only) on `chrome.idle.onStateChanged`.
- Threshold seeded from `automate.settings.idle.{value,unit}` and hot-updated on storage change.
- Survives SW eviction within the same browser session; wiped at browser restart.

### 3.2 `blsi_automate_tab_switch_by_tab`

Per-tab map of fired entries. Only `'fired'` is persisted; absence === `'armed'` (resolve treats as off).

```
{ [tab_id]: 'fired' }   // tabs with no entry are armed/off
```

Default: `{}`.

Lifecycle:
- Written by `blsi.Automate.Visibility` (content, per tab) on `visibilitychange` / `focus` / `blur`.
- A tab returning to active strips its entry (write_tab_switch with `'off'` removes the key).
- `chrome.tabs.onRemoved` listener can call `State.clear_tab_switch(tab_id)` for cleanup (stale tabs survive otherwise; harmless because resolve gates on tab_id).

### 3.3 `blsi_screen_share`

Single global record. Owned by `background.js`; content tabs read via `storage.onChanged`.

```
{
  active:           boolean,    // false when no share in progress
  sharing_tab_id:   number|null,
  started_at:       number|null, // epoch ms
  suppressed_sites: string[],   // hostnames silenced for THIS share session
}
```

Default (and "inactive" state):
```
{ active: false, sharing_tab_id: null, started_at: null, suppressed_sites: [] }
```

Lifecycle:
- **SW start** (`onStartup` / `onInstalled` / cold start): top-level `chrome.storage.session.set` resets to inactive default.
- **Share start**: `_setScreenShareActive(senderTabId)` writes `{active: true, sharing_tab_id, started_at: Date.now(), suppressed_sites: []}`. Each new share clears `suppressed_sites` so stale entries from a prior share never carry over.
- **Share end** (port disconnect or `SCREEN_SHARE_ENDED`): `_setScreenShareInactive` writes the empty default.
- **Site suppression**: `Model.suppress_screen_share('site_session', {hostname})` → adds hostname to `suppressed_sites[]`.
- **Site unsuppression**: `Model.unsuppress_screen_share` → removes.

Why background owns it: only the SW can correlate port disconnect (= share end) reliably across tab close, crash, navigate, normal stop.

### 3.4 `blsi_automate_suppressed_tabs`

```
number[]   // tab ids silenced for ALL automate triggers (broadest scope)
```

Default: `[]`.

Lifecycle:
- Written by `Model.add_suppressed_tab(tab_id)` from "This tab" toast action.
- `chrome.tabs.onRemoved` listener in `background.js` strips closed tab ids.
- **Each new share clears the whole list** (`_setScreenShareActive` writes `[]`) — Chrome reuses tab ids; stale entries could silence a brand-new tab.
- SW start clears.

---

## 4. In-memory caches (synchronous, mirror storage)

Inside `blsi.Model`:

| Variable | Module | Mirrors | Type |
|---|---|---|---|
| `_cache` | `blsi.Model` | `blsi_model` | object \| null (null until `init_cache()` resolves) |
| `_screen_share_cache` | `blsi.Model` | `blsi_screen_share` | full record, never null (defaults to inactive) |
| `_suppressed_tabs_cache` | `blsi.Model` | `blsi_automate_suppressed_tabs` | `number[]` |
| `_idle_cache` | `blsi.Automate.State` | `blsi_automate_idle` | `'active' \| 'idle' \| 'locked'` (defaults to `'active'`) |
| `_tab_switch_cache` | `blsi.Automate.State` | `blsi_automate_tab_switch_by_tab` | `{ [tab_id]: 'fired' }` |

All caches are kept in sync by `chrome.storage.onChanged` listeners (one per module); reads always go to the cache, writes go through cache-first helpers with rollback on failure.

Subscriber model: `Model.on_change(cb)` is single-slot. Calling twice replaces the previous subscriber and warns.

---

## 5. Resolved settings — what `Engine.handleSite()` actually sees

`Store.resolve(hostname, url, tab_id)` produces a flat object. Not stored anywhere — recomputed on demand. Combines model + site rule + session caches.

### 5.1 Direct passthroughs

```
// from global_default_settings
blur_radius, transition_duration, highlight_color, redaction_color,
reveal_mode, enabled, thorough_blur, language, tab_privacy

// from blur_all
blur_all_status, blur_mode, blur_categories

// from pick_and_blur
pick_blur_enabled (= status), picker_mode, pick_blur_type, pick_blur_color
blur_items                  // host-keyed array slice

// from auto_detect_pii
pii_email, pii_numeric, pii_mode, pii_redaction_color

// from automate
automate_idle, automate_tab_switch, automate_screen_share

// from shortcuts
shortcuts                   // model.shortcuts as-is
```

### 5.2 Computed automate fold

```
ss = _screen_share_cache;
has_tab_id     = typeof tab_id === 'number';
tab_suppressed = has_tab_id && _suppressed_tabs_cache.includes(tab_id);

ss_feature_enabled = automate_screen_share.enabled;
ss_site_suppressed = ss.suppressed_sites.includes(hostname);
ss_is_sharing_tab  = has_tab_id && ss.sharing_tab_id === tab_id;

ss_blur_raw    = ss.active && ss_feature_enabled && !ss_site_suppressed && !ss_is_sharing_tab;

idle_phase     = blsi.Automate.State.read_idle();
idle_feature_on = automate_idle.enabled;
idle_raw       = idle_feature_on && (idle_phase === 'idle' || idle_phase === 'locked');

ts_phase       = has_tab_id ? blsi.Automate.State.read_tab_switch(tab_id) : 'off';
ts_feature_on  = automate_tab_switch.enabled;
tab_switch_raw = ts_feature_on && ts_phase === 'fired';

idle_eff       = !tab_suppressed && idle_raw;
tab_switch_eff = !tab_suppressed && tab_switch_raw;
ss_eff         = !tab_suppressed && ss_blur_raw;

automate_blur_active   = idle_eff || tab_switch_eff || ss_eff;
automate_blur_triggers = { idle: idle_eff, tab_switch: tab_switch_eff, screen_share: ss_eff };
```

### 5.3 `engage` and skip flags

```
manual_blur          = blur_all_status;
pick_blur_present    = pick_blur_enabled;       // master toggle, items irrelevant
blur_present         = manual_blur || pick_blur_present;
automate_needs_blur  = automate_blur_active && !blur_present;

engage              = (enabled !== false) && (manual_blur || automate_needs_blur);
automate_blur_only  = automate_needs_blur;       // sole reason → defaults override 8 display knobs
automate_blur_skipped = automate_blur_active && blur_present;
automate_blur_skip_reason = !skipped ? null
                         : _rule_match  ? 'site_rule'
                         : manual_blur  ? 'manual'
                                        : 'pick_blur';
```

When `automate_blur_only` is true, `resolve()` overrides 8 settings with `DEFAULT_MODEL` values — automate-driven blur ignores user display preferences and uses safe defaults: `blur_mode`, `blur_categories`, `blur_radius`, `thorough_blur`, `reveal_mode`, `transition_duration`, `redaction_color`, `highlight_color`.

### 5.4 Site-rule provenance

```
_rule_overrides = { [field]: true }   // every key that came from a snapshot
_rule_match     = { hostname_value, hostname_type } | null
```

Popup uses these for "Managed by site rule" badges + read-only toggles. Content script appends `(site rule)` to toast strings via `_toastMsg(key, override_key)`.

### 5.5 Screen-share state echo

```
screen_share_state = {
  active, sharing_tab_id, started_at, is_sharing_tab,
}
screen_share_suppressed_for_host = ss_site_suppressed;
screen_share_suppressed_for_tab  = tab_suppressed;
```

Used by popup card + Undo affordances. Sharing-tab identity (`is_sharing_tab`) is recomputed per resolve so the sharing tab's own popup shows the correct UI.

---

## 6. Top-level enums (single source of truth)

From `src/constants.js`:

```
reveal_modes      = { none, click, hover }
blur_modes        = { blur, frosted, redacted, censored }
picker_modes      = { dynamic, sticky_page, sticky_screen }
pick_blur_modes   = { blur, frosted, color }            // no redacted/censored
pii_modes         = { blur, frosted, redacted, starred }
idle_units        = { sec, min }                         // no hr (idle API cap)
pattern_types     = { wildcard, regex, exact }
supported_languages = ['auto', 'en', 'hi_IN', 'ta_IN']
```

Legacy enum migrations applied by `validate_model`:
- `blur_mode`: `gaussian → blur`, `masked → censored`, `solid → censored`
- `pii_mode`: `gaussian → blur`, `asterisked → starred`, `hidden → starred`
- `pick_and_blur.settings.blur_type`: `gaussian → blur`
- `picker_mode`: `sticky → sticky-page`

---

## 7. Lifecycle summary — when does what happen

| Event | Effect on storage |
|---|---|
| Extension install / update | `chrome.storage.local.remove` legacy keys (`blurred_selectors`, `settings`, `rules`, `blurred_items`, `blur_all_hosts`). `_reinjectAllTabs` runs but does NOT touch storage. |
| Browser start | SW `chrome.storage.session.set` resets `blsi_screen_share` to inactive default + `blsi_automate_suppressed_tabs` to `[]`. `chrome.storage.session` is wiped on browser restart anyway, so the idle and tab_switch keys also disappear. |
| SW eviction mid-share | `_sharePorts` Map empties. Content tab's port reconnects via `chrome.runtime.connect` → `onConnect` → `_setScreenShareActive(tabId)` re-seeds the session record. Brief flicker possible. |
| Tab close | `chrome.tabs.onRemoved` strips tab id from `blsi_automate_suppressed_tabs`. Nothing else changes. |
| `chrome.idle` state change | `blsi.Automate.Idle` (background) → `blsi.Automate.State.write_idle(phase)` → session write. Resolve gates on `automate_idle.enabled`. |
| Tab visibility change / window blur | `blsi.Automate.Visibility` (content, per tab) → `State.write_tab_switch(tab_id, 'fired')` (or strips on `armed`) → session write. Resolve gates on `automate_tab_switch.enabled`. |
| `getDisplayMedia` success on Tab A | Main-world bridge fires CustomEvent → screen_share.js opens port + sends `SCREEN_SHARE_STARTED` → background `_setScreenShareActive(senderTabId)` → all tabs see `chrome.storage.session.onChanged` and re-resolve. |
| Share end (any reason) | Port disconnect → background `_setScreenShareInactive()` + `SCREEN_SHARE_NOTIFY` broadcast. |
| User saves a site rule (popup) | `Model.save_site_snapshot(hostname, type, snapshot)` → `validate_model` pads to full shape → `_storage_set(blsi_model)`. |

---

## 8. Failure modes worth knowing

| Symptom | Root cause | Where |
|---|---|---|
| Sharing tab self-blurs at start of share | `whoAmI()` race — `tab_id` still null on first `resolve()` → `is_sharing_tab=false` → `ss_blur_raw=true` | `screen_share.js:32`, `content_script.js:165` |
| Screen-share automate "skipped" while pick-blur master is on | `pick_blur_present = !!pick_blur_enabled` (master flag, not item count) → `blur_present=true` → `automate_needs_blur=false` | `storage_model.js:713-720` |
| Sharing tab never broadcasts SHARE_STARTED | `screen_share.js` listener only attached when `automate.screen_share.enabled` resolved as true for the sharing site (site rule may disable it) | `content_script.js:555` |
| Stale `tab_switch_by_tab` entry for a closed tab id | `chrome.tabs.onRemoved` is not yet wired to call `State.clear_tab_switch(tab_id)`. Resolve gates on `tab_id`, so the stale entry is harmless until Chrome reuses the id (rare; mitigated by browser-restart wipe). | follow-up |
| Two tabs disagree on resolved `engage` | `Model.on_change` is single-subscriber; popup or another module overwrote the content-script subscriber | `storage_model.js:281` |
| Sticky zone offset on transform-heavy page | `position: absolute` anchors to nearest `transform`-ed ancestor, not document root | CSS spec — known limitation |

---

## 9. Quick reference — paths people actually look up

```
Effective blur-all status for current host:
  resolve(host, url, tab).blur_all_status

Effective blur mode (after rule + automate override):
  resolve(host, url, tab).blur_mode

Should the engine engage right now?
  resolve(host, url, tab).engage   // single boolean

Why is automate skipped?
  resolve(host, url, tab).automate_blur_skip_reason  // 'site_rule' | 'manual' | 'pick_blur' | null

Is this tab the sharing tab?
  resolve(host, url, tab).screen_share_state.is_sharing_tab

User-defined shortcut for an action:
  Model.get().shortcuts['toggle-blur-all'].binding   // [{code, mods}]

Items currently pinned for this host:
  resolve(host, url, tab).blur_items   // post-rule, post-engage filter applied
```

---

## 10. Cross-file index

| Concern | File |
|---|---|
| Defaults + enums + `validate_model` | `src/constants.js` |
| Read/write API + caches + listener | `src/storage_model.js` |
| Site-rule snapshot capture/apply | `src/storage_model.js` (`capture_snapshot`, `_apply_snapshot`) |
| Screen-share session record owner | `background.js` |
| Idle event source | `src/automate/idle.js` (`chrome.idle.onStateChanged`, background only) |
| Tab-switch event source | `src/automate/visibility.js` (Page Lifecycle, content per tab) |
| Shared session-storage helpers (idle + tab_switch) | `src/automate/state.js` |
| Automate render path | `src/automate/overlay.js` (viewport overlay; driven by `engine.handleSite`) |
| getDisplayMedia interception | `src/main_world_bridge.js` (MAIN world) |
| Bridge → background relay | `src/screen_share.js` |
| Resolve consumer | `src/content_script.js` (`_sync`, `applyState`) → `src/engine.js` (`handleSite`) |
| API contract | `docs/contracts/storage_model.md`, `docs/contracts/automate/*.md` |
