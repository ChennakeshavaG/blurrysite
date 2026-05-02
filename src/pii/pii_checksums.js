/**
 * pii/pii_checksums.js — Pure-math checksum algorithms.
 *
 * Validators consumed by Stage 1 high-confidence detectors in
 * blsi.PiiDetectors. Pure functions — no DOM, no storage, no side effects.
 *
 * Exposed as blsi.PiiChecksums (IIFE — no ES module syntax).
 */

const BlurrySitePiiChecksums = (() => {
  "use strict";

  // ── Luhn (mod-10) — used for credit-card PAN, IMEI, SIN, NPI, etc. ────────
  function luhn(digits) {
    if (typeof digits !== "string" || digits.length === 0) return false;
    if (!/^\d+$/.test(digits)) return false;
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // ── Verhoeff — Aadhaar (UIDAI) checksum. ──────────────────────────────────
  // d[i][j] = multiplication table; p[pos][digit] = permutation table.
  const _D_TABLE = Object.freeze([
    Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    Object.freeze([1, 2, 3, 4, 0, 6, 7, 8, 9, 5]),
    Object.freeze([2, 3, 4, 0, 1, 7, 8, 9, 5, 6]),
    Object.freeze([3, 4, 0, 1, 2, 8, 9, 5, 6, 7]),
    Object.freeze([4, 0, 1, 2, 3, 9, 5, 6, 7, 8]),
    Object.freeze([5, 9, 8, 7, 6, 0, 4, 3, 2, 1]),
    Object.freeze([6, 5, 9, 8, 7, 1, 0, 4, 3, 2]),
    Object.freeze([7, 6, 5, 9, 8, 2, 1, 0, 4, 3]),
    Object.freeze([8, 7, 6, 5, 9, 3, 2, 1, 0, 4]),
    Object.freeze([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]),
  ]);
  const _P_TABLE = Object.freeze([
    Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    Object.freeze([1, 5, 7, 6, 2, 8, 3, 0, 9, 4]),
    Object.freeze([5, 8, 0, 3, 7, 9, 6, 1, 4, 2]),
    Object.freeze([8, 9, 1, 6, 0, 4, 3, 5, 2, 7]),
    Object.freeze([9, 4, 5, 3, 1, 2, 6, 8, 7, 0]),
    Object.freeze([4, 2, 8, 6, 5, 7, 3, 9, 0, 1]),
    Object.freeze([2, 7, 9, 3, 8, 0, 6, 4, 1, 5]),
    Object.freeze([7, 0, 4, 6, 9, 1, 3, 2, 5, 8]),
  ]);

  function verhoeff(digits) {
    if (typeof digits !== "string" || digits.length === 0) return false;
    if (!/^\d+$/.test(digits)) return false;
    let c = 0;
    // Walk right-to-left.
    for (let i = 0; i < digits.length; i++) {
      const d = digits.charCodeAt(digits.length - 1 - i) - 48;
      c = _D_TABLE[c][_P_TABLE[i % 8][d]];
    }
    return c === 0;
  }

  // ── mod-97 (IBAN) — ISO 13616 / mod-97-10. ────────────────────────────────
  // Move first 4 chars to end, expand letters (A=10..Z=35), mod 97 == 1.
  function mod97(s) {
    if (typeof s !== "string" || s.length < 5) return false;
    const rearranged = s.slice(4) + s.slice(0, 4);
    let expanded = "";
    for (let i = 0; i < rearranged.length; i++) {
      const code = rearranged.charCodeAt(i);
      if (code >= 48 && code <= 57) {
        expanded += rearranged[i];
      } else if (code >= 65 && code <= 90) {
        expanded += (code - 55).toString();
      } else {
        return false;
      }
    }
    // Chunked mod 97 to avoid BigInt — safe up to ~9-digit chunks under 2^53.
    let rem = 0;
    for (let i = 0; i < expanded.length; i += 7) {
      const chunk = (rem === 0 ? "" : rem.toString()) + expanded.slice(i, i + 7);
      rem = parseInt(chunk, 10) % 97;
    }
    return rem === 1;
  }

  // ── ISO 7064 mod-11-2 — Chinese resident ID (last char check, X=10). ──────
  function iso7064Mod11_2(s) {
    if (typeof s !== "string" || s.length !== 18) return false;
    const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const d = s.charCodeAt(i) - 48;
      if (d < 0 || d > 9) return false;
      sum += d * W[i];
    }
    const v = (12 - (sum % 11)) % 11;
    const expected = v === 10 ? "X" : String(v);
    return s[17].toUpperCase() === expected;
  }

  // ── mod-11 weighted residue — generic helper for NHS / BSN / Personnummer. ─
  // Returns sum mod 11 (0..10), or -1 on bad input. Caller maps the residue
  // to the expected check digit per their convention (NHS: check = 11 - r,
  // remap 11→0, treat 10 as invalid; others differ).
  function mod11Weighted(digits, weights) {
    if (typeof digits !== "string" || digits.length === 0) return -1;
    if (!Array.isArray(weights) || weights.length !== digits.length) return -1;
    if (!/^\d+$/.test(digits)) return -1;
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += (digits.charCodeAt(i) - 48) * weights[i];
    }
    return sum % 11;
  }

  // ── ISBN-13 — weighted mod-10 (×1, ×3 alternating). ───────────────────────
  function isbn13(digits) {
    if (typeof digits !== "string") return false;
    if (!/^\d{13}$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const n = digits.charCodeAt(i) - 48;
      sum += i % 2 === 0 ? n : n * 3;
    }
    return sum % 10 === 0;
  }

  // ── ISBN-10 — weighted mod-11 (×10..×1; check digit can be 'X' for 10). ──
  function isbn10(s) {
    if (typeof s !== "string" || s.length !== 10) return false;
    if (!/^\d{9}[\dX]$/i.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += (s.charCodeAt(i) - 48) * (10 - i);
    }
    const last = s[9].toUpperCase();
    sum += last === "X" ? 10 : last.charCodeAt(0) - 48;
    return sum % 11 === 0;
  }

  return Object.freeze({
    luhn,
    verhoeff,
    mod97,
    mod11Weighted,
    iso7064Mod11_2,
    isbn13,
    isbn10,
  });
})();

blsi.PiiChecksums = BlurrySitePiiChecksums;
