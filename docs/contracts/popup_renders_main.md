# popup/renders/main.js Contract

## Overview

`popup/renders/main.js` is the main popup renderer exposed as `BlurrySitePopupRender`. It owns the central panel of the popup: the blur-all mode block, the pick-and-blur mode block (including the saved-items list), the PII section, and the automate section. It is a **pure render module** — it receives state as arguments and produces DOM; it never reads from `blsi.Model` or `BlurrySitePopupState` directly. All storage writes go through `onSave` callbacks passed by `popup.js`.

Depends on: `BlurrySitePopupShared.t` (i18n), `chrome.runtime.getURL` (asset URLs), `chrome.i18n.getMessage` (indirect via `_t`).

---

## Public API

### renderAll(settings, blurItems, isPageBlurred, onSave, onClearAutomate, onClearScreenShareBlur)

**What:** Renders the complete main popup view into the fixed DOM skeleton in `popup.html`. Called after every state change. Idempotent — safe to call with identical args (re-renders in place).

**Params:**
- `settings` (object) — full resolved settings snapshot in `blsi.DEFAULT_MODEL` shape. Key paths used:
  - `settings.global_default_settings.enabled` — extension on/off
  - `settings.blur_all.settings.blur_mode` — active blur-all mode
  - `settings.blur_all.settings.blur_categories` — `{ text, media, form, table, structure }` booleans
  - `settings.pick_and_blur.settings.picker_mode` — `'dynamic'|'sticky-page'|'sticky-screen'`
  - `settings.pick_and_blur.settings.blur_type` — `'blur'|'frosted'|'color'`
  - `settings.pick_and_blur.settings.blur_color` — `{ hex, opacity }`
  - `settings.auto_detect_pii.status` — master PII toggle
  - `settings.auto_detect_pii.settings.email`, `.numeric`, `.pii_mode`, `.pii_redaction_color`
  - `settings.automate.settings.idle`, `.tab_switch`, `.screen_share`
  - `settings.automate_blur_active` — runtime: any automate trigger active
  - `settings.automate_blur_triggers` — runtime: `{ idle, tab_switch, screen_share }` booleans
  - `settings.automate_blur_skipped` — runtime: automate fired but deferred
- `blurItems` (Array) — array of pick-and-blur items for current hostname. Each item: `{ type: 'dynamic'|'sticky', name, selectors?, selector?, id?, anchor? }`.
- `isPageBlurred` (boolean) — whether blur-all is on for current hostname.
- `onSave` (function) — `(patch) => void` — called when user changes a setting. `patch` is a model-shaped object (top-level keys matching `blsi.DEFAULT_MODEL` sections).
- `onClearAutomate` (function) — `() => void` — called when user clicks "Clear" on the automate active indicator.
- `onClearScreenShareBlur` (function) — `() => void` — called when user clicks "Clear" on the screen-share stop indicator.

**Returns:** `void`

**Side effects:**
- Writes to DOM elements with fixed ids/classes defined in `popup.html`: `#bl-blur-all-toggle`, `#bl-pick-blur-toggle`, `#bl-htb-chips`, `#bl-htb-summary`, `#bl-pick-mode-chips`, `#bl-pick-items`, `#bl-pii-toggle`, `#bl-pii-section`, `#bl-automate-indicator`, `#bl-automate-indicator-screen-share`.
- Attaches event listeners to the rendered controls (chip buttons, toggle switches, remove buttons).
- Previous event listeners are replaced on each render via `replaceChildren()`.

**Handles:**
- Empty `blurItems` array: renders empty state with a hint message.
- `blurItems` with `type: 'sticky'` and `anchor: 'screen'`: type badge shows "Area on screen"; `anchor: 'page'` or missing anchor: type badge shows "Area on page".
- `blurItems` with `type: 'dynamic'`: type badge shows "Element".
- `settings.global_default_settings.enabled === false`: mode blocks rendered in disabled state.

---

## Internal Functions (not exported)

### _summaryRow(label, value)
Builds a `<div class="bl-summary-row">` with a label span and value span. `value` may be a string or a DOM Node.

### renderHtbSection(settings, isBlurAll)
Renders the "How to Blur" chip row and summary for either blur-all or pick-and-blur mode. Populates `#bl-htb-chips` and `#bl-htb-summary`.

### _renderPickItemList(blurItems)
Renders the list of saved pick-and-blur items into `#bl-pick-items`. Each row: colored dot (cyan for sticky, amber for dynamic) + item name + type badge + remove button.

### renderPiiSection(settings, onSave)
Renders the PII detection sub-section into `#bl-pii-section` when master toggle is on.

### renderAutomateIndicator(settings, onClearAutomate, onClearScreenShareBlur)
Renders the active automate indicator banners (`#bl-automate-indicator`, `#bl-automate-indicator-screen-share`) when triggers are active.

---

## Constants (module-private)

| Constant | Type | Purpose |
|---|---|---|
| `_TYPE_KEY` | `object` | Maps blur type strings to i18n keys for mode chips |
| `_PII_KEY` | `object` | Maps PII mode strings to i18n keys |
| `_CAT_KEY` | `object` | Maps blur category names to i18n keys |
| `_PICKER_MODE_KEY` | `object` | Maps picker mode strings to i18n keys for mode badge buttons |
| `_PICKER_MODE_ASSET` | `object` | Maps picker mode strings to tooltip SVG asset URLs |
| `_PICKER_MODE_DESC` | `object` | Maps picker mode strings to tooltip description i18n keys |
| `_MODE_ASSET` | `object` | Maps blur type strings to mode icon SVG asset URLs |

---

## Invariants

1. **Pure render** — never calls `blsi.Model.*` or `BlurrySitePopupState.*` directly. All data arrives via args; all mutations via callbacks.
2. **No internal state** — module has no mutable state. Two calls with the same args produce identical DOM output.
3. **i18n only** — no hardcoded user-visible strings. All text via `_t(key)` (which wraps `chrome.i18n.getMessage`).
4. **Type badge for sticky items** uses `item.anchor` to distinguish "Area on page" vs "Area on screen". Missing `anchor` defaults to `'page'` behaviour.
