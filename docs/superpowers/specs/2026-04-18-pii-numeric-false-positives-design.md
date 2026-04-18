# PII NUMERIC — False Positives Check Chain

**Date:** 2026-04-18
**Scope:** `src/pii_detector.js`, `src/constants.js`, `popup/popup_configs.js`, `CLAUDE.md`

---

## Problem

`AUTO_DETECT.NUMERIC` in standard mode has zero false-positive suppression. It fires on
years (`2024`), version strings (`v1.2.3`), public product prices (`$49/month`), and
notification/badge counts (`12,345 unread`). The `'off'|'standard'|'conservative'` enum
added surface complexity without giving users meaningful control.

---

## Decision

1. Collapse `AUTO_DETECT.NUMERIC` to a **boolean** — same shape as `EMAIL`.
2. Replace the enum logic with a **falsePositivesCheck chain** inside `pii_detector.js`.
3. A single developer-facing constant `NUMERIC_PROFILE` (`'precise' | 'aggressive'`)
   selects which checks are active. The popup never exposes this — users only see on/off.

---

## Settings Shape Change

**Before:**
```js
settings.AUTO_DETECT = {
  EMAIL:   false,
  NUMERIC: 'off', // 'off' | 'standard' | 'conservative'
}
```

**After:**
```js
settings.AUTO_DETECT = {
  EMAIL:   false,
  NUMERIC: false, // boolean
}
```

- `constants.js` `DEFAULTS.AUTO_DETECT.NUMERIC` changes from `'off'` to `false`.
- All gating code changes from `NUMERIC && NUMERIC !== 'off'` to `Boolean(NUMERIC)`.
- No migration code — old stored string values are treated as falsy on next load (any
  string coerces to `true` via `Boolean()`, but the popup master toggle resets on first
  open so this is acceptable).
- Popup: the NUMERIC dropdown is removed. Master toggle drives EMAIL + NUMERIC together
  as before; no sub-control needed.

---

## Internal Architecture — falsePositivesCheck Chain

### Developer profile constant

```js
// Top of pii_detector.js — flip to switch false-positive strictness.
// 'precise'    → all checks active (fewer matches, fewer FPs)
// 'aggressive' → only high-confidence checks active (more matches)
const NUMERIC_PROFILE = 'precise';
```

### Check signature (contract)

Every false-positive check must conform to:

```js
/**
 * @param {string} matchText  — the matched substring
 * @param {string} text       — full text content of the text node
 * @param {number} matchIndex — start index of match in text
 * @returns {boolean}         — true = suppress this match (it is a false positive)
 */
function isFoo(matchText, text, matchIndex) { ... }
```

### Check definitions

| Check | What it suppresses | aggressive | precise |
|---|---|:---:|:---:|
| `isYear` | 4-digit numbers in range 1000–2099 (dates, copyright years) | — | ✓ |
| `isVersion` | Numbers preceded by `v`/`V` or followed by `.digit` (semver) | ✓ | ✓ |
| `isPublicPrice` | Numbers near `/month`, `/year`, `cart`, `qty`, `units`, `count`, `rating`, `reviews`, `stars` (100-char window) | — | ✓ |
| `isCountNoise` | Numbers near `unread`, `notifications`, `messages`, `followers`, `following`, `likes`, `views`, `comments`, `results`, `items`, `members`, `subscribers`, `posts`, `connections` (150-char window) | — | ✓ |

### Profile config tables

```js
const FALSE_POSITIVE_CHECKS = {
  aggressive: [isVersion],
  precise:    [isYear, isVersion, isPublicPrice, isCountNoise],
};
```

### Integration point

`_findMatches` calls `_falsePositivesCheck(matchText, text, matchIndex)` for every raw
NUMERIC candidate. The function iterates the active profile's check array and returns
`true` if any check fires:

```js
function _falsePositivesCheck(matchText, text, matchIndex) {
  const checks = FALSE_POSITIVE_CHECKS[NUMERIC_PROFILE] || [];
  return checks.some(fn => fn(matchText, text, matchIndex));
}
```

### Deleted code

The following are removed — their logic is absorbed into the new checks:
- `SENSITIVE_LABELS` regex
- `PRICE_SUPPRESSORS` regex
- `_hasContextLabel()` function
- All branching on `types.NUMERIC === 'conservative'`

---

## Check Implementations

### `isYear(matchText, _text, _index)`
```
Suppress if: /^\d{4}$/.test(matchText) && n >= 1000 && n <= 2099
```

### `isVersion(matchText, text, matchIndex)`
```
Suppress if:
  - char at matchIndex - 1 is 'v' or 'V'  (v1234, V2048)
  - matchText is followed by '.' + digit   (3.14, 1.0.0)
```

### `isPublicPrice(matchText, text, matchIndex)`
```
Window: 100 chars before + after match
Suppress if window matches:
  /\/mo(?:nth)?|\/yr(?:ear)?|per month|per year|\bcart\b|\bqty\b|
   \bquantity\b|\bunits\b|\bcount\b|\brating\b|\breviews?\b|\bstars?\b/i
```

### `isCountNoise(matchText, text, matchIndex)`
```
Window: 150 chars before + after match
Suppress if window matches:
  /unread|notifications?|messages?|followers?|following|likes?|views?|
   comments?|results?|items?|members?|subscribers?|posts?|connections?/i
```

---

## Adding a New falsePositivesCheck (for future Claude)

1. Write the function following the check signature contract above.
2. Add it to `FALSE_POSITIVE_CHECKS.precise` (and optionally `aggressive`).
3. Add a unit test in `tests/unit/pii_detector.test.js` covering:
   - At least one true-positive (matching input that must NOT be suppressed)
   - At least one false-positive case (input the check must suppress)
4. Update `docs/TEST_VALIDATION.md` with the new test entry.
5. Document the check in the table above.

Do NOT modify `_findMatches` or the profile dispatch loop — only add check functions and
profile table entries.

---

## Files Changed

| File | Change |
|---|---|
| `src/pii_detector.js` | Boolean gate, NUMERIC_PROFILE constant, FALSE_POSITIVE_CHECKS table, 4 check functions, `_falsePositivesCheck`, remove old conservative logic |
| `src/constants.js` | `DEFAULTS.AUTO_DETECT.NUMERIC: false` |
| `popup/popup_configs.js` | Remove NUMERIC dropdown; master toggle drives both EMAIL+NUMERIC |
| `CLAUDE.md` | Update AUTO_DETECT shape, update pii_detector module rules |
| `tests/unit/pii_detector.test.js` | New tests for each check; remove conservative-mode tests |
| `docs/TEST_VALIDATION.md` | Update PII section |

---

## Out of Scope

- EMAIL false positives (none reported)
- DOM-based suppression (`itemprop="price"`) — deferred, text-window checks sufficient for now
- Schema.org / structured-data signals
- Per-site suppressor overrides
