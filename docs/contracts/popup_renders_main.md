# popup/renders/main.js Contract

## Overview

`popup/renders/main.js` is the main popup renderer exposed as `BlurrySitePopupRender`. It owns the central panel of the popup: the blur-all mode block, the pick-and-blur mode block (including the saved-items list), the PII section, and the automate section. It is a **pure render module** — it receives state as arguments and produces DOM; it never reads from `blsi.Model` or `BlurrySitePopupState` directly. All storage writes go through `onSave` callbacks passed by `popup.js`.

Depends on: `BlurrySitePopupShared.t` (i18n), `chrome.runtime.getURL` (asset URLs), `chrome.i18n.getMessage` (indirect via `_t`).

---

## Public API

### renderAll(settings, blurItems, isPageBlurred, onSave, activeRule, onOpenSiteRules, ctx)

**What:** Renders the complete main popup view into the fixed DOM skeleton in `popup.html`. Called after every state change. Idempotent — safe to call with identical args (re-renders in place).

**Params:**
- `settings` (object) — full resolved settings snapshot in `blsi.DEFAULT_MODEL` shape, plus runtime extras:
  - `settings.automate_blur_active`, `automate_blur_triggers`, `automate_blur_skipped`
  - `settings.automate_blur_skip_reason` — `'site_rule' | 'manual' | 'pick_blur' | null`
  - `settings.screen_share_state` — `{ active, sharing_tab_id, started_at, is_sharing_tab }`
  - `settings.screen_share_suppressed_for_host`, `screen_share_suppressed_for_tab` — booleans
  - `settings.idle_suppressed_for_tab`, `idle_suppressed_for_site` — booleans
  - `settings.tab_switch_suppressed_for_tab`, `tab_switch_suppressed_for_site` — booleans
- `blurItems` (Array) — array of pick-and-blur items for current hostname.
- `isPageBlurred` (boolean) — whether blur-all is on for current hostname.
- `onSave` (function) — `(patch) => void` — called when user changes a setting.
- `activeRule` (object|null) — site rule currently matching this URL (drives the top pill).
- `onOpenSiteRules` (function) — `() => void` — opens the site-rules sub-page when user clicks the rule pill's "View" button.
- `ctx` (object) — extra callbacks + resolved data:
  - `ctx.resolved`, `ctx.ruleOverrides`, `ctx.ruleMatch` — for "Managed by site rule" badges in PII section.
  - `ctx.onOpenManagingRule` — deep-link from PII badge to rule.
  - `ctx.onSuppressScreenShare(scope)` / `ctx.onUnsuppressScreenShare(scope)` — `scope ∈ 'tab' | 'site_session' | 'feature'`. Wired to the 3-action row / Undo button for screen-share.
  - `ctx.onSuppressIdle(scope)` / `ctx.onUnsuppressIdle(scope)` — same 3-action pattern for idle trigger.
  - `ctx.onSuppressTabSwitch(scope)` / `ctx.onUnsuppressTabSwitch(scope)` — same 3-action pattern for tab-switch trigger.

**Returns:** `void`

**Rule-managed branch:** When `BlurrySitePopupShared.isRuleManaged(settings)` is true (computed against `_rule_match` + `_rule_overrides` merged from `ctx`), `renderAll` short-circuits: stamps `body.bl-rule-managed`, renders the `makeBanner(...)` element into `#bl-notif-area`, clears `#bl-mode-blur-all`, `#bl-mode-pick-blur`, `#bl-pii-chips`, `#bl-pii-color-row`, `#bl-automate-summary`, and skips the regular section renders. CSS hides `#bl-pii` and `#bl-automate` while the body class is set. Banner CTA calls `ctx.onOpenManagingRule(...)` (or falls back to `onOpenSiteRules`) with `{ focusRule }` so the deep-link auto-expands the matching rule.

**Side effects:**
- Writes to DOM elements with fixed ids/classes defined in `popup.html`: `#bl-blur-all-toggle`, `#bl-pick-blur-toggle`, `#bl-htb-chips`, `#bl-htb-summary`, `#bl-pick-mode-chips`, `#bl-pick-items`, `#bl-pii-toggle`, `#bl-pii-section`, `#bl-automate-indicator`, `#bl-automate-indicator-screen-share`.
- Toggles `body.bl-rule-managed` class (CSS-driven section hide).
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
Renders the PII detection sub-section into `#bl-pii-section`. Master toggle reflects `email || numeric`. Mode chip for the active blur type carries `bl-chip--active` always; `bl-glow-active` is added **only when master toggle is on** — chips do not glow when the feature is disabled.

### renderNotifArea(activeRule, settings, onOpenSiteRules, ctx)
Renders into `#bl-notif-area`: site-rule pill on top (when `activeRule` truthy), then **per-trigger sub-cards** (one `bl-notif-card` per automate trigger). Each sub-card is self-contained: trigger label row + its own action buttons or suppression undo row.

**Rendering order:**
1. **Site-rule pill** — unchanged, `bl-notif-pill` class.
2. **Sharing-tab card** — when `ssIsSharingTab && ssShareLive`. This tab IS the one sharing its screen. Shows "Sharing this screen" trigger row with live elapsed timer + only "Disable feature" button. Early-returns — no other sub-cards rendered.
3. **Screen-share sub-card** — when `triggers.screen_share` is active or screen-share is suppressed (tab/host). If suppressed: shows undo row only, no actions. If active: trigger label + elapsed timer + 3-button action row.
4. **Idle sub-card** — three modes:
   - **Info (pre-trigger):** when `settings.automate.settings.idle.enabled` is true but idle has NOT triggered and is NOT suppressed. Shows `infoText` with configured duration (e.g. "Idle blur active — 5 min"). No action buttons, no timer.
   - **Triggered:** when `triggers.idle` is active. Shows trigger label + elapsed timer + 3-button action row (Skip tab / Skip site / Turn off).
   - **Suppressed:** when idle is suppressed (tab/site). Shows suppression undo row only.
5. **Tab-switch sub-card** — when `triggers.tab_switch` is active or tab-switch is suppressed (tab/site). Same pattern.
6. **Skipped info card** — when `automate_blur_skipped && !automate_blur_active`. Info-only card with trigger-neutral prefix (`notif_automate_skipped`) + skip reason suffix. No actions.

No sub-cards rendered when none of `automate_blur_active`, `automate_blur_skipped`, `ssIsSharingTab`, any active suppression, or `idleEnabled` are true.

**Live elapsed timers**: `_shareTimer` and `_idleTimer` (module-level `setInterval` handles) tick every 1s, updating the elapsed-time span. Both cleared at the top of every `renderNotifArea` call via `clearInterval`. `_idleStartedAt` tracks when the popup first observes `triggers.idle === true` (reset to `null` when idle clears).

**Button tooltips**: Each action button carries a `title` attribute with a descriptive tooltip (e.g. "Skip automate blur for this tab. Resets on browser restart."). Tooltips convey session-scope and permanence info that the short button labels cannot.

### _buildTriggerSubCard(cfg)
Private helper. Builds a single `bl-notif-card` element from a config object:
- `cfg.suppression` — `{ label, onUndo }` → renders suppression undo row (no trigger label shown).
- `cfg.triggerLabel` — string → dot + name row (only when no suppression).
- `cfg.elapsed` — string → passed to `_triggerRow` detail.
- `cfg.onTimerSetup(elapsedEl)` — callback to wire setInterval on the elapsed span.
- `cfg.infoText` — string → italic info text (skipped state).
- `cfg.actions` — `[{ label, onClick, variant?, tooltip? }]` → button row. `tooltip` sets `title` attribute on the button.

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
2. **Minimal internal state** — `_shareTimer`, `_idleTimer` (interval handles for live elapsed clocks) and `_idleStartedAt` (timestamp). Timers cleared on every re-render.
3. **i18n only** — no hardcoded user-visible strings. All text via `_t(key)` (which wraps `chrome.i18n.getMessage`).
4. **Type badge for sticky items** uses `item.anchor` to distinguish "Area on page" vs "Area on screen". Missing `anchor` defaults to `'page'` behaviour.
