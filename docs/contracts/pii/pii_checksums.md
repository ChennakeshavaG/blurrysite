# pii_checksums Contract

## Overview

Pure-math checksum algorithms used by Stage 1 dedicated detectors in `blsi.PiiDetectors`. All functions are pure: no DOM access, no storage access, no global mutation. Inputs are strings; outputs are booleans (validation result).

Phase 3 lands the algorithms required by the initial Stage 1 detector set (Card PAN, IBAN, ETH wallet, ISBN-10/13 anti-PII suppressors, Aadhaar). Base58Check / bech32 / mod-89 are deferred — none are required by the Phase 3 detector list and the cryptographic primitives (double-SHA256 for Base58Check) carry significant weight in vanilla JS.

## Module State

None.

## Public API

### luhn(digits) → boolean

**What**: mod-10 checksum used by credit-card PANs, IMEI, SIN, NPI, etc.
**Params**:
- `digits` — `string` of `0–9` characters only (separators must be stripped by the caller).
**Returns**: `true` when the rightmost digit is the valid Luhn check digit, `false` otherwise.
**Edge cases**:
- Empty string, non-string, or any non-digit char → `false`.
- Single-digit input — only `'0'` returns `true`.

### verhoeff(digits) → boolean

**What**: D5-group dihedral checksum used by Aadhaar (UIDAI 12-digit ID).
**Params**:
- `digits` — `string` of `0–9` characters only. Last digit is the check digit.
**Returns**: `true` when the running product of permuted digits collapses to `0` (valid Verhoeff). `false` otherwise.
**Edge cases**:
- Empty string, non-string, or any non-digit char → `false`.
- The implementation walks digits right-to-left using the standard `_D_TABLE` (multiplication) and `_P_TABLE` (permutation, period 8); both tables are frozen at module load.

### mod97(s) → boolean

**What**: ISO 13616 / mod-97-10 checksum used by IBAN.
**Params**:
- `s` — `string`; expected to be the IBAN's stripped form (`[A-Z]{2}\d{2}[A-Z0-9]{11,30}`). Caller must remove spaces/hyphens before calling.
**Returns**: `true` iff the rearranged + letter-expanded number is `≡ 1 (mod 97)`. `false` for length < 5, non-alphanumeric chars, lowercase letters, or check failure.
**Implementation note**:
- Letters are expanded `A=10..Z=35`.
- Mod is computed in 7-digit chunks to stay safely below `2^53`; no `BigInt` needed.

### mod11Weighted(digits, weights) → number

**What**: generic weighted-mod-11 helper. Computes `sum_i(digits[i] * weights[i]) mod 11`. Each detector that consumes mod-11 maps the returned residue to its own check-digit convention (NHS: `check = 11 - r`, remap `11 → 0`, treat `10` as invalid; BSN: weight `-1` on the last digit so the full expression collapses to `≡ 0 (mod 11)`; etc.).
**Params**:
- `digits` — `string` of `0–9` characters only.
- `weights` — `number[]`; must be the same length as `digits` (one weight per digit).
**Returns**: `number` — the residue `0..10` on success, or `-1` for any malformed input (non-string `digits`, empty string, non-digit char, length mismatch, non-array `weights`).
**Edge cases**:
- Length mismatch between `digits` and `weights` → `-1`.
- Caller is responsible for choosing weights and interpreting the residue.

### iso7064Mod11_2(s) → boolean

**What**: ISO 7064 mod-11-2 checksum used by Chinese resident ID (`居民身份证`).
**Params**:
- `s` — `string` of length exactly 18; first 17 chars must be digits, last char is the check digit (`'0'..'9'` or `'X'` for value 10).
**Returns**: `true` iff the weighted sum (weights `[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]`) yields the expected check character.
**Edge cases**:
- Length ≠ 18 → `false`.
- Non-digit in positions 0..16 → `false`.
- Lowercase `'x'` is accepted (caller-side `.toUpperCase()`); other letters → `false`.

### isbn13(digits) → boolean

**What**: ISBN-13 weighted mod-10 (`×1, ×3` alternating).
**Params**:
- `digits` — `string`; must match `^\d{13}$` (13 numeric digits, no separators).
**Returns**: `true` when the weighted sum is divisible by 10.
**Edge cases**:
- Length ≠ 13, non-digit char, or non-string → `false`.

### isbn10(s) → boolean

**What**: ISBN-10 weighted mod-11.
**Params**:
- `s` — `string` of length exactly 10; first 9 chars must be digits; last char is `'0'..'9'` or `'X'` (value 10). Lowercase `'x'` is accepted.
**Returns**: `true` when the weighted sum (weights `10..1`) is divisible by 11.
**Edge cases**:
- Length ≠ 10, non-string, or any disallowed char → `false`.

## Algorithms NOT in Phase 3

The following appear in the Phase 3 plan in `docs/research/pii/numeric/PIPELINE.md` but are deferred — none are required by the initial Stage 1 detector set, and Base58Check requires a JS double-SHA256 implementation that is too heavy for the current scope:

- `bech32` (BIP-173) — needed for BTC native-segwit wallet detection.
- `base58check` — needed for BTC legacy P2PKH / P2SH wallet detection.
- `mod89` — needed for Australian ABN. Stage 4 phase.
- `iso7064_mod_11_10` — needed for German Steuer-ID. Stage 2 phase.
- Letter-table validators (Codice Fiscale, DNI, NIE, NRIC SG) — country-specific Stage 2 detectors.

These ship in later phases alongside the detectors that consume them. Each new addition lands its own contract entry above with same shape (params / returns / edge cases / implementation note).

## Edge cases (cross-cutting)

- All validators return `false` (never throw) for malformed input — type errors, length mismatches, illegal characters. Callers can pass any string and rely on the boolean return without try/catch.
- All validators are deterministic and side-effect free; safe to call from any context, any number of times.
- The `_D_TABLE` and `_P_TABLE` constants for Verhoeff are deeply frozen at load.

## Dependencies

None. The module only uses built-in JS string/charCode APIs and `parseInt`. Loaded at manifest position 9b — depends on nothing earlier.

## Test contract

See `docs/contracts/pii/pii_checksums.tests.md`.
