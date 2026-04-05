# CSS Blur Research Report

Comprehensive research across 6 areas: rendering pipeline, cross-browser compatibility,
performance, DOM interactions, security/privacy, and visual blur types + AI bypass.

---

## 1. Rendering Pipeline

### Where blur happens: Paint → Composite (never Layout)

- **Chromium**: Skia image filter, GPU if element is layer-promoted, CPU otherwise
- **Firefox**: WebRender (Rust, GPU by default), CPU fallback rare
- **WebKit/Safari**: Core Animation layers on Apple (always GPU)

### Stacking context: always created

Any `filter` value other than `none` creates a stacking context AND a containing block
for `position: fixed/sticky` descendants. Even `filter: blur(0px)` creates one.
`filter: none` fully undoes it. All browsers conform to spec.

### GPU vs CPU

| Engine | GPU by default? | Trigger for GPU |
|---|---|---|
| Chromium | Only if layer-promoted | `will-change`, animation, heuristics |
| Firefox | Yes (WebRender) | Always |
| WebKit | Yes (Apple platforms) | Always |

### `will-change: filter` verdict

**Removing it was correct.** It pre-promotes layers (permanent VRAM cost) but
PrivacyBlur uses static toggle, not animation. Memory savings outweigh the
potential one-frame jank on first blur.

### Repaint vs recomposite

| Change | Cost |
|---|---|
| Adding/removing blur | Full repaint + layer tree change |
| Changing blur radius (element on own layer) | Recomposite only (cheap) |
| Blur radius animated | Recomposite only (GPU compositor thread) |

---

## 2. Cross-Browser Compatibility

### `-webkit-filter` is unnecessary

All MV3 target browsers support unprefixed `filter: blur()`. The prefix provides
zero benefit for Chrome 88+, Firefox 109+, Safari 15.4+.

### Blur on form elements

All browsers blur form elements visually. **Firefox quirk**: native `<select>`
dropdown popup is NOT blurred (rendered by OS compositor).

### Blur on `<body>`/`<html>`

Works but breaks `position: fixed` (elements scroll with page). Avoid.

### `position: sticky` inside blurred parent

**Broken** in all browsers (spec behavior) — same root cause as `position: fixed`.
Not documented in our Known Limitations — should add.

### Print behavior

Blur is rendered in print in all browsers. Correct for a privacy extension.

### Mobile

Chrome Android doesn't support extensions. Firefox Android works fine.
iOS Safari doesn't support WebExtensions. Mobile is largely irrelevant.

---

## 3. Performance

### Blur radius cost: linear, not quadratic

Browsers use multi-pass box blur (3 passes of 1D blur) approximating Gaussian.
Cost is O(r) not O(r²). Default 8px is well within "free" zone.

### Scaling bottleneck: compositing layers, not blur computation

| N Elements | Risk |
|---|---|
| 10 | None |
| 100 | Low |
| 500 | Medium — possible frame drops |
| 1000 | High — will cause jank |

Each blurred element = own compositing layer = GPU texture memory.

### Transition: fine for single elements, bad for bulk

Do NOT add `transition: filter` to `.pb-blurred` — simultaneous transitions on
hundreds of elements cause severe jank. Current approach (no transition on bulk
blur) is correct.

### Alternative techniques worth exploring

| Technique | For | Benefit |
|---|---|---|
| `text-shadow` trick | Text-only elements | Zero compositing layers, excellent perf |
| Pixelation (`image-rendering: pixelated`) | Images | Cheaper than Gaussian, more secure |
| `contain: paint` on `.pb-blurred` | All | Reduces repaint invalidation |

### Avoid

- `content-visibility: auto` — flash of unblurred content (privacy violation)
- WebGL shader blur — no way to get DOM content into WebGL texture
- Canvas blur for non-video — too slow

---

## 4. DOM Interactions

### Pointer events: unaffected

Clicks register correctly on blurred elements. Blur visual bleed beyond the box
is NOT clickable.

### Text selection: blurred text IS selectable and copyable

Clipboard receives raw unblurred text. **Recommend adding `user-select: none`
to `.pb-blurred`** to prevent casual copy (still bypassable via DevTools).

### Find-in-page (Ctrl+F): matches blurred text

Browser find locates and scrolls to blurred text. Known limitation to document.

### Focus outlines: blurred with the element

Potential WCAG 2.4.7 concern. Focus indicators become invisible on blurred elements.

### `::before`/`::after`: always blurred with parent

Cannot selectively un-blur pseudo-elements. The filter applies to entire rendered output.

### Shadow DOM: blur penetrates

Blur on shadow host blurs all shadow tree content (open AND closed).

### `<iframe>`: visual blur works regardless of origin

CSS `filter` on an `<iframe>` element blurs its content visually. No cross-origin
violation because it operates at compositing level.

### `contenteditable`: remains functional

Users can type into blurred fields. Caret is blurred but input works.

### Transitions: use `blur(0px)` not `none`

`filter: none` → `blur(8px)` may not animate smoothly. `blur(0px)` → `blur(8px)` does.

---

## 5. Security & Privacy

### CSS blur is NOT security — it's visual deterrence

| Access method | Blurred content readable? |
|---|---|
| `element.textContent` / `innerText` | Yes — fully readable |
| Clipboard (Ctrl+C) | Yes — raw text copied |
| Screen readers (JAWS, NVDA, VoiceOver) | Yes — fully announced |
| DevTools Elements panel | Yes — fully visible |
| Browser extensions (any with host permission) | Yes — full DOM access |
| Find-in-page (Ctrl+F) | Yes — matches and scrolls |
| `html2canvas` / `dom-to-image` | Often unblurred (re-renders DOM) |
| Screenshot / screen recording / screen share | Blurred (captures compositor output) |

### Blur radius recovery thresholds

| Radius | Human OCR | Tesseract OCR | ML deblurring (SOTA) |
|---|---|---|---|
| 1-3px | Readable | Readable | Fully recoverable |
| 4-6px | Difficult | Fails on body text | Partially recoverable |
| 7-10px | Unreadable | Fails | Low success, high hallucination |
| 12-15px | Unreadable | Fails | Very low success |
| 20px+ | Unreadable | Fails | Computationally infeasible |

**Our default of 8px is at the low end of "secure against OCR."**
Recommend minimum 10px, recommend 20px+ for sensitive data.

### GDPR/HIPAA: CSS blur alone is insufficient

- Not considered adequate technical protection (data remains in DOM)
- Acceptable as supplementary visual safeguard for screen sharing
- Must never be the sole protection mechanism

### Screen sharing captures blur

Zoom, Teams, Meet, WebRTC — all capture the composited visual output.
CSS blur IS effective against screen-sharing-based visual observation.

---

## 6. Visual Blur Types & AI Resistance

### 15 blur types analyzed

| Type | AI Resistance | CSS Support | Best For |
|---|---|---|---|
| Gaussian (low σ) | LOW | Native | General use (current) |
| Gaussian (high σ≥15) | MODERATE | Native | Upgraded default |
| Box blur | LOW | Approximate | Not recommended |
| Motion blur | LOW | None | Not applicable |
| Median blur | **HIGH** | None (Canvas) | High security |
| Bilateral blur | **HIGH** | None (Canvas) | Edge cases |
| **Pixelation (k≥16)** | **VERY HIGH** | **CSS + Canvas** | **Best option** |
| Frosted glass | HIGH | SVG filters | Alternative visual style |
| **Pixelation + noise** | **VERY HIGH** | **Canvas** | **Maximum security** |

### Why pixelation > Gaussian blur for privacy

1. **Quantifiable**: k×k pixelation destroys information by exactly k² factor
2. **Nyquist guarantee**: frequencies above 1/(2k) are permanently gone
3. **AI-resistant**: super-resolution at k≥16 produces hallucinations, not recovery
4. **Proven**: research shows pixelation resists ML recovery better than equivalent Gaussian

### AI deblurring models and what they can reverse

| Model | Year | Defeats Gaussian σ≤ | Defeats Pixelation k≤ |
|---|---|---|---|
| DeblurGAN-v2 | 2019 | ~5 | ~4 |
| Restormer | 2022 | ~8 | ~6 |
| NAFNet | 2022 | ~8 | ~6 |
| CodeFormer (faces) | 2022 | ~12 | ~8 |
| DiffBIR | 2023 | ~10 | ~8 |

### Techniques that defeat AI deblurring

| Technique | Effectiveness | Web implementable? |
|---|---|---|
| Pixelation k≥16 | Very high | CSS + Canvas (trivial) |
| Blur + noise injection | Very high | Canvas |
| Multi-pass (Gaussian → median) | High | Canvas |
| Blur + color quantization | High | Canvas + CSS |
| Frosted glass (displacement + blur) | High | SVG filters |
| Channel-independent blur | High | Canvas |
| Randomized per-character transforms | High (text) | Canvas |

### Real-world incidents of blur/pixelation reversal

- 2007: Interpol reversed a face swirl (geometric transform, not blur — fully reversible)
- 2016: UT Austin researchers de-anonymized faces from k=4-8 pixelation via CNN
- 2018: Bishop Fox "Unredacter" reversed pixelated text via brute-force character matching
- 2020: "Depix" tool recovers text from pixelated screenshots using lookup tables
- 2023: Diffusion models recover faces from moderate blur using learned face priors

**Pattern**: attacks succeed when blur is linear, content has strong priors
(faces/text/plates), and strength is below irrecoverability threshold.

---

## 7. Actionable Recommendations for PrivacyBlur

### Immediate (CSS changes)

1. **Remove `-webkit-filter`** from all CSS rules — unnecessary for MV3 targets
2. **Add `user-select: none`** to `.pb-blurred` — prevents casual text copy
3. **Add `contain: paint`** to `.pb-blurred` — reduces repaint invalidation
4. **Raise default `BLUR_RADIUS`** from 8 to 10 — below 8px, OCR can still read text
5. **Add `position: sticky` breakage** to Known Limitations documentation

### Medium-term (new features)

6. **Add pixelation mode** as user preference — more secure than Gaussian blur,
   trivially implementable via Canvas downscale + nearest-neighbor upscale for images
7. **Add noise injection option** for maximum security — Canvas-based post-processing
8. **Add `aria-hidden="true"` option** for blurred elements — prevents screen reader leakage

### Long-term (architecture)

9. **Explore `text-shadow` trick** for TEXT category — zero compositing layers,
   excellent performance for text-heavy pages
10. **Implement frosted glass mode** via SVG `feTurbulence` + `feDisplacementMap` —
    AI-resistant alternative visual style
11. **Hybrid approach**: pixelation for images, Gaussian blur for text/structure —
    best of both worlds
