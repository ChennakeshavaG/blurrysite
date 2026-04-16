# PHONE PII Research — Working Plan

## Status: COMPLETE

## Sections completed
- [x] Section 1: Format taxonomy — NANP 8 variants, E.164 4 variants, extensions, toll-free, vanity, partial; non-breaking space `\u00A0` documented
- [x] Section 2: Regex approaches — 5 approaches graded (monolithic, array, loose extraction, libphonenumber-js, context-anchored); libphonenumber-js/min (~40 KB) feasible but not recommended for this extension
- [x] Section 3: DOM-specific challenges — `\u00A0` in separators, split-element across spans, `tel:` href attribute path, `<input type="tel">` limitation, vanity numbers
- [x] Section 4: False positive analysis — 15+ categories; order numbers in NANP format are the hardest FP (cannot be eliminated by structure alone — context signal required)
- [x] Section 5: Validation beyond regex — NPA/NXX rules (can't start with 0/1), N11 service codes, 555-0100–0199 fiction reserve, compact `isValidNANP()` function, context signal heuristics
- [x] Section 6: All solutions matrix — precision/recall/perf/complexity for 6 combinations; bare-10-digit as explicit row (FP rate ~70%)
- [x] Section 7: Recommendation — array of 5 targeted regexes + `isValidNANP()` validation; `PHONE_BARE` as separate opt-in flag; no libphonenumber dependency; `tel:` href separate pass
- [x] Section 8: Unit test cases — 25+ cases covering all NANP formats, E.164, extensions, 10+ FP non-matches, `\u00A0` variants

## Key appendices
- Appendix A: NANP NPA N11 service codes
- Appendix B: Toll-free NPA codes (as of 2025)
- Appendix C: Copy-paste artifacts quick reference
- Appendix D: Known limitations
