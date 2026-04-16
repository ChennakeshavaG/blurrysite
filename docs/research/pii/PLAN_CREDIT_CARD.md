# CREDIT_CARD PII Research — Working Plan

## Status: COMPLETE

## Sections completed
- [x] Section 1: Format taxonomy + IIN ranges — Visa/MC/Amex/Discover/Diners/JCB/UnionPay/Maestro; masked last-4; tokenized strings (Stripe `tok_live_*`) explicitly excluded
- [x] Section 2: Luhn algorithm — full step-by-step, complete JS implementation, ~10% of random 16-digit strings pass (key FP baseline), 5 test PANs per network
- [x] Section 3: Regex approaches — 5 patterns (generic, per-network, separator-constrained, digit-only+Luhn, masked-last-4); separator class `[\s\u00A0\-\.]` recommended
- [x] Section 4: DOM-specific challenges — masked last-4 (design decision: yes detect, separate pattern), split-cell table PANs (accept miss Phase 1), tokenized IDs (prefix exclusion), Amex 4-6-5 grouping (own regex), mixed separators (reject)
- [x] Section 5: False positive analysis — 12+ categories; EAN-13 barcodes do NOT pass standard Luhn (EAN uses different variant — key finding); phone numbers almost never pass Luhn
- [x] Section 6 + 7: Solutions matrix — (regex + Luhn + IIN) combinations with FP/FN/perf ratings
- [x] Section 8: Recommended approach — Pattern D (digit extraction) + Luhn (mandatory) + IIN (optional default-on); separate masked-last-4 pattern; full implementation
- [x] Section 9: Unit test cases — 25+ cases; Luhn-fail cases, Amex grouping, IIN boundaries, EAN-13 test

## Key appendices
- Appendix A: Implementation checklist
- Appendix B: IIN range maintenance notes
- Appendix C: Separator character reference (including `\u2009` figure space)
