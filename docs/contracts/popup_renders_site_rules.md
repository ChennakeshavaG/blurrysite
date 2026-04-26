# popup/renders/site_rules Contract

## Overview

Renders the Site Rules sub-page of the popup. Lists all configured URL rules
(wildcard / regex / exact) and lets the user add, edit, recapture, or delete
each rule. Pure render layer — owns no state. All persistence flows through
the `callbacks` arg supplied by `popup.js` (which delegates to
`BlurrySitePopupState` → `blsi.Model`).

Window global: `BlurrySitePopupRenderSiteRules`.

## Public API

### renderBody(containerEl, settings, callbacks)

**What**: Replaces `containerEl` contents with the Site Rules list + add button.
Fetches rules via `callbacks.getRules()` then renders each as a collapsible card.

**Params**:
- `containerEl` (HTMLElement) — the `.bl-subpage__body` element to populate
- `settings` (Object) — full popup settings snapshot (read-only). Used for
  resolving snapshot field labels and deep-link metadata.
- `callbacks` (Object) — required functions:
  - `onSaveSettings(patch)` — persist a settings patch (model-shaped)
  - `onSaveRules(newRules)` → `Promise<void>` — replace the whole rules array
  - `captureSnapshot()` → `Object` — current global model snapshot
  - `saveSiteSnapshot(hostname_value, hostname_type, snapshot)` → `Promise<void>`
  - `getRules()` → `Promise<Array>` — load current rules from storage

**Optional 4th arg** — `{ focusRule: { hostname_value, hostname_type } }` —
when provided, the matching rule card auto-expands after render. Used by the
"Managed by site rule" badge in the Automate / PII sub-pages to deep-link to
the rule that's overriding the field.

**Returns**: `Promise<void>`.

**Side effects**: replaces `containerEl` children; subsequent user edits
trigger `callbacks.onSaveRules` / `callbacks.saveSiteSnapshot`.

## Snapshot Display

The rule card shows the saved snapshot in three labeled sections:

| Section | Fields rendered |
|---|---|
| **Blur** | `blur_mode`, `blur_categories`, `pick_blur_enabled`, `pick_blur_type`, `pick_blur_items` (count) |
| **PII** | `pii_email`, `pii_numeric`, `pii_mode`, `pii_redaction_color` |
| **Automate** | `automate_idle` (enabled), `automate_idle_threshold` (value + unit), `automate_tab_switch`, `automate_screen_share` |

A section is omitted when none of its fields are present in the snapshot.
"No custom settings" copy renders only when ALL three sections are empty.

Editing individual rows is not supported — users change global settings and
click **Recapture** to refresh the rule's snapshot wholesale.

## Internal Helpers (private)

- `_makeCard(rule, rules, settings, callbacks, containerEl, autoExpand)` — collapsible
  card rendering one rule. Buttons: Recapture, Edit pattern, Delete.
  When the rule matches the active tab (`settings._rule_match.hostname_value` +
  `hostname_type` equal to this rule's), Recapture and Edit pattern are
  omitted — the rule's snapshot is the user's effective configuration on this
  tab, so a recapture would no-op and pattern editing from the managed host is
  confusing. Delete remains available so users can always escape the rule.
- `_makeForm(existingRule|null, ...)` — pattern + type radios + snapshot
  preview + Save/Cancel. Reused for both add and edit flows.
- `_makeSnapshotRows(snapshot)` — three-section group of read-only key/value
  rows; flattens the nested snapshot to display keys via `SNAPSHOT_LABELS`.
- `_formatSnapshotValue(key, value)` — maps booleans → "On"/"Off",
  enum values → i18n labels, blur_categories → comma-separated list.
- `_render(...)` — orchestrates list + add button vs inline form.

## Edge Cases

- Empty rules array → "no rules" message + Add button.
- Editing a rule with empty snapshot → preview falls back to the current
  global snapshot (so the user always has something to save).
- Duplicate rules (same hostname_value + hostname_type) — not prevented at
  render layer; relies on `save_rules` validation.
