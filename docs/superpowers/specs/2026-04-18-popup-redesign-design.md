# Popup UI Redesign — Design Spec
**Date:** 2026-04-18  
**Status:** Approved — ready for implementation planning

---

## 1. Overview

Full visual and structural redesign of the Blurry Site browser extension popup. Goals:

- Establish clear parent-child hierarchy (blur type owns its children — categories, strength, color)
- Blur All and Pick & Blur as swappable modes, not co-existing options
- Pick & Blur is a completely separate feature from Blur All — different type options, no categories
- All configuration behind summary + Modify sub-pages — main popup stays clean and read-only
- Automate decoupled as a trigger layer that fires whatever mode/settings are currently active
- PII detection is fully independent with its own blur mode

---

## 2. Color Scheme — Slate

### Dark mode
| Token | Value | Usage |
|---|---|---|
| Base | `#0a0b0f` | Page/popup background |
| Surface | `#13151f` | Cards, sections |
| Raised | `#1e2130` | Inputs, chips, inner surfaces |
| Amber | `#fbbf24` | Blur All accent, brand, power on |
| Sky | `#38bdf8` | Pick & Blur accent |
| Violet | `#818cf8` | On Screen zone accent |
| Danger | `#f87171` | Clear All, remove actions |
| Text primary | `#e8eaf0` | |
| Text muted | `#6b7280` | |
| Text dim | `#3a3d50` | Labels, subtitles |

### Light mode (cool-shifted, Slate-aligned)
| Token | Value |
|---|---|
| Base | `#f8f9fc` |
| Surface | `#eef0f6` |
| Raised | `#e4e8f2` |
| Amber | `#d97706` |
| Sky | `#0284c7` |
| Violet | `#6d28d9` |
| Danger | `#dc2626` |
| Text primary | `#0f1117` |
| Text muted | `#6b7280` |
| Text dim | `#9098b0` |

---

## 3. Header

**Layout:** `[ ● Blurry Site ]  [ host ]  [ ☀/🌙 ]  [ ⏻ ]`

| Element | Detail |
|---|---|
| Brand | Logo dot + "Blurry Site" wordmark · amber |
| Host | Current tab hostname · read-only · muted |
| Theme toggle | ☀ / 🌙 icon button · switches dark/light |
| Power button | ⏻ circular icon button · **global on/off** |

**Power button behaviour:** Turning off tears down all active blur across every open tab. Stored rules, settings, and blur items persist in `chrome.storage` — powering back on re-applies everything. This is not a per-site toggle.

---

## 4. Main Section — Swappable Modes

### 4.1 Behaviour
- Exactly one mode is active at a time: **Blur All** or **Pick & Blur**
- Switching modes is **destructive** — previous mode's stored blur items are permanently deleted from `chrome.storage` (not just live state reset). User sees a confirmation if items exist before switching.
- Active mode = large primary card (top)
- Inactive mode = smaller dimmer waiting block (below active)
- **Clear All** always bottom-right; dimmed when nothing to clear
- After Clear All: neutral empty state at top, both modes shown as equal waiting blocks

### 4.2 Blur All — active state
- Amber accent (`#fbbf24` dark / `#d97706` light)
- Header: live dot · "Blur All" title · site + blur type subtitle · count badge · toggle
- Body: short description of what's blurred ("Every Text, Media, Table and Structure element is blurred")
- Toggle on/off without switching mode

### 4.3 Blur All — off state
- Block dims, dot goes grey, shows "Off — page is visible"
- Pick & Blur waiting block remains below

### 4.4 Pick & Blur — active state
- Sky accent (`#38bdf8` dark / `#0284c7` light)
- Header: live dot · "Pick & Blur" title · site + item count subtitle · **mode badge** (read-only, shows last-used picker mode)
- Body: scrollable element list (max-height with fade gradient)
- Element list row: `[color dot] [selector] [type label] [✕ remove]`
  - Type label color dots: **amber** = element · **cyan** = on page · **purple** = on screen
- Footer of block: "Add more from page" hint + **Open Picker** button
- Hint below list: "Change mode from the toolbar on the page"
- Mode badge is **live-reactive** — updates in real-time as user switches mode in the on-page toolbar (not a static "last-used" snapshot)

### 4.5 Pick & Blur — empty state
- Picker icon + "No elements picked yet. Open the picker to start."
- **Open Picker** CTA button centred

### 4.6 After Clear All
- Neutral empty block: "Nothing blurred on this page"
- Both Blur All and Pick & Blur shown as equal waiting blocks

---

## 5. How to Blur

Summary-only in main popup. Full controls behind **Modify** sub-page button.

### 5.1 Main popup display
- Section title: "How to Blur"
- Type chips row — shows selected type highlighted. **Tapping any chip opens the Modify sub-page** (chips are not interactive toggles in the summary; they are navigation shortcuts)
- Summary block: key/value rows (Covers · Strength · Reveal or Color depending on type)
- **Modify →** button bottom-right (equivalent to tapping a chip)

### 5.2 Dynamic: what changes per active mode

**When Blur All is active**, all 4 types available:
`[ Gaussian ]  [ Frosted ]  [ Redacted ]  [ Masked ]`

**When Pick & Blur is active**, only 3 types:
`[ Gaussian ]  [ Frosted ]  [ Color ]`
Redacted and Masked are **hidden** (not disabled or greyed out). A note below the chips reads: *"Redacted & Masked available in Blur All mode."*

**Masked chip interim behaviour:** Until Mask style options are finalised, Masked renders as a chip in Blur All mode but shows a tooltip "Style options coming soon" on tap — it applies a fixed default obscuring font. The chip is not hidden.

### 5.3 Controls per type — Blur All

| Type | Controls shown |
|---|---|
| **Gaussian** | Categories · Strength slider · Reveal mode |
| **Frosted** | Categories · Strength slider · Reveal mode |
| **Redacted** | Categories · Color picker (bg color per element) · Reveal mode |
| **Masked** | Categories (TEXT + FORM only) · Mask style · Reveal = always hover (fixed) |

**Categories** (checkboxes): TEXT · MEDIA · FORM · TABLE · STRUCTURE

**Strength slider**: continuous, labelled Subtle → Moderate → Strong, shows px value

**Reveal mode**: segmented — Hover · Click · None

**Color picker** (Redacted): 6 swatches + hex input + eyedropper + opacity slider

**Mask style** (Masked): fixed obscuring font — TBD in next phase

### 5.4 Controls per type — Pick & Blur

| Type | Controls shown |
|---|---|
| **Gaussian** | Strength slider · Reveal mode |
| **Frosted** | Strength slider · Reveal mode |
| **Color** | Color picker · Opacity slider |

No Categories in Pick & Blur — user is selecting specific elements/zones, not category-wide.

**Color mode (Pick & Blur):**
- 6 quick swatches: Black · White · Red · Amber · Indigo · Green
- Hex input field
- Eyedropper button (samples page color — enables invisible cover by matching page bg)
- Opacity slider
- No Reveal mode — opacity serves as the "peek-through" mechanism

---

## 6. On-Page Picker Toolbar

Activated by **Open Picker** button in Pick & Blur block. Floats over the page.

### 6.1 Toolbar anatomy
```
[ ⠿ ]  [ ◉ Element ]  [ ⬜ On Page ]  [ 📌 On Screen ]  [ ✕ ]
        Click an element to blur it
```
- Drag handle (⠿) on left — toolbar is repositionable
- 3 mode chips (segmented, mutual exclusion)
- Description line below chips — changes per active mode
- Close (✕) button on right

### 6.2 Mode chips

| Mode | Icon | Description | Accent |
|---|---|---|---|
| Element | ◉ | "Click an element to blur it" | Sky/cyan |
| On Page | ⬜ | "Drag to draw a blur region · scrolls with the page ↕" | Cyan |
| On Screen | 📌 | "Drag to fix a region to your screen · great for streaming" | Violet |

### 6.3 Visual feedback per mode

**Element mode:**
- Hover over element → **sky/cyan ring** + "Click to blur" tooltip (sky accent, consistent with Pick & Blur color — no amber here)
- Cursor: ⊙ crosshair-pointer

**On Page zone:**
- Drag → teal dashed rectangle preview
- Zone label on preview: "⬜ Zone · scrolls with page ↕"
- Fill color reflects configured blur type (translucent teal for Gaussian, solid for Color)

**On Screen zone:**
- Same as On Page but violet accent
- Zone label: "📌 Screen zone · stays fixed"
- Pin icon in zone corner
- Annotation: "doesn't move when you scroll"

### 6.4 Zone fill colors (while drawing)
| Blur type | Zone fill during draw |
|---|---|
| Gaussian | Translucent cyan tint + `backdrop-filter:blur` |
| Frosted | Translucent frosted tint |
| Color (solid black) | Semi-transparent dark fill |
| Color (custom) | Semi-transparent selected color fill |

### 6.5 After committing a pick
- Toolbar description confirms: "✓ 1 element blurred · click another or close"
- Element list in popup updates on next open

### 6.6 Popup mode badge
- Pick & Blur active-block header shows current active picker mode as a **live-reactive** read-only tag: `◉ Element`
- Tag updates in real-time via message from content script when user switches mode in toolbar
- Hint below element list: "Change mode from the toolbar on the page"
- PII mode chips are **always independent** — they are never affected by which blur mode (Blur All / Pick & Blur) is active. PII section always shows all 4 mode chips regardless.

---

## 7. Auto-Detect PII

Fully independent of Blur All / Pick & Blur. Uses its own CSS rule (`[data-bl-si-pii]:not([data-bl-si-reveal])`).

### 7.1 Main popup display
```
Auto-Detect PII          [ master toggle ]
[ Gaussian ] [ Frosted ] [ Redacted ] [ Asterisked ]
Detects emails and numeric patterns
```

- Master toggle: **on = EMAIL + NUMERIC both active; off = both off**
- No individual sub-toggles, no count display
- Mode chips: inline in section (no Modify sub-page — only two controls)

### 7.2 PII modes

| Mode | Behaviour |
|---|---|
| Gaussian | Blur filter on `[data-bl-si-pii]` spans |
| Frosted | SVG displacement blur on PII spans |
| Redacted | Solid bg color over PII spans |
| Asterisked | Replace visible characters with `●●●` inline |

---

## 8. Automate

Trigger layer — fires whatever blur mode + settings are currently configured.

### 8.1 Main popup display
Summary-only. No inline controls.

```
Automate
  Timer        Off
  Idle         2 min · On
  Tab Switch   On
                            [ Modify → ]
```

### 8.2 Modify sub-page controls
- **Timer**: duration selector (1 / 5 / 10 / 15 / 30 / 60 min) + Start/Stop button + live countdown shown when active
- **Idle**: inactivity threshold selector (1 / 2 / 5 / 10 min) + enable toggle
- **Tab Switch**: enable toggle (activates blur when user switches away from tab)
- Footer note: "When triggered → applies current [Blur All / Pick & Blur] settings"
- Multiple triggers can be active simultaneously

---

## 9. Navigation Rows (in main popup body)

Two arrow-button rows below Automate section:

```
[ Shortcuts                                → ]
[ Site Rules                               → ]
```

Both open dedicated sub-pages.

### 9.1 Shortcuts sub-page
- Lists all actions with current key binding
- Edit binding inline (capture UI)
- Reserved chord warnings shown but save not blocked

### 9.2 Site Rules sub-page
- Lists URL pattern rules
- Each rule row: `[pattern]  [mode badge]  [⚙ configure]  [×]`
- **Default behaviour**: rule inherits global How to Blur settings
- **"Custom settings" toggle per rule**: unlocks per-rule blur type + settings override (same controls as How to Blur Modify sub-page)
- Add new rule via input at bottom

---

## 10. Footer

Utility-only. No feature navigation.

```
[ v1.x.x ]  [ Feedback ]  [ Export ]  [ Logs ]  [ Language ]
```

- **Version**: read-only label
- **Feedback**: opens bug report / feedback link
- **Export**: downloads settings as JSON
- **Logs**: opens debug log viewer (requires `blsi_debug` enabled)
- **Language**: locale selector (future-ready placeholder for now)

---

## 11. Sub-pages

All sub-pages follow the same pattern:
- Back arrow (←) + sub-page title in header
- Host remains visible
- Content scrolls

| Sub-page | Triggered from |
|---|---|
| How to Blur — Modify | Modify button in How to Blur section |
| Automate — Modify | Modify button in Automate section |
| Shortcuts | Nav row in main popup |
| Site Rules | Nav row in main popup |

---

## 12. Popup Layout — Full Order (top to bottom)

```
┌─────────────────────────────────────┐
│ HEADER                              │
│  Brand · Host · Theme · Power       │
├─────────────────────────────────────┤
│ SWAPPABLE MODES                     │
│  Active block (Blur All / P&B)      │
│  Waiting block                      │
│  Clear All (bottom-right)           │
├─────────────────────────────────────┤
│ HOW TO BLUR                         │
│  Type chips (dynamic)               │
│  Summary · Modify →                 │
├─────────────────────────────────────┤
│ AUTO-DETECT PII                     │
│  Master toggle · Mode chips         │
├─────────────────────────────────────┤
│ AUTOMATE                            │
│  Summary rows · Modify →            │
├─────────────────────────────────────┤
│ NAV ROWS                            │
│  Shortcuts →                        │
│  Site Rules →                       │
├─────────────────────────────────────┤
│ FOOTER                              │
│  Version · Feedback · Export ·      │
│  Logs · Language                    │
└─────────────────────────────────────┘
```

---

## 13. Open Items (deferred to next phase)

- **Masked mode — mask style options**: fixed font vs pattern vs custom (TBD)
- **Redacted (Blur All) — color defaults and presets**: whether it shares a global color or per-instance
- **Footer language selector**: locale list and i18n scope
- **Logs sub-page**: exact format and filtering options
- **Export format**: full settings JSON schema
- **Picker toolbar drag persistence**: whether toolbar position is remembered across sessions
