# Automate Sub-page — UX Redesign

## What's changing
Same features, same constraints. Only the visual presentation improves.

---

## Current UI

```
┌─────────────────────────────────────┐
│ ← Automate                          │
│ ─────────────────────────────────── │
│                                     │
│  Tab Switch                  [  ○]  │
│  Blur automatically when you        │
│  switch to another tab              │
│                                     │
│  ──────────────────────────────     │
│                                     │
│  IDLE                               │
│  Enable idle blur            [  ○]  │
│  Blurs the page after you stop      │
│  using it for a while               │
│  [  5  ] [min ▾]                    │
│                                     │
│  ──────────────────────────────     │
│                                     │
│  TIMER                              │
│  Blurs the page after a set         │
│  duration                           │
│  [ 15  ] [min ▾]  [   Start   ]    │
│                                     │
│  All triggers apply your …          │
└─────────────────────────────────────┘
```

Issues:
- Plain number inputs feel like a form, not a control panel
- Title + toggle-row are visually separate (two rows for one concept)
- No visual sense of the time range or where the value sits
- Blocks separated only by a thin `<hr>` line

---

## Proposed UI

```
┌─────────────────────────────────────┐
│ ← Automate                          │
│ ─────────────────────────────────── │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ ⇄  Tab Switch        [  ○] │    │
│  │    Blur when you switch tab │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ ◷  Idle Blur         [●  ] │    │
│  │    Blur after you go idle   │    │
│  │                             │    │
│  │         5 min               │    │  ← large value label
│  │  ──────────●────────────    │    │  ← slider (cyan fill)
│  │  15 s              60 min   │    │  ← min / max labels
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ ⏱  Timer                   │    │
│  │    Blur after a set time    │    │
│  │                             │    │
│  │         15 min              │    │  ← large value label
│  │  ██████●──────────────────  │    │  ← slider (amber fill)
│  │  30 s                 2 hr  │    │  ← min / max labels
│  │                             │    │
│  │                  [ Start ]  │    │  ← action button
│  └─────────────────────────────┘    │
│                                     │
│  All triggers apply your …          │
└─────────────────────────────────────┘
```

### When timer is running:

```
│  ┌─────────────────────────────┐    │
│  │ ⏱  Timer                   │    │
│  │    Blur after a set time    │    │
│  │                             │    │
│  │         15 min              │    │
│  │  ██████●──────────────────  │    │  ← slider dimmed/locked
│  │  30 s                 2 hr  │    │
│  │                             │    │
│  │                  [  Stop  ] │    │  ← red Stop button
│  └─────────────────────────────┘    │
```

---

## Design details

### Cards
Each block → card with `bg: --bl-raised`, `border-radius: 10px`, subtle border.  
Cards are separated by gap (no `<hr>` lines).

### Block header row
```
[icon]  Label                 [toggle]
```
Icon (small SVG, 14px, muted color) + label text + toggle aligned in one row.

### Slider fills
- **Idle** — cyan fill (`--bl-cyan`) matches nav/info color
- **Timer** — amber fill (`--bl-amber`) matches action color

### Value label
Large (16px, bold, `--bl-amber` for timer / `--bl-cyan` for idle) above the slider track. Updates live as user drags.

### Constraints — rationale

| Control | Bound | Value | Why |
|---|---|---|---|
| Idle | min | 15 s | Chrome idle API minimum detection interval |
| Idle | max | 3600 s (60 min) | Practical UX cap — Chrome idle API has no documented maximum |
| Timer | min | 30 s | Pre-existing validation rule in old number-input code |
| Timer | max | 7200 s (2 hr) | Confirmed in brainstorm design spec |

Old code enforced these as error/warning text after input. Sliders enforce them structurally — the range can't be exceeded.

### Save format (unchanged)
```js
// Slider value (in seconds) → converted back to (value, unit) on save
{ automate_idle:  { value: 5, unit: 'min', enabled: true } }
{ automate_timer: { value: 15, unit: 'min', enabled: true, started_at: 1234567890 } }
{ automate_tab_switch: { enabled: false } }
```

---

## Files touched
- `popup/renders/automate.js` — rewrite block builders, add slider helpers
- `popup/renders/automate.css` — card styles, slider styles, value label
- No other files. No test changes needed.
