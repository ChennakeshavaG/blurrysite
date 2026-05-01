# pii_checksums Contract

## Overview

Pure-math checksum algorithms used by Stage 1 dedicated detectors. **Phase 0 stub** — exposes `blsi.PiiChecksums = Object.freeze({})`. Phase 3 fills it with: Luhn (mod-10), Verhoeff (D5 group), mod-11 variants, mod-97 (IBAN), ISO 7064 mod-11-2 / mod-11-10, letter-table checks (Codice Fiscale / DNI / NRIC SG), Base58Check, bech32 (BIP-173), mod-89 (AU ABN).

All functions are pure: no DOM access, no storage access, no global mutation. Inputs are strings or digit arrays; outputs are booleans (validation result) or numbers (computed check digit).

## Module State

None.

## Public API (Phase 0)

Empty object — no functions exported yet.

## Phase 3 planned API

To be documented when implemented:

- `luhn(digits: string) → boolean`
- `verhoeff(digits: string) → boolean`
- `mod11(digits: string, weights: number[]) → number`
- `mod97(s: string) → number`
- `iso7064_mod_11_2(digits: string) → boolean`
- `iso7064_mod_11_10(digits: string) → boolean`
- `isbn10(digits: string) → boolean`
- `isbn13(digits: string) → boolean`
- `bech32_decode(s: string) → {hrp, data} | null`
- `base58check(s: string) → boolean`

See `docs/research/pii/numeric/PIPELINE.md` §Stage 1 for which detector consumes which algorithm.

## Edge cases

Phase 0: any caller that reads `blsi.PiiChecksums.x` for any `x` will receive `undefined`. Callers added in Phase 3 onwards.
