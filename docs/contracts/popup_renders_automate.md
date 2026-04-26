# popup/renders/automate Contract

## Overview

Renders the Automate sub-page: three blocks (Screen Share, Tab Switch, Idle)
with a toggle each, plus an idle-timeout slider. Pure render layer — owns no
state. All persistence flows through the `onSave` arg supplied by `popup.js`.

Window global: `BlurrySitePopupRenderAutomate`.

## Public API

### renderBody(containerEl, settings, onSave, ctx?)

**What**: Replaces `containerEl` contents with the three trigger blocks and
a footer hint.

**Params**:
- `containerEl` (HTMLElement) — `.bl-subpage__body` to populate
- `settings` (Object) — full popup settings snapshot (read-only). Reads
  `settings.automate.settings.{screen_share,tab_switch,idle}` for the
  fall-back / global value of each toggle.
- `onSave(patch)` — called when the user changes a control. `patch` is
  model-shaped (`{ automate: { settings: { <trigger>: { enabled } } } }`).
- `ctx` (Object, optional) — rule-aware UX context:
  - `resolved` — output of `blsi.Model.resolve(hostname, url)`. When present,
    each toggle reads its displayed value from
    `resolved.automate_{idle,tab_switch,screen_share}.enabled` so the popup
    reflects what's actually active on the current tab.
  - `ruleOverrides` — `{ [key]: true }` map. When
    `ruleOverrides.automate_{idle,tab_switch,screen_share}` is true the
    corresponding toggle becomes read-only and a "Managed by site rule"
    badge is rendered next to it.
  - `ruleMatch` — `{ hostname_value, hostname_type }` of the matching rule
    (used by `onOpenManagingRule` to deep-link to the rule).
  - `onOpenManagingRule()` — invoked when the badge is clicked. Caller
    typically opens the Site Rules page focused on `ctx.ruleMatch`.

**Returns**: `void`.

**Side effects**: replaces `containerEl` children. Subsequent toggle changes
fire `onSave`. When `ctx.ruleOverrides[key]` is true, the change handler is
not attached (control is read-only).

## Layout

Each block has:
- Header (icon + label + toggle)
- Description paragraph
- Optional "Managed by site rule" badge (only when overridden)
- Idle block additionally has a 15s–60min slider

The Idle slider reads `value` / `unit` from the global model — those fields
are not snapshot-overridable in v1, so they always reflect global state.

## Internal Helpers (private)

- `_buildScreenShareBlock(settings, onSave, ctx)`
- `_buildTabSwitchBlock(settings, onSave, ctx)`
- `_buildIdleBlock(settings, onSave, ctx)`
- `_makeManagedBadge(onClick)` — renders the click-to-open-rule badge
- `_isOverridden(ctx, key)` — boolean helper reading `ctx.ruleOverrides[key]`
- `_makeBlockHeader`, `_makeDesc`, `_makeSliderSection`, `_svgIcon`
- `_toSecs`, `_secsToLabel`, `_secsToValueUnit` — unit conversion

## Edge Cases

- `ctx` omitted (legacy callers) → behaves exactly as before, no badges,
  toggles read from `settings.automate.settings.*` directly.
- `ctx.resolved` missing but `ctx.ruleOverrides` present — fallback to
  reading from `settings.automate.settings.*`.
- Idle .value/.unit always come from the model. A site rule cannot override
  them in v1.
