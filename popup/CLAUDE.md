# Popup — Claude Instructions

## What This Folder Is

Extension popup: 320px panel via `popup.html`. Vanilla JS only — no bundler, no ES modules. Files are IIFEs/plain scripts assigning `window.BlurrySite*` globals.

---

## File Map

```
popup/
  popup.html          — entry point; owns CSS + JS load order
  popup.js            — coordinator: init + event wiring only (~270 lines)
  popup_state.js      — BlurrySitePopupState: all mutable state + storage persistence
  popup_ui.js         — BlurrySitePopupUI: stateless DOM helpers
  popup.css           — all popup styles (mode blocks, chips, sliders, toasts, etc.)
  theme.css           — CSS custom properties (dark/light tokens)
  renders/
    shared.js         — BlurrySitePopupShared: t, makeToggle, updateFill, makeDivider
    main.js           — BlurrySitePopupRender: renderAll
    howtoblur.js      — BlurrySitePopupRenderHtb: HTB sub-page body
    automate.js       — BlurrySitePopupRenderAutomate: Automate sub-page body
    keyboard.js       — BlurrySitePopupRenderShortcuts: Shortcuts sub-page body
    site_rules.js     — BlurrySitePopupRenderSiteRules: Site Rules sub-page body
    general.js        — BlurrySitePopupRenderGeneral: General sub-page body
    howtoblur.css     — HTB sub-page styles
    automate.css      — Automate sub-page styles
    keyboard.css      — Shortcuts sub-page styles
    site_rules.css    — Site Rules sub-page styles
    general.css       — General sub-page styles
  assets/             — static images referenced by render files
```

---

## Load Order (popup.html — FIXED, never reorder)

```html
<!-- CSS -->
theme.css → popup.css → renders/howtoblur.css → renders/automate.css
         → renders/keyboard.css → renders/site_rules.css → renders/general.css

<!-- JS -->
../src/constants.js
../src/logger.js
../src/action_registry.js
../src/shortcut_label.js
../src/url_matcher.js
../src/storage_model.js
renders/shared.js
renders/main.js
renders/howtoblur.js
renders/automate.js
renders/keyboard.js
renders/site_rules.js
renders/general.js
popup_state.js
popup_ui.js
popup.js            ← coordinator loads last
```

`popup_state.js` + `popup_ui.js` must come **after** all render files, **before** `popup.js`.

---

## Module Globals

| File | Window global | Role |
|---|---|---|
| `renders/shared.js` | `BlurrySitePopupShared` | shared helpers: `t`, `makeToggle`, `updateFill`, `makeDivider` |
| `popup_state.js` | `BlurrySitePopupState` | state owner |
| `popup_ui.js` | `BlurrySitePopupUI` | DOM helpers |
| `renders/main.js` | `BlurrySitePopupRender` | main renderer |

| `renders/howtoblur.js` | `BlurrySitePopupRenderHtb` | HTB sub-page |
| `renders/automate.js` | `BlurrySitePopupRenderAutomate` | Automate sub-page |
| `renders/keyboard.js` | `BlurrySitePopupRenderShortcuts` | Shortcuts sub-page |
| `renders/site_rules.js` | `BlurrySitePopupRenderSiteRules` | Site Rules sub-page |
| `renders/general.js` | `BlurrySitePopupRenderGeneral` | General sub-page |
| `popup.js` | _(none — IIFE)_ | coordinator |

---

## Public APIs

### BlurrySitePopupState

Single owner of all `blsi.Model` interactions in popup. Everything flows through this.

```js
// Init
async load(hostname)           // init_cache + seed _hostname, _model, _blurItems, _isPageBlurred

// Read
get()                          // { settings, blurItems, hostname, isPageBlurred, neutralAfterClear }
setNeutralAfterClear(bool)

// Settings writes (model-shaped patch — top-level keys must match blsi.DEFAULT_MODEL sections)
async saveSettings(patch)

// Per-page blur writes (use internal _hostname — no hostname arg)
async saveBlurState(checked)   // toggle blur-all for current hostname
async removeBlurItem(itemId)   // remove a pick-blur item for current hostname
async clearHost()              // clear all blur state for current hostname

// Site rules
async saveRules(newRules)
captureSnapshot()              // → snapshot object from current model state
async saveSiteSnapshot(hostname_value, hostname_type, snapshot)
async getRules()               // → rules array from storage

// Automate
async clearAutomateBlur()
async clearScreenShareBlur()

// Export / Import
exportModel()                  // returns raw blsi.Model snapshot (no runtime extras) — for JSON export
async importSettings(model)    // patches all sections from a validated model object

// Reactivity
onExternalChange(cb)           // cb(newModel, oldModel) — fires on storage changes from other contexts
refreshFromStorage()           // re-derive all state from Model cache
```

`settings` in `get()` returns model shape directly (copy of `blsi.Model` snapshot), plus two runtime-only extras via `Object.assign`:
- `automate_blur_active` — boolean, true if any automate trigger active
- `automate_blur_triggers` — `{ idle, tab_switch, screen_share }` booleans

All other keys mirror `blsi.DEFAULT_MODEL` exactly:
- `settings.global_default_settings.enabled` — extension on/off
- `settings.global_default_settings.blur_radius` — strength slider value
- `settings.global_default_settings.reveal_mode` — 'hover'|'click'|'none'
- `settings.global_default_settings.redaction_color` — redacted-mode color
- `settings.global_default_settings.thorough_blur` — boolean
- `settings.global_default_settings.transition_duration` — ms (0=instant, 150=smooth)
- `settings.blur_all.status` — blur-all on/off (per-page toggle)
- `settings.blur_all.settings.blur_mode` — 'blur'|'frosted'|'redacted'|'censored'
- `settings.blur_all.settings.blur_categories` — `{ text, media, form, table, structure }`
- `settings.pick_and_blur.status` — pick-blur enabled (was `pick_blur_enabled`)
- `settings.pick_and_blur.settings.blur_type` — 'blur'|'frosted'|'color' (was `pick_blur_type`)
- `settings.pick_and_blur.settings.picker_mode` — 'sticky-page'|'sticky-screen'|'dynamic'
- `settings.pick_and_blur.settings.blur_color` — `{ hex, opacity }` (was `pick_blur_color`)
- `settings.auto_detect_pii.settings.email` — boolean (was `pii_email`)
- `settings.auto_detect_pii.settings.numeric` — boolean (was `pii_numeric`)
- `settings.auto_detect_pii.settings.pii_mode` — 'blur'|'frosted'|'redacted'|'starred'
- `settings.auto_detect_pii.settings.pii_redaction_color` — color hex string
- `settings.automate.settings.idle` — `{ value, unit, enabled }`
- `settings.automate.settings.tab_switch` — `{ enabled }`
- `settings.automate.settings.screen_share` — `{ enabled }`

### BlurrySitePopupUI

Stateless DOM helpers. All inputs passed as args — reads no internal state.

```js
applyTheme(theme)                                 // 'dark' | 'light'
toggleTheme()                                     // flip + persist to chrome.storage.local
showToast(key, substitutions?)                    // i18n toast, auto-hides after 15s; has logo + close button
setHost(hostname)
setVersion()
applyI18n()                                       // walk [data-i18n] elements
renderPowerButton(enabled)                        // toggle power class + show/hide main/off views
showView(viewId, isEnabled)                       // see Navigation section below
updateClearAll(settings, blurItems, isPageBlurred)
```

### BlurrySitePopupRender (renders/main.js)

```js
renderAll(settings, blurItems, isPageBlurred, onSave, onClearAutomate, onClearScreenShareBlur)
  // Renders modes block, PII section, automate section. Called after every state change.
```

### Sub-page renderers (renders/*.js)

All sub-page renderers share same signature:

```js
renderBody(containerEl, settings, onSave)
  // containerEl: .bl-subpage__body element to populate
  // settings:    full settings object (read-only)
  // onSave:      function(patch) — called when user changes a control

// site_rules.js — callbacks object instead of onSave:
renderBody(containerEl, settings, {
  onSaveSettings,    // function(patch) — settings change
  onSaveRules,       // async function(newRules) — full rules array save
  captureSnapshot,   // function() → snapshot object
  saveSiteSnapshot,  // async function(hostname_value, hostname_type, snapshot)
  getRules,          // async function() → rules array
})

// general.js — callbacks object instead of onSave:
renderBody(containerEl, settings, {
  onSave,            // function(patch) — settings change
  debugEnabled,      // boolean — current blsi.Logger.enabled value (read at render time)
  onToggleDebug,     // function(bool) — called when debug toggle changes; calls Logger.enable/disable
  onExport,          // function() — triggers JSON download of full model
  onImport,          // function(text: string) — receives raw file text; popup.js validates + saves
})
```

---

## Navigation

```js
UI.showView('bl-view-main', State.get().settings.enabled)  // back to main
UI.showView('bl-view-htb-modify',      true)               // open HTB sub-page
UI.showView('bl-view-automate-modify', true)               // open Automate sub-page
UI.showView('bl-view-shortcuts',       true)               // open Shortcuts sub-page
UI.showView('bl-view-site-rules',      true)               // open Site Rules sub-page
UI.showView('bl-view-general',         true)               // open General sub-page
```

`showView` manages:
- Toggling `hidden` on main/off views + each sub-view
- Adding/removing `bl-has-subpage` on `document.body` (drives CSS slide animation)

Non-main views: `isEnabled` ignored — pass `true`. `bl-view-main`: pass `State.get().settings.ENABLED` so off-state renders correctly.

---

## Data Flow

```
User action
  ↓
popup.js event handler
  ↓
State.saveSettings(patch)     State.saveBlurState(checked)
State.removeBlurItem(id)      State.clearHost()
State.saveRules(rules)        ...other State write methods
  ↓
blsi.Model.* (all Model access flows through popup_state.js only)
  ↓
chrome.storage.onChanged fires in content_script → blsi.Model.on_change → handleStorageChange → re-sync
  ↓
_renderCurrent()
  ├─ BlurrySitePopupRender.renderAll(...)
  └─ UI.updateClearAll(...)
```

`popup_state.js` sole owner of all `blsi.Model` calls in popup. `popup.js` + render files never call `blsi.Model` directly. Content scripts react to storage changes via `blsi.Model.on_change()`.

`popup.js` save helpers:
- `_saveAndApply(patch)` — `State.saveSettings(patch)` + re-render
- `_onSave(patch)` — alias for `_saveAndApply`

---

## Adding a New Sub-page

1. Create `renders/mypage.js` (global: `BlurrySitePopupRenderMyPage`)
2. Create `renders/mypage.css`
3. Add both to `popup.html` — JS after other renders, CSS with others
4. Add `bl-view-mypage` section to `popup.html`
5. Add `'bl-view-mypage'` to `SUB_VIEWS` array in `popup_ui.js`
6. Wire nav button in `popup.js` (call `renderBody` then `UI.showView`)
7. Add back button calling `UI.showView('bl-view-main', State.get().settings.ENABLED)`

---

## CSS Conventions

### Theme tokens (from theme.css)

```
Backgrounds:   --bl-base  --bl-surface  --bl-raised
Colors:        --bl-amber  --bl-sky  --bl-cyan  --bl-violet  --bl-indigo  --bl-purple  --bl-danger
Text:          --bl-text-primary  --bl-text-muted  --bl-text-dim
Divider:       --bl-divider
```

### Mode block accent

Each mode block declares `--bl-mode-accent` (indigo for blur-all, purple for pick-blur). Use `color-mix(in srgb, var(--bl-mode-accent) N%, ...)` for tinted backgrounds/borders — never hardcode hex inside mode blocks.

### Separator bars

Use empty `<span class="bl-opt-sep">` — CSS renders 2px bar. No `|` as text separator.

### Mode block variant classes

| Class | Meaning |
|---|---|
| `bl-mode-block--blur-all` | blur-all mode (indigo accent) |
| `bl-mode-block--pick-blur` | pick-blur mode (purple accent) |

Dot color: `.bl-mode-block__dot.is-on` = green (`#22c55e`); default = red (`#ef4444`). Not tied to accent.

---

## Critical Rules

### Use DEFAULT_MODEL namespace everywhere
`settings` passed to all render files uses exact `blsi.DEFAULT_MODEL` shape — no flat aliases. Never use old flat keys (`blur_mode`, `pick_blur_enabled`, `pick_blur_type`, `pii_email`, `pii_numeric`, `picker_mode`, `blur_radius`, `reveal_mode`, `redaction_color`, `thorough_blur`, `transition_duration`, `blur_categories`, `pick_blur_color`, `automate_idle`, `automate_tab_switch`, `automate_screen_share`, `enabled`). Always use nested path (`settings.blur_all.settings.blur_mode`, `settings.global_default_settings.enabled`, etc.).

`saveSettings(patch)` takes model-shaped object — top-level keys must be `blsi.DEFAULT_MODEL` section names (`global_default_settings`, `blur_all`, `pick_and_blur`, `auto_detect_pii`, `automate`, `shortcuts`). Calls `patch_section` once per top-level key.

### No state in render files
`renders/*.js` functions are pure: receive settings/items as args, produce DOM. Never call `blsi.Model` or `BlurrySitePopupState` directly. All storage access via callbacks from `popup.js`.

### popup.js is coordinator-only
No raw DOM manipulation outside media tooltip setup. All DOM changes via `BlurrySitePopupRender.renderAll()` or `BlurrySitePopupUI.*`. No new standalone helpers — add to `popup_ui.js` if DOM-only, render file if render-only.

### All i18n via chrome.i18n.getMessage
No hardcoded user-visible strings. Keys in `_locales/en/messages.json` (source of truth). All locales must stay in sync — run `npm run i18n:lint` to verify.

### string_lint.js allow-list
New file with `"v"` version prefix or toast key string triggering linter: add entry to `ALLOW_LIST` in `scripts/string_lint.js`. Don't suppress linter globally.

### Mode switching clears items
`_doModeSwitch(newMode)` wipes `_blurItems`, calls `_renderCurrent()`. Before switch, `_showSwitchDialog` confirms with user if items exist.

---

## Tests

Test file for main renderer: `tests/unit/popup_render.test.js` → MODULE_PATH: `popup/renders/main.js`
Test file for keyboard renderer: `tests/unit/popup_render_shortcuts.test.js` → MODULE_PATH: `popup/renders/keyboard.js`

Run after any popup change:
```bash
npm run test:unit
```

Expected: **743 passing**.