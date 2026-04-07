# Popup Revamp — Part 3: Session Decisions & Design Context

## User's Stated Preferences

| Preference | What it means for the popup |
|---|---|
| "Focused user experience" | Don't overwhelm with options. Common actions prominent, advanced settings tucked away. |
| "Deep customization" | Every setting must be accessible. Power users should be able to tune everything. |
| "UPPER_SNAKE_CASE" | All setting keys follow this convention. UI labels should be human-readable mappings. |
| "No hardcoded strings" | All enum values use typed constants (REVEAL_MODES, BLUR_MODES, etc.). UI string literals should reference these. |
| "No partial updates" | Settings are always stored as complete objects. Popup always sends the full settings object. |
| "Options to configure everything in code" | Every behavior has a setting. Defaults are sensible but overridable. |

## Architecture Decisions That Affect Popup

### Settings data model (Refactor 1)

- Single `DEFAULT_SETTINGS` in constants.js — UPPER_SNAKE_CASE
- `buildDefaultSettings()` for mutable clones
- `validateSettings()` repairs broken/missing values
- `deepMerge()` for combining defaults + stored + rule overrides
- Full-object storage — no partial updates

**Popup impact**: `saveSettings()` must always send the complete settings object.
The popup mutates its local `settings` then sends the whole thing.

### URL rules system

- Three-layer resolution: DEFAULT_SETTINGS → global settings → first matching URL rule
- Rules stored separately from settings (`chrome.storage.local.rules`)
- Pattern matching: wildcard (domain-boundary aware) and regex
- `resolveSettings()` in content_script handles the merge
- `globalSettings` vs `settings` separation prevents rule overrides from "sticking"

**Popup impact**: Rule editor needs to clearly show that rules OVERRIDE global
settings. Per-site badge should indicate "URL rule active for this site" when
a matching rule exists.

### Idempotent applyState

- All propagation paths collapse to `resolveSettings() → applyState()`
- `applyState(newSettings, prev)` configures every component idempotently
- Change detection: categories, thoroughBlur, radius, blur mode

**Popup impact**: Any setting change in the popup immediately takes effect
on the active tab via `UPDATE_SETTINGS → applyState()`. No page reload needed.

### Performance framework

- Off-screen unblur via IntersectionObserver (200px margin)
- Element cap (MAX_BLURRED: 500)
- Configurable chunk size
- `blurredElementCount` tracks active count

**Popup impact**: Could show the active count vs cap in status. "247 / 500
elements blurred" gives users context.

## Known Limitations to Surface in UI

| Limitation | How to present |
|---|---|
| CSS blur is visual only — DOM text accessible | Info banner or About section |
| `<select>` dropdown visible when open | Tooltip on Form category toggle |
| `position: fixed/sticky` shifts inside blur | Tooltip on Structure category |
| DRM video shows dark overlay | Tooltip on Media category |
| Screen readers announce blurred text | Option: `aria-hidden` toggle (future) |
| Text selectable/copyable despite blur | Note in About section |
| `user-select: none` blocks casual copy but bypassable | Already applied in CSS |
| Find-in-page matches blurred text | Document in Help |

## Blur Mode Options (from AI_BYPASS.md research)

| Mode | Implementation | AI resistance | Performance | Status |
|---|---|---|---|---|
| **Gaussian** | CSS `filter: blur()` | Low-moderate | Excellent (GPU) | Implemented, default |
| **Frosted glass** | SVG feTurbulence + feDisplacementMap + feGaussianBlur | High | 3-8x costlier (CPU) | Implemented |
| **Pixelation** | Canvas downscale + nearest-neighbor upscale | Very high | Excellent | Not implemented |
| **Noise injection** | Canvas getImageData + random noise | Very high | Moderate | Not implemented |
| **Median filter** | Canvas per-pixel median computation | High | Expensive | Not implemented |

Popup should expose Gaussian and Frosted now, with room to add others.

## What the Popup Must Communicate

### Security model (clear and prominent)

"BlurrySite hides content visually during screen sharing. It does NOT
protect against DevTools, browser extensions, or JavaScript. For
compliance (GDPR/HIPAA), use server-side data redaction."

### What blur radius means

| Radius | Protection level |
|---|---|
| 2-5px | Casual glance only |
| 6-9px | Shoulder surfing |
| 10-14px | OCR-resistant |
| 15-20px | AI deblurring resistant |
| 20-30px | Maximum visual protection |

### What each category controls

Users shouldn't need to know HTML element names. Categories should be
described in user terms:

| Category | User-facing description |
|---|---|
| Text | Headings, paragraphs, links, and inline text |
| Media | Images, videos, and canvas elements |
| Form | Input fields, text areas, dropdowns, and buttons |
| Table | Table cells and captions (data tables) |
| Structure | Page sections, sidebars, and containers with text |
