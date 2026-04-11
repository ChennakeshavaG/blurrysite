# Plan: Move Blurred Elements Section Above Keyboard Shortcuts

**Date:** 2026-04-08  
**Motivation:** User feedback — the Blurred Elements list is the most contextually relevant section when the popup opens on an active page. Showing it before Keyboard Shortcuts surfaces actionable info sooner.

---

## Current Section Order (popup/popup.html)

1. Header (sticky)
2. Action Bar (Blur All / Clear All / Picker)
3. Site Info
4. **Keyboard Shortcuts** (`#sectionShortcuts`) ← always-visible, starts expanded
5. Settings (`#sectionSettings`) ← collapsible, collapsed
6. URL Rules (`#sectionRules`) ← collapsible, collapsed
7. **Blurred Elements** (`#sectionBlurred`) ← always-visible when count > 0
8. Toast / Modals / Footer

## Proposed Section Order

1. Header (sticky)
2. Action Bar
3. Site Info
4. **Blurred Elements** (`#sectionBlurred`) ← moved up
5. **Keyboard Shortcuts** (`#sectionShortcuts`)
6. Settings
7. URL Rules
8. Toast / Modals / Footer

---

## Change Required

### 1. `popup/popup.html` — only file that needs editing

Move the `#sectionBlurred` block (currently lines 116–126) to appear **between the Site Info section and the Keyboard Shortcuts section** (currently line 81).

**Before (abridged):**
```html
<!-- SITE INFO -->
<section class="bl-si-site-info"> ... </section>

<!-- KEYBOARD SHORTCUTS -->
<section class="bl-si-section" id="sectionShortcuts"> ... </section>

<!-- SETTINGS -->
...
<!-- URL RULES -->
...

<!-- BLURRED ELEMENTS -->
<section class="bl-si-section" id="sectionBlurred"> ... </section>
```

**After (abridged):**
```html
<!-- SITE INFO -->
<section class="bl-si-site-info"> ... </section>

<!-- BLURRED ELEMENTS -->
<section class="bl-si-section" id="sectionBlurred"> ... </section>

<!-- KEYBOARD SHORTCUTS -->
<section class="bl-si-section" id="sectionShortcuts"> ... </section>

<!-- SETTINGS -->
...
<!-- URL RULES -->
...
```

---

## No Other Files Need Changing

| File | Reason unchanged |
|---|---|
| `popup/popup.js` | `renderBlurList()` references `#sectionBlurred`, `#blurList`, `#blurListCount`, `#blurEmpty` by ID — DOM order is irrelevant |
| `popup/popup.css` | Sections use the same `.bl-si-section` class; layout is document-flow order (flex column on `body`). No position overrides. |
| `popup/popup_settings_renderer.js` | Only writes to `#bodySettings`, `#bodyShortcuts`, `#ruleOverridesContainer` — unaffected |
| `src/*.js`, `background.js` | No popup layout dependency |
| Tests | No tests cover popup HTML structure |
| `docs/` | No doc tables reference section order |

---

## UX Considerations

- **When no elements are blurred:** `#sectionBlurred` is hidden (`display: none`) by `renderBlurList()`. The section effectively disappears and Keyboard Shortcuts stays at top — no wasted space.
- **When elements are blurred:** The list appears immediately below Site Info, letting the user see and manage what's blurred without scrolling past shortcuts they rarely need.
- **Keyboard Shortcuts** remains always-expanded and non-collapsible; it just appears lower in the scroll order.
- The popup max-height is 520px with overflow-y: auto — both sections are reachable without layout changes.

---

## Implementation Steps

1. In `popup/popup.html`, cut the `<!-- BLURRED ELEMENTS -->` comment + `<section id="sectionBlurred">` block.
2. Paste it immediately after the closing `</section>` of `.bl-si-site-info` (before `<!-- KEYBOARD SHORTCUTS -->`).
3. Run manual smoke test: open popup on a page with blurred elements → list appears above shortcuts. Open on a clean page → list hidden, shortcuts at top as before.
4. No unit test changes needed (no popup HTML coverage in test suite).
