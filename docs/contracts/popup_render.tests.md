# popup_render Test Contract

## Overview

Tests for `popup/renders/main.js`, exposed as `global.BlurrySitePopupRender`. Covers four render functions used by the popup UI: `renderHtbSection`, `renderPiiSection`, `renderAutomateSection`, and `renderModesSection` (including `renderAll`). All tests run against the real file — no stub fallback is provided (stub throws). `chrome.i18n.getMessage` returns the key string verbatim so assertions use i18n key names, not translated strings.

## Setup & Teardown

- `beforeAll`: loads `popup/renders/main.js` via `require()` (once per suite).
- `beforeEach`: rebuilds DOM scaffold with `setupDom()` (creates `#bl-htb-chips`, `#bl-htb-summary`, `#bl-pii`, `#bl-pii-master`, `#bl-pii-chips`, `#bl-pii-color-row`, `#bl-automate-summary`, `#bl-mode-blur-all`, `#bl-mode-pick-blur`); mocks `chrome.i18n.getMessage` to return the raw key.
- `afterEach`: clears `document.body.innerHTML`.
- `makeSettings(overrides?)` — deep-merges overrides into a baseline settings object with known defaults; used across all test groups.

## Test Groups

### renderHtbSection

- `blur-all mode renders 4 type chips` — calling with `isBlurAll=true` populates `#bl-htb-chips` with exactly 4 `.bl-chip` elements.
- `active blur-all chip has bl-chip--active class` — the chip whose `dataset.type` matches the current `blur_mode` receives `bl-chip--active`; verified for `'frosted'`.
- `pick-blur mode renders 3 type chips (no redacted/censored)` — calling with `isBlurAll=false` renders 3 chips; `'redacted'` and `'censored'` are absent; `'color'` is present.
- `blur-all summary has Covers row listing enabled categories` — when `blur_categories` has `text` and `table` enabled, the `.bl-summary-row` with label `htb_label_covers` lists `cat_text` and `cat_table`, and omits `cat_media`.
- `summary Strength row uses Moderate label for radius 6` — `htb_label_strength` row value contains `htb_strength_moderate` when `blur_radius=6`.
- `summary Strength row uses Subtle label for radius 3` — strength row value contains `htb_strength_subtle` when `blur_radius=3`.
- `summary Strength row uses Strong label for radius 10` — strength row value contains `htb_strength_strong` when `blur_radius=10`.
- `pick-blur mode has no Covers row in summary` — when `isBlurAll=false`, no `htb_label_covers` label exists in the summary.
- `color mode shows Color row and no Strength/Reveal rows` — when `blur_type='color'`, summary includes `htb_label_color` and excludes `htb_label_strength` and `htb_label_reveal`.

### renderPiiSection

- `master toggle is checked when EMAIL is true` — `#bl-pii-master` checkbox is `checked` when `email=true`.
- `master toggle is unchecked when both are false` — `#bl-pii-master` is unchecked when both `email` and `numeric` are `false`.
- `renders 4 PII mode chips` — `#bl-pii-chips` contains exactly 4 `.bl-chip` elements.
- `active PII chip has bl-chip--active (amber, no sky class)` — active chip's `dataset.piiMode` matches `pii_mode`; chip does not carry `bl-chip--sky`; verified for `'redacted'`.

### renderAutomateSection

- `renders 3 summary rows` — `#bl-automate-summary` always renders 3 `.bl-summary-row` elements.
- `IDLE enabled with value=5 unit=min shows value and unit key` — idle row value text is `'5 automate_unit_min'` when idle is enabled.
- `TAB_SWITCH enabled shows On value` — tab_switch row value is `'automate_on'` when `tab_switch.enabled=true`.

### renderModesSection

#### mode classes

- `blur-all block has bl-mode-block--blur-all class` — `#bl-mode-blur-all` always receives `bl-mode-block--blur-all`.
- `pick-blur block has bl-mode-block--pick-blur class` — `#bl-mode-pick-blur` always receives `bl-mode-block--pick-blur`.

#### dot color

- `blur-all: dot has is-on when isPageBlurred=true` — `.bl-mode-block__dot` inside blur-all block has `is-on` class.
- `blur-all: dot lacks is-on when isPageBlurred=false` — dot has `is-off`, not `is-on`.
- `pick-blur: dot is-on when pick_blur_enabled=true (regardless of items)` — dot has `is-on` when `pick_and_blur.status=true`.
- `pick-blur: dot is-off when pick_blur_enabled=false` — dot has `is-off` and not `is-on`, even when items are present.

#### blur-all: toggle + read-only table

- `blur-all: contains bl-blur-all-toggle checkbox` — `#bl-blur-all-toggle` exists and is `type=checkbox`.
- `bl-blur-all-toggle is checked when isPageBlurred=true` — toggle reflects page blur state.
- `bl-blur-all-toggle is unchecked when isPageBlurred=false` — toggle reflects page blur state.
- `blur-all: header has title and toggle, no inline subtitle` — header has `.bl-mode-block__title` and `.bl-toggle`; `.bl-mode-block__subtitle` is absent.
- `blur-all: block has bl-mode-block--off when isPageBlurred=false` — off-state modifier class applied.
- `blur-all: block lacks bl-mode-block--off when isPageBlurred=true` — off-state modifier absent when on.
- `blur-all: shows mode_blur_all_off_hint and no summary table when off` — `.bl-pick-count` shows `'mode_blur_all_off_hint'`; zero `.bl-summary-row` elements.
- `blur-all: info table has Mode, Covers, Strength, Reveal summary rows` — when page is blurred, all four expected labels appear.
- `blur-all: no inline chips (read-only table only)` — no `[data-type]` elements in blur-all block.

#### pick-blur: toggle + read-only info

- `pick-blur: contains bl-pick-blur-toggle checkbox` — `#bl-pick-blur-toggle` exists and is `type=checkbox`.
- `bl-pick-blur-toggle is checked when pick_blur_enabled=true` — toggle reflects feature status.
- `bl-pick-blur-toggle is unchecked when pick_blur_enabled=false` — toggle reflects feature status.
- `pick-blur ON empty: shows mode_pick_blur_empty text` — `.bl-pick-count` text is `'mode_pick_blur_empty'` when enabled with no items.
- `pick-blur with items: shows item list and Mode/Strength summary rows` — `.bl-item-row` count matches items array; `htb_label_mode` and `htb_label_strength` rows present; `.bl-pick-count` absent.
- `pick-blur: shows 3 picker mode buttons [data-picker-mode]` — always 3 `[data-picker-mode]` buttons.
- `pick-blur enabled: picker mode buttons are not disabled` — all buttons enabled when feature is on.
- `pick-blur disabled: picker mode buttons are still enabled` — buttons remain enabled even when feature is off.
- `pick-blur disabled: no Modify button when off` — `[data-action="htb-modify"]` is absent when status is false.
- `pick-blur enabled: Modify button is not disabled` — Modify button exists and is enabled.
- `pick-blur: active picker mode chip has bl-chip--active class` — exactly one `[data-picker-mode]` button has `bl-chip--active`; its `dataset.pickerMode` matches current `picker_mode`; verified for `'sticky-screen'`.
- `pick-blur ON: shows open-picker button` — `[data-action="open-picker"]` present when enabled.
- `pick-blur OFF: no open-picker button` — `[data-action="open-picker"]` absent when disabled.
- `pick-blur OFF empty: shows mode_pick_off_hint text` — `.bl-pick-count` text is `'mode_pick_off_hint'` when off with no items.
- `pick-blur OFF with items: shows mode_pick_off_paused text` — `.bl-pick-count` text contains `'paused'` when off with items.
- `pick-blur: inline item list (.bl-item-row) shown in mode block when enabled with items` — one `.bl-item-row`; `.bl-item-selector` shows item name; `[data-item-id]` carries the selector string.
- `pick-blur: block has bl-mode-block--off when pick_blur_enabled=false` — off modifier applied.
- `pick-blur: block lacks bl-mode-block--off when pick_blur_enabled=true` — off modifier absent.

#### mode actions: Clear All + Modify

- `blur-all: has data-action="htb-modify" button with data-mode="blur-all"` — Modify button present when page is blurred; carries correct `data-mode`.
- `pick-blur: has data-action="htb-modify" button with data-mode="pick-blur"` — Modify button present; carries `data-mode="pick-blur"`.
- `blur-all: no Clear All button` — `[data-action="clear-all"]` absent from blur-all block.
- `pick-blur: Clear All disabled when no items` — Clear All exists but is `disabled=true`.
- `pick-blur: Clear All enabled when has items` — Clear All `disabled=false` when items present.
- `pick-blur Clear All has data-mode="pick-blur"` — Clear All button carries correct `data-mode`.
- `blur-all: no Modify button when off` — Modify button absent when page is not blurred.
- `blur-all: Modify button enabled when isPageBlurred` — Modify button not disabled.

#### renderAll

- `renderAll with no extra args does not throw` — calling `renderAll(settings)` with no items/blur args does not throw.
- `renderAll: both blocks render with correct mode classes` — both `bl-mode-block--blur-all` and `bl-mode-block--pick-blur` present after call.

#### blur item row hover highlight data attributes

- `dynamic item row has data-highlight-type="dynamic"` — `.bl-item-row` with `data-highlight-type` has value `'dynamic'` for dynamic items.
- `dynamic item row has data-highlight-selectors as JSON array` — `dataset.highlightSelectors` parses to the selectors array.
- `dynamic item with legacy selector string still populates selectors array` — legacy `selector` string field wrapped in array for `data-highlight-selectors`.
- `sticky item row has data-highlight-type="sticky" and data-highlight-id` — sticky row has `data-highlight-type="sticky"` and `dataset.highlightId` equal to the zone id.

### renderNotifArea per-trigger sub-cards

- `single trigger renders one sub-card` — idle active only → exactly 1 `.bl-notif-card` with `.bl-notif-card__actions`.
- `multiple triggers render separate sub-cards` — idle + tab_switch active → 2 `.bl-notif-card` elements.
- `suppressed trigger shows undo row, no action buttons` — idle suppressed for tab → card has `.bl-notif-card__suppress`, no `.bl-notif-card__actions`.
- `sharing-tab renders single card with suspend button` — `is_sharing_tab=true` → 1 card, 1 `.bl-notif-btn` button (no `--warn` variant — suspend is non-destructive, session-only).
- `skipped state renders info-only card with no actions` — `automate_blur_skipped=true, skip_reason='manual'` → card has `.bl-notif-card__info`, no actions.
- `site-rule pill renders before sub-cards` — `activeRule` + idle trigger → first child is `.bl-notif-pill`, second is `.bl-notif-card`.
- `all three triggers render three sub-cards` — screen_share + idle + tab_switch active → 3 `.bl-notif-card` elements.

## Edge Cases Covered

- Blur radius thresholds: three distinct label tiers (subtle ≤ ~4, moderate ~5-8, strong ≥ 9 approximate range tested at 3/6/10).
- Pick-blur with items while disabled shows paused state instead of empty hint.
- Legacy `selector` (string) field on items is normalized to a `selectors` array for highlight data attributes.
- `renderAll` is callable with missing optional arguments (items, isPageBlurred default to falsy).

## Coverage Gaps

- `renderHtbSection` with `blur_mode='redacted'` or `'censored'` not directly asserted for blur-all chip count (implied by 4-chip test).
- `renderPiiSection` color row behavior for `pii_redaction_color` not tested.
- `renderAutomateSection` screen_share row enabled state not tested.
- No test for automate_blur_active / trigger state reflected in the automate section.
- No test for the reveal mode summary row in renderHtbSection (only strength and covers tested explicitly).
- `renderAll` with actual items and `isPageBlurred=true` combination not tested together.
- Pick-blur items with `type='sticky'` not tested in `renderModesSection` item list rendering.
