# SSN PII Research — Working Plan

## Status: COMPLETE

## Sections to complete

- [x] Section 1: SSN format taxonomy + structure rules
      Key finding: 9 distinct formats; F1 (dash) covers >90%; F4 (bare) too noisy for default;
      F5/F6 (masked ***-**-NNNN) are common on SSA/HR portals and should be detected.
      Mixed separators (F3) intentionally excluded — FP cost exceeds FN recovery.

- [x] Section 2: Regex approaches
      Key finding: 3-pattern composite recommended (Pattern B formatted + Pattern E masked +
      Pattern D context-labeled). Pattern C (bare) never default — expose as SSN_BARE opt-in key.
      All patterns are ReDoS-safe (no nested quantifiers).

- [x] Section 3: Structural validation (invalid SSN ranges)
      Key finding: isValidSSN() rejects area=000/666/900+, group=00, serial=0000, plus 4 famous
      example SSNs (123-45-6789, 219-09-9999, 078-05-1120, 457-55-4562). O(1) cost.
      Post-2011 SSA randomization means geographic area-code filtering is unreliable — do NOT use.

- [x] Section 4: DOM-specific challenges
      Key finding: 10 DOM contexts analyzed. Critical limitations: input values (no text nodes),
      SSNs split across sibling elements, PDF canvas layer, aria-label attributes.
      Pattern D (labeled) requires label+digits in same text node — Pattern B is always needed alongside.

- [x] Section 5: False positive analysis
      Key finding: Pattern B (formatted) FP rate ~1–3% — ZIP+4, EIN, and phone formats do NOT
      collide with NNN-NN-NNNN grouping. Product codes in NNN-NN-NNNN format are the main FP vector.
      Pattern C (bare) FP rate 70–95% — unacceptable for default use.

- [x] Section 6: All solutions matrix
      Key finding: Approach C (Pattern B + E + D + structural validation) recommended.
      Approach D (includes bare 9-digit) has 20–40% FP rate — never default.

- [x] Section 7: Recommendation
      Key finding: Default SSN = Pattern B + E + D + isValidSSN(). Add SSN_BARE as separate
      opt-in key in DEFAULT_SETTINGS.AUTO_DETECT with popup warning. Exact implementation
      (copy-paste ready functions) provided in SSN.md §7.3.

- [x] Section 8: Unit test cases
      Key finding: 38 test cases defined across 6 categories: TP formatted (8), TP masked (5),
      TN format rejection (7), TN structural validation (10), boundary/edge (10), SSN_BARE mode (4).

## Key findings

1. The NNN-NN-NNNN dash/space pattern is nearly unique to SSNs — ZIP+4 (5+4), EIN (2+7), and phone (3+3+4) all have different groupings. Default FP rate <1–3%.
2. Bare 9-digit detection is a separate concern requiring its own opt-in key (SSN_BARE). Do not conflate with the formatted SSN pattern.
3. Masked SSNs (***-**-NNNN) appear commonly on SSA, HR, and tax portals — worth detecting with Pattern E.
4. Context-labeled pattern (Pattern D) adds coverage of bare-digit SSNs when they appear next to "SSN:", "Social Security:", or "TIN:" labels. Low FP cost, medium FN recovery.
5. Post-2011 SSA randomization invalidates geographic area-code rules for new SSNs — do not use those as FP filters.
6. Four specific example/stolen SSNs must be hardcoded as rejected: 123-45-6789, 219-09-9999, 078-05-1120, 457-55-4562.
7. All five regex patterns are safe from catastrophic backtracking (no nested quantifiers).
