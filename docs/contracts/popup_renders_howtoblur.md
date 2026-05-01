# Contract: popup/renders/howtoblur.js

## Purpose

Sub-page body renderer for the **How to Blur** ("Modify") screen — used by both the Blur All and Pick & Blur mode blocks. Builds the full control surface: reveal-mode segmented control, transition toggle, blur-type chips, strength slider (or redaction color picker), categories grid (Blur All only), thorough-blur toggle (Blur All only), and color picker (Pick & Blur + `'color'` type only).

Pure renderer: receives `settings` + `onSave(patch)` callback; never reads or writes storage directly. State lives in `popup_state.js`; reactivity is driven by the popup-level re-render after each save.

Exposed as `window.BlurrySitePopupRenderHtb` (IIFE — no ES module syntax).

## Public API

### `renderBody(containerEl, settings, onSave, isBlurAll)`

Populates `containerEl` (a `.bl-subpage__body` div) with all How-to-Blur controls. Clears and rebuilds on every call — safe to call multiple times.

| Param | Type | Description |
|---|---|---|
| `containerEl` | `Element` | Container to populate. `replaceChildren()` is called first. |
| `settings` | `object` | Full current settings object (model shape from `BlurrySitePopupState.get().settings`). Read-only. |
| `onSave` | `(patch: object) => void` | Called with a model-shaped partial settings patch on every control change. |
| `isBlurAll` | `boolean` | Selects which mode's controls to render. `true` = Blur All variant; `false` = Pick & Blur variant. Default `true` when undefined. |

**Returns:** none.

**Sections rendered, in order:**

1. **Reveal mode** segmented control (`hover` / `click` / `none`) — always visible. Writes `global_default_settings.reveal_mode`.
2. **Transition toggle** (instant 0 ms ↔ smooth 150 ms) — always visible. Writes `global_default_settings.transition_duration`.
3. **Type chips** — Blur All: `blur` / `frosted` / `redacted` / `censored`; Pick & Blur: `blur` / `frosted` / `color`. Each chip carries `data-tooltip-media` pointing at `popup/assets/mode_<type>.svg` for the hover preview tooltip. Writes `blur_all.settings.blur_mode` or `pick_and_blur.settings.blur_type`. Click triggers in-place visibility recalculation via `_updateVisibility` — no full re-render.
4. **Strength slider** (range 2–32) — hidden when active type is `redacted`, `censored`, or `color`. Writes `global_default_settings.blur_radius`. Slider value badge displays a tier label (`htb_strength_subtle` ≤ 4, `htb_strength_moderate` ≤ 9, else `htb_strength_strong`) — never the raw pixel number.
5. **Redaction color picker** — Blur All + `redacted` only. Writes `global_default_settings.redaction_color`.
6. **Categories grid** — Blur All only. 2-column checkbox grid for `text` / `media` / `table` / `structure` / `form`. Each `<label>` carries `data-tooltip-label` (translated category name) and `data-tooltip-caption` (translated description). The popup-level tooltip handler (see `popup_popup.md` → Media tooltip) renders these in text-only mode. Media row hides when active type is `censored` (no images to censor). At least one category must remain selected — the change handler re-checks the just-unchecked box if all five would be off. Writes `blur_all.settings.blur_categories`.
7. **Thorough blur toggle** — Blur All only. Writes `global_default_settings.thorough_blur`.
8. **Color picker** (hex + opacity slider) — Pick & Blur + `color` only. Writes `pick_and_blur.settings.blur_color = { hex, opacity }`. Opacity slider reads `colorInput.value` live to avoid stale closures clobbering simultaneous edits.

## Visibility Recalculation

`_updateVisibility(activeType, isBlurAll, refs)` toggles `.hidden` on the strength / categories / color / redaction-color section wrappers (and their leading dividers) when the type chip changes. Avoids a full DOM rebuild for the type-chip path. The categories grid additionally hides its `media` row when `activeType === 'censored'`.

## Tooltip Wiring

- Type chips → `data-tooltip-media` (image asset). Triggers media tooltip in `popup.js`.
- Category checkboxes → `data-tooltip-label` + `data-tooltip-caption`. Triggers text-only tooltip mode in `popup.js` (`bl-media-tooltip--text-only`).

i18n keys for tooltips:
- Type chips reuse mode-asset SVGs only — no caption keys.
- Categories: `tooltip_cat_text`, `tooltip_cat_media`, `tooltip_cat_form`, `tooltip_cat_table`, `tooltip_cat_structure`. Labels reuse the existing `cat_*` keys.

## Module State

None. Renderer is fully stateless across calls; visibility refs (`sectionRefs`) are scoped per `renderBody` invocation and discarded when `containerEl` is rebuilt.

## Edge Cases

- `settings.blur_all.settings.blur_categories` may be partial or missing — checkbox `checked` falls through `!!(_cats && _cats[def.key])`, defaulting unset categories to off.
- Categories change handler reads live DOM rather than the closure-captured `settings` snapshot, so rapid sequential clicks don't overwrite each other.
- Categories grid enforces "at least one on" by reverting the just-toggled checkbox to checked if the merged map has no truthy values; no save is dispatched in that case.
- `transition_duration` interpreted as smooth (`true`) when `> 0` and `false` when `0`; missing value defaults to smooth.
- Color picker's opacity field tolerates non-numeric `opacity` (defaults to `1.0`).

## Dependencies

- `BlurrySitePopupShared` for `t`, `makeToggle`, `updateFill`, `makeDivider`.
- `chrome.runtime.getURL` for mode-asset paths.
- `_locales/<lang>/messages.json` keys: `setting_blur_mode`, `setting_blur_radius`, `setting_reveal_mode`, `setting_thorough_blur`, `setting_thorough_hint`, `setting_transition`, `setting_transition_hint`, `setting_redaction_color`, `htb_chip_*`, `htb_label_color`, `htb_opacity`, `group_categories`, `cat_*`, `tooltip_cat_*`, `reveal_*`.
