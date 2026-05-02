/**
 * tests/unit/pii/pii_checksums.test.js
 *
 * Unit tests for blsi.PiiChecksums — pure-math validators consumed by Stage 1
 * detectors. Each algorithm is tested with documented synthetic test values
 * (real PANs, IBAN reference samples from ISO 13616, UIDAI Verhoeff worked
 * examples, ISBN samples). All inputs to the validators are normalised
 * (separators stripped) — that's caller-side work in pii_detectors.js.
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: luhn, verhoeff, mod97, iso7064Mod11_2, isbn13, isbn10 happy + edge
 *         paths. Type guards (non-string, empty, illegal chars) for every
 *         validator. Specific check-digit edge cases (Verhoeff right-to-left,
 *         IBAN BigInt-free chunked mod, ISBN-10 'X' / 'x' check digit, ISO
 *         7064 'X' check character).
 *
 * MISSING COVERAGE:
 *   - Performance / pathological-length inputs (a 10KB digit string passed to
 *     verhoeff or mod97 — should still terminate quickly and return false).
 *   - Cross-validator coupling (e.g., a Luhn-valid 16-digit string is run
 *     through isbn13 — should return false). Implicit via separation of
 *     concerns; no test asserts it.
 *
 * REDUNDANT: none — each validator has a focused TP / FP / shape-error block.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PII_DIR = path.resolve(__dirname, '../../../src/pii');
const CHECKSUMS_PATH = path.join(PII_DIR, 'pii_checksums.js');

function buildStubSource() {
  return `(function() {
    'use strict';
    var blsi = global.blsi;
    blsi.PiiChecksums = Object.freeze({});
  })();`;
}

function loadChecksums() {
  global.blsi = global.blsi || {};
  delete blsi.PiiChecksums;
  jest.resetModules();
  if (fs.existsSync(CHECKSUMS_PATH)) {
    jest.isolateModules(() => { require(CHECKSUMS_PATH); });
  } else {
    (0, eval)(buildStubSource());
  }
}

describe('pii_checksums.js', () => {
  beforeEach(() => loadChecksums());

  // ── Luhn ─────────────────────────────────────────────────────────────────

  describe('luhn', () => {
    test('valid Visa test PAN', () => {
      // Stripe / Visa documented test PAN.
      expect(blsi.PiiChecksums.luhn('4242424242424242')).toBe(true);
    });

    test('valid Mastercard test PAN', () => {
      expect(blsi.PiiChecksums.luhn('5555555555554444')).toBe(true);
    });

    test('valid Amex test PAN (15 digits)', () => {
      expect(blsi.PiiChecksums.luhn('378282246310005')).toBe(true);
    });

    test('off-by-one digit fails Luhn', () => {
      expect(blsi.PiiChecksums.luhn('4242424242424243')).toBe(false);
    });

    test('all-zero digit run returns true (degenerate but valid mod-10)', () => {
      // Documented Luhn property — kept so callers know the validator alone
      // is not sufficient; PAN detector adds IIN classification on top.
      expect(blsi.PiiChecksums.luhn('0000000000000000')).toBe(true);
    });

    test('non-string input returns false', () => {
      expect(blsi.PiiChecksums.luhn(4242424242424242)).toBe(false);
      expect(blsi.PiiChecksums.luhn(null)).toBe(false);
      expect(blsi.PiiChecksums.luhn(undefined)).toBe(false);
    });

    test('empty string returns false', () => {
      expect(blsi.PiiChecksums.luhn('')).toBe(false);
    });

    test('non-digit characters return false', () => {
      expect(blsi.PiiChecksums.luhn('4242 4242 4242 4242')).toBe(false);
      expect(blsi.PiiChecksums.luhn('4242-4242-4242-4242')).toBe(false);
    });
  });

  // ── Verhoeff ─────────────────────────────────────────────────────────────

  describe('verhoeff', () => {
    test('UIDAI synthetic Aadhaar — known valid', () => {
      // Wikipedia worked example for the Verhoeff D5-group algorithm.
      expect(blsi.PiiChecksums.verhoeff('2363')).toBe(true);
    });

    test('flipping any digit fails', () => {
      expect(blsi.PiiChecksums.verhoeff('2364')).toBe(false);
    });

    test('detects single-digit transposition', () => {
      // Verhoeff catches all single-digit and adjacent-digit-transposition errors.
      // Start from a valid number, swap two adjacent digits — must fail.
      expect(blsi.PiiChecksums.verhoeff('2363')).toBe(true);
      expect(blsi.PiiChecksums.verhoeff('3263')).toBe(false);
    });

    test('non-digit char returns false', () => {
      expect(blsi.PiiChecksums.verhoeff('236A')).toBe(false);
    });

    test('non-string / empty returns false', () => {
      expect(blsi.PiiChecksums.verhoeff(null)).toBe(false);
      expect(blsi.PiiChecksums.verhoeff('')).toBe(false);
    });
  });

  // ── mod-97 (IBAN) ────────────────────────────────────────────────────────

  describe('mod97', () => {
    test('canonical GB IBAN', () => {
      // ISO 13616 reference: GB29 NWBK 6016 1331 9268 19 (stripped).
      expect(blsi.PiiChecksums.mod97('GB29NWBK60161331926819')).toBe(true);
    });

    test('canonical DE IBAN', () => {
      expect(blsi.PiiChecksums.mod97('DE89370400440532013000')).toBe(true);
    });

    test('canonical FR IBAN', () => {
      expect(blsi.PiiChecksums.mod97('FR1420041010050500013M02606')).toBe(true);
    });

    test('flipping check digits fails', () => {
      expect(blsi.PiiChecksums.mod97('GB30NWBK60161331926819')).toBe(false);
    });

    test('lowercase letters return false', () => {
      // Caller is expected to upcase before passing; mod97 itself is strict.
      expect(blsi.PiiChecksums.mod97('gb29nwbk60161331926819')).toBe(false);
    });

    test('non-alphanumeric chars return false', () => {
      expect(blsi.PiiChecksums.mod97('GB29 NWBK 6016 1331 9268 19')).toBe(false);
    });

    test('short string returns false', () => {
      expect(blsi.PiiChecksums.mod97('GB29')).toBe(false);
      expect(blsi.PiiChecksums.mod97('')).toBe(false);
    });
  });

  // ── mod-11 weighted (NHS / BSN / Personnummer / …) ───────────────────────

  describe('mod11Weighted', () => {
    test('NHS valid number residue computation', () => {
      // Synthetic NHS test number 9434765919: weights 10..2 on first 9 digits
      // → sum 299, residue 2. Check digit = 11 - 2 = 9 (matches last digit).
      const r = blsi.PiiChecksums.mod11Weighted('943476591', [10,9,8,7,6,5,4,3,2]);
      expect(r).toBe(2);
    });

    test('residue 0 for digits whose weighted sum is divisible by 11', () => {
      // 999000800 with weights 10..2 → sum 275; 275 % 11 = 0.
      const r = blsi.PiiChecksums.mod11Weighted('999000800', [10,9,8,7,6,5,4,3,2]);
      expect(r).toBe(0);
    });

    test('length mismatch → -1', () => {
      expect(blsi.PiiChecksums.mod11Weighted('1234', [1,2,3])).toBe(-1);
      expect(blsi.PiiChecksums.mod11Weighted('1234', [1,2,3,4,5])).toBe(-1);
    });

    test('non-digit char → -1', () => {
      expect(blsi.PiiChecksums.mod11Weighted('12a4', [1,2,3,4])).toBe(-1);
    });

    test('non-string / empty / non-array weights → -1', () => {
      expect(blsi.PiiChecksums.mod11Weighted(null, [1])).toBe(-1);
      expect(blsi.PiiChecksums.mod11Weighted('', [])).toBe(-1);
      expect(blsi.PiiChecksums.mod11Weighted('1', null)).toBe(-1);
    });
  });

  // ── ISO 7064 mod-11-2 (CN ID) ────────────────────────────────────────────

  describe('iso7064Mod11_2', () => {
    test('valid 18-char CN ID with X check char', () => {
      // Synthetic CN ID — first 17 digits + computed check 'X'.
      // 11010519491231002 → check digit X (per the standard weighting).
      expect(blsi.PiiChecksums.iso7064Mod11_2('11010519491231002X')).toBe(true);
    });

    test('lowercase x accepted', () => {
      expect(blsi.PiiChecksums.iso7064Mod11_2('11010519491231002x')).toBe(true);
    });

    test('flipping check digit fails', () => {
      expect(blsi.PiiChecksums.iso7064Mod11_2('110105194912310020')).toBe(false);
    });

    test('length ≠ 18 returns false', () => {
      expect(blsi.PiiChecksums.iso7064Mod11_2('11010519491231002')).toBe(false);
      expect(blsi.PiiChecksums.iso7064Mod11_2('11010519491231002X9')).toBe(false);
    });

    test('non-digit in body returns false', () => {
      expect(blsi.PiiChecksums.iso7064Mod11_2('1101051949123100AX')).toBe(false);
    });
  });

  // ── ISBN-13 ──────────────────────────────────────────────────────────────

  describe('isbn13', () => {
    test('valid ISBN-13 (Pragmatic Programmer)', () => {
      expect(blsi.PiiChecksums.isbn13('9780135957059')).toBe(true);
    });

    test('valid ISBN-13 with 979 prefix', () => {
      expect(blsi.PiiChecksums.isbn13('9791234567896')).toBe(true);
    });

    test('flipping check digit fails', () => {
      expect(blsi.PiiChecksums.isbn13('9780135957058')).toBe(false);
    });

    test('length ≠ 13 returns false', () => {
      expect(blsi.PiiChecksums.isbn13('978013595705')).toBe(false);
      expect(blsi.PiiChecksums.isbn13('97801359570599')).toBe(false);
    });

    test('non-digit returns false', () => {
      expect(blsi.PiiChecksums.isbn13('978013595705X')).toBe(false);
    });
  });

  // ── ISBN-10 ──────────────────────────────────────────────────────────────

  describe('isbn10', () => {
    test('valid ISBN-10 (TAOCP Vol 1)', () => {
      expect(blsi.PiiChecksums.isbn10('0201896834')).toBe(true);
    });

    test('valid ISBN-10 with X check digit', () => {
      // Foundations of Computer Science by Aho et al.
      expect(blsi.PiiChecksums.isbn10('097522980X')).toBe(true);
    });

    test('lowercase x accepted', () => {
      expect(blsi.PiiChecksums.isbn10('097522980x')).toBe(true);
    });

    test('flipping check digit fails', () => {
      expect(blsi.PiiChecksums.isbn10('0201896835')).toBe(false);
    });

    test('length ≠ 10 returns false', () => {
      expect(blsi.PiiChecksums.isbn10('020189683')).toBe(false);
      expect(blsi.PiiChecksums.isbn10('02018968345')).toBe(false);
    });

    test('non-digit / non-X char returns false', () => {
      expect(blsi.PiiChecksums.isbn10('020189683Y')).toBe(false);
    });
  });
});
