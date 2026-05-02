# pii_checksums.tests Contract

## Purpose

Unit-test contract for `tests/unit/pii/pii_checksums.test.js`. Documents the test surface for `blsi.PiiChecksums` (the pure-math validator library consumed by Stage 1 detectors).

## Scope

Validates the six checksum algorithms shipped in Phase 3:

- `luhn`
- `verhoeff`
- `mod97`
- `mod11Weighted`
- `iso7064Mod11_2`
- `isbn13`
- `isbn10`

Each algorithm has its own `describe` block with TP / FP / shape-error cases. No DOM / storage interaction is tested — these are pure functions.

## Test File Layout

```
describe('pii_checksums.js')
├── describe('luhn')
│   ├── valid Visa test PAN                        → TP
│   ├── valid Mastercard test PAN                  → TP
│   ├── valid Amex test PAN (15 digits)            → TP
│   ├── off-by-one digit fails                     → FP
│   ├── all-zero digit run returns true            → documented degeneracy
│   ├── non-string input returns false             → type guard
│   ├── empty string returns false                 → length guard
│   └── non-digit characters return false          → caller must strip seps
├── describe('verhoeff')
│   ├── synthetic Aadhaar — known valid            → TP (Wikipedia worked example)
│   ├── flipping any digit fails                   → FP
│   ├── detects single-digit transposition         → FP (key Verhoeff property)
│   ├── non-digit char returns false               → shape guard
│   └── non-string / empty returns false           → type guard
├── describe('mod97')
│   ├── canonical GB IBAN                          → TP (ISO 13616 reference)
│   ├── canonical DE IBAN                          → TP
│   ├── canonical FR IBAN                          → TP
│   ├── flipping check digits fails                → FP
│   ├── lowercase letters return false             → caller must upcase
│   ├── non-alphanumeric chars return false        → caller must strip seps
│   └── short string returns false                 → length guard
├── describe('mod11Weighted')
│   ├── NHS valid number residue computation       → known test value (9434765919 → r=2)
│   ├── residue 0 for sums divisible by 11         → boundary case
│   ├── length mismatch → -1                       → shape guard (digits ≠ weights)
│   ├── non-digit char → -1                        → shape guard
│   └── non-string / empty / non-array weights → -1 → type guards
├── describe('iso7064Mod11_2')
│   ├── valid 18-char CN ID with X check char      → TP
│   ├── lowercase x accepted                       → case-insensitive 'X'
│   ├── flipping check digit fails                 → FP
│   ├── length ≠ 18 returns false                  → shape guard
│   └── non-digit in body returns false            → shape guard
├── describe('isbn13')
│   ├── valid ISBN-13 (Pragmatic Programmer)        → TP
│   ├── valid ISBN-13 with 979 prefix              → TP
│   ├── flipping check digit fails                 → FP
│   ├── length ≠ 13 returns false                  → shape guard
│   └── non-digit returns false                    → shape guard
└── describe('isbn10')
    ├── valid ISBN-10 (TAOCP Vol 1)                 → TP
    ├── valid ISBN-10 with X check digit            → TP
    ├── lowercase x accepted                       → case-insensitive 'X'
    ├── flipping check digit fails                 → FP
    ├── length ≠ 10 returns false                  → shape guard
    └── non-digit / non-X char returns false       → shape guard
```

Roughly 36 tests total.

## Test loading pattern

Standard pattern (see `tests/CLAUDE.md`): per-file `loadChecksums()` calls `require(CHECKSUMS_PATH)` so Jest's Istanbul transform instruments coverage. Falls back to a thin stub (`Object.freeze({})`) when the source file is absent so the contract still runs.

`global.blsi` is seeded by `tests/setup.js` via `require('../src/constants.js')`. Each test calls `loadChecksums()` in `beforeEach` to ensure a fresh state — `jest.resetModules()` + `delete blsi.PiiChecksums` before re-require.

## What the tests do NOT cover

- **Performance / pathological-length inputs.** A 10 KB digit string passed to `verhoeff` or `mod97` should still terminate quickly and return `false`. Not covered — Phase 6 perf tests will exercise this.
- **Cross-validator coupling.** No test asserts that a Luhn-valid 16-digit string fails `isbn13` (or similar mismatched-validator combinations). Implicit through separation of concerns; could be added later for paranoia coverage.
- **Browser quirks.** `parseInt('0123', 10)` is the only built-in numeric parse used in `mod97`'s chunked algorithm; no test simulates a non-V8 engine.
- **Algorithms not yet shipped.** `bech32`, `base58check`, `mod89`, `iso7064Mod11_10`, generic `mod11`, and the letter-table validators (Codice Fiscale, DNI, NIE, NRIC SG) are deferred — see `pii_checksums.md` "Algorithms NOT in Phase 3".

## Integration coverage

Stage 1 detectors integrate the checksum library via per-detector validators in `src/pii/pii_detectors.js`. Cross-module behaviour (e.g., a real PAN inside a `<p>` blurs; a near-miss does not) is covered by `tests/unit/pii/pii.test.js` Stage 1 integration tests.

## Maintenance rules

- Adding a new algorithm to `src/pii/pii_checksums.js` requires:
  1. A new `describe` block here with at least one TP, one FP, and one shape-error case.
  2. An entry in `pii_checksums.md` Public API.
  3. An entry in this file's "Test File Layout".
- Removing or renaming an algorithm requires updating both contract files in the same commit as the source change.
- Test count drift: keep the "Roughly 36 tests total" line accurate to within ±5; update on each change.
