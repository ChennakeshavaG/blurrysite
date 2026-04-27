# Site Rules & Settings: How They Work

## Site Rules: Data Shape

A site rule entry in `model.site_rules[]`:

```js
{
  hostname_value: 'example.com',          // pattern string (max 500 chars)
  hostname_type: 'exact'|'wildcard'|'regex',
  blur_all: boolean|null,                 // null = inherit global blur_all.status
  items: [                                // saved blur zones (max 10)
    { type: 'dynamic', selector, name },
    { type: 'sticky', id, anchor:'page'|'screen', x, y, width, height, xPct, yPct, ... }
  ],
  settings: { ... }                       // partial settings override for this host
}
```

Two conceptual kinds:
- **Exact entries** (`hostname_type: 'exact'`) — per-hostname, store `items` + `blur_all`
- **Pattern rules** (`wildcard`/`regex`) — URL-matched overrides; managed via popup Site Rules UI

---

## Storage: Single Key, Feature-Grouped

All settings live under `chrome.storage.local['blsi_model']`:

```js
{
  settings: { blur_radius, reveal_mode, enabled, thorough_blur, blur_categories, ... },
  blur_all:       { status, settings: { blur_mode } },
  pick_and_blur:  { status, settings: { picker_mode, blur_type, blur_color } },
  auto_detect_pii:{ status, settings: { email, numeric, pii_mode } },
  automate:       { status, settings: { timer, idle, tab_switch } },
  shortcuts:      { 'toggle-blur-all': { binding: [...] }, ... },
  site_rules:     [ ...rule entries... ]
}
```

---

## Settings Resolution: `blsi.Model.resolve(hostname, url)`

Located at `src/storage_model.js`. Merge order (later wins):

1. Global `settings` (blur_radius, reveal_mode, etc.)
2. `blur_all.settings.blur_mode`
3. `pick_and_blur.settings.*`
4. `auto_detect_pii.settings.*`
5. `automate.settings.*`
6. `shortcuts`
7. First matching **wildcard/regex** rule's `.settings` (via `blsi.UrlMatcher.matchesPattern`)
8. Exact **hostname** rule's `.settings` (always wins over wildcard)
9. `engage` — `exact.blur_all ?? global blur_all.status` (null = inherit)
10. `blur_items` — `exact.items` if `pick_and_blur.status` is true, else `[]`

Returns a flat object ready for the blur engine — no further resolution needed downstream.

---

## Application Flow

### Init (content_script.js)
1. `Store.init_cache()` — load `blsi_model` from chrome.storage
2. `Store.resolve(hostname, url)` — get flat merged settings
3. `applyState(resolved)` — apply everything:
   - CSS vars (`--bl-si-radius`, `--bl-si-highlight-color`, etc.)
   - Shortcuts, Picker, TabPrivacy, Reveal, PII detection, Auto-blur, Blur timer
   - `await _sync()` → `Engine.handleSite(resolved)` — walk DOM, apply blur classes

### On settings change (any context)
1. `chrome.storage.onChanged` fires in all contexts
2. Self-echo detection (cache deep-compare) suppresses own writes
3. Content_script: `handleStorageChange` → `resolve()` → `applyState()` → `_sync()`
4. Popup: `State.refreshFromStorage()` → `_renderCurrent()`

### Popup save path
```
User action → _saveAndApply(patch)
  → State.saveSettings(patch) routes keys:
      global keys         → Model.save_settings()
      blur_mode           → Model.patch_section('blur_all', ...)
      pick_blur_*         → Model.patch_section('pick_and_blur', ...)
      pii_*               → Model.patch_section('auto_detect_pii', ...)
      automate_*          → Model.patch_section('automate', ...)
  → chrome.storage writes async → onChanged → content_script re-syncs
```

### Per-site blur_all (special case)
`Model.save_blur_state(hostname, bool)` writes directly to `site_rules[exact].blur_all`. Separate from global `blur_all.status`.

---

## Key Files

| File | Role |
|---|---|
| `src/constants.js` | `DEFAULT_MODEL`, `build_default_model()`, `validate_model()` |
| `src/storage_model.js` | `init_cache`, `resolve`, `patch_section`, `save_blur_state`, `get_rules`, `save_rules`, `set_site_entry` |
| `src/url_matcher.js` | `matchesPattern`, `resolveSettings`, `MAX_PATTERN_LENGTH` |
| `src/content_script.js` | `init()`, `_sync()`, `applyState()`, `handleStorageChange()` |
| `src/blur_engine.js` | `handleSite(resolved)` — DOM reconciliation |
| `popup/popup_state.js` | `saveSettings()`, `refreshFromStorage()`, flat settings view |
| `popup/popup.js` | `_saveAndApply()`, blur-all toggle, external change subscriber |
| `popup/renders/site_rules.js` | Pattern rules UI (wildcard/regex CRUD) |
