# Popup Revamp — Part 1: Current State Inventory

## Popup Structure (11 sections in order)

| # | Section | Type | Collapsible | Key elements |
|---|---|---|---|---|
| 1 | Header | Sticky bar | No | Brand icon + "BlurrySite" title, enable/disable toggle |
| 2 | Toast | Fixed overlay | N/A | Auto-hide notifications (1800ms) |
| 3 | Page Status | Card | No | Hostname, blur count badge, Blur All button, Clear Page button |
| 4 | Keyboard Shortcuts | Card | No | 3 shortcut rows (blur all, picker, clear) with customize buttons |
| 5 | Shortcut Modal | Overlay | N/A | Capture primary modifier + keys, Save/Reset/Cancel |
| 6 | Settings | Card | Yes | Blur radius slider, smooth transition toggle, reveal mode select, highlight color |
| 7 | Blur Categories | Card | Yes | Thorough blur toggle + 5 category toggles (text/media/form/table/structure) |
| 8 | URL Rules | Card | Yes | Rules list with edit/delete, Add Rule button, rule count badge |
| 9 | Rule Editor Modal | Overlay | N/A | Name, pattern, pattern type, form blur, thorough blur, blur radius overrides |
| 10 | Blurred Elements | Card | No | Scrollable list of CSS selectors with remove buttons, empty state |
| 11 | Footer | Sticky bar | No | Clear all sites button, version display |

## Settings Coverage Matrix

| Setting | Type | Default | Has UI? | Control type |
|---|---|---|---|---|
| `BLUR_RADIUS` | number | 10 | YES | Range slider 2-20 |
| `TRANSITION_DURATION` | number | 200 | YES | Boolean toggle (0 or 200ms) |
| `HIGHLIGHT_COLOR` | hex | #f59e0b | YES | Color picker |
| `REVEAL_MODE` | enum | hover | YES | Select (click/hover/none) |
| `ENABLED` | boolean | true | YES | Toggle in header |
| `THOROUGH_BLUR` | boolean | false | YES | Toggle in categories |
| `BLUR_MODE` | enum | gaussian | **NO** | Needs select/radio |
| `SHORTCUTS.*` (×3) | object | Alt+Shift+B/P/U | YES | Display + capture modal |
| `BLUR_CATEGORIES.*` (×5) | boolean | varies | YES | 5 toggles |
| `PERFORMANCE.OFFSCREEN_UNBLUR` | boolean | true | **NO** | Needs toggle |
| `PERFORMANCE.MAX_BLURRED` | number | 500 | **NO** | Needs number input |
| `PERFORMANCE.CHUNK_SIZE` | number | 50 | **NO** | Needs number input |

**15 of 21 settings have UI. 6 are code-only.**

## Interactive Controls Inventory

| Type | Count | Details |
|---|---|---|
| Toggles | 10 | enable, transition, thorough, 5 categories, 2 in rule modal |
| Sliders | 2 | blur radius (global + rule modal) |
| Selects | 2 | reveal mode, rule pattern type |
| Text inputs | 2 | rule name, rule pattern |
| Color picker | 1 | highlight color |
| Buttons | 19+ | blur all, clear, collapsible toggles, customize, modal actions |
| Modals | 2 | shortcut capture, rule editor |

## Known Bugs in Current Popup

| Bug | Severity | Status |
|---|---|---|
| No `storage.onChanged` listener — popup shows stale data if changed externally | High | Not fixed |
| Color picker debounce doesn't notify tab — highlight changes need reload | Medium | Not fixed |
| Blur list uses 200ms setTimeout for re-fetch — brittle timing | Low | Documented |
| Rule modal slider `oninput` handler not cleaned up between opens | Low | Not fixed |
| Empty state display inconsistency (classList.toggle vs style.display) | Low | Not fixed |
| `.shortcut-browser-hint` CSS defined but never used in HTML | Low | Dead CSS |
| `.modal__step-num`, `.modal__step--dim/--active` CSS orphaned | Low | Dead CSS |

## Save Flow

```
UI control changed
  → handler updates settings.{KEY}
  → saveSettings(notifyTab = true)
    → bgMessage(SAVE_SETTINGS) → persists to storage
    → tabMessage(UPDATE_SETTINGS) → content script applies immediately
```

Debounced (300ms): blur radius slider, highlight color.
Immediate: all toggles, selects, modal saves.
