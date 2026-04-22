# Popup CSS Reference

Living standard for all popup styles. Update this file whenever you add, rename, or remove a class.

---

## Naming System

**Prefix:** Every class starts with `bl-` (Blurry Site).

**Pattern:** BEM-lite — `bl-[block]`, `bl-[block]__[element]`, `bl-[block]--[modifier]`

**State classes** (no block prefix, toggled by JS):
- `.is-on` — active/lit state (dot indicator)
- `.is-off` — inactive state (power button)
- `.is-active` — selected state (segmented control option)
- `.is-visible` — shown state (toast, tooltip)

**Never invent:**
- New prefixes other than `bl-`
- Utility classes (no `.flex`, `.hidden`, `.mt-4`)
- Per-module divider/heading classes — use the shared ones

---

## File Ownership

| File | Owns |
|---|---|
| `theme.css` | CSS custom properties only — colors, no rules |
| `popup.css` | All shared components: header, sections, chips, buttons, toggles, nav, footer, mode blocks, tooltips, animations |
| `popup_htb.css` | How-to-Blur sub-page only: groups, slider, segmented control, categories grid, color picker |
| `popup_automate.css` | Automate sub-page only: auto-block, number input, unit select, start/stop button |
| `popup_shortcuts.css` | Shortcuts sub-page only: shortcut rows, capture UI |
| `popup_site_rules.css` | Site Rules sub-page only: rules list, rule form |

Sub-page CSS files **must not** redefine anything from `popup.css`. See reuse list at top of each file.

---

## Design Tokens (theme.css)

### Surfaces — dark mode, light to dark order
```
--bl-base       darkest background (body)
--bl-surface    section/card background
--bl-raised     elevated element background (chips, inputs, raised blocks)
--bl-divider    explicit divider line color
```

### Accent colors
| Token | Use |
|---|---|
| `--bl-amber` | Brand, primary CTA, section title accent bar, active chips, slider fill |
| `--bl-indigo` | Blur All mode accent (`--bl-mode-accent` on `.bl-mode-block--blur-all`) |
| `--bl-purple` | Pick & Blur mode accent (`--bl-mode-accent` on `.bl-mode-block--pick-blur`) |
| `--bl-sky` | Picker mode chips, Modify button |
| `--bl-cyan` | Nav row arrow, secondary interactive |
| `--bl-violet` | Item dot — sticky-screen zone |
| `--bl-danger` | Destructive actions, error text |

### Text hierarchy
```
--bl-text-primary   main readable text (5:1+ on --bl-surface)
--bl-text-muted     secondary/label text (4.5:1+ on --bl-surface)
--bl-text-dim       chrome-only — version numbers, type badges, remove buttons (2.9:1, not for content)
```

---

## Shared Components (popup.css)

### Layout

```
.bl-header              sticky top bar
.bl-main                scrollable content area
.bl-footer              sticky bottom bar
.bl-subpage             full-overlay sub-page (position: absolute inset: 0)
.bl-subpage__header     sub-page header bar
.bl-subpage__body       sub-page scroll content
```

### Sections

```
.bl-section             card container (border-radius, border, bg)
.bl-section__header     title row (flex, space-between)
.bl-section__title      uppercase label with amber left-bar accent + SVG icon
.bl-section__desc       subtitle below heading (11px, muted)
.bl-section__hint       footer note inside a section (12px, muted)
.bl-section__actions    bottom-right action row (flex, flex-end)
```

### Content Zones

```
.bl-zone--primary       interactive zone — amber border, surface bg (for chips/toggles)
.bl-zone--info          data zone — raised bg, no border (for summary rows)
```

### Chips

```
.bl-chips               flex wrap container for chips
.bl-chip                pill button (inactive: muted text, raised bg)
.bl-chip--active        selected chip (amber border + tint)
.bl-chip + .bl-glow-active   add shimmer animation to active chip
```

Picker-mode chips override with:
```
.bl-picker-mode-chips   full-width stretch layout, sky accent
```

### Summary Rows

```
.bl-summary             container (font-size: 12px)
.bl-summary-row         label/value pair (flex, space-between)
.bl-summary-row__label  option name (text-primary)
.bl-summary-row__value  current value (amber)
```
When a value is disabled/off, use the plain `.bl-summary-row__value` — the amber color is intentional even for "Off" state. Muted "off" text is not supported.

### Mode Blocks

```
.bl-mode-block                  base card
.bl-mode-block--blur-all        sets --bl-mode-accent: var(--bl-indigo)
.bl-mode-block--pick-blur       sets --bl-mode-accent: var(--bl-purple)
.bl-mode-block--active          vivid accent border + subtle tinted bg
.bl-mode-block--waiting         dull accent border, 50% opacity, cursor pointer
.bl-mode-block--neutral         centered placeholder card
.bl-mode-block__dot             8px circle indicator
.bl-mode-block__dot.is-on       lit with --bl-mode-accent + glow ring
```

### Buttons

| Class | Appearance | Use |
|---|---|---|
| `.bl-btn-primary` | Filled amber | Power-on CTA |
| `.bl-btn-text` | Sky tinted + border | Modify, sub-page navigation |
| `.bl-btn-ghost` | Outline, muted | Secondary actions |
| `.bl-btn-ghost.bl-btn-danger` | Danger-colored outline | Destructive (Clear All) |

### Divider

```
.bl-divider     <hr> — 1px raised border, 12px vertical margin
```

Use this everywhere. Do not create `.bl-htb-divider`, `.bl-auto-divider`, etc.

### Toggle Switch

```
.bl-toggle          label wrapper
.bl-toggle__track   the pill track (amber when checked)
```
Toggle color is always amber — no per-context overrides.

### Form Row (shared across sub-pages)

```
.bl-form-row            flex row (space-between, 6px padding)
.bl-form-row__label     12px, text-primary
```

---

## CSS Custom Properties Set by JS

| Property | Set on | Used in |
|---|---|---|
| `--bl-slider-pct` | `.bl-slider` element | `popup_htb.css` slider fill gradient |
| `--bl-mode-accent` | `.bl-mode-block--*` | mode block border, bg, dot color |
| `--bl-glow-color` | `.bl-glow-active` elements | glow animation color |

---

## Dead Class Checklist

Classes removed in the cleanup — do not re-add:

- ~~`.bl-summary-row__value--off`~~ — muted "off" values not part of the design
- ~~`.bl-mode-badge`~~ — no usage, removed
- ~~`.bl-pick-footer`~~ and subclasses — no usage, removed
- ~~`.bl-htb-divider`~~ — merged into `.bl-divider`
- ~~`.bl-auto-divider`~~ — merged into `.bl-divider`
- ~~`--pct`~~ — renamed to `--bl-slider-pct`
