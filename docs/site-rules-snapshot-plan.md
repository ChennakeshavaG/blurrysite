# Site Rules: Snapshot-Based Redesign — Coordination Plan

## Concept Change

**OLD:** Site rules = URL pattern + partial `settings: {}` override (always empty — dead code path).

**NEW:** Site rules = URL pattern + full snapshot of ALL settings at the time of saving.
When a user visits a matching site, the snapshot is applied in full, replacing global settings for that session.

---

## What Changes in the Mental Model

- Rules are no longer "overrides" — they are complete saved configurations.
- User workflow: configure everything in the main popup → navigate to the target site → save a snapshot as a site rule.
- On subsequent visits to a matching URL, the snapshot auto-applies during `applyState()`.
- Multiple rules can match (wildcard + exact); resolution order unchanged — exact wins over wildcard.

---

## Data Shape (no structural change — `settings` field gets populated)

```js
// site_rules[] entry — before (current):
{
  hostname_value: 'github.com',
  hostname_type:  'exact',
  blur_all:       null,
  items:          [...],
  settings:       {}              // always empty today
}

// site_rules[] entry — after (redesign):
{
  hostname_value: 'github.com',
  hostname_type:  'exact',
  blur_all:       null,
  items:          [...],
  settings: {                     // full snapshot at save time
    blur_radius:      8,
    blur_mode:        'frosted',
    reveal_mode:      'hover',
    thorough_blur:    false,
    blur_categories:  { text: true, media: true, form: false, table: true, structure: true },
    pick_blur_type:   'blur',
    pick_blur_color:  { hex: '#000000', opacity: 1.0 },
    pii_mode:         'blur',
  }
}
```

`blur_all` and `items` remain top-level — they are NOT part of the settings snapshot.

---

## Snapshot Key Set

The snapshot covers **only keys that are user-configurable at the global level**. Derived/computed keys are excluded. Exact key list:

```js
const SNAPSHOT_KEYS = [
  'blur_radius',
  'blur_mode',
  'reveal_mode',
  'thorough_blur',
  'blur_categories',           // object — deep copy
  'pick_blur_type',
  'pick_blur_color',           // object — deep copy
  'pii_mode',
];
```

Source of truth for defaults: `blsi.DEFAULT_MODEL` (as always — do not hardcode).

---

## Agent Boundary

### Agent 1 — Storage + BlurEngine (`storage-agent`)

**Files to touch:**
- `src/storage_model.js`
- `src/constants.js` (validate_model update)
- `tests/unit/storage_model.test.js`

**Deliverables:**

1. **`Model.capture_snapshot()`** — reads current global settings from cache, returns plain object with only `SNAPSHOT_KEYS`. Deep-copies objects (`blur_categories`, `pick_blur_color`).

2. **`Model.save_site_snapshot(hostname_value, hostname_type, snapshot)`** — finds or creates the matching rule entry, sets its `.settings` to the snapshot, writes via `set_site_entry()`.

3. **`Model.clear_site_snapshot(hostname_value, hostname_type)`** — resets `.settings` to `{}` for the matching rule.

4. **`Model.get_site_snapshot(hostname_value, hostname_type)`** — returns the `.settings` object for a rule, or `null` if rule doesn't exist or settings is empty.

5. **`validate_model()` update** — current validator may strip unknown keys from `settings: {}`. Ensure it passes through all `SNAPSHOT_KEYS` without stripping. Validate nested objects (`blur_categories`, `pick_blur_color`) per existing validation logic.

6. **`resolve()` correctness** — existing merge logic already handles non-empty `settings` via Object.assign. Verify and add test that a full snapshot correctly overrides all global keys for the resolved output.

7. **Unit tests** — cover: capture produces correct shape, save writes correctly, clear resets, resolve with snapshot overrides all SNAPSHOT_KEYS, validate_model passes through full snapshot.

**Public API added:**
```js
blsi.Model.capture_snapshot()                               → object
blsi.Model.save_site_snapshot(hostname_value, type, snap)   → Promise
blsi.Model.clear_site_snapshot(hostname_value, type)        → Promise
blsi.Model.get_site_snapshot(hostname_value, type)          → object | null
```

**DO NOT touch:** `blur_engine.js`, `content_script.js`, popup files, manifest.

---

### Agent 2 — Popup UI (`popup-agent`)

**Files to touch:**
- `popup/renders/site_rules.js` (full rewrite)
- `popup/renders/site_rules.css` (new or existing — check if CSS is inline or separate)
- `_locales/en/messages.json` (new i18n keys)

**DO NOT touch:** storage layer, content_script, blur_engine.

**Assume these Model methods exist** (being built by storage-agent in parallel):
- `blsi.Model.capture_snapshot()` — returns settings object
- `blsi.Model.save_site_snapshot(hostname_value, hostname_type, snapshot)` — saves
- `blsi.Model.clear_site_snapshot(hostname_value, hostname_type)` — clears snapshot
- `blsi.Model.get_site_snapshot(hostname_value, hostname_type)` — returns snapshot or null
- `blsi.Model.get_rules()` — existing — returns `site_rules[]` (now with populated `.settings`)
- `blsi.Model.save_rules(rules)` — existing — saves array

**UI requirements:**

1. **Subpage header** — "Site Rules" title with back chevron (← already handled by `popup_ui.js` navigation layer, do not replicate).

2. **Rule list** — each rule renders as a collapsible card:
   - Collapsed: pattern + type badge + right-side chevron (▶/▼)
   - Expanded: settings summary rows + action buttons (Recapture, Edit pattern, Delete)
   - Settings summary shows only keys that differ from defaults (or all if user prefers — show all for simplicity in v1)
   - If `settings` is empty `{}`: show "No snapshot — settings inherit from global" placeholder

3. **Add rule flow**:
   - Button: `+ Save current settings as site rule`
   - Opens inline form: URL pattern input + type radio (wildcard/exact/regex)
   - Snapshot is auto-captured at form open time (call `capture_snapshot()`)
   - Show snapshot preview in the form (read-only summary)
   - Recapture button re-calls `capture_snapshot()` and refreshes preview
   - Save: calls `save_site_snapshot()` then `save_rules()` (for the pattern+type entry)

4. **Edit flow**:
   - Opens same inline form pre-filled
   - Snapshot preview shows current saved snapshot
   - Recapture button replaces it with fresh capture
   - Save: updates pattern+type + calls `save_site_snapshot()` if recaptured

5. **Delete** — removes rule entirely (existing behavior).

6. **ASCII diagrams required** — produce box-drawing ASCII mockups for:
   - List view (empty state)
   - List view (1–3 rules, mix of collapsed/expanded)
   - Add rule form (with snapshot preview)
   - Edit form
   Use box-drawing chars (`┌─┐│└┘├┤┬┴┼`) not dashes. Popup width is ~340px internal.

**i18n keys to add** (add to `_locales/en/messages.json`):
- `rule_snapshot_empty` — "No snapshot saved"
- `rule_snapshot_recapture` — "Recapture"
- `rule_snapshot_label` — "Settings snapshot"
- `rule_add_for_site` — "Save current settings as site rule"
- `rule_snapshot_preview` — "Preview"
- `rule_settings_inherit` — "Inherits global settings"

**Public API exposed (unchanged):**
```js
BlurrySitePopupRenderSiteRules.renderBody(containerEl, settings, callbacks)
// callbacks.onSaveRules(rules) — unchanged
```

---

## Integration Points

| Concern | Owner | Consumed by |
|---|---|---|
| `capture_snapshot()` | storage-agent | popup-agent (called on form open + recapture) |
| `save_site_snapshot()` | storage-agent | popup-agent (called on Save) |
| `clear_site_snapshot()` | storage-agent | popup-agent (called on Delete if clearing snapshot only) |
| `get_rules()` | storage-agent (existing) | popup-agent (list render) |
| `save_rules()` | storage-agent (existing) | popup-agent (add/edit/delete pattern) |
| `resolve()` with full snapshot | storage-agent | content_script (existing — no change needed) |

---

## What content_script.js Does NOT Need to Change

`resolve()` already merges `site_rules[i].settings` via Object.assign in the correct order. Once storage-agent populates that field with the snapshot, the blur engine will apply it automatically — no changes needed in `content_script.js` or `blur_engine.js`.

---

## Constraints (both agents must respect)

- Vanilla JS, IIFEs only — no ES modules, no bundler.
- All source files must assign exactly one `window.BlurrySite*` global.
- No new `chrome.runtime.sendMessage` message types — storage writes go direct via `blsi.Model`.
- `DEFAULT_MODEL` in `constants.js` is the single source of truth for defaults.
- Doc update rule: update `CLAUDE.md` and `docs/module-contracts.md` for any new public API.
- Tests must pass: `npm run test:unit`.

---

## Validation Criteria (done when)

- [ ] `Model.capture_snapshot()` returns all SNAPSHOT_KEYS with correct types
- [ ] `validate_model()` passes a full snapshot without stripping keys
- [ ] `Model.resolve()` with a full snapshot overrides all SNAPSHOT_KEYS in resolved output
- [ ] Site rules list shows chevron-collapsible cards with settings summary
- [ ] Add rule form captures snapshot, shows preview, saves correctly
- [ ] Recapture replaces snapshot in form and in storage after Save
- [ ] Delete removes the rule entry entirely
- [ ] All unit tests green
- [ ] `CLAUDE.md` and `docs/module-contracts.md` updated with new Model methods
