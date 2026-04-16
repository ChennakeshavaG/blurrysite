/**
 * tests/unit/pii_detector.test.js
 *
 * Unit tests for src/pii_detector.js
 *
 * Module exposes blsi.PiiDetector:
 *   scan(rootEl, types), clear(rootEl), observeMutations(rootEl),
 *   stopObserving(), getMatchCount(), getPatterns()
 *
 * Pattern contract (2 types only):
 *   EMAIL   — standard local@domain.tld
 *   NUMERIC — currency prefix | currency code suffix | 4+ bare digits
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/pii_detector.js');

function buildStubSource() {
  return `(function() {
    'use strict';
    var blsi = global.blsi;
    blsi.PiiDetector = Object.freeze({
      scan:             function() { return 0; },
      clear:            function() {},
      observeMutations: function() {},
      stopObserving:    function() {},
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
  delete blsi.PiiDetector;
  jest.resetModules();
  if (fs.existsSync(MODULE_PATH)) {
    jest.isolateModules(() => { require(MODULE_PATH); });
  } else {
    (0, eval)(buildStubSource());
  }
}

const ALL_TYPES = { EMAIL: true, NUMERIC: true };

describe('pii_detector.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    freshLoad();
  });

  afterEach(() => {
    blsi.PiiDetector.stopObserving();
    blsi.PiiDetector.clear(document.body);
    document.body.innerHTML = '';
  });

  // ── Pattern: EMAIL ─────────────────────────────────────────────────────────

  test('EMAIL — detects standard email', () => {
    document.body.innerHTML = '<p>Contact user@example.com for info.</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="email"]');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('user@example.com');
  });

  test('EMAIL — detects email with plus tag', () => {
    document.body.innerHTML = '<p>Send to user+tag@mail.co.uk</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="email"]').textContent).toBe('user+tag@mail.co.uk');
  });

  test('EMAIL — does not match bare @handle (no domain)', () => {
    document.body.innerHTML = '<p>Follow @username on social</p>';
    expect(blsi.PiiDetector.scan(document.body, { EMAIL: true })).toBe(0);
  });

  test('EMAIL — does not match text without @', () => {
    document.body.innerHTML = '<p>No email here, just text</p>';
    expect(blsi.PiiDetector.scan(document.body, { EMAIL: true })).toBe(0);
  });

  test('EMAIL — skips when EMAIL type disabled', () => {
    document.body.innerHTML = '<p>user@example.com</p>';
    expect(blsi.PiiDetector.scan(document.body, { EMAIL: false })).toBe(0);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
  });

  // ── Pattern: NUMERIC — currency prefix ────────────────────────────────────

  test('NUMERIC — detects dollar amount', () => {
    document.body.innerHTML = '<p>Total: $1,234.56 due today.</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBeGreaterThan(0);
    expect(document.querySelector('[data-bl-si-pii="numeric"]')).not.toBeNull();
  });

  test('NUMERIC — detects Euro symbol (€)', () => {
    document.body.innerHTML = '<p>Price: \u20AC500 per unit.</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  });

  test('NUMERIC — detects British Pound (£)', () => {
    document.body.innerHTML = '<p>Cost: \u00A3250.00</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  });

  test('NUMERIC — detects Indian Rupee (₹)', () => {
    document.body.innerHTML = '<p>Salary: \u20B950,000 monthly.</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  });

  test('NUMERIC — currency prefix matches digits up to non-digit ($17k → $17)', () => {
    // K-suffix is not captured (simplified regex); $17 still blurs the amount.
    document.body.innerHTML = '<p>Budget: $17k for the project.</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('$17');
  });

  // ── Pattern: NUMERIC — currency code suffix ────────────────────────────────

  test('NUMERIC — detects USD currency code suffix', () => {
    document.body.innerHTML = '<p>Transfer 1000 USD to account.</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBeGreaterThan(0);
  });

  test('NUMERIC — detects EUR currency code suffix', () => {
    document.body.innerHTML = '<p>Invoice amount: 50000 EUR</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBeGreaterThan(0);
  });

  // ── Pattern: NUMERIC — 4+ bare digits ─────────────────────────────────────

  test('NUMERIC — detects bare 5-digit number (17150)', () => {
    document.body.innerHTML = '<p>Account balance: 17150</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('17150');
  });

  test('NUMERIC — detects 4-digit number', () => {
    document.body.innerHTML = '<p>PIN: 4321</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  });

  test('NUMERIC — detects 16-digit credit card (no separators)', () => {
    document.body.innerHTML = '<p>Card 4111111111111111 on file</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('4111111111111111');
  });

  test('NUMERIC — detects comma-separated large number (1,234,567)', () => {
    document.body.innerHTML = '<p>Revenue: 1,234,567</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBeGreaterThan(0);
  });

  test('NUMERIC — does NOT detect 3-digit number (below threshold)', () => {
    document.body.innerHTML = '<p>Only 123 items remain.</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
  });

  test('NUMERIC — does NOT detect single/double digit numbers', () => {
    document.body.innerHTML = '<p>Step 1 of 99 complete.</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
  });

  test('NUMERIC — skips when NUMERIC type disabled', () => {
    document.body.innerHTML = '<p>Balance: 17150</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: false })).toBe(0);
  });

  // ── Pattern: NUMERIC — phone-like grouped sequences ───────────────────────
  // All 3 variants must wrap as ONE span so hover reveals the whole number.

  test('NUMERIC — hyphen-separated phone (111-222-333) wraps as one span', () => {
    document.body.innerHTML = '<p>Call 111-222-333 now.</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('111-222-333');
  });

  test('NUMERIC — mixed-width space-separated phone (111 2222 333) wraps as one span', () => {
    document.body.innerHTML = '<p>Mobile: 111 2222 333</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('111 2222 333');
  });

  test('NUMERIC — space-separated phone (111 222 333) wraps as one span', () => {
    document.body.innerHTML = '<p>Fax: 111 222 333</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: true });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('111 222 333');
  });

  test('NUMERIC — space-separated credit card (4111 1111 1111 1111) wraps as one span', () => {
    // Ordering: phone-like sub-pattern must fire before 4+ bare so the whole
    // card number becomes a single span, not four separate "1111" spans.
    document.body.innerHTML = '<p>Card: 4111 1111 1111 1111</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="numeric"]');
    expect(span.textContent).toBe('4111 1111 1111 1111');
  });

  test('NUMERIC — does NOT match two-group number (not enough groups)', () => {
    // "12 2024" is a date fragment — only 2 groups, needs ≥3 for phone pattern.
    // "2024" alone still matches 4+ bare digits.
    document.body.innerHTML = '<p>Due: 12 2024</p>';
    const spans = document.querySelectorAll('[data-bl-si-pii="numeric"]');
    blsi.PiiDetector.scan(document.body, { NUMERIC: true });
    // May match "2024" as bare 4+ but NOT "12 2024" as a phone-like group
    const texts = Array.from(document.querySelectorAll('[data-bl-si-pii="numeric"]')).map(s => s.textContent);
    expect(texts).not.toContain('12 2024');
  });

  test('NUMERIC — does NOT match digit groups separated by words', () => {
    // "room 12 door 23 window 34" — text between groups breaks the pattern
    document.body.innerHTML = '<p>room 12 door 23 window 34</p>';
    expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
  });

  // ── PII independence from blur-all ─────────────────────────────────────────

  test('PII span has NO data-bl-si-blur attribute (independent of blur-all)', () => {
    document.body.innerHTML = '<p>user@example.com</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    const span = document.querySelector('[data-bl-si-pii]');
    expect(span).not.toBeNull();
    // PII blur driven by [data-bl-si-pii] CSS rule only — no blur-engine dependency
    expect(span.hasAttribute('data-bl-si-blur')).toBe(false);
  });

  test('PII span persists after blur-engine sweep clears data-bl-si-blur elements', () => {
    document.body.innerHTML = '<p>user@example.com and <span data-bl-si-blur="1">other</span></p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });

    // Simulate blur-engine clearing non-PII blurred elements
    document.querySelectorAll('[data-bl-si-blur]').forEach(el => {
      if (!el.dataset.blSiPii) delete el.dataset.blSiBlur;
    });

    // PII span still present and intact
    const piiSpan = document.querySelector('[data-bl-si-pii]');
    expect(piiSpan).not.toBeNull();
    expect(piiSpan.textContent).toBe('user@example.com');
  });

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

  // ── Scan behavior ───────────────────────────────────────────────────────────

  test('skips extension UI elements (toolbar)', () => {
    document.body.innerHTML = '<div id="bl-si-picker-toolbar"><p>user@example.com</p></div>';
    expect(blsi.PiiDetector.scan(document.body, { EMAIL: true })).toBe(0);
  });

  test('skips extension toast elements', () => {
    document.body.innerHTML = '<div class="bl-si-toast"><p>user@example.com</p></div>';
    expect(blsi.PiiDetector.scan(document.body, { EMAIL: true })).toBe(0);
  });

  test('skips already-wrapped PII spans (no double-wrap)', () => {
    document.body.innerHTML = '<p><span data-bl-si-pii="email">user@example.com</span></p>';
    expect(blsi.PiiDetector.scan(document.body, { EMAIL: true })).toBe(0);
  });

  test('skips empty and whitespace-only text nodes', () => {
    document.body.innerHTML = '<p>   </p>';
    expect(blsi.PiiDetector.scan(document.body, ALL_TYPES)).toBe(0);
  });

  test('double scan does not re-wrap already wrapped nodes', () => {
    document.body.innerHTML = '<p>user@test.com</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(document.querySelectorAll('[data-bl-si-pii="email"]').length).toBe(1);
  });

  test('handles multiple matches in one text node', () => {
    document.body.innerHTML = '<p>Email a@b.com and c@d.com please</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(2);
    expect(document.querySelectorAll('[data-bl-si-pii="email"]').length).toBe(2);
  });

  test('preserves surrounding text after wrapping', () => {
    document.body.innerHTML = '<p>Hello user@test.com World</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(document.querySelector('p').textContent).toBe('Hello user@test.com World');
  });

  test('scan with null rootEl returns 0', () => {
    expect(blsi.PiiDetector.scan(null, ALL_TYPES)).toBe(0);
  });

  // ── clear() ────────────────────────────────────────────────────────────────

  test('clear() removes all PII spans and restores text', () => {
    document.body.innerHTML = '<p>Send to user@test.com please</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(document.querySelector('[data-bl-si-pii]')).not.toBeNull();

    blsi.PiiDetector.clear(document.body);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
    expect(document.querySelector('p').textContent).toBe('Send to user@test.com please');
  });

  test('clear() resets match count to 0', () => {
    document.body.innerHTML = '<p>user@test.com</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
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
    blsi.PiiDetector.scan(p1, { EMAIL: true });
    expect(blsi.PiiDetector.getMatchCount()).toBe(1);

    const p2 = document.createElement('p');
    p2.textContent = 'c@d.com';
    document.body.appendChild(p2);
    blsi.PiiDetector.scan(p2, { EMAIL: true });
    expect(blsi.PiiDetector.getMatchCount()).toBe(2);
  });

  // ── stopObserving ──────────────────────────────────────────────────────────

  test('stopObserving is safe when no observer is active', () => {
    expect(() => blsi.PiiDetector.stopObserving()).not.toThrow();
  });

  // ── Default settings path ──────────────────────────────────────────────────

  test('all AUTO_DETECT defaults off — scan returns 0', () => {
    document.body.innerHTML = '<p>user@example.com and 17150 and $500</p>';
    const defaultAutoDetect = { EMAIL: false, NUMERIC: 'off' };
    expect(blsi.PiiDetector.scan(document.body, defaultAutoDetect)).toBe(0);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
  });

  // ── NUMERIC mode: 'off' ────────────────────────────────────────────────────

  test("NUMERIC 'off' — no numeric spans created", () => {
    document.body.innerHTML = '<p>Balance: 94750</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'off' });
    expect(count).toBe(0);
    expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
  });

  test("NUMERIC 'off' truthy string does not trigger scan via old some(Boolean) pattern", () => {
    // 'off' is truthy — verify the module does NOT blur when NUMERIC='off'
    document.body.innerHTML = '<p>17150 and $500</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: false, NUMERIC: 'off' });
    expect(count).toBe(0);
  });

  // ── NUMERIC mode: 'standard' ───────────────────────────────────────────────

  test("NUMERIC 'standard' — bare 4+ digit number is hidden", () => {
    document.body.innerHTML = '<p>17150</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'standard' });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('17150');
  });

  test("NUMERIC 'standard' — hides number even with no context label", () => {
    document.body.innerHTML = '<p>Version 1234 released.</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'standard' });
    expect(count).toBe(1);
  });

  test("NUMERIC 'standard' — hides $9.99/month (currency prefix matched)", () => {
    document.body.innerHTML = '<p>Only $9/month</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'standard' });
    expect(count).toBe(1);
  });

  test("NUMERIC 'standard' string — scan runs (not blocked by boolean check)", () => {
    document.body.innerHTML = '<p>Account: 4111111111111111</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'standard' });
    expect(count).toBeGreaterThan(0);
    expect(blsi.PiiDetector.getMatchCount()).toBeGreaterThan(0);
  });

  // ── NUMERIC mode: 'conservative' ──────────────────────────────────────────

  test("NUMERIC 'conservative' — bare number without label: not hidden", () => {
    document.body.innerHTML = '<p>17150</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBe(0);
    expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
  });

  test("NUMERIC 'conservative' — number with Tier A label: hidden", () => {
    document.body.innerHTML = '<p>Balance: 94750</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('94750');
  });

  test("NUMERIC 'conservative' — salary label triggers hide", () => {
    document.body.innerHTML = '<p>Your salary of 75000 has been credited.</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBe(1);
  });

  test("NUMERIC 'conservative' — account label triggers hide", () => {
    document.body.innerHTML = '<p>Account: 4111111111111111</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBeGreaterThan(0);
  });

  test("NUMERIC 'conservative' — invoice label triggers hide", () => {
    document.body.innerHTML = '<p>Invoice #00123456 due 30 days</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBeGreaterThan(0);
  });

  test("NUMERIC 'conservative' — price suppressor prevents hide", () => {
    // "Balance" label present but "/month" suppressor cancels it
    document.body.innerHTML = '<p>$9.99/month</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBe(0);
  });

  test("NUMERIC 'conservative' — qty suppressor prevents hide", () => {
    document.body.innerHTML = '<p>qty: 5000 units</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBe(0);
  });

  test("NUMERIC 'conservative' — public version number not hidden", () => {
    document.body.innerHTML = '<p>Version 2024.1</p>';
    const count = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(count).toBe(0);
  });

  // ── Mode contrast: standard vs conservative ────────────────────────────────

  test('standard hides bare 17150; conservative does not (no label)', () => {
    document.body.innerHTML = '<p>17150</p>';
    const standardCount = blsi.PiiDetector.scan(document.body, { NUMERIC: 'standard' });
    expect(standardCount).toBe(1);

    blsi.PiiDetector.clear(document.body);
    blsi.PiiDetector.stopObserving();

    const conservativeCount = blsi.PiiDetector.scan(document.body, { NUMERIC: 'conservative' });
    expect(conservativeCount).toBe(0);
  });
});
