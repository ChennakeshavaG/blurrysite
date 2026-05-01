# pii_country Contract

## Overview

Page-level country signal for Stage 2 context-gated detectors. **Phase 0 stub** — exposes `blsi.PiiCountry = Object.freeze({})`. Phase 4 fills it with one-shot signal capture from hostname TLD + `<html lang>` + `<meta>` + currency-symbol density, returning an ISO 3166 alpha-2 string or `null`.

The signal is computed once per scan (via `blsi.PiiState` cache or per-call cache, TBD in Phase 4) and passed into Stage 2 detector validators that accept a `country` argument.

## Module State

Phase 0: none.

## Public API (Phase 0)

Empty object — no functions exported yet.

## Phase 4 planned API

To be documented when implemented:

- `detect() → 'US' | 'DE' | 'FR' | 'IT' | 'ES' | 'IN' | 'CN' | 'JP' | 'KR' | 'SG' | 'BR' | 'MX' | 'GB' | ... | null`
- `invalidate()` — used by `applyState` when SPA navigation changes locale signals.

Detection inputs (priority order):
1. Hostname TLD (`.de`, `.fr`, `.in`, etc.)
2. `<html lang="…">` attribute
3. `<meta http-equiv="content-language" content="…">` and Open Graph locale tags
4. Currency-symbol density in first 1000 chars of body text

Returns `null` when signals conflict or are absent. Stage 2 detectors that need a country gracefully no-op when `null`.

See `docs/research/pii/numeric/address-location.md` §5-digit collision and `docs/research/pii/numeric/PIPELINE.md` §Stage 2 for detector use cases.

## Edge cases

Phase 0: any caller that reads `blsi.PiiCountry.x` for any `x` will receive `undefined`. Callers added in Phase 4 onwards.
