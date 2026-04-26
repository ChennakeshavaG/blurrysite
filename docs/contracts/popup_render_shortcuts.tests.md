# popup_render_shortcuts Test Contract

## Overview

Tests for `popup/renders/keyboard.js`, exposed as `global.BlurrySitePopupRenderShortcuts`. The module renders the keyboard shortcuts subpage of the popup and handles in-place chord capture. The single public entry point is `renderBody(container, settings, onSave)`. Tests depend on `blsi.Actions` and `blsi.ShortcutLabel` (loaded by `tests/setup.js`) and mock `chrome.i18n.getMessage` to return the raw key string. No stub fallback — file must exist.

## Setup & Teardown

- `beforeAll`: loads `popup/renders/keyboard.js` via `require()` (once per suite, guarded by `global.BlurrySitePopupRenderShortcuts`).
- `beforeEach`: sets `document.body.innerHTML = '<div id="container"></div>'`; mocks `chrome.i18n.getMessage` to return key.
- `afterEach`: clears `document.body.innerHTML`.
- `makeSettings(overrides?)` — merges overrides into `{ shortcuts: blsi.Actions.defaultBindings() }`.
- `fireKeyDown(opts)` — dispatches a `KeyboardEvent` on `document` with controllable code, key, mods, and `getModifierState` override.

## Test Groups

### renderBody — normal rows

- `renders one row per registered action` — `container.querySelectorAll('.bl-sc-row')` length equals `blsi.Actions.list().length`.
- `each row has a Change button` — count of `.bl-sc-change-btn` equals action count.
- `each row has a Reset button` — count of `.bl-sc-reset-btn` equals action count.
- `row displays binding label when a binding is set` — first row contains a `.bl-sc-row__binding` element (without `--none` modifier) with non-empty text when default binding is present.
- `row shows --none placeholder when binding array is empty` — when the first action's binding is `[]`, its row contains `.bl-sc-row__binding--none`.

### renderBody — capture mode

- `clicking Change replaces row content with capture UI` — after `.bl-sc-change-btn` click, container contains `.bl-sc-capture`.
- `save button starts disabled in capture mode` — `.bl-sc-save-btn` has `disabled=true` immediately after entering capture mode.
- `keydown with modifier enables save and updates preview` — firing `{code:'KeyB', mods:['Alt','Shift']}` enables save button and removes `bl-sc-capture__preview--empty` from the preview element.
- `keydown without modifier keeps save disabled` — firing `{code:'KeyB'}` with no mods leaves save button disabled.
- `Escape cancels capture and restores normal row` — `Escape` keydown removes `.bl-sc-capture` and restores `.bl-sc-change-btn`.
- `Cancel button restores normal row without calling onSave` — clicking `.bl-sc-cancel-btn` exits capture; `onSave` not called.
- `opening capture on a second row cancels the first` — clicking Change on row[1] while row[0] is in capture mode closes row[0]'s capture; only row[1] has `.bl-sc-capture`; total `.bl-sc-capture` count is 1.

### renderBody — save and reset

- `clicking Save calls onSave with binding patch for the action` — after entering capture, firing `{code:'KeyX', mods:['Alt']}`, then clicking Save: `onSave` called once; patch has `shortcuts[firstActionId].binding[0]` with `code='KeyX'` and mods containing `'Alt'`.
- `clicking Reset calls onSave with the action default binding` — clicking Reset on the first row calls `onSave` once; patch `shortcuts[firstAction.id].binding` equals the action's `defaultBinding` (code + mods as arrays).
- `after save, row returns to normal mode showing the new binding` — after saving a new chord, `.bl-sc-capture` is absent, `.bl-sc-change-btn` is restored, and `.bl-sc-row__binding--none` is absent (new binding visible).

## Edge Cases Covered

- Opening capture on a second row automatically closes the first (only one capture open at a time).
- Modifier-only key events (no printable key code) keep save disabled — requires at least one non-modifier code.
- Resetting an already-customized binding sends the original `defaultBinding` from `blsi.Actions`, not the customized value.
- Empty binding array (`[]`) renders the `--none` placeholder instead of a label.
- After save, the row re-renders inline without a full `renderBody` call (row rebuilds itself in place).

## Coverage Gaps

- No test for AltGr key (`ctrlKey+altKey` with `getModifierState('AltGraph')=true`) — AltGr should be ignored as a modifier.
- No test for modifier-only keystrokes (e.g. pressing only Shift) keeping save disabled.
- No test that the chord preview element shows the correct label text (only the `--empty` class removal is checked).
- No test for keyboard events with `isComposing=true` — should be ignored by capture handler.
- No test for the `repeat=true` case (held key) — should not update capture on repeat.
- No test for `renderBody` called with a settings object where `shortcuts` is missing or partially populated.
- No test for the Reset button inside capture mode (if one exists) vs the normal-row Reset button.
- `copyToClipboard` and screenshot-related paths not applicable here; shortcut label rendering for Mac (`IS_MAC`) platform not tested (tests run on host platform).
