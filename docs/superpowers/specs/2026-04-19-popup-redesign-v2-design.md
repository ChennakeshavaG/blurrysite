# Popup UI Redesign v2 — Design Spec
**Date:** 2026-04-19
**Status:** Approved — ready for implementation planning
**Supersedes:** `docs/superpowers/specs/2026-04-18-popup-redesign-design.md`

---

## 1. Overview

Full visual and structural redesign of the Blurry Site browser extension popup. Goals:

- Slate dark theme as base; clean light mode counterpart
- Amber = all interactive actions; Cyan/Sky = all navigation actions
- Blur All and Pick & Blur as swappable modes, not co-existing options
- All configuration behind summary + Modify sub-pages — main popup stays read-only
- Automate as a trigger layer using slider controls with constraint annotations
- PII detection fully independent with its own mode chips

---

## 2. Color System

### Tokens

| Token | Dark | Light |
|---|---|---|
| `--bl-base` | `#0a0b0f` | `#f8f9fc` |
| `--bl-surface` | `#13151f` | `#eef0f6` |
| `--bl-raised` | `#1e2130` | `#e4e8f2` |
| `--bl-amber` | `#fbbf24` | `#d97706` |
| `--bl-cyan` | `#22d3ee` | `#0284c7` |
| `--bl-danger` | `#f87171` | `#dc2626` |
| `--bl-text-primary` | `#e8eaf0` | `#0f1117` |
| `--bl-text-muted` | `#6b7280` | `#6b7280` |
| `--bl-text-dim` | `#3a3d50` | `#9098b0` |

### Semantic color rules (enforced everywhere)

| Element | Color |
|---|---|
| Toggles (on state) | `--bl-amber` |
| Chips / option selections (active) | `--bl-amber` |
| Sliders (fill + thumb) | `--bl-amber` |
| Mode block accent (Blur All) | `--bl-amber` |
| Brand wordmark | `--bl-amber` |
| Power button (on) | `--bl-amber` |
| **Modify → buttons** | `--bl-cyan` (pill style, not plain text) |
| **Nav row arrows →** | `--bl-cyan` |
| **Back button** | neutral muted |
| PII toggle (on state) | `--bl-amber` |
| PII chips (active) | `--bl-amber` |
| Mode block accent (Pick & Blur) | `--bl-cyan` |
| Clear All / danger actions | `--bl-danger` |

---

## 3. Header

**Layout:** `[ ● Blurry Site ]  [ host ]  [ ☀/🌙 ]  [ ⏻ ]`

| Element | Detail |
|---|---|
| Brand | Radial-gradient dot + "Blurry Site" wordmark · amber |
| Host | Current tab hostname · read-only · muted |
| Theme toggle | ☀/🌙 · switches dark/light mode · persisted to `blsi_popup_theme` |
| Power button | ⏻ · amber when on, muted when off · global on/off |

**Power off:** tears down all active blur on every tab. Stored rules, settings, blur items persist. Shows `bl-view-off` instead of main view when off.

---

## 4. Off State

Shown when `settings.ENABLED === false`. Replaces main view.

```
[ logo (dimmed) ]
Blurry Site is off
All blur is paused on every site
[ Turn On ] ← amber primary button
```

---

## 5. Swappable Modes

One mode is active at a time: **Blur All** or **Pick & Blur**.

- Active mode = large primary card (top), accented border + background tint
- Inactive mode = smaller dimmer block (bottom), opacity ~0.42
- **Clear All** bottom-right, disabled/dimmed when nothing to clear
- Switching modes is destructive — previous mode's stored blur items deleted. Confirmation required if items exist.

### 5.1 Blur All — active

- Amber dot (glowing) · title · count badge · toggle (amber)
- Meta line: `host · blur type · N categories`
- Body text: brief description of what's blurred

### 5.2 Blur All — waiting

- Muted dot · title only · 42% opacity

### 5.3 Pick & Blur — active

- Cyan dot (glowing) · title · mode badge (e.g. `◉ Element`)
- **Empty state:** icon + "No elements picked yet" + **Open Picker** button (cyan)
- **With items:** scrollable element list, each row: `[dot] [selector] [type] [✕]`
- Hint below: "Change mode from the toolbar on the page"
- Mode badge is live-reactive (updates when user switches mode in on-page toolbar)

### 5.4 Pick & Blur — waiting

- Muted dot · title only · 42% opacity

---

## 6. How to Blur

Summary on main popup. Full controls behind Modify sub-page.

### 6.1 Main popup

- Section title: "How to Blur"
- **Modify →** button (cyan pill) — top-right, opens sub-page
- Type chips (amber when active) — tapping a chip also opens sub-page
- Summary rows: Covers · Strength · Reveal (or Color if type = color)

**Chips per active mode:**
- Blur All: `[ Gaussian ] [ Frosted ] [ Redacted ] [ Masked ]`
- Pick & Blur: `[ Gaussian ] [ Frosted ] [ Color ]` + note: "Redacted & Masked available in Blur All mode."

### 6.2 Modify sub-page

| Control | Detail |
|---|---|
| Type chips | Selects active blur type, amber |
| Categories (Blur All only) | 2-col checkbox grid: Text · Media · Tables · Structure · Forms |
| Strength slider | 2–20px range · amber fill/thumb · labels: Subtle / Moderate / Strong · shows px value |
| Reveal mode | Segmented: Hover · Click · None · amber active state |
| Thorough blur | Toggle (amber) + hint |
| Color picker (Color type only) | 6 page-extracted swatches + hex input + eyedropper + opacity slider |

---

## 7. Auto-Detect PII

Independent of Blur All / Pick & Blur.

### 7.1 Main popup

- Section title: "Auto-Detect PII"
- Master toggle (amber) — on = EMAIL + NUMERIC both active; off = both off
- Mode chips (amber active): `[ Gaussian ] [ Frosted ] [ Redacted ] [ Asterisked ]`
- Hint: "Detects emails and numeric patterns"

### 7.2 PII modes

| Mode | Behaviour |
|---|---|
| Gaussian | Blur filter on `[data-bl-si-pii]` spans |
| Frosted | SVG displacement blur on PII spans |
| Redacted | Solid bg color over PII spans |
| Asterisked | Replace visible chars with `●●●` inline |

---

## 8. Automate

Trigger layer — fires whatever blur mode + settings are currently configured.

### 8.1 Main popup (summary only)

```
Automate                          [ Modify → ]  ← cyan pill
  Timer        Off
  Idle         5 min · On         ← amber when active
  Tab Switch   Off
```

### 8.2 Modify sub-page — slider controls

**Tab Switch:**
- Toggle (amber) only
- Hint: "Blurs instantly when you switch away · unblurs on return"

**Idle blur** (uses `chrome.idle.setDetectionInterval`):
- Enable toggle (amber)
- Slider: 15 s → 3000 s (50 min)
- Amber fill/thumb
- Range labels: `15 s min` (red) · 5 min · 25 min · `50 min max` (red)
- Limit annotations in `--bl-danger` to communicate Chrome API constraints
- Hard min 15 s, hard max 3000 s enforced in validation

**Timer** (uses `BlurTimer` / `setTimeout`):
- Enable toggle (amber)
- Slider: 30 s → 7200 s (2 hr)
- Amber fill/thumb
- Range labels: `30 s min` (red) · 5 min · 30 min · 1 hr · 2 hr
- Practical min 30 s enforced in validation; no hard max (`hr` unit supported)

**Footer note in sub-page:** "When triggered → applies current [mode] settings · [type] · [categories] · [strength]"

---

## 9. Navigation Rows

```
[ Shortcuts                                → ]   ← cyan arrow
[ Site Rules                               → ]   ← cyan arrow
```

### 9.1 Shortcuts sub-page

- Lists all actions with current key binding
- Edit binding inline (capture UI)
- Reserved chord warnings shown, save not blocked

### 9.2 Site Rules sub-page

- Lists URL pattern rules
- Each row: `[pattern] [mode badge] [⚙] [×]`
- Default: rule inherits global How to Blur settings
- Custom settings toggle per rule: unlocks per-rule override

---

## 10. Footer

```
[ v1.x.x ]  [ Feedback ]  [ Export ]  [ Logs ]  [ Language ]
```

- Version: read-only label, dim
- Feedback: opens bug report link
- Export: downloads settings as JSON
- Logs: opens debug log viewer (requires `blsi_debug`)
- Language: locale selector (placeholder for now)

---

## 11. Sub-pages — Shared Pattern

All sub-pages:
- `← Back` button (neutral muted) + sub-page title + host in header
- Content scrolls
- Header background = `--bl-surface`

| Sub-page | Triggered from |
|---|---|
| How to Blur — Modify | Modify → button or chip tap in How to Blur section |
| Automate — Modify | Modify → button in Automate section |
| Shortcuts | Nav row |
| Site Rules | Nav row |

---

## 12. On-Page Picker Toolbar

Activated by **Open Picker** in Pick & Blur block. Floats over the page.

```
[ ⠿ ]  [ ◉ Element ]  [ ⬜ On Page ]  [ 📌 On Screen ]  [ ✕ ]
        Description line (changes per mode)
```

- Drag handle on left, repositionable
- 3 mode chips: Element (cyan) · On Page (cyan) · On Screen (violet/purple)
- Close (✕) right
- Mode selection updates popup mode badge in real-time

---

## 13. Full Layout Order (top → bottom)

```
┌─────────────────────────────────┐
│ HEADER                          │
│  Brand · Host · Theme · Power   │
├─────────────────────────────────┤
│ SWAPPABLE MODES                 │
│  Active block                   │
│  Waiting block                  │
│  Clear All (bottom-right)       │
├─────────────────────────────────┤
│ HOW TO BLUR                     │
│  Chips (amber) · Summary ·      │
│  Modify → (cyan)                │
├─────────────────────────────────┤
│ AUTO-DETECT PII                 │
│  Toggle (amber) · Mode chips    │
├─────────────────────────────────┤
│ AUTOMATE                        │
│  Summary rows · Modify → (cyan) │
├─────────────────────────────────┤
│ NAV ROWS                        │
│  Shortcuts → (cyan)             │
│  Site Rules → (cyan)            │
├─────────────────────────────────┤
│ FOOTER                          │
│  Version · Feedback · Export ·  │
│  Logs · Language                │
└─────────────────────────────────┘
```

---

## 14. Open Items (deferred)

- Masked mode style options (fixed font vs pattern vs custom)
- Redacted color defaults / presets for Blur All
- Footer language selector locale list
- Logs sub-page format
- Export JSON schema
- Picker toolbar drag position persistence
- Color picker: page color extraction (6 swatches from computed bg-colors)
- Eyedropper button implementation
