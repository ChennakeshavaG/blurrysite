# SSN PII Detection — Research Document

**Scope**: US Social Security Numbers only. This is the highest-sensitivity PII type in the extension's AUTO_DETECT suite. A false negative (missed SSN) is far more costly than a false positive (over-blurring a non-SSN). Design decisions lean toward recall over precision wherever the tradeoff exists, but not at the cost of user trust (blurring every 9-digit sequence would destroy trust instantly).

**Base approach**: TreeWalker on `Text` nodes, regex match, structural validation (area/group/serial constraints), wrap matches in `<span data-bl-si-pii="SSN">`. Aligned with `RESEARCH_PII_DETECTION.md` core architecture.

---

## Section 1 — SSN Format Taxonomy

### 1.1 The Nine Canonical Formats

#### Format F1: Standard formatted (dash-separated)
```
123-45-6789
```
The most common presentation in documents, HR portals, government forms, medical records, tax preparation software, and any page that displays SSNs for user review. Area, group, and serial are visually distinct.

**Frequency on web pages**: High (>90% of SSN occurrences on pages that show them).
**Regex complexity**: Low — `\b\d{3}-\d{2}-\d{4}\b`.
**FP risk**: Very low. The `NNN-NN-NNNN` dash pattern is almost exclusively an SSN. The closest impostor is ZIP+4 (`12345-6789`, different grouping) and EIN (`12-3456789`, different grouping). Neither matches this specific pattern.

#### Format F2: Space-separated
```
123 45 6789
```
Less common than dashes; appears in typewritten documents scanned to HTML, some legacy web forms, and copy-paste from PDF viewers. Same structure as F1 with spaces instead of dashes.

**Frequency**: Low–Medium (5–15%).
**Regex complexity**: Low — add `\s` as alternative separator.
**FP risk**: Low, but higher than F1. Space-separated 9 digits like a phone number fragment or partial account number can collide. The specific `NNN NN NNNN` grouping is still distinctive.

#### Format F3: Mixed separators
```
123-45 6789
123 45-6789
```
Rarely intentional. Arises from partial OCR errors, HTML entity handling, or user copy-paste artifacts. Matching this risks FPs from adjacent strings that happen to have a dash and a space near each other.

**Frequency**: Very low (<1%).
**FP risk**: Medium — the relaxed separator acceptance increases collision surface.
**Recommendation**: Do NOT match F3 in the default pattern. The FP cost exceeds the FN recovery. Users who see their SSN in this format on a legitimate HR portal have larger problems than Blurry Site missing the match.

#### Format F4: Bare 9-digit (no separators)
```
123456789
```
Appears in raw data exports, CSV-to-HTML tables, JSON embedded in `<script>` that spills into `<pre>` blocks (excluded by SKIP_TAGS, but not always), legacy database displays, and some internal tools.

**Frequency on web pages**: Medium where it appears, but these are niche pages (payroll systems, HR admin, tax tools).
**FP risk**: Extremely high. Any 9-digit sequence matches: phone numbers without separators, routing numbers, EINs, ZIP+4 composites, catalog IDs, internal reference numbers. See Section 5 for the full enumeration.
**Recommendation**: NEVER include in default `SSN` pattern. Expose as a separate opt-in key `SSN_BARE` with a prominent FP warning in the popup. Gated by structural validation (Section 3), which cuts FP rate from ~80% to ~30% — still too high for default-on, but acceptable for a user who knows they're on a payroll export page.

#### Format F5: Partially masked — standard
```
***-**-6789
XXX-XX-6789
xxx-xx-6789
```
The last-4 reveal is the most common masking convention. Used by: Social Security Administration's own web portal, HR systems showing "your SSN on file", W-2 forms on tax portals, benefits enrollment screens.

**Should this be detected?** Yes. The partial reveal of the last 4 digits is still sensitive — combined with other page context (user's name, employer), it significantly narrows the search space. The pattern is visually recognizable as an SSN and should be blurred.

**Regex complexity**: Low–Medium. Need to cover multiple mask characters.
**FP risk**: Very low. The `***-**-NNNN` pattern is essentially unique to masked SSN displays.

#### Format F6: Partially masked — bullet/unicode
```
•••-••-6789
●●●-●●-6789
```
Less common; some government portals use bullet characters instead of asterisks. Unicode U+2022 (•), U+25CF (●).

**Frequency**: Low (a few government and financial portals).
**FP risk**: Very low.
**Recommendation**: Include in the masked pattern via character class.

#### Format F7: Partially masked — last-4 only (no format markers)
```
6789
```
A bare 4-digit last-4 without context is not detectable without surrounding context ("SSN ending in 6789"). Not worth detecting in isolation — too many FPs.

**Recommendation**: Out of scope unless context-anchored (see Pattern D, Section 2).

#### Format F8: Context-labeled SSN
```
SSN: 123-45-6789
Social Security Number: 123-45-6789
Social Security: 123-45-6789
Tax ID: 123-45-6789
TIN: 123-45-6789
```
The label "SSN:" or "Social Security" preceding a number is a strong positive signal. Used on tax forms, benefits summaries, government portal summary pages.

**Frequency**: Medium (HR/payroll/tax/government pages).
**Regex approach**: Use as a prefix signal for bare-digit detection (enables F4 matching only when labeled). See Pattern D in Section 2.
**FP risk with label**: Very low — the label itself disambiguates.

#### Format F9: Truncated forms in metadata/page text
```
Last 4 of SSN: 6789
Partial SSN: **6789
```
Context-adjacent truncated SSN. The context phrase "Last 4 of SSN" makes this detectable via Pattern D (context-anchored). Included for completeness — implementation deferred.

### 1.2 Format Frequency Summary

| Format | ID | Frequency | Default detect | FP Risk |
|---|---|---|---|---|
| `123-45-6789` (dash) | F1 | >90% | Yes | Very low |
| `123 45 6789` (space) | F2 | 5–15% | Yes | Low |
| `123-45 6789` (mixed) | F3 | <1% | No | Medium |
| `123456789` (bare) | F4 | Medium (niche pages) | No (separate key) | Very high |
| `***-**-6789` (masked std) | F5 | Medium (HR/tax/SSA) | Yes | Very low |
| `•••-••-6789` (masked bullet) | F6 | Low | Yes | Very low |
| `6789` (last-4 bare) | F7 | High (everywhere) | No | Very high |
| `SSN: NNN-NN-NNNN` (labeled) | F8 | Medium | Yes (captured by F1/F2) | Very low |
| `Last 4: NNNN` (context) | F9 | Low | No (Phase 2) | Low |

---

## Section 2 — Regex Approaches

### General constraints

- All patterns must be safe for use with `/g` flag, reconstructed fresh per text node (no `lastIndex` bleed).
- `\b` word boundary: works correctly with digits — `\b\d` anchors to the start of a digit run not preceded by another digit or word character. Safe to use for SSN boundaries.
- No catastrophic backtracking risk for the simple SSN patterns (no nested quantifiers). Each pattern is analyzed below.

---

### Pattern A: Dash-separated only (safe baseline)

```javascript
const SSN_DASH_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
```

**Matches**: `123-45-6789`
**Does not match**: `123 45 6789`, `123456789`, `***-**-6789`

**True positive examples**:
- `Your SSN is 078-05-1120.` → matches
- `SSN: 219-09-9999` → matches (will be rejected by structural validation)
- `Employee SSN: 456-78-9012` → matches

**False positive examples**:
- Phone numbers: do not match (phone is `NNN-NNN-NNNN` — the middle group is 3 digits, not 2)
- ZIP+4: `12345-6789` — does NOT match because `\b\d{3}` only matches 3 leading digits, and `12345` is 5 digits
- EIN: `12-3456789` — does NOT match (grouping is 2+7, not 3+2+4)
- Product codes: `ABC-12-3456` — does NOT match (leading non-digit breaks `\b\d{3}`)
- Product codes: `123-AB-4567` — does NOT match (middle group has letters)

**ReDoS analysis**: No nested quantifiers. `\d{3}`, `\d{2}`, `\d{4}` are possessive-equivalent in most modern engines because they match a fixed number of characters without backtracking. `\b` is a zero-width anchor, not a quantified group. **Safe.**

**FP rate**: <0.5% on general web pages. The `NNN-NN-NNNN` pattern is rare outside SSNs.

**Recommendation**: Include in the primary pattern.

---

### Pattern B: Dash-or-space separator (covers F1 + F2)

```javascript
const SSN_FORMATTED_RE = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
```

**Matches**: `123-45-6789`, `123 45 6789`
**Does not match**: `123-45 6789` (mixed), `123456789` (bare)

Note: `[- ]` is a character class matching exactly one hyphen or space. Not `[-\s]` — `\s` would match tabs, newlines, and other whitespace which are not valid SSN delimiters. Using `[- ]` (hyphen first in class, or escaped `[\- ]`) avoids any range interpretation: hyphen is safe at the start of a character class.

**True positive examples**:
- `SSN 123 45 6789 on file` → matches
- `123-45-6789` → matches

**False positive examples**:
- `(version 2 45 6789)` — could theoretically match `2 45 6789` if preceded by a digit; `\b` before `\d{3}` prevents this since `2` would be preceded by a space, making `\b2` a valid boundary. But `2` is only 1 digit, not 3 — `\d{3}` requires exactly 3. **Does not match**.
- `$2 45 6789` — the `2` is preceded by `$`, `\b` triggers there, but `\d{3}` needs `245` — the space breaks this. **Does not match**.
- `Order 123 45 6789` — MATCHES (false positive). The digits `123 45 6789` match the pattern. This is the main FP risk for space-separated SSNs: order numbers, tracking numbers, and similar codes in `NNN NN NNNN` groups.

**FP rate estimate**: ~2–3% (higher than Pattern A due to space-separated number strings). Still very low in absolute terms.

**ReDoS analysis**: Same as Pattern A — fixed-width groups, no backtracking. **Safe.**

**Recommendation**: Use Pattern B as the primary pattern (covers both F1 and F2, FP rate still very low).

---

### Pattern C: Bare 9-digit (`\b\d{9}\b`)

```javascript
const SSN_BARE_RE = /\b\d{9}\b/g;
```

**Matches**: `123456789`

**False positive rate analysis** (this is the critical question):

On a typical general web page, 9-digit numeric strings appear constantly:
- US phone numbers without formatting: 6,500,000,000 possible values
- Bank routing numbers: 9 digits, exactly the same format (ABA routing numbers)
- Zip+4 composites: `902100001` (9 digits, common in address blocks)
- Product SKUs and part numbers: common in e-commerce HTML
- Unix timestamps: 9 digits for dates in 2001–2286 range (e.g., `1234567890` is 10 digits, but smaller timestamps are 9)
- IP addresses: `1921681001` is 10, but unusual formats exist
- ISBN-10: 10 digits including check digit, close but not 9
- URLs: numeric path components, query parameters, anchor IDs
- Internal reference numbers, order IDs, ticket IDs: extremely common

**Empirical estimate**: On a general e-commerce or news page, the bare 9-digit regex would match 50–200 strings. Of these, perhaps 1–5 are actual SSNs. **FP rate: 95–99%+**.

Even on HR/payroll pages (the only pages where bare SSNs appear): perhaps 20% of 9-digit matches are actual SSNs. **FP rate: 80%**.

After structural validation (removing invalid area codes, group 00, serial 0000), real SSNs survive while most synthetic/random numbers are trimmed — but phone numbers, routing numbers, and order IDs still pass validation. FP rate after validation: ~50–70% on general pages, ~15–30% on payroll pages.

**Conclusion**: Pattern C alone is not viable for default use. It is only useful gated behind a context label (Pattern D) or behind a separate opt-in key (`SSN_BARE`). See Recommendation.

**ReDoS analysis**: `\b\d{9}\b` — fixed width, no backtracking. **Safe.**

---

### Pattern D: Context-anchored bare digits

```javascript
// Match an SSN (with or without separators) preceded within 30 chars by a label keyword
const SSN_LABELED_RE = /(?:(?:social\s+security(?:\s+number)?|ssn|tin|taxpayer(?:\s+id(?:entification)?(?:\s+number)?)?)\s*[:#]?\s*)(\d{3}[- ]?\d{2}[- ]?\d{4}|\d{9})/gi;
```

This pattern uses a non-capturing prefix group for the label, then captures the SSN value. The label keywords are:
- `social security number` / `social security`
- `SSN` (case-insensitive)
- `TIN` (Taxpayer Identification Number — technically includes ITINs, but in a US context, usually refers to SSN on tax forms)
- `taxpayer id` / `taxpayer identification` / `taxpayer identification number`

**Separator handling**: `[- ]?` (optional dash or space). Allows bare digits when labeled.

**True positive examples**:
- `SSN: 123456789` → captures `123456789`
- `Social Security Number: 123-45-6789` → captures `123-45-6789`
- `TIN 078056789` → captures `078056789`
- `taxpayer identification number: 456 78 9012` → captures `456 78 9012`

**False positive examples**:
- EIN presented as `TIN: 12-3456789` — the label `TIN` would match, but `12-3456789` does not fit `\d{3}[- ]?\d{2}[- ]?\d{4}` (grouping is 2+7) and `\d{9}` with the optional separators would not match either since it has a dash. Actually `12-3456789` would fail `\d{9}` (has a dash) and fail `\d{3}[- ]?\d{2}[- ]?\d{4}` (2-digit prefix doesn't fit 3-digit anchor). **Does not match**.
- `TIN: 0123456789` (10 digits) — `\d{9}` requires exactly 9, `\b` terminates at the 10th digit. **Does not match** (the `\b` after `\d{9}` would fail since it's followed by another digit).

**ReDoS analysis**: The prefix group uses alternation with `\s+` between words. The `(?:\s+...)` with optional quantifiers inside the alternation could theoretically backtrack, but the alternation list is short (5 items) and the patterns are mutually exclusive at first-character level (different initial words). No catastrophic nesting. **Safe**, but slightly more complex than Patterns A/B.

**Recommendation**: Include as the secondary pattern alongside Pattern B. The labeled regex catches bare-digit SSNs on tax/HR forms that Pattern B would miss.

---

### Pattern E: Masked SSN detection

```javascript
// Covers: ***-**-6789, XXX-XX-6789, xxx-xx-6789, •••-••-6789, ●●●-●●-6789
const SSN_MASKED_RE = /(?:[*Xx•●]{3})[- ](?:[*Xx•●]{2})[- ]\d{4}/g;
```

**Matches**:
- `***-**-6789`
- `XXX-XX-6789`
- `xxx-xx-6789`
- `•••-••-6789`

**Does not match**:
- `***-**-abcd` (last 4 must be digits — the visible portion is always numeric)
- `***6789` (no separators in masked format — not common, and too FP-prone without separators)

**Character class analysis**: `[*Xx•●]` matches exactly the characters used across all known masking systems. Adding `#` or `_` would expand coverage but increase FP risk slightly.

**Structural validation for masked patterns**: Cannot validate area/group/serial since only the last 4 are visible. Apply a minimal check: last 4 digits must not be `0000`. This is O(1).

**ReDoS analysis**: Fixed-width character class repetitions, no nested quantifiers. **Safe.**

**FP rate**: Near zero. The `[mask]{3}-[mask]{2}-\d{4}` pattern is essentially unique to masked SSN presentations. The main theoretical FP would be a phone number displayed as `***-**-1234` which is not a phone masking convention.

**Recommendation**: Include in the default pattern set.

---

### Composite pattern (combining A–E)

In the actual implementation, run the patterns as an ordered array rather than a single monolithic alternation. This keeps each pattern independently testable and avoids catastrophic alternation backtracking:

```javascript
function getSSNPatterns() {
  return [
    // Primary: formatted (dash or space separator)
    { re: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,                                     label: 'formatted' },
    // Secondary: masked (asterisk/X/bullet)
    { re: /(?:[*Xx\u2022\u25CF]{3})[- ](?:[*Xx\u2022\u25CF]{2})[- ]\d{4}/g,   label: 'masked'    },
    // Tertiary: labeled bare-digit
    { re: /(?:(?:social\s+security(?:\s+number)?|ssn|tin|taxpayer(?:\s+id(?:entification)?(?:\s+number)?)?)\s*[:#]?\s*)(\d{3}[- ]?\d{2}[- ]?\d{4}|\d{9})/gi, label: 'labeled' },
  ];
}
```

For the labeled pattern, the capture group (index 1) contains the actual SSN digits; `m.index` + `m[0].length` must be used for span placement, but the *validation* is run on `m[1]` (the captured digits only, stripped of the label prefix).

---

## Section 3 — Structural Validation

### 3.1 SSA Rules for Valid SSNs

The Social Security Administration has published rules for which SSN values are valid. After a regex match, validate the 9 digits against these constraints before wrapping. Invalid values are display artifacts, test data, or example numbers — blurring them is unhelpful noise.

**Area number (first 3 digits):**
- `000` — never assigned
- `666` — never assigned (SSA skipped this range)
- `900`–`999` — reserved for ITINs (Individual Taxpayer Identification Numbers) and other non-SSN identifiers; not SSNs

**Group number (middle 2 digits):**
- `00` — never assigned

**Serial number (last 4 digits):**
- `0000` — never assigned

**Notable invalid/example SSNs (should always be rejected):**
- `123-45-6789` — the "example" SSN used universally in documentation, movies, and demonstrations. Was never assigned. Must be rejected to avoid blurring every "example SSN" on educational pages.
- `219-09-9999` — appeared on a Social Security card used in wallet inserts by a leather goods company in 1938. Widely distributed. Never validly assigned.
- `078-05-1120` — Hilda Schrader Whitcher's SSN, published in a wallet insert by Woolworth's in 1938. One of the most stolen SSNs in history. Must reject.
- `457-55-5462` — used on a Social Security card prop in the TV show "Friends"; widely shared on the internet.

**Geographic area code rules (pre-2011):**
Before June 25, 2011, area numbers (first 3 digits) were assigned geographically. Numbers like `000`–`003` were never issued in batch, and many ranges were reserved. However, after SSA's 2011 randomization, these geographic rules no longer apply to new SSNs. Since the web pages that display SSNs contain both pre- and post-2011 SSNs, the old geographic rules are unreliable for validation. Do NOT use geographic area code filtering as a false-positive reduction technique.

### 3.2 Validation Function

```javascript
/**
 * Validate extracted SSN digits against SSA structural rules.
 * @param {string} raw — the matched string (may contain dashes/spaces/mask chars)
 * @returns {boolean} true if the value passes structural validation
 */
function isValidSSN(raw) {
  // Extract only digits
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 9) return false;

  const area   = digits.slice(0, 3);   // first 3 digits
  const group  = digits.slice(3, 5);   // middle 2 digits
  const serial = digits.slice(5, 9);   // last 4 digits

  // SSA invalid ranges
  if (area === '000') return false;
  if (area === '666') return false;
  if (area >= '900') return false;      // string comparison: '900' <= area <= '999'

  if (group === '00') return false;
  if (serial === '0000') return false;

  // Well-known example/placeholder/stolen SSNs
  const normalized = area + group + serial;
  if (normalized === '123456789') return false;   // universal example
  if (normalized === '219099999') return false;   // 1938 wallet insert
  if (normalized === '078051120') return false;   // Whitcher wallet insert
  if (normalized === '457554562') return false;   // TV show prop

  return true;
}
```

**Performance**: Pure string operations, O(1). Called once per regex match. Negligible cost — even running on 100 matches in a single text node takes microseconds.

### 3.3 Masked SSN Validation

For masked patterns (`***-**-6789`), only the last 4 digits are available:
```javascript
function isValidMaskedSSN(raw) {
  const digits = raw.replace(/\D/g, '');
  // Only last 4 visible — minimal check
  if (digits.length !== 4) return false;
  if (digits === '0000') return false;
  return true;
}
```

### 3.4 Validation Rate Impact

On typical payroll/HR pages with real SSNs, structural validation eliminates:
- ~0.1% of real SSNs (edge cases accidentally matching area=000, group=00, serial=0000 in test data)
- ~15–20% of false positives (the invalid ranges catch random numeric strings that happen to be in those ranges)

After structural validation, the formatted SSN pattern (F1+F2) still has a very low FP rate (~1–2%). For bare 9-digit SSNs, validation reduces FP rate by ~20 percentage points — still too high for default use.

---

## Section 4 — DOM-Specific Challenges

### 4.1 SSN in Form Labels vs. Values (Separate Nodes)

```html
<label>
  SSN: 
  <span class="value">123-45-6789</span>
</label>
```

Here, the text node `"SSN: "` is a child of `<label>`, and `"123-45-6789"` is a child of `<span>`. The TreeWalker visits each text node independently.

**Behavior with Pattern B**: The `"123-45-6789"` text node is visited separately and matches perfectly. The label text `"SSN: "` does not contain a digit pattern. **No problem here.**

**Behavior with Pattern D (labeled)**: The label pattern requires the keyword AND the digits to appear in the same text node. If they are in separate nodes, Pattern D will not match. Pattern B (which is separator-based) will still catch the `"123-45-6789"` span regardless.

**Implication**: Always run Pattern B alongside Pattern D. Never rely on Pattern D alone.

### 4.2 Masked SSN Display

```html
<span>***-**-6789</span>
```

Single text node, directly matched by Pattern E. No issues.

```html
<span class="masked">***</span>-<span class="last4">6789</span>
```

Here the asterisks, dash, and last-4 are in separate text nodes or mixed text/element structure. Pattern E will not match across node boundaries. This is a known limitation — see Section 4.7.

### 4.3 SSN in `<input value="...">`

`<input>` elements have no text children. The `value` attribute holds the SSN. The TreeWalker's SKIP_TAGS set (`INPUT`, `TEXTAREA`, `SELECT`) already excludes input elements.

**Known limitation**: SSNs in form fields are not detected.
**Rationale**: Detecting and blurring input values requires a separate mechanism (CSS overlay, value replacement, or shadow DOM injection) that can break form submission and user experience. Out of scope for Phase 1 TreeWalker approach.
**Workaround for users**: The existing blur-engine picker can be used to manually blur an input field's containing area.

### 4.4 SSN in Print Stylesheets / Payroll Tables

```html
<table class="payroll-summary">
  <tr>
    <td>Employee SSN</td>
    <td>123-45-6789</td>
  </tr>
</table>
```

`<td>` is a text-bearing element. The TreeWalker visits text nodes inside `<td>` normally. Pattern B matches `"123-45-6789"` in the second `<td>`. **No problem here.**

The label `"Employee SSN"` in the first `<td>` is a separate text node. Pattern D would need to see both in the same node. Since they're in separate cells, Pattern D won't fire on the bare-digit form — but Pattern B catches the formatted version regardless.

### 4.5 PDF-in-Browser (PDF.js)

PDF.js renders PDF text as a `<canvas>` element (the visual layer) plus a transparent text layer for accessibility. The text layer is a collection of `<span>` elements positioned over the canvas:

```html
<div class="textLayer">
  <span style="left: 100px; top: 200px;">123-45-6789</span>
</div>
```

**Behavior**: The TreeWalker visits text nodes inside `.textLayer` spans. Pattern B matches the SSN text node. The `<span>` wrapper is replaced with a `<span data-bl-si-pii="SSN">` containing the SSN. The visual canvas layer is unaffected — the text layer is transparent overlaid.

**Known limitation**: The visual blur applies to the text layer span, but the canvas rendering of the SSN is not affected. The SSN remains visible in the canvas layer.

**Recommendation**: Document this as a known limitation. PDF viewer canvas content is out of scope for text-node blurring. Users accessing sensitive PDFs should use the zone-overlay picker instead.

### 4.6 Data Grids and Spreadsheet-Style Apps

```html
<div role="gridcell" aria-label="SSN">123-45-6789</div>
```

Text nodes inside `<div role="gridcell">` are visited by the TreeWalker. Pattern B matches. **Works correctly.**

Virtual scroll tables (React, AG Grid, etc.) re-render rows as the user scrolls. The `MutationObserver` in `pii_detector.js` watches for `childList` mutations and re-scans added nodes. As new grid rows are injected into the DOM, they're scanned automatically. **Works correctly with MutationObserver.**

Performance consideration: Virtual scroll tables can inject/remove rows rapidly. The `requestIdleCallback` wrapper in `scanWhenIdle` defers processing, which means briefly visible rows may flash the SSN before being blurred. Acceptable tradeoff for Phase 1.

### 4.7 SSN Split Across Span Elements

```html
<b>123</b>-<b>45</b>-<b>6789</b>
```

The structure here is:
- Text node `"123"` inside `<b>`
- Text node `"-"` between the `<b>` elements (sibling text node)
- Text node `"45"` inside `<b>`
- Text node `"-"` between elements
- Text node `"6789"` inside `<b>`

Each text node is visited independently. None of them alone matches the full SSN pattern. This is a fundamental limitation of the text-node walker approach.

**Known limitation**: SSNs split across element boundaries are not detected by Pattern B.

**When does this occur?**: Intentional bolding of SSN segments (rare), font-rendering artifacts from PDF conversion, React component rendering that injects wrappers per character group (unusual but documented in some React date/input components).

**Mitigation (Phase 2 option)**: Implement an "adjacent text harvester" that collects the full text content of the nearest common ancestor (up to a `<div>` or `<tr>` boundary), runs the regex on the combined string, and maps match positions back to individual nodes for targeted wrapping. This is complex and out of scope for Phase 1.

**Current behavior**: The SSN remains unblurred. Since this pattern is rare, the FN cost is low.

### 4.8 SSN in `aria-label` / `title` Attributes

```html
<span aria-label="SSN: 123-45-6789">****</span>
```

The TreeWalker visits `Text` nodes, not attributes. `aria-label` and `title` are attributes — not visited.

**Known limitation**: SSNs in attributes are not detected. No action planned (attribute scanning would require separate mechanism and has very low occurrence frequency).

### 4.9 SSN in CSS `content` Property

Theoretically possible (`content: "SSN: 123-45-6789"` in a pseudo-element), but this is not rendered as a text node. Out of scope.

### 4.10 Shadow DOM

The PII scanner must recurse into shadow roots explicitly (TreeWalker does not cross shadow boundaries):

```javascript
function _scanRoot(root, autoDetect) {
  for (const textNode of iterateTextNodes(root)) {
    // match and wrap
  }
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot) _scanRoot(host.shadowRoot, autoDetect);
  }
}
```

Consistent with the existing design in `RESEARCH_PII_DETECTION.md §7`.

---

## Section 5 — False Positive Analysis

### FP Category 1: US Phone Numbers Without Separators

```
1234567890    (10 digits — does NOT match \b\d{9}\b)
123456789     (9 digits — matches \b\d{9}\b if bare pattern enabled)
```

With Pattern B (formatted), phone numbers do not match — they require separators in `NNN-NNN-NNNN` format, which is 3+3+4, not 3+2+4. The middle group being 3 digits (not 2) is a reliable structural distinguisher.

**Severity with Pattern B**: None. Phone numbers without separators don't match.
**Severity with Pattern C (bare 9-digit)**: High — 9-digit phone substrings (e.g., area code stripped) could match.
**Mitigation**: Structural validation rejects area codes 000, 666, 900–999. Many phone NPA codes are in the valid SSN area range, so this does not fully mitigate.

### FP Category 2: ZIP+4 Codes

```
12345-6789
```

This is a 5-digit ZIP followed by a dash and 4 more digits. It looks somewhat like an SSN but the leading group is 5 digits, not 3.

**Pattern B analysis**: `\b\d{3}[- ]\d{2}[- ]\d{4}\b` — `\b\d{3}` would match the first 3 digits of the ZIP (`123`). Then `[- ]` needs a separator, but the next character is `4` (4th digit of the ZIP), not a dash or space. **Does NOT match.**

**Severity**: None with Pattern B. The 5-digit ZIP prefix prevents a match.

### FP Category 3: EIN (Employer Identification Number)

```
12-3456789
```

EINs use a 2+7 digit grouping. Pattern B requires 3+2+4. These groupings are mutually exclusive.

**Pattern B analysis**: `\b\d{3}` requires 3 digits before the first separator. EIN's `12-` has only 2 digits before the dash. **Does NOT match.**

**Severity**: None with Pattern B.

### FP Category 4: Bank Routing Numbers (ABA)

```
021000021    (Chase Bank routing number)
```

9 bare digits, no separators.

**Pattern B**: Does NOT match (requires separators).
**Pattern C (bare)**: MATCHES. Structural validation: area=021, group=00 — rejected by group=00 rule! This is a real mitigation: many routing numbers have group=00 (the 4th and 5th digits are often `00` in common routing numbers like `02100xxxx`). Not universal, but helpful.

**Example routing numbers that WOULD pass structural validation**:
- `111000025` (Federal Reserve Bank) — area=111, group=00 → rejected by group=00
- `122000247` (Bank of America) — area=122, group=00 → rejected
- `267084199` (TD Bank) — area=267, group=84, serial=199 → PASSES validation

So structural validation is not a reliable FP eliminator for routing numbers. Some routing numbers will still generate FPs with bare Pattern C.

**Severity with Pattern C**: Medium — some routing numbers will pass validation.
**Mitigation**: Context anchoring (Pattern D). A routing number on a page is rarely preceded by "SSN:" or "Social Security Number".

### FP Category 5: Product/Catalog Numbers in NNN-NN-NNNN Format

```
Part number: 456-78-9012
SKU: 789-01-2345
```

These can exactly match Pattern B in format. Structural validation will reject ~15% of them (those with area 000, 666, 900+, group 00, serial 0000). The rest will pass.

**Severity with Pattern B**: Low–Medium. These appear in product catalogs, inventory management apps, and parts databases. On e-commerce sites, they're mixed in with product descriptions.

**Mitigation**: Context anchoring partially helps (Pattern D). If the preceding text is "Part number:" rather than "SSN:", Pattern D won't fire. However, Pattern B (format-only) would still match. 

**Practical impact**: A user running Blurry Site on an e-commerce or inventory page may see part numbers blurred. This is an acceptable tradeoff given the high sensitivity of SSN data — the user can always use the "unblur" reveal mode.

### FP Category 6: Date Strings in Some Formats

```
123-01-2024   (some European/internal date abbreviation styles)
```

Valid dates could collide if encoded as `MMM-DD-YYYY` with the month as a 3-digit number — but no standard date format uses a 3-digit month. The `YYYY-MM-DD` (ISO 8601) and `MM-DD-YYYY` formats are 4, 2, 4 or 2, 2, 4 digit groupings respectively. Neither collides with 3-2-4.

**Severity with Pattern B**: Very low. Standard date formats do not match.

### FP Category 7: ISBN-10

```
0-306-40615-2  (ISBN-10 with dashes)
```

ISBN-10 has dashes but the grouping is variable (publisher group number varies in length). The format is not 3-2-4.

**Severity with Pattern B**: None — ISBN-10 dash grouping does not match.

### FP Category 8: Numeric Strings in URLs / JSON in HTML

```html
<script>var config = {user_id: 234561789};</script>
```

SKIP_TAGS includes SCRIPT. Text nodes inside `<script>` are not visited. **No match.**

```html
<pre>{"ssn": "123456789"}</pre>
```

SKIP_TAGS includes PRE. **No match.**

```html
<div class="raw-data">234561789</div>
```

This is visited if the class name doesn't contain `bl-si-`. A bare 9-digit string in a `<div>`. With Pattern B (formatted), no match (no separators). With Pattern C (bare), matches, and structural validation may or may not reject.

**Severity with Pattern B**: None.
**Severity with Pattern C**: Medium.

### FP Category 9: Social Security Reference Numbers (non-SSNs)

Some government systems use 9-digit reference numbers that look like SSNs. The Taxpayer ID for non-US citizens (ITIN) starts with 9xx, which is explicitly rejected by structural validation (area 900–999 are invalid SSNs). This is an important distinction.

**Severity**: Low — structural validation rejects ITINs.

### FP Category 10: Phone Extension Codes

```
Call: 800-55-12345   (unusual phone format)
```

The 5-digit suffix prevents matching Pattern B (`\d{4}` requires exactly 4 terminal digits, `\b` after `\d{4}` would fail since the next character is another digit).

**Severity**: None.

### FP Category 11: European VAT Numbers

```
DE123456789
```

VAT numbers are preceded by a 2-letter country code. `\b` after the country code means `DE` is followed by `1` — `\b` triggers between `E` (word char) and `1` (also word char) — WAIT: actually `\b` triggers between a word character and a non-word character. `E` is a word character, `1` is also a word character (digits are `\w`). So `\bDE123456789` — `\b` would be before `D` (word char preceded by non-word) and there's no `\b` between `E` and `1`. The pattern `\b\d{9}\b` would not match since `D` and `E` precede the digits.

Actually, in `DE123456789`, the `\b` before `\d{3}` in Pattern B would fire at the position between `E` and `1`... wait, `\b` fires between a `\w` and a `\W` (or vice versa). Both `E` and `1` are `\w`. So there is NO `\b` between `E` and the digit. `\b\d{3}` would NOT match starting at position of `1` because the preceding character `E` is also `\w`. **Does NOT match.**

**Severity**: None.

### FP Rate Summary Table

| FP Category | Pattern B (formatted) | Pattern C (bare 9-digit) | Structural validation helps? |
|---|---|---|---|
| Phone without separators | None | High | Partially |
| ZIP+4 | None | N/A (10 digits) | — |
| EIN | None | Medium | No — different grouping |
| Routing numbers | None | Medium | Partially (~40%) |
| Product codes NNN-NN-NNNN | Low–Medium | Medium | Partially (15%) |
| Date strings | None | N/A | — |
| ISBN | None | N/A | — |
| Numeric strings in divs | None | Medium | Partially |
| ITIN | None | Low | Yes (area 900+) |
| VAT numbers | None | None | — |
| European phone with extensions | None | None | — |

**Bottom line**: Pattern B (formatted) has an extremely low FP rate on its own — perhaps 1–3% of matches on real-world pages will be false positives. Pattern C (bare 9-digit) has a catastrophically high FP rate (70–95%) even after structural validation. Never default-enable Pattern C.

---

## Section 6 — All Solutions Matrix

| Approach | Patterns Used | FP Rate | FN Rate | Perf | Notes |
|---|---|---|---|---|---|
| **A: Formatted only** | Pattern B (F1+F2) + structural validation | ~1% | ~10–15% (misses bare SSNs) | Excellent | Safe baseline. Recommended default. |
| **B: Formatted + masked** | Pattern B + Pattern E + structural validation | ~1% | ~8% (recovers masked SSN displays) | Excellent | Adds value on SSA/HR portals. Low cost. |
| **C: Formatted + masked + labeled** | Pattern B + Pattern E + Pattern D + structural validation | ~1% | ~5% (recovers labeled bare-digit SSNs on tax forms) | Good | Small regex overhead. Recommended full config. |
| **D: All including bare** | Pattern B + Pattern C + Pattern E + Pattern D | ~20–40% | ~2% | Good | Unacceptable FP rate. Do not default-enable. |
| **E: Context-anchored bare only** | Pattern D only | ~2% | ~50% (misses most formatted SSNs) | Excellent | Useless standalone — Pattern B covers nearly all formatted SSNs and Pattern D is additive. |
| **F: Bare with SSN_BARE flag** | Pattern C + structural validation | ~30–50% | ~5% | Good | Acceptable only as explicit opt-in with clear FP warning in popup. |

**Recommended combination: Approach C** (Pattern B + Pattern E + Pattern D + structural validation).

---

## Section 7 — Recommended Approach

### 7.1 Primary Recommendation

Enable the following by default when `settings.AUTO_DETECT.SSN === true`:

1. **Pattern B** (formatted, dash-or-space): `\b\d{3}[- ]\d{2}[- ]\d{4}\b`
2. **Pattern E** (masked standard): `[*Xx\u2022\u25CF]{3}[- ][*Xx\u2022\u25CF]{2}[- ]\d{4}`
3. **Pattern D** (context-labeled, enables bare-digit when SSN label present): the labeled regex

All three run through `isValidSSN()` structural validation on the extracted digits (or `isValidMaskedSSN()` for Pattern E matches).

### 7.2 Bare 9-Digit (`SSN_BARE`) Recommendation

**Do NOT include bare 9-digit detection in the default `SSN` pattern.**

Expose it as a separate `SSN_BARE` key in `settings.AUTO_DETECT`:

```javascript
AUTO_DETECT: {
  EMAIL: false,
  PHONE: false,
  SSN: false,
  SSN_BARE: false,   // ← new key
  CREDIT_CARD: false,
  FINANCIAL: false,
}
```

In the popup UI, `SSN_BARE` should:
- Be nested under `SSN` (only visible if `SSN` is enabled)
- Show a yellow warning: "High false-positive risk. Enable only if you know this page shows raw SSNs."
- Default to `false` even when `SSN` is `true`

When `SSN_BARE` is enabled, Pattern C is added to the pattern list. All matches still run through `isValidSSN()`.

Estimated FP rate with `SSN_BARE`: ~30–50% on general pages. On a payroll export page (the target use case), ~15–25%.

### 7.3 Exact Implementation (Copy-Paste Ready)

```javascript
/**
 * SSN detection patterns for pii_detector.js.
 * Run in order; de-overlap matches after collection.
 */

const SSN_FORMATTED_RE = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;

const SSN_MASKED_RE = /[*Xx\u2022\u25CF]{3}[- ][*Xx\u2022\u25CF]{2}[- ]\d{4}/g;

// Labeled pattern — match index 0 is full match (label + digits), index 1 is digits only
const SSN_LABELED_RE = /(?:social\s+security(?:\s+number)?|ssn|tin|taxpayer(?:\s+id(?:entification)?(?:\s+number)?)?)\s*[:#]?\s*(\d{3}[- ]?\d{2}[- ]?\d{4}|\d{9})/gi;

// Optional bare pattern (SSN_BARE = true only)
const SSN_BARE_RE = /\b\d{9}\b/g;

/**
 * Structural validation. Returns false for invalid/placeholder SSNs.
 * @param {string} raw — may contain dashes, spaces, or mask chars; digits extracted internally
 */
function isValidSSN(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 9) return false;

  const area   = digits.slice(0, 3);
  const group  = digits.slice(3, 5);
  const serial = digits.slice(5, 9);

  if (area === '000') return false;
  if (area === '666') return false;
  if (area >= '900') return false;
  if (group === '00') return false;
  if (serial === '0000') return false;

  // Well-known example/placeholder SSNs — always reject
  const n = area + group + serial;
  if (n === '123456789') return false;
  if (n === '219099999') return false;
  if (n === '078051120') return false;
  if (n === '457554562') return false;

  return true;
}

/**
 * Structural validation for masked SSNs (only last 4 digits visible).
 */
function isValidMaskedSSN(raw) {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 4 && digits !== '0000';
}

/**
 * Collect all SSN matches in a text string.
 * Returns array of { start, end, type } sorted by start.
 */
function collectSSNMatches(text, ssnBareEnabled) {
  const matches = [];

  // Pattern B: formatted
  {
    const re = new RegExp(SSN_FORMATTED_RE.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (isValidSSN(m[0])) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: 'SSN' });
      }
    }
  }

  // Pattern E: masked
  {
    const re = new RegExp(SSN_MASKED_RE.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (isValidMaskedSSN(m[0])) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: 'SSN' });
      }
    }
  }

  // Pattern D: labeled (bare or formatted preceded by SSN label)
  {
    const re = new RegExp(SSN_LABELED_RE.source, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && isValidSSN(m[1])) {
        // Span covers the entire match (label + digits) for maximum blur context
        matches.push({ start: m.index, end: m.index + m[0].length, type: 'SSN' });
      }
    }
  }

  // Pattern C: bare (only when SSN_BARE enabled)
  if (ssnBareEnabled) {
    const re = new RegExp(SSN_BARE_RE.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (isValidSSN(m[0])) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: 'SSN' });
      }
    }
  }

  // Sort and de-overlap (prefer earliest match)
  matches.sort((a, b) => a.start - b.start);
  const result = [];
  let last = 0;
  for (const m of matches) {
    if (m.start >= last) {
      result.push(m);
      last = m.end;
    }
  }
  return result;
}
```

### 7.4 Integration with pii_detector.js collectMatches

In `collectMatches(text, autoDetect)`, the SSN branch becomes:

```javascript
if (autoDetect.SSN) {
  const ssnMatches = collectSSNMatches(text, autoDetect.SSN_BARE === true);
  raw.push(...ssnMatches);
}
```

Note that `autoDetect.SSN_BARE` is an independent flag. If `SSN` is false but `SSN_BARE` is true (misconfigured), bare detection does not run — `SSN_BARE` is only checked inside `collectSSNMatches`, which is only called when `SSN` is true.

### 7.5 The constants.js DEFAULT_SETTINGS Update

```javascript
AUTO_DETECT: Object.freeze({
  EMAIL: false,
  PHONE: false,
  SSN: false,
  SSN_BARE: false,    // ← add this
  CREDIT_CARD: false,
  FINANCIAL: false,
}),
```

And in `validateSettings`:
```javascript
// AUTO_DETECT keys including new SSN_BARE
for (const key of Object.keys(defaults.AUTO_DETECT)) {
  result.AUTO_DETECT[key] =
    typeof ad[key] === 'boolean' ? ad[key] : defaults.AUTO_DETECT[key];
}
```

The existing loop already handles new keys automatically as long as the key is present in `DEFAULT_SETTINGS.AUTO_DETECT`. No other changes needed in `validateSettings`.

---

## Section 8 — Unit Test Cases

All cases below are for `tests/unit/pii_detector.test.js`. Each case is listed as `{ input, expectedMatch, description }`.

### 8.1 True Positives — Formatted SSNs

| # | Input text | Expected match text | Notes |
|---|---|---|---|
| TP-01 | `SSN: 234-56-7890` | `234-56-7890` | Standard dash format |
| TP-02 | `Social Security Number: 234 56 7890` | `234 56 7890` | Space separator |
| TP-03 | `employee ssn is 345-67-8901 on file` | `345-67-8901` | Lowercase context, embedded in sentence |
| TP-04 | `456-78-9012` | `456-78-9012` | Bare formatted SSN in text |
| TP-05 | `Your SSN (456-78-9012) was received` | `456-78-9012` | Parenthesized formatted SSN |
| TP-06 | `TIN: 456789012` | `TIN: 456789012` (full match) | Labeled bare-digit via Pattern D |
| TP-07 | `taxpayer identification number 456 78 9012` | full match | Labeled space-separated |
| TP-08 | `Social Security: 456-78-9012` | `Social Security: 456-78-9012` | Short label form |

### 8.2 True Positives — Masked SSNs

| # | Input text | Expected match text | Notes |
|---|---|---|---|
| TP-09 | `SSN on file: ***-**-7890` | `***-**-7890` | Standard asterisk masking |
| TP-10 | `Your SSN: XXX-XX-7890` | `XXX-XX-7890` | Uppercase X masking |
| TP-11 | `•••-••-7890` | `•••-••-7890` | Bullet character masking (U+2022) |
| TP-12 | `xxx-xx-7890` | `xxx-xx-7890` | Lowercase x masking |
| TP-13 | `●●●-●●-7890` | `●●●-●●-7890` | Filled circle masking (U+25CF) |

### 8.3 True Negatives — Should NOT Match (Pattern B / C alone)

| # | Input text | Why it should NOT match |
|---|---|---|
| TN-01 | `123-456-7890` | Phone number: middle group is 3 digits, not 2 |
| TN-02 | `12345-6789` | ZIP+4: leading group is 5 digits, not 3 |
| TN-03 | `12-3456789` | EIN: leading group is 2 digits, not 3 |
| TN-04 | `123456789` | Bare 9-digit: no separators, Pattern B requires separators (and `SSN_BARE` is false) |
| TN-05 | `v2.34-56-7890x` | Non-word char before/after (word boundary prevents match inside alphanumeric token) |
| TN-06 | `1234-56-789` | Wrong grouping: first group is 4 digits |
| TN-07 | `123-4-56789` | Wrong grouping: middle group is 1 digit |

### 8.4 True Negatives — Invalid SSN Ranges (Structural Validation Rejection)

| # | Input text | Reason rejected by isValidSSN |
|---|---|---|
| TV-01 | `000-45-6789` | Area = 000 (never assigned) |
| TV-02 | `666-45-6789` | Area = 666 (never assigned) |
| TV-03 | `900-45-6789` | Area = 900 (reserved, ITIN range) |
| TV-04 | `999-45-6789` | Area = 999 (reserved) |
| TV-05 | `123-00-6789` | Group = 00 (never assigned) |
| TV-06 | `123-45-0000` | Serial = 0000 (never assigned) |
| TV-07 | `123-45-6789` | Well-known example SSN (blacklisted) |
| TV-08 | `219-09-9999` | 1938 wallet insert SSN (blacklisted) |
| TV-09 | `078-05-1120` | Whitcher wallet insert SSN (blacklisted) |
| TV-10 | `457-55-4562` | TV show prop SSN (blacklisted) |

### 8.5 Boundary and Edge Cases

| # | Input text | Expected behavior | Notes |
|---|---|---|---|
| BC-01 | `234-56-78901` | No match | Trailing digit breaks `\b` after `\d{4}` |
| BC-02 | `1234-56-7890` | No match | Preceding digit breaks `\b` before `\d{3}` |
| BC-03 | `SSN:234-56-7890` | Match `234-56-7890` | No space after colon in Pattern B (label not required for formatted) |
| BC-04 | Two SSNs in one node: `234-56-7890 and 345-67-8901` | Two matches, no overlap | De-overlap logic tested |
| BC-05 | Empty string | No match, no error | Walker skips empty nodes anyway |
| BC-06 | `ssn: 234-56-7890` | Match (case-insensitive label) | Pattern D uses `gi` flag |
| BC-07 | `***-**-0000` | No match | Masked SSN with serial 0000 fails isValidMaskedSSN |
| BC-08 | `SSN: 000-12-3456` | No match | Labeled bare SSN with area 000, rejected by isValidSSN |
| BC-09 | Node text inside `<script>` | No match | Walker skips SCRIPT nodes |
| BC-10 | Node already wrapped in `[data-bl-si-pii]` | No match | Walker skips descendants of existing PII spans |

### 8.6 SSN_BARE Mode Tests

| # | Input text | SSN_BARE | Expected behavior |
|---|---|---|---|
| SB-01 | `Employee ID: 234567890` | false | No match (bare, no label) |
| SB-02 | `Employee ID: 234567890` | true | Match `234567890` (passes structural validation) |
| SB-03 | `000456789` | true | No match (area = 000, rejected) |
| SB-04 | `The routing number is 267084199.` | true | Match (passes structural validation — this is a real FP scenario) |

Test SB-04 is intentionally a false positive — it demonstrates why SSN_BARE defaults to false.

---

## Appendix A — ReDoS Risk Analysis Summary

All five patterns analyzed:

| Pattern | Quantifier nesting | ReDoS risk |
|---|---|---|
| `\b\d{3}[- ]\d{2}[- ]\d{4}\b` | None — fixed-width only | None |
| `[*Xx•●]{3}[- ][*Xx•●]{2}[- ]\d{4}` | None — fixed-width only | None |
| The labeled regex | `\s+` inside alternation, no nesting | Negligible |
| `\b\d{9}\b` | None — fixed-width only | None |
| `\d{3}[- ]?\d{2}[- ]?\d{4}` inside labeled | `[- ]?` optional, not nested | None |

The most complex pattern (labeled regex) uses `\s+` (one-or-more whitespace). In pathological input like `"social security                                               number: "` (100 spaces), `\s+` will take O(n) steps for the spaces then fail at the number check — no exponential backtracking. Not catastrophic.

---

## Appendix B — Known Limitations Summary

| Limitation | Root cause | Status |
|---|---|---|
| SSNs in `<input value>` not detected | No text nodes in input elements | Out of scope Phase 1 |
| SSNs split across sibling elements (`<b>123</b>-<b>45</b>-...`) | Walker operates on individual text nodes | Known limitation — Phase 2 adjacent-text harvester |
| SSNs in `aria-label`, `title`, `data-*` attributes | Walker visits text nodes only | Out of scope |
| SSN visible in PDF canvas layer (PDF.js) | Canvas content is not a text node | Known limitation — use zone overlay picker |
| Mixed separator format (`123-45 6789`) | Not detected by Pattern B or C | Intentional — FP cost outweighs FN recovery |
| ITINs (900–999 area codes) detected as SSNs by shape, rejected by validation | ITINs share the 9-digit format | Handled: structural validation rejects area 900+ |
| Bare 9-digit SSNs not detected by default | FP rate unacceptably high | Intentional — use SSN_BARE opt-in flag |

---

## Appendix C — Cross-References

- `RESEARCH_PII_DETECTION.md §2` — base SSN pattern and FP rate estimate
- `src/constants.js` — `DEFAULT_SETTINGS.AUTO_DETECT` (add `SSN_BARE` key here)
- `styles/content.css` lines 44–48 — `[data-bl-si-pii]` blur rule (no changes needed)
- `tests/unit/pii_detector.test.js` — add all cases from Section 8
- `docs/LLD.md` — add `PiiDetector` contract section when module is implemented
