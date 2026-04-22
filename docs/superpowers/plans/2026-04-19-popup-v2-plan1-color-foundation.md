# Popup Redesign v2 — Plan 1: Color Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the v2 color system — amber = all interactive actions, cyan = all navigation/next-page elements. Fixes Modify buttons (plain text → cyan pill), nav arrows (dim → cyan), PII chips (sky → amber). Zero logic changes.

**Architecture:** Pure CSS token additions + two CSS rule changes + one class name removed from `popup_render.js`. The 595 existing unit tests remain untouched — this is purely visual.

**Tech Stack:** CSS custom properties, Vanilla JS IIFE, Jest (confirm no regressions).

**Spec:** `docs/superpowers/specs/2026-04-19-popup-redesign-v2-design.md §2`

---

## File Map

| File | Action | Change |
|---|---|---|
| `popup/theme.css` | Modify | Add `--bl-cyan` token (dark + light) |
| `popup/popup.css` | Modify | `.bl-btn-text` → cyan pill; `.bl-nav-row__arrow` → cyan; remove `.bl-chip--sky.bl-chip--active` |
| `popup/popup_render.js` | Modify | PII chips: remove `bl-chip--sky` class |

---

### Task 1: Add `--bl-cyan` token to theme.css

**Files:**
- Modify: `popup/theme.css`

- [ ] **Step 1: Add token to dark mode (`:root`) after `--bl-sky`**

Open `popup/theme.css`. In the `:root` block, add after the `--bl-sky` line:

```css
  --bl-cyan:         #22d3ee;
```

- [ ] **Step 2: Add token to light mode after `--bl-sky`**

In the `[data-theme="light"]` block, add after the `--bl-sky` line:

```css
  --bl-cyan:         #0284c7;
```

Result — full `theme.css` after both edits:

```css
/* Slate dark mode (default) */
:root {
  --bl-base:         #0a0b0f;
  --bl-surface:      #13151f;
  --bl-raised:       #1e2130;
  --bl-amber:        #fbbf24;
  --bl-sky:          #38bdf8;
  --bl-cyan:         #22d3ee;
  --bl-violet:       #818cf8;
  --bl-danger:       #f87171;
  --bl-text-primary: #e8eaf0;
  --bl-text-muted:   #6b7280;
  --bl-text-dim:     #3a3d50;
}

[data-theme="light"] {
  --bl-base:         #f8f9fc;
  --bl-surface:      #eef0f6;
  --bl-raised:       #e4e8f2;
  --bl-amber:        #d97706;
  --bl-sky:          #38bdf8;
  --bl-cyan:         #0284c7;
  --bl-violet:       #6d28d9;
  --bl-danger:       #dc2626;
  --bl-text-primary: #0f1117;
  --bl-text-muted:   #6b7280;
  --bl-text-dim:     #9098b0;
}
```

- [ ] **Step 3: Commit**

```bash
git add popup/theme.css
git commit -m "feat(popup): add --bl-cyan token to Slate theme (dark=#22d3ee light=#0284c7)"
```

---

### Task 2: Update popup.css — Modify buttons, nav arrows, remove sky chip

**Files:**
- Modify: `popup/popup.css`

Three edits in one file.

**Edit A — `.bl-btn-text`: plain text → cyan pill**

Find and replace the entire `.bl-btn-text` + `.bl-btn-text:hover` block (currently lines 352–363):

```css
/* OLD — remove this */
.bl-btn-text {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--bl-text-muted);
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
  flex-shrink: 0;
}
.bl-btn-text:hover { color: var(--bl-text-primary); }
```

Replace with:

```css
.bl-btn-text {
  background: color-mix(in srgb, var(--bl-cyan) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bl-cyan) 25%, transparent);
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: var(--bl-cyan);
  padding: 3px 10px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.bl-btn-text:hover {
  background: color-mix(in srgb, var(--bl-cyan) 18%, transparent);
}
```

**Edit B — `.bl-nav-row__arrow`: dim → cyan**

Find (line 322):
```css
.bl-nav-row__arrow { color: var(--bl-text-dim); font-size: 12px; }
```

Replace with:
```css
.bl-nav-row__arrow { color: var(--bl-cyan); font-size: 12px; font-weight: 600; }
```

**Edit C — remove `.bl-chip--sky.bl-chip--active`**

Find and delete the entire block (lines 240–243):
```css
.bl-chip--sky.bl-chip--active {
  border-color: var(--bl-sky);
  background: color-mix(in srgb, var(--bl-sky) 12%, var(--bl-raised));
}
```

(PII chips now use amber via `.bl-chip--active`. `--bl-sky` is kept for Pick & Blur mode-block dot only.)

- [ ] **Step 1: Apply Edit A** (`.bl-btn-text` → cyan pill) using Edit tool

- [ ] **Step 2: Apply Edit B** (`.bl-nav-row__arrow` → cyan) using Edit tool

- [ ] **Step 3: Apply Edit C** (remove `.bl-chip--sky.bl-chip--active` block) using Edit tool

- [ ] **Step 4: Commit**

```bash
git add popup/popup.css
git commit -m "feat(popup): v2 color — Modify btn cyan pill, nav arrows cyan, remove sky chip variant"
```

---

### Task 3: Fix PII chip class in popup_render.js

**Files:**
- Modify: `popup/popup_render.js`

- [ ] **Step 1: Find the PII chip class assignment**

In `popup/popup_render.js` inside `renderPiiSection`, find (line ~130):

```js
btn.className = 'bl-chip' + (isActive ? ' bl-chip--sky bl-chip--active' : '');
```

- [ ] **Step 2: Remove the sky class**

Replace with:

```js
btn.className = 'bl-chip' + (isActive ? ' bl-chip--active' : '');
```

- [ ] **Step 3: Commit**

```bash
git add popup/popup_render.js
git commit -m "fix(popup): PII mode chips use amber (bl-chip--active) not sky per v2 color rules"
```

---

### Task 4: Verify no regressions

- [ ] **Step 1: Run unit tests**

```bash
npm run test:unit
```

Expected: 595 tests pass. Count must not decrease.

- [ ] **Step 2: Load extension in Chrome and smoke-test visually**

1. Open `chrome://extensions` → Load unpacked → select project root
2. Open popup on any page
3. Check:
   - "Modify →" buttons in How to Blur and Automate sections are **cyan pill** (not plain muted text)
   - Nav row arrows (Shortcuts →, Site Rules →) are **cyan**
   - PII mode chips when active are **amber** (not sky blue)
   - Blur All toggle is amber when on ✓
   - HTB type chips are amber when active ✓
   - Pick & Blur mode-block dot (if you switch mode) is sky `#38bdf8` — unchanged, still correct
4. Toggle light mode (☀ button) — verify Modify buttons and nav arrows are sky `#0284c7` in light mode
