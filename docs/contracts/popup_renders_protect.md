# protect.js Contract

## Overview

Stay Blurry section renderer for the popup. Renders three separate accent cards (`.bl-protect-card`) — Screen Share (cyan-blue `#06b6d4`), Sensitive Info (mid-cyan `#0891b2`), Hide Tab Title (cyan-green `#10b981`) — each with its own toggle row. PII card includes inline mode chips and optional color row. Pure renderer — no `blsi.Model` calls; all state changes via `onSave(patch)` callback.

## Module State (Private)

| Variable | Description |
|---|---|
| `_PII_KEY` | Map of PII mode → i18n key for chip labels |
| `_MODE_ASSET` | Map of PII mode → tooltip media URL (via `chrome.runtime.getURL`) |

## Public API

### renderSection(containerEl, settings, onSave, ctx)

**What**: Renders the Stay Blurry section into the provided container. Section header + description are appended directly to the container; three separate cards (`.bl-protect-card--screen-share`, `.bl-protect-card--pii`, `.bl-protect-card--tab-privacy`) follow, each with its own accent color. Clears previous content via `replaceChildren()`.

**Params**:
- `containerEl` (Element) — target container (`#bl-stay-blurry`)
- `settings` (Object) — full model-shaped settings from `State.get().settings`, may include `_rule_match` / `_rule_overrides`
- `onSave` (Function) — `function(patch)` callback; patch is model-shaped (`{ automate: {...} }`, `{ auto_detect_pii: {...} }`, or `{ global_default_settings: {...} }`)
- `ctx` (Object) — context with `resolved`, `ruleOverrides`, `ruleMatch`, `onOpenManagingRule`

**Returns**: `undefined`

**Side effects**: Mutates DOM (replaces container children). Wires event listeners on toggle inputs and PII chip buttons. Each card renders a feature-row (dot + label + toggle) followed by an inline `<p class="bl-protect-card__desc">` description so users see the explanation without hovering — replaces the previous hover-only tooltip pattern (better discoverability + accessibility + works without hover on touch devices).

**Card + row details**:

| Card | Row | Setting path | Save patch shape | Default | Description i18n key |
|---|---|---|---|---|---|
| `--screen-share` | Screen Share | `settings.automate.settings.screen_share.enabled` | `{ automate: { settings: { screen_share: { enabled } } } }` | ON | `protect_screen_share_desc` |
| `--pii` | Sensitive Info | `settings.auto_detect_pii.settings.email` (master = email && numeric) | `{ auto_detect_pii: { settings: { email, numeric } } }` | ON | `protect_sensitive_info_desc` |
| `--tab-privacy` | Hide Tab Title & Icon | `settings.global_default_settings.tab_privacy` | `{ global_default_settings: { tab_privacy } }` | OFF | `setting_tab_privacy_hint` |

**PII inline extras**:
- Mode chips (Blur/Frosted/Redacted/Starred): save `{ auto_detect_pii: { settings: { pii_mode } } }`
- Color row (visible when mode === 'redacted'): save `{ auto_detect_pii: { settings: { pii_redaction_color } } }`

**Rule-managed behavior**: When `BlurrySitePopupShared.isRuleManaged(settings)` returns true, all toggles disabled + managed badge shown. Individual PII fields also check `ctx.ruleOverrides` for per-field gating.

**Edge cases**:
- `containerEl` null → no-op
- Missing `settings.automate` / `settings.auto_detect_pii` → safe defaults via `|| { enabled: true }` / `|| {}` guards
- `ctx` null → no rule overrides applied, all toggles editable

## Invariants

- Never calls `blsi.Model` directly — pure renderer
- Uses `BlurrySitePopupShared.makeToggle()` for all toggle inputs
- PII chip `data-pii-mode` attribute drives mode selection (same pattern as previous `#bl-pii-chips`)
- Status dots use `.bl-mode-block__dot` / `.is-on` CSS classes (shared with mode blocks)
