# PII NUMERIC False-Positives Check Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `AUTO_DETECT.NUMERIC`'s `'off'|'standard'|'conservative'` enum with a boolean, and add an internal `falsePositivesCheck` chain (`isYear`, `isVersion`, `isPublicPrice`, `isCountNoise`) controlled by a developer-facing `NUMERIC_PROFILE` constant.

**Architecture:** Each false-positive check is a pure function `(matchText, text, matchIndex) => boolean`. A `FALSE_POSITIVE_CHECKS` config table maps profile names to the subset of checks to run. `_falsePositivesCheck` dispatches the active profile's checks against every raw NUMERIC candidate in `_findMatches`. Adding a new check is one function + one table entry.

**Tech Stack:** Vanilla JS (IIFE), Jest unit tests, no bundler.

---

## File Map

| File | Change |
|---|---|
| `src/constants.js` | `DEFAULTS.AUTO_DETECT.NUMERIC: false`; simplify `validateSettings` AUTO_DETECT block |
| `src/pii_detector.js` | Add `NUMERIC_PROFILE`, 4 check functions, `FALSE_POSITIVE_CHECKS`, `_falsePositivesCheck`; remove conservative logic; boolean gate |
| `tests/unit/pii_detector.test.js` | Remove 13 string-enum tests; add 12 check-specific tests; update boolean gating tests |
| `popup/popup_configs.js` | Remove NUMERIC `select` entry; update master toggle `getValue` + `expandKeys` |
| `src/content_script.js` | Update NUMERIC gating from string check to `Boolean()` |
| `CLAUDE.md` | Update AUTO_DETECT shape + pii_detector module rules with check pattern |
| `_locales/*/popup.json` | Remove 4 dead NUMERIC-mode keys (`pii_numeric_label/hint/off/standard/conservative`) |
| `docs/TEST_VALIDATION.md` | Update PII section with new/removed tests |

---

## Task 1: Update constants.js — NUMERIC default + validateSettings

**Files:**
- Modify: `src/constants.js`

- [ ] **Step 1: Change NUMERIC default from `'off'` to `false`**

In `src/constants.js`, find the `AUTO_DETECT` defaults block and change:

```js
// BEFORE (line ~183)
AUTO_DETECT: Object.freeze({
  EMAIL:   false,   // email addresses (local@domain.tld)
  NUMERIC: 'off',   // 'off' | 'standard' | 'conservative'
}),
```

```js
// AFTER
AUTO_DETECT: Object.freeze({
  EMAIL:   false,
  NUMERIC: false,
}),
```

- [ ] **Step 2: Simplify `validateSettings` AUTO_DETECT block**

Find the `validateSettings` AUTO_DETECT section (look for `// AUTO_DETECT: EMAIL is boolean`) and replace:

```js
// BEFORE
// AUTO_DETECT: EMAIL is boolean; NUMERIC is 'off'|'standard'|'conservative'
result.AUTO_DETECT = {};
const ad =
  settings.AUTO_DETECT && typeof settings.AUTO_DETECT === "object"
    ? settings.AUTO_DETECT
    : {};
for (const key of Object.keys(defaults.AUTO_DETECT)) {
  if (key === "NUMERIC") {
    result.AUTO_DETECT[key] =
      ["off", "standard", "conservative"].includes(ad[key])
        ? ad[key]
        : defaults.AUTO_DETECT[key];
  } else {
    result.AUTO_DETECT[key] =
      typeof ad[key] === "boolean" ? ad[key] : defaults.AUTO_DETECT[key];
  }
}
```

```js
// AFTER — both EMAIL and NUMERIC are now booleans
result.AUTO_DETECT = {};
const ad =
  settings.AUTO_DETECT && typeof settings.AUTO_DETECT === "object"
    ? settings.AUTO_DETECT
    : {};
for (const key of Object.keys(defaults.AUTO_DETECT)) {
  result.AUTO_DETECT[key] =
    typeof ad[key] === "boolean" ? ad[key] : defaults.AUTO_DETECT[key];
}
```

- [ ] **Step 3: Run tests**

```bash
npm run test:unit
```

Expected: all 535 tests pass. The constants change does not break any existing test — `validateSettings` now accepts booleans, and the string-enum tests in pii_detector.test.js pass `{ NUMERIC: 'standard' }` etc. directly to `scan()`, bypassing `validateSettings`.

- [ ] **Step 4: Commit**

```bash
git add src/constants.js
git commit -m "feat: AUTO_DETECT.NUMERIC default changed from 'off' to false (boolean)"
```

---

## Task 2: Rewrite pii_detector.js internals

**Files:**
- Modify: `src/pii_detector.js`

- [ ] **Step 1: Add `NUMERIC_PROFILE` constant at top of IIFE**

Inside the IIFE, immediately after `"use strict";`, add:

```js
// Developer-facing profile switch. 'precise' runs all false-positive checks.
// 'aggressive' runs only high-confidence checks (isVersion).
// Flip this constant to change strictness — not exposed to users.
const NUMERIC_PROFILE = 'precise'; // 'aggressive' | 'precise'
```

- [ ] **Step 2: Add the four check functions**

Add these four functions after the `PATTERNS` constant and before the `PII_ATTR` line:

```js
// ── False-positive checks ──────────────────────────────────────────────────
// Each check: (matchText, text, matchIndex) => boolean
//   return true  → suppress this match (it is a false positive)
//   return false → keep this match
//
// To add a new check:
//   1. Write a function following the signature above.
//   2. Add it to FALSE_POSITIVE_CHECKS.precise (and optionally .aggressive).
//   3. Add unit tests: one true-positive case + one false-positive case.
//   4. Update docs/TEST_VALIDATION.md and docs/superpowers/specs/2026-04-18-pii-numeric-false-positives-design.md.

function isYear(matchText /*, _text, _index */) {
  if (!/^\d{4}$/.test(matchText)) return false;
  const n = Number(matchText);
  return n >= 1000 && n <= 2099;
}

function isVersion(matchText, text, matchIndex) {
  const before = matchIndex > 0 ? text[matchIndex - 1] : '';
  if (before === 'v' || before === 'V') return true;
  const afterIdx = matchIndex + matchText.length;
  return text[afterIdx] === '.' && /\d/.test(text[afterIdx + 1] || '');
}

const _PUBLIC_PRICE_RE =
  /\/mo(?:nth)?|\/yr(?:ear)?|per month|per year|\bcart\b|\bqty\b|\bquantity\b|\bunits\b|\bcount\b|\brating\b|\breviews?\b|\bstars?\b/i;

function isPublicPrice(_matchText, text, matchIndex) {
  const start = Math.max(0, matchIndex - 100);
  const end   = Math.min(text.length, matchIndex + 100);
  return _PUBLIC_PRICE_RE.test(text.slice(start, end));
}

const _COUNT_NOISE_RE =
  /unread|notifications?|messages?|followers?|following|likes?|views?|comments?|results?|items?|members?|subscribers?|posts?|connections?/i;

function isCountNoise(_matchText, text, matchIndex) {
  const start = Math.max(0, matchIndex - 150);
  const end   = Math.min(text.length, matchIndex + 150);
  return _COUNT_NOISE_RE.test(text.slice(start, end));
}

const FALSE_POSITIVE_CHECKS = Object.freeze({
  aggressive: [isVersion],
  precise:    [isYear, isVersion, isPublicPrice, isCountNoise],
});

function _falsePositivesCheck(matchText, text, matchIndex) {
  const checks = FALSE_POSITIVE_CHECKS[NUMERIC_PROFILE] || [];
  return checks.some(fn => fn(matchText, text, matchIndex));
}
```

- [ ] **Step 3: Remove old conservative-mode globals**

Delete these three declarations from the top of the IIFE:

```js
// DELETE these three:
const SENSITIVE_LABELS =
  /balance|salary|wages|account|invoice|subtotal|total due|amount due|net pay|credit card|card number|ssn|social security|passport|sort code|routing|iban|swift/i;
const PRICE_SUPPRESSORS =
  /\/mo(?:nth)?|\/yr(?:ear)?|per month|per year|\bcart\b|\bqty\b|\bquantity\b|\bunits\b|\bcount\b|\brating\b|\breviews?\b|\bstars?\b/i;

function _hasContextLabel(text, matchIndex) {
  const start = Math.max(0, matchIndex - 100);
  const end = Math.min(text.length, matchIndex + 100);
  const win = text.slice(start, end);
  if (PRICE_SUPPRESSORS.test(win)) return false;
  return SENSITIVE_LABELS.test(win);
}
```

- [ ] **Step 4: Update `_findMatches` — boolean gate + false-positive filter**

Replace the entire NUMERIC block inside `_findMatches`:

```js
// BEFORE
if (types.NUMERIC && types.NUMERIC !== "off") {
  const re = new RegExp(NUMERIC_RE.source, NUMERIC_RE.flags);
  const conservative = types.NUMERIC === "conservative";
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!conservative || _hasContextLabel(text, m.index)) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        type: "numeric",
      });
    }
    if (m[0].length === 0) re.lastIndex++;
  }
}
```

```js
// AFTER
if (types.NUMERIC) {
  const re = new RegExp(NUMERIC_RE.source, NUMERIC_RE.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!_falsePositivesCheck(m[0], text, m.index)) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: "numeric" });
    }
    if (m[0].length === 0) re.lastIndex++;
  }
}
```

- [ ] **Step 5: Update `scan()` — normalize NUMERIC as boolean**

In `scan()`, find the enabledTypes loop and replace the NUMERIC-specific branch:

```js
// BEFORE
if (key === "NUMERIC") {
  // String enum — 'off' is explicitly disabled despite being truthy.
  if (val && val !== "off") {
    enabledTypes[key] = val;
    anyEnabled = true;
  }
} else {
  if (val) {
    enabledTypes[key] = true;
    anyEnabled = true;
  }
}
```

```js
// AFTER — both EMAIL and NUMERIC are booleans
if (val) {
  enabledTypes[key] = true;
  anyEnabled = true;
}
```

- [ ] **Step 6: Run tests (expect failures — string-enum tests not yet updated)**

```bash
npm run test:unit 2>&1 | grep -E "FAIL|PASS|Tests:"
```

Expected: test suite `pii_detector.test.js` fails. Other suites pass. This is expected — Task 3 fixes the tests.

---

## Task 3: Update pii_detector tests

**Files:**
- Modify: `tests/unit/pii_detector.test.js`

- [ ] **Step 1: Remove the 13 string-enum tests**

Delete the following test blocks entirely (find by their `test('...')` name string):

```
"NUMERIC 'off' — no numeric spans created"
"NUMERIC 'off' truthy string does not trigger scan via old some(Boolean) pattern"
"NUMERIC 'standard' — bare 4+ digit number is hidden"
"NUMERIC 'standard' — hides number even with no context label"
"NUMERIC 'standard' — hides $9.99/month (currency prefix matched)"
"NUMERIC 'standard' string — scan runs (not blocked by boolean check)"
"NUMERIC 'conservative' — bare number without label: not hidden"
"NUMERIC 'conservative' — number with Tier A label: hidden"
"NUMERIC 'conservative' — salary label triggers hide"
"NUMERIC 'conservative' — account label triggers hide"
"NUMERIC 'conservative' — invoice label triggers hide"
"NUMERIC 'conservative' — price suppressor prevents hide"
"NUMERIC 'conservative' — qty suppressor prevents hide"
"NUMERIC 'conservative' — public version number not hidden"
"standard hides bare 17150; conservative does not (no label)"
```

Also delete the section header comments for `'off'`, `'standard'`, `'conservative'`, and the mode-contrast block.

- [ ] **Step 2: Update two tests that used string enum values**

Find and update:

```js
// BEFORE
test('all AUTO_DETECT defaults off — scan returns 0', () => {
  document.body.innerHTML = '<p>user@example.com and 17150 and $500</p>';
  const defaultAutoDetect = { EMAIL: false, NUMERIC: 'off' };
  expect(blsi.PiiDetector.scan(document.body, defaultAutoDetect)).toBe(0);
  expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
});
```

```js
// AFTER
test('all AUTO_DETECT defaults off — scan returns 0', () => {
  document.body.innerHTML = '<p>user@example.com and 17150 and $500</p>';
  const defaultAutoDetect = { EMAIL: false, NUMERIC: false };
  expect(blsi.PiiDetector.scan(document.body, defaultAutoDetect)).toBe(0);
  expect(document.querySelector('[data-bl-si-pii]')).toBeNull();
});
```

Also update the test that passes `{ NUMERIC: true }` against a year-range number — the 4-digit number `1234` in "Version 1234 released" is in the year range (1000–2099) and would be suppressed in precise mode. This test was already removed in Step 1 — no further action needed.

- [ ] **Step 3: Add NUMERIC boolean true/false gating tests**

After the existing `'NUMERIC — skips when NUMERIC type disabled'` test, add:

```js
test('NUMERIC true — bare 5-digit number detected', () => {
  document.body.innerHTML = '<p>Account: 17150</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('17150');
});

test('NUMERIC false — no numeric spans created', () => {
  document.body.innerHTML = '<p>Account: 17150</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: false })).toBe(0);
  expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
});
```

- [ ] **Step 4: Add `isYear` check tests**

Add a new section after the gating tests:

```js
// ── falsePositivesCheck: isYear ────────────────────────────────────────────

test('isYear — 4-digit year in 1000–2099 is suppressed', () => {
  // 2024 is a common year, not PII — precise mode suppresses it
  document.body.innerHTML = '<p>Published in 2024.</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
  expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
});

test('isYear — 5-digit number is NOT suppressed as a year', () => {
  document.body.innerHTML = '<p>Account: 20245</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('20245');
});

test('isYear — 4-digit number above 2099 is NOT suppressed', () => {
  // 9999 is out of the year range — kept as potential PII
  document.body.innerHTML = '<p>Error code: 9999</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
});

test('isYear — 4-digit number below 1000 is NOT suppressed as year', () => {
  // No 4-digit number < 1000 can match \b\d{4,}\b — this is a safety assertion
  document.body.innerHTML = '<p>Error code: 999</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});
```

- [ ] **Step 5: Add `isVersion` check tests**

```js
// ── falsePositivesCheck: isVersion ────────────────────────────────────────

test('isVersion — number preceded by lowercase v is suppressed', () => {
  document.body.innerHTML = '<p>Running v17150 build.</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
  expect(document.querySelector('[data-bl-si-pii="numeric"]')).toBeNull();
});

test('isVersion — number preceded by uppercase V is suppressed', () => {
  document.body.innerHTML = '<p>V17150 release notes</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isVersion — number followed by .digit is suppressed', () => {
  document.body.innerHTML = '<p>Build 17150.3 deployed.</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isVersion — bare number with no version context is NOT suppressed', () => {
  // "17150" with space before and space after — not a version
  document.body.innerHTML = '<p>Account 17150 overdue</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('17150');
});
```

- [ ] **Step 6: Add `isPublicPrice` check tests**

```js
// ── falsePositivesCheck: isPublicPrice ────────────────────────────────────

test('isPublicPrice — /month in window suppresses currency amount', () => {
  document.body.innerHTML = '<p>Only $9/month</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isPublicPrice — qty in window suppresses number', () => {
  document.body.innerHTML = '<p>qty: 5000 units</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isPublicPrice — /year in window suppresses number', () => {
  document.body.innerHTML = '<p>$94750/year salary package</p>';
  // "/year" is a public-price signal — suppress
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isPublicPrice — no price context: number is detected', () => {
  document.body.innerHTML = '<p>Account balance: 94750</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('94750');
});
```

- [ ] **Step 7: Add `isCountNoise` check tests**

```js
// ── falsePositivesCheck: isCountNoise ────────────────────────────────────

test('isCountNoise — "unread" in window suppresses number', () => {
  document.body.innerHTML = '<p>12345 unread messages</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isCountNoise — "followers" in window suppresses number', () => {
  document.body.innerHTML = '<p>10234 followers</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isCountNoise — "results" in window suppresses number', () => {
  document.body.innerHTML = '<p>Showing 12345 results</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(0);
});

test('isCountNoise — no count context: number is detected', () => {
  document.body.innerHTML = '<p>Invoice total: 12345</p>';
  expect(blsi.PiiDetector.scan(document.body, { NUMERIC: true })).toBe(1);
  expect(document.querySelector('[data-bl-si-pii="numeric"]').textContent).toBe('12345');
});
```

- [ ] **Step 8: Run tests to green**

```bash
npm run test:unit
```

Expected: all tests pass. Count should be approximately 535 - 15 (removed) + 18 (added) = ~538 tests. Exact count appears in the `Tests:` line — note it for the CLAUDE.md update in Task 6.

- [ ] **Step 9: Commit**

```bash
git add tests/unit/pii_detector.test.js
git commit -m "test: replace string-enum NUMERIC tests with boolean + falsePositivesCheck tests"
```

---

## Task 4: Update popup_configs.js — remove NUMERIC dropdown

**Files:**
- Modify: `popup/popup_configs.js`

- [ ] **Step 1: Remove the NUMERIC `select` entry and simplify the master toggle**

Find the `PII` array in `popup/popup_configs.js` and replace it entirely:

```js
// BEFORE
const PII = Object.freeze([
  {
    key: 'AUTO_DETECT',
    type: 'toggle',
    i18nKey: 'detect_pii',
    i18nHintKey: 'detect_pii_hint',
    group: 'autodetect',
    getValue: (settings) => !!(settings.AUTO_DETECT && (
      settings.AUTO_DETECT.EMAIL ||
      (settings.AUTO_DETECT.NUMERIC && settings.AUTO_DETECT.NUMERIC !== 'off')
    )),
    expandKeys: [
      { key: 'AUTO_DETECT.EMAIL',   onValue: true,       offValue: false },
      { key: 'AUTO_DETECT.NUMERIC', onValue: 'standard', offValue: 'off' },
    ],
  },
  {
    key: 'AUTO_DETECT.NUMERIC',
    type: 'select',
    i18nKey: 'pii_numeric_label',
    i18nHintKey: 'pii_numeric_hint',
    group: 'autodetect',
    options: {
      values: [
        { value: 'off',          i18nKey: 'pii_numeric_off'          },
        { value: 'standard',     i18nKey: 'pii_numeric_standard'     },
        { value: 'conservative', i18nKey: 'pii_numeric_conservative' },
      ],
    },
  },
]);
```

```js
// AFTER
const PII = Object.freeze([
  {
    key: 'AUTO_DETECT',
    type: 'toggle',
    i18nKey: 'detect_pii',
    i18nHintKey: 'detect_pii_hint',
    group: 'autodetect',
    getValue: (settings) => !!(settings.AUTO_DETECT && (
      settings.AUTO_DETECT.EMAIL || settings.AUTO_DETECT.NUMERIC
    )),
    expandKeys: [
      { key: 'AUTO_DETECT.EMAIL',   onValue: true, offValue: false },
      { key: 'AUTO_DETECT.NUMERIC', onValue: true, offValue: false },
    ],
  },
]);
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit
```

Expected: all tests pass. The popup_configs change has no unit test coverage (popup tests are e2e only).

- [ ] **Step 3: Commit**

```bash
git add popup/popup_configs.js
git commit -m "feat: remove NUMERIC mode dropdown — AUTO_DETECT.NUMERIC is now boolean"
```

---

## Task 5: Update content_script.js + locale files

**Files:**
- Modify: `src/content_script.js`
- Modify: `_locales/en/popup.json`, `_locales/hi_IN/popup.json`, `_locales/ta_IN/popup.json`

- [ ] **Step 1: Update NUMERIC gating in content_script.js**

Find the PII auto-detection block (around line 473) and change:

```js
// BEFORE
const anyDetect = settings.AUTO_DETECT && (
  settings.AUTO_DETECT.EMAIL ||
  (settings.AUTO_DETECT.NUMERIC && settings.AUTO_DETECT.NUMERIC !== 'off')
);
```

```js
// AFTER
const anyDetect = settings.AUTO_DETECT && (
  settings.AUTO_DETECT.EMAIL || Boolean(settings.AUTO_DETECT.NUMERIC)
);
```

- [ ] **Step 2: Remove dead locale keys from all three locale files**

In each of `_locales/en/popup.json`, `_locales/hi_IN/popup.json`, `_locales/ta_IN/popup.json`, delete the four keys:

```json
"pii_numeric_label": "...",
"pii_numeric_hint": "...",
"pii_numeric_off": "...",
"pii_numeric_standard": "...",
"pii_numeric_conservative": "...",
```

(Exact translations differ per locale — delete by key name, not value.)

- [ ] **Step 3: Run tests**

```bash
npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/content_script.js _locales/en/popup.json _locales/hi_IN/popup.json _locales/ta_IN/popup.json
git commit -m "feat: simplify NUMERIC gating to Boolean(); remove dead locale keys"
```

---

## Task 6: Update CLAUDE.md + TEST_VALIDATION.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/TEST_VALIDATION.md`

- [ ] **Step 1: Update CLAUDE.md — AUTO_DETECT shape section**

Find the `### Settings Shape: AUTO_DETECT` section and replace the `NUMERIC` comment line:

```js
// BEFORE
settings.AUTO_DETECT = {
  EMAIL:   false,   // boolean — email addresses (local@domain.tld)
  NUMERIC: 'off',   // 'off' | 'standard' | 'conservative'
}
```

```js
// AFTER
settings.AUTO_DETECT = {
  EMAIL:   false,   // boolean — email addresses (local@domain.tld)
  NUMERIC: false,   // boolean — financial numbers, phone-like groups, currency amounts
}
```

Also remove the paragraph referencing the popup NUMERIC dropdown and the master toggle `expandKeys` description mentioning `{ key, onValue, offValue }` objects — replace with: "The master toggle's `expandKeys` sets both `EMAIL` and `NUMERIC` to `true`/`false` atomically."

Remove: **Gate check** — `'off'` is a truthy string; always use explicit check paragraph (no longer needed).

- [ ] **Step 2: Update CLAUDE.md — pii_detector module rules**

Find the `### pii_detector.js` section under `## Critical: Code Patterns` and replace it with:

```markdown
### pii_detector.js
- `EMAIL` is boolean. `NUMERIC` is boolean. Gate with `Boolean(NUMERIC)` — no string enum.
- `NUMERIC_PROFILE` (`'precise' | 'aggressive'`) is a developer-only constant inside the IIFE. Users only see on/off.
- **falsePositivesCheck pattern**: each check is `(matchText, text, matchIndex) => boolean`. Return `true` to suppress. Adding a check: (1) write the function, (2) add to `FALSE_POSITIVE_CHECKS.precise` (and optionally `.aggressive`), (3) add tests, (4) update `docs/TEST_VALIDATION.md` and the design spec.
- `_falsePositivesCheck` runs the active profile's checks. Never put suppression logic directly in `_findMatches`.
- Active profile checks: `precise` = [isYear, isVersion, isPublicPrice, isCountNoise]; `aggressive` = [isVersion].
- `isYear` suppresses 4-digit numbers in 1000–2099 (dates, copyright years).
- `isVersion` suppresses numbers preceded by `v`/`V` or followed by `.digit` (semver build numbers).
- `isPublicPrice` suppresses matches near `/month`, `/year`, `cart`, `qty`, `quantity`, `units`, `count`, `rating`, `reviews`, `stars` (100-char window).
- `isCountNoise` suppresses matches near `unread`, `notifications`, `messages`, `followers`, `following`, `likes`, `views`, `comments`, `results`, `items`, `members`, `subscribers`, `posts`, `connections` (150-char window).
- PII spans carry `[data-bl-si-pii="email"|"numeric"]` only — no `[data-bl-si-blur]`. Independent of blur-all.
- `scan(rootEl, types)` — `TreeWalker(NodeFilter.SHOW_TEXT)` collects all text nodes first, then processes each. Skips extension UI and already-wrapped nodes.
- `clear(rootEl)` — removes all `[data-bl-si-pii]` spans, restores text, resets `_matchCount`.
- `observeMutations(rootEl)` — requires `scan()` first so `_activeTypes` is set.
- `blur_engine.isVisuallyBlurred` returns `true` for `element.dataset.blSiPii` — reveal_controller can find and reveal PII spans.
```

- [ ] **Step 3: Update TEST_VALIDATION.md — PII section**

Find the PII / pii_detector section in `docs/TEST_VALIDATION.md`. Remove entries for all 15 deleted tests. Add entries for the 18 new tests following the existing format (test name, what it asserts, manual replication steps).

Example entry format to follow:
```
**isYear — 4-digit year in 1000–2099 is suppressed**
Asserts: scan() with NUMERIC:true on "Published in 2024." returns 0 and no [data-bl-si-pii] spans.
Manual: Load extension on any page. Enable PII NUMERIC. Open DevTools console. Run: document.body.innerHTML = '<p>Published in 2024.</p>'; BlurrySite... (use blsi.PiiDetector.scan). Verify no span wraps "2024".
```

Update the test count in CLAUDE.md Testing section to the number reported by `npm run test:unit` in Task 3 Step 8.

- [ ] **Step 4: Run tests one final time**

```bash
npm run test:unit
```

Expected: all tests pass. Note the exact test count in the output.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/TEST_VALIDATION.md
git commit -m "docs: update CLAUDE.md + TEST_VALIDATION.md for boolean NUMERIC + falsePositivesCheck pattern"
```
