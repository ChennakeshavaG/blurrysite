# PHONE PII Detection — Exhaustive Research Document

**Scope**: US NANP + common international formats. Content-script context (vanilla JS, no bundler,
no npm). Target: `src/pii_detector.js` `PHONE` detection path feeding `[data-bl-si-pii="PHONE"]` spans.

---

## Section 1 — Phone Number Format Taxonomy

Phone numbers are uniquely hard because the digit count and separator vocabulary overlap with
dates, product codes, ZIP codes, SSNs, and tracking numbers. Every viable format a number can
appear in on a live web page is catalogued here.

### 1.1 US NANP (North American Numbering Plan) Formats

NANP numbers have the structure NPA-NXX-XXXX where NPA is the 3-digit area code, NXX is the
3-digit exchange, and XXXX is the 4-digit subscriber number. Total digits: 10 (without country
code) or 11 (with leading 1).

| Format | Example | Frequency | Regex complexity |
|--------|---------|-----------|-----------------|
| Parenthesized area code, dash | `(555) 123-4567` | Very common — standard US display | Low |
| Parenthesized area code, no space | `(555)123-4567` | Common | Low |
| Parenthesized area code, dot | `(555) 123.4567` | Uncommon | Low |
| Parenthesized area code, space | `(555) 123 4567` | Uncommon | Low |
| Dashes throughout | `555-123-4567` | Very common — most ambiguous | Low |
| Dots throughout | `555.123.4567` | Common | Low |
| Spaces throughout | `555 123 4567` | Uncommon (US) | Low — high FP |
| No separator (bare 10-digit) | `5551234567` | Common in data exports, masked pages | High FP |
| With country code, dash | `1-555-123-4567` | Common | Low |
| With country code, E.164 prefix | `+1-555-123-4567` | Common | Low |
| With country code, parenthesized | `+1 (555) 123-4567` | Very common — preferred international | Low |
| With country code, no separator | `15551234567` | Rare — 11-digit bare | High FP |
| Mixed separators | `(555) 123.4567` | Occasional | Medium |
| NANP with 1 prefix, space only | `1 555 123 4567` | Rare | High FP |

### 1.2 International Formats (E.164 and country-local)

E.164 format: `+` + country code (1–3 digits) + subscriber number (up to 12 digits). Max total
digits: 15 (ITU-T E.164). The `+` prefix is the single most reliable signal for international
numbers.

| Country / Region | Example | Notes |
|-----------------|---------|-------|
| UK | `+44 20 7946 0958` | London; variable grouping |
| UK mobile | `+44 7700 900000` | 11 digits local |
| Germany | `+49 30 12345678` | Variable length (5–12 local digits) |
| France | `+33 1 23 45 67 89` | 10 local digits, pair grouping |
| Australia | `+61 2 1234 5678` | 10 local digits |
| India | `+91 98765 43210` | 10 local digits, 5+5 grouping |
| Japan | `+81 3-1234-5678` | 10–11 local digits |
| Brazil | `+55 11 91234-5678` | 10–11 local digits |
| Mexico | `+52 55 1234-5678` | 10 local digits |
| Singapore | `+65 6123 4567` | 8 local digits |

International numbers are safer to detect than bare NANP: the `+` prefix + country code
structure is rarely reproduced by other data types.

**Frequency on web pages**: Medium. Seen routinely on contact pages, order confirmations,
international company sites. Less common than formatted NANP.

### 1.3 Extensions

Extensions suffix a NANP or international number and indicate an internal PBX line.

| Format | Example | Notes |
|--------|---------|-------|
| Long-form `ext.` | `555-123-4567 ext. 890` | Very common |
| Short-form `ext` | `555-123-4567 ext 890` | Common |
| Lowercase `x` prefix | `555-123-4567 x890` | Common |
| Hash `#` prefix | `555-123-4567 #890` | Common |
| Comma (VoIP/IVR) | `555-123-4567,890` | Rare — VoIP dial strings |
| Parenthesized | `555-123-4567 (ext 890)` | Occasional |

Extensions can be 1–6 digits. They add noise to matching because a trailing number can be
mistaken for part of the phone number or a standalone value.

### 1.4 Toll-Free Prefixes

US toll-free numbers use specific NPA codes. These are fully valid NANP but worth noting because
they appear at very high frequency on commercial sites and are unambiguous phone numbers.

| Prefix | Examples |
|--------|---------|
| 800 | `1-800-555-1234` |
| 888 | `1-888-555-1234` |
| 877 | `1-877-555-1234` |
| 866 | `1-866-555-1234` |
| 855 | `1-855-555-1234` |
| 844 | `1-844-555-1234` |
| 833 | `1-833-555-1234` |
| 822 (pending) | `1-822-555-1234` |

### 1.5 Vanity Numbers (Letter Mapping)

Vanity numbers encode letters using the standard telephone keypad mapping:
2=ABC, 3=DEF, 4=GHI, 5=JKL, 6=MNO, 7=PQRS, 8=TUV, 9=WXYZ.

| Example | Decoded |
|---------|---------|
| `1-800-FLOWERS` | `1-800-356-9377` |
| `1-800-CALL-ATT` | `1-800-225-5288` |
| `1-888-LOAN-YES` | `1-888-562-6937` |

Vanity numbers appear in advertising copy and footers. Detection requires a mixed `[A-Z0-9]`
pattern. Frequency: rare in DOM text; common in imagery (not relevant to text-node walker).

**Regex complexity**: High. Must allow letters in exchange/subscriber positions while still
anchoring to NANP structure. High FP risk from any `word-dash-word` pattern.

**Recommendation**: Do not attempt vanity number detection in Phase 1. The FP cost is too high
and these appear mainly in marketing images, not HTML text nodes.

### 1.6 Partial Numbers / Masked Displays

Sites often display partially masked numbers for security:

| Example | Context |
|---------|---------|
| `***-***-4567` | Last 4 digits only — account pages |
| `(•••) •••-1234` | Masked with bullets |
| `XXX-XXX-4567` | Masked with X placeholders |
| `ending in 4567` | Natural language partial |
| `•••• 4567` | Space-separated last 4 |

Detection of partial numbers is not useful for the blur goal — the sensitive data is already
masked by the site. Skip these patterns.

### 1.7 Format Frequency Summary

| Format Group | Frequency | FP Risk | Should detect |
|---|---|---|---|
| `(NPA) NXX-XXXX` | Very High | Low | Yes |
| `NPA-NXX-XXXX` | Very High | Medium | Yes |
| `NPA.NXX.XXXX` | High | Low | Yes |
| `+1 (NPA) NXX-XXXX` | High | Very Low | Yes |
| `+1-NPA-NXX-XXXX` | High | Very Low | Yes |
| `+CC digits` (international) | Medium | Very Low | Yes |
| `NPANXXXXXX` (bare 10-digit) | High | Very High | Opt-in only |
| Extensions (`ext`, `x#`) | Common suffix | Low (as suffix) | Yes (as suffix) |
| Toll-free `1-8xx-` | High | Very Low | Yes (falls under NANP) |
| Vanity letters | Rare | Very High | No (Phase 1) |
| Partial/masked | Low | N/A | No |

---

## Section 2 — Regex Approaches

### 2.1 Approach A: One Monolithic Regex

A single regex covering all NANP variants and common international formats.

```javascript
const PHONE_MONO = /(?:(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?|\+(?:44|49|33|61|91|81|55|52|65|86|39|7|82|31|34|46|47|41|32|351|353|358|47|354|356|357|370|371|372|373|374|375|376|377|380|381|385|386|387|389|420|421|423|500|501|502|503|504|505|506|507|508|509|51|52|53|54|55|56|57|58|590|591|592|593|594|595|596|597|598|599|60|61|62|63|64|65|66|670|672|673|674|675|676|677|678|679|680|681|682|683|685|686|687|688|689|690|691|692|7|800|850|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|979|98)\s?[\d\s\-()]{6,14}\d)/g;
```

**Assessment**:
- Precision: Medium. The country-code alternation is brittle and incomplete. Any 2–3 digit number followed by 6+ digits can match.
- Recall: Medium-high. Catches most formats but long alternation makes maintenance hazardous.
- Catastrophic backtracking risk: **High**. The country code alternation `(?:44|49|33|...)` with dozens of alternatives will cause exponential backtracking on certain failure paths in older regex engines. Firefox's SpiderMonkey and V8 both handle NFA-based backtracking, but deeply nested alternations on long non-matching strings (e.g., a paragraph of product codes) can cause > 100ms delays on long text nodes.
- False positive examples:
  - `Order #555-123-4567` — matches (no context awareness)
  - `SKU 555.123.4567` — matches
  - `Date: 12-25-2024` — does NOT match (year is 4 digits in wrong position)
  - `IP: 192.168.1.100` — does NOT match (octets are 3+3+1+3, not 3+3+4)
- Maintainability: Poor. Nobody wants to edit a 400-character regex.

**Grade: D** — Too long, backtracking risk, wrong failure mode. Don't use.

### 2.2 Approach B: Array of Targeted Per-Format Regexes (Recommended)

One regex per format family, run in order, collect all matches, de-overlap.

```javascript
const PHONE_REGEXES = [
  // ── Group 1: E.164 / +1 international with parenthesized area code ──────────
  // +1 (555) 123-4567  +1 (555) 123.4567  +1 (555) 123 4567
  /\+1[-.\s]?\(\d{3}\)[-.\s]?\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,

  // ── Group 2: +1 with no parens ───────────────────────────────────────────────
  // +1-555-123-4567  +1.555.123.4567  +1 555 123 4567
  /\+1[-.\s]?\d{3}[-.\s]\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,

  // ── Group 3: 1-NPA-NXX-XXXX (leading 1, no + sign) ──────────────────────────
  // 1-555-123-4567  1 (555) 123-4567  1.555.123.4567
  /\b1[-.\s]?\(?(\d{3})\)?[-.\s]?\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?\b/gi,

  // ── Group 4: (NPA) NXX-XXXX — parenthesized area code ───────────────────────
  // (555) 123-4567  (555)123-4567  (555) 123.4567  (800) 555-1234
  /\(\d{3}\)\s?\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,

  // ── Group 5: NPA-NXX-XXXX — dashes, dots, or mixed ──────────────────────────
  // 555-123-4567  555.123.4567  555-123.4567
  // Word-boundary on both sides to cut SKU/date FPs.
  /\b\d{3}[-.](\d{3})[-.](\d{4})\b(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,

  // ── Group 6: International E.164 (non-+1) ───────────────────────────────────
  // +44 20 7946 0958  +49 30 12345678  +91 98765 43210
  // Country code 2–3 digits, then 6–12 subscriber digits with optional separators.
  /\+(?!1\b)(?:[2-9]\d{0,2})[-.\s]?(?:\d[-.\s]?){6,12}\d/gi,
];
```

**Assessment**:
- Precision: High for Groups 1–4, Medium for Group 5, High for Group 6.
- Recall: Covers >95% of real-world US formats; >85% of common international.
- Catastrophic backtracking risk: **Low**. Each regex is short (< 80 chars), no nested quantifiers.
- False positive examples by group:
  - Group 5 (`NPA-NXX-XXXX`): `SKU: 123-456-7890`, `Order #555-123-4567`, ISBN `978-3-16-1484` (not matched — dashes in wrong positions), SSN `123-45-6789` (not matched — `NNN-NN-NNNN` not `NNN-NNN-NNNN`)
  - Group 3: `1-800-FLOWERS` — not matched because `FLOWERS` is not digits
- Maintainability: Good. Each regex is independently readable and testable.

**Grade: A** — This is the recommended approach. Detailed regex analysis in Section 7.

### 2.3 Approach C: Loose Digit Extraction + Structural Validation

Extract all digit sequences and adjacent separator characters, then validate length and structure
programmatically in JS.

```javascript
function extractPhoneNumbers(text) {
  // Step 1: find all candidate segments
  const candidates = [];
  // Match any sequence of digits, spaces, dashes, dots, parens, plus, x
  const TOKEN_RE = /[\+\d][\d\s\-.()+x#,]{6,25}[\d]/g;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    candidates.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }

  const results = [];
  for (const c of candidates) {
    const digits = c.text.replace(/\D/g, '');
    // NANP: 10 digits (NPA-NXX-XXXX) or 11 digits with leading 1
    const isNANP = (digits.length === 10 && /^[2-9]/.test(digits)) ||
                   (digits.length === 11 && digits[0] === '1' && /^[2-9]/.test(digits[1]));
    // International: 7–15 digits, must start with +
    const isIntl = c.text.trimStart().startsWith('+') && digits.length >= 7 && digits.length <= 15;

    if (isNANP || isIntl) {
      results.push(c);
    }
  }
  return results;
}
```

**Assessment**:
- Precision: Low-Medium. The loose tokenizer has high recall but pulls in too many non-phone strings. Digit-count check alone cannot distinguish `555-123-4567` (phone) from `SKU: 555-123-4567` (product code with same digit count).
- Recall: Very High. Catches everything that looks like 10 digits with separators.
- Catastrophic backtracking risk: None. Linear scan.
- False positive examples:
  - Any 10-digit product code with dashes in 3-3-4 position
  - `2024-01-15` (8 digits, would fail length check, but `2024011500` is 10 digits if concatenated elsewhere)
  - Tracking numbers: `555-123-4567` in `Track order 555-123-4567`
- Key limitation: This approach cannot distinguish formatting contexts. Without word boundaries and separator-position checks, it over-fires substantially.

**Grade: C** — Better recall, worse precision than Approach B. Useful as a complement for the `(NPA) NXX-XXXX` format (parens are a structural signal), not as a standalone approach.

### 2.4 Approach D: libphonenumber-js

Google's libphonenumber is the gold standard for phone number parsing, validation, and formatting.
The `libphonenumber-js` npm package provides a JS port.

**Bundle sizes** (from published package, 2025):
| Variant | Size (minified+gzipped) |
|---------|------------------------|
| `libphonenumber-js/max` (full metadata) | ~145 KB gzipped |
| `libphonenumber-js/min` (minimal metadata) | ~75 KB gzipped |
| `libphonenumber-js/core` (no metadata, parse only) | ~40 KB gzipped |
| Custom metadata (US + CA only) | ~15 KB gzipped |

**Feasibility in a content script**:

Content scripts run in every page's renderer process. The browser caps injected content script
sizes loosely, but the real constraint is memory and CPU:
- 145 KB of gzipped JS inflates to ~500–700 KB in memory
- Initialization (parsing the metadata JSON) takes 5–15 ms on a cold run
- Per-call parsing: ~0.1–0.5 ms per candidate string
- Content scripts for this extension intentionally use no bundler and no npm — the architecture
  requires vanilla JS IIFEs. `libphonenumber-js` is an ES module with CommonJS export.

**The bundler constraint is a hard block.** Even the `core` variant cannot be loaded as an IIFE
without a bundler (webpack/rollup/esbuild). A pre-bundled IIFE could be vendored manually, but:
1. It must be checked into the repo and manually updated on each libphonenumber release.
2. Even the minimal US-only metadata build adds ~15 KB to every page load.
3. The extension's manifest.json content_scripts array loads plain `.js` files — no module
   loading infrastructure exists.

**Alternative**: Use libphonenumber **only** in the background service worker (where size is a
one-time cost, not per-tab), and send candidates from the content script for validation.
However, this adds a round-trip per text node scan, which is unacceptable for performance.

**Verdict**: Not viable for Phase 1. Could be revisited if the project adds a bundler step.
For now, well-designed regexes (Approach B) with structural JS validation (Section 5) achieve
80–90% of libphonenumber's accuracy for a fraction of the code size.

**Grade: N/A for this project** — Architecturally incompatible without a bundler.

### 2.5 Approach E: `tel:` href Attribute Scan (Separate Path)

`<a href="tel:+15551234567">` elements are a separate, high-precision detection path. The `tel:`
URI scheme guarantees the value is a phone number. No regex false positives.

```javascript
function scanTelHrefs(root) {
  const anchors = root.querySelectorAll('a[href^="tel:"]');
  const results = [];
  for (const a of anchors) {
    results.push({
      element: a,
      number: a.getAttribute('href').replace(/^tel:/, ''),
      displayText: a.textContent
    });
  }
  return results;
}
```

**Important caveat**: The `href` contains the canonical number, but the display text may be
`"Call Us"`, `"Contact"`, or `"+1 (555) 123-4567"`. The text-node walker will see the display
text, not the href. For blur purposes, the correct target is the `<a>` element itself or its
visible text child, not the href attribute.

**Recommendation**: Scan `a[href^="tel:"]` as a **pre-pass** before the text-node walker.
Wrap or blur the entire link element. Do not also try to detect the display phone number via
regex — that would double-wrap if the link text happens to be the formatted number.

### 2.6 Approach F: Semantic HTML Signals

Some sites use structured data that explicitly marks phone numbers:

```html
<span itemprop="telephone">(555) 123-4567</span>
<p class="phone-number">555-123-4567</p>
<td data-label="Phone">555-123-4567</td>
<meta itemprop="telephone" content="+1-555-123-4567">
```

A CSS-attribute selector pre-pass can catch these with zero false positives:

```javascript
const SEMANTIC_SELECTORS = [
  '[itemprop="telephone"]',
  '[itemprop="phone"]',
  '[class*="phone"]',
  '[class*="tel"]',
  '[id*="phone"]',
  '[id*="tel"]',
  '[data-label*="phone" i]',
  '[data-label*="tel" i]',
];
```

**Caveats**:
- `[class*="phone"]` matches `.smartphone-icon`, `.microphone`, `.telephone-icon` — need more
  specific matching or combined with digit presence check.
- `[class*="tel"]` matches `.hotel`, `.channel`, `.intel` — very high FP rate from class names.
- `[itemprop="telephone"]` has essentially zero false positives — only used for Schema.org markup.
- `<meta itemprop="telephone">` content is not visible text — skip it.

**Recommendation**: Use `[itemprop="telephone"]` as a zero-FP semantic pre-pass. Skip the
class-name selectors (too noisy). Combine with the text-node regex approach.

---

## Section 3 — DOM-Specific Challenges Unique to PHONE

### 3.1 Non-Breaking Spaces (`\u00A0`, `&nbsp;`)

HTML `&nbsp;` renders as `\u00A0` in the DOM. Phone numbers typeset with non-breaking spaces
to prevent line-wrapping are common in headers and footers:

```
"(555)\u00A0123-4567"   — breaks /\(\d{3}\)\s?\d{3}/ which uses \s
"555\u00A0123\u00A04567" — all-space format with NBSP
```

`\s` in JavaScript regexes matches `\u00A0` only if the `u` flag is used **and** in Unicode mode,
or never at all in older engines. V8 (Chrome) and SpiderMonkey (Firefox) **do** match `\u00A0`
with `\s` without the `u` flag in recent versions (as of ES2018), but this is engine-specific.

**Safe fix**: Replace `\s` with `[\s\u00A0]` in all phone regexes, or normalize the text before
matching:

```javascript
function normalizeText(text) {
  return text.replace(/\u00A0/g, ' ')
             .replace(/\u2011/g, '-')  // non-breaking hyphen
             .replace(/\u2012/g, '-')  // figure dash
             .replace(/\u2013/g, '-')  // en dash
             .replace(/\u2014/g, '-'); // em dash (rare in phone numbers but appears in copy-paste)
}
```

Run `normalizeText` on the `textContent` before applying regexes. Use the normalized string for
match positions, then map back to the original text for span wrapping (positions are stable
because replacement is character-for-character).

**Note on dash normalization**: En dashes (`\u2013`) appear in copy-pasted phone numbers from
Word or PDF. `555\u2013123\u20134567` is a real-world occurrence. Without normalization, the
`[-.]` character class misses these.

### 3.2 Phone Numbers Split Across Elements

The text-node walker operates on individual `Text` nodes. A phone number split across sibling
elements cannot be detected:

```html
<span>555</span>-<span>123</span>-4567
<b>(555)</b> 123-4567
<span class="area">(555)</span><span class="number"> 123-4567</span>
```

In each case, each `Text` node contains only a fragment. No single text node contains a
matchable pattern.

**Approaches**:

1. **Skip it (Phase 1 recommendation)**: Cross-element splitting is uncommon in real contact data
   and extremely common in formatted displays where the developer deliberately structured the DOM.
   Attempting to stitch across element boundaries requires reading the parent's `textContent`
   (which merges child text nodes), but then the match positions can't be mapped back to the
   correct individual `Text` node for wrapping without a complex re-walk.

2. **Parent-level textContent scan**: For each text node, also check `parentElement.textContent`
   for a phone match. If found, wrap the parent element instead of splitting a text node. This
   handles `<span class="area">(555)</span><span class="number"> 123-4567</span>` but can over-
   blur when the parent contains mixed content.

3. **Composite text scan**: Walk up to the nearest `<p>`, `<div>`, `<td>`, `<li>` and get its
   `textContent`. Match there. Then walk the children to attribute the match to the right span.
   Expensive and complex.

**Decision**: Skip cross-element splitting in Phase 1. Document as a known limitation.

### 3.3 `href="tel:..."` Attributes

As covered in Section 2.5: `<a href="tel:+15551234567">` is detected via attribute scan.
The text-node walker should **skip descendants of `<a>` elements with `tel:` hrefs** to avoid
double-processing:

```javascript
// In iterateTextNodes filter:
const closestAnchor = node.parentElement.closest('a[href^="tel:"]');
if (closestAnchor) continue; // will be handled by tel: pre-pass
```

### 3.4 `<input type="tel">` and `<textarea>`

`<input>` elements have no text nodes — their value is accessed via the `.value` property.
`<textarea>` similarly.

The existing `SKIP_TAGS` set in `RESEARCH_PII_DETECTION.md` already excludes `INPUT`, `TEXTAREA`,
`SELECT`. This is correct. Masking input values would break form functionality.

**However**: `<input type="tel" placeholder="(555) 123-4567">` — the placeholder is not sensitive
data, but `value` might be. Out of scope for Phase 1.

### 3.5 Semantic HTML: `itemprop="telephone"`

```html
<span itemprop="telephone">(555) 123-4567</span>
```

The `itemprop="telephone"` attribute is a zero-false-positive signal. Handle via attribute
pre-pass (Approach F). The text node inside will also match the regex, so the pre-pass must
mark handled elements to avoid double-wrapping:

```javascript
function scanSemanticPhoneElements(root) {
  const nodes = root.querySelectorAll('[itemprop="telephone"],[itemprop="phone"]');
  for (const el of nodes) {
    if (!el.querySelector('[data-bl-si-pii]')) {
      // wrap the whole element, or let the text-node walker handle its text children
      el.setAttribute('data-bl-si-pii-semantic', 'PHONE');
    }
  }
}
```

Then in `iterateTextNodes`, skip nodes whose ancestor has `data-bl-si-pii-semantic`:
```javascript
if (node.parentElement.closest('[data-bl-si-pii-semantic]')) continue;
```

**Simpler approach**: Don't bother with a separate semantic pre-pass. The text node inside
`<span itemprop="telephone">` will be matched by the regex anyway. The semantic attribute just
tells us the site already labelled it. For Phase 1, let the regex handle it uniformly.

### 3.6 Phone Numbers in Button/Link Text

```html
<a href="tel:+15551234567">Call (555) 123-4567</a>
<button onclick="dial('5551234567')">555-123-4567</button>
```

In the first case: the visible text `"Call (555) 123-4567"` contains a matchable number. The
`tel:` pre-pass handles the link element; if we also skip children of `tel:` links in the text
walker, we avoid double-wrapping.

In the second case: the button text `"555-123-4567"` is a valid text node. The walker will
visit it and the regex will match. This is correct behavior — blur the displayed number.

`SKIP_TAGS` should NOT include `BUTTON` for PII purposes (the overview doc's `SKIP_TAGS` is
for general exclusion of non-content elements; buttons can contain real PII in their label text).

### 3.7 Copy-Paste Encoding Artifacts

Users and CMS tools paste phone numbers from various sources. Common encoding artifacts:

| Source | DOM result |
|--------|-----------|
| Word/Pages | `(555)\u2011123\u20114567` (non-breaking hyphen `\u2011`) |
| PDF copy | `555\u2013123\u20134567` (en dash) |
| Spreadsheet | `5.551234567E+09` (scientific notation for 10-digit bare number) |
| WhatsApp | `+1 555 123-4567` (space after country code, then mixed) |
| CRM export | `"5551234567"` (quoted, 10-digit bare) |

The normalization in 3.1 handles most dash variants. Scientific notation `5.55E+09` will not
match any phone regex — acceptable.

### 3.8 Aria-Label and Title Attributes

```html
<img aria-label="Call us at (555) 123-4567" src="phone-icon.png">
<span title="Phone: 555-123-4567"></span>
```

The text-node walker skips attribute content entirely — these won't be detected or blurred.
Blurring `aria-label` attributes is not achievable via CSS class injection anyway. Out of scope.

### 3.9 Numbers in `<code>` and `<pre>`

Code blocks often contain phone numbers in documentation, sample data, or JSON fixtures:
```
const phone = '555-123-4567';
example_customer.phone = "(555) 123-4567"
```

The `SKIP_TAGS` set includes `CODE` and `PRE`. This is correct — blurring code examples would
be disruptive and unhelpful.

### 3.10 RTL Text and Unicode Digit Ranges

Arabic-Indic digits (`\u0660`–`\u0669`), Devanagari digits (`\u0966`–`\u096F`), and other
Unicode digit ranges render as numerals but are not matched by `\d` in JavaScript (which matches
only `[0-9]` unless the `u` flag with Unicode property escapes is used).

This is acceptable for Phase 1 — international phone numbers in non-Latin digits are rare in
the DOM contexts this extension targets. If needed later, add: `/[\d\u0660-\u0669\u0966-\u096F]/`.

---

## Section 4 — False Positive Analysis

Phone number detection has the worst false positive rate of any common PII type. The digit
count, grouping, and separator patterns overlap with an enormous number of other data types.

### 4.1 False Positive Taxonomy

| Category | Example | Regex Group Hit | Severity | Disambiguation possible? | Context signal |
|----------|---------|-----------------|----------|--------------------------|---------------|
| ZIP codes | `90210` | None (5 digits) | N/A — no match | — | — |
| ZIP+4 | `90210-1234` | None (`NNN-XXXX` not `NNN-NNN-NNNN`) | N/A | — | — |
| Product SKU (3-3-4) | `SKU: 123-456-7890` | Group 5 | **Critical** | Partially | "SKU:", "Item #", "Part #" before match |
| Order/tracking number | `Order #555-123-4567` | Group 5 | **Critical** | Partially | "Order #", "#" immediately before |
| Date (common US format) | `12-25-2024` | None (year is 4 digits, not in NXX position) | Low | No | — |
| Date (ISO) | `2024-01-15` | None (first group is 4 digits) | Low | No | — |
| Date (European) | `25.12.2024` | None | Low | No | — |
| Date (ambiguous) | `01-15-2024` | None (4-digit final group) | Low | No | — |
| Social Security Number | `123-45-6789` | None (`NNN-NN-NNNN` not `NNN-NNN-NNNN`) | N/A | — | — |
| Credit card (chunked) | `4111 1111 1111 1111` | None (4-4-4-4, not NANP structure) | N/A | — | — |
| IP address | `192.168.1.100` | None (4 octets, last is 3 digits not 4) | Low | No | — |
| IP address | `192.168.10.4567` | Potentially Group 5 if `.` separator matches | Low | Yes | IP context |
| Version number (3-part) | `v5.5.12` | None (only 1-2 digits per group) | N/A | — | — |
| Version number (4-part) | `5.1.2.3456` | None (first group 1 digit) | N/A | — | — |
| UPC barcode | `0-12345-67890-5` | None (structure differs) | Low | — | — |
| ISBN-10 | `0-306-40615-2` | None (last group is 1 digit) | N/A | — | — |
| ISBN-13 | `978-3-16-148410-0` | None (first group 3 digits, second 1 digit) | N/A | — | — |
| Bank routing number | `021000021` | None (9 digits bare, no separators) | N/A | — | — |
| Fax number (= phone format) | `Fax: 555-123-4567` | Group 5 | Low | No — fax IS a phone | "Fax:" signal is helpful |
| Serial numbers (3-3-4) | `SN: 555-123-4567` | Group 5 | **High** | Partially | "SN:", "Serial:" before match |
| Case/ticket numbers | `Ticket 555-123-4567` | Group 5 | **High** | Partially | "Ticket #", "Case #" |
| Latitude/longitude | `40.712-74.006` | None (mixed negative, decimals) | N/A | — | — |
| Unix timestamp displayed | `1712345678` | None (10-digit bare, no match in formatted modes) | N/A | — | — |
| US tax ID (EIN) | `12-3456789` | None (2-7 not 3-3-4) | N/A | — | — |
| Employee ID (3-3-4) | `EMP: 123-456-7890` | Group 5 | High | Partially | "EMP:", "ID:" before match |
| Time + area code look-alike | `(555) 12:34:56` | None (colon breaks digit groups) | N/A | — | — |
| Numerical model number | `Model 555-123-4567` | Group 5 | **High** | Partially | "Model " before match |

### 4.2 Critical FP Pattern: 3-3-4 Digit Sequences

The single most dangerous false positive is any 10-digit number expressed in 3-3-4 grouping
with dashes or dots as separators. This pattern appears in:

- Product SKUs
- Order numbers
- Serial numbers
- Internal reference numbers
- Employee/customer IDs
- Document reference numbers

**Why it's hard**: The separator positions (3, 6) and digit count (10) are identical to a US
NANP phone number. There is no structural difference that a regex can detect.

**Context signal mitigation**: A word in the 20–40 characters immediately preceding the match
can disambiguate in many cases:

```javascript
const PHONE_CONTEXT_BEFORE = /(?:phone|call|tel|fax|contact|mobile|cell|direct|main|office|home|work|reach|dial|toll.?free|hotline|helpline|support|customer\s*service|whatsapp|sms|text|message|number|ph\.?|ph#|ph:|no\.?|#)\s*:?\s*$/i;

const NON_PHONE_CONTEXT_BEFORE = /(?:order|sku|serial|model|part|item|ref|reference|case|ticket|invoice|id|employee|emp|tracking|barcode|upc|isbn|account|acct|policy|license|licence|reg|registration|catalog|catalogue|code|number|no\.?)\s*:?#?\s*$/i;
```

Apply context scoring: if `PHONE_CONTEXT_BEFORE` matches, boost confidence. If
`NON_PHONE_CONTEXT_BEFORE` matches, suppress match.

### 4.3 NPA-Specific False Positives

The digit sequence `555` is particularly problematic:
- `555-1234` is a NANP subscriber number (7 digits, not 10 — not a match)
- `555-123-4567` looks like NANP — it is, but `555` is the NXX (exchange), not NPA
- When `555` appears as NPA: `(555) 123-4567` — the 555-XXXX range is reserved for fictional use
  (555-0100 through 555-0199 for drama/fiction, rest for assigned numbers)
- This means `555` area code numbers DO appear on web pages in fictional contexts (demos,
  documentation, movie prop websites) but are not real phone numbers

See Section 5.2 for NPA validation that can handle the 555-0100–555-0199 fiction range.

### 4.4 ZIP Code Analysis

5-digit ZIP codes: `90210`, `10001`. Do not match any phone regex here — bare 5-digit sequences
are well below the 10-digit NANP requirement. ZIP+4 `90210-1234` is 9 digits in 5-4 grouping,
which also does not match the 3-3-4 structure.

**ZIP codes are not a false positive risk** for the formatted-only detection approach.

### 4.5 Date Analysis

Most date formats in US use: `MM/DD/YYYY`, `MM-DD-YYYY`, `YYYY-MM-DD`, `DD.MM.YYYY`. In all of
these, the final group is 4 digits representing a year (1900–2099). Phone regex Group 5 requires
the second group to be `NNN` (3 digits) and the third group to be `XXXX` (4 digits). Dates have
the first group as 2-digit month/day, not 3-digit NPA. Example:

- `12-25-2024`: first group `12` (2 digits), fails `\b\d{3}[-.]` — NO MATCH
- `12.25.2024`: same — NO MATCH
- `2024-01-15`: first group `2024` (4 digits) — NO MATCH

**Dates are not a false positive risk** for the formatted phone regex approach.

The edge case: `100-125-2024` — could this look like a phone with year as subscriber? First
group `100` is a valid-looking NPA (starts with 1, but `10x` area codes don't exist in NANP —
NPAs don't start with 0 or 1). NPA validation in Section 5 catches this.

### 4.6 IP Address Analysis

`192.168.1.100` — four groups separated by dots: 3-3-1-3. Phone regex Group 5 matches
`NNN.NNN.NNNN` (exactly 3-3-4). The third and fourth dot-groups of an IP `1.100` are 1-3 digits,
not a 4-digit block. The regex `\b\d{3}[-.](\d{3})[-.](\d{4})\b` requires exactly 4 digits in
the final group — `100` is only 3, so NO MATCH.

What about `192.168.10.4567`? The final group `4567` is 4 digits. The second group `168` is 3.
But the first group `192` passes as NPA. This WOULD match Group 5.

**Mitigation**: NPA `192` is a valid US area code. In context, this looks like a phone number —
a human would also confuse it without context. The IP address context (surrounding text like
"IP address", "Server", "192.168.x.x") is the only reliable disambiguation.

### 4.7 SSN Analysis

SSN format: `NNN-NN-NNNN` (3-2-4 grouping). Phone Group 5 requires `NNN-NNN-NNNN` (3-3-4).
SSNs have a 2-digit middle group, not 3. Therefore:

`123-45-6789` — middle group `45` is 2 digits. Does NOT match `\b\d{3}[-.](\d{3})[-.](\d{4})\b`.

**SSNs are not a false positive for phone detection.** (The reverse — phone numbers accidentally
triggering SSN detection — is also not possible for the same reason.)

### 4.8 Credit Card Analysis

16-digit cards: `4111-1111-1111-1111` (4-4-4-4 grouping). No phone regex produces a 4-4-4-4
match. 15-digit Amex: `3714-496353-98431` (4-6-5 grouping). Neither is a phone false positive.

### 4.9 False Positive Rate Summary (Formatted-Only Approach)

Without context heuristics:
- Group 1-4 (`+1`, parenthesized NPA): FP rate ~5% (mainly demo/placeholder data)
- Group 5 (`NPA-NXX-XXXX` with dashes/dots): FP rate ~15–25% (SKUs, order numbers)
- Group 6 (international `+CC`): FP rate ~2% (very rare non-phone data starts with `+`)

With context heuristics (Section 4.2):
- Group 5 FP rate: drops to ~8–12%

With NPA validation (Section 5):
- Group 5 FP rate: drops further to ~5–8%

Overall combined FP rate estimate: **8–12%** for the formatted-only approach without context
heuristics; **4–7%** with both context heuristics and NPA validation.

---

## Section 5 — Validation Beyond Regex

### 5.1 NPA (Area Code) Validation

NANP rules for area codes:
1. NPA cannot start with `0` or `1` — these are reserved (0 for operator, 1 for toll prefix)
2. NPA second digit can be any digit 0–9 (as of 1995 expansion)
3. NPA cannot be `N11` (e.g., 211, 311, 411, 511, 611, 711, 811, 911) — service codes
4. NPA `555` is partly reserved (555-0100–555-0199 for fictional use)

These rules can be encoded in the regex directly:
```javascript
// Valid NPA: starts with [2-9], not N11 pattern
// N11 codes: 211, 311, 411, 511, 611, 711, 811, 911
const VALID_NPA = /^[2-9](?!11)\d{1}\d{1}$/;
// Or: /^[2-9](?!11)\d\d/  (as part of larger regex)
```

In practice, embedding this in the regex:
```javascript
// Replace \d{3} with [2-9](?!11)\d\d for NPA position:
/\b([2-9](?!11)\d{2})[-.](\d{3})[-.](\d{4})\b/gi  // Group 5 with NPA validation
```

**NXX (exchange) validation**: Exchange cannot start with 0 or 1 (same rule as NPA).
In Group 5, the second group `(\d{3})` should be `([2-9]\d{2})`:
```javascript
/\b([2-9](?!11)\d{2})-([2-9]\d{2})-(\d{4})\b/gi
```

**Impact**: This eliminates:
- `100-123-4567` (NPA starts with 1 — invalid)
- `011-123-4567` (NPA starts with 0 — international dialing prefix, not NANP)
- `211-123-4567` (211 is a service code)
- `411-555-1234` (411 is directory assistance)
- And any NXX starting with 0 or 1 in the exchange position

**Estimated FP reduction**: ~10–15% of false positives have invalid NPA/NXX by these rules.

### 5.2 The 555 Fiction Range

The `555` exchange in certain NPA codes is used for fictional phone numbers (per FCC allocation):
- `555-0100` through `555-0199` across ALL area codes — permanently reserved for fictional use
- `555-0100` to `555-0199` in any NPA — these are "guaranteed fake" numbers

```javascript
function is555FictionNumber(npa, nxx, xxxx) {
  if (nxx !== '555') return false;
  const sub = parseInt(xxxx, 10);
  return sub >= 100 && sub <= 199;  // 555-0100 to 555-0199
}
```

On web pages, `555-0100` through `555-0199` numbers appear in:
- Developer documentation
- Demo accounts
- Placeholder data
- Movie/TV prop sites

These should be excluded from detection. They are not real phone numbers.

**Note**: `555-1234` (7-digit format, NXX=555, sub=1234) is outside this range and may be a
real number (the fiction protection only covers 555-01xx). The regex won't match 7-digit bare
numbers anyway.

### 5.3 Context Signal Heuristics

A look-behind scan of the 0–50 characters immediately preceding a match provides strong signal:

```javascript
const PHONE_LABELS_RE = /(?:phone|call|tel|fax|contact|mobile|cell|direct|main|office|home|work|reach|dial|toll.?free|hotline|helpline|support|customer\s*service|whatsapp|sms|text|message|ph\.?|no\.?)\s*:?\s*$/i;

const NOT_PHONE_LABELS_RE = /(?:order|sku|ean|upc|serial|model|part|item|ref|reference|case|ticket|invoice|acct|policy|license|licence|reg|tracking|barcode|isbn|employee|emp)\s*[:#]?\s*#?\s*$/i;
```

Usage:
```javascript
function getContextScore(text, matchStart) {
  const before = text.slice(Math.max(0, matchStart - 50), matchStart);
  if (PHONE_LABELS_RE.test(before)) return +1;   // strong phone signal
  if (NOT_PHONE_LABELS_RE.test(before)) return -1; // strong non-phone signal
  return 0;  // neutral
}
```

A negative score suppresses the match. A positive score overrides NPA skepticism for ambiguous
cases.

**Caution with context heuristics**: They increase implementation complexity and must be tested
carefully. The label list must not be too aggressive — `"reference"` might appear before a
real phone number in some contexts. Start conservative.

### 5.4 Is a Mini NPA Whitelist Worth It?

The full NANP NPA list contains ~800+ assigned area codes (as of 2025). A compact whitelist
could eliminate all false positives where the detected NPA is not a real US/Canada area code.

**Size analysis**: A Set of ~800 3-digit strings = ~2400 bytes (800 × 3 chars) in the worst
case, or a compact prefix trie. This is manageable in a content script.

**However**:
1. NANP area codes change — new ones are allocated, old ones are retired. A hardcoded list
   becomes stale within 1–2 years without a maintenance process.
2. International numbers (`+CC` format) are unaffected — already handled separately.
3. The NPA structural rules (no 0/1 prefix, no N11) eliminate most obviously invalid codes
   without a whitelist.
4. The FP reduction from a full whitelist over the structural rules alone is modest (~5% of
   remaining FPs, since structural rules already eliminate the most common invalid patterns).

**Recommendation**: Use structural NPA/NXX validation (Section 5.1) as the primary validator.
Skip the full NPA whitelist for Phase 1 — maintenance cost outweighs accuracy gain. If accuracy
is later deemed insufficient, add a whitelist as a configuration option.

### 5.5 Combining Validators

Priority order for a candidate match:
1. Is it from a `tel:` href? → **Accept** (zero false positives).
2. Is it from `[itemprop="telephone"]`? → **Accept**.
3. Does `NON_PHONE_LABELS_RE` match the preceding context? → **Reject**.
4. Does `is555FictionNumber()` return true? → **Reject**.
5. Does NPA/NXX start with 0 or 1? → **Reject**.
6. Is NPA an N11 code (211, 311, 411, etc.)? → **Reject**.
7. Does `PHONE_LABELS_RE` match preceding context? → **Accept** (even if other validators
   are uncertain).
8. Otherwise → **Accept** (default-accept for formatted numbers, given FP rate is already
   reasonable for formatted patterns).

---

## Section 6 — All Solutions Matrix

| Solution | Description | Precision (est.) | Recall (est.) | Perf cost | Impl complexity |
|----------|------------|-----------------|---------------|-----------|-----------------|
| A: Single monolithic regex | One regex for all formats | Medium (65%) | Medium (80%) | Low (fast) but backtrack risk | Medium |
| B: Array of targeted regexes | One regex per format group | High (85–90%) | High (90–95%) | Low | Low |
| B+NPA: Approach B + NPA validation | Add NPA/NXX structural checks | High (88–92%) | High (90–95%) | Low | Low-medium |
| B+NPA+CTX: B + NPA + context heuristics | Add label scan | Very High (93–96%) | High (87–92%) | Low-medium | Medium |
| C: Loose digit extraction | Extract all digit runs, validate length | Medium-low (60%) | Very High (97%) | Low | Low |
| C+ctx: Loose + context required | Require phone label for any match | High (90%) | Medium (70%) | Low | Medium |
| D: libphonenumber-js | Gold standard library | Very High (98%) | Very High (98%) | High (145 KB) | **Not viable (no bundler)** |
| E: tel: href only | Attribute scan only | Very High (99%) | Very Low (20%) | Very low | Very low |
| F: Semantic + regex | itemprop pre-pass + B | Very High | High | Low | Low-medium |
| **Bare-10-digit (no separators)** | `\b\d{10}\b` | Very Low (10–15%) | Very High | Very low | Trivial — but useless alone |
| **Bare-10-digit + NPA + context required** | Require phone label context for bare | Medium (60%) | Medium | Low | Medium |
| **Do nothing for bare 10-digit** | Only match formatted | High (85–90%) | Medium (80%) | — | — |

**Winner**: `B+NPA` as the default on. `bare-10-digit + context required` as a separate opt-in
sub-flag (`AUTO_DETECT.PHONE_BARE` or a `PHONE_STRICT: false` mode toggle).

---

## Section 7 — Recommended Approach with Exact Regexes

### 7.1 Core Recommendation

Use **Approach B (array of targeted regexes) + NPA structural validation + 555-fiction filter**.
Optionally layer context heuristics (Section 5.3) for Group 5 (the highest-FP group).

Do not attempt vanity number detection (too high FP) or bare 10-digit detection (too high FP)
in the default-on mode. Bare 10-digit should be a user opt-in.

### 7.2 Complete Regex Suite (Priority Order)

Run these in order. Collect all matches across all regexes, then de-overlap (earliest start wins,
tie-break by length — longer match preferred).

```javascript
/**
 * PHONE detection regexes for pii_detector.js
 * Run in priority order; de-overlap after collecting all matches.
 * Each regex must be reconstructed with `new RegExp(re.source, 'gi')` before use
 * to avoid lastIndex bleed on reuse.
 */

// ── Priority 1: E.164 +1 with parenthesized NPA ────────────────────────────────
// Matches: +1 (555) 123-4567  +1(555)123-4567  +1 (800) 555-1234
// Does not match: +1 (011) 555-1234 (NPA 011 starts with 0 — invalid)
const PHONE_P1 = /\+1[-.\s]?\(([2-9]\d{2})\)[-.\s]?([2-9]\d{2})[-.\s](\d{4})(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?/gi;

// ── Priority 2: E.164 +1 without parens ────────────────────────────────────────
// Matches: +1-555-123-4567  +1.555.123.4567  +1 555 123-4567
const PHONE_P2 = /\+1[-.\s]?([2-9]\d{2})[-.\s]([2-9]\d{2})[-.\s](\d{4})(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?/gi;

// ── Priority 3: 1-NPA-NXX-XXXX (leading 1, no +) ─────────────────────────────
// Matches: 1-555-123-4567  1 (800) 555-1234  1.555.123.4567
// Word boundary at start to avoid matching "21-555-123-4567"
const PHONE_P3 = /\b1[-.\s]?\(([2-9]\d{2})\)[-.\s]?([2-9]\d{2})[-.\s](\d{4})(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?\b/gi;
const PHONE_P3B = /\b1[-.\s]([2-9]\d{2})[-.\s]([2-9]\d{2})[-.\s](\d{4})(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?\b/gi;

// ── Priority 4: (NPA) NXX-XXXX — parenthesized area code ─────────────────────
// Matches: (555) 123-4567  (800)555-1234  (555) 123.4567
// NPA: [2-9] start, not N11.  NXX: [2-9] start.
const PHONE_P4 = /\(([2-9](?!11)\d{2})\)\s?([2-9]\d{2})[-.\s](\d{4})(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?/gi;

// ── Priority 5: NPA-NXX-XXXX (dashes or dots, no parens) ─────────────────────
// Matches: 555-123-4567  555.123.4567
// Highest FP group — apply context heuristics and NPA validation.
// NPA [2-9][^1]1\d forbidden (N11 codes). NXX [2-9]\d{2}.
// Word boundary on BOTH sides critical for SKU/order FP reduction.
const PHONE_P5 = /\b([2-9](?!11)\d{2})[-.]([2-9]\d{2})[-.]([\d]{4})\b(?:\s*(?:ext\.?|x|#)\s*\d{1,6})?/gi;

// ── Priority 6: International E.164 (non-+1 country codes) ───────────────────
// Matches: +44 20 7946 0958  +49 30 12345678  +91 98765 43210
// Country code: 2 or 3 digits (not +1 — handled by P1/P2).
// Total digits after + and country code: 6–12.
// Conservative: require at least one separator after country code.
const PHONE_P6 = /\+(?!1(?!\d))([2-9]\d{0,2})[-.\s](?:\d[-.\s]?){5,12}\d/gi;

// ── Optional Priority 7: Bare 10-digit (OPT-IN ONLY) ─────────────────────────
// Matches: 5551234567  8005551234
// ONLY enable when AUTO_DETECT.PHONE_BARE === true.
// Requires preceding phone context label to suppress FPs.
// NPA [2-9], NXX [2-9] validated structurally.
const PHONE_P7_BARE = /\b([2-9](?!11)\d{2})([2-9]\d{2})(\d{4})\b/gi;
```

### 7.3 Post-Match Validation Function

Apply after each regex match to filter invalid candidates:

```javascript
/**
 * Validate an extracted phone number's structural properties.
 * @param {string} npa - Area code digits (3 chars)
 * @param {string} nxx - Exchange digits (3 chars)
 * @param {string} xxxx - Subscriber digits (4 chars)
 * @returns {{ valid: boolean, reason: string }}
 */
function validateNANP(npa, nxx, xxxx) {
  // NPA must start with [2-9]
  if (/^[01]/.test(npa)) return { valid: false, reason: 'NPA starts with 0 or 1' };

  // NPA cannot be N11 service code
  if (/^[2-9]11$/.test(npa)) return { valid: false, reason: 'NPA is N11 service code' };

  // NXX must start with [2-9]
  if (/^[01]/.test(nxx)) return { valid: false, reason: 'NXX starts with 0 or 1' };

  // 555 fiction range
  if (nxx === '555') {
    const sub = parseInt(xxxx, 10);
    if (sub >= 100 && sub <= 199) {
      return { valid: false, reason: '555-01xx fiction range' };
    }
  }

  return { valid: true, reason: null };
}
```

### 7.4 Text Normalization Before Matching

```javascript
/**
 * Normalize typographic characters that appear in phone numbers copied from
 * Word, PDFs, or CMS editors. Replacement is 1-for-1 so match positions
 * remain valid in the original string.
 */
function normalizePhoneText(text) {
  return text
    .replace(/\u00A0/g, ' ')   // non-breaking space → regular space
    .replace(/\u2011/g, '-')   // non-breaking hyphen → hyphen
    .replace(/\u2012/g, '-')   // figure dash → hyphen
    .replace(/\u2013/g, '-')   // en dash → hyphen
    .replace(/\u2014/g, '-');  // em dash → hyphen (rare but occurs in copy-paste)
}
```

### 7.5 Context Heuristics for Group 5 (Optional but Recommended)

```javascript
const PHONE_LABEL_BEFORE_RE = /(?:phone|ph\.?|tel\.?|fax|call|contact|mobile|cell|direct|main|office|home|work|reach|dial|toll.?free|hotline|helpline|whatsapp|sms)\s*[:#]?\s*$/i;
const NON_PHONE_LABEL_BEFORE_RE = /(?:order|sku|ean|upc|barcode|serial|sn|model|part#?|item#?|ref\.?|reference|case#?|ticket#?|invoice#?|acct|account|policy|license|licence|reg#?|tracking|employee|emp|document|doc)\s*[:#]?#?\s*$/i;

function phoneContextScore(text, matchStart) {
  const window = text.slice(Math.max(0, matchStart - 50), matchStart);
  if (NON_PHONE_LABEL_BEFORE_RE.test(window)) return -1;
  if (PHONE_LABEL_BEFORE_RE.test(window)) return +1;
  return 0;
}
```

For Group 5 matches, only suppress (score -1); do not require positive context. This keeps
recall high on contact pages that don't use labels.

### 7.6 Complete Match Collection Function

```javascript
/**
 * Collect all phone number matches in a text string.
 * Returns sorted, de-overlapped array of { start, end, type: 'PHONE' }.
 *
 * @param {string} rawText - Original text node content
 * @param {boolean} bareEnabled - Whether to also match bare 10-digit numbers
 * @returns {Array<{start: number, end: number, type: string}>}
 */
function collectPhoneMatches(rawText, bareEnabled) {
  const text = normalizePhoneText(rawText);
  const raw = [];

  const regexes = [PHONE_P1, PHONE_P2, PHONE_P3, PHONE_P3B, PHONE_P4, PHONE_P5, PHONE_P6];
  if (bareEnabled) regexes.push(PHONE_P7_BARE);

  for (const pattern of regexes) {
    const re = new RegExp(pattern.source, 'gi'); // fresh instance — no lastIndex bleed
    let m;
    while ((m = re.exec(text)) !== null) {
      // Extract NPA/NXX/XXXX for NANP structural validation
      // Capture groups vary by regex — normalize:
      const digits = m[0].replace(/\D/g, '');
      let npa, nxx, xxxx;
      if (digits.length === 11 && digits[0] === '1') {
        npa = digits.slice(1, 4);
        nxx = digits.slice(4, 7);
        xxxx = digits.slice(7, 11);
      } else if (digits.length === 10) {
        npa = digits.slice(0, 3);
        nxx = digits.slice(3, 6);
        xxxx = digits.slice(6, 10);
      } else {
        // International — skip NANP validation
        raw.push({ start: m.index, end: m.index + m[0].length, type: 'PHONE' });
        continue;
      }

      const { valid } = validateNANP(npa, nxx, xxxx);
      if (!valid) continue;

      // Context check (primarily for Group 5 — but apply broadly for bare)
      const score = phoneContextScore(text, m.index);
      if (score < 0) continue; // explicit non-phone context

      raw.push({ start: m.index, end: m.index + m[0].length, type: 'PHONE' });
    }
  }

  // Sort by start position, then de-overlap (earliest wins; longer match preferred on tie)
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  let last = 0;
  for (const m of raw) {
    if (m.start >= last) {
      result.push(m);
      last = m.end;
    }
  }
  return result;
}
```

### 7.7 Bare 10-Digit: Separate Opt-In Setting

**Should bare 10-digit numbers be detected by default?** No.

Reasons:
1. FP rate without context: 70–80% (any 10-digit product code, Unix timestamp, account number).
2. Even with context required: ~40% FP rate (many contexts are neutral).
3. Most real-world bare 10-digit numbers on web pages are: order numbers, account numbers,
   tracking numbers, timestamps — all non-phone.

**Proposed opt-in mechanism**:

Add a sub-key to `AUTO_DETECT.PHONE`:
```javascript
// Option A: separate top-level key
AUTO_DETECT: {
  EMAIL: false,
  PHONE: false,          // formatted only
  PHONE_BARE: false,     // opt-in: bare 10-digit with context required
  SSN: false,
  CREDIT_CARD: false,
  FINANCIAL: false,
}

// Option B: nested object under PHONE
AUTO_DETECT: {
  EMAIL: false,
  PHONE: { enabled: false, includeBare: false },
  SSN: false,
  ...
}
```

Option A is simpler and consistent with the existing flat shape. Option B is more structured
but breaks the current boolean pattern. **Recommend Option A** for now — `PHONE_BARE` as a
separate flag. If `PHONE` is true and `PHONE_BARE` is false, only formatted patterns match.

**Update `src/constants.js`** `DEFAULT_SETTINGS.AUTO_DETECT` to add `PHONE_BARE: false` when
implementing. Document in `CLAUDE.md` settings shape section.

---

## Section 8 — Unit Test Cases

25+ test cases for `pii_detector.js`. Format: `input → match? → captured text`.

### IMPORTANT: NXX Constraint Affects All Test Examples

The NXX (exchange) validation rule requires the first digit to be 2–9. This means the commonly
cited example `(555) 123-4567` does **NOT match** the recommended regexes: NXX=`123` starts with
`1`, which is invalid per NANP structural rules and is filtered by `validateNANP()`. All test
cases below use NXX values with a first digit of 2–9 (e.g., `234`, `456`, `987`).

The **format catalog in Section 1** correctly lists `(555) 123-4567` as a format variant that
appears on real web pages. The NANP rules do not prevent humans from writing it — they only mean
the number is unassigned/invalid. The regex with NXX validation will reject it. If the extension
must match it, the NXX constraint must be relaxed to `\d{3}` (no `[2-9]` prefix) — but this
significantly increases the FP rate for Group 5. The default recommendation is to apply the
structural constraint and document `(555) 123-4567` as an expected non-match.

### 8.1 Positive Cases (Should Match)

| # | Input text | Match? | Expected captured text | Notes |
|---|-----------|--------|----------------------|-------|
| 1 | `Call us at (555) 234-5678 today` | YES | `(555) 234-5678` | NXX=234, valid |
| 2 | `Phone: (800) 555-2000` | YES | `(800) 555-2000` | NXX=555, sub=2000 (outside fiction range) |
| 3 | `Fax 555.234.5678` | YES | `555.234.5678` | Dot-separated, valid NXX |
| 4 | `+1-555-234-5678` | YES | `+1-555-234-5678` | E.164 with dash |
| 5 | `+1 (555) 234-5678` | YES | `+1 (555) 234-5678` | E.164 with paren |
| 6 | `1-800-555-2000` | YES | `1-800-555-2000` | Toll-free, outside fiction range |
| 7 | `555-234-5678 ext. 890` | YES | `555-234-5678 ext. 890` | Extension with period |
| 8 | `555-234-5678 x890` | YES | `555-234-5678 x890` | x-prefix extension |
| 9 | `555-234-5678 #890` | YES | `555-234-5678 #890` | Hash extension |
| 10 | `Contact: +44 20 7946 0958` | YES | `+44 20 7946 0958` | UK number via PHONE_P6 |
| 11 | `Tel: +49 30 12345678` | YES | `+49 30 12345678` | German number |
| 12 | `Mobile: +91 98765 43210` | YES | `+91 98765 43210` | Indian mobile |
| 13 | `(555)\u00A0234-5678` (NBSP after paren) | YES | normalized → `(555) 234-5678` | NBSP normalized before matching |
| 14 | `555\u2013234\u20135678` (en dashes) | YES | `555-234-5678` (normalized) | En dash normalized to hyphen |
| 15 | `Tel 1.555.234.5678` | YES | `1.555.234.5678` | Country code + dot separators |
| 16 | `(888) 555-0200` | YES | `(888) 555-0200` | 555-0200 is outside fiction range (0100–0199) |
| 17 | `Call (555) 234-5678 or (555) 987-6543` | YES | both `(555) 234-5678` and `(555) 987-6543` | Two phones de-overlapped |
| 18 | `+1(212)555-2000` (no spaces) | YES | `+1(212)555-2000` | Compact E.164 paren format |
| 19 | `Call toll-free: 1-866-234-5678` | YES | `1-866-234-5678` | Toll-free NPA |
| 20 | `Main: (202) 456-7890` | YES | `(202) 456-7890` | Valid real-world NPA+NXX |

### 8.2 Negative Cases (Should NOT Match)

| # | Input text | Match? | Why not |
|---|-----------|--------|---------|
| 21 | `ZIP code 90210` | NO | 5 digits, no separator |
| 22 | `ZIP+4: 90210-1234` | NO | 5-4 grouping, not 3-3-4 |
| 23 | `Date: 12-25-2024` | NO | First group 2 digits (not 3) |
| 24 | `ISO date: 2024-01-15` | NO | First group 4 digits |
| 25 | `SSN: 123-45-6789` | NO | Middle group 2 digits (not 3) |
| 26 | `IP: 192.168.1.100` | NO | 4 octets, last group 3 digits |
| 27 | `v5.5.1.2345` | NO | First group 1 digit |
| 28 | `ISBN: 978-3-16-148410-0` | NO | Structure 3-1-2-6-1, not 3-3-4 |
| 29 | `SKU: 234-567-8901` under context `SKU:` | NO | NON_PHONE_LABEL match suppresses; note NXX=567 is valid, making this a real-world FP risk without context heuristics |
| 30 | `Order #555-234-5678` under context `Order #` | NO | NON_PHONE_LABEL match suppresses |
| 31 | `(555) 012-3456` | NO | NXX 012 starts with 0 — invalid per NANP structural rule |
| 32 | `(155) 234-5678` | NO | NPA 155 starts with 1 — invalid per NANP structural rule |
| 33 | `(211) 555-2000` | NO | NPA 211 is N11 service code |
| 34 | `(555) 555-0150` | NO | NXX=555, sub=0150 → in fiction range 0100–0199 |
| 35 | `5552345678` (bare 10-digit, default-off mode) | NO | Bare 10-digit not detected by default PHONE setting |
| 36 | `Card: 4111-1111-1111-1111` | NO | 4-4-4-4 grouping, not 3-3-4 |
| 37 | `192.168.1.1` | NO | IP address structure; last group is 1 digit not 4 |
| 38 | `Serial: 555-234-5678` under context `Serial:` | NO | NON_PHONE_LABEL match suppresses |
| 39 | `Employee ID: 555-234-5678` under context `Employee ID:` | NO | NON_PHONE_LABEL suppresses |
| 39b | `(555) 123-4567` (common example from Section 1) | NO | NXX=123 starts with 1 — eliminated by NXX structural rule; this is the critical consequence of applying NXX validation |

### 8.3 Edge Cases

| # | Input text | Match? | Notes |
|---|-----------|--------|-------|
| 40 | `(888) 555-0100` | NO | 555-0100 is first in fiction range |
| 41 | `(888) 555-0199` | NO | 555-0199 is last in fiction range |
| 42 | `(888) 555-0200` | YES | 0200 is outside fiction range |
| 43 | `+1 (011) 555-1234` | NO | NPA 011 starts with 0 — invalid |
| 44 | `phone: 555-234-5678` (formatted, PHONE=true, label present) | YES | Context label + valid NXX |
| 45 | `5552345678` (bare, PHONE_BARE=true, no label) | Depends | No label → neutral context → implementation decides; recommend accept |
| 46 | `SKU: 5552345678` (bare, PHONE_BARE=true, label present) | NO | NON_PHONE_LABEL suppresses |
| 47 | `(555) 234-5678 ext 1234` | YES | Extension captured; NXX=234, valid |
| 48 | `Our support line (888) 555-2000 handles billing` | YES | `(888) 555-2000`; mixed in sentence |
| 49 | `tel:+15552345678` (inside an href attr) | N/A | Not a text node — handled by scanTelLinks() pre-pass |
| 50 | `<span itemprop="telephone">555-234-5678</span>` inner text | YES | Matched by regex; itemprop is optional zero-FP pre-pass |
| 51 | `9-digit: 555-234-567` | NO | Only 9 total digits — last group `567` is 3 digits, not 4; no match |
| 52 | `11-digit with CC: +1 555 234 5678` | YES | `+1 555 234 5678`; 11 digits with E.164 country code |

---

## Appendix A — NANP NPA N11 Service Codes

The following area codes are N11 service codes and are not valid NANP NPAs:
`211`, `311`, `411`, `511`, `611`, `711`, `811`, `911`

These must not be treated as phone numbers even when they appear in 3-3-4 format.
The NPA regex `[2-9](?!11)\d{2}` correctly rejects all of these.

## Appendix B — Toll-Free NPA Codes (as of 2025)

`800`, `833`, `844`, `855`, `866`, `877`, `888`

These are valid NPAs with real subscriber assignments. Numbers in these ranges are unambiguously
phone numbers. The NPA structural rules do not restrict them.

## Appendix C — Common Copypaste Artifacts Quick Reference

| Unicode char | Code point | Name | Normalize to |
|---|---|---|---|
| ` ` (NBSP) | `\u00A0` | No-break space | space |
| `‑` | `\u2011` | Non-breaking hyphen | `-` |
| `‒` | `\u2012` | Figure dash | `-` |
| `–` | `\u2013` | En dash | `-` |
| `—` | `\u2014` | Em dash | `-` |

## Appendix D — Known Limitations

| Limitation | Root cause | Status |
|---|---|---|
| Phone numbers split across sibling elements | TreeWalker visits individual Text nodes | Known gap — Phase 1 skip |
| Vanity numbers (1-800-FLOWERS) | Letter mapping requires alpha-in-digit pattern | Out of scope Phase 1 |
| Non-Latin digit scripts (Arabic-Indic, Devanagari) | `\d` matches [0-9] only | Out of scope Phase 1 |
| Bare 10-digit detection | Very high FP rate | Opt-in only via PHONE_BARE flag |
| International formats beyond common E.164 | Infinite format variety | Best-effort only |
| Phone in aria-label/title attributes | Attribute values not text nodes | Out of scope |
| Phone in `<input>` values | Input has no text nodes | Out of scope Phase 1 |
| Copy-paste in emoji-heavy contexts (📞555-1234) | Emoji before number | Works — regex ignores preceding emoji |
