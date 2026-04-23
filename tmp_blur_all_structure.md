# Blur All Component Structure

**Root element** — `#bl-mode-blur-all` in `popup.html:35`  
Rendered by `_renderBlurAllBlock()` in `renders/main.js:357`

---

## Collapsed state (`--collapsed`, `isExpanded === false`)

```
div#bl-mode-blur-all.bl-mode-block.bl-mode-block--blur-all.bl-mode-block--collapsed
  div.bl-mode-block__header
    span.bl-mode-block__dot              ← red (is-off) / green (is-on)
    span.bl-mode-block__title            ← "Blur All"
  p.bl-mode-compact                      ← "Gaussian | 3 cats | Hover"
    span                                 ← mode label
    span.bl-compact-sep                  ← 2px bar separator
    span                                 ← cat count
    span.bl-compact-sep
    span                                 ← reveal short label
```

Entire block is `cursor: pointer` — click expands it.

---

## Expanded state (`--expanded`, `isExpanded === true`)

```
div#bl-mode-blur-all.bl-mode-block.bl-mode-block--blur-all.bl-mode-block--expanded
  div.bl-mode-block__header
    span.bl-mode-block__dot              ← dot
    span.bl-mode-block__title            ← "Blur All" (accent color)
    label.bl-toggle.bl-mode-block__toggle
      input#bl-blur-all-toggle[type=checkbox]
      span.bl-toggle__track

  div.bl-mode-table                      ← read-only settings table
    div.bl-opt-row                       ← Mode row
      span.bl-opt-row__label             ← "MODE"
      div.bl-opt-row__opts
        span.bl-opt / .bl-opt--on        ← Gaussian | Frosted | Redacted | Masked
        span.bl-opt-sep (×3)
    div.bl-opt-row                       ← Covers row
      span.bl-opt-row__label             ← "COVERS"
      div.bl-opt-row__opts
        span.bl-opt / .bl-opt--on        ← Text | Media | Form | Table | Structure
        span.bl-opt-sep (×4)
    div.bl-opt-row                       ← Reveal row
      span.bl-opt-row__label             ← "REVEAL"
      div.bl-opt-row__opts
        span.bl-opt / .bl-opt--on        ← Click | Hover | Off
        span.bl-opt-sep (×2)

  div.bl-mode-actions                    ← border-top divider row
    button.bl-btn-text[data-action=htb-modify][data-mode=blur-all]
                                         ← "Modify →" (cyan pill, disabled if blur-all is off)
```

---

## State Analysis — Current vs Proposed

Legend: ●r = red dot  ●g = green dot  [○──] = toggle off  [──●] = toggle on
        * = active/selected item   (dim) = --bl-text-dim   (mut) = --bl-text-muted
        ┌─┐ = indigo-tinted block    ┌╌┐ = neutral/flat block    ╔═╗ = strong indigo block

---

### State 1 — Collapsed, Blur All OFF

**Current**
```
┌─────────────────────────────────────────────┐
│ ●r  Blur All                                │  ← indigo title, no expand hint
│ Gaussian | 3 cats | Hover          (dim)    │  ← settings showing, nothing blurring
└─────────────────────────────────────────────┘
```
Problems:
- Only off-signal is the 8px red dot — easy to miss
- Settings summary implies something is active — misleading
- No expand affordance — clickable but nothing hints at it
- Visually near-identical to State 2 (ON)

**Option A — status line replaces summary**
```
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│ ●r  Blur All                (mut)       [↓] │  ← muted title, chevron
│ Off · tap to start blurring  (red-tinted)   │  ← status message, not settings
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
  ↑ neutral bg, no indigo tint
```

**Option B — "Off" badge + keep summary**
```
┌─────────────────────────────────────────────┐
│ ●r  Blur All  [Off]                     [↓] │  ← red-tinted pill badge
│ Gaussian | 3 cats | Hover       (very dim)  │  ← settings, extra dim
└─────────────────────────────────────────────┘
```

**Option A+C — flatten + status line (chosen, no chevron)**
```
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│ ●r  Blur All                (mut)           │
│ Enable to start blurring     (red-tinted)   │
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```
Flat neutral block + status message replaces settings readout. No chevron.
ON state (State 2) keeps indigo tint — contrast makes active/inactive unmistakable.

---

### State 2 — Collapsed, Blur All ON

**Current**
```
┌─────────────────────────────────────────────┐
│ ●g  Blur All                                │  ← looks identical to State 1 OFF
│ Gaussian | 3 cats | Hover          (dim)    │  ← same dim color, same summary
└─────────────────────────────────────────────┘
```
Problems:
- Near-identical to State 1 — only the 8px dot color differs
- Summary is meaningful here but rendered in the dimmest color
- No "active" energy — most important state looks the flattest
- No expand affordance

**Proposed (same aesthetics as State 1, no chevron)**
```
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│ ●g  Blur All                (mut)           │
│ Blurring this page        (green-tinted)    │
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```
Same flat neutral block as State 1. Distinction: green dot + green-tinted status message.
Hover still reveals indigo accent (bg + border shift) — confirms interactivity on touch.

---

### State 3 — Expanded, Blur All OFF

**Current**
```
┌─────────────────────────────────────────────┐
│ ●r  Blur All                       [○────]  │  ← toggle unchecked
│                                             │
│ MODE                                        │
│ *Gaussian* · Frosted · Redacted · Masked    │  ← looks active! confusing
│ COVERS                                      │
│ *Text* · *Media* · Form · *Table* · *Strct* │
│ REVEAL                                      │
│ Click · *Hover* · Off                       │
├─────────────────────────────────────────────┤
│                          [Modify →]  (dim)  │  ← disabled, no explanation
└─────────────────────────────────────────────┘
```
Problems:
- Table looks identical to active — indigo-highlighted items imply blur is on
- Disabled "Modify →" with no explanation
- Nothing interactable — dead screen with no guidance
- Toggle in header is disconnected from what it controls

**Proposed**
```
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│ ●r  Blur All               (mut)   [○────]  │
│                                             │
│ MODE                           (opacity 45%)│
│ Gaussian · Frosted · Redacted · Masked      │  ← dimmed, no indigo highlights
│ COVERS                                      │
│ Text · Media · Form · Table · Structure     │
│ REVEAL                                      │
│ Click · Hover · Off                         │
│                                             │
│  Enable the toggle to start blurring  (mut) │  ← off-hint
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
│                              [Modify →]     │  ← ENABLED even when off
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```
Changes: flat neutral block, table dimmed (opacity 45%), off-hint text,
Modify → enabled (user should be able to configure before turning on).

---

### State 4 — Expanded, Blur All ON

**Current**
```
┌─────────────────────────────────────────────┐
│ ●g  Blur All                       [────●]  │  ← toggle checked (amber)
│                                             │
│ MODE                                        │
│ *Gaussian* · Frosted · Redacted · Masked    │
│ COVERS                                      │
│ *Text* · *Media* · Form · *Table* · *Strct* │
│ REVEAL                                      │
│ Click · *Hover* · Off                       │
├─────────────────────────────────────────────┤
│                              [Modify →]     │
└─────────────────────────────────────────────┘
```
Problems:
- Table opt-spans look interactive — same style as clickable chips elsewhere, confusing
- No "Clear" shortcut — user must leave this block to clear all blur
- Single action for the most active, most-used state

**Proposed**
```
╔═════════════════════════════════════════════╗
║ ●g  Blur All               (bold)  [────●]  ║
║                                             ║
║ MODE                         [view only 🔒] ║  ← read-only signal top-right
║ *Gaussian* · Frosted · Redacted · Masked    ║
║ COVERS                                      ║
║ *Text* · *Media* · Form · *Table* · *Strct* ║
║ REVEAL                                      ║
║ Click · *Hover* · Off                       ║
╠═════════════════════════════════════════════╣
║ [Clear]  (danger)            [Modify →]     ║  ← Clear surfaced directly
╚═════════════════════════════════════════════╝
```
Changes: "Clear" button surfaced left, lock/view-only label on table,
dot pulse animation, stronger border matches collapsed ON state energy.

---

## Key CSS

| Token | Value |
|---|---|
| Accent (blur-all) | `--bl-mode-accent: var(--bl-indigo)` |
| Expanded border | `color-mix(--bl-indigo 60%, transparent)` |
| Expanded bg | `color-mix(--bl-indigo 16%, --bl-surface)` |
| Collapsed border | `var(--bl-raised)` — flat neutral, no accent |
| Collapsed bg | `var(--bl-surface)` — flat neutral, no accent |
| Collapsed title | `var(--bl-text-muted)` — accent reserved for expanded |
| Collapsed hover | `color-mix(--bl-indigo 38%/11%, --bl-raised/--bl-surface)` |
| Dot on | `#22c55e` + green glow ring |
| Dot off | `#ef4444` |
| Active opt | `--bl-mode-accent`, weight 500 |
| Status text OFF | `.bl-compact-status-off` — `color-mix(--bl-danger 75%, --bl-text-muted)` |
| Status text ON | `.bl-compact-status-on` — `#22c55e` |

### Mode block state classes

| Class | Applied to | Meaning |
|---|---|---|
| `bl-mode-block--blur-all` | always | sets `--bl-mode-accent: var(--bl-indigo)` |
| `bl-mode-block--pick-blur` | always | sets `--bl-mode-accent: var(--bl-purple)` |
| `bl-mode-block--expanded` | per block | block is currently expanded |
| `bl-mode-block--collapsed` | per block | block is currently collapsed |

`--expanded` and `--collapsed` are **independent per block** — both blocks can be expanded
simultaneously, or both collapsed, or any combination. Clicking a block header toggles
only that block. Both start expanded by default.

---

## Source references

| What | File | Location |
|---|---|---|
| Root HTML | `popup/popup.html` | line 35 |
| Render function | `popup/renders/main.js` | `_renderBlurAllBlock()` line 357 |
| Collapsed summary | `popup/renders/main.js` | `_renderBlurAllCollapsedSummary()` line 310 |
| Expanded table | `popup/renders/main.js` | `_renderBlurAllExpandedTable()` line 333 |
| Mode block CSS | `popup/popup.css` | lines 210–389 |
| Accent token | `popup/popup.css` | line 220 |
