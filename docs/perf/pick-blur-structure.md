# Pick & Blur — Popup Structure Map

## Layer 1: Main view card (`renders/main.js`)

`_renderPickBlurBlock(el, settings, isExpanded, blurItems, pickBlurEnabled)`

**Collapsed** (other block expanded):
```
[dot] Pick & Blur                              (bl-mode-block--collapsed)
  "3 elements" / "No elements blurred"         bl-mode-compact
```

**Expanded** (`_expandedMode === 'pick-blur'`):
```
[dot] Pick & Blur  [toggle]                    bl-mode-block__header
                                               (id: bl-pick-blur-toggle)
  _renderPickBlurInfo()
    item count: "3 items blurred"              bl-pick-count
    summary: "Picker: Page · Type: Gaussian…"  bl-pick-info (only if items > 0)

  _renderPickerModeButtons()
    [Dynamic]  [Page]  [Screen]                bl-picker-mode-chips
    (data-picker-mode attr, disabled if off)

  _renderModeActions('pick-blur')
    [Clear All]   [Modify →]                   bl-mode-actions
    (disabled if no items / if off)
```

---

## Layer 2: HTB sub-page (`renders/howtoblur.js`, `howtoblur.css`)

Opened via "Modify →" → `popup.js:_openHtbModify(isBlurAll=false)` → `BlurrySitePopupRenderHtb.renderBody(bodyEl, settings, onSave, false)`

Section order (for Pick & Blur, `isBlurAll=false`):

```
1. Reveal mode       (segmented: Hover / Click / None)     ← hidden only if type=color
2. ── divider ──
3. Thorough Blur     (toggle)                              ← always visible
4. ── divider ──
5. Type chips        (Gaussian / Frosted / Color)          ← no Redacted/Masked
6. [Categories]      hidden — Blur All only
7. [Strength slider] hidden if type=color                  ← shown for gaussian/frosted
8. [Color picker]    shown only if type=color
     └── hex input + opacity slider
```

Visibility is reactive: chip click → `_updateVisibility()` shows/hides sections without re-render.

---

## Layer 3: Event wiring (`popup.js`)

| Event | Target | Action |
|---|---|---|
| `change` | `#bl-pick-blur-toggle` | `onSave({ pick_blur_enabled })` |
| `click` | `.bl-mode-block--collapsed` | expand accordion, re-render |
| `click` | `[data-picker-mode]` | save `picker_mode` → send `TOGGLE_PICKER` msg → `window.close()` |
| `click` | `[data-type]` | `onSave({ pick_blur_type })` |
| `click` | `[data-action="htb-modify"][data-mode="pick-blur"]` | open HTB sub-page |
| `click` | `[data-action="clear-all"][data-mode="pick-blur"]` | `blsi.Model.clear_host(hostname)` |
| `click` | `[data-item-id]` | `blsi.Model.remove_blur_item(hostname, id)` |

---

## Data path

`blsi.Model` (storage) → `BlurrySitePopupState` → `_renderCurrent()` → `renderAll()` → `_renderPickBlurBlock()`

Settings keys owned by Pick & Blur: `pick_blur_enabled`, `pick_blur_type`, `picker_mode`, `pick_blur_color`, `blur_radius` (shared with Blur All), `reveal_mode` (shared).

---

## 4-State UI Analysis

### State 1 — Collapsed + OFF

**Current rendering:**
```
● (red)  Pick & Blur
"No elements blurred"     ← bl-mode-compact, dim color
```
Card: `bl-mode-block--collapsed` (purple-tinted border/bg, cursor:pointer).

**Problems:**
- Red dot is the only OFF signal — 8px, too subtle
- "No elements blurred" conflates OFF with ON+unused — different states, same text
- Collapsed ON vs OFF are nearly indistinguishable in shape
- No disabled styling on the card to visually demote it

**Proposed improvements:**
- Add a small dim `Off` badge inline next to the title
- When off + 0 items: text → *"Enable to start picking"*
- When off + has items: text → *"N items · paused"*
- Optionally reduce card opacity (e.g. 0.65) when off+collapsed

---

### State 2 — Collapsed + ON

**Current rendering:**
```
● (green)  Pick & Blur
"3 elements"  OR  "No elements blurred"
```
Same structure as OFF, just green dot.

**Problems:**
- 0-item ON state: "No elements blurred" gives no next-step hint
- Active picker mode (Page/Dynamic/Screen) not shown — useful context lost
- No expand affordance — no chevron, no visual hint the card is clickable

**Proposed improvements:**
- 0 items: *"Tap a page element to blur it"* or *"Open picker to start"*
- Has items: show mode badge inline — `Page · 3 items`
- Add right-aligned `›` chevron in the header for expand affordance

---

### State 3 — Expanded + OFF

**Current rendering:**
```
● (red)  Pick & Blur  [toggle: OFF]
"No elements blurred"           ← bl-pick-count
                                ← (no summary line — only shown when items > 0)

[Dynamic] [Page] [Screen]       ← ALL disabled (greyed)

[Clear All ✗]  [Modify → ✗]     ← both disabled
```

**Problems:**
- Everything disabled — card becomes a dead grey wall
- "Modify →" disabled means you can't inspect/configure settings while off; must toggle on just to look
- Disabled picker chips communicate nothing — unclear if showing current mode or just options
- No explanation for why everything is disabled (new-user confusion)

**Proposed improvements:**
- **Keep "Modify →" enabled when off** — settings inspection shouldn't require activation
- Replace disabled chips with a single read-only badge: *"Mode: Page"*
- Add micro-hint under toggle: *"Toggle on to activate picking"* (11px, dim)
- Or: collapse the disabled section into a single off-state message block instead of showing disabled controls

---

### State 4 — Expanded + ON

**Current rendering:**
```
● (green)  Pick & Blur  [toggle: ON]
"3 items blurred"                            ← bl-pick-count
"Picker: Page · Type: Gaussian · Moderate"  ← bl-pick-info (only when items > 0)

[Dynamic] [Page] [Screen]                    ← enabled chips

[Clear All]  [Modify →]                      ← enabled
```

**Problems:**
- **Picker chips have a dual-role problem**: clicking saves the mode AND launches the picker AND closes the popup — users expect a selector, get a launcher
- 0-item state: hollow layout — no info line, just empty gap between header and chips
- Info line `"Picker: Page · Type: Gaussian · Moderate"` is dense and flat — no visual hierarchy
- No inline item list — user can't see what's blurred without navigating elsewhere
- "Clear All" (destructive) sits immediately beside "Modify →" — no visual separation

**Proposed improvements:**
- **Decouple mode selection from picker launch**: chips select mode (save only, no close); separate "Open Picker" CTA button launches the picker
- 0-item state: show empty-state prompt *"Pick elements on the page to blur them"* + mode chips + "Open Picker" button
- Info line: split into two labeled rows (`Mode`, `Type`) instead of `·`-joined flat string
- Layout: `[Clear All]` left-aligned, `[Modify →]` right-aligned, explicit gap
- Optionally show top 2–3 blurred selectors inline (truncated) so user sees what's active
