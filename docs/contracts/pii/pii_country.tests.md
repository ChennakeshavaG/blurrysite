# pii_country.tests Contract

## Purpose

Unit-test contract for `tests/unit/pii/pii_country.test.js`. Documents the test surface for `blsi.PiiCountry` (page-level country signal, Phase 4).

## Scope

Two surfaces are tested:

1. **`detectFromInputs(inputs)`** — pure function. Most coverage lives here; no DOM access required.
2. **`detect()`** — reads `location.hostname`, `document.documentElement.lang`, `document.querySelectorAll('meta')`, and `document.body.textContent`. Cached; resettable via `_resetCache()`. Smoke-tested in jsdom.

## Test File Layout

```
describe('pii_country.js')
├── describe('detectFromInputs — TLD')
│   ├── amazon.co.uk → GB                                 → TP (well-known multi-segment TLD)
│   ├── example.de → DE                                   → TP
│   ├── example.in → IN                                   → TP
│   ├── amazon.com → null                                  → no signal (gTLD)
│   ├── localhost → null                                   → no dots, no signal
│   └── empty / non-string hostname → null                 → type guard
├── describe('detectFromInputs — html lang')
│   ├── en-US → US                                         → TP
│   ├── en_GB underscore form → GB                         → TP
│   ├── ja-JP → JP                                         → TP
│   ├── zh-Hant-TW (script subtag in middle) → TW          → TP (script subtag tolerated)
│   ├── bare "en" → null (region required)                 → policy
│   └── empty string → null                                → type guard
├── describe('detectFromInputs — meta')
│   ├── geo.country = "DE" → DE                            → TP (highest-priority meta)
│   ├── lowercase geo.country normalized to upper           → normalisation
│   ├── og:locale = "en_US" → US                           → property attr path
│   ├── content-language meta → IN                         → name attr path
│   ├── http-equiv content-language → BR                   → http-equiv attr path
│   └── unrelated meta → no match                           → other meta tags ignored
├── describe('detectFromInputs — currency density')
│   ├── three or more £ → GB                               → threshold (≥3)
│   ├── three or more ₹ → IN                               → IN signal
│   ├── only two of one symbol → null                       → below threshold
│   ├── multi-country symbols ($ / € / ¥) ignored           → policy
│   └── empty sample → null                                 → type guard
├── describe('detectFromInputs — priority order')
│   ├── meta beats lang beats tld beats currency           → priority TP
│   ├── lang beats tld when meta absent                    → priority TP
│   ├── tld used when meta + lang absent                   → priority TP
│   ├── currency only used when nothing else fires         → priority TP
│   ├── all empty inputs → null                            → fallthrough
│   └── null inputs object → null                          → defensive
└── describe('detect — cache lifecycle')
    ├── reads <html lang="en-US"> when set                  → live DOM read
    ├── returns null when no signal available               → fallthrough
    ├── caches first result — DOM mutation post-call ignored→ M6 cache
    ├── _resetCache forces re-read                          → SPA invalidation
    └── reads <meta name="geo.country">                     → live meta read
```

Roughly 27 tests total.

## Test loading pattern

`loadCountry()` deletes `blsi.PiiCountry`, calls `jest.resetModules()`, then `require()`s `src/pii/pii_country.js` via `jest.isolateModules()` so Jest's Istanbul transform picks it up for coverage. Falls back to a thin stub (`detect:() => null`, `detectFromInputs:() => null`, `_resetCache:() => {}`) when the source file is absent so the contract still runs.

`global.blsi` is seeded by `tests/setup.js`. Each test calls `loadCountry()` in `beforeEach`.

The cache-lifecycle group runs an extra `_resetCache()` before each test and clears `document.documentElement.lang` + `document.head.innerHTML` so jsdom state can't leak between tests.

## Helpers

- `metaList(entries)` — builds an array of fake `meta`-shaped objects with a `getAttribute(name)` accessor that returns the matching key from each entry. Lets tests construct meta inputs without touching the DOM.

## What the tests do NOT cover

- **`<html lang>` changes mid-scan** — production reset is gated on SPA URL change paths; the cache deliberately hides intra-scan changes. Not tested.
- **Malformed `geo.country` values** — `"USA"` (3 chars), `"99"` (digits) are silently ignored by `_metaCountry`; rejection is implicit and not directly asserted.
- **Currency density on very large samples** — first 1000 chars is the cap in production; long-sample edge cases not tested.
- **Performance / pathological-length inputs** — no timing assertions.

## Integration coverage

Stage 2 detector tests in `pii.test.js` exercise the country signal end-to-end (e.g. `_validateNhsUk` returning `true` because `blsi.PiiState.getCountry() === 'GB'`). These tests seed the cache via `blsi.PiiState.setCountry('GB')` directly rather than going through `PiiCountry.detect()`.

## Maintenance rules

- Adding a new ccTLD to `_TLD_TO_COUNTRY` requires a TP test in this file (`example.<tld> → <country>`).
- Adding a new currency symbol to `_CURRENCY_HINT` requires a "three or more X → Y" TP test.
- Adding a new meta source (`<meta name="geo.region">` or similar) requires a meta-priority test.
- Removing or renaming a function requires both contract files in the same commit as the source change.
- Test count drift: keep the "Roughly 27 tests total" line accurate to within ±5; update on each change.
