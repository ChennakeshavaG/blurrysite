# Popup v2 Redesign — Handoff Document

**Last updated:** 2026-04-19  
**Status:** Plan 1 written. Plans 2 & 3 not yet written. Nothing executed yet.

---

## What This Is

Full visual redesign of the Blurry Site popup. The old popup was functional but visually poor. This rebuilds it with a Slate dark theme, proper color semantics, and structured sub-pages.

---

## Canonical Spec

`docs/superpowers/specs/2026-04-19-popup-redesign-v2-design.md`

Key decisions from spec:
- **Amber** = all interactive actions (toggles, chips, sliders, option selections)
- **Cyan** `#22d3ee` (dark) / Sky `#0284c7` (light) = all navigation (Modify →, nav arrows, Open Picker, sub-page links)
- **Swappable modes**: Blur All or Pick & Blur — one active at a time
- **Main popup is read-only** — all config behind Modify sub-pages
- **Automate uses sliders** with Chrome API constraint annotations (idle: 15s min / 50min max in red; timer: 30s min)

---

## Color Token Summary

| Token | Dark | Light |
|---|---|---|
| `--bl-base` | `#0a0b0f` | `#f8f9fc` |
| `--bl-surface` | `#13151f` | `#eef0f6` |
| `--bl-raised` | `#1e2130` | `#e4e8f2` |
| `--bl-amber` | `#fbbf24` | `#d97706` |
| `--bl-sky` | `#38bdf8` | `#0284c7` (nav in light) |
| `--bl-cyan` | `#22d3ee` | `#0284c7` (nav in dark) |
| `--bl-danger` | `#f87171` | `#dc2626` |
| `--bl-text-primary` | `#e8eaf0` | `#0f1117` |
| `--bl-text-muted` | `#6b7280` | `#6b7280` |
| `--bl-text-dim` | `#3a3d50` | `#9098b0` |

Note: `--bl-cyan` token does NOT exist yet in `popup/theme.css` — Plan 1 adds it.

---

## File Map (all popup files)

| File | Purpose |
|---|---|
| `popup/theme.css` | CSS custom property tokens (dark + light) |
| `popup/popup.css` | All popup component styles |
| `popup/popup.html` | HTML structure — sub-page shells already present but empty |
| `popup/popup_render.js` | Stateless renderer — `renderAll(settings)` called from popup.js |
| `popup/popup_subpages.js` | **Does not exist yet** — Plan 2 creates this |
| `popup/popup.js` | Main orchestrator — init, events, save, navigation |

Script load order in `popup.html`:
```
constants.js → logger.js → action_registry.js → storage_manager.js → popup_render.js → popup.js
```
After Plan 2, `popup_subpages.js` is inserted before `popup.js`.

---

## Current State of Each File

### popup/theme.css
Has all tokens **except** `--bl-cyan`. Currently has `--bl-sky: #38bdf8` in dark and `--bl-sky: #0284c7` in light. Plan 1 adds `--bl-cyan` as a separate token.

### popup/popup.css
- `.bl-btn-text` is plain muted text (no border, no background) — needs cyan pill style
- `.bl-nav-row__arrow` is `color: var(--bl-text-dim)` — needs `color: var(--bl-cyan); font-weight: 600`
- `.bl-chip--sky.bl-chip--active` block (lines 240–243) exists — needs to be deleted
- Everything else is correct

### popup/popup_render.js
- PII chips line ~132: `btn.className = 'bl-chip' + (isActive ? ' bl-chip--sky bl-chip--active' : '');`
  → needs `' bl-chip--sky'` removed
- HTB chips already use amber correctly (no sky class)
- `renderAll(settings)` calls: `renderModesSection`, `renderHtbSection`, `renderPiiSection`, `renderAutomateSection`

### popup/popup.js
- `_saveAndApply(patch)` — uses `blsi.deepMerge(_settings, patch)` then saves
- `showView(viewId)` — manages main/off/4 sub-pages visibility
- Navigation is wired to `showView` but sub-page bodies are NOT rendered (they're empty)
- Sub-page shells exist in HTML: `#bl-htb-modify-body`, `#bl-automate-modify-body`, `#bl-shortcuts-body`, `#bl-site-rules-body`

### popup/popup.html
- Correct structure per v2 spec
- Sub-page `<div class="bl-subpage__body">` containers are all empty (no content)
- Clear All button is always `disabled`
- Open Picker button is rendered by `popup_render.js` but has no click handler yet

---

## Plans

### Plan 1 — Color Foundation (WRITTEN, NOT EXECUTED)
**File:** `docs/superpowers/plans/2026-04-19-popup-v2-plan1-color-foundation.md`

Tasks:
1. Add `--bl-cyan: #22d3ee` (dark) and `--bl-cyan: #0284c7` (light) to `popup/theme.css`
2. In `popup/popup.css`:
   - `.bl-btn-text` → cyan pill (background tint + border + `color: var(--bl-cyan)`)
   - `.bl-nav-row__arrow` → `color: var(--bl-cyan); font-weight: 600`
   - Delete `.bl-chip--sky.bl-chip--active` block
3. In `popup/popup_render.js` line ~132: remove `' bl-chip--sky'` from PII chip className
4. Run `npm run test:unit` — expect 595 tests pass

**Zero logic changes. Pure CSS/class cleanup.**

---

### Plan 2 — HTB Modify + Automate Modify Sub-pages (NOT WRITTEN)

**Goal:** Implement content for the two Modify sub-pages that currently show blank bodies.

#### Files to create/modify:
- **Create:** `popup/popup_subpages.js` — IIFE `BlurrySitePopupSubpages`, exposes `{ renderHtbModify, renderAutomateModify }`
- **Modify:** `popup/popup.css` — add slider CSS, segmented control CSS, categories grid CSS
- **Modify:** `popup/popup.html` — add `<script src="popup_subpages.js"></script>` before `popup.js`
- **Modify:** `popup/popup.js` — call sub-page renders when navigating, wire save callbacks
- **Create:** `tests/unit/popup_subpages.test.js`

#### `popup/popup_subpages.js` contract:

```js
// IIFE, window.BlurrySitePopupSubpages = ...
// renderHtbModify(container, settings, onSave)
//   onSave: async (patch) => void — calls _saveAndApply in popup.js then re-renders
// renderAutomateModify(container, settings, onSave)
```

#### `renderHtbModify(container, settings, onSave)` renders:

1. **Type chips** — `['gaussian','frosted','redacted','masked']` for blur-all, `['gaussian','frosted','color']` for pick-blur. Active chip = `bl-chip--active`. Click → `onSave({ BLUR_MODE: t })` or `{ PICK_BLUR_TYPE: t }`.

2. **Categories grid** (blur-all only) — 2-col checkbox grid. Keys: TEXT, MEDIA, FORM, TABLE, STRUCTURE. i18n: `cat_text`, `cat_media`, `cat_form`, `cat_table`, `cat_structure`. Change → `onSave({ BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES, [key]: checked } })`.

3. **Strength slider** — hidden for `color`/`redacted`/`masked`. `<input type="range" min="2" max="20" step="1">`. Value display updates on `input`, saves `{ BLUR_RADIUS: Number(slider.value) }` on `change`. Labels: Subtle / Moderate / Strong.

4. **Reveal mode segmented** — hidden for `color`. Three buttons: Hover / Click / None. Active = `is-active` class. Click → `onSave({ REVEAL_MODE: val })`. i18n keys: `reveal_hover`, `reveal_click`, `reveal_none`.

5. **Thorough Blur toggle** — `<input type="checkbox">` + `.bl-toggle__track`. Change → `onSave({ THOROUGH_BLUR: checked })`. Label: i18n `setting_thorough_blur`. Hint: `setting_thorough_hint`.

#### `renderAutomateModify(container, settings, onSave)` renders:

**Tab Switch:**
- Toggle only. Label: `setting_auto_blur_tab`. Hint: `setting_auto_blur_tab_hint`.
- Save: `onSave({ AUTOMATE: { TAB_SWITCH: { ENABLED: checked } } })`

**Idle blur:**
- Enable toggle + slider.
- Slider: `min=15 max=3000 step=15` (seconds). Initial = `_toSec(IDLE.VALUE, IDLE.UNIT)`.
- Labels: `<span class="is-limit">15s min</span>` · `5 min` · `25 min` · `<span class="is-limit">50 min max</span>`
- `.is-limit` labels use `color: var(--bl-danger)`.
- Toggle save: `onSave({ AUTOMATE: { IDLE: { ENABLED: checked } } })`
- Slider save: `onSave({ AUTOMATE: { IDLE: _idleFromSec(secs) } })` where `_idleFromSec(secs)` returns `{ VALUE, UNIT }` — if secs < 60 → UNIT:'sec'; else UNIT:'min', VALUE:Math.round(secs/60).

**Timer:**
- Enable toggle + slider.
- Slider: `min=30 max=7200 step=30` (seconds). Initial = `_toSec(TIMER.VALUE, TIMER.UNIT)`.
- Labels: `<span class="is-limit">30s min</span>` · `5 min` · `30 min` · `1 hr` · `2 hr`
- Toggle save: `onSave({ AUTOMATE: { TIMER: { ENABLED: checked } } })`
- Slider save: `onSave({ AUTOMATE: { TIMER: _timerFromSec(secs) } })` where `_timerFromSec` returns `{ VALUE, UNIT }` — if secs < 60 → sec; if secs < 3600 → min; else hr.

**Footer note:** Dynamic string: `"When triggered → applies current [modeLabel] · [typeLabel]"`

#### Helper functions (inside the IIFE):

```js
function _toSec(value, unit) {
  if (unit === 'hr')  return value * 3600;
  if (unit === 'min') return value * 60;
  return value;
}
function _fmtTime(secs) {
  if (secs < 60)   return secs + 's';
  if (secs < 3600) return Math.round(secs / 60) + ' min';
  return (secs / 3600).toFixed(1).replace('.0', '') + ' hr';
}
function _idleFromSec(secs) {
  if (secs < 60) return { VALUE: secs, UNIT: 'sec' };
  return { VALUE: Math.round(secs / 60), UNIT: 'min' };
}
function _timerFromSec(secs) {
  if (secs < 60)   return { VALUE: secs, UNIT: 'sec' };
  if (secs < 3600) return { VALUE: Math.round(secs / 60), UNIT: 'min' };
  return { VALUE: Math.round(secs / 3600), UNIT: 'hr' };
}
```

#### CSS to add to `popup/popup.css`:

```css
/* ── Subpage control groups ──────────────────────────────────────────── */
.bl-control-group { margin-bottom: 16px; }
.bl-control-group__label {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--bl-text-dim); margin-bottom: 6px;
  display: block;
}

/* Slider */
.bl-slider-wrap { display: flex; flex-direction: column; gap: 4px; }
.bl-slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 4px; border-radius: 2px;
  background: var(--bl-raised); outline: none; cursor: pointer;
}
.bl-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--bl-amber); cursor: pointer;
  border: 2px solid var(--bl-base);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bl-amber) 30%, transparent);
}
.bl-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--bl-amber); cursor: pointer;
  border: 2px solid var(--bl-base);
}
.bl-slider-labels {
  display: flex; justify-content: space-between;
  font-size: 10px; color: var(--bl-text-muted);
}
.bl-slider-labels .is-limit { color: var(--bl-danger); }
.bl-slider-value { font-size: 11px; color: var(--bl-amber); font-weight: 600; text-align: right; }

/* Segmented control */
.bl-segmented {
  display: flex; border: 1px solid var(--bl-raised);
  border-radius: 8px; overflow: hidden;
}
.bl-segmented__btn {
  flex: 1; background: none; border: none;
  border-right: 1px solid var(--bl-raised);
  cursor: pointer; font-size: 11px; padding: 6px 0;
  color: var(--bl-text-muted);
  transition: color 0.15s, background 0.15s;
}
.bl-segmented__btn:last-child { border-right: none; }
.bl-segmented__btn:hover { color: var(--bl-text-primary); background: var(--bl-raised); }
.bl-segmented__btn.is-active {
  background: color-mix(in srgb, var(--bl-amber) 12%, var(--bl-raised));
  color: var(--bl-amber); font-weight: 600;
}

/* Categories grid */
.bl-categories-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.bl-cat-check {
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; font-size: 12px; color: var(--bl-text-primary); padding: 4px 0;
}
.bl-cat-check input[type="checkbox"] { accent-color: var(--bl-amber); width: 14px; height: 14px; cursor: pointer; }

/* Subpage footer note */
.bl-subpage-note {
  font-size: 11px; color: var(--bl-text-muted);
  margin-top: 16px; padding-top: 12px;
  border-top: 1px solid var(--bl-raised); line-height: 1.5;
}
```

#### popup.js wiring (Plan 2 changes):

Replace the two existing navigation click handlers and the HTB chip handler with:

```js
function _renderHtbModifyPage() {
  const body = document.getElementById('bl-htb-modify-body');
  if (!body) return;
  BlurrySitePopupSubpages.renderHtbModify(body, _settings, async (patch) => {
    await _saveAndApply(patch);
    _renderHtbModifyPage();
  });
}

function _renderAutomateModifyPage() {
  const body = document.getElementById('bl-automate-modify-body');
  if (!body) return;
  BlurrySitePopupSubpages.renderAutomateModify(body, _settings, async (patch) => {
    await _saveAndApply(patch);
    _renderAutomateModifyPage();
  });
}

// Replace old handlers:
document.getElementById('bl-htb-modify').addEventListener('click', () => {
  showView('bl-view-htb-modify');
  _renderHtbModifyPage();
});
document.getElementById('bl-htb-chips').addEventListener('click', (e) => {
  if (e.target.closest('.bl-chip')) { showView('bl-view-htb-modify'); _renderHtbModifyPage(); }
});
document.getElementById('bl-automate-modify').addEventListener('click', () => {
  showView('bl-view-automate-modify');
  _renderAutomateModifyPage();
});
```

#### Test file: `tests/unit/popup_subpages.test.js`

Follow the pattern of `tests/unit/popup_render.test.js`. Key tests:
- `renderHtbModify` — 4 chips for blur-all, 3 for pick-blur
- `renderHtbModify` — active chip has `bl-chip--active`
- `renderHtbModify` — categories grid present in blur-all, absent in pick-blur
- `renderHtbModify` — strength slider present for gaussian, absent for color/redacted/masked
- `renderHtbModify` — reveal segmented present for gaussian, absent for color
- `renderHtbModify` — active reveal has `is-active`
- `renderHtbModify` — chip click calls onSave with correct patch key (`BLUR_MODE` for blur-all, `PICK_BLUR_TYPE` for pick-blur)
- `renderHtbModify` — category checkbox change calls onSave with `BLUR_CATEGORIES` patch
- `renderHtbModify` — thorough blur toggle calls onSave with `{ THOROUGH_BLUR: true/false }`
- `renderAutomateModify` — tab switch toggle renders, calls onSave with `TAB_SWITCH.ENABLED`
- `renderAutomateModify` — idle slider has `min=15 max=3000`
- `renderAutomateModify` — timer slider has `min=30 max=7200`
- `renderAutomateModify` — idle enable toggle calls onSave with `AUTOMATE.IDLE.ENABLED`
- `renderAutomateModify` — timer enable toggle calls onSave with `AUTOMATE.TIMER.ENABLED`

Expected test count after Plan 2: ~618 (595 existing + ~23 new).

---

### Plan 3 — Interactive Features (NOT WRITTEN)

**Goal:** Wire up all the interactive features that are currently stubs.

#### Files to modify:
- `popup/popup_render.js` — extend `renderModesSection(settings, blurItems)` for Pick & Blur item list
- `popup/popup_subpages.js` — add `renderShortcutsSubpage` and `renderSiteRulesSubpage`
- `popup/popup.css` — confirmation modal CSS, pick-blur item row CSS, shortcuts list CSS
- `popup/popup.js` — mode switching, Clear All, load blur items, Open Picker, wire shortcuts/site-rules sub-pages

#### Feature: Mode switching (click waiting block → switch)

When user clicks the waiting mode block:
1. Check if current mode has blur items via `blsi.Storage.getBlurItems(host)`
2. If items exist → show inline confirmation: "Switching modes deletes your [N] saved blurs. Continue?"
3. On confirm → `blsi.Storage.clearHost(host)` → `_saveAndApply({ ACTIVE_MODE: newMode })`
4. On cancel → do nothing

Confirmation UI: simple inline `<div class="bl-confirm-bar">` injected into the mode block (not a modal). Contains message + "Switch" (amber) + "Cancel" (muted) buttons.

#### Feature: Clear All button

Enable/disable logic:
- Pick & Blur mode: enable if `blurItems.length > 0`
- Blur All mode: enable if `settings.ENABLED === true`

Click handler:
- Pick & Blur: `blsi.Storage.clearHost(host)` → reload items → re-render
- Blur All: `_saveAndApply({ ENABLED: false })` → `renderPowerButton(false)`

#### Feature: Pick & Blur items list

Extend `renderAll(settings, blurItems)` (blurItems optional, defaults to `[]`).

In `_renderPickBlurBlock`, when `blurItems.length > 0`, render item list instead of empty state:
```
[dot] [selector truncated] [type badge] [✕ button]
```
Each row: `<div class="bl-item-row">`. ✕ button calls `blsi.Storage.removeBlurItem(item.id, host)` then reloads.

In popup.js: load blur items on init and after any storage change:
```js
let _blurItems = [];
// After _settings loaded:
blsi.Storage.getBlurItems(_hostname).then(items => {
  _blurItems = items || [];
  BlurrySitePopupRender.renderAll(_settings, _blurItems);
  _updateClearAll();
});
```

#### Feature: Open Picker button

In `popup.js`, wire click via event delegation on `#bl-modes`:
```js
document.getElementById('bl-modes').addEventListener('click', (e) => {
  if (e.target.id === 'bl-open-picker') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {
        type: blsi.POPUP.TOGGLE_PICKER  // wait — check actual type
      }, () => { void chrome.runtime.lastError; });
    });
    window.close();
  }
});
```
**Note:** The correct message type for toggling picker from popup is `blsi.COMMAND.TOGGLE_PICKER` — send via `chrome.tabs.sendMessage` directly to the tab.

#### Feature: Shortcuts sub-page (read-only Phase 1)

In `popup_subpages.js`, add:
```js
function renderShortcutsSubpage(container, settings) {
  container.innerHTML = '';
  // For each action in blsi.Actions.list():
  //   Show: action.label + action.description
  //   Show: current binding from settings.SHORTCUTS[action.id].binding
  //   Use blsi.ShortcutLabel.bindingLabel(binding) for display
  //   Mark reserved bindings with a warning
}
```
Wire in `popup.js`: call on `bl-nav-shortcuts` click.

#### Feature: Site Rules sub-page

In `popup_subpages.js`, add:
```js
function renderSiteRulesSubpage(container, settings, onSaveRules) {
  // Load rules via blsi.Storage.getRules()
  // Render rule list: each row = pattern + mode badge + Edit + Delete
  // "+ Add Rule" button → inline form row
  // Save: blsi.Storage.saveRules(updatedRules) → re-render
}
```
Wire in `popup.js`: call on `bl-nav-site-rules` click.

#### CSS to add (Plan 3):

```css
/* Confirmation bar (mode switching) */
.bl-confirm-bar {
  margin-top: 8px; padding: 8px 10px;
  background: color-mix(in srgb, var(--bl-danger) 8%, var(--bl-raised));
  border: 1px solid color-mix(in srgb, var(--bl-danger) 25%, transparent);
  border-radius: 8px; font-size: 11px; color: var(--bl-text-primary);
}
.bl-confirm-bar__actions { display: flex; gap: 8px; margin-top: 6px; }

/* Pick & Blur item rows */
.bl-item-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid var(--bl-raised); font-size: 11px;
}
.bl-item-row:last-child { border-bottom: none; }
.bl-item-row__selector { flex: 1; color: var(--bl-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bl-item-row__type { font-size: 10px; color: var(--bl-text-dim); flex-shrink: 0; }
.bl-item-row__remove { background: none; border: none; cursor: pointer; color: var(--bl-text-dim); font-size: 14px; flex-shrink: 0; transition: color 0.15s; }
.bl-item-row__remove:hover { color: var(--bl-danger); }

/* Shortcuts list */
.bl-shortcut-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; border-bottom: 1px solid var(--bl-raised);
}
.bl-shortcut-row:last-child { border-bottom: none; }
.bl-shortcut-row__label { flex: 1; font-size: 12px; color: var(--bl-text-primary); }
.bl-shortcut-row__binding {
  font-size: 11px; color: var(--bl-text-dim);
  background: var(--bl-raised); border-radius: 4px; padding: 2px 6px; white-space: nowrap;
}
.bl-shortcut-row__warn { font-size: 10px; color: var(--bl-danger); margin-top: 2px; }

/* Site rules list */
.bl-rule-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; border-bottom: 1px solid var(--bl-raised); font-size: 12px;
}
.bl-rule-row:last-child { border-bottom: none; }
.bl-rule-row__pattern { flex: 1; color: var(--bl-text-primary); overflow: hidden; text-overflow: ellipsis; }
.bl-rule-add { margin-top: 12px; }
```

---

## Settings Shape Reference (for sub-pages)

```js
settings = {
  ENABLED: true,
  ACTIVE_MODE: 'blur-all',          // 'blur-all' | 'pick-blur'
  BLUR_MODE: 'gaussian',             // 'gaussian'|'frosted'|'redacted'|'masked'
  BLUR_RADIUS: 6,
  BLUR_CATEGORIES: { TEXT, MEDIA, FORM, TABLE, STRUCTURE },
  REVEAL_MODE: 'hover',              // 'hover'|'click'|'none'
  THOROUGH_BLUR: false,
  PICK_BLUR_TYPE: 'gaussian',        // 'gaussian'|'frosted'|'color'
  PICK_BLUR_COLOR: { HEX: '#000000', OPACITY: 1.0 },
  PII_MODE: 'gaussian',              // 'gaussian'|'frosted'|'redacted'|'asterisked'
  AUTO_DETECT: { EMAIL: false, NUMERIC: false },
  AUTOMATE: {
    TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false },   // UNIT: 'sec'|'min'|'hr'
    IDLE:  { VALUE: 5, UNIT: 'min', ENABLED: false },   // UNIT: 'sec'|'min' (no 'hr')
    TAB_SWITCH: { ENABLED: false },
  },
  SHORTCUTS: { TOGGLE_BLUR_ALL: { binding: [...] }, ... },
}
```

deepMerge is recursive — partial patches like `{ AUTOMATE: { IDLE: { ENABLED: true } } }` safely merge without clobbering TIMER or TAB_SWITCH.

---

## Test Baseline

Current: **595 tests** in `tests/unit/` across 20 test files.  
Run: `npm run test:unit`

After Plan 2: ~618 tests (new `tests/unit/popup_subpages.test.js`)  
After Plan 3: ~640 tests (extensions to popup_render + popup_subpages)

Test pattern — all test files follow `tests/unit/popup_render.test.js`:
- `loadXxx()` guards with `if (global.BlurrySiteXxx) return;`
- `require(MODULE_PATH)` for real file, `(0, eval)(buildStubSource())` as fallback
- `buildStubSource()` must match the public API exactly
- `chrome.i18n.getMessage.mockImplementation((key) => key)` for i18n

---

## Execution Order

1. Execute Plan 1 (color foundation) — pure CSS/class, zero logic risk
2. Execute Plan 2 (sub-page renderers) — new file, minimal impact on existing code
3. Execute Plan 3 (interactive features) — most complex, depends on Plans 1+2

Each plan should be executed with tests passing before moving to the next.
