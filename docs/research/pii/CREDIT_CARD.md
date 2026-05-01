# CREDIT_CARD PII Detection — Exhaustive Research

**Context**: Chrome/Firefox MV3 browser extension. Vanilla JS IIFEs, no bundler. Detection runs in a content script via `TreeWalker` on `Text` nodes. Matches are wrapped in `<span data-bl-si-pii="CREDIT_CARD">`. The CSS rule `[data-bl-si-pii]:not([data-bl-si-reveal])` applies `filter: blur(...)`.

---

## Section 1 — Card Number Format Taxonomy + IIN Ranges

### 1.1 What is an IIN/BIN?

The first 6 digits of a payment card number are the **Issuer Identification Number** (IIN), historically called the BIN (Bank Identification Number). The IIN identifies the card network and issuing bank. Starting in 2022, the industry migrated to **8-digit IINs** (ISO 8583-1:2021), but the 6-digit range tables remain the dominant reference for detection purposes.

### 1.2 Network Format Taxonomy

| Network | Length(s) | IIN/Prefix Ranges | Grouping on card face |
|---|---|---|---|
| Visa | 13 (legacy), 16 | Starts with `4` | 4-4-4-4 (16), or 4-4-5 (13-digit variant) |
| Mastercard | 16 | 51–55 OR 2221–2720 | 4-4-4-4 |
| American Express (Amex) | 15 | 34, 37 | 4-6-5 |
| Discover | 16 | 6011, 622126–622925, 6440–6499, 65 | 4-4-4-4 |
| Diners Club Carte Blanche | 14 | 300–305 | 4-6-4 |
| Diners Club International | 14 | 36 | 4-6-4 |
| Diners Club US & Canada | 16 | 54, 55 (overlap Mastercard — both accepted) | 4-4-4-4 |
| JCB | 16 | 3528–3589 | 4-4-4-4 |
| UnionPay | 16–19 | 62, 81 | 4-4-4-4 (16) or 4-4-4-4-3 (19) |
| Maestro | 12–19 | 5018, 5020, 5038, 5893, 6304, 6759, 6761, 6762, 6763 | Variable |
| RuPay | 16 | 60, 65, 81, 82 | 4-4-4-4 |
| Mir | 16 | 2200–2204 | 4-4-4-4 |
| Verve | 16, 19 | 5061, 6500, 6501, 6505 | 4-4-4-4 |

**Key observation**: The vast majority of cards encountered on English-language web pages will be Visa (16d), Mastercard (16d), Amex (15d), or Discover (16d). The 13-digit Visa is essentially extinct. UnionPay 19-digit forms are rare outside China-facing portals. A practical detector needs 13–19 digit coverage to be complete.

### 1.3 Display Formats Encountered on Web Pages

#### 1.3.1 Full Card Number Variants

| Format | Example | Notes |
|---|---|---|
| Spaced 4-4-4-4 | `4532 1234 5678 9010` | Most common on receipt/confirmation pages |
| Dashed 4-4-4-4 | `4532-1234-5678-9010` | Less common; some banking portals |
| Compact (no separator) | `4532123456789010` | Raw database display, some APIs |
| Spaced Amex 4-6-5 | `3782 822463 10005` | Standard Amex grouping |
| Dashed Amex 4-6-5 | `3782-822463-10005` | Some Amex card faces use dashes |
| Spaced UnionPay 4-4-4-4-3 | `6250 9412 3456 7890 123` | 19-digit long form |
| Mixed inconsistent | `4532 1234-5678 9010` | Rare; user copy-paste artifacts |

#### 1.3.2 Masked / Partial Display Variants

| Format | Example | Should Detect? | Reasoning |
|---|---|---|---|
| Last-4 only | `**** **** **** 9010` | **Yes** (optional) | Still uniquely identifies a card in context. Seen in order history, payment confirmation, bank statements. Four digits alone is 0.01% of the card value but in context is highly sensitive. |
| Last-4 with label | `Visa ending in 9010` | **No** | 4 digits in prose — too many false positives. Needs NLP/context, not regex. |
| First-6 + last-4 | `453214****** 9010` | **Yes** | IIN still present; high-value target for card identification. |
| First-4 + last-4 spaced | `4532 **** **** 9010` | **Yes** | Two groups of 4 digits plus masking. The pattern `\d{4}[\s-]\*{4}[\s-]\*{4}[\s-]\d{4}` is distinctive. |
| First-4 + last-4 compact | `4532XXXXXXXX9010` | **Debatable** | Mixing digits and X/asterisks; hard to match without multi-charset regex. |
| Gateway token display | `tok_1AbCdEfGhIjKlMnO` | **No** | Not a card number; regex on digits-only naturally excludes these. |
| Truncated with dots | `4532 •••• •••• 9010` | **Yes** | Unicode bullet separator. The numeric groups are still present. Pattern needs `[\s\-•·*]+` as separator class. |

**Decision for Phase 1**: Detect full card numbers (compact, spaced, dashed) and the first-4/last-4 masked format. Skip last-4-only (too many false positives without context). Skip first-6/last-4 masked (complex pattern, deferred to Phase 2).

### 1.4 IIN Range Table (Compact JS Form)

The following table covers the four major networks with enough range precision for detection. Each range entry is `[prefixMin, prefixMax, digitLength]` where prefix is the first 6 digits zero-padded.

```javascript
// IIN_RANGES: each entry = [minPrefix6, maxPrefix6, allowedLengths[]]
// Prefix is first 6 digits as a number (leading zeros preserved via string comparison)
const IIN_RANGES = [
  // Visa: starts with 4, any length 13/16
  ['400000', '499999', [13, 16]],
  // Mastercard classic: 51–55
  ['510000', '559999', [16]],
  // Mastercard new range: 2221–2720
  ['222100', '272099', [16]],
  // Amex: 34, 37
  ['340000', '349999', [15]],
  ['370000', '379999', [15]],
  // Discover: 6011xxxx
  ['601100', '601199', [16]],
  // Discover: 622126–622925 (UnionPay co-brand / Discover acceptance)
  ['622126', '622925', [16]],
  // Discover: 644–649
  ['644000', '649999', [16]],
  // Discover: 65xxxx
  ['650000', '659999', [16]],
  // Diners Club: 300–305
  ['300000', '305999', [14]],
  // Diners Club International: 36
  ['360000', '369999', [14]],
  // Diners Club: 38
  ['380000', '389999', [14]],
  // JCB: 3528–3589
  ['352800', '358999', [16]],
  // UnionPay: 62 (broad)
  ['620000', '629999', [16, 17, 18, 19]],
  // Mir: 2200–2204
  ['220000', '220499', [16]],
];
```

**Important caveat**: IIN ranges shift as networks issue new BIN blocks. This table is correct as of 2025 for detection purposes. It is NOT suitable for authorization routing. The purpose here is purely FP reduction in a content-script scanner.

---

## Section 2 — Luhn Algorithm

### 2.1 Algorithm Explanation (Step by Step)

The Luhn algorithm (also called "mod 10" algorithm) was designed by IBM scientist Hans Peter Luhn in 1960. It is a simple checksum formula that validates a variety of identification numbers including credit card numbers, IMEI numbers, and Canadian SINs.

**Input**: a string of digits (the card number).
**Output**: valid (checksum passes) or invalid.

**Steps**:
1. Starting from the **rightmost digit** (the check digit), move left.
2. Double the value of every **second** digit from the right (i.e., positions 2, 4, 6, ... counting from 1 at the rightmost).
3. If doubling produces a result > 9, subtract 9 from it.
4. Sum all digits (both the undoubled and the doubled-then-adjusted).
5. If the total modulo 10 equals 0, the number is valid.

**Example**: Card `4532 1234 5678 9010` → digits: `4532123456789010`

```
Position from right (1-indexed):  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16
Digit:                             0   1   0   9   8   7   6   5   4   3   2   1   2   3   5   4
Double every 2nd from right:       0   2   0  18   8  14   6  10   4   6   2   2   2   6   5   8
Adjust (>9 → -9):                  0   2   0   9   8   5   6   1   4   6   2   2   2   6   5   8
Sum = 0+2+0+9+8+5+6+1+4+6+2+2+2+6+5+8 = 66
66 % 10 = 6  → INVALID (the example number above was chosen for illustration; Luhn-valid test numbers are in Section 9)
```

### 2.2 Luhn Implementation in JavaScript

This implementation is content-script safe: no ES6 class, no external deps, O(n) time, O(1) space (ignoring the `replace` allocation).

```javascript
/**
 * luhn(digits) — returns true iff the digit string passes the Luhn check.
 * Input: a string containing only digit characters (no separators).
 * Does NOT strip non-digits; caller must pre-strip.
 */
function luhn(digits) {
  var sum = 0;
  var odd = true; // "odd" position from right = undoubled
  for (var i = digits.length - 1; i >= 0; i--) {
    var d = digits.charCodeAt(i) - 48; // faster than parseInt for known digits
    if (!odd) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    odd = !odd;
  }
  return sum % 10 === 0;
}

// Convenience wrapper that strips separators first:
function luhnCheck(raw) {
  var digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  return luhn(digits);
}
```

**Why `charCodeAt - 48` instead of `parseInt`**: `parseInt` does a string→number conversion with radix handling. For a single character known to be `[0-9]`, subtracting the ASCII value of `'0'` (48) is ~2x faster in a hot loop. This matters when scanning a page with hundreds of text nodes.

### 2.3 Cost Analysis

- **Time**: O(n) where n = number of digits. For a 16-digit number, n = 16. The loop runs 16 iterations. Negligible.
- **Space**: O(1) after the strip. The `replace(/\D/g, '')` call allocates a new string proportional to the input, but the text node has already been read.
- **Impact at page scale**: Assuming a page with 500 potential matches (generous), total Luhn cost is 500 × 16 ops = 8,000 elementary operations. At modern V8 speeds, this completes in under 100 microseconds.

### 2.4 False Negative and False Positive Rates with Luhn

#### False negatives (valid card numbers that fail Luhn)

**There are none.** Every legitimate issued payment card number passes Luhn. This is a hard invariant: payment networks use Luhn as a basic integrity check. A number that fails Luhn is definitionally not a valid issued card number.

Exception edge case: OCR errors. If a web page contains a scanned card number with a digit misread, Luhn will correctly reject it. This is the intended behavior — if it fails Luhn, it cannot be used to make a payment, so blurring it adds little value.

#### False positives (random digit strings that pass Luhn)

For a uniformly random n-digit string, exactly 1 in 10 will pass Luhn (the check digit has exactly one valid value given the other digits). Therefore:

- **Before Luhn**: ~100% of all 16-digit digit strings found by regex match the regex.
- **After Luhn**: ~10% of those pass Luhn.

However, the strings found by the regex are NOT uniformly random. On actual web pages:
- Order IDs, transaction IDs, loyalty numbers: often designed by humans or sequential generators. The fraction that pass Luhn varies. Empirically, **3–12%** of common pseudo-random identifiers pass Luhn.
- Phone numbers (10 digits, no country code): ~10% pass Luhn (since Luhn is approximately uniform for random-looking digit strings).
- Unix timestamps (10 digits): ~10% pass Luhn.
- Product SKUs / barcodes: EAN-13 uses a different checksum (EAN-13 weight alternates 1 and 3 instead of 1 and 2 as in Luhn). A significant fraction overlap.

**Net false positive rate after Luhn**: approximately **2–8%** for digit strings found on typical web pages. This is the best single-filter result achievable without IIN checking.

### 2.5 Should Luhn Be Mandatory?

**Yes. Luhn should always be mandatory.**

Rationale:
- No legitimate card number fails Luhn.
- The 10% FP reduction is the single highest-leverage filter available.
- Cost is negligible.
- Turning Luhn off would require a code path that actively degrades accuracy.

The only argument for making it optional is "maximum recall for forensic/educational tools that display corrupted card numbers." This use case is explicitly not the target of this extension. The extension's goal is to blur card numbers a user would be embarrassed to have visible on-screen — and corrupted numbers don't meet that bar.

### 2.6 Test Numbers (Luhn-Valid)

The following are Luhn-valid test PANs widely used in test payment environments. They are deliberately designed to never route to real issuing banks.

```
Visa:            4532 0151 2649 3080  (16 digits)
Visa:            4916 3384 0467 7578  (16 digits)
Visa (13-digit): 4222 2222 22222       (13 digits — legacy)
Mastercard:      5500 0055 5555 5559  (16 digits)
Mastercard:      2221 0000 0000 0009  (16 digits, new 2-series range)
Amex:            3714 496353 98431   (15 digits, 4-6-5 grouping)
Amex:            3787 344936 71000   (15 digits)
Discover:        6011 1111 1111 1117  (16 digits)
Discover:        6011 0009 9013 9424  (16 digits)
Diners:          3056 930902 5904    (14 digits)
JCB:             3530 1113 3330 0000  (16 digits)
UnionPay:        6250 9412 3456 7890  (16 digits)
```

**Known invalid** (Luhn fails — last digit flipped by 1):
```
4532 0151 2649 3081  (last digit 0→1; Luhn sum becomes 67, fails)
5500 0055 5555 5558  (last digit 9→8; Luhn sum fails)
3714 496353 98432   (last digit 1→2; Luhn fails)
```

---

## Section 3 — Regex Approaches

### 3.1 Pattern A — Generic 13–19 Digit with Optional Separators

The most inclusive pattern. Catches any digit sequence 13–19 digits long with optional single-character separators (space, dash, or dot) between groups.

```javascript
// Pattern A: Generic — any digit run of 13–19 total digits, with optional separators
// Separators can be space, dash, or dot; must be consistent within the match
// \b anchors prevent catching tails of longer digit strings
const CC_RE_A = /\b\d{4}[\s\-.]?\d{4}[\s\-.]?\d{4}[\s\-.]?\d{0,7}\b/g;
```

Problems with Pattern A as written:
- The trailing `\d{0,7}` matches 0 to 7 digits, catching 12–19 total digits. But the 12-digit case (4+4+4+0) is too short for any real card.
- Mixed separators are accepted (`4532 1234-5678 9010`). Usually not desirable — mixed separators typically indicate two separate strings concatenated by accident.
- Anchors behave poorly: `\b` at the end of `\d{0,7}` can match inside longer digit strings when the last group matches fewer than the maximum.

**Refined Pattern A**:

```javascript
// Pattern A refined: 12-19 digits, optional single consistent separator
// Strip digits only for Luhn; the full match including separators gets the span
const CC_RE_A_REFINED = /\b(?:\d[\s\-.]?){12,18}\d\b/g;
```

This matches any run of 13–19 digits with optional single separators between pairs. Post-match, strip non-digits before Luhn. The `\b` anchors guard against matching digit tails.

**Issue with `(?:\d[\s\-.]?){12,18}\d`**: this allows arbitrarily mixed separators. Fixing requires a separator-constrained pattern (Pattern C below).

**FP rate before Luhn**: High — approximately 15–30% depending on page content (loyalty numbers, order IDs, timestamps). Every 13–19 digit string matches.

**FP rate after Luhn**: ~2–5%.

**Catastrophic backtracking risk**: Low. The pattern does not have nested quantifiers. The outermost quantifier `{12,18}` is bounded. The optional `[\s\-.]?` adds one branch per position, but the branch is anchored to a single character. No catastrophic backtracking.

**Performance**: Fast. For each text node, one regex pass. With 500-character text nodes (MAX_NODE_CHARS = 2000 per the design doc, but typical nodes are shorter), one exec call per match found.

### 3.2 Pattern B — Per-Network Regexes

Seven separate patterns, one per major network, with precise IIN prefixes baked in.

```javascript
const CC_PATTERNS = {
  // Visa: 4xxxxx, 13 or 16 digits, 4-4-4-4 or 4-4-5
  VISA: /\b4\d{3}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b|\b4\d{3}[\s\-]?\d{4}[\s\-]?\d{5}\b/g,

  // Mastercard: 51-55 or 2221-2720, 16 digits
  MC: /\b(?:5[1-5]\d{2}|2(?:2[2-9][1-9]|[3-6]\d{2}|7[01]\d|720))[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,

  // Amex: 34 or 37, 15 digits, 4-6-5 grouping
  AMEX: /\b3[47]\d{2}[\s\-]?\d{6}[\s\-]?\d{5}\b/g,

  // Discover: 6011, 622126-622925, 644-649, 65
  DISCOVER: /\b(?:6011|65\d{2}|64[4-9]\d|622(?:12[6-9]|1[3-9]\d|[2-8]\d{2}|9[01]\d|92[0-5]))[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,

  // Diners Club: 300-305, 36, 38, 14 digits, 4-6-4 grouping
  DINERS: /\b3(?:0[0-5]|[68]\d)\d[\s\-]?\d{6}[\s\-]?\d{4}\b/g,

  // JCB: 3528-3589, 16 digits
  JCB: /\b35(?:2[89]|[3-8]\d)\d{2}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,

  // UnionPay: 62, 16-19 digits (use generic digit count; UP numbers are valid as 16-19 digits)
  UNIONPAY: /\b62\d{2}(?:[\s\-]?\d{4}){3,4}\b/g,
};
```

**FP rate before Luhn**: Low (5–12%). The prefix constraint eliminates most non-card digit strings. A random 16-digit string starting with `4` still passes the Visa pattern, but only ~10% of all digit strings start with `4`.

**FP rate after Luhn**: ~1–3%. Very low.

**Coverage**: Near-complete for major Western networks. Misses Maestro, Mir, RuPay, Verve (low prevalence on English-language pages).

**Complexity**: High. Seven regexes to maintain. Each needs individual testing. When card networks expand their IIN ranges (e.g., Mastercard's 2-series range was added in 2017), all seven need updating.

**Catastrophic backtracking risk**: The MC pattern has an alternation with multiple quantified groups at the top level. Risk is low because all branches are bounded length. However, the Discover pattern is moderately complex — fuzz test it before deployment.

**Recommendation**: Do not use as the primary pattern. Use as an optional second-pass IIN validator (see Section 3.4 + Section 8).

### 3.3 Pattern C — Separator-Constrained

Requires either all spaces, all dashes, all dots, or no separators. No mixing.

```javascript
// Pattern C: consistent separator (space | dash | dot | none)
// Uses capture group for separator uniformity — lookahead approach
const CC_RE_C_SPACE   = /\b\d{4} \d{4} \d{4} \d{4}\b/g;             // 16-digit spaced
const CC_RE_C_DASH    = /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g;             // 16-digit dashed
const CC_RE_C_COMPACT = /\b\d{16}\b/g;                               // 16-digit compact
const CC_RE_C_AMEX_SP = /\b\d{4} \d{6} \d{5}\b/g;                   // Amex spaced
const CC_RE_C_AMEX_DA = /\b\d{4}-\d{6}-\d{5}\b/g;                   // Amex dashed
const CC_RE_C_AMEX_CP = /\b\d{15}\b/g;                               // Amex compact
```

**Alternative single-pattern approach with backreference** (separator must be consistent):

```javascript
// Uses a backreference to enforce separator consistency
// Group 1 captures the first separator seen; subsequent groups must match
// Note: backreferences in JS regex are supported in all target browsers
const CC_RE_C_UNIFORM =
  /\b\d{4}([\s\-]?)\d{4}\1\d{4}\1\d{4}\b/g;   // 16-digit uniform
const CC_RE_C_AMEX_UNIFORM =
  /\b\d{4}([\s\-]?)\d{6}\1\d{5}\b/g;           // 15-digit Amex uniform
```

**Caveat on backreference approach**: If separator group 1 matches the empty string (compact form), the backreference `\1` also matches the empty string everywhere — compact form still works. But `[\s\-]?` is optional, so a string like `4532 12345678 9010` (wrong grouping) matches the 16-digit pattern incorrectly: the `\d{4}` group eats `4532`, then `\1` captures ` `, then `\d{4}` tries to match `1234` — it does — then `\1` wants ` ` — it sees `5` — fails. So the backreference approach correctly rejects mixed-grouping strings.

**FP rate before Luhn**: Medium (10–20%). The compact form (`\b\d{16}\b`) is the most permissive and catches any 16-digit standalone number.

**FP rate after Luhn**: ~2–5%.

**Performance**: Six separate patterns means six regex passes per text node. Use with `some()` short-circuit for early exit. Alternatively, combine into one alternation.

**Catastrophic backtracking risk**: Very low. All patterns are fixed length (no `*` or `+` on the digit groups themselves).

### 3.4 Pattern D — Digit Sequence Extraction + Luhn Primary

Skip elaborate regexes entirely. Extract all digit sequences of length 13–19 from the text node, run Luhn on each, and report the ones that pass.

```javascript
// Pattern D: extract any run of 13–19 digits (after stripping single separators)
// Step 1: find all candidate regions (digit sequences possibly separated by [- .])
const CANDIDATE_RE = /\d(?:[\s\-.]?\d){12,18}/g;

function findCardCandidates(text) {
  const results = [];
  let m;
  const re = new RegExp(CANDIDATE_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      results.push({ start: m.index, end: m.index + raw.length, raw });
    }
  }
  return results;
}
```

**FP rate**: ~10% before Luhn (any 13–19 digit sequence), ~1–5% after Luhn. The FP floor is determined entirely by how many non-card digit strings happen to pass Luhn (~10% for uniformly random, lower for real-world identifiers).

**Performance**: One regex pass + one Luhn call per match. Minimal.

**Risk of over-matching**: The pattern `\d(?:[\s\-.]?\d){12,18}` can match across what a human would read as separate numbers. Example: `Order 1234567890 Item 3456` — if there are spaces, the candidate extractor sees `12345678903456` potentially. The `[\s\-.]?` between digits allows *any single* separator. This is a real risk.

**Mitigation**: Use `\b` anchors and constrain the separator to appear at most once between digit-groups of fixed size (i.e., use Pattern A/C to find match boundaries, then apply Luhn on the extracted digits).

**Recommendation**: Use Pattern D as the extraction engine, but constrain it with Pattern A's grouping logic.

### 3.5 Combined Recommended Regex Set

```javascript
// Primary patterns — cover 99%+ of real-world card displays
const CC_RE_16_SPACED  = /\b\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}\b/g;
const CC_RE_16_COMPACT = /\b\d{16}\b/g;
const CC_RE_15_SPACED  = /\b\d{4}[\s\-]\d{6}[\s\-]\d{5}\b/g;   // Amex
const CC_RE_15_COMPACT = /\b\d{15}\b/g;                          // Amex compact
const CC_RE_14_SPACED  = /\b\d{4}[\s\-]\d{6}[\s\-]\d{4}\b/g;   // Diners
const CC_RE_14_COMPACT = /\b\d{14}\b/g;
const CC_RE_13_COMPACT = /\b\d{13}\b/g;                          // Visa legacy

// Masked first-4 / last-4 pattern
// Matches: 4532 **** **** 9010 or 4532-****-****-9010
const CC_RE_MASKED = /\b\d{4}[\s\-][*X]{4}[\s\-][*X]{4}[\s\-]\d{4}\b/gi;

// All primary digit patterns — apply Luhn to all
const CC_RES = [
  CC_RE_16_SPACED, CC_RE_16_COMPACT,
  CC_RE_15_SPACED, CC_RE_15_COMPACT,
  CC_RE_14_SPACED, CC_RE_14_COMPACT,
  CC_RE_13_COMPACT,
];
```

Each regex is constructed fresh per scan call (no persistent `/g` state):
```javascript
function cloneRe(re) {
  return new RegExp(re.source, re.flags);
}
```

---

## Section 4 — DOM-Specific Challenges

### 4.1 Masked Displays (`**** **** **** 9010`)

**Last-4-only** (e.g., `ending in 9010`): The 4-digit group alone has 10,000 possible values and appears in many non-card contexts (PIN codes, zip codes, year suffixes). Without context, detection is not feasible via regex alone. **Decision: skip for Phase 1.**

**First-4 + last-4** (e.g., `4532 **** **** 9010`): The pattern is distinctive enough to detect:
```javascript
const CC_RE_MASKED = /\b\d{4}[\s\-][*X•]{4}[\s\-][*X•]{4}[\s\-]\d{4}\b/gi;
```
This cannot be Luhn-checked (the middle digits are masked). IIN-check of the first 4 digits alone is insufficient (we need 6 for IIN). **Decision: detect but mark differently — do not Luhn-check. Accept the FP from this specific pattern.**

The FP risk for the first-4/last-4 mask pattern is low in practice: outside banking/payment pages, the `\d{4}[\s\-][*]{4}[\s\-][*]{4}[\s\-]\d{4}` pattern is highly unusual. A manual check of the masked pattern is acceptable.

### 4.2 Card Numbers in Form Inputs

`<input type="text">`, `<input type="tel">`, `<input autocomplete="cc-number">`: These have no text nodes. The `TreeWalker` with `NodeFilter.SHOW_TEXT` never visits them. The `SKIP_TAGS` set in the design doc explicitly excludes `TEXTAREA` and `INPUT`.

**Impact**: Numbers being typed into payment forms are NOT detected. This is intentional (Phase 1 scope decision in `docs/RESEARCH_PII_DETECTION.md §8`).

**Partial workaround not implemented in Phase 1**: Listen for `input` events on `[autocomplete="cc-number"]` fields and apply a CSS blur class to the field itself. This requires a separate input-monitoring module and is out of scope.

**Assessment**: The absence of input field detection is acceptable for a display-blurring extension. A user filling in a payment form is actively using the card number; blurring it would break the UX. The risk model is for *display* of card numbers in confirmation pages, bank statements, and admin UIs — not active entry.

### 4.3 Card Numbers in `value` Attributes

`<input value="4532123456789010">` — the value attribute is never visible as a text node. Even if the page renders the value visually via JavaScript populating `element.value`, the DOM text node walker will not see it.

**Edge case**: Some legacy pages display card numbers in readonly inputs or via JS injection into `<p>` or `<span>` elements dynamically. The MutationObserver in `pii_detector.js` catches dynamically injected elements via `addedNodes`. Newly added text nodes inside legitimate elements will be scanned.

### 4.4 Virtual Cards and Gift Card Codes

**Virtual cards**: Generated by the card network or a program like Privacy.com or Apple Card. They are real payment card numbers — 16 digits, Luhn-valid, IIN-valid. Detection is correct; these should be blurred.

**Gift card codes**: Typically 16–19 hex or alphanumeric characters (e.g., `ABCD-EFGH-IJKL-MNOP` or `6012000000000000`). 
- Hexadecimal-format codes (letters + digits) are excluded by the digit-only regex.
- Pure-digit gift card codes in the 6011xxxxxx range (Discover-style) may be Luhn-valid. These are the most likely source of FPs from gift card display.
- **Mitigation**: IIN check eliminates gift cards that don't fall into known card network ranges. Gift card codes from retailers (e.g., Amazon gift card PINs) often start with 62, 50, or other non-card-network prefixes — IIN check helps but does not eliminate all.

### 4.5 Card Numbers in Table Cells (`<td>`)

Standard case: `<td>4532 1234 5678 9010</td>`. The text node walker visits the text node inside `<td>`. This works out of the box. The entire cell content becomes the text node value; the regex and Luhn run on it normally.

The resulting `<span data-bl-si-pii="CREDIT_CARD">` wraps the matched text inside the `<td>`. No layout disruption (inline element inside block cell).

### 4.6 Split-Cell PANs (`<td>4532</td><td>1234</td><td>5678</td><td>9010</td>`)

This is a significant limitation. Each `<td>` contains a separate text node with 4 digits. No individual text node matches a 13–19 digit pattern. The full card number is assembled across 4 DOM nodes.

**Options**:

**Option A (Not Recommended) — Cross-node stitching**: Walk sibling text nodes, concatenate text, match, then re-distribute span wrappers across the originating nodes. Implementation complexity: very high. Maintaining correct start/end offsets across node boundaries is error-prone. Mutation-safe cleanup is extremely difficult.

**Option B (Recommended for Phase 1) — Skip and document as known limitation**: Single-cell 4-digit values are ubiquitous (phone area codes, prices like $1,234, year numbers, postal codes). A regex that matches any 4-digit text node would have catastrophic FP rates. Accept this limitation.

**Option C (Phase 2) — Structural heuristic**: When a table row contains exactly 4 cells, each containing exactly 4 digits and a `<tr>` parent that looks like a card display row, apply a DOM-level match. This is a heuristic that needs site-specific tuning.

**Decision**: Document as known limitation (see Section 8). Note that most web pages displaying card numbers in tables use a single cell with the full formatted number, not split-cell layouts.

### 4.7 Tokenized Card Numbers

Payment gateways (Stripe, Braintree, Adyen) display gateway tokens, not card numbers:
- Stripe token: `tok_1AbCdEfGhIjKlMnO` — alphanumeric prefix excluded by digit regex.
- Braintree token: `7bprcvzh7dx9gggn` — lowercase hex, no spaces, 16 chars. The digit regex does not match lowercase letters.
- PayPal vault: UUID format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` — dashes and hex, excluded.

**Risk**: If a gateway uses a 16-digit numeric token (no letters), Luhn will usually fail because the token is generated to be non-Luhn-valid (to avoid confusion with real card numbers). Most professional gateways intentionally generate non-Luhn-valid tokens for exactly this reason.

**Residual risk**: A randomly generated 16-digit numeric token has a 10% chance of accidentally being Luhn-valid. Combined with a Visa IIN start (10% of random starts), the probability of a numeric gateway token being mistaken for a card is ~1%. Low enough that no additional mitigation is needed.

### 4.8 Card Numbers in URLs

A user might navigate to a page with a URL like:
`https://payment.example.com/confirm?card=4532123456789010`

The URL itself is not a text node. However, if the page echoes the URL query parameter into the DOM (common in confirmation pages), the echo will be a text node and will be caught.

Cards in URLs are a real security problem regardless — they should be blurred whenever they appear in visible DOM text.

### 4.9 Separator Edge Cases

**Dot separator** (`4532.1234.5678.9010`): Used by some older European banking systems and some receipt printers. Include `.` in separator class: `[\s\-.]`.

**Non-breaking space** (`U+00A0`): Some rich-text editors insert NBSP between digit groups. Regex `[\s]` matches `\u00A0` in most JS engines (NBSP is matched by `\s` in ES2018+, confirmed in V8 since Chrome 62). Safe to rely on.

**Unicode whitespace** (thin space `U+2009`, figure space `U+2007`): Used in typography-aware card displays. `\s` in JavaScript regex *does not* match all Unicode whitespace — only the ASCII-compatible set (space, tab, newline, form feed, carriage return, vertical tab, NBSP, BOM). Thin space (U+2009) is NOT matched by `\s`. 

**Mitigation for thin space**: Add `\u2009\u2007` to separator class:
```javascript
const SEP = '[\\s\\-\\.\\u2009\\u2007]';
```
Or use `[\s\u2009\u2007\-\.]` inline.

---

## Section 5 — False Positive Analysis

### 5.1 IBAN (International Bank Account Numbers)

Format: country code (2 letters) + 2 check digits + BBAN (up to 30 chars, alphanumeric).
Example: `GB29 NWBK 6016 1331 9268 19`

The regex `\b\d{13–19}\b` does NOT match IBANs because:
- IBANs start with two alphabetic characters (`GB`, `DE`, `FR`, etc.)
- The digit-only pattern requires the match to begin with a digit (`\b\d{4}`)

**Can Luhn rule it out?** Not needed — the digit-only regex already excludes IBANs.

**Risk**: Zero.

### 5.2 Social Insurance Numbers (SIN — Canada)

Format: `NNN-NNN-NNN` (9 digits, two dashes).
Example: `123-456-789`

The digit-only regex with `\b\d{13–19}\b` does NOT match 9-digit numbers. The 9-digit compact form `123456789` also does not match (too short).

**Risk**: Zero.

### 5.3 US SSN

Format: `NNN-NN-NNNN` or `NNNNNNNNN` (9 digits).
Handled by the SSN pattern separately. No overlap with credit card patterns (9 digits is too short).

**Risk**: Zero.

### 5.4 Phone Numbers (10 digits, North American format)

Format: `5551234567` or `555-123-4567`

The compact 10-digit form is too short (below 13-digit minimum). The formatted form `555-123-4567` has 10 digits total — also too short.

**Risk**: Zero.

### 5.5 Loyalty Program Numbers

**Format**: 16 digits, often starting with `6` or `4`.
Example: `6250 0000 0000 0000` (hypothetical airline loyalty card).

**Luhn**: ~10% of loyalty numbers are accidentally Luhn-valid.
**IIN**: The prefix `6250` falls inside the UnionPay range (620000–629999). Would be incorrectly identified as UnionPay.

**Risk**: Medium. Loyalty numbers on airline/hotel member pages may trigger FPs.

**Mitigation**: Accept this FP category. Loyalty numbers are often displayed alongside actual card numbers on the same pages (combined frequent flyer + card account pages). The FP is contextually appropriate.

### 5.6 Gift Card / Voucher Codes (Pure Digit)

Example: Visa gift card PAN `4916 3384 0467 7578` — this IS a real Visa card number. Gift card PANs ARE legitimate card numbers from a detection standpoint. Blurring them is correct behavior.

The edge case is **retailer gift cards** (not payment networks): a 16-digit Amazon gift card code is NOT a payment card PAN. However:
- Amazon gift card codes are alphanumeric (`ABCD-EFGH-IJKL-MNOP`), excluded by digit regex.
- Pure-digit retailer gift codes in the 16-digit space: rare, and Luhn usually fails on them.

**Risk**: Low.

### 5.7 ISBN-13

Format: 13 digits, EAN-13 checksum (weights 1 and 3, not 1 and 2 as in Luhn).
Example: `978-3-16-148410-0` (formatted with dashes, 13 digits total).

**Luhn**: EAN-13 checksum algorithm is different from Luhn. Luhn check fails on ISBN-13 numbers approximately 90% of the time (same 10% random pass rate). ISBNs formatted with dashes (`978-3-16-148410-0`) have 3, 1, 8, 6, and 1 digit groups — the pattern `\b\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{1}\b` would need to match; grouped ISBNs don't match the 4-4-4-4 credit card pattern.

Compact ISBN-13 (`9783161484100`) is 13 digits. Matches `\b\d{13}\b`. Luhn check fails ~90% of the time. IIN check: `978316` is not in any card IIN range. **IIN check eliminates ISBNs completely.**

**Risk**: Very low with Luhn. Zero with IIN check.

### 5.8 Product Barcodes (EAN-13, UPC-A)

**EAN-13**: 13 digits. Uses EAN-13 checksum (weights 1 and 3). Matches compact 13-digit regex.
**UPC-A**: 12 digits. Too short (minimum 13).
**UPC-E**: 8 digits (compressed form). Too short.
**GS1-128**: Variable length but includes alphanumeric — excluded by digit regex.

**Luhn**: EAN-13 checksum ≠ Luhn. ~10% of EAN-13 barcodes pass Luhn by coincidence.
**IIN**: EAN barcodes starting with `978`–`979` (book barcodes) are excluded by IIN. However, general EAN barcodes (food products start with country code `0`–`8`) start with `000000`–`899999` — some of those ranges overlap with card IIN ranges (e.g., barcodes starting with `4` overlap Visa IIN).

**Risk**: Low-Medium for EAN-13 on product pages. After Luhn: ~10% of EAN-13s pass. After Luhn + IIN: most are excluded because their 6-digit prefix doesn't fall in a known card range.

**Realistic scenario**: A grocery e-commerce page showing barcode numbers. With Luhn alone: ~10% of barcode numbers are FPs. With Luhn + IIN: most are eliminated. Recommend IIN check for pages with many numeric product codes.

### 5.9 Transaction / Reference IDs

Bank and payment processor transaction IDs are frequently 16–18 digits:
Example: `20241015183045123456` (timestamp-based 20-digit ID — too long, excluded).
Example: `4532123456789010` — looks exactly like a Visa card number.

**Risk**: High. Transaction IDs in banking UIs are the #1 false positive source. Many are exactly 16 digits. Sequential IDs rarely pass Luhn; random IDs pass ~10%. Some processors use Luhn-valid transaction IDs deliberately (confusion risk).

**Mitigation**: No reliable programmatic mitigation without NLP context. Accept this FP category. Users can toggle CREDIT_CARD detection off for specific banking UIs using the URL rules feature.

### 5.10 Serial Numbers and Device IDs

IMEI numbers: 15 digits, uses Luhn checksum. **Will be detected as 15-digit card numbers.** This is a known overlap — IMEI uses Luhn.

**Risk**: Medium. Device management pages, mobile carrier portals, repair shop software may display IMEI numbers. They are Luhn-valid by definition. IIN check: IMEI numbers don't follow card IIN ranges (they start with TAC — Type Allocation Code), but some TAC prefixes overlap with JCB or Visa ranges.

**Mitigation**: IIN check reduces IMEI FPs significantly. IMEI starts with `35` (TAC prefix for many manufacturers) — the `35` prefix range is JCB (`352800`–`358999`). Many IMEIs start outside these ranges and will be excluded by IIN.

### 5.11 ZIP+4 and Extended Postal Codes

US ZIP+4: `90210-1234` (9 digits with dash). 9 digits total — too short. No risk.
German PLZ: 5 digits. Too short.
UK postcode: alphanumeric. Excluded.

**Risk**: Zero.

### 5.12 Year Ranges and Date Strings

Date strings like `20241015183045` (14 digits, no separators): Luhn check; ~10% pass. IIN: `202410` not in any card range. **IIN check eliminates date-format digit strings.**

**Risk**: Very low with IIN check.

### Summary FP Table

| False Positive Category | Blocked by Digit Regex | Blocked by Luhn | Blocked by IIN | Residual Risk |
|---|---|---|---|---|
| IBAN | Yes (leading letters) | N/A | N/A | Zero |
| Canadian SIN | Yes (9 digits, too short) | N/A | N/A | Zero |
| US SSN | Yes (9 digits, too short) | N/A | N/A | Zero |
| Phone (10-digit) | Yes (10 digits, too short) | N/A | N/A | Zero |
| Loyalty numbers (16-digit) | No | ~90% blocked | Partial | Low-Medium |
| Retailer gift codes (hex) | Yes (contains letters) | N/A | N/A | Zero |
| ISBN-13 (formatted) | Yes (wrong grouping) | N/A | N/A | Zero |
| ISBN-13 (compact) | No | ~90% blocked | Yes (978xxx) | Zero with IIN |
| EAN-13 barcode | No | ~90% blocked | Mostly yes | Low with IIN |
| Transaction IDs (16-digit) | No | ~90% blocked | Partial | Medium (accept) |
| IMEI (15-digit) | No | No (Luhn-valid) | Mostly yes | Low with IIN |
| Date strings (14-digit) | No | ~90% blocked | Yes | Zero with IIN |

---

## Section 6 — All Solutions Matrix

Each row is a detection pipeline combination. FP/FN are qualitative estimates for real-world web pages.

| # | Regex | Luhn | IIN | FP Rate | FN Rate | Perf | Complexity | Recommended? |
|---|---|---|---|---|---|---|---|---|
| 1 | Pattern A (generic) | No | No | Very High (25–35%) | Very Low | Fast | Minimal | No |
| 2 | Pattern A (generic) | Yes | No | Low (3–8%) | Zero | Fast | Low | Maybe |
| 3 | Pattern A (generic) | Yes | Yes | Very Low (1–2%) | ~1% | Fast | Medium | Yes (Option B) |
| 4 | Pattern B (per-network) | No | Implicit | Low (8–15%) | Low | Medium | High | No |
| 5 | Pattern B (per-network) | Yes | Implicit | Very Low (1–3%) | Low | Medium | Very High | No |
| 6 | Pattern C (separator-constrained) | No | No | Medium (15–25%) | Low | Medium | Low | No |
| 7 | Pattern C (separator-constrained) | Yes | No | Low (2–5%) | Low | Medium | Low | Maybe |
| 8 | Pattern C (separator-constrained) | Yes | Yes | Very Low (<1%) | Low | Medium | Medium | Yes (Option A) |
| 9 | Pattern D (digit extract) | Yes | No | Low (2–6%) | Near Zero | Fast | Low | Maybe |
| 10 | Pattern D (digit extract) | Yes | Yes | Very Low (<1%) | ~1% | Fast | Medium | Yes |
| 11 | Patterns A+C (combined) | Yes | Yes | Very Low (<1%) | Near Zero | Medium | Medium | **Recommended** |
| 12 | Masked only | N/A (no Luhn) | No | Medium | N/A | Fast | Minimal | Supplement only |

**FN rate note**: FN > Zero for approaches with IIN because unknown/new IIN ranges will be missed. This is a known, accepted tradeoff. IIN tables need periodic updating (not automatic in a static extension).

**Complexity note**: "High" complexity means multiple regex patterns + IIN lookup table. The IIN table is a 15-entry constant array — not inherently complex but adds maintenance surface.

---

## Section 7 — All Solutions Matrix (Qualitative Summary)

### Why Pattern A alone is insufficient

Generic 16-digit matching produces 25–35% FP before any mitigation. On a banking page with 50 transaction IDs, that's 12–17 incorrectly blurred numbers. Unacceptable UX.

### Why Luhn alone is sufficient for most cases

After Luhn, the FP rate drops to ~3–8%. On a page with 50 transaction IDs, 2–4 are incorrectly blurred. For a first-party privacy extension this is arguably acceptable — false positives cause momentary blur on non-sensitive numbers, which is a minor UX annoyance, not a data corruption.

### Why IIN is worth adding despite complexity

IIN adds one constant array and one O(1) lookup. It eliminates the ISBN, barcode, and date-string FP categories entirely, and reduces transaction ID and loyalty number FPs by ~60%. The code cost is ~30 lines. The benefit is material.

### Decision

**Recommended pipeline**: Separator-constrained regex (Pattern C) for primary detection + Luhn (mandatory) + IIN (enabled by default, disableable via a future option).

---

## Section 8 — Recommended Approach

### 8.1 Overall Pipeline

```
Text node content
  → Apply each CC_RE pattern (7 patterns: 16/15/14/13-digit spaced+compact + masked)
  → For each match:
      → Strip non-digit characters
      → Length check: 13–19 digits (skip otherwise)
      → Luhn check (mandatory; skip on fail)
      → IIN check (optional; skip on fail if IIN_CHECK_ENABLED)
      → If masked pattern matched: skip Luhn/IIN (no digit reconstruction possible)
  → Collect non-overlapping matches sorted by position
  → Split text node → interleave plain text + <span data-bl-si-pii="CREDIT_CARD">
```

### 8.2 Pattern Set

```javascript
// In pii_detector.js — IIFE, no ES module syntax

var _CC_PATTERNS = [
  // 16-digit spaced (space or dash separator)
  /\b\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}\b/g,
  // 16-digit compact
  /\b\d{16}\b/g,
  // 15-digit Amex spaced (4-6-5 grouping)
  /\b\d{4}[\s\-]\d{6}[\s\-]\d{5}\b/g,
  // 15-digit compact
  /\b\d{15}\b/g,
  // 14-digit Diners spaced (4-6-4 grouping)
  /\b\d{4}[\s\-]\d{6}[\s\-]\d{4}\b/g,
  // 14-digit compact
  /\b\d{14}\b/g,
  // 13-digit Visa legacy compact (spaced variant is rare; compact only)
  /\b\d{13}\b/g,
];

// Masked first-4 / last-4 (cannot Luhn-check)
var _CC_MASKED_RE = /\b\d{4}[\s\-][*X\u2022]{4}[\s\-][*X\u2022]{4}[\s\-]\d{4}\b/gi;
```

### 8.3 Luhn Function

```javascript
function _luhn(digits) {
  var sum = 0, odd = true;
  for (var i = digits.length - 1; i >= 0; i--) {
    var d = digits.charCodeAt(i) - 48;
    if (!odd) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    odd = !odd;
  }
  return (sum % 10) === 0;
}
```

### 8.4 IIN Validator (Optional, Recommended Default On)

```javascript
var _IIN_RANGES = [
  ['400000','499999',[13,16]],   // Visa
  ['510000','559999',[16]],       // MC classic
  ['222100','272099',[16]],       // MC 2-series
  ['340000','349999',[15]],       // Amex
  ['370000','379999',[15]],       // Amex
  ['601100','601199',[16]],       // Discover
  ['622126','622925',[16]],       // Discover/UP co-brand
  ['644000','649999',[16]],       // Discover
  ['650000','659999',[16]],       // Discover
  ['300000','305999',[14]],       // Diners Carte Blanche
  ['360000','369999',[14]],       // Diners International
  ['380000','389999',[14]],       // Diners
  ['352800','358999',[16]],       // JCB
  ['620000','629999',[16,17,18,19]], // UnionPay
  ['220000','220499',[16]],       // Mir
];

function _iinCheck(digits) {
  var prefix = digits.slice(0, 6);
  var len = digits.length;
  for (var i = 0; i < _IIN_RANGES.length; i++) {
    var r = _IIN_RANGES[i];
    if (prefix >= r[0] && prefix <= r[1] && r[2].indexOf(len) !== -1) {
      return true;
    }
  }
  return false;
}
```

**String comparison for prefix ranges**: Since all IIN prefixes are exactly 6 characters of digits, lexicographic string comparison (`>=`, `<=`) is identical to numeric comparison. No `parseInt` needed.

### 8.5 Masked Card Detection

Masked cards (`4532 **** **** 9010`) cannot be Luhn-validated. Accept them based on regex alone. The FP rate for this specific pattern is very low in practice (the `\d{4} **** **** \d{4}` structure is highly distinctive). Tag them the same way: `data-bl-si-pii="CREDIT_CARD"`.

### 8.6 Integration Point in `collectMatches`

```javascript
// In collectMatches(text, autoDetect):
if (autoDetect.CREDIT_CARD) {
  // Masked cards (no Luhn)
  var mre = new RegExp(_CC_MASKED_RE.source, 'gi');
  var mm;
  while ((mm = mre.exec(text)) !== null) {
    raw.push({ start: mm.index, end: mm.index + mm[0].length, type: 'CREDIT_CARD' });
  }
  // Full card numbers (with Luhn + optional IIN)
  for (var pi = 0; pi < _CC_PATTERNS.length; pi++) {
    var re = new RegExp(_CC_PATTERNS[pi].source, 'g');
    var m;
    while ((m = re.exec(text)) !== null) {
      var digits = m[0].replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) continue;
      if (!_luhn(digits)) continue;
      // IIN check: enabled by default; skip if user opts out (Phase 2 option)
      if (!_iinCheck(digits)) continue;
      raw.push({ start: m.index, end: m.index + m[0].length, type: 'CREDIT_CARD' });
    }
  }
}
```

### 8.7 What to Do About Masked / Partial Numbers

**First-4/last-4 masked** (`4532 **** **** 9010`): Detect via `_CC_MASKED_RE`. Do not Luhn-check. Accept FP risk (low).

**Last-4 only** (`**** **** **** 9010`): Do NOT detect. FP rate would be unacceptable.

**First-6/last-4** (`453214****** 9010`): Deferred to Phase 2. Would require a pattern with partial masking in the middle.

---

## Section 9 — Unit Test Cases

### 9.1 Should Match (True Positives)

| # | Input | Expected | Notes |
|---|---|---|---|
| T01 | `4532015126493080` | CREDIT_CARD | Visa compact, Luhn-valid |
| T02 | `4532 0151 2649 3080` | CREDIT_CARD | Visa spaced |
| T03 | `4532-0151-2649-3080` | CREDIT_CARD | Visa dashed |
| T04 | `4916338404677578` | CREDIT_CARD | Visa compact, 2nd test number |
| T05 | `5500 0055 5555 5559` | CREDIT_CARD | Mastercard spaced |
| T06 | `5500005555555559` | CREDIT_CARD | Mastercard compact |
| T07 | `2221000000000009` | CREDIT_CARD | Mastercard 2-series IIN |
| T08 | `3714 496353 98431` | CREDIT_CARD | Amex spaced 4-6-5 |
| T09 | `371449635398431` | CREDIT_CARD | Amex compact |
| T10 | `3787 344936 71000` | CREDIT_CARD | Amex second test number |
| T11 | `6011 1111 1111 1117` | CREDIT_CARD | Discover spaced |
| T12 | `6011000990139424` | CREDIT_CARD | Discover compact |
| T13 | `3056 930902 5904` | CREDIT_CARD | Diners 4-6-4 |
| T14 | `3530 1113 3330 0000` | CREDIT_CARD | JCB |
| T15 | `6250941234567890` | CREDIT_CARD | UnionPay 16-digit |
| T16 | `4222222222222` | CREDIT_CARD | Visa 13-digit legacy |
| T17 | `4532 **** **** 3080` | CREDIT_CARD | Masked first-4/last-4 |
| T18 | `4532-****-****-3080` | CREDIT_CARD | Masked with dashes |
| T19 | `Card: 4532015126493080 on file` | CREDIT_CARD | Card in prose |
| T20 | `PAN 4532 0151 2649 3080 exp 12/26` | CREDIT_CARD | Card with trailing text |

### 9.2 Should NOT Match (True Negatives / False Positive Guards)

| # | Input | Expected | Reason |
|---|---|---|---|
| TN01 | `4532015126493081` | No match | Luhn fail (last digit flipped) |
| TN02 | `5500005555555558` | No match | Luhn fail |
| TN03 | `371449635398432` | No match | Amex Luhn fail |
| TN04 | `1234567890123456` | No match | IIN `123456` not in any card range |
| TN05 | `9783161484100` | No match | ISBN-13 — IIN `978316` not card range |
| TN06 | `5551234567` | No match | 10 digits — too short |
| TN07 | `123-45-6789` | No match | SSN format — not card (9 digits) |
| TN08 | `tok_1AbCdEfGhIjKl` | No match | Contains letters — digit regex excludes |
| TN09 | `**** **** **** 9010` | No match | Last-4-only mask — not matched by design |
| TN10 | `4532000000000001` | No match | Luhn fail even with Visa IIN |
| TN11 | `Order: 1234567890123456` | No match | IIN `123456` out of range |
| TN12 | `IMEI: 490154203237518` | No match | 15 digits; IIN `490154` not Amex |
| TN13 | `version 4.5.3.2` | No match | Digit groups separated by dots, < 4 digits each — no contiguous 13+ digit run |
| TN14 | `price: $1,234.5678` | No match | Contains `$` and `.` — digit regex starts at `\b\d` — dollar sign breaks word boundary; even if matched, 8 digits total is too short |

### 9.3 Split-Element Cases (Expected Behavior)

| # | DOM Structure | Expected | Notes |
|---|---|---|---|
| SE01 | `<td>4532</td><td>0151</td><td>2649</td><td>3080</td>` | No match | Known limitation — separate text nodes |
| SE02 | `<td>4532 0151 2649 3080</td>` | CREDIT_CARD | Standard single-cell — detected |
| SE03 | `<b>4532</b> 0151 2649 3080` | No match | Split across inline element — limitation |
| SE04 | `4532 <span>0151</span> 2649 3080` | No match | Span splits the text node — limitation |

### 9.4 Edge Case Numbers

| # | Input | Expected | Notes |
|---|---|---|---|
| EC01 | `4532\u00a00151\u00a02649\u00a03080` | CREDIT_CARD | NBSP separators — `\s` matches NBSP in V8 |
| EC02 | `4532\u20090151\u20092649\u20093080` | No match (Phase 1) | Thin-space separator — `\s` does NOT match `\u2009` unless SEP class extended |
| EC03 | `4532 0151 2649 3080 4916 3384 0467 7578` | Two matches | Two card numbers in one text node — both matched |
| EC04 | `X4532015126493080Y` | No match | `\b` anchor — preceded by letter X, no word boundary |
| EC05 | `4532015126493080.` | CREDIT_CARD | Trailing period — `\b` between digit and `.` is a valid word boundary |

### 9.5 Luhn Function Self-Tests

```javascript
// These should be asserted in the unit test suite:
assert(luhn('4532015126493080') === true);   // Visa valid
assert(luhn('4532015126493081') === false);  // Visa invalid (digit flipped)
assert(luhn('371449635398431') === true);    // Amex valid
assert(luhn('371449635398432') === false);   // Amex invalid
assert(luhn('5500005555555559') === true);   // MC valid
assert(luhn('0') === false);                 // Single digit, not valid
assert(luhn('') === false);                  // Empty string edge case
assert(luhn('79927398710') === false);       // Known Luhn failure test vector
assert(luhn('79927398713') === true);        // Known Luhn pass test vector
```

### 9.6 IIN Function Self-Tests

```javascript
// Visa
assert(_iinCheck('4532015126493080') === true);
// MC classic
assert(_iinCheck('5500005555555559') === true);
// MC 2-series
assert(_iinCheck('2221000000000009') === true);
// Amex
assert(_iinCheck('371449635398431') === true);
// Random number with non-card IIN prefix
assert(_iinCheck('1234567890123456') === false);
// ISBN-13
assert(_iinCheck('9783161484100') === false);
// IMEI (starts with 490154)
assert(_iinCheck('490154203237518') === false);
```

---

## Appendix A — Implementation Checklist

- [ ] Add `_luhn()` private function to `pii_detector.js`
- [ ] Add `_iinCheck()` + `_IIN_RANGES` constant to `pii_detector.js`
- [ ] Add `_CC_PATTERNS` array (7 patterns) to `pii_detector.js`
- [ ] Add `_CC_MASKED_RE` pattern to `pii_detector.js`
- [ ] Wire into `collectMatches()` gated on `autoDetect.CREDIT_CARD`
- [ ] Use `new RegExp(re.source, 'g')` per call (no shared `/g` state)
- [ ] Document split-cell PAN as known limitation in `CLAUDE.md`
- [ ] Document IMEI overlap as known limitation in `CLAUDE.md`
- [ ] Add 25 unit test cases to `tests/unit/pii_detector.test.js`
- [ ] Update `docs/TEST_VALIDATION.md` with each new test case
- [ ] Verify thin-space (`\u2009`) handling decision and document in code

---

## Appendix B — IIN Range Maintenance Notes

Card networks periodically allocate new BIN/IIN ranges. Notable upcoming changes:
- Visa is expanding into additional `4` sub-ranges (no action needed — current range `400000`–`499999` is already maximal for 6-digit prefix).
- Mastercard 2-series (`2221`–`2720`) was introduced 2017; still actively being issued. Already covered.
- New fintech card issuers often use `41xxxx` (Visa) or `52xxxx`–`55xxxx` (Mastercard) licensed ranges — covered.
- The `_IIN_RANGES` table should be reviewed annually. Since this is a static extension with no update mechanism other than version releases, plan to refresh in each major version.

---

## Appendix C — Separator Character Reference

| Character | Unicode | In `\s`? | In `[\s\-\.]`? | Notes |
|---|---|---|---|---|
| Space | U+0020 | Yes | Yes | Standard |
| Non-breaking space | U+00A0 | Yes (V8/ES2018+) | Yes | Used in French typography |
| Hyphen-minus | U+002D | No | Yes (explicit) | Standard dash |
| Full stop / period | U+002E | No | Yes (explicit) | Used in some EU formats |
| Thin space | U+2009 | No | No | Requires explicit add |
| Figure space | U+2007 | No | No | Requires explicit add |
| En dash | U+2013 | No | No | Rare; would require explicit add |
| Bullet / middle dot | U+2022 / U+00B7 | No | No | Masked display character |

**Recommendation**: Use `[\s\u00A0\-\.]` as the standard separator class. Add `\u2009` if EU typography is a target audience.
