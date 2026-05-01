/**
 * pii/pii_detectors.js — Pattern catalog + match finder.
 *
 * Holds the regex patterns (EMAIL + 5-alternation NUMERIC) and the
 * findMatches(text, types) function that scans a single string for hits.
 * Suppressor calls go through blsi.PiiSuppressors. Phase 3 adds Stage 1
 * dedicated detectors (Card / IBAN / Aadhaar / etc.) and a runDetector helper
 * + consumed[] tracker; Phase 4 adds Stage 2 context-gated detectors.
 *
 * Exposed as blsi.PiiDetectors (IIFE — no ES module syntax).
 */

const BlurrySitePiiDetectors = (() => {
  "use strict";

  // ── Regex patterns ───────────────────────────────────────────────────────
  // /g flag — findMatches clones via new RegExp(re.source, re.flags) to reset
  // lastIndex per call so patterns are safe to share.

  // EMAIL: standard RFC-ish local@domain.tld
  // Pre-filter: only run on text containing '@' to avoid O(n) regex on every node.
  const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

  // NUMERIC: five sub-patterns, order matters — first match at a given position wins.
  //   1. Currency symbol prefix  — $1,234.56  €500  ₹50,000
  //   2. Currency code suffix    — 1234 USD   50000 EUR
  //   3. Comma-grouped thousands — 1,234,567  12,345
  //   4. Space/hyphen digit groups (phone-like) — 111-222-333  792 792  792-792
  //      MUST come before sub-5 so "4111 1111 1111 1111" wraps as ONE span.
  //      Requires ≥2 groups of ≥3 digits each, separated by [ \- ] only.
  //   5. 4+ bare digit sequence  — 17150  account numbers  (catch-all)
  const NUMERIC_RE =
    /[$€£¥₹₩₿₺₨₱฿]\s*\d[\d,.' ]*|\b\d[\d,.' ]*\s*(?:USD|EUR|GBP|JPY|INR|BTC|ETH)\b|\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d{3,}(?:[ \- ]\d{3,})+\b|\b\d{4,}\b/g;

  const PATTERNS = Object.freeze({
    EMAIL: { regex: EMAIL_RE, label: "email" },
    NUMERIC: { regex: NUMERIC_RE, label: "numeric" },
  });

  /**
   * Find all PII matches in a text string for enabled types.
   * Returns [{start, end, type}] sorted by start, overlaps removed (keep first/longest).
   */
  function findMatches(text, types) {
    const matches = [];

    if (types.email && text.includes("@")) {
      // Phase 2: cached regex instance with lastIndex reset (no per-call compile).
      const re = blsi.PiiState.getCachedRegex(EMAIL_RE);
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          type: "email",
        });
        blsi.PiiState.recordEmit();
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    if (types.numeric) {
      // Phase 2: cached regex instance with lastIndex reset.
      const re = blsi.PiiState.getCachedRegex(NUMERIC_RE);
      let m;
      while ((m = re.exec(text)) !== null) {
        blsi.PiiState.recordCandidate();
        if (!blsi.PiiSuppressors.falsePositivesCheck(m[0], text, m.index)) {
          matches.push({
            start: m.index,
            end: m.index + m[0].length,
            type: "numeric",
          });
          blsi.PiiState.recordEmit();
        } else {
          blsi.PiiState.recordSuppress();
        }
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const filtered = [];
    let lastEnd = -1;
    for (const match of matches) {
      if (match.start >= lastEnd) {
        filtered.push(match);
        lastEnd = match.end;
      }
    }
    return filtered;
  }

  function getPatterns() {
    return PATTERNS;
  }

  return Object.freeze({
    EMAIL_RE,
    NUMERIC_RE,
    PATTERNS,
    findMatches,
    getPatterns,
  });
})();

blsi.PiiDetectors = BlurrySitePiiDetectors;
