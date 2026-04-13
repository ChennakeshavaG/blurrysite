# Blurry Site — Comprehensive Test Plan

Generated: 2026-04-12
Baseline: 469 unit tests, all green.

---

## A. Committed Bugfixes — Manual Validation

### A1. Reveal Hover on pointer-events:none (0de33b2 + 5f4093c)

- [ ] **A1.1** SVG avatar peek (WhatsApp) — Open WhatsApp Web → Blur All → hover over chat avatar (SVG) → Avatar unblurs on hover
- [ ] **A1.2** Nested blurred child peek — Blur All → hover a container div whose children are blurred → Children reveal via descendant scan
- [ ] **A1.3** React SPA stopPropagation — Test on any React SPA (WhatsApp, Teams) → Blur All → hover elements → Capture-phase listeners fire, reveal works
- [ ] **A1.4** No false positive deep peek — Blur All → hover a `<nav>` or `<section>` → Should NOT reveal deeply nested text (BFS depth limit = 3)
- [ ] **A1.5** Rapid hover in/out — Quickly sweep mouse across many blurred elements → No stuck reveals, no console errors

### A2. SVG in MEDIA Category (36f4bc1)

- [ ] **A2.1** Inline SVG blurred — Page with inline `<svg>` → Blur All with MEDIA on → SVG elements are blurred
- [ ] **A2.2** Extension filter SVG excluded — Blur All with frosted mode → `#bl-si-svg-filters` is NOT blurred
- [ ] **A2.3** `<picture>` no double-blur — Page with `<picture><img>` → Blur All → Only `<img>` blurred, no double effect

### A3. UX Polish (309e787)

- [ ] **A3.1** Transition speed — Blur an element → hover to reveal → Transition feels snappy (150ms), not sluggish
- [ ] **A3.2** Popup width stable — Open popup → click Settings accordion → open/close → No width jerk or scrollbar jump
- [ ] **A3.3** Tooltip text — Open popup → hover Blur Look setting → Shows "Standard is a simple blur. Frosted scrambles..."

### A4. i18n Warnings (e3c6450)

- [ ] **A4.1** Missing key warns — Introduce typo in a `t()` call → reload → `console.warn("missing key: ...")` fires once
- [ ] **A4.2** Warn dedup — Same missing key referenced 5x → Only 1 console.warn
- [ ] **A4.3** Locale switch clears cache — Switch language in popup → New locale's missing keys surface fresh

---

## B. New Modules — Unit Test Gaps to Fill

### B1. PII Detector (24 tests exist — needs edge case hardening)

- [ ] **B1.1** Overlapping email in URL — `user@example.com/path` — should detect email, not break on path
- [ ] **B1.2** PII inside `<input>` value — Should NOT scan form inputs (privacy)
- [ ] **B1.3** PII inside `<script>`/`<style>` — Must skip non-visible elements
- [ ] **B1.4** Very long text node (10k chars) — Performance — no hang
- [ ] **B1.5** Unicode in financial amounts — `₹1,00,000` (Indian format) vs `$1,000,000`
- [ ] **B1.6** MutationObserver + SPA nav — Dynamic content injection triggers re-scan
- [ ] **B1.7** Double-scan idempotency — `scan()` twice on same DOM → same match count, no double wrapping
- [ ] **B1.8** Clear then re-scan — `clear()` → `scan()` → matches should re-appear

### B2. Auto-Blur (13 tests — needs integration scenarios)

- [ ] **B2.1** Idle → blur → activity → unblur cycle — Full round-trip with callbacks
- [ ] **B2.2** Tab switch while idle timer running — Timer should pause or reset on visibility change
- [ ] **B2.3** Config change mid-session — Disable `AUTO_BLUR_IDLE` while idle — should unblur
- [ ] **B2.4** Both tab-switch + idle enabled — Verify no double-blur or race

### B3. Blur Timer (9 tests — needs boundary cases)

- [ ] **B3.1** Timer at 0 minutes — Should be no-op, not start
- [ ] **B3.2** Timer at 480 (max) — Should work, not overflow
- [ ] **B3.3** Timer + manual unblur — User unblurs manually before timer expires — timer should stop
- [ ] **B3.4** Timer restart — Change timer while active — old timer replaced

### B4. Screenshot (7 tests — needs error paths)

- [ ] **B4.1** Capture on restricted page — `chrome://` or `about:` page — graceful error
- [ ] **B4.2** Clipboard API unavailable — Fallback behavior or clear error
- [ ] **B4.3** Crop below 10x10 threshold — Should cancel silently
- [ ] **B4.4** Device pixel ratio != 1 — Crop coordinates scaled correctly

### B5. Selection Blur (19 tests — add cross-range cases)

- [ ] **B5.1** Selection spanning multiple elements — `<p>hel[lo</p><p>wor]ld</p>` — cross-element range
- [ ] **B5.2** Selection inside already-blurred element — Should still wrap (double blur is CSS-safe)
- [ ] **B5.3** Selection with mixed inline elements — `<p>hello <strong>bo[ld</strong> te]xt</p>`

### B6. Tab Privacy (15 tests — add restoration edge cases)

- [ ] **B6.1** Dynamic title change while active — SPA changes `document.title` — should privacy still hold?
- [ ] **B6.2** Multiple enable/disable cycles — State must be clean after 10 toggles
- [ ] **B6.3** Page with no `<head>` — Favicon link creation in edge case DOM

---

## C. New Blur Modes — Integration Tests

### C1. Redacted Mode

- [ ] **C1.1** Text element redacted — Set mode to Redacted → Blur All → Text replaced with solid black blocks
- [ ] **C1.2** Custom redaction color — Set `REDACTION_COLOR` to `#FF0000` → Blur All → Red blocks
- [ ] **C1.3** Media in redacted mode — Image/video with redacted mode → `filter: brightness(0)` — pure black
- [ ] **C1.4** Invalid hex color rejected — Set `REDACTION_COLOR` to `"banana"` → Validation rejects, keeps default `#000000`

### C2. Masked Mode

- [ ] **C2.1** Text masked with asterisks — Set mode to Masked → Blur All → Text hidden, `***` shown via `::after`
- [ ] **C2.2** Asterisk count matches text length — Element with "Hello" (5 chars) → Shows 5 asterisks (capped at 100)
- [ ] **C2.3** Mask attribute cleanup — Unblur element → `data-bl-si-mask-text` removed
- [ ] **C2.4** Media in masked mode — Image with masked mode → `filter: brightness(0)` (same as redacted)

---

## D. Cross-Feature Integration

- [ ] **D1** All features enabled simultaneously — Auto-blur + timer + PII + tab privacy + redacted mode — no crashes
- [ ] **D2** PII detection + selection blur — Detect PII, then also manually select + blur nearby text — no DOM conflict
- [ ] **D3** Auto-blur idle + blur timer — Both expire — which wins? No double-unblur
- [ ] **D4** Screenshot while PII wrapped — Captured image should show PII spans blurred
- [ ] **D5** Tab privacy + popup status query — `GET_STATUS` message returns correct state with tab privacy active
- [ ] **D6** Mode switch with active blurs — Switch Gaussian → Redacted → Masked with elements blurred — clean transitions

---

## E. Regression Checklist (existing features)

- [ ] **E1** Dynamic blur (click element) — Pick an element → blurred → unblur via popup
- [ ] **E2** Sticky-page zone — Draw zone → scroll → zone scrolls with page
- [ ] **E3** Sticky-screen zone — Draw zone → scroll → zone stays fixed
- [ ] **E4** Blur All toggle — Alt+Shift+B on/off cycle
- [ ] **E5** Keyboard shortcuts — All 3 default shortcuts work
- [ ] **E6** URL rules — Add rule → navigate to matching URL → auto-blur
- [ ] **E7** Settings persistence — Change settings → close popup → reopen → settings retained
- [ ] **E8** Cross-tab restore — Blur items on tab → navigate away → navigate back → items restored

---

## Progress Tracker

| Section | Total | Done | Status |
|---------|-------|------|--------|
| A. Committed Bugfixes | 11 | 0 | Not started |
| B. Unit Test Gaps | 22 | 0 | Not started |
| C. Blur Modes | 8 | 0 | Not started |
| D. Cross-Feature | 6 | 0 | Not started |
| E. Regression | 8 | 0 | Not started |
| **Total** | **55** | **0** | |
