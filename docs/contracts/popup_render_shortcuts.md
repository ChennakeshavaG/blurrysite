# popup/renders/keyboard.js — Contract

## Purpose

Renders the Keyboard Shortcuts sub-page body. Card-based layout: each action gets a card with icon, label, description, keycap binding badge, and inline capture mode for recording new chords.

Exposed as `window.BlurrySitePopupRenderShortcuts`.

## Dependencies

- `BlurrySitePopupShared` — `t()` helper
- `blsi.Actions` — action registry (list, defaultBindings)
- `blsi.ShortcutLabel` — chord labels, `chordKey()`, `isReserved()`, `lookup()`

## Public API

### `renderBody(containerEl, settings, onSave)`

Renders the full shortcuts sub-page into `containerEl`.

**Params:**
- `containerEl` — `HTMLElement` — the `.bl-subpage__body` div to populate
- `settings` — `object` — full settings object (read-only); must include `shortcuts` section
- `onSave` — `function(patch)` — called with model-shaped patch when user saves a shortcut change

**Returns:** `undefined`

**Side effects:**
- Replaces all children of `containerEl`
- Attaches click listeners to action cards (Change, Reset, Reset All buttons)
- Capture mode attaches a document-level keydown listener at capture phase; cleaned up on save/cancel/escape

**Edge cases:**
- Only one capture mode can be active at a time — opening a new one closes the previous
- Escape during capture cancels without saving
- Modifier-only keystrokes are ignored during capture
- Save is blocked (button disabled) when:
  - No chord recorded yet
  - Recorded chord conflicts with another action's binding
  - Recorded chord is already the current binding for this action
- Reserved browser chords show a warning but do NOT block save
- Reset All requires double-tap confirmation (first click arms, second executes; 3s timeout reverts)

## Internal helpers

| Function | Purpose |
|---|---|
| `_currentBinding(action, settings)` | Returns the current binding array for an action (user-saved or default) |
| `_buildKeycaps(binding)` | Renders a chord as keycap badge DOM elements |
| `_parseSvg(svgStr)` | Parses SVG markup string into a DOM element |
| `_buildNormalRow(rowEl, action, settings, onSave, activateCapture)` | Renders normal card state |
| `_buildCaptureRow(rowEl, action, settings, onSave, activateCapture, cancelCapture)` | Renders capture/recording state with conflict detection |

## Data tables

| Table | Purpose |
|---|---|
| `ACTION_I18N` | Maps action id → `{ label, hint }` i18n keys |
| `ACTION_ACCENT` | Maps action id → CSS color variable |
| `ACTION_ICONS` | Maps action id → SVG icon markup |
| `MODIFIER_CODES` | Set of KeyboardEvent.code values skipped during capture |
| `TRACKED_MODS` | Ordered modifier names checked on keydown |
