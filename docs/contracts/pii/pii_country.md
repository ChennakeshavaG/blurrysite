# pii_country Contract

## Overview

Page-level country signal for Stage 2 context-gated detectors. Computes an ISO 3166 alpha-2 string (or `null`) from four sources in priority order, and caches the result for the lifetime of the scan (PERF.md M6 cache).

## Module State

| Variable | Description |
|---|---|
| `_TLD_TO_COUNTRY` | Frozen object — alpha-2 ccTLD → country code map (~45 entries). Conservative allow-list; ccTLDs commonly used as gTLDs (`.io`, `.me`, `.tv`, `.co`) are excluded. |
| `_CURRENCY_HINT` | Frozen object — single-country currency-symbol → country (`£→GB`, `₹→IN`, `₩→KR`, `₽→RU`). Multi-country symbols (`$`, `€`, `¥`) are intentionally absent. |
| `_cache` | `string \| null` — last computed country, or `null` if no signal. |
| `_isCached` | `boolean` — `true` once `detect()` has run and populated `_cache`. Distinguishes "not yet computed" from "computed but no signal". |

## Public API

### detect() → string | null

**What**: reads live document state and returns the cached country signal. First call walks the inputs (hostname, lang, meta, body sample) and caches; subsequent calls return the cached value until `_resetCache()` is invoked.
**Returns**: ISO 3166 alpha-2 (e.g. `'US'`, `'GB'`, `'IN'`) or `null` when no signal is detected.
**Side effects**:
- First call reads `location.hostname`, `document.documentElement.lang`, `document.querySelectorAll('meta')`, and `document.body.textContent.slice(0, 1000)`.
- Caches result in `_cache` and sets `_isCached = true`.
- Wrapped in try/catch — any DOM access failure returns `null` (defensive for non-browser test environments).
**Use**: facade `pii.scan()` calls this once at the top of every scan and seeds `blsi.PiiState.setCountry(...)` with the result.

### detectFromInputs(inputs) → string | null

**What**: pure function — same signal-derivation logic as `detect()` but takes pre-extracted inputs. Used directly by tests; no DOM access.
**Params**:
- `inputs` — `{ hostname?: string, lang?: string, metas?: NodeList | Array, sample?: string }`. Any field may be omitted; missing fields contribute no signal.
**Returns**: ISO 3166 alpha-2 or `null`.
**Side effects**: none.
**Priority order**:
1. `metas` — `<meta name="geo.country">` / `<meta name="content-language">` / `<meta http-equiv="content-language">` / `<meta property="og:locale">`.
2. `lang` — accepts BCP-47 tags with required region subtag (`en-US`, `en_GB`, `zh-Hant-TW`); bare language (`en`) is rejected.
3. `hostname` — last DNS label looked up against `_TLD_TO_COUNTRY`.
4. `sample` — currency-density density scan in `_CURRENCY_HINT`. Threshold is **3+** occurrences of one symbol.

### _resetCache()

**Side effects**: clears `_cache` and resets `_isCached = false`.
**Use**: tests that need to re-detect after manipulating document state. Future SPA-navigation paths can also call this when `<html lang>` or URL changes meaningfully (PERF.md M6 invalidation).

## Lifecycle

The cache is module-lifetime. `clear()` on the facade does NOT invalidate the country cache (a `clear()` followed by a re-scan still uses the same country). `_resetCache()` is the only way to force a re-detection short of reloading the module.

## Edge cases

- `detect()` in a non-browser environment (no `location`, no `document`) returns `null` (try/catch around the DOM reads).
- `detectFromInputs(null)` / `detectFromInputs(undefined)` → `null` (defensive).
- `<meta name="geo.country" content="USA">` (3 chars) → silently ignored. `_metaCountry` requires exactly 2 letters after upcasing.
- `<meta name="geo.country" content="99">` (digits) → silently ignored.
- `<html lang="en">` (no region) → `null`. The tests document this explicitly.
- ccTLDs deliberately excluded: `.io` (Indian Ocean → tech gTLD), `.me` (Montenegro → personal gTLD), `.tv` (Tuvalu → media gTLD), `.co` (Colombia → corporate gTLD), `.app` / `.dev` / `.ai` (gTLDs).
- Currency-density threshold is `> 2` (i.e., requires 3 or more occurrences). Two `£` symbols in passing don't move the signal.
- Multi-country currency symbols (`$`, `€`, `¥`) are NOT in `_CURRENCY_HINT` — they would degrade precision more than they help.

## Dependencies

None. The module only uses built-in DOM APIs (`location`, `document.documentElement`, `document.querySelectorAll`, `document.body.textContent`) and string methods. Loaded at manifest position 9d — depends on nothing earlier.

## Test contract

See `docs/contracts/pii/pii_country.tests.md`.
