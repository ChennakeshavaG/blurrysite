# triggers.js Contract

## Overview

Smart Triggers section renderer for the popup. Renders two separate neutral cards: Tab Switch (`.bl-trigger-card--tab-switch`) and Idle Timer (`.bl-trigger-card--idle`) with slider. No accent tinting — uses `--bl-raised` bg. Pure renderer — no `blsi.Model` calls; all state changes via `onSave(patch)` callback. Migrated from `renders/automate.js` (deleted).

## Module State (Private)

No persistent state. Time conversion helpers are pure functions.

## Public API

### renderSection(containerEl, settings, onSave, ctx)

**What**: Renders the Smart Triggers section into the provided container. Section header + description appended directly to container; then two separate `.bl-trigger-card` cards (Tab Switch and Idle Timer), each with its own accent color via `--bl-trigger-accent`. Clears previous content via `replaceChildren()`.

**Params**:
- `containerEl` (Element) — target container (`#bl-smart-triggers`)
- `settings` (Object) — full model-shaped settings from `State.get().settings`, may include `_rule_match` / `_rule_overrides`
- `onSave` (Function) — `function(patch)` callback; patch shape: `{ automate: { settings: { tab_switch|idle: {...} } } }`
- `ctx` (Object) — context with `resolved`, `ruleOverrides`, `ruleMatch`, `onOpenManagingRule`

**Returns**: `undefined`

**Side effects**: Mutates DOM (replaces container children). Wires event listeners on toggle inputs and idle slider. Row labels carry `data-tooltip-caption` for the popup's media-tooltip system (text-only mode).

**Row details**:

| Row | Setting path | Save patch shape | Default | Tooltip key |
|---|---|---|---|---|
| Tab Switch | `settings.automate.settings.tab_switch.enabled` | `{ automate: { settings: { tab_switch: { enabled } } } }` | OFF | `trigger_tab_switch_desc` |
| Idle Timer | `settings.automate.settings.idle` | `{ automate: { settings: { idle: { value, unit, enabled } } } }` | OFF, 5 min | `trigger_idle_timer_desc` |

**Idle slider**: Hidden when toggle OFF, shown when ON. Range 15–3600 seconds. Disabled when rule-managed. Value converted via `_secsToValueUnit()` on save (no `'hr'` unit — `hasHr=false`).

**Rule-managed behavior**: Checks `_isOverridden(ctx, key)` per trigger. When overridden: toggle disabled, slider disabled, managed badge shown.

**Edge cases**:
- `containerEl` null → no-op
- Missing `settings.automate` → safe defaults via `|| {}` guards
- `ctx` null → no rule overrides, all controls editable
- Idle value clamped to slider range (15–3600s) on render

## Private Helpers (migrated from automate.js)

| Function | Purpose |
|---|---|
| `_toSecs(value, unit)` | Convert value+unit to seconds |
| `_secsToLabel(secs)` | Human-readable label (e.g. "5 min") |
| `_secsToValueUnit(secs, hasHr)` | Inverse — seconds to `{ value, unit }` |
| `_makeSliderSection(...)` | Builds slider DOM with value label + range labels |
| `_isOverridden(ctx, key)` | Check if trigger is rule-overridden |
| `_makeManagedBadge(onClick)` | "Managed by site rule" button |

## Invariants

- Never calls `blsi.Model` directly — pure renderer
- Uses `BlurrySitePopupShared.makeToggle()` for toggle inputs
- Uses `BlurrySitePopupShared.updateFill()` for slider progress
- Idle slider `change` event (not `input`) triggers save — avoids storage saturation during drag
- Slider `input` event updates visual label only
