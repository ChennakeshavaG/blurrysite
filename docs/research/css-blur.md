# CSS Blur Research — Key Findings

> Full research covered rendering pipeline, cross-browser compat, performance, DOM interactions, security, and AI resistance.

---

## Stacking Context Side Effects

Any `filter` value (including `blur(0px)`) creates a stacking context + containing block for `position: fixed/sticky` descendants. This is spec-compliant, all browsers. Known limitations in CLAUDE.md cover `fixed`; `sticky` should also be documented.

---

## Security Boundaries

CSS blur is **visual deterrence, not security**. The DOM content is always readable:

| Access method | Readable through blur? |
|---|---|
| `element.textContent` / DevTools | Yes |
| Clipboard (Ctrl+C) | Yes — add `user-select: none` to prevent casual copy |
| Screen readers | Yes — announced in full |
| Find-in-page (Ctrl+F) | Yes — matches and scrolls to blurred text |
| `html2canvas` / `dom-to-image` | Often unblurred (re-renders DOM) |
| Screenshot / screen share | **Blurred** — captures compositor output |

GDPR/HIPAA: not adequate technical protection alone. Acceptable as supplementary visual safeguard for screen sharing.

---

## Blur Radius vs Recoverability

| Radius | Human OCR | Tesseract | ML deblurring (SOTA) |
|---|---|---|---|
| 1–6px | Readable / difficult | Fails on body text | Partially recoverable |
| 7–10px | Unreadable | Fails | Low success |
| 12–15px | Unreadable | Fails | Very low |
| 20px+ | Unreadable | Fails | Computationally infeasible |

Default 8px is marginal. Minimum recommended: 10px. For sensitive data: 20px+.

---

## AI Resistance by Blur Type

| Type | AI Resistance | CSS Support |
|---|---|---|
| Gaussian low σ | Low | Native |
| Gaussian σ≥15 | Moderate | Native |
| Frosted glass (SVG displacement) | High | SVG filters |
| Pixelation k≥16 | **Very high** | CSS + Canvas |
| Pixelation + noise | **Very high** | Canvas |

Pixelation at k≥16 is the strongest option — information destroyed by k² factor, Nyquist-guaranteed, resists diffusion-model recovery.

---

## Open Recommendations

| Item | Status |
|---|---|
| Remove `-webkit-filter` | Should be done — unnecessary for MV3 |
| `user-select: none` on `.bl-si-blurred` | Not done — prevents casual copy |
| `contain: paint` on `.bl-si-blurred` | Not done — reduces repaint scope |
| Raise default blur radius to 10px | Not done |
| Add `position: sticky` to Known Limitations | Not done |
| Pixelation mode as user option | Not done — future feature |
| `aria-hidden="true"` option for blurred elements | Not done — prevents screen reader leakage |
