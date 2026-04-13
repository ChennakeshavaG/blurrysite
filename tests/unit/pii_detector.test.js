/**
 * tests/unit/pii_detector.test.js
 *
 * Unit tests for src/pii_detector.js
 * Module exposes blsi.PiiDetector with:
 *   scan, clear, observeMutations, stopObserving, getMatchCount, getPatterns
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/pii_detector.js');

function freshLoad() {
  delete blsi.PiiDetector;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

const ALL_TYPES = {
  EMAIL: true,
  PHONE: true,
  SSN: true,
  CREDIT_CARD: true,
  FINANCIAL: true,
};

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

  // ── Pattern tests ──────────────────────────────────────────────────────────

  test('detects email addresses', () => {
    document.body.innerHTML = '<p>Contact us at user@example.com for info.</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="email"]');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('user@example.com');
    expect(span.getAttribute('data-bl-si-blur')).toBe('1');
  });

  test('detects phone numbers', () => {
    document.body.innerHTML = '<p>Call +1-555-123-4567 today.</p>';
    const count = blsi.PiiDetector.scan(document.body, { PHONE: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="phone"]');
    expect(span).not.toBeNull();
  });

  test('detects SSN patterns', () => {
    document.body.innerHTML = '<p>SSN: 123-45-6789</p>';
    const count = blsi.PiiDetector.scan(document.body, { SSN: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="ssn"]');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('123-45-6789');
  });

  test('detects credit card patterns', () => {
    document.body.innerHTML = '<p>Card: 4111 1111 1111 1111</p>';
    const count = blsi.PiiDetector.scan(document.body, { CREDIT_CARD: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="credit_card"]');
    expect(span).not.toBeNull();
  });

  test('detects financial figures', () => {
    document.body.innerHTML = '<p>Total: $1,234.56 due today.</p>';
    const count = blsi.PiiDetector.scan(document.body, { FINANCIAL: true });
    expect(count).toBe(1);
    const span = document.querySelector('[data-bl-si-pii="financial"]');
    expect(span).not.toBeNull();
  });

  test('detects Euro currency symbol', () => {
    document.body.innerHTML = '<p>Price: \u20AC500 per unit.</p>';
    const count = blsi.PiiDetector.scan(document.body, { FINANCIAL: true });
    expect(count).toBe(1);
  });

  test('detects Indian Rupee symbol', () => {
    document.body.innerHTML = '<p>Salary: \u20B950,000 monthly.</p>';
    const count = blsi.PiiDetector.scan(document.body, { FINANCIAL: true });
    expect(count).toBe(1);
  });

  // ── Per-type toggle tests ──────────────────────────────────────────────────

  test('respects per-type toggles — disabled types are skipped', () => {
    document.body.innerHTML = '<p>user@example.com and 123-45-6789</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true, SSN: false });
    expect(count).toBe(1);
    expect(document.querySelector('[data-bl-si-pii="email"]')).not.toBeNull();
    expect(document.querySelector('[data-bl-si-pii="ssn"]')).toBeNull();
  });

  test('returns 0 when no types are enabled', () => {
    document.body.innerHTML = '<p>user@example.com</p>';
    const count = blsi.PiiDetector.scan(document.body, {});
    expect(count).toBe(0);
  });

  // ── Scan behavior tests ────────────────────────────────────────────────────

  test('does not match invalid email', () => {
    document.body.innerHTML = '<p>This is not@email or @handle</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(0);
  });

  test('SSN pattern requires separators', () => {
    // Bare 9-digit numbers without separators should NOT match SSN
    document.body.innerHTML = '<p>Number 123456789 here</p>';
    const count = blsi.PiiDetector.scan(document.body, { SSN: true });
    expect(count).toBe(0);
  });

  test('skips already-wrapped PII nodes', () => {
    document.body.innerHTML = '<p><span data-bl-si-pii="email" data-bl-si-blur="1">user@example.com</span></p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(0);
  });

  test('skips extension UI elements', () => {
    document.body.innerHTML = '<div id="bl-si-picker-toolbar"><p>user@example.com</p></div>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(0);
  });

  test('skips text nodes inside toast', () => {
    document.body.innerHTML = '<div class="bl-si-toast"><p>user@example.com</p></div>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(0);
  });

  test('skips empty text nodes', () => {
    document.body.innerHTML = '<p>   </p>';
    const count = blsi.PiiDetector.scan(document.body, ALL_TYPES);
    expect(count).toBe(0);
  });

  test('handles multiple matches in one text node', () => {
    document.body.innerHTML = '<p>Email a@b.com and c@d.com please</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(count).toBe(2);
    const spans = document.querySelectorAll('[data-bl-si-pii="email"]');
    expect(spans.length).toBe(2);
  });

  test('handles multiple PII types in one text node', () => {
    document.body.innerHTML = '<p>Contact user@test.com at 555-123-4567</p>';
    const count = blsi.PiiDetector.scan(document.body, { EMAIL: true, PHONE: true });
    expect(count).toBe(2);
  });

  test('preserves surrounding text after wrapping', () => {
    document.body.innerHTML = '<p>Hello user@test.com World</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(document.querySelector('p').textContent).toBe('Hello user@test.com World');
  });

  // ── Clear tests ────────────────────────────────────────────────────────────

  test('clear() unwraps all PII spans and restores text', () => {
    document.body.innerHTML = '<p>Send to user@test.com please</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(document.querySelector('[data-bl-si-pii]')).not.toBeNull();

    blsi.PiiDetector.clear(document.body);
    expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
    expect(document.querySelector('p').textContent).toBe('Send to user@test.com please');
  });

  test('clear() resets match count', () => {
    document.body.innerHTML = '<p>user@test.com</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(blsi.PiiDetector.getMatchCount()).toBeGreaterThan(0);
    blsi.PiiDetector.clear(document.body);
    expect(blsi.PiiDetector.getMatchCount()).toBe(0);
  });

  // ── getPatterns / getMatchCount ────────────────────────────────────────────

  test('getPatterns() returns the pattern definitions', () => {
    const patterns = blsi.PiiDetector.getPatterns();
    expect(patterns.EMAIL).toBeDefined();
    expect(patterns.EMAIL.regex).toBeInstanceOf(RegExp);
    expect(patterns.FINANCIAL).toBeDefined();
  });

  test('getMatchCount() tracks total matches', () => {
    document.body.innerHTML = '<p>a@b.com c@d.com</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    expect(blsi.PiiDetector.getMatchCount()).toBe(2);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  test('scan with null rootEl returns 0', () => {
    expect(blsi.PiiDetector.scan(null, ALL_TYPES)).toBe(0);
  });

  test('scan with null types returns 0', () => {
    document.body.innerHTML = '<p>user@test.com</p>';
    expect(blsi.PiiDetector.scan(document.body, null)).toBe(0);
  });

  test('stopObserving is safe to call when no observer is active', () => {
    expect(() => blsi.PiiDetector.stopObserving()).not.toThrow();
  });

  test('double scan does not re-wrap already wrapped nodes', () => {
    document.body.innerHTML = '<p>user@test.com</p>';
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    blsi.PiiDetector.scan(document.body, { EMAIL: true });
    const spans = document.querySelectorAll('[data-bl-si-pii="email"]');
    expect(spans.length).toBe(1);
  });
});
