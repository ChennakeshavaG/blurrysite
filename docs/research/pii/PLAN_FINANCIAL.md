# FINANCIAL PII Research — Working Plan

## Status: COMPLETE

## Sections completed
- [x] Section 1: Sensitive vs non-sensitive — regex alone cannot distinguish; context signals are mandatory; design decision: Tier 1 (label-anchored) is the only safe default
- [x] Section 2: Format taxonomy — 10 currency symbol prefixes, 6 code suffixes, US/EU/Swiss/Indian number formats, abbreviated (K/M/B/L), negative/parenthetical, range/per-unit
- [x] Section 3: Regex approaches — 7 patterns graded; Pattern F (abbreviated `$NM/B/K`) and Pattern G (parenthetical `($N)`) are high-confidence signals; Pattern A (any currency) fires on every e-commerce page
- [x] Section 4: Context signals — strong labels (Balance/Salary/Portfolio/etc.), weak labels (Total/Amount), anti-signals (Price/Cost/Add to Cart); 6 detection approaches (look-behind, parent text, sibling element, CSS class, microdata, ARIA role)
- [x] Section 5: DOM-specific challenges — financial table rows (sibling scan solves), dashboard cards, SVG `<text>` nodes (worth scanning), EU format ambiguity (unresolvable without locale), multi-currency forex pages (known high-FP)
- [x] Section 6: False positive analysis — 15+ categories; e-commerce is the primary FP source; `/month` and `/year` are reliable anti-signals
- [x] Section 7: Threshold-based filtering — `parseAmount()` function for K/M/B multipliers; tier thresholds ($10/$100/$1K/$10K) with FP rate estimates per tier
- [x] Section 8: All solutions matrix — (Pattern × Context × Threshold) combinations with FP rate on Amazon vs. bank dashboard
- [x] Section 9: Recommendation — 3 tiers (Safe/Moderate/Aggressive); Tier 1 default; full Phase 1 detection flow in Appendix C
- [x] Section 10: Unit test cases — 20+ cases with tier1/tier2/tier3 match columns

## Key appendices
- Appendix A: Label regex reference (strong + weak + anti-signals)
- Appendix B: Price suppressor reference (anti-signal patterns)
- Appendix C: Full Phase 1 detection flow pseudocode
