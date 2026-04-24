# Popup — Claude Instructions

## What This Folder Is

The extension popup: a 320px panel rendered by `popup.html`. Vanilla JS only — no bundler, no ES modules. All files are IIFEs or plain scripts that assign `window.BlurrySite*` globals.

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
    howtoblur.css     — HTB sub-page styles
    automate.css      — Automate sub-page styles
    keyboard.css      — Shortcuts sub-page styles
    site_rules.css    — Site Rules sub-page styles
  assets/             — static images referenced by render files
```

---

## Load Order (popup.html — FIXED, never reorder)

```html
<!-- CSS -->
theme.css → popup.css → renders/howtoblur.css → renders/automate.css
         → renders/keyboard.css → renders/site_rules.css

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
popup_state.js
popup_ui.js
popup.js            ← coordinator loads last
```

`popup_state.js` and `popup_ui.js` must come **after** all render files and **before** `popup.js`.

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
| `popup.js` | _(none — IIFE)_ | coordinator |

---

## Public APIs

### BlurrySitePopupState

Owns all mutable popup state. Everything flows through this.

```js
get()                          // { settings, blurItems, hostname, isPageBlurred, neutralAfterClear }
setModel(m)                    // replace full internal model snapshot (from blsi.Model.get())
setHostname(h)
setBlurItems(items)
setPageBlurred(bool)
setNeutralAfterClear(bool)
async saveSettings(patch)      // routes flat-patch keys to correct model sections via blsi.Model.patch_section()
onExternalChange(cb)           // cb(newModel, oldModel) — fires on storage changes from other contexts
```

`settings` in `get()` is a flat view built by `_build_flat_settings(model)` — merges `model.settings`, `blur_all.settings`, `pick_and_blur.settings`, `auto_detect_pii.settings`, `automate.settings`, and `shortcuts` into one object for render files.

### BlurrySitePopupUI

Stateless DOM helpers. All inputs passed as arguments — reads no internal state.

```js
applyTheme(theme)                                 // 'dark' | 'light'
toggleTheme()                                     // flip + persist to chrome.storage.local
showToast(key, substitutions?)                    // i18n toast, auto-hides after 2.2s
setHost(hostname)
setVersion()
applyI18n()                                       // walk [data-i18n] elements
renderPowerButton(enabled)                        // toggle power class + show/hide main/off views
showView(viewId, isEnabled)                       // see Navigation section below
updateClearAll(settings, blurItems, isPageBlurred)
```

### BlurrySitePopupRender (renders/main.js)

```js
renderAll(settings, blurItems, isPageBlurred)
  // Renders modes block, PII section, automate section. Called after every state change.
```

### Sub-page renderers (renders/*.js)

All sub-page renderers share the same signature:

```js
renderBody(containerEl, settings, onSave)
  // containerEl: .bl-subpage__body element to populate
  // settings:    full settings object (read-only)
  // onSave:      function(patch) — called when user changes a control

// site_rules.js is the exception — callbacks object instead of onSave:
renderBody(containerEl, settings, { onSaveSettings, onSaveRules })
```

---

## Navigation

```js
UI.showView('bl-view-main', State.get().settings.enabled)  // back to main
UI.showView('bl-view-htb-modify',      true)               // open HTB sub-page
UI.showView('bl-view-automate-modify', true)               // open Automate sub-page
UI.showView('bl-view-shortcuts',       true)               // open Shortcuts sub-page
UI.showView('bl-view-site-rules',      true)               // open Site Rules sub-page
```

`showView` manages:
- Toggling `hidden` on the main/off views and each sub-view
- Adding/removing `bl-has-subpage` class on `document.body` (drives the CSS slide animation)

For non-main views, the `isEnabled` argument is ignored — pass `true`.
For `bl-view-main`, pass `State.get().settings.ENABLED` so the off-state renders correctly.

---

## Data Flow

```
User action
  ↓
popup.js event handler
  ↓
_saveAndApply(patch)         or     State.setXxx() directly
  ↓                                  ↓
State.saveSettings(patch)          _renderCurrent()
  ↓
blsi.Model.patch_section() / save_settings()
  ↓
chrome.storage.onChanged fires in content_script → blsi.Model.on_change → handleStorageChange → re-sync
  ↓
_renderCurrent()
  ├─ BlurrySitePopupRender.renderAll(...)
  └─ UI.updateClearAll(...)
```

Content scripts react to storage changes automatically via `blsi.Model.on_change()` — there is no explicit tab notification step. `popup.js` has two save helpers:
- `_saveAndApply(patch)` — saves via `State.saveSettings(patch)` + re-renders
- `_onSave(patch)` — same as `_saveAndApply` (no separate notifyTab call needed)
- For page-blur-state: `blsi.Model.save_blur_state(hostname, checked)` + `State.setPageBlurred()` + `_renderCurrent()`

---

## Adding a New Sub-page

1. Create `renders/mypage.js` (global: `BlurrySitePopupRenderMyPage`)
2. Create `renders/mypage.css`
3. Add both to `popup.html` — JS after the other renders, CSS with the others
4. Add a `bl-view-mypage` section to `popup.html`
5. Add `'bl-view-mypage'` to `SUB_VIEWS` array in `popup_ui.js`
6. Wire a nav button in `popup.js` (call `renderBody` then `UI.showView`)
7. Add a back button that calls `UI.showView('bl-view-main', State.get().settings.ENABLED)`

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

Each mode block declares `--bl-mode-accent` (indigo for blur-all, purple for pick-blur). Use `color-mix(in srgb, var(--bl-mode-accent) N%, ...)` for tinted backgrounds and borders — never hardcode hex values inside mode blocks.

### Separator bars

Use empty `<span class="bl-opt-sep">` — CSS renders the 2px bar. Do not use the `|` character as a text separator.

### Mode block variant classes

| Class | Meaning |
|---|---|
| `bl-mode-block--blur-all` | blur-all mode (indigo accent) |
| `bl-mode-block--pick-blur` | pick-blur mode (purple accent) |

Dot color: `.bl-mode-block__dot.is-on` = green (`#22c55e`); default = red (`#ef4444`). Not tied to accent color.

---

## Critical Rules

### No state in render files
`renders/*.js` functions are pure: they receive settings/items as arguments and produce DOM. They never call `blsi.Model`, never cache state, never read `BlurrySitePopupState`.

### popup.js is coordinator-only
No raw DOM manipulation outside of the media tooltip setup. All DOM changes go through `BlurrySitePopupRender.renderAll()` or `BlurrySitePopupUI.*`. No new standalone helper functions — add them to `popup_ui.js` if they are DOM-only, or to a render file if they are render-only.

### All i18n via chrome.i18n.getMessage
No hardcoded user-visible strings. Keys live in `_locales/en/messages.json` (source of truth). `popup.json` is a secondary fallback — always add to `messages.json` first.

### string_lint.js allow-list
If a new file introduces a `"v"` version prefix or toast key string that triggers the linter, add an entry to `ALLOW_LIST` in `scripts/string_lint.js`. Do not suppress the linter globally.

### Mode switching clears items
`_doModeSwitch(newMode)` wipes `_blurItems` and calls `_renderCurrent()`. Before switching, `_showSwitchDialog` confirms with the user if items exist.

---

## Tests

Test file for main renderer: `tests/unit/popup_render.test.js` → MODULE_PATH: `popup/renders/main.js`
Test file for keyboard renderer: `tests/unit/popup_render_shortcuts.test.js` → MODULE_PATH: `popup/renders/keyboard.js`

Run after any popup change:
```bash
npm run test:unit
```

Expected: **703 passing**.
