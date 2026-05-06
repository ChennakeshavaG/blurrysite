# popup/renders/general.js — Contract

Global: `BlurrySitePopupRenderGeneral` (also `window.BlurrySitePopupRenderGeneral`).

Renders the General sub-page body. Stateless — receives settings + callbacks, produces DOM.

## Public API

### `renderBody(containerEl, settings, callbacks) → void`

Populates the General sub-page body with rows:
- **Language** (`global_default_settings.language`) — picker
- **Backup / restore** — Export + Import buttons
- **Debug** — toggle, sets `blsi.Logger.enable/disable`

`containerEl` is replaced via `replaceChildren()` on every call.

### Parameters

- `containerEl` — `.bl-subpage__body` element to populate.
- `settings` — full settings snapshot from `BlurrySitePopupState.get().settings`. Must include `global_default_settings.*`. May include resolve-only fields `_rule_match` + `_rule_overrides` for rule-managed detection.
- `callbacks` — either a bare `onSave` function (legacy compat) or an object:
  - `onSave(patch)` — model-shaped patch save
  - `debugEnabled` — boolean
  - `onToggleDebug(bool)` — debug toggle handler
  - `onExport()` — triggers JSON download
  - `onImport(text)` — JSON import handler (popup.js validates + saves)

## Edge cases

- `callbacks` accepts a bare function for legacy callers — only `onSave` is wired.
- Tab-privacy row is omitted entirely when rule-managed; user must edit the rule's snapshot in Site Rules to change it.
- Backup row reads no settings — only invokes callbacks.
