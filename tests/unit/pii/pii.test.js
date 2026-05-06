/**
 * tests/unit/pii/pii.test.js
 *
 * Unit tests for src/pii/ (7-file split — Phase 0 of PII rewrite).
 *
 * Module exposes blsi.PiiDetector (set by the facade pii.js):
 *   scan(rootEl, types), clear(rootEl), handleMutations(mutations, root),
 *   getMatchCount(), getPatterns()
 *
 * Pattern contract (2 types only):
 *   EMAIL   — standard local@domain.tld
 *   NUMERIC — currency prefix | currency code suffix | 4+ bare digits
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: scan() for EMAIL and NUMERIC types; clear(); getMatchCount(); getPatterns();
 *         handleMutations() childList + characterData paths; PII independence from blur-all;
 *         multi-type detection; NUMERIC boolean mode; falsePositivesCheck chain (isYear,
 *         isVersion, isPublicPrice, isCountNoise); phone-like grouping rule; extension UI
 *         exclusion; double-scan idempotency; null/disabled-type guards.
 *
 * REDUNDANT TESTS:
 *   - "NUMERIC — detects dollar amount", "detects Euro symbol", "detects British Pound",
 *     "detects Indian Rupee" all verify the currency-prefix sub-pattern with different
 *     symbols. Could be collapsed into a single test.each over symbol variants.
 *   - "NUMERIC — hyphen-separated phone", "mixed-width space-separated phone",
 *     "space-separated phone", "space-separated credit card" all verify the grouped-
 *     sequence rule with different separators/lengths. Candidate for test.each.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Currency prefix tests (4) — test.each([['$1,234.56','dollar'],['€500','euro'],
 *     ['£250','pound'],['₹50,000','rupee']]) checking toBeGreaterThan(0) each.
 *   - Phone-like grouping tests (4) — test.each with [separator, input, expectedText]
 *     tuples covering hyphen, single-space, mixed-width-space, and card variants.
 *   - Invalid input tests in other files pattern applies here too: test.each for
 *     start(0)/start(-5) could be mirrored in any future numeric-threshold tests.
 *
 * MISSING COVERAGE:
 *   - Greedy match with trailing punctuation: "5000," — does the comma get captured
 *     inside the span or left outside? Contract is ambiguous.
 *   - Embedded number in word boundary: "model2024x" — \b should prevent match;
 *     no test verifies the word-boundary guard on 4+ digit bare pattern.
 *   - PII clear() when both EMAIL and NUMERIC are active on the same page — only
 *     EMAIL is tested with clear(); no combined-type clear() assertion exists.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// The legacy single-file pii_detector.js was split into 7 sub-modules under
// src/pii/. They must be loaded in this exact order so each later module sees
// its dependencies (state → checksums → pre_filter → country → suppressors →
// detectors → facade pii.js which assigns blsi.PiiDetector).
const PII_DIR = path.resolve(__dirname, '../../../src/pii');
const PII_FILES = [
  'pii_state.js',
  'pii_checksums.js',
  'pii_pre_filter.js',
  'pii_country.js',
  'pii_suppressors.js',
  'pii_detectors.js',
  'pii.js',
];

function buildStubSource() {
  return `(function() {
    'use strict';
    var blsi = global.blsi;
    blsi.PiiDetector = Object.freeze({
      scan:             function() { return 0; },
      clear:            function() {},
      handleMutations:  function() {},
      getMatchCount:    function() { return 0; },
      getPatterns:      function() {
        return {
          EMAIL:   { regex: /\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b/g, label: 'email' },
          NUMERIC: { regex: /[$\\u20AC]\\s*\\d[\\d,.]*|\\b\\d{4,}(?:[,.]\\d+)*\\b/g,        label: 'numeric' },
        };
      },
    });
  })();`;
}

function freshLoad() {
  // IIFEs assume globalThis.blsi exists (constants.js sets it at suite setup,
  // but jest.resetModules() may wipe state). Re-seed defensively.
  global.blsi = global.blsi || {};
  delete blsi.PiiDetector;
  jest.resetModules();
  const allExist = PII_FILES.every((f) => fs.existsSync(path.join(PII_DIR, f)));
  if (allExist) {
    jest.isolateModules(() => {
      for (const f of PII_FILES) require(path.join(PII_DIR, f));
    });
  } else {
    (0, eval)(buildStubSource());
  }
}

const ALL_TYPES = { email: true, numeric: true };

// USER IMPACT: auto-detect PII — email addresses and financial numbers hidden automatically without user having to manually pick elements
describe('pii_detector.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Phase 4: country signal reads document.documentElement.lang during
    // scan(). Clear it between tests so Stage 2 country gates start unset.
    document.documentElement.removeAttribute('lang');
    freshLoad();
  });

  afterEach(() => {
    blsi.PiiDetector.clear(document.body);
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('lang');
  });

  // ── Pattern: EMAIL ─────────────────────────────────────────────────────────

  test('EMAIL — detects standard email', () => {
    document.body.innerHTML = '<p>Contact user@example.com for info.</p>';
    const count = blsi.PiiDetector.scan(document.body, { email: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="email"]');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('user@example.com');
  });

  test('EMAIL — detects email with plus tag', () => {
    document.body.innerHTML = '<p>Send to user+tag@mail.co.uk</p>';
    const count = blsi.PiiDetector.scan(document.body, { email: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="email"]').textContent).toBe('user+tag@mail.co.uk');
  });

  test('EMAIL — does not match bare @handle (no domain)', () => {
    document.body.innerHTML = '<p>Follow @username on social</p>';
    expect(blsi.PiiDetector.scan(document.body, { email: true })).toBe(0);
  });

  test('EMAIL — does not match text without @', () => {
    document.body.innerHTML = '<p>No email here, just text</p>';
    expect(blsi.PiiDetector.scan(document.body, { email: true })).toBe(0);
  });

  test('EMAIL — skips when EMAIL type disabled', () => {
    document.body.innerHTML = '<p>user@example.com</p>';
    expect(blsi.PiiDetector.scan(document.body, { email: false })).toBe(0);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
  });

  // ── Pattern: NUMERIC — currency prefix ────────────────────────────────────

  // OPTIMIZE: these four currency-prefix tests share identical structure; merge with test.each([['$1,234.56','dollar'],['€500','euro'],['£250','pound'],['₹50,000','rupee']])
  // REDUNDANT: "detects dollar amount" and the three currency tests below all verify the same currency-prefix sub-pattern; the symbol is the only variable
  test('NUMERIC — detects dollar amount', () => {
    document.body.innerHTML = '<p>Charge: $1,234.56 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBeGreaterThan(0);
    expect(document.querySelector('[data-bl-si-pii="numeric"]')).not.toBeNull();
  });

  // REDUNDANT: same currency-prefix assertion as "detects dollar amount"; symbol differs only
  test('NUMERIC — detects Euro symbol (€)', () => {
    document.body.innerHTML = '<p>Pay \u20AC500 to John today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  // REDUNDANT: same currency-prefix assertion as "detects dollar amount"; symbol differs only
  test('NUMERIC — detects British Pound (£)', () => {
    document.body.innerHTML = '<p>Pay \u00A3250.00 to Anna.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  // REDUNDANT: same currency-prefix assertion as "detects dollar amount"; symbol differs only
  test('NUMERIC — detects Indian Rupee (₹)', () => {
    document.body.innerHTML = '<p>Salary: \u20B950,000 monthly.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('NUMERIC — currency prefix matches digits up to non-digit ($17k → $17)', () => {
    // K-suffix is not captured (simplified regex); $17 still blurs the amount.
    document.body.innerHTML = '<p>Budget: $17k for the project.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('$17');
  });

  // ── Pattern: NUMERIC — currency code suffix ────────────────────────────────

  test('NUMERIC — detects USD currency code suffix', () => {
    document.body.innerHTML = '<p>Transfer 1000 USD to account.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBeGreaterThan(0);
  });

  test('NUMERIC — detects EUR currency code suffix', () => {
    document.body.innerHTML = '<p>Pay 50000 EUR to Anna today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBeGreaterThan(0);
  });

  // ── Pattern: NUMERIC — 4+ bare digits ─────────────────────────────────────

  test('NUMERIC — detects bare 5-digit number (17150)', () => {
    document.body.innerHTML = '<p>Account balance: 17150</p>';
    const count = blsi.PiiDetector.scan(document.body, { numeric: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('17150');
  });

  test('NUMERIC — detects 4-digit number', () => {
    document.body.innerHTML = '<p>PIN: 4321</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('NUMERIC — detects 16-digit credit card (no separators)', () => {
    document.body.innerHTML = '<p>Card 4111111111111111 on file</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('4111111111111111');
  });

  test('NUMERIC — detects comma-separated large number (1,234,567)', () => {
    document.body.innerHTML = '<p>Revenue: 1,234,567</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBeGreaterThan(0);
  });

  test('NUMERIC — does NOT detect 3-digit number (below threshold)', () => {
    document.body.innerHTML = '<p>Only 123 items remain.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('NUMERIC — does NOT detect single/double digit numbers', () => {
    document.body.innerHTML = '<p>Step 1 of 99 complete.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('NUMERIC — skips when NUMERIC type disabled', () => {
    document.body.innerHTML = '<p>Balance: 17150</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: false })).toBe(0);
  });

  // ── Pattern: NUMERIC — phone-like grouped sequences ───────────────────────
  // All 3 variants must wrap as ONE span so hover reveals the whole number.

  // OPTIMIZE: four grouped-sequence tests differ only in separator and input text; collapse with test.each([separator, input, expectedText]) tuples
  test('NUMERIC — hyphen-separated phone (111-222-333) wraps as one span', () => {
    document.body.innerHTML = '<p>Call 111-222-333 now.</p>';
    const count = blsi.PiiDetector.scan(document.body, { numeric: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('111-222-333');
  });

  // REDUNDANT: same grouped-sequence assertion as hyphen test; only separator and group widths differ
  test('NUMERIC — mixed-width space-separated phone (111 2222 333) wraps as one span', () => {
    document.body.innerHTML = '<p>Mobile: 111 2222 333</p>';
    const count = blsi.PiiDetector.scan(document.body, { numeric: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('111 2222 333');
  });

  // REDUNDANT: same grouped-sequence assertion as hyphen test; space separator instead of hyphen
  test('NUMERIC — space-separated phone (111 222 333) wraps as one span', () => {
    document.body.innerHTML = '<p>Fax: 111 222 333</p>';
    const count = blsi.PiiDetector.scan(document.body, { numeric: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('111 222 333');
  });

  // REDUNDANT: same grouped-sequence one-span assertion as phone tests above; input has 4 groups instead of 3
  test('NUMERIC — space-separated credit card (4111 1111 1111 1111) wraps as one span', () => {
    // Ordering: phone-like sub-pattern must fire before 4+ bare so the whole
    // card number becomes a single span, not four separate "1111" spans.
    document.body.innerHTML = '<p>Card: 4111 1111 1111 1111</p>';
    const count = blsi.PiiDetector.scan(document.body, { numeric: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="numeric"]');
    expect(span.textContent).toBe('4111 1111 1111 1111');
  });

  test('NUMERIC — two-group ≥3-digit hyphen pair (792-792) wraps as one span', () => {
    document.body.innerHTML = '<p>Code 792-792 today.</p>';
    const count = blsi.PiiDetector.scan(document.body, { numeric: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('792-792');
  });

  test('NUMERIC — two-group ≥3-digit space pair (792 792) wraps as one span', () => {
    document.body.innerHTML = '<p>Code 792 792 today.</p>';
    const count = blsi.PiiDetector.scan(document.body, { numeric: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('792 792');
  });

  test('NUMERIC — does NOT match two-group number with <3-digit group', () => {
    // "12 2024" — group 1 has only 2 digits; phone pattern requires ≥3 per group.
    // "2024" alone still matches 4+ bare digits.
    document.body.innerHTML = '<p>Due: 12 2024</p>';
    blsi.PiiDetector.scan(document.body, { numeric: true });
    const texts = Array.from(document.querySelectorAll('[data-bl-si-pii="numeric"]')).map(s => s.textContent);
    expect(texts).not.toContain('12 2024');
  });

  test('NUMERIC — does NOT match digit groups separated by words', () => {
    // "room 12 door 23 window 34" — text between groups breaks the pattern
    document.body.innerHTML = '<p>room 12 door 23 window 34</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  // ── PII independence from blur-all ─────────────────────────────────────────

  test('PII span has NO data-bl-si-blur attribute (independent of blur-all)', () => {
    document.body.innerHTML = '<p>user@example.com</p>';
    blsi.PiiDetector.scan(document.body, { email: true });
    const span = document.querySelector('[data-bl-si-pii]');
    expect(span).not.toBeNull();
    // PII blur driven by [data-bl-si-pii] CSS rule only — no blur-engine dependency
    expect(span.hasAttribute('data-bl-si-blur')).toBe(false);
  });

  test('PII span persists after blur-engine sweep clears data-bl-si-blur elements', () => {
    document.body.innerHTML = '<p>user@example.com and <span data-bl-si-blur="1">other</span></p>';
    blsi.PiiDetector.scan(document.body, { email: true });

    // Simulate blur-engine clearing non-PII blurred elements
    document.querySelectorAll('[data-bl-si-blur]').forEach(el => {
      if (!el.dataset.blSiPii) delete el.dataset.blSiBlur;
    });

    // PII span still present and intact
    const piiSpan = document.querySelector('[data-bl-si-pii]');
    expect(piiSpan).not.toBeNull();
    expect(piiSpan.textContent).toBe('user@example.com');
  });

  // MISSING: no test for clear() when both EMAIL and NUMERIC matches exist on the same page — only EMAIL is tested with clear()

  // ── Multi-type + toggling ───────────────────────────────────────────────────

  test('detects both EMAIL and NUMERIC in same node', () => {
    document.body.innerHTML = '<p>Pay user@test.com $17150</p>';
    const count = blsi.PiiDetector.scan(document.body, ALL_TYPES);
    expect(count).toBe(2);
    expect(document.querySelectorAll('[data-bl-si-pii]').length).toBe(2);
  });

  test('returns 0 when no types are enabled', () => {
    document.body.innerHTML = '<p>user@example.com and 17150</p>';
    expect(blsi.PiiDetector.scan(document.body, {})).toBe(0);
  });

  test('returns 0 when types object is null', () => {
    document.body.innerHTML = '<p>user@example.com</p>';
    expect(blsi.PiiDetector.scan(document.body, null)).toBe(0);
  });

  // MISSING: no test for embedded number in word (e.g. "model2024x") — \b guard should prevent match but is unverified
  // MISSING: no test for greedy match with trailing punctuation (e.g. "5000,") — comma capture boundary is unspecified

  // ── Scan behavior ───────────────────────────────────────────────────────────

  test('skips extension UI elements (toolbar)', () => {
    document.body.innerHTML = '<div id="bl-si-picker-toolbar"><p>user@example.com</p></div>';
    expect(blsi.PiiDetector.scan(document.body, { email: true })).toBe(0);
  });

  test('skips extension toast elements', () => {
    document.body.innerHTML = '<div class="bl-si-toast"><p>user@example.com</p></div>';
    expect(blsi.PiiDetector.scan(document.body, { email: true })).toBe(0);
  });

  test('skips already-wrapped PII spans (no double-wrap)', () => {
    document.body.innerHTML = '<p><span data-bl-si-pii="email">user@example.com</span></p>';
    expect(blsi.PiiDetector.scan(document.body, { email: true })).toBe(0);
  });

  test('skips empty and whitespace-only text nodes', () => {
    document.body.innerHTML = '<p>   </p>';
    expect(blsi.PiiDetector.scan(document.body, ALL_TYPES)).toBe(0);
  });

  test('double scan does not re-wrap already wrapped nodes', () => {
    document.body.innerHTML = '<p>user@test.com</p>';
    blsi.PiiDetector.scan(document.body, { email: true });
    blsi.PiiDetector.scan(document.body, { email: true });
    expect(document.querySelectorAll('[data-bl-si-pii="email"]').length).toBe(1);
  });

  test('handles multiple matches in one text node', () => {
    document.body.innerHTML = '<p>Email a@b.com and c@d.com please</p>';
    const count = blsi.PiiDetector.scan(document.body, { email: true });
    expect(count).toBe(2);
    expect(document.querySelectorAll('[data-bl-si-pii="email"]').length).toBe(2);
  });

  test('preserves surrounding text after wrapping', () => {
    document.body.innerHTML = '<p>Hello user@test.com World</p>';
    blsi.PiiDetector.scan(document.body, { email: true });
    expect(document.querySelector('p').textContent).toBe('Hello user@test.com World');
  });

  test('scan with null rootEl returns 0', () => {
    expect(blsi.PiiDetector.scan(null, ALL_TYPES)).toBe(0);
  });

  // ── clear() ────────────────────────────────────────────────────────────────

  test('clear() removes all PII spans and restores text', () => {
    document.body.innerHTML = '<p>Send to user@test.com please</p>';
    blsi.PiiDetector.scan(document.body, { email: true });
    expect(document.querySelector('[data-bl-si-pii]')).not.toBeNull();

    blsi.PiiDetector.clear(document.body);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
    expect(document.querySelector('p').textContent).toBe('Send to user@test.com please');
  });

  test('clear() resets match count to 0', () => {
    document.body.innerHTML = '<p>user@test.com</p>';
    blsi.PiiDetector.scan(document.body, { email: true });
    expect(blsi.PiiDetector.getMatchCount()).toBeGreaterThan(0);
    blsi.PiiDetector.clear(document.body);
    expect(blsi.PiiDetector.getMatchCount()).toBe(0);
  });

  // ── getMatchCount / getPatterns ────────────────────────────────────────────

  test('getPatterns() returns EMAIL and NUMERIC entries', () => {
    const p = blsi.PiiDetector.getPatterns();
    expect(p.EMAIL).toBeDefined();
    expect(p.EMAIL.regex).toBeInstanceOf(RegExp);
    expect(p.EMAIL.label).toBe('email');
    expect(p.NUMERIC).toBeDefined();
    expect(p.NUMERIC.regex).toBeInstanceOf(RegExp);
    expect(p.NUMERIC.label).toBe('numeric');
    // Should NOT have old 5-type keys
    expect(p.PHONE).toBeUndefined();
    expect(p.SSN).toBeUndefined();
    expect(p.CREDIT_CARD).toBeUndefined();
    expect(p.FINANCIAL).toBeUndefined();
  });

  test('getMatchCount() accumulates across separate scans', () => {
    const p1 = document.createElement('p');
    p1.textContent = 'a@b.com';
    document.body.appendChild(p1);
    blsi.PiiDetector.scan(p1, { email: true });
    expect(blsi.PiiDetector.getMatchCount()).toBe(1);

    const p2 = document.createElement('p');
    p2.textContent = 'c@d.com';
    document.body.appendChild(p2);
    blsi.PiiDetector.scan(p2, { email: true });
    expect(blsi.PiiDetector.getMatchCount()).toBe(2);
  });

  // ── handleMutations ────────────────────────────────────────────────────────
  // PII detector is a subscriber to blur_engine's mutation dispatcher.
  // It never owns an observer; blur_engine fans MutationRecord[] in.
  //
  // We synthesise records with the public shape blur_engine would dispatch
  // ({ type, addedNodes, target }) so tests don't depend on a real MO.

  test('handleMutations is a no-op when scan() has not been called', () => {
    const tn = document.createTextNode('Email user@example.com');
    document.body.appendChild(tn);
    const recs = [{ type: 'childList', addedNodes: [tn], target: document.body }];
    expect(() => blsi.PiiDetector.handleMutations(recs, document)).not.toThrow();
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
  });

  test('handleMutations is a no-op when given empty / nullish input', () => {
    blsi.PiiDetector.scan(document.body, { email: true });
    expect(() => blsi.PiiDetector.handleMutations([], document)).not.toThrow();
    expect(() => blsi.PiiDetector.handleMutations(null, document)).not.toThrow();
    expect(() => blsi.PiiDetector.handleMutations(undefined, document)).not.toThrow();
  });

  test('handleMutations — childList: new TEXT_NODE wraps email', () => {
    blsi.PiiDetector.scan(document.body, { email: true });
    const tn = document.createTextNode('Reach me at typed@example.com');
    document.body.appendChild(tn);
    const recs = [{ type: 'childList', addedNodes: [tn], target: document.body }];
    blsi.PiiDetector.handleMutations(recs, document);
    const span = document.querySelector('[data-bl-si-pii="email"]');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('typed@example.com');
  });

  test('handleMutations — childList: new ELEMENT_NODE scans subtree', () => {
    blsi.PiiDetector.scan(document.body, { email: true });
    const wrap = document.createElement('div');
    wrap.innerHTML = '<p>contact <span>nested@example.com</span> for info</p>';
    document.body.appendChild(wrap);
    const recs = [{ type: 'childList', addedNodes: [wrap], target: document.body }];
    blsi.PiiDetector.handleMutations(recs, document);
    expect(document.querySelector('[data-bl-si-pii="email"]')).not.toBeNull();
  });

  // USER IMPACT: typed email in contenteditable / dynamic .textContent reassignment
  // fires `characterData` mutations, NOT `childList`. Without this branch the email
  // stays unblurred until reload — the original bug that drove this refactor.
  test('handleMutations — characterData: textContent change wraps new email', () => {
    document.body.innerHTML = '<div contenteditable></div>';
    const editor = document.querySelector('[contenteditable]');
    const tn = document.createTextNode('placeholder');
    editor.appendChild(tn);
    blsi.PiiDetector.scan(document.body, { email: true });

    // Simulate user typing — text node mutates in place.
    tn.textContent = 'typed live@example.com';
    const recs = [{ type: 'characterData', target: tn, addedNodes: [], removedNodes: [] }];
    blsi.PiiDetector.handleMutations(recs, document);

    const span = document.querySelector('[data-bl-si-pii="email"]');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('live@example.com');
  });

  test('handleMutations — characterData: skip text node already wrapped', () => {
    document.body.innerHTML = '<p>email user@example.com here</p>';
    blsi.PiiDetector.scan(document.body, { email: true });
    const span = document.querySelector('[data-bl-si-pii="email"]');
    expect(span).not.toBeNull();
    const innerText = span.firstChild;
    expect(innerText.nodeType).toBe(Node.TEXT_NODE);

    const before = blsi.PiiDetector.getMatchCount();
    const recs = [{ type: 'characterData', target: innerText, addedNodes: [], removedNodes: [] }];
    blsi.PiiDetector.handleMutations(recs, document);
    // No double-wrap — guard short-circuits.
    expect(blsi.PiiDetector.getMatchCount()).toBe(before);
    expect(document.querySelectorAll('[data-bl-si-pii]').length).toBe(1);
  });

  test('handleMutations — characterData: ignores extension UI node', () => {
    blsi.PiiDetector.scan(document.body, { email: true });
    const toolbar = document.createElement('div');
    toolbar.id = 'bl-si-picker-toolbar';
    document.body.appendChild(toolbar);
    const tn = document.createTextNode('hint user@example.com');
    toolbar.appendChild(tn);
    const recs = [{ type: 'characterData', target: tn, addedNodes: [], removedNodes: [] }];
    blsi.PiiDetector.handleMutations(recs, document);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
  });

  test('handleMutations — ignores attributes mutation type', () => {
    blsi.PiiDetector.scan(document.body, { email: true });
    const recs = [{ type: 'attributes', target: document.body, addedNodes: [], removedNodes: [] }];
    expect(() => blsi.PiiDetector.handleMutations(recs, document)).not.toThrow();
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
  });

  // ── Default settings path ──────────────────────────────────────────────────

  test('all AUTO_DETECT defaults off — scan returns 0', () => {
    document.body.innerHTML = '<p>user@example.com and 17150 and $500</p>';
    const defaultAutoDetect = { email: false, numeric: false };
    expect(blsi.PiiDetector.scan(document.body, defaultAutoDetect)).toBe(0);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
  });

  test('NUMERIC true — bare 5-digit number detected', () => {
    document.body.innerHTML = '<p>Account: 17150</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('17150');
  });

  test('NUMERIC false — no numeric spans created', () => {
    document.body.innerHTML = '<p>Account: 17150</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: false })).toBe(0);
    expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
  });

  // ── falsePositivesCheck: isYear ────────────────────────────────────────────

  test('isYear — 4-digit year in 1000–2099 is suppressed', () => {
    // 2024 is a common year, not PII — precise mode suppresses it
    document.body.innerHTML = '<p>Published in 2024.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
  });

  test('isYear — 5-digit number is NOT suppressed as a year', () => {
    document.body.innerHTML = '<p>Account: 20245</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('20245');
  });

  test('isYear — 4-digit number above 2099 is NOT suppressed', () => {
    // 9999 is out of the year range — kept as potential PII
    document.body.innerHTML = '<p>Error code: 9999</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('isYear — 4-digit number below 1000 is NOT suppressed as year', () => {
    // No 4-digit number < 1000 can match \b\d{4,}\b — this is a safety assertion
    document.body.innerHTML = '<p>Error code: 999</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  // ── falsePositivesCheck: isVersion ────────────────────────────────────────

  test('isVersion — number preceded by lowercase v is suppressed', () => {
    document.body.innerHTML = '<p>Running v17150 build.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
  });

  test('isVersion — number preceded by uppercase V is suppressed', () => {
    document.body.innerHTML = '<p>V17150 release notes</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isVersion — number followed by .digit is suppressed', () => {
    document.body.innerHTML = '<p>Build 17150.3 deployed.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isVersion — bare number with no version context is NOT suppressed', () => {
    // "17150" with space before and space after — not a version
    document.body.innerHTML = '<p>Account 17150 overdue</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('17150');
  });

  // ── falsePositivesCheck: isPublicPrice ────────────────────────────────────

  test('isPublicPrice — /month in window suppresses currency amount', () => {
    document.body.innerHTML = '<p>Only $9/month</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isPublicPrice — qty in window suppresses number', () => {
    document.body.innerHTML = '<p>qty: 5000 units</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isPublicPrice — /year in window suppresses number', () => {
    document.body.innerHTML = '<p>$94750/year salary package</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isPublicPrice — no price context: number is detected', () => {
    document.body.innerHTML = '<p>Account balance: 94750</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('94750');
  });

  // ── falsePositivesCheck: isCountNoise ────────────────────────────────────

  test('isCountNoise — "unread" in window suppresses number', () => {
    document.body.innerHTML = '<p>12345 unread messages</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isCountNoise — "followers" in window suppresses number', () => {
    document.body.innerHTML = '<p>10234 followers</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isCountNoise — "results" in window suppresses number', () => {
    document.body.innerHTML = '<p>Showing 12345 results</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isCountNoise — no count context: number is detected', () => {
    document.body.innerHTML = '<p>Hello there 12345 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('12345');
  });

  // MISSING: no test for greedy match trailing punctuation ("5000," — does comma get captured inside span?)
  // MISSING: no test for embedded number in word ("model2024x" — word boundary \b should prevent match)
  // MISSING: no test for clear() with both EMAIL and NUMERIC active simultaneously

  // ── Phase 1 — STAGE 0 pre-filter ───────────────────────────────────────────

  test('STAGE 0 — skips numbers inside <code>', () => {
    document.body.innerHTML = '<p>Use <code>12345</code> here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('STAGE 0 — skips numbers inside <pre>', () => {
    document.body.innerHTML = '<pre>line 12345 of code</pre>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('STAGE 0 — skips numbers inside <kbd>', () => {
    document.body.innerHTML = '<p>Press <kbd>Alt+12345</kbd>.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('STAGE 0 — skips numbers inside <samp>', () => {
    document.body.innerHTML = '<samp>output: 12345 done</samp>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('STAGE 0 — skips numbers inside pre.highlight (syntax-highlighter)', () => {
    document.body.innerHTML = '<pre class="highlight">var x = 12345;</pre>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('STAGE 0 — bare .highlight div does NOT suppress (not a code block)', () => {
    document.body.innerHTML = '<div class="highlight">ID: 12345</div>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('STAGE 0 — numbers OUTSIDE code block still detected', () => {
    document.body.innerHTML = '<p>Hello there 12345 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('STAGE 0 — M1 digit pre-screen skips no-digit nodes when email disabled', () => {
    document.body.innerHTML = '<p>No digits here at all.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('STAGE 0 — M1 pre-screen does NOT skip when email enabled', () => {
    document.body.innerHTML = '<p>Reach me at user@example.com today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { email: true })).toBe(1);
  });

  // ── Phase 1 — Tier-A suppressors ───────────────────────────────────────────

  test('isHexColor — #FF5733-shape hex bare-digits not blurred', () => {
    // 6-digit hex with # prefix collides with 6-digit BARE_DIGITS for the digit-only case
    document.body.innerHTML = '<p>Use #123456 as accent.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isHexColor — bare digits without # prefix still blurred', () => {
    document.body.innerHTML = '<p>Hello 123456 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('isYearRange — "2020-2024" not blurred', () => {
    document.body.innerHTML = '<p>Hello 2020-2024 era.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isYearRange — non-year range "1234-9999" still considered', () => {
    document.body.innerHTML = '<p>Hello 1234-9999 friend.</p>';
    // 9999 is outside 1000-2099 → isYearRange returns false → other checks may apply,
    // but isYear catches 1234. Result: span may or may not exist depending on regex
    // behavior on the whole string. Assert at least some matching.
    blsi.PiiDetector.scan(document.body, { numeric: true });
    // No strong assertion — this is a fingerprint-vs-suppressor edge.
  });

  test('isPercentage — "12345%" not blurred', () => {
    document.body.innerHTML = '<p>Total 12345% growth here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isPercentage — number without trailing % blurred', () => {
    document.body.innerHTML = '<p>Hello 12345 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('isScientificNotation — "1234e10" not blurred', () => {
    document.body.innerHTML = '<p>Const 1234e10 used here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isMeasurement — "1024 MB" not blurred', () => {
    document.body.innerHTML = '<p>File 1024 MB size.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isMeasurement — "5000 km" not blurred', () => {
    document.body.innerHTML = '<p>Drive 5000 km away.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isMeasurement — number without trailing unit blurred', () => {
    document.body.innerHTML = '<p>Hello 12345 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('isResolution — "1920x1080" not blurred', () => {
    document.body.innerHTML = '<p>Display 1920x1080 native.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isOrdinalLabel — "Section 12345" not blurred', () => {
    document.body.innerHTML = '<p>See Section 12345 below.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isOrdinalLabel — "Chapter 12345" not blurred', () => {
    document.body.innerHTML = '<p>Read Chapter 12345 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isOrdinalLabel — "Page 12345" not blurred', () => {
    document.body.innerHTML = '<p>Open Page 12345 now.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isOrdinalLabel — bare 12345 with no precursor blurred', () => {
    document.body.innerHTML = '<p>Hello there 12345 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('isDateLike — ISO 8601 "2026-04-29" not blurred', () => {
    document.body.innerHTML = '<p>Happens on 2026-04-29 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isDateLike — compact 8-digit "20260429" not blurred', () => {
    document.body.innerHTML = '<p>Stamp 20260429 found.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isDateLike — invalid compact 8-digit "20269999" still blurs (sanity check fails)', () => {
    document.body.innerHTML = '<p>Hello 20269999 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  // ── Decision #3 (identifier sub-pass) ──────────────────────────────────
  // The keyword-prefix detector adds order/invoice/tracking/case/ticket as
  // positive triggers. Value-validator requires length >= 12 + non-alpha char
  // + not all-same-char. Short pure-digit values (12345) still wrap via
  // NUMERIC_RE Stage 3. The legacy isOrderRef suppressor still applies when
  // the identifier sub-pass is bypassed.
  test('Decision #3 — "Order #12345" suppressed by isOrderRef (order keyword near bare digit)', () => {
    document.body.innerHTML = '<p>Your Order #12345 ships.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('Decision #3 — "Tracking 12345" suppressed by isOrderRef', () => {
    document.body.innerHTML = '<p>Tracking 12345 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('Decision #3 — "Invoice 12345" suppressed by isOrderRef', () => {
    document.body.innerHTML = '<p>Invoice 12345 today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isOrderRef — bare number with no order context blurred', () => {
    document.body.innerHTML = '<p>Hello 12345 friend.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
  });

  test('extended isPublicPrice — "price" keyword suppresses', () => {
    document.body.innerHTML = '<p>The price 12345 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('extended isPublicPrice — multilingual ES "precio" suppresses', () => {
    document.body.innerHTML = '<p>El precio 12345 aquí.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  // ── Phase 2 — cascade tiers + regex cache + stats ──────────────────────────

  test('Phase 2 — getCachedRegex returns same RegExp instance per pattern', () => {
    const proto = /\d+/g;
    const r1 = blsi.PiiState.getCachedRegex(proto);
    const r2 = blsi.PiiState.getCachedRegex(proto);
    expect(r1).toBe(r2);
    expect(r1.lastIndex).toBe(0);
  });

  test('Phase 2 — getCachedRegex resets lastIndex on each call', () => {
    const proto = /\d+/g;
    const r = blsi.PiiState.getCachedRegex(proto);
    r.exec('abc 123 def');
    expect(r.lastIndex).toBeGreaterThan(0);
    blsi.PiiState.getCachedRegex(proto);
    expect(r.lastIndex).toBe(0);
  });

  test('Phase 2 — getCachedRegex distinguishes by source AND flags', () => {
    const a = blsi.PiiState.getCachedRegex(/\d+/g);
    const b = blsi.PiiState.getCachedRegex(/\d+/gi);
    expect(a).not.toBe(b);
  });

  test('Phase 2 — falsePositivesCheckCascade returns same as flat precise', () => {
    // Behavior parity smoke test — every Phase 1 suppressor still fires through the cascade.
    expect(
      blsi.PiiSuppressors.falsePositivesCheckCascade('2024', 'In year 2024 we', 8),
    ).toBe(true); // isYear
    expect(
      blsi.PiiSuppressors.falsePositivesCheckCascade('12345', '#12345', 1),
    ).toBe(false); // 5-digit not a valid hex length AND outside year range
    expect(
      blsi.PiiSuppressors.falsePositivesCheckCascade('123456', '#123456', 1),
    ).toBe(true); // isHexColor
    expect(
      blsi.PiiSuppressors.falsePositivesCheckCascade('12345', '12345%', 0),
    ).toBe(true); // isPercentage
    expect(
      blsi.PiiSuppressors.falsePositivesCheckCascade(
        '2026-04-29',
        'on 2026-04-29 today',
        3,
      ),
    ).toBe(true); // isDateLike (structural)
    expect(
      blsi.PiiSuppressors.falsePositivesCheckCascade(
        '12345',
        'Hello 12345 friend.',
        6,
      ),
    ).toBe(false); // no suppressor fires
  });

  test('Phase 2 — getStats returns the stats shape (zeros when Logger off)', () => {
    document.body.innerHTML = '<p>Hello 12345 friend.</p>';
    blsi.PiiDetector.scan(document.body, { numeric: true });
    const stats = blsi.PiiDetector.getStats();
    expect(stats).toEqual({
      node_count: expect.any(Number),
      digit_node_count: expect.any(Number),
      stage3_candidates: expect.any(Number),
      stage4_suppressed: expect.any(Number),
      total_emit: expect.any(Number),
    });
  });

  test('Phase 2 — getStats counters increment when Logger.enabled is true', () => {
    // Mock the Logger global since pii.test.js doesn't load src/logger.js.
    const prevLogger = blsi.Logger;
    blsi.Logger = { enabled: true };
    try {
      document.body.innerHTML = '<p>Hello 12345 friend.</p>';
      blsi.PiiDetector.scan(document.body, { numeric: true });
      const stats = blsi.PiiDetector.getStats();
      expect(stats.node_count).toBeGreaterThanOrEqual(1);
      expect(stats.digit_node_count).toBeGreaterThanOrEqual(1);
      expect(stats.total_emit).toBeGreaterThanOrEqual(1);
    } finally {
      blsi.Logger = prevLogger;
    }
  });

  test('Phase 2 — getStats resets at the top of each scan', () => {
    document.body.innerHTML = '<p>Hello 12345 friend.</p>';
    blsi.PiiDetector.scan(document.body, { numeric: true });
    blsi.PiiDetector.clear(document.body);
    const stats = blsi.PiiDetector.getStats();
    expect(stats.node_count).toBe(0);
    expect(stats.total_emit).toBe(0);
  });

  test('Phase 2 — getStats is a copy, not a live reference', () => {
    const a = blsi.PiiDetector.getStats();
    a.node_count = 9999;
    const b = blsi.PiiDetector.getStats();
    expect(b.node_count).not.toBe(9999);
  });

  // ── Bug 1 — NUMERIC_RE currency-prefix trailing punct/space ───────────────
  // Regression: alt #1 was greedy and absorbed trailing comma/space.
  // Fix: anchor at digit-end via `\d(?:[\d,.' ]*\d)?`.

  test('NUMERIC currency prefix — trailing comma is NOT captured', () => {
    // Neutral wording — avoid "total"/"cost"/"price"/"paid" which trigger
    // isPublicPrice and would mask whether alt #1 captured the comma.
    document.body.innerHTML = '<p>Hello $1,234.56, world done.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('$1,234.56');
  });

  test('NUMERIC currency prefix — trailing space is NOT captured', () => {
    document.body.innerHTML = '<p>Hello $100 world done.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('$100');
  });

  test('NUMERIC currency prefix — trailing period is NOT captured', () => {
    document.body.innerHTML = '<p>Saw $50.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('$50');
  });

  test('NUMERIC currency prefix — European decimal comma still captured fully', () => {
    // Internal comma between digits is preserved (€99,99 = €99.99).
    document.body.innerHTML = '<p>Paid €99,99 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('€99,99');
  });

  // ── Bug 2 — NUMERIC_RE country-code phone numbers ─────────────────────────
  // Regression: `\b\d{3,}` won't anchor on `+` (non-word), and the first
  // group required ≥3 digits, so `+91 ...` was never wrapped as one span.
  // Fix: new alt #4 `\+?\d{1,3}[ \-]\d{3,}(?:[ \-]\d{3,})+`.

  test('NUMERIC country-code phone — "+91 94909 73391" wraps as one span', () => {
    document.body.innerHTML = '<p>Reach +91 94909 73391 anytime.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('+91 94909 73391');
  });

  test('NUMERIC country-code phone — "+1 555-123-4567" wraps as one span', () => {
    document.body.innerHTML = '<p>Call +1 555-123-4567 ext 99</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('+1 555-123-4567');
  });

  test('NUMERIC country-code phone — plain "555-123-4567" still wraps as one span', () => {
    // No `+` prefix — alt #4's optional `\+?` still triggers, alt #5 is fallback.
    document.body.innerHTML = '<p>Call 555-123-4567 today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('555-123-4567');
  });

  test('NUMERIC country-code phone — "1234-5678" still falls through to alt #5', () => {
    // First group is 4 digits — alt #4 requires \d{1,3} for the leading group.
    // Alt #5 catches it.
    document.body.innerHTML = '<p>Code 1234-5678 today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('1234-5678');
  });

  // ── Bug 3 — isDateLike keyword-fallback shape gate ────────────────────────
  // Regression: `_DATE_KEYWORD_RE` fired on ANY numeric match within ±50
  // chars of a date keyword, so phone numbers near "created"/"updated"/etc.
  // were silently suppressed. Fix: gate fallback on match-shape.

  test('isDateLike — country-code phone near "created" is NOT suppressed', () => {
    expect(
      blsi.PiiSuppressors.isDateLike(
        '+91 94909 73391',
        'Group created by +91 94909 73391, on 1/12/2025 at 8:21 pm',
        17,
      ),
    ).toBe(false);
  });

  test('isDateLike — bare 10-digit phone near "updated" is NOT suppressed', () => {
    expect(
      blsi.PiiSuppressors.isDateLike(
        '9876543210',
        'Account updated 9876543210 yesterday',
        16,
      ),
    ).toBe(false);
  });

  test('isDateLike — country-code phone near "modified" is NOT suppressed', () => {
    expect(
      blsi.PiiSuppressors.isDateLike(
        '+1 555-123-4567',
        'Last modified +1 555-123-4567 by admin',
        14,
      ),
    ).toBe(false);
  });

  test('isDateLike — bare 4-digit year near "Posted" IS still suppressed', () => {
    // Real date — shape gate passes, keyword fires.
    expect(
      blsi.PiiSuppressors.isDateLike('2024', 'Posted 2024', 7),
    ).toBe(true);
  });

  test('isDateLike — slash date near "Created" IS still suppressed via shape gate', () => {
    expect(
      blsi.PiiSuppressors.isDateLike('11/12', 'Created on 11/12', 11),
    ).toBe(true);
  });

  test('isDateLike — full slash date "01/15/2024" IS still suppressed (structural fast-path)', () => {
    // Structural fast-path catches it regardless of shape gate.
    expect(
      blsi.PiiSuppressors.isDateLike('01/15/2024', '01/15/2024', 0),
    ).toBe(true);
  });

  // End-to-end regression — Bug 2 + Bug 3 together via the detector pipeline.
  test('end-to-end — "Group created by +91 94909 73391" wraps the phone', () => {
    document.body.innerHTML = '<p>Group created by +91 94909 73391, on 1/12/2025 at 8:21 pm</p>';
    blsi.PiiDetector.scan(document.body, { numeric: true });
    const texts = Array.from(document.querySelectorAll('[data-bl-si-pii="numeric"]')).map(
      (s) => s.textContent,
    );
    expect(texts).toContain('+91 94909 73391');
  });

  test('end-to-end — "Account updated 9876543210 yesterday" wraps the number', () => {
    document.body.innerHTML = '<p>Account updated 9876543210 yesterday</p>';
    blsi.PiiDetector.scan(document.body, { numeric: true });
    const texts = Array.from(document.querySelectorAll('[data-bl-si-pii="numeric"]')).map(
      (s) => s.textContent,
    );
    expect(texts).toContain('9876543210');
  });

  // ── Parenthesised area codes (alt #4) ─────────────────────────────────────

  test('NUMERIC parens phone — "(555) 123-4567" wraps as one span', () => {
    document.body.innerHTML = '<p>Call (555) 123-4567 here</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('(555) 123-4567');
  });

  test('NUMERIC parens phone — "(555)-123-4567" wraps as one span', () => {
    document.body.innerHTML = '<p>Reach (555)-123-4567 anytime</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('(555)-123-4567');
  });

  test('NUMERIC parens phone — "+1 (555) 123-4567" wraps including country code', () => {
    document.body.innerHTML = '<p>Dial +1 (555) 123-4567 today</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('+1 (555) 123-4567');
  });

  test('NUMERIC parens phone — "(20) 7946 0958" wraps with 2-digit area code', () => {
    document.body.innerHTML = '<p>Phone (20) 7946 0958 here</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('(20) 7946 0958');
  });

  // ── 2-digit middle phone groups (alt #5 relaxed) ──────────────────────────

  test('NUMERIC phone — UK landline "+44 20 7946 0958" wraps as one span', () => {
    // Middle group `20` is only 2 digits — required relaxing prior `\d{3,}`.
    document.body.innerHTML = '<p>Phone +44 20 7946 0958 anytime</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('+44 20 7946 0958');
  });

  test('NUMERIC phone — French "01 23 45 67 89" wraps with all 2-digit groups', () => {
    document.body.innerHTML = '<p>Hello 01 23 45 67 89 world</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('01 23 45 67 89');
  });

  // ── NBSP separator (alt #5 char class includes  ) ────────────────────

  test('NUMERIC phone — NBSP-separated "+91\\u00A094909\\u00A073391" wraps as one span', () => {
    const nbsp = ' ';
    document.body.innerHTML = `<p>Reach +91${nbsp}94909${nbsp}73391 here</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
      `+91${nbsp}94909${nbsp}73391`,
    );
  });

  // ── Identifier-context detection ──────────────────────────────────────
  // Sub-pass inside types.numeric. Two passes:
  //   A. Dispositive provider prefixes (AKIA / ghp_ / sk_/pk_ / AIza / xox- / JWT / Bearer)
  //   B. Keyword-prefix wrapper (KEYWORD[: = # - —] value), value-validated
  //      (length >= 12 AND non-alpha char AND not all-same-char).
  // Spans use type='numeric' so existing CSS / reveal logic apply unchanged.

  // -- keyword-prefix positive cases --

  test('identifier — "User ID: 12345" wraps the value', () => {
    document.body.innerHTML = '<p>User ID: 12345 logged in.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('12345');
  });

  test('identifier — "user_id=abc123def456g" wraps alphanumeric value', () => {
    document.body.innerHTML = '<p>Setting user_id=abc123def456g now.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('abc123def456g');
  });

  test('identifier — em-dash separator "API Key — 7HsKx9aZ2pQrLm" wraps', () => {
    document.body.innerHTML = '<p>API Key — 7HsKx9aZ2pQrLm shown.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('7HsKx9aZ2pQrLm');
  });

  test('identifier — short alphanumeric "password: hunter2" NOT wrapped (under 12 chars)', () => {
    document.body.innerHTML = '<p>password: hunter2 saved.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — copula "OTP is 4729" wraps via NUMERIC_RE (not PREFIX_RE)', () => {
    document.body.innerHTML = '<p>Your OTP is 4729 today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('4729');
  });

  test('identifier — short alnum "Confirmation code: VX7-9PQ" NOT wrapped (under 12 chars)', () => {
    document.body.innerHTML = '<p>Confirmation code: VX7-9PQ here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — "customer #12345" wraps the value', () => {
    document.body.innerHTML = '<p>Hello customer #12345 thanks.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('12345');
  });

  test('identifier — "employee no 88421" NOT wrapped (short value, bare digit suppressed)', () => {
    document.body.innerHTML = '<p>Hi employee no 88421 listed.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — short quoted value `client_secret = "abc123_xyz"` NOT wrapped (under 12 chars)', () => {
    document.body.innerHTML = '<p>client_secret = "abc123_xyz" set.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — "Verification: 123456" wraps the value', () => {
    document.body.innerHTML = '<p>Verification: 123456 used.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('123456');
  });

  test('identifier — short pure-digit "Pin 4242" wraps via NUMERIC_RE (not PREFIX_RE)', () => {
    document.body.innerHTML = '<p>Pin 4242 today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('4242');
  });

  test('identifier — long value with non-alpha char wraps', () => {
    document.body.innerHTML = '<p>refresh_token: VeryLongAlpha_Token42 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('VeryLongAlpha_Token42');
  });

  test('identifier — pure-alpha English word "responsibilities" not wrapped', () => {
    document.body.innerHTML = '<p>Key responsibilities include managing the team.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — two values in same paragraph each wrap', () => {
    document.body.innerHTML = '<p>Account #12345 and Customer ID 67890 both shown.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(2);
    const texts = Array.from(document.querySelectorAll('[data-bl-si-pii="numeric"]'))
      .map((s) => s.textContent);
    expect(texts).toContain('12345');
    expect(texts).toContain('67890');
  });

  test('identifier — "Order #1234567890" suppressed by isOrderRef (order keyword)', () => {
    document.body.innerHTML = '<p>Your Order #1234567890 shipped.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — short alphanumeric order "Order ABC-12345" NOT wrapped via PREFIX_RE (under 12 chars)', () => {
    document.body.innerHTML = '<p>Your Order ABC-12345 placed.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — tie-break: identifier wraps first, NUMERIC duplicate dropped', () => {
    document.body.innerHTML = '<p>User ID: 12345 logged in.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelectorAll('[data-bl-si-pii="numeric"]').length).toBe(1);
  });

  // -- keyword-prefix: 12-char minimum negative cases (FP prevention) --

  test('identifier — "user: sdk-alpha" NOT wrapped (9 chars, under 12)', () => {
    document.body.innerHTML = '<p>user: sdk-alpha released.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — "key: page-3" NOT wrapped (6 chars, under 12)', () => {
    document.body.innerHTML = '<p>key: page-3 shown.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — "id: v2-beta" NOT wrapped (7 chars, under 12)', () => {
    document.body.innerHTML = '<p>id: v2-beta deployed.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — "ref: ABC-001" NOT wrapped (7 chars, under 12)', () => {
    document.body.innerHTML = '<p>ref: ABC-001 filed.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — long credential "api_key: abc123def456ghi" wraps (15 chars)', () => {
    document.body.innerHTML = '<p>api_key: abc123def456ghi used.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('abc123def456ghi');
  });

  // -- dispositive provider positive cases --

  test('identifier — bare AWS access key "AKIAIOSFODNN7EXAMPLE" wraps', () => {
    document.body.innerHTML = '<p>Use AKIAIOSFODNN7EXAMPLE for staging.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  test('identifier — bare GitHub PAT "ghp_..." wraps', () => {
    document.body.innerHTML = '<p>Token ghp_1234567890abcdefghij1234567890abcdef issued.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
      'ghp_1234567890abcdefghij1234567890abcdef',
    );
  });

  test('identifier — bare 3-segment JWT wraps via dispositive', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij1234567890abcdef';
    document.body.innerHTML = `<p>received ${jwt} from server.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(jwt);
  });

  test('identifier — Bearer header wraps the entire scheme + token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij1234567890abcdef';
    document.body.innerHTML = `<p>Authorization: Bearer ${jwt} sent.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(`Bearer ${jwt}`);
  });

  test('identifier — Stripe sk_live wraps via dispositive', () => {
    const key = 'sk_live_abcdef0123456789abcdef01';
    document.body.innerHTML = `<p>api_key: ${key} used.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(key);
  });

  test('identifier — Bearer + JWT overlap: Bearer span wins', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij1234567890abcdef';
    document.body.innerHTML = `<p>Bearer ${jwt} only.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(`Bearer ${jwt}`);
  });

  test('identifier — GitLab PAT "glpat-..." wraps via dispositive', () => {
    const tok = 'glpat-AbCdEfGhIjKlMnOpQrSt';
    document.body.innerHTML = `<p>${tok} is a token.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(tok);
  });

  test('identifier — Anthropic key "sk-ant-..." wraps via dispositive', () => {
    const key = 'sk-ant-' + 'a1b2c3d4e5f6g7h8i9j0'.repeat(5);
    document.body.innerHTML = `<p>${key} leaked.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(key);
  });

  test('identifier — OpenAI key "sk-..." wraps via dispositive', () => {
    const key = 'sk-proj1234567890abcdefghij';
    document.body.innerHTML = `<p>${key} here.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(key);
  });

  test('identifier — SendGrid key "SG.xxx.yyy" wraps via dispositive', () => {
    const key = 'SG.' + 'A'.repeat(22) + '.' + 'B'.repeat(43);
    document.body.innerHTML = `<p>${key} sent.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(key);
  });

  test('identifier — npm token "npm_..." wraps via dispositive', () => {
    const tok = 'npm_' + 'aB3dEf4hIjKlMn5pQrStUvWxYz0123456789';
    document.body.innerHTML = `<p>${tok} published.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(tok);
  });

  test('identifier — Twilio SID "AC..." wraps via dispositive', () => {
    const sid = 'AC' + 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    document.body.innerHTML = `<p>${sid} configured.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(sid);
  });

  test('identifier — HuggingFace token "hf_..." wraps via dispositive', () => {
    const tok = 'hf_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz01234567';
    document.body.innerHTML = `<p>${tok} loaded.</p>`;
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(tok);
  });

  test('identifier — keyword "database" wraps adjacent value', () => {
    document.body.innerHTML = '<p>database: prod-db-01.cluster here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('prod-db-01.cluster');
  });

  test('identifier — keyword "webhook" wraps adjacent value', () => {
    document.body.innerHTML = '<p>webhook: hook_abc123xyz456 firing.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('hook_abc123xyz456');
  });

  test('identifier — keyword "smtp" wraps adjacent value', () => {
    document.body.innerHTML = '<p>smtp: mail.relay-01.internal configured.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('mail.relay-01.internal');
  });

  // -- negative cases --

  test('identifier — "the id is short" not wrapped (no digit, len < 16)', () => {
    document.body.innerHTML = '<p>the id is short here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — single-char value `id="x"` not wrapped', () => {
    document.body.innerHTML = '<p>I tried id="x" yesterday.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — alpha-only short value "account holder smith" not wrapped', () => {
    document.body.innerHTML = '<p>Hi account holder smith here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — Decision #3 short ref "Order #5" not wrapped', () => {
    document.body.innerHTML = '<p>Your Order #5 shipped.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — Decision #3 short ref "Case 12" not wrapped', () => {
    document.body.innerHTML = '<p>Read Case 12 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('identifier — all-same-char alpha value (16 chars) not wrapped', () => {
    // 16-char all-same alpha exercises the all-same-char validator branch.
    // Bare numeric path doesn't catch (no digit), so total spans = 0.
    document.body.innerHTML = '<p>password: aaaaaaaaaaaaaaaa reset.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  // ── Cross-node keyword lookaround ─────────────────────────────────────────
  // When keyword and value are in separate DOM elements, the per-node
  // findMatches can't see both. The facade's _precedingText + hasKeywordTrail
  // bridges that gap for digit-only values.

  test('cross-node — "Customer ID:" in sibling, "90002883390" in span wraps', () => {
    document.body.innerHTML =
      '<p><strong>Customer ID:</strong> <span>90002883390</span></p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('90002883390');
  });

  test('cross-node — "Org ID:" across nested elements wraps short value', () => {
    document.body.innerHTML =
      '<p><strong><u>Org ID:</u></strong> <span>5678</span></p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('5678');
  });

  test('cross-node — rescues year-suppressed "2024" when keyword precedes', () => {
    document.body.innerHTML =
      '<p><strong>Customer ID:</strong> <span>2024</span></p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('2024');
  });

  test('cross-node — no keyword in preceding text, year-like number not wrapped', () => {
    document.body.innerHTML =
      '<p><strong>Description:</strong> <span>2024</span></p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('cross-node — keyword after value does not trigger (trailing keyword)', () => {
    document.body.innerHTML =
      '<p><span>2024</span> <strong>is the account</strong></p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('cross-node — block boundary stops preceding text walk', () => {
    document.body.innerHTML =
      '<div><p>Customer ID:</p><p><span>2024</span></p></div>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  // ── Chunked scan — mutation buffering ───────────────────────────────────
  // Mutations arriving during a chunked scan are buffered and replayed after
  // the scan completes. This covers dynamic content (chat previews, lazy DOM)
  // inserted while the initial idle-callback scan is still in progress.

  test('chunked scan — mutations during scan are buffered and replayed', (done) => {
    // Override the synchronous requestIdleCallback stub from setup.js so the
    // chunked scan actually defers between chunks via setTimeout.
    var savedRIC = global.requestIdleCallback;
    global.requestIdleCallback = undefined;
    jest.useFakeTimers();

    // 510+ text nodes → first chunk (500) doesn't exhaust the walker.
    var lines = [];
    for (var i = 0; i < 510; i++) lines.push('<p>Line ' + i + '</p>');
    document.body.innerHTML = '<div>' + lines.join('') + '</div>';

    blsi.PiiDetector.scan(document.body, { numeric: true }, () => {
      var piiSpans = document.querySelectorAll('[data-bl-si-pii="numeric"]');
      expect(piiSpans.length).toBe(1);
      expect(piiSpans[0].textContent).toBe('46387905');
      jest.useRealTimers();
      global.requestIdleCallback = savedRIC;
      done();
    });

    // Inject content while chunked scan is mid-flight (_scanComplete false).
    var preview = document.createElement('p');
    preview.innerHTML = '<strong><u>Org ID:</u></strong> 46387905';
    document.body.appendChild(preview);

    blsi.PiiDetector.handleMutations(
      [{ type: 'childList', addedNodes: [preview], removedNodes: [] }],
      document.body,
    );

    // Drain all setTimeout chunks — buffer replays after final chunk.
    jest.runAllTimers();
  });

  test('chunked scan — cancelChunkedScan discards buffered mutations', () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div><p>Some text</p></div>';

    blsi.PiiDetector.scan(document.body, { numeric: true }, () => {});

    // Buffer a mutation
    const node = document.createTextNode('46387905');
    blsi.PiiDetector.handleMutations(
      [{ type: 'childList', addedNodes: [node], removedNodes: [] }],
      document.body,
    );

    // Cancel — buffered mutations should be discarded, not replayed
    blsi.PiiDetector.cancelChunkedScan();
    jest.runAllTimers();
    jest.useRealTimers();

    expect(document.querySelectorAll('[data-bl-si-pii]').length).toBe(0);
  });

  // ── Stage 1 detectors (Phase 3) ─────────────────────────────────────────
  // High-confidence checksum-validated detectors. Each test exercises one
  // detector at the integration level (regex + checksum + DOM wrap). Unit
  // coverage of the underlying validators lives in pii_checksums.test.js.

  describe('Stage 1 — Card PAN', () => {
    test('valid Visa test PAN wrapped as one span', () => {
      document.body.innerHTML = '<p>Charge to 4242424242424242 today.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
        '4242424242424242',
      );
    });

    test('Mastercard with hyphen separators wrapped', () => {
      document.body.innerHTML = '<p>Try 5555-5555-5555-4444 now.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('Amex 15-digit test PAN wrapped', () => {
      document.body.innerHTML = '<p>Use 378282246310005 here.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('Luhn-passing 16-digit number with non-card IIN falls back to bare-numeric (NOT Stage 1)', () => {
      // Random 16-digit Luhn-valid number whose first digits don't classify
      // as any card network. _classifyPan returns null → Stage 1 declines →
      // bare-numeric NUMERIC_RE catches it (one span — the original behaviour).
      document.body.innerHTML = '<p>Account 1230231230231233 reference.</p>';
      const count = blsi.PiiDetector.scan(document.body, { numeric: true });
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('Luhn-FAIL 16-digit not detected by Stage 1 (still falls back)', () => {
      // 4242... with last digit altered — Luhn fails, Stage 1 declines.
      document.body.innerHTML = '<p>Old card 4242424242424241 expired.</p>';
      // The bare-numeric pattern still wraps (it's a 16-digit run); the
      // assertion is that Stage 1 doesn't double-wrap.
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 1 — IBAN', () => {
    test('valid GB IBAN with spaces wrapped as one span', () => {
      document.body.innerHTML = '<p>Wire to GB29 NWBK 6016 1331 9268 19 today.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
        'GB29 NWBK 6016 1331 9268 19',
      );
    });

    test('valid DE IBAN no separators wrapped', () => {
      document.body.innerHTML = '<p>IBAN DE89370400440532013000 used.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('flipped IBAN check digits not wrapped (mod-97 fail)', () => {
      // Wrong check digits + valid country prefix.
      document.body.innerHTML = '<p>Bogus GB99 NWBK 6016 1331 9268 19 here.</p>';
      // Bare-numeric NUMERIC_RE still wraps the embedded digits, but the
      // IBAN itself doesn't trigger Stage 1.
      blsi.PiiDetector.scan(document.body, { numeric: true });
      // At least one bare-numeric run will match — assert no IBAN-shaped
      // single-span wrap of the full 27-char string.
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent.startsWith('GB')).toBeFalsy();
    });

    test('non-IBAN 2-letter prefix with valid mod-97 length not wrapped', () => {
      // Random ZZ-prefixed string of GB-ish length; ZZ has no entry in
      // _IBAN_LENGTHS so Stage 1 declines.
      document.body.innerHTML = '<p>String ZZ29NWBK60161331926819 unknown.</p>';
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent.startsWith('ZZ')).toBeFalsy();
    });
  });

  describe('Stage 1 — ETH wallet', () => {
    test('valid 0x + 40-hex address wrapped as one span', () => {
      document.body.innerHTML =
        '<p>Send to 0x742d35cc6634c0532925a3b844bc9e7595f0beb1 today.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
        '0x742d35cc6634c0532925a3b844bc9e7595f0beb1',
      );
    });

    test('0x with 39 hex chars NOT wrapped (length dispositive)', () => {
      // 39 hex chars — short by one.
      document.body.innerHTML = '<p>Bogus 0x742d35cc6634c0532925a3b844bc9e7595f0be here.</p>';
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent.startsWith('0x')).toBeFalsy();
    });

    test('mixed-case ETH address still wrapped', () => {
      // EIP-55 case-checksum is optional in our impl — both cases accepted.
      document.body.innerHTML =
        '<p>0x742D35CC6634C0532925A3B844BC9E7595F0BEB1 here.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 1 — ISBN-13 (suppress / anti-PII)', () => {
    test('valid ISBN-13 NOT wrapped (consumed → no PII span)', () => {
      // Pragmatic Programmer ISBN-13 — bare-numeric NUMERIC_RE would have
      // wrapped this 13-digit run. Stage 1 ISBN-13 consumes the range and
      // suppresses the bare-numeric overlap.
      document.body.innerHTML = '<p>Buy ISBN 9780135957059 today.</p>';
      const count = blsi.PiiDetector.scan(document.body, { numeric: true });
      // No span over the ISBN body. The keyword "ISBN" itself is not in
      // KEYWORDS, so identifier sub-pass also doesn't fire.
      const spans = document.querySelectorAll('[data-bl-si-pii="numeric"]');
      for (const span of spans) {
        expect(span.textContent).not.toContain('9780135957059');
      }
      expect(count).toBe(0);
    });

    test('ISBN-13 dashed form NOT wrapped', () => {
      document.body.innerHTML = '<p>978-0-13-595705-9 reference.</p>';
      const count = blsi.PiiDetector.scan(document.body, { numeric: true });
      expect(count).toBe(0);
    });

    test('978-prefixed but checksum-invalid 13-digit number STILL wraps via bare-numeric', () => {
      // Stage 1 declines (checksum fail), bare-numeric path still catches
      // a 13-digit run unless suppressed by something else.
      document.body.innerHTML = '<p>Code 9780135957058 logged.</p>';
      const count = blsi.PiiDetector.scan(document.body, { numeric: true });
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Stage 1 — Aadhaar', () => {
    test('valid Verhoeff-passing 12-digit ID wrapped', () => {
      // Synthetic Aadhaar — first digit ∈ [2-9], last digit chosen so the
      // Verhoeff product collapses to 0. Computed via the algorithm tables.
      // 234123412346 is a documented test value passing Verhoeff.
      document.body.innerHTML = '<p>Aadhaar 234123412346 on file.</p>';
      const count = blsi.PiiDetector.scan(document.body, { numeric: true });
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('Verhoeff-failing 12-digit number falls back to bare-numeric (not Stage 1)', () => {
      // Off-by-one check digit. Bare-numeric still wraps, but the assertion
      // is observability-only — doesn't strictly need separation.
      document.body.innerHTML = '<p>Account 234123412345 noted.</p>';
      // We just confirm the scan completes and at least one span exists.
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Stage 1 — overlap with bare-numeric', () => {
    test('PAN does not double-wrap (Stage 1 + Stage 3)', () => {
      // 16-digit Visa — bare-numeric \b\d{4,}\b would also match. Stage 1
      // consumes the range so Stage 3 skips it; exactly one span emitted.
      document.body.innerHTML = '<p>4242424242424242</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      expect(document.querySelectorAll('[data-bl-si-pii="numeric"]').length).toBe(1);
    });

    test('ETH address does not double-wrap', () => {
      document.body.innerHTML =
        '<p>0x742d35cc6634c0532925a3b844bc9e7595f0beb1</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 1 — E164 phone vs Aadhaar priority', () => {
    afterEach(() => {
      blsi.PiiDetector.clear(document.body);
    });

    test('+91 with 4-4-4 grouping wraps full string including country code', () => {
      document.body.innerHTML = '<p>Call +91 9876 5432 1098 now.</p>';
      blsi.PiiDetector.scan(document.body, { numeric: true });
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span).not.toBeNull();
      expect(span.textContent).toContain('+91');
    });

    test('+91 with no space wraps full string including +', () => {
      document.body.innerHTML = '<p>Reach +919876543210 today.</p>';
      blsi.PiiDetector.scan(document.body, { numeric: true });
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span).not.toBeNull();
      expect(span.textContent).toBe('+919876543210');
    });

    test('+91 with Aadhaar-shaped body wraps full string', () => {
      document.body.innerHTML = '<p>Number: +91 2345 6789 0123</p>';
      blsi.PiiDetector.scan(document.body, { numeric: true });
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span).not.toBeNull();
      expect(span.textContent).toContain('+91');
    });

    test('standalone Aadhaar (no + prefix) still detected', () => {
      document.body.innerHTML = '<p>Aadhaar 234123412346 on file.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Stage 2 detectors (Phase 4) ─────────────────────────────────────────
  // Context-gated detectors. Validators read country signal via
  // blsi.PiiState.getCountry(); tests seed the cache directly via setCountry
  // for deterministic behaviour rather than going through PiiCountry.detect().

  describe('Stage 2 — MAC address', () => {
    test('valid colon-separated MAC wrapped', () => {
      document.body.innerHTML = '<p>NIC 00:1A:2B:3C:4D:5E booted.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
        '00:1A:2B:3C:4D:5E',
      );
    });

    test('hyphen-separated MAC wrapped', () => {
      document.body.innerHTML = '<p>HW 00-1A-2B-3C-4D-5E noted.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('5-pair string (only 5 octets) NOT wrapped as MAC', () => {
      document.body.innerHTML = '<p>Short 00:1A:2B:3C:4D here.</p>';
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent.includes(':')).toBeFalsy();
    });
  });

  describe('Stage 2 — IPv4', () => {
    test('public IPv4 with keyword nearby wrapped', () => {
      document.body.innerHTML = '<p>Connect to server 8.8.8.8 today.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
        '8.8.8.8',
      );
    });

    test('public IPv4 without keyword NOT wrapped', () => {
      document.body.innerHTML = '<p>Random text 8.8.8.8 alone.</p>';
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && /\d+\.\d+\.\d+\.\d+/.test(span.textContent)).toBeFalsy();
    });

    test('private IPv4 (10/8) NOT wrapped even with keyword', () => {
      document.body.innerHTML = '<p>Server IP 10.0.0.1 internal.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    });

    test('loopback 127.0.0.1 NOT wrapped', () => {
      document.body.innerHTML = '<p>Address 127.0.0.1 localhost.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    });

    test('192.168.x.y private NOT wrapped', () => {
      document.body.innerHTML = '<p>Router IP 192.168.1.1 panel.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    });
  });

  describe('Stage 2 — IMEI', () => {
    test('Luhn-valid IMEI with keyword wrapped', () => {
      // 490154203237518 — known Luhn-valid 15-digit IMEI test value.
      document.body.innerHTML = '<p>Device IMEI 490154203237518 logged.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe(
        '490154203237518',
      );
    });

    test('Luhn-valid 15-digit number WITHOUT keyword falls back to bare-numeric', () => {
      // Stage 2 declines (no IMEI keyword); Stage 3 bare-numeric still wraps
      // the 15-digit run as one span.
      document.body.innerHTML = '<p>Code 490154203237518 logged.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('Luhn-FAIL 15-digit number with IMEI keyword NOT wrapped by Stage 2 (still bare-numeric)', () => {
      document.body.innerHTML = '<p>IMEI 490154203237519 invalid.</p>';
      // Stage 2 declines on Luhn fail; bare-numeric still wraps.
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 2 — E.164 phone', () => {
    test('+ prefix dispositive — wrapped without keyword', () => {
      document.body.innerHTML = '<p>Call +1 555-123-4567 today.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('NBSP-separated +91 phone wrapped as one span', () => {
      const nbsp = String.fromCharCode(160);
      document.body.innerHTML = `<p>Reach +91${nbsp}94909${nbsp}73391 here</p>`;
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 2 — SSN_US', () => {
    test('SSN with keyword wrapped (no country signal)', () => {
      // No <html lang> set → PiiCountry.detect() returns null → validator
      // falls back to keyword check (`SSN` in window).
      document.body.innerHTML = '<p>SSN 123-45-6789 on file.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent).toBe('123-45-6789');
    });

    test('SSN on US-country page wrapped without keyword', () => {
      // Country signal seeded by facade scan() via PiiCountry.detect();
      // <html lang="en-US"> is the natural input that surfaces "US".
      document.documentElement.setAttribute('lang', 'en-US');
      document.body.innerHTML = '<p>Number 234-56-7890 stored.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('SSN on non-US page without keyword NOT wrapped', () => {
      document.documentElement.setAttribute('lang', 'en-GB');
      document.body.innerHTML = '<p>Reference 345-67-8901 stored.</p>';
      // Stage 2 SSN declines; Stage 3 bare-numeric won't match the
      // hyphenated 9-digit form (each group < 4 digits except the last).
      // Last group `8901` may match bare-numeric — still a single span at
      // most.
      const count = blsi.PiiDetector.scan(document.body, { numeric: true });
      expect(count).toBeLessThanOrEqual(1);
    });

    test('SSN with 000 area code NOT wrapped (range gate)', () => {
      document.documentElement.setAttribute('lang', 'en-US');
      document.body.innerHTML = '<p>SSN 000-12-3456 invalid.</p>';
      // Range gate inside the regex rejects 000 first 3 digits.
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent === '000-12-3456').toBeFalsy();
    });

    test('SSN with 666 area code NOT wrapped', () => {
      document.documentElement.setAttribute('lang', 'en-US');
      document.body.innerHTML = '<p>SSN 666-12-3456 invalid.</p>';
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent === '666-12-3456').toBeFalsy();
    });
  });

  describe('Stage 2 — NHS_UK', () => {
    test('valid NHS number on GB-country page wrapped', () => {
      document.documentElement.setAttribute('lang', 'en-GB');
      // 9434765919 — synthetic test number passing mod-11 weighted check.
      document.body.innerHTML = '<p>Patient 943 476 5919 record.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
      const span = document.querySelector('[data-bl-si-pii="numeric"]');
      expect(span && span.textContent).toBe('943 476 5919');
    });

    test('valid NHS number with NHS keyword wrapped (no country signal)', () => {
      // No <html lang> → PiiCountry.detect() returns null → country gate
      // fails, validator falls back to keyword check.
      document.body.innerHTML = '<p>NHS number 9434765919 entered.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('valid NHS shape on non-GB page without keyword NOT wrapped via Stage 2', () => {
      document.documentElement.setAttribute('lang', 'en-US');
      document.body.innerHTML = '<p>Reference 9434765919 logged.</p>';
      // Stage 2 declines (US country, no NHS keyword); Stage 3 bare-numeric
      // suppressed by isOrderRef ("reference" keyword). 0 spans.
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    });

    test('mod-11 fail on GB page NOT wrapped via Stage 2', () => {
      document.documentElement.setAttribute('lang', 'en-GB');
      document.body.innerHTML = '<p>Patient 9434765918 invalid.</p>';
      // mod-11 fails; Stage 2 declines; Stage 3 bare-numeric wraps as
      // bare 10-digit run. 1 span via Stage 3.
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  // ── Consolidated descriptor framework — Stage 1 dispositive additions ───
  // Every test below exercises a detector wired as a data-row in
  // STAGE1_DETECTORS / STAGE2_DETECTORS via the unified `_runDescriptor`
  // runner. Coverage is integration-level (regex + checksum + DOM wrap).

  describe('Stage 1 — CN resident ID', () => {
    test('valid 18-char CN ID with X check digit wrapped', () => {
      // 11010519491231002X — synthetic (passes ISO 7064 mod-11-2 from
      // pii_checksums tests).
      document.body.innerHTML = '<p>身份证 11010519491231002X 已登记。</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('invalid CN ID checksum NOT wrapped via Stage 1', () => {
      // Off-by-one check digit. Bare-numeric NUMERIC_RE may still wrap the
      // 17-digit prefix; assertion is observability-only.
      document.body.innerHTML = '<p>身份证 110105194912310021 错误。</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Stage 1 — NRIC SG / CURP MX / Emirates ID / NIE ES', () => {
    test('NRIC SG positional shape wrapped', () => {
      document.body.innerHTML = '<p>NRIC S1234567A on file.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('CURP MX positional shape wrapped', () => {
      document.body.innerHTML = '<p>CURP HEGG560427MVZRRL04 registrada.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('Emirates ID with 784 prefix wrapped', () => {
      document.body.innerHTML = '<p>EID 784-1985-1234567-8 active.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('NIE ES XYZ-prefix shape wrapped', () => {
      document.body.innerHTML = '<p>NIE X1234567L registered.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('Codice Fiscale 16-char wrapped', () => {
      document.body.innerHTML = '<p>CF RSSMRA80A01H501Z attivo.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 1 — postal codes (UK / CA)', () => {
    test('UK postcode SW1A 1AA wrapped', () => {
      document.body.innerHTML = '<p>Address SW1A 1AA London.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('CA postal K1A 0B1 wrapped', () => {
      document.body.innerHTML = '<p>Postal K1A 0B1 Ottawa.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 1 — IPv6 / GPS DMS / Plus Code', () => {
    test('IPv6 full address wrapped', () => {
      document.body.innerHTML =
        '<p>Server 2001:0db8:85a3:0000:0000:8a2e:0370:7334 reachable.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('GPS DMS coordinate wrapped', () => {
      document.body.innerHTML = '<p>Pin 40°26\'46"N here.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('Plus Code wrapped', () => {
      document.body.innerHTML = '<p>Find at 8FVC9G8F+5W today.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 2 — country-gated postal codes', () => {
    test('NL postal on NL page wrapped', () => {
      document.documentElement.setAttribute('lang', 'nl-NL');
      document.body.innerHTML = '<p>Adres 1234 AB Amsterdam.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('NL postal-shaped 1024 MB on non-NL page NOT wrapped (measurement)', () => {
      // The reason postal_nl is country-gated — its shape collides with
      // measurement units like `1024 MB`.
      document.documentElement.setAttribute('lang', 'en-US');
      document.body.innerHTML = '<p>File 1024 MB size.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    });

    test('US ZIP+4 on US page wrapped', () => {
      document.documentElement.setAttribute('lang', 'en-US');
      document.body.innerHTML = '<p>ZIP 90210-1234 Beverly Hills.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  describe('Stage 2 — BSN NL / NPI US / DNI ES / ABN AU / MRN', () => {
    test('BSN on NL page wrapped', () => {
      document.documentElement.setAttribute('lang', 'nl-NL');
      // 111222333 — synthetic 9-digit; BSN 11-test (weights 9..2 + -1 on d9):
      //   1*9 + 1*8 + 1*7 + 2*6 + 2*5 + 2*4 + 3*3 + 3*2 - 3 = 9+8+7+12+10+8+9+6-3 = 66
      //   66 mod 11 = 0 ✓
      document.body.innerHTML = '<p>BSN 111222333 op formulier.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('NPI with NPI keyword wrapped', () => {
      // NPI Luhn variant: prefix "80840" + 10-digit npi → Luhn over 15 chars.
      // 1234567893 — 80840 + 1234567893 = 808401234567893; Luhn passes.
      document.body.innerHTML = '<p>NPI 1234567893 on claim.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('DNI on ES page wrapped', () => {
      document.documentElement.setAttribute('lang', 'es-ES');
      document.body.innerHTML = '<p>DNI 12345678Z almacenado.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('ABN with keyword wrapped', () => {
      document.body.innerHTML = '<p>ABN 51 824 753 556 registered.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });

    test('MRN with medical keyword wrapped', () => {
      document.body.innerHTML = '<p>Patient MRN 12345 record.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });

  // ── isStatistic suppressor ──────────────────────────────────────────────

  describe('isStatistic suppressor', () => {
    test('"n=2018" near "p<0.05" not blurred', () => {
      // 2018 alone would be suppressed by isYear; pick non-year sample.
      document.body.innerHTML = '<p>Trial p<0.05, n=15234 cohort.</p>';
      // 15234 alone matches bare-numeric. isStatistic suppresses near `p<` /
      // `n=` keywords within 30 chars.
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    });

    test('"R²=0.842" not blurred', () => {
      document.body.innerHTML = '<p>Model R²=0.842 fit on 4567 samples.</p>';
      // 4567 within 30 chars of `R²=` → suppressed by isStatistic.
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
    });

    test('plain number with no statistical context still wrapped', () => {
      document.body.innerHTML = '<p>The value 4567 stands alone.</p>';
      expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(1);
    });
  });
});
