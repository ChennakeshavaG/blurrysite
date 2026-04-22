# Competitive Gaps — BlurrySite vs Market

> Research date: 2026-04-12. ✓ = implemented in BlurrySite.

## Feature Gap Matrix

| # | Feature | Competitors | BlurrySite | Notes |
|---|---|---|---|---|
| 1 | Smart auto-detect PII | Blur It, DataBlur, Blurrr, DataMask, Privacy Blur | ✓ email + numeric | Phone, CC, SSN not yet done |
| 2 | Selected text blur | BlurWeb, DataBlur, BlurPage, BlurAny | ✓ selection_blur.js | Inline span approach |
| 3 | Text masking / redaction | BlurPage, DataMask, Privacy Blur, Blur It | ✓ redacted + masked modes | Asterisk + solid block |
| 4 | Hide tab title & favicon | BlurWeb, DataBlur, BlurAny | ✓ tab_privacy.js | Replaces title with `…` |
| 5 | Screenshot with masking | DataMask | ✓ screenshot.js | Viewport via captureVisibleTab |
| 6 | Blur presets / profiles | Privacy Blur (premium) | ✗ | Per-site rules are partial substitute |
| 7 | Idle / tab-switch auto-blur | Privacy Blur (premium) | ✓ auto_blur.js | idle + tab-switch triggers |
| 8 | Decoy / fake content mode | Privacy Blur (premium) | ✗ | High complexity, niche use case |
| 9 | Timed / temporary blur | Privacy Blur (premium) | ✓ blur_timer.js | sec/min/hr countdown |
| 10 | Blur URL bar | None (browser limitation) | workaround | Screen-anchored zone at top of viewport |

## Remaining Gaps

- **Blur presets / profiles** — named configs (Demo mode, Recording mode). Medium complexity: named settings objects + profile switcher in popup.
- **Decoy / fake content** — replaces page with plausible fake data. High complexity, niche.
- **Full PII coverage** — Phone, CC, SSN detection not yet implemented.

## BlurrySite's Moat (no competitor has these)

1. Hover-to-peek / click-to-peek reveal
2. 5 toggleable blur categories
3. Per-site URL rules (wildcard + regex) with per-rule overrides
4. Fully customizable keyboard shortcuts with capture UI
5. Frosted / AI-resistant blur mode
6. Screen-anchored (viewport-fixed) blur zones
7. Context menu blur/unblur
8. Multi-language i18n
