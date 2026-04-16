# EMAIL PII Research — Working Plan

## Status: COMPLETE

## Sections to complete

- [x] Section 1: Regex approaches — RFC 5321/5322, HTML5, liberal, strict/spam-filter; grade each
- [x] Section 2: RFC coverage vs practicality — why full-RFC is impractical in content scripts
- [x] Section 3: DOM-specific challenges — split elements, mailto: attrs, input values, aria-label, obfuscation, double-detection
- [x] Section 4: False positive analysis — 10+ real-world FP examples with severity + mitigation
- [x] Section 5: Performance analysis — O(n) safety, backtracking, attribute scan cost, budget
- [x] Section 6: All solutions matrix — 6 approaches with pseudocode, pros/cons, FP rate, perf cost
- [x] Section 7: Recommendation — final combination with exact regexes
- [x] Section 8: Unit test cases — 20+ input/expected pairs

## Key findings (filled as each section completes)

- **Section 1**: Four patterns graded; HTML5-derived wins — O(n) guaranteed, A-grade. RFC full-spec is F (catastrophic backtracking via alternation inside `+`). Liberal form 1 (`[^\s@]+`) is C (moderate backtrack risk). Strict form with lookbehind is B+.
- **Section 2**: RFC edge cases (quoted strings, IP literals, comments) cover <0.2% of real-world web-page emails. All appear inside `<code>`/`<pre>` contexts (eliminated by SKIP_TAGS). Decision: use HTML5-derived pattern with letters-only TLD `[a-zA-Z]{2,24}`.
- **Section 3**: Split-element emails (`<b>user</b>@example.com`) require cross-node DOM surgery — deferred to Phase 2. `mailto:` links handled by a secondary `querySelectorAll` pass (text-node walk first, then attribute scan). Input fields and `aria-label` out of scope Phase 1. Double-detection deduped by checking `a.querySelector('[data-bl-si-pii]')` before attribute pass.
- **Section 4**: 20 FP cases analyzed. Key finding: `@handle` (social), `@org/pkg` (npm scoped), CSS at-rules, Python decorators, SASS all correctly rejected by the pattern (no local part or no TLD dot). Main actual FPs: `pkg@1.2.3` (fixed by letters-only TLD), `git@github.com` (FP — Git remote URL matches), `report@2024-01-15.pdf` (fixed by letters-only TLD). Most FPs eliminated by `[a-zA-Z]{2,24}` TLD requirement.
- **Section 5**: Pattern is provably O(n) — single character class `+` for local part, bounded `{0,61}` quantifiers for domain labels. `includes('@')` pre-filter skips 99%+ of text nodes. Full page scan: ~220µs typical, ~10ms for a 500-email contact directory. `querySelectorAll` for `mailto:` links: <1ms. Element-level join 3-5× more expensive. `innerText` approach: disqualified (forces layout reflow).
- **Section 6**: Six solutions analyzed with pseudocode, pros/cons, FP rate, and performance cost. Solutions 1 (text-node regex) + 2 (mailto: querySelectorAll) recommended for Phase 1. Solution 3 (element-level join) deferred. Solutions 4 (sibling join) and 5 (innerText) rejected. Solution 6 (mailto: index as precision boost) optional.
- **Section 7**: Final regex: `/[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-](?:\.?[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-])*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}/g`. Key changes from RESEARCH_PII_DETECTION.md baseline: TLD enforced as letters-only `{2,24}`, local-part restructured to prevent leading/trailing/consecutive dots structurally.
- **Section 8**: 29 test cases specified across true positives, true negatives, and edge cases. Notable edge case: `a..b@example.com` — consecutive dots cause local-part to stop at `a`, so only `b@example.com` is matched (documented). Trailing sentence period correctly not consumed into TLD.
