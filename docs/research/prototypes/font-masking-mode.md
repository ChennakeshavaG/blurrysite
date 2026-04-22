# Font-Based Masking — Research Doc

Explores replacing the current `::after` asterisk-overlay approach in **masked mode** with a **replacement font** strategy.

---

## 1. What the Current Masked Mode Does

`_stampMaskText(el)` writes `'*'.repeat(Math.min(el.textContent.length, 100))` to `el.dataset.blSiMaskText`.

CSS in `content.css`:
```css
[data-bl-si-mask-text]::after {
  content: attr(data-bl-si-mask-text);
  font-size: 1rem !important;
  letter-spacing: 0.05em;
  color: inherit;
}
```

The injected blur-all rule hides the original text via `font-size: 0` (and `filter: brightness(0)` for media). The `::after` content overlays the asterisks on top.

Reveal rule:
```css
[data-bl-si-reveal][data-bl-si-mask-text]::after {
  content: none !important;
}
```

**Known problem**: Hard cap at 100 chars — any element with >100 chars shows truncated asterisks that are shorter than the real content, leaking the rough length.

---

## 2. The Replacement Font Idea

Define a custom `@font-face` where every printable codepoint (U+0020–U+007E and beyond) maps to a single glyph — an asterisk, bullet, or solid block. Apply `font-family: 'BlurrySiteMask'` to masked elements. The DOM text is intact; only the visual rendering changes.

---

## 3. How Font Codepoint Mapping Works

A font file (TTF/OTF/WOFF2) has two relevant tables:
- **`glyf` / `CFF`** — defines the visual outline of each glyph.
- **`cmap`** — maps Unicode codepoints to glyph indices.

In a replacement font, the cmap is rewritten so every printable ASCII codepoint (`0x20`–`0x7E`) points to the same glyph index (e.g., an asterisk). Result: every character renders identically.

Selective fonts preserve `U+0020` (space) as an actual space so word breaks are visible.

---

## 4. Existing Ready-Made Fonts

### Redacted Font (recommended)
- **Source**: `https://github.com/christiannaths/Redacted-Font`
- **License**: Open Font License 1.1 (include author credit in `LICENSE`)
- **Renders**: Solid horizontal bars (`█`-style), not asterisks
- **Size**: ~8 KB WOFF, ~5 KB WOFF2
- **Pros**: Battle-tested (used on Medium, HN, product launches), monospace-friendly, full Latin coverage
- **Cons**: Solid-bar aesthetic, not asterisks; OFL requires license attribution

### Asterisk / Password-Style Fonts
- Various hobbyist fonts on DaFont/FontSquirrel map chars to `*` or `•`
- **Licensing risk**: many are "free for personal use" only — avoid
- Must verify OFL or MIT license before bundling

### Build Your Own (minimal)
- ~1.5–2 KB WOFF2 for ASCII-only coverage
- Full control over glyph shape and width
- Requires fonttools (Python) — 2–3 hours work
- See §7 for how to generate

**Recommendation**: Use Redacted Font for the initial implementation. If the solid-bar aesthetic is wrong, generate a custom asterisk font in phase 2.

---

## 5. Comparison: Font Approach vs. Current `::after`

| Aspect | Current `::after` | Replacement Font |
|--------|-------------------|------------------|
| Max masked length | 100 chars (hard cap) | Unlimited |
| Attribute overhead | `data-bl-si-mask-text` on every element | None — CSS only |
| DOM mutation | Yes (attribute write + clear) | No |
| Visual length accuracy | `letter-spacing` dependent | Glyph-width dependent |
| Reveal | `content: none` | Remove `font-family` (auto via `:not([reveal])`) |
| Font load latency | None | ~10–100 ms first load; cached after |
| Asset cost | 0 | ~2–5 KB WOFF2 + manifest entry |
| Layout reflow risk | None | **High** if glyph width ≠ text average |
| Copy-paste privacy | `user-select: none` mitigates | Same (`user-select: none` unchanged) |

---

## 6. The Glyph Width Problem (Critical)

If the replacement glyph is narrower or wider than the average character in the page's font, switching to the mask font **reflowes the layout**.

**Example**: Page uses a proportional font where `m` is ~650 units wide and `i` is ~250 units. Average ~500. If the asterisk glyph is 400 units, a 20-char element shrinks by ~20%, shifting adjacent content.

### Solutions

| Solution | How | Tradeoff |
|----------|-----|----------|
| **Monospace-width asterisk** | Make glyph exactly 600 units (canonical monospace em) | Minimal reflow on terminal/form content; visible on serif body text |
| **Full-em asterisk** | Make glyph 1000 units (1 em wide) | Text expands uniformly; less jarring than shrinking |
| **Solid block (Redacted)** | Full-width block by design | Intentional reflow; users understand "these are blocks" |
| **Match page font width** | Measure default char width at runtime, scale CSS | Complex; requires JS measurement after font load |

**Practical recommendation**: Use Redacted Font (full-width blocks). The intentional aesthetic signals "this is masked" while avoiding the jarring narrow-asterisk shrink.

If asterisks are required, use a monospace-width asterisk and document in release notes that a slight layout shift may occur on proportional-font pages.

---

## 7. Generating a Minimal Custom Font

If Redacted's block style is wrong, generate a custom asterisk font:

```python
# Requires: pip install fonttools
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2Pen import T2Pen  # or TTGlyphPen for TrueType

fb = FontBuilder(1000, isTTF=True)  # 1000-unit em

# Define asterisk glyph (simplified outline — use FontForge GUI for real curves)
# Width: 600 units (monospace), height: 700 units (caps-ish)

fb.setupGlyphOrder(['.notdef', 'asterisk'])
fb.setupCharacterMap({
    i: 'asterisk' for i in range(0x20, 0x7F)  # ASCII 32–126
})
# setupGlyf, setupHorizontalMetrics, setupPost, etc. ...

fb.font.save('BlurrySiteMask.ttf')

# Transcode to WOFF2
from fontTools.ttLib.woff2 import compress
compress('BlurrySiteMask.ttf', 'BlurrySiteMask.woff2')
```

For a real implementation use **FontForge** (GUI) to design the glyph, export TTF, then transcode with fonttools. FontForge is free and cross-platform.

**File size estimate** (ASCII-only, 1 glyph, all codepoints mapped):
- TTF: 3–5 KB
- WOFF2: 1–2 KB

---

## 8. Chrome/Firefox MV3 Constraints

### web_accessible_resources

Fonts served from the extension must be declared so content scripts can load them via `chrome.runtime.getURL()`:

```json
// manifest.json
"web_accessible_resources": [{
  "resources": ["_locales/*/*.json", "fonts/redacted.woff2"],
  "matches": ["<all_urls>"]
}]
```

### Injecting the @font-face Rule

The `@font-face` declaration must land in the page's CSS scope (not the extension's isolated world). In `blur_engine.js` `injectRules(root, categories, mode)`, the style element is appended to `root.head ?? root` — this is the right place:

```javascript
// blur_engine.js injectRules()
const fontUrl = chrome.runtime.getURL('fonts/redacted.woff2');
const fontFaceRule = `
  @font-face {
    font-family: 'BlurrySiteMask';
    src: url('${fontUrl}') format('woff2');
    font-display: swap;
  }
`;
// Prepend to the style block rules string before building the rest
```

### Shadow Root Handling

`injectRules` is called for both the light document and shadow roots. Each shadow root gets its own `<style>` block with its own `@font-face`. Browsers cache the font after the first load, so the per-root duplication is harmless.

### Firefox compatibility

`chrome.runtime.getURL()` works in Firefox via the `chrome.*` compatibility shim (Firefox 109+). No `browser.*` needed.

---

## 9. Reveal Interaction

With the font approach, reveal is simpler than the current `::after` approach.

**Masked blur rule** (new):
```css
[data-bl-si-blur]:not([data-bl-si-reveal]) {
  font-family: 'BlurrySiteMask' !important;
  user-select: none !important;
}
```

**Reveal rule** (unchanged):
```css
[data-bl-si-reveal] {
  filter: none !important;
  user-select: auto !important;
}
```

When `[data-bl-si-reveal]` is added, the `:not([data-bl-si-reveal])` selector stops matching → `font-family: BlurrySiteMask` is no longer applied → element reverts to inherited font instantly.

**No additional CSS rule needed.** The dedicated `[data-bl-si-reveal][data-bl-si-mask-text]::after { content: none }` rule in `content.css` (line 73–75) can be deleted entirely.

---

## 10. CSS / Attribute Changes

### Current masked mode rule (injected by blur_engine, not static CSS):
The injected rule in masked mode currently does `font-size: 0; user-select: none` to hide original text and overlay asterisks via `::after`. With the font approach, replace with:

```css
/* in injectRules() masked mode blurDecl: */
font-family: 'BlurrySiteMask' !important;
user-select: none !important;
/* no font-size: 0 needed — the font replaces characters visually */
```

### Media elements still need brightness(0):

Images, video, canvas don't have text to swap — they need `filter: brightness(0)` as before. No change needed for the media-specific rule in `injectRules`.

### Static content.css:

Remove:
- Lines 52–57: `[data-bl-si-mask-text]::after { ... }`
- Lines 72–75: `[data-bl-si-reveal][data-bl-si-mask-text]::after { content: none }`

---

## 11. blur_engine.js Changes

### Remove `_stampMaskText` and `_clearMaskAttrs`:

```javascript
// DELETE — no longer needed
function _stampMaskText(element) { ... }
function _clearMaskAttrs(element) { ... }
```

### Update callers:

| Location | Change |
|----------|--------|
| `stampElements()` — `if (isMasked) _stampMaskText(el)` | Delete |
| `removeBlur()` — `_clearMaskAttrs(element)` call | Delete |
| `teardown()` / `unblurAll()` — any `_clearMaskAttrs` call | Delete |

### Update `injectRules()`:

1. Add `fontFaceRule` string with `chrome.runtime.getURL(...)`.
2. Change masked `blurDecl` from `font-size: 0; ...` to `font-family: 'BlurrySiteMask' !important; user-select: none !important;`.
3. Prepend `fontFaceRule` to the injected `<style>` content when `isMasked`.

**Total blur_engine.js changes**: ~20 lines (mostly deletions + ~8 lines for font rule).

---

## 12. Accessibility and Privacy Model

Both approaches have the same privacy characteristics:

| Vector | Current `::after` | Replacement Font |
|--------|------------------|-----------------|
| Shoulder-surfer | **Protected** (text hidden visually) | **Protected** |
| Copy-paste | Partially protected (`user-select: none`) | Same |
| Inspect-element / DOM | **Not protected** (text in DOM) | **Not protected** |
| Screen reader | **Not protected** (reads DOM text) | **Not protected** |

Blurry Site's threat model is **visual shoulder-surfer protection only**. Neither approach claims to protect against DevTools inspection. Document this clearly in user-facing help.

---

## 13. Implementation Plan

### Phase 1 (adopt Redacted Font)

1. Download `Redacted-Regular.woff2` from https://github.com/christiannaths/Redacted-Font/releases. Confirm OFL license.
2. Place at `fonts/redacted.woff2`.
3. Add `"fonts/redacted.woff2"` to `web_accessible_resources` in `manifest.json`.
4. Add OFL attribution to `LICENSE` or a `THIRD_PARTY_LICENSES` file.
5. In `blur_engine.js`:
   - Add `fontFaceRule` to `injectRules()` when `isMasked`.
   - Change masked `blurDecl` to use `font-family: 'BlurrySiteMask'`.
   - Delete `_stampMaskText` / `_clearMaskAttrs` and all callers.
6. In `content.css`:
   - Delete `[data-bl-si-mask-text]::after` rule (lines 52–57).
   - Delete reveal-clear rule (lines 72–75).
7. Update `CLAUDE.md` CSS class constants table: remove `data-bl-si-mask-text` entry.
8. Update `docs/LLD.md` masked mode description.
9. Run `npm run test:unit` — remove/update any test that stubs `_stampMaskText` or checks for the attribute.

### Phase 2 (optional — custom asterisk font)

If the block aesthetic of Redacted is undesired, generate a custom monospace-width asterisk font using fonttools. Drop in as `fonts/blurrysite-mask.woff2`, update the `@font-face` src.

### Testing Checklist

- [ ] Masked blur on short text (< 100 chars) — renders as full-width blocks/asterisks
- [ ] Masked blur on long text (> 100 chars) — no truncation, full content masked
- [ ] Reveal (hover mode) — font reverts to page default instantly
- [ ] Reveal (click mode) — same
- [ ] Shadow DOM — blurred elements inside shadow roots render masked
- [ ] Images / video in masked mode — still brightness(0) blocked
- [ ] Copy-paste of masked element — original text appears in clipboard (expected, documented)
- [ ] Layout: no visible reflow vs. gaussian mode on representative pages

---

## 14. Decision Summary

| Question | Answer |
|----------|--------|
| Should we adopt replacement fonts? | **Yes** — removes 100-char cap, cleaner DOM |
| Which font? | **Redacted** for now; custom asterisk font in phase 2 if needed |
| Glyph width risk? | **Medium** — Redacted is full-width by design, minimising surprise reflow |
| Manifest changes needed? | **Yes** — `web_accessible_resources` + font file |
| How many lines of code change? | **~30** (mostly deletions) |
| Reveal mechanism changes? | **No** — existing `:not([data-bl-si-reveal])` works as-is |
| Privacy model change? | **No** — same shoulder-surfer protection |
