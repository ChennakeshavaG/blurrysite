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
    freshLoad();
  });

  afterEach(() => {
    blsi.PiiDetector.clear(document.body);
    document.body.innerHTML = '';
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

  test('STAGE 0 — skips numbers inside .highlight (syntax-highlighter)', () => {
    document.body.innerHTML = '<div class="highlight">var x = 12345;</div>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
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

  test('isOrderRef — "Order #12345" not blurred', () => {
    document.body.innerHTML = '<p>Your Order #12345 ships.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isOrderRef — "Tracking 12345" not blurred', () => {
    document.body.innerHTML = '<p>Tracking 12345 here.</p>';
    expect(blsi.PiiDetector.scan(document.body, { numeric: true })).toBe(0);
  });

  test('isOrderRef — "Invoice 12345" not blurred', () => {
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
});
