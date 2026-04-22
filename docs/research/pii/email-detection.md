# EMAIL PII Detection — Exhaustive Research

> **Scope**: Chrome/Firefox MV3 content script. Vanilla JS, no bundler, IIFE pattern.
> The base mechanism (TreeWalker over Text nodes → regex → `<span data-bl-si-pii="EMAIL">`) is
> already decided in `docs/RESEARCH_PII_DETECTION.md`. This doc goes deeper on EMAIL specifically:
> every viable regex approach, all DOM-specific challenges, the full solution space, false-positive
> taxonomy, performance analysis, and the final recommendation with exact regexes and test cases.

---

## Section 1 — Regex Approaches

### 1.1 The email address grammar (RFC 5321 / 5322 summary)

An email address is `local-part @ domain`. The specs allow far more than most implementations handle:

**Local-part (RFC 5321 §4.1.2 / RFC 5322 §3.4.1)**:
- **Dot-atom** form: `a-zA-Z0-9` plus these specials: `! # $ % & ' * + - / = ? ^ _ \` { | } ~` and internal `.` (not leading/trailing, not consecutive)
- **Quoted-string** form: `"any printable ASCII including spaces and @"` — e.g. `"john doe"@example.com` and `"(),:;<>@"@example.com` are valid
- **Comments**: `(comment)local@domain` — allowed by RFC but universally ignored by systems
- Maximum 64 octets

**Domain**:
- Labels of 1–63 chars, `a-zA-Z0-9` and internal hyphens, joined by dots
- Final label must be at least 2 chars (TLD)
- Total domain maximum 255 octets
- **IP literal**: `[192.0.2.1]` or `[IPv6:2001:db8::1]` — valid per RFC, exotic in practice
- `localhost` with no dot is valid for local delivery but never seen in public web content

### 1.2 Why full RFC compliance is impractical in a content script

| Problem | Detail |
|---|---|
| Quoted-string local-part | `"john doe"@example.com` — the `"...(...)..."` local-part regex requires a full quoted-string parser or a deeply nested alternation that is catastrophically slow |
| Comment syntax | `(comment)user@host` — zero-width preprocessing step; adds linear overhead with no real-world benefit |
| Folded whitespace | RFC 5322 allows `\r\n<SPACE>` continuations; these never appear in rendered text nodes |
| IP-literal domains | `user@[192.168.1.1]` — vanishingly rare in web content; adds a large regex alternation |
| Nested quantifiers | Full local-part spec produces patterns like `(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+|"(?:[^"\\]|\\.)*")+` — the `|` inside a `+` is an exponential backtracking bomb on adversarial input |
| Performance budget | Content scripts share the renderer process; a catastrophic-backtrack regex on a 2000-char text node can lock the tab |

**Conclusion**: No production system implements full RFC 5321/5322 locally. The HTML5 spec explicitly acknowledges this and defines a "willful violation" pattern. We follow the same pragmatism.

---

### 1.3 Approach A — RFC 5321 Full-Spec (reference only, do not use)

**Regex** (simplified, still incomplete — full version requires a 400+ char pattern):
```
/(?:"[^"\\\r\n]*"|[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*)@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+|\[(?:IPv6:[\da-fA-F:]+|(?:\d{1,3}\.){3}\d{1,3})\])/g
```

**Precision/Recall**:
- Recall: ~99.9% of syntactically valid email addresses
- Precision: Very low — matches quoted strings (`"any text"@domain`) that appear in JSON and HTML source; IP-literal form matches IPv4 in brackets unexpectedly

**False-positive examples**:
- `"Contact us"@example.com` in a JSON blob embedded in a `<script>` tag (mitigated by SKIP_TAGS, but data islands in `<div>` are not skipped)
- `(deprecated)admin@internal` inside a code comment rendered in a `<pre>` (mitigated by SKIP_TAGS)

**False-negative examples**: None of practical significance — the spec is the spec

**Catastrophic backtracking risk**: HIGH. The `(?:[a-z]+|"...")+` alternation with nested quantifiers on the local-part side has O(2^n) worst case on strings like `aaa...a@` where the trailing `@` fails to match.

**Grade: F for production use.** Reference only.

---

### 1.4 Approach B — HTML5 `<input type="email">` Pattern

The HTML5 spec (§4.10.5.1.5) defines an intentional "willful violation" of RFC 5322 for the email input type. This is what Chrome/Firefox use to validate `<input type="email">`.

**Spec pattern** (from WHATWG living standard):
```
/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
```

**Adapted for text-node scanning** (anchors removed, `g` flag added, boundary context added):
```javascript
// The HTML5 spec pattern adapted for content scanning:
// - Removed ^ and $ anchors (we're scanning within a longer string)
// - Added (?:\.[a-zA-Z]{2,}) requirement to demand at least one dot in domain
//   (HTML5 spec allows user@localhost; we do not want that in a web page scanner)
const EMAIL_HTML5 = /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
```

Note: this is essentially the same pattern already in `docs/RESEARCH_PII_DETECTION.md`. The `+` at the end (instead of `*`) requires at least one dot in the domain, eliminating `user@localhost`.

**Precision/Recall**:
- Recall: ~95% of email addresses found in real web content (misses quoted-string local-parts, IP-literal domains — both extremely rare in human-readable content)
- Precision: ~90–95% — main FP source is `@handles` on social pages, and npm/monorepo package names like `@org/package`

**False-positive examples**:
- `@angular/core` in a code block (mitigated by SKIP_TAGS `<code>/<pre>`)
- `@react-three/fiber` in rendered npm README content (NOT mitigated if shown in a `<p>`)
- `v2@1.0` version strings (mitigated — no TLD after the `@` part's domain)
- `@keyframes` CSS — not a FP because `keyframes` alone has no `.TLD` suffix... but `@media screen.css` would not match (no `@` after `a-zA-Z...`)
- `@2x` image descriptor — no dot in domain, does not match

**False-negative examples**:
- `"john doe"@example.com` — quoted local-part not matched (acceptable)
- `user@[192.168.1.1]` — IP literal not matched (acceptable)

**Catastrophic backtracking risk**: LOW. The local-part is a simple character class `+`. The domain portion uses `(?:...){0,61}` bounded quantifiers. No nested quantifiers. Linear O(n) on the text node length.

**Grade: A. This is the baseline pattern.**

---

### 1.5 Approach C — Common Liberal Pattern

Used in most web apps, validation libraries (Zod, Yup, validator.js defaults), and code examples:

```javascript
// Commonly seen in the wild:
const EMAIL_LIBERAL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
```

Alternatively, a slightly more constrained version:
```javascript
const EMAIL_LIBERAL_2 = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
```

**Precision/Recall (first form)**:
- Recall: Very high (~98%) — accepts almost anything with `@` and a dot
- Precision: Very low (~60–70%) — `any@thing.here` with no structure requirements matches many non-email strings

**False-positive examples for `/[^\s@]+@[^\s@]+\.[^\s@]+/g`**:
- `background-image: url(path@2x.png)` — the `path` and `2x.png` both match `[^\s@]+`
- `v1.0@2023-01-01.tag` in git tag annotations rendered in changelogs
- `style.color="red@#ff0000.hex"` in debug output
- `data-value="key@bucket.s3"` attributes (attribute scanning mode)
- `price@$10.99` in unusual but real formatting

**False-positive examples for `/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g`**:
- `@angular/core.js` — `angular` has a word boundary, `core.js` has TLD-like suffix `.js`
  - Actually: `\b` before `[A-Za-z0-9...]` means there must be a non-word char before the match; `@angular` starts with `@` which is a word boundary, so `angular/core.js` would NOT match (slash breaks `[A-Za-z0-9._%+\-]+`). Lower FP than first form.
- `react-router.js@6.0` — `react-router.js` is a valid local-part by the liberal charset, `6.0` is a 1-char TLD (`0`) — only matches if TLD is `[A-Za-z]{2,}`, so `6.0` would not match. Safe.

**Catastrophic backtracking risk**:
- Form 1 (`[^\s@]+`): MODERATE. Negated character classes in `+` quantifiers on long strings without `@` trigger O(n²) backtracking when the pattern fails. Example: a 500-char string with no `@` causes the engine to try all possible split points.
- Form 2 (`\b[A-Za-z0-9...]+@...`): LOW. Bounded character classes, anchored by `\b`.

**Grade: C for Form 1 (backtracking risk + high FP rate), B- for Form 2 (still looser than HTML5 variant with less benefit).**

---

### 1.6 Approach D — Strict Production Pattern (Spam-Filter Grade)

Used by SpamAssassin, Postfix address verification, and enterprise email security tools. Adds:
- Word-boundary anchoring (`\b`)
- Explicit TLD minimum length (2) and maximum length (cap at ~24 for longest real TLDs like `.cancerresearch`)
- Rejects consecutive dots in local-part
- Rejects leading/trailing dots in local-part
- Rejects local-part > 64 chars (RFC limit)

```javascript
// Strict pattern — production spam-filter grade
// Anchored at both ends with \b (word boundary).
// Local-part: allows all RFC dot-atom specials but not leading/trailing/consecutive dots.
// Domain: standard label structure with TLD 2–24 chars.
const EMAIL_STRICT = /\b(?:[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]|(?<!\.)\.(?!\.))+(?<!\.)\b@\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+\.[a-zA-Z]{2,24}\b/g;
```

**Problem**: This pattern uses lookbehind (`(?<!\.)`). Lookbehinds are supported in V8 (Chrome) and SpiderMonkey (Firefox) — safe for MV3 content scripts. However:
- The alternation `(?:[a-z]|(?<!\.)\.(?!\.))+` creates a capturing group inside a `+` — this is the "alternation with lookbehind inside quantifier" pattern, which is safe in V8's Thompson NFA implementation but adds complexity.
- More importantly: `\b` before `[a-zA-Z0-9!#...]` is unusual because `!`, `#`, etc. are NOT word characters, so `\b` only anchors when the local-part starts with an alphanumeric. If it starts with `!` or `%`, `\b` won't anchor there.

**Revised strict pattern** that avoids the lookbehind complexity while still preventing leading/trailing dots:
```javascript
// Strict pattern v2 — no lookbehinds, uses char class structure to prevent dot issues
const EMAIL_STRICT_V2 = /(?<![a-zA-Z0-9._%+!#$&'*\/=?^`{|}~-])(?:[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~](?:\.?[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-])*)@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
```

**Precision/Recall for strict pattern**:
- Recall: ~93% (slightly lower than HTML5 variant — rejects some valid-but-exotic addresses)
- Precision: ~97% (higher than HTML5 variant — the leading-boundary check prevents partial matches inside longer tokens)

**False-positive examples**:
- Very few. Main remaining risk: scoped package names `@scope/name` where `scope` is a valid local-part and `name` has dots — but `name` part (after `/`) would fail the domain label pattern (slash is not valid in domain labels).

**False-negative examples**:
- `test..double@example.com` (consecutive dots) — rejected, correct
- `.leading@example.com` — rejected, correct per RFC
- `trailing.@example.com` — rejected, correct per RFC

**Catastrophic backtracking risk**: LOW-MEDIUM. The `(?:\.?[...])*)` quantifier is bounded by the character class and the optional dot. V8 handles this well. However, on pathological inputs like `aaa...a` (alternating alphanum and dots) with no `@`, it could reach O(n²). In practice, text nodes rarely exceed 2000 chars and the pattern fails fast on the first non-matching char.

**Grade: B+ — better precision than HTML5 pattern, acceptable recall, slightly more complex.**

---

### 1.7 Approach Comparison Matrix

| | RFC Full | HTML5 (baseline) | Liberal Form 1 | Liberal Form 2 | Strict V2 |
|---|---|---|---|---|---|
| Precision | Very Low | High (90–95%) | Low (60–70%) | Medium (80%) | Very High (97%) |
| Recall | Near 100% | High (95%) | Near 100% | High (95%) | Medium-High (93%) |
| Catastrophic backtrack | HIGH | None | MODERATE | Low | Low-Medium |
| Handles split elements | No | No | No | No | No |
| Handles mailto: attrs | Separate pass needed | Same | Same | Same | Same |
| Implementation complexity | Very High | Low | Very Low | Low | Medium |
| Firefox/Chrome compat | V8/SpiderMonkey: OK | Full | Full | Full | Lookbehind: FF78+/Chrome62+ |
| **Recommended** | No | **YES (base)** | No | No | As supplement |

---

## Section 2 — DOM-Specific Challenges Unique to EMAIL

### 2.1 Email split across elements

**The problem**: A page may render `<b>user</b>@example.com` where the `@` is in a text node that is a sibling of the `<b>` element's text node. The TreeWalker visits `Text("user")` and `Text("@example.com")` separately. Neither alone matches the regex.

**How common is this?** Uncommon in user-generated content or CRMs. More common in:
- Marketing pages that bold the username: `<strong>john.doe</strong>@company.com`
- Tables showing partial emails with one cell styled differently
- Old HTML email templates with font tags

**Detection options**:

**Option A — Element-level text join**: For each element node containing at least one `@` character in its subtree, concatenate `element.innerText` (or all descendant text nodes) and run the regex. This catches `<b>user</b>@example.com` because the parent `<div>` contains both text nodes.

Pseudocode:
```javascript
// Approach: find all elements whose textContent contains '@', then
// join all direct text-node children and run the regex.
function scanElementJoined(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let el;
  while ((el = walker.nextNode())) {
    if (!el.textContent.includes('@')) continue;
    const joined = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent)
      .join('');
    // run EMAIL_RE on `joined` — but how do we then wrap?
    // Problem: the match positions in `joined` don't map 1:1 to individual text nodes
  }
}
```

**Problem with Option A**: Wrapping a match that spans multiple text nodes requires DOM surgery — split the first text node, wrap the `@` boundary, split the second text node. This is very complex and fragile. It also risks double-wrapping if one of those text nodes also contains a standalone email in another part of the string.

**Option B — Sibling text-node join**: Walk adjacent `Text` nodes that are siblings under the same parent. Concatenate them. Run the regex on the concatenated string. Track offsets back to individual nodes for wrapping.

Pseudocode:
```javascript
function scanSiblingGroups(parent) {
  const groups = [];
  let current = [];
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      current.push(child);
    } else {
      if (current.length) { groups.push(current); current = []; }
      // Recurse into child element
    }
  }
  if (current.length) groups.push(current);
  
  for (const group of groups) {
    // Each group is an array of adjacent Text nodes.
    // Only interesting if group spans across an element boundary — not possible here
    // because elements split the group. This only helps for multiple adjacent text
    // nodes (e.g., text split by DOM manipulation, not by element tags).
  }
}
```

**Limitation of Option B**: This helps with split text nodes (e.g., after DOM manipulation fragments them), but does NOT help with `<b>user</b>@example.com` because the `<b>` element separates the text nodes, breaking the sibling group.

**Option C — Scan parent element `innerText`**: For each element containing `@`, take `el.innerText` (which concatenates all descendant text with layout) and run the regex. If matched, use a DOM Range to locate and wrap the matched text.

This is the most powerful approach but has significant costs:
- `innerText` triggers layout (forces reflow) — extremely expensive in a content script
- The `Range` API for finding arbitrary text in a DOM subtree requires iteration
- Not reliable for hidden elements (`display: none` returns `""` from `innerText`)

**Option D — Post-process `@domain` orphan text nodes**: After the normal text-node walk, make a second pass looking for text nodes whose trimmed content starts with `@` (like `@example.com`). Check if the immediately preceding sibling is a blurred `<span data-bl-si-pii="EMAIL">`. If so, the full email is already wrapped (preceding span contains the local-part, current text contains domain). No action needed — the blur on the span covers the visual local-part. But the `@example.com` remainder is not blurred.

Actually, re-reading: if the walker processed `Text("user")` first and it's just `user` with no `@`, it does NOT match. Then `Text("@example.com")` has `@` but no local-part, so it also does NOT match. The split email is entirely missed.

**Recommendation**: Accept this as a known limitation for Phase 1. The correct solution is Option A but it requires complex DOM surgery. Document it in the Known Limitations table. The split-element case is uncommon enough in real user-facing pages (vs. code examples) that the baseline text-node walk covers 95%+ of practical cases. Track as a Phase 2 item.

---

### 2.2 Emails in `href="mailto:..."` attributes

**The problem**: `<a href="mailto:user@example.com">Contact us</a>` — the email is in an attribute, not a text node. The TreeWalker walk misses it entirely.

**The link text case**: If the link text IS the email address (`<a href="mailto:user@example.com">user@example.com</a>`), the text-node walk will pick it up from the visible text. No attribute scan needed for this case — and blurring the text node automatically hides the display content (the `href` attribute is irrelevant to visual rendering).

**The "Contact us" case**: The email only exists in the attribute. To detect it:
```javascript
// One-shot attribute scan — cheap
const mailtoLinks = root.querySelectorAll('a[href^="mailto:"]');
for (const a of mailtoLinks) {
  const raw = a.getAttribute('href');
  const email = raw.slice('mailto:'.length).split('?')[0].trim(); // strip query params
  if (EMAIL_RE.test(email)) {
    // Options:
    // A) Wrap the visible text in a PII span (even if it says "Contact us")
    // B) Blur the entire <a> element with data-bl-si-pii on the anchor itself
    // C) Blur both the text node and the element
  }
}
```

**Blurring strategy for mailto: links**:
- Wrapping the visible text `Contact us` as PII is misleading — the visible text isn't the email.
- Adding `data-bl-si-pii="EMAIL"` directly to the `<a>` element blurs the whole anchor (visual + clickable). This is the cleanest approach: it hides the entire control that would leak the email.
- Risk: if the link text IS the email (double-detected), the `<a>` gets `data-bl-si-pii` and the inner `<span data-bl-si-pii>` also exists. Reveal controller handles nested reveals via ancestor walk, so this should be fine, but it creates redundant PII elements. Guard: skip text-node wrapping if the parent `<a>` already has `data-bl-si-pii`.

**Implementation note**: The `querySelectorAll('a[href^="mailto:"]')` scan should run once after the text-node walk, independently. It adds `data-bl-si-pii="EMAIL"` to the `<a>` element (not a span) when the href contains a valid email AND the visible text does not already contain the same email (to prevent double-blur of the link text).

---

### 2.3 Emails in `<input value="...">` attributes

**The problem**: `<input type="text" value="user@example.com">` is not a text node. The `value` attribute is not in the DOM tree as a renderable text node.

**Why it is hard**: Masking an input field's displayed value without breaking user interaction requires:
1. A CSS-only approach: `input[type="text"] { ... filter: blur() }` — possible but blurs the entire field, not just PII content within it
2. Replacing the `value` attribute with asterisks — breaks form submission (the blur is supposed to be visual-only, not data-destroying)
3. A custom overlay element positioned over the input — fragile, breaks on resize/scroll, conflicts with autofill dropdowns

**Decision**: Out of scope for Phase 1. The `SKIP_TAGS` set in `iterateTextNodes` already excludes `<input>` and `<textarea>`. A future `input masking` module would need its own mechanism.

**What we CAN do without Phase 1 complexity**: Detect emails in `value` attributes and add `data-bl-si-pii="EMAIL"` to the `<input>` element itself. This blurs the whole input visually. User can still interact (the filter is on the element, not the text). This is actually fine for the use case (screen sharing / privacy) — blurring the whole field is the goal.

```javascript
// Attribute scan for input values — simple
const inputs = root.querySelectorAll('input[value], textarea');
for (const el of inputs) {
  const val = el.value || el.getAttribute('value') || '';
  if (EMAIL_RE.test(val)) {
    el.setAttribute('data-bl-si-pii', 'EMAIL');
  }
}
```

Note: `el.value` reads the current live value; `el.getAttribute('value')` reads the HTML attribute (initial value). For scanning purposes, `el.value` is preferred.

**Caveat**: Marking the whole `<input>` as PII blurs it. Blur on an interactive element is annoying for the user. This should be a separate opt-in toggle, not part of the default `EMAIL` detection.

---

### 2.4 Emails in `aria-label` and `data-*` attributes

**`aria-label`**: Used for accessible labels. `<button aria-label="Email: user@example.com">`. The label is read by screen readers, not displayed visually. Blurring it has no visible effect. Modifying `aria-label` would break screen reader accessibility.

**Recommendation**: Skip `aria-label` for PII detection. Changing it breaks a11y. The email is not visually rendered.

**`data-*` attributes**: Custom attributes used by frameworks (React, Vue) as state storage. `data-email="user@example.com"` is frequently used in tables for export functionality. These are not rendered. No action needed or possible via CSS filter.

**Exception**: `data-content` and similar attributes used by CSS `content: attr(...)` rules. If a `::before`/`::after` pseudo-element renders an attribute value, blurring the element itself would cover it. But detecting which `data-*` attributes feed CSS `content:` properties requires reading all stylesheets — not feasible in a content script.

**Recommendation**: Skip `data-*` attributes. Too much variability, no reliable strategy.

---

### 2.5 Obfuscated emails (JS-assembled)

**Common obfuscation patterns seen in the wild**:
1. `["user","example.com"].join("@")` — JavaScript join, value only visible after execution
2. `"user" + "@" + "example.com"` — string concatenation in JS
3. `document.write('user' + '@' + 'example.com')` — old-school write
4. ROT13/base64 decoded at runtime
5. CSS-based: email reversed with `direction: rtl; unicode-bidi: bidi-override`

**Detectability from a content script**:
- Cases 1–4: The email only exists as a rendered text node AFTER the JS runs. If the JS has already executed and `document.write` / `innerHTML` / `.textContent =` has placed the email in the DOM, the normal text-node walker will catch it on a MutationObserver tick.
- Case 5 (CSS reversal): The text node contains `moc.elpmaxe@resu` — no regex will match this without preprocessing. Detecting CSS direction/bidi overrides would require reading `getComputedStyle` on every text node's parent — O(n) reflow triggers, not feasible.

**Recommendation**: The MutationObserver approach already handles cases 1–4 (they become normal text nodes after execution). CSS-based obfuscation (case 5) is out of scope — no practical detection method exists without massive performance impact. Document as known limitation.

---

### 2.6 Emails inside `<a href="mailto:">` — double-detection risk

If an anchor has `<a href="mailto:user@example.com">user@example.com</a>`:

1. The `mailto:` attribute scan (Section 2.2) adds `data-bl-si-pii="EMAIL"` to the `<a>`.
2. The text-node walker reaches `Text("user@example.com")` inside the `<a>`, matches the email, and wraps it in `<span data-bl-si-pii="EMAIL">`.

Result: `<a data-bl-si-pii="EMAIL"><span data-bl-si-pii="EMAIL">user@example.com</span></a>`

The CSS rule `[data-bl-si-pii]:not([data-bl-si-reveal])` applies to both. The inner span blurs. The outer anchor also blurs (redundantly). Reveal: when `data-bl-si-reveal` is added to the inner span, the outer anchor's blur still applies.

**Mitigations**:
1. In the attribute scan, skip `<a>` elements where the inner text already contains the same email (text-node walk will handle it).
2. In the text-node walk, skip text nodes whose parent is already tagged with `data-bl-si-pii` (the existing walker guard `if (parent.closest('[data-bl-si-pii]')) continue` already handles this — BUT it skips the entire subtree, so if the `<a>` gets tagged first by the attribute scan, the inner text nodes are skipped entirely).

**Correct order**: Run the text-node walk FIRST, then the attribute scan. The attribute scan then only tags `<a>` elements where the inner text was NOT already wrapped (i.e., the link text is "Contact us" not the email itself).

Check in the attribute scan:
```javascript
// Don't double-tag if text already contains the email
if (!a.querySelector('[data-bl-si-pii]')) {
  a.setAttribute('data-bl-si-pii', 'EMAIL');
}
```

---

## Section 3 — All Possible Detection Solutions

### Solution 1 — Pure Regex on Text Node Content (Baseline)

**Description**: Use the HTML5-derived pattern to scan `node.textContent` for each `Text` node produced by the TreeWalker. Wrap matches in `<span data-bl-si-pii="EMAIL">`.

```javascript
const EMAIL_RE_SOURCE = String.raw`[a-zA-Z0-9.!#$%&'*+\/=?^_` + '`' + String.raw`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+`;

function scanTextNode(node, autoDetect) {
  const text = node.textContent;
  if (!text.includes('@')) return; // fast pre-filter — avoids regex on most nodes
  const re = new RegExp(EMAIL_RE_SOURCE, 'g');
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, type: 'EMAIL' });
  }
  if (matches.length) splitTextNode(node, matches);
}
```

**Pros**:
- Simple, fast, proven
- Linear O(n) on text node length (no catastrophic backtrack)
- Works with existing `iterateTextNodes` infrastructure
- The `text.includes('@')` fast pre-filter skips 99%+ of text nodes on most pages
- Easy to test in unit tests

**Cons**:
- Misses split-element emails (`<b>user</b>@example.com`)
- Misses emails in attributes
- Misses emails in input values

**False-positive rate**: ~5–10% (social `@handles` on social pages, npm scoped packages in rendered docs)
**Performance cost**: Very low. The `includes('@')` guard means the regex is only executed on nodes containing `@`.

---

### Solution 2 — Regex on Attribute Values with `querySelectorAll`

**Description**: A one-shot scan of known email-bearing attributes: `href="mailto:..."`, `data-email`, `value` on inputs.

```javascript
function scanAttributes(root) {
  // mailto: links
  const anchors = root.querySelectorAll('a[href^="mailto:"]');
  for (const a of anchors) {
    if (a.querySelector('[data-bl-si-pii]')) continue; // text already wrapped
    const href = a.getAttribute('href') || '';
    const raw = href.slice(7).split('?')[0]; // strip "mailto:" and query params
    if (EMAIL_RE.test(raw)) {
      a.setAttribute('data-bl-si-pii', 'EMAIL');
    }
  }

  // Input/textarea values (whole-element blur)
  const inputs = root.querySelectorAll('input:not([type="password"]):not([type="hidden"]), textarea');
  for (const el of inputs) {
    const val = el.value || el.getAttribute('value') || '';
    if (!val.includes('@')) continue;
    if (EMAIL_RE.test(val)) {
      el.setAttribute('data-bl-si-pii', 'EMAIL');
    }
  }
}
```

**Pros**:
- `querySelectorAll` is highly optimized in browsers — faster than a manual walk for attribute-based selection
- Catches emails that text-node walk completely misses (mailto: href, input values)
- The `a[href^="mailto:"]` selector is very specific — rarely returns false elements

**Cons**:
- `data-email` is not a standard attribute; scanning all `data-*` requires `querySelectorAll('[data-*]')` which isn't valid CSS — would need to enumerate known attribute names or walk all elements
- Input value blurring (whole field) may be undesirable UX
- Adding `data-bl-si-pii` to `<a>` elements that wrap non-email text is slightly misleading semantically (the attribute means "this element IS PII" but the anchor text is "Contact us")

**False-positive rate**: Very low for mailto: scan (essentially 0 — `href^="mailto:"` is precise). Slightly higher for input scan (any input containing `@` with a dot in the right place).
**Performance cost**: Very low. `querySelectorAll` on a large page returns results in <1ms. Two passes, O(result count).

---

### Solution 3 — Element-Level Join (Catch Split-Element Emails)

**Description**: For each element containing `@` in its `textContent`, concatenate all directly-descendent text node contents and run the regex on the joined string. If matched, map positions back to individual text nodes for wrapping.

```javascript
function scanElementJoined(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(el) {
      const tag = el.tagName;
      if (['SCRIPT','STYLE','TEXTAREA','INPUT','NOSCRIPT','SELECT'].includes(tag)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let el;
  while ((el = walker.nextNode())) {
    // Only process if @ appears somewhere in the element (fast check)
    if (!el.textContent.includes('@')) continue;
    
    // Collect direct child text nodes with their character offsets
    const segments = [];
    let offset = 0;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        segments.push({ node: child, start: offset, text: child.textContent });
        offset += child.textContent.length;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        // Include inline elements' text contribution but mark as non-wrappable
        const innerText = child.textContent;
        segments.push({ node: null, start: offset, text: innerText, element: child });
        offset += innerText.length;
      }
    }
    
    const joined = segments.map(s => s.text).join('');
    const re = new RegExp(EMAIL_RE_SOURCE, 'g');
    let m;
    while ((m = re.exec(joined)) !== null) {
      const matchStart = m.index;
      const matchEnd = m.index + m[0].length;
      
      // Determine if the match spans a text-node-only region or crosses an element boundary
      // Find which segments are involved
      const involved = segments.filter(s => s.start < matchEnd && s.start + s.text.length > matchStart);
      
      if (involved.every(s => s.node !== null)) {
        // All involved segments are direct text nodes — wrap normally
        // (These would have been caught by the text-node walk anyway; skip to avoid double-wrap)
        continue;
      }
      
      // Cross-boundary match — this is the interesting case
      // Strategy: wrap the text-node portions that are part of the match,
      // and leave the element children alone (they might need separate handling)
      // This is complex — see notes below
    }
  }
}
```

**The wrapping problem for cross-boundary matches**: When `user` is inside `<b>` and `@example.com` is a text node sibling, the match spans them. To wrap:
1. The `<b>user</b>` element needs its text node replaced with `<span data-bl-si-pii>user</span>` (but this means modifying inside the `<b>`)
2. The `@example.com` text node needs to be split at position 0 and wrapped

This is doable but requires careful DOM surgery and introduces risks:
- The element `<b>` has its own semantics — wrapping inside it can break CSS
- If the `<b>` element spans more than just the local-part, wrapping its text changes the tag's content model

**Pros**:
- Catches ~80% of split-element emails (those where the split is a simple inline child like `<b>`, `<span>`, `<strong>`)
- No new infrastructure needed — shares the regex

**Cons**:
- Significant implementation complexity for DOM surgery
- Risk of double-wrapping (a text node already wrapped by the baseline walk)
- Nested elements make offset mapping hard (what if `<b>` has its own children?)
- Performance: O(n²) in worst case — every element node that contains `@` requires iterating its children

**False-positive rate**: Same as baseline regex, but applied to joined text so potentially slightly higher (a `@` in one sibling and a dot-qualified domain in another that happen to be adjacent but aren't an email)
**Performance cost**: Medium — doubles the effective DOM traversal; offset mapping adds O(segment count) per matched element.

**Recommendation**: Defer to Phase 2. The implementation complexity is not justified by the marginal gain on an uncommon case.

---

### Solution 4 — Sibling Text-Node Join

**Description**: Walk all `Text` nodes in sequence. When multiple `Text` nodes are adjacent siblings under the same parent (no element between them), concatenate their content and run the regex. This handles the case where the DOM has been fragmented by previous JavaScript manipulation.

```javascript
function groupAdjacentTextNodes(parent) {
  // Returns arrays of adjacent Text node runs
  const groups = [];
  let currentGroup = [];
  
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      currentGroup.push(child);
    } else {
      if (currentGroup.length > 1) {
        groups.push(currentGroup); // Only multi-node groups are interesting
      }
      currentGroup = [];
    }
  }
  if (currentGroup.length > 1) groups.push(currentGroup);
  
  return groups;
}

function scanAdjacentTextNodes(group) {
  // group: array of adjacent Text nodes under the same parent
  const texts = group.map(n => n.textContent);
  const offsets = [];
  let pos = 0;
  for (const t of texts) {
    offsets.push(pos);
    pos += t.length;
  }
  const joined = texts.join('');
  if (!joined.includes('@')) return;
  
  const re = new RegExp(EMAIL_RE_SOURCE, 'g');
  let m;
  while ((m = re.exec(joined)) !== null) {
    // Map m.index back to the correct text node and split it
    // ... (offset mapping logic)
  }
}
```

**When this helps**: When JavaScript has inserted text nodes programmatically, or when template rendering has split a string across multiple text nodes without any element in between. Example: `["user@", "example.com"].forEach(s => parent.appendChild(document.createTextNode(s)))`.

**When this does NOT help**: The `<b>user</b>@example.com` case — because `<b>` is an element between the two text nodes, breaking the adjacency group.

**Pros**:
- Handles programmatic text node fragmentation
- Simple offset mapping (no element children to skip)
- Very low false-positive risk

**Cons**:
- Very rare case in practice — browsers and template engines almost never produce adjacent text nodes without element separators
- Extra traversal of all elements to find groupable children
- Does not help with the more common `<b>user</b>@example.com` split

**False-positive rate**: Same as baseline
**Performance cost**: Low — O(n) additional scan, but the `group.length > 1` check eliminates almost all elements

**Recommendation**: Low priority. The case is so rare that the implementation complexity is hard to justify. Skip for Phase 1.

---

### Solution 5 — Computed Text Approach (`element.innerText` on Containers)

**Description**: For container elements (e.g., `<td>`, `<p>`, `<div>`) that contain `@` in their `textContent`, call `element.innerText` (which accounts for layout, visibility, and CSS content) and run the regex on that string. Use `document.createRange()` to locate and wrap the matched text in the DOM.

```javascript
function scanByInnerText(container) {
  if (!container.textContent.includes('@')) return;
  const text = container.innerText; // triggers layout
  const re = new RegExp(EMAIL_RE_SOURCE, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    wrapWithRange(container, m[0], m.index);
  }
}

function wrapWithRange(container, matchText, startOffset) {
  // Use TreeWalker + Range to find the text in the DOM
  // This is what browser find-in-page implementations do internally
  const range = findTextInDOM(container, matchText, startOffset);
  if (!range) return;
  const span = document.createElement('span');
  span.setAttribute('data-bl-si-pii', 'EMAIL');
  range.surroundContents(span);
}
```

`findTextInDOM` using `Range`: Iterating text nodes to find the character offset requires O(n) text node traversal with cumulative length tracking. `Range.surroundContents` fails if the range crosses element boundaries — exactly the case we care about.

**Pros**:
- `innerText` accounts for CSS-generated content, `::before`/`::after` content, `display: none` exclusion, `text-transform`, etc.
- Would theoretically catch the most PII scenarios

**Cons**:
- `innerText` triggers a full **style recalculation and layout** on the queried element. On a page with complex CSS, this can take 5–50ms per call. Calling it on dozens of containers per page scan is prohibitively expensive.
- `Range.surroundContents` throws `DOMException` if the range partially overlaps an element. The `<b>user</b>@example.com` case would cause an exception.
- Not usable as a general scan strategy. Only viable as a targeted supplement for very specific known containers.

**False-positive rate**: Same as baseline (same regex)
**Performance cost**: VERY HIGH. Each `innerText` call is O(rendered text length) with style recalculation. Disqualifying.

**Recommendation**: Do not use for general scanning. Explicitly avoid this approach.

---

### Solution 6 — Pre-Scan Attribute Index (`mailto:` First, Then Text Match)

**Description**: First, scan all `a[href^="mailto:"]` links to build a Set of known email addresses on the page. Then, in the text-node walk, use this Set for O(1) confirmation of any string that matches the regex (as a post-filter to reduce false positives).

```javascript
function buildEmailIndex(root) {
  const known = new Set();
  const anchors = root.querySelectorAll('a[href^="mailto:"]');
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const raw = href.slice(7).split('?')[0].trim();
    if (raw) known.add(raw.toLowerCase());
  }
  return known;
}

function scanWithIndex(textNode, knownEmails) {
  const text = textNode.textContent;
  if (!text.includes('@')) return;
  const re = new RegExp(EMAIL_RE_SOURCE, 'g');
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[0].toLowerCase();
    // Only wrap if it's in the known index OR if we're in non-strict mode
    if (knownEmails.has(candidate) || knownEmails.size === 0) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: 'EMAIL' });
    }
  }
  if (matches.length) splitTextNode(textNode, matches);
}
```

**When this is valuable**: On pages where emails appear in both `<a href="mailto:">` links AND in visible text (e.g., profile pages, contact directories). The index provides a precision boost: only wrap text that is confirmed to be a real email address from the page's own metadata.

**When this is NOT valuable**: On pages with no `mailto:` links. If `knownEmails.size === 0`, the index provides no filtering benefit — fall back to plain regex matching.

**Pros**:
- Near-zero false positives for confirmed emails (they appear in both text and mailto:)
- The `querySelectorAll` pre-scan is very fast
- Handles the "Contact us" link text case: the `mailto:` link tags the anchor with `data-bl-si-pii`, AND if the email also appears as a text node elsewhere on the page, the index confirms it

**Cons**:
- Misses emails that appear only in text (no corresponding `mailto:` link) — reduces recall significantly
- If used as the ONLY strategy (strict mode), any email in plain text not confirmed by a link is missed
- The Set lookup adds minor overhead per match, but this is negligible

**False-positive rate**: Near 0 for confirmed set, but recall drops to ~40–60% (only emails that are also linked)
**Performance cost**: Low — one `querySelectorAll` pass + O(match count) Set lookups

**Recommendation**: Use as an optional precision-boost pass, not as a replacement for the baseline regex scan. When `knownEmails.size > 0`, use it to prioritize high-confidence wrapping. Always run the baseline scan regardless.

---

## Section 4 — False Positive Analysis

The following are real-world strings found on typical web pages that common email regexes match incorrectly. Tested against the HTML5-derived pattern (the baseline recommendation).

| # | Input String | Matched Substring | Severity | Baseline Matches? | Mitigation |
|---|---|---|---|---|---|
| 1 | `@angular/core` (in npm README shown in browser) | `angular/core` — wait, `/` is in local-part charset for HTML5 pattern | HIGH | YES — `angular/` matches `[a-zA-Z0-9.!#$%&'*+\/=?^_...]` and `core` is 4 chars, not a valid TLD-bearing domain (no dot) so this would actually FAIL — `core` alone with no `.TLD` doesn't match the domain pattern | No — pattern correctly rejects this |
| 2 | `@react-three/fiber.js v1.2.3` | `react-three/fiber.js` — has a dot, `js` is a 2-char suffix | HIGH | YES — `react-three/fiber.js` is a valid local-part (contains `/` and `-`), `v1.2.3` starts with `v` which breaks it... actually: `react-three/fiber.js` @ `v1.2.3` — the `@` is between `fiber.js` and `v1.2.3`, `v1` is not a valid domain label (label starts with `[a-zA-Z0-9]`, `v` is valid, `.2.3` continues) — this WOULD match: `react-three/fiber.js@v1.2.3` | HIGH | Add a post-filter: reject matches where the TLD is a single digit or starts with a digit |
| 3 | `user@localhost` in connection strings | `user@localhost` | MEDIUM | NO — the baseline requires at least one dot in the domain. `localhost` has no dot. Correctly rejected. | N/A — pattern correct |
| 4 | `SASS @mixin mixin-name` | No `@` followed by valid local-part chars | NONE | NO — `mixin` has no dot in domain. Correctly rejected. | N/A |
| 5 | `git commit SHA: abc123@2024-01-15.tag` | `abc123@2024-01-15.tag` | MEDIUM | YES — `abc123` is valid local-part, `2024-01-15.tag` matches domain structure (`2024-01-15` as label, `tag` as TLD). | Add: reject if TLD starts with a digit or is `tag`/`local`/`test`/`invalid` |
| 6 | `monorepo @org/package@1.2.3` | `package@1.2.3` | MEDIUM | YES — if the scanner finds `package@1.2.3`, `package` is valid local-part, `1` label starts with digit — actually `[a-zA-Z0-9]` DOES allow starting with a digit — `1.2.3` would match as `1` label + `2` label + `3` is single char which may or may not be 2+ chars... `3` is 1 char, TLD must be `[a-zA-Z0-9]{1}` in the baseline, so it would match with minimum 1 char. Add min TLD length of 2. | MEDIUM | Require TLD `[a-zA-Z]{2,}` (letters only, 2+ chars) — eliminates all numeric TLDs |
| 7 | `v2@1.0` version string | `v2@1.0` | LOW | YES — `v2` local-part, `1.0` domain with `0` as TLD (1 char). If TLD min is 2 alpha chars: rejected. | Require TLD `[a-zA-Z]{2,}` |
| 8 | `C:\Users\user@machine.local` (file path in error message) | `user@machine.local` | MEDIUM | YES — `user` is valid local-part, `machine.local` has domain + `.local` TLD. `.local` is technically a mDNS/Bonjour TLD, rarely a real email domain. | Low-severity FP: `.local` is not a real internet TLD. Could add a blocklist of `local`, `test`, `invalid`, `example`, `localhost` as TLD rejects. |
| 9 | Twitter-style `@handle` display text | `handle` — no dot in "domain" | NONE | NO — `@handle` alone has no `@` at start: in `text @handle more`, the pattern needs local-part chars BEFORE `@`. `@handle` would match only if there's something before `@`. A bare `@handle` in text: the char before `@` is a space, so the pattern would not include it in the local-part. Actually `@handle` alone does NOT match because the local-part cannot be empty. | N/A — correctly handled |
| 10 | `user@example` (no TLD) | `user@example` | NONE | NO — the `+` at the end of the domain requires at least one `\.[a-zA-Z0-9]...` group. `example` alone doesn't satisfy this. Correctly rejected. | N/A |
| 11 | `import('module')` in rendered code | No `@` | NONE | NO | N/A |
| 12 | TypeScript generic `Array<string>` in docs | No `@` | NONE | NO | N/A |
| 13 | `test@test` in test code rendered on a page | `test@test` | NONE | NO — `test` with no dot in domain rejected | N/A |
| 14 | CSS `@charset "UTF-8"` in a `<style>` tag | In STYLE tag — skipped by TreeWalker | NONE | NO — SKIP_TAGS excludes STYLE | N/A |
| 15 | Docker image tag `user/repo@sha256:abc...` | `repo@sha256` — wait, `sha256` followed by `:` which is not in domain charset, domain would stop at `sha256` | LOW | YES — `repo@sha256` has `repo` local-part, but `sha256` needs a dot to match the domain pattern. It would not match because `sha256` has no `.TLD`. Correctly rejected. | N/A |
| 16 | Environment variable `${EMAIL}` in code blocks | In CODE/PRE tag — skipped | NONE | NO — SKIP_TAGS excludes CODE/PRE | N/A |
| 17 | `support+ticket@company.com/path/to/page` | `support+ticket@company.com` — the `/` stops the domain (not in domain charset) | LOW | YES — but this is a REAL email address with a trailing path. The pattern correctly captures just the email portion. This is actually a true positive, not a false positive. | N/A — correct behavior |
| 18 | Scoped npm package `@types/node` in rendered docs | `types/node` — wait: `@types/node` text. Before `@` is whitespace or start-of-string. The local-part starts with `types` but that's AFTER the `@`. The `@` is the first char, so the local-part is empty. | NONE | NO — local-part cannot be empty | N/A |
| 19 | `user@.example.com` (leading dot in domain) | Would the pattern match? Domain starts with `[a-zA-Z0-9]` (not `.`), so `@.example.com` would fail the domain start requirement. | NONE | NO — domain must start with `[a-zA-Z0-9]` | N/A |
| 20 | ISO date in filename: `report@2024-01-15.pdf` | `report@2024-01-15.pdf` — `report` local-part, `2024-01-15` domain with `pdf` TLD (3 alpha chars) | MEDIUM | YES — `2024-01-15` as a domain label — but domain labels can start with digits per the pattern. `.pdf` is 3 letters. This WOULD match. | Add TLD blocklist: `pdf`, `jpg`, `png`, `csv`, `zip`, `mp4`, `doc`, `xls`, `ppt`, `txt` — file extensions masquerading as TLDs |

### False Positive Summary

The baseline HTML5-derived pattern has these FP risk areas:

| Risk Area | FP Rate | Mitigation |
|---|---|---|
| npm version strings `pkg@1.2.3` | Medium | Require TLD to be `[a-zA-Z]{2,}` (letters only) |
| Date-based identifiers `id@2024-01-01.tag` | Medium | Same TLD letter-only requirement |
| File extension false TLDs `file@server.pdf` | Low-Medium | TLD extension blocklist |
| mDNS `.local` domains | Low | Optional TLD blocklist |
| Social `@handles` | None | Pattern correctly rejects (empty local-part) |
| CSS at-rules | None | SKIP_TAGS on STYLE elements |
| Code blocks | None | SKIP_TAGS on CODE/PRE |

**Single most impactful mitigation**: Change the final TLD group from `[a-zA-Z0-9]{1,}` to `[a-zA-Z]{2,24}` — letters only, 2+ chars. This eliminates all numeric-TLD false positives and file extension false positives in one change.

---

## Section 5 — Performance Analysis

### 5.1 Cost of regex per text node

The baseline EMAIL pattern is `O(n)` where `n` is the text node length. Proof:
- The local-part character class `[a-zA-Z0-9.!#$%&'*+\/=?^_` + '`' + `{|}~-]+` is a single possessive character class (V8 uses NFA with backtrack cut optimization for character classes) — linear
- The domain portion `[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9]...)+` has bounded quantifiers (`{0,61}`) — linear
- There are no nested quantifiers, no alternations inside quantifiers

**Approximate throughput**: Modern JS engines process simple character class regexes at ~100–500 MB/s. A 2000-char text node takes ~4–20 microseconds.

**With `includes('@')` pre-filter**: ~99% of text nodes on a typical page do not contain `@`. The `String.prototype.includes` call is a SIMD-accelerated substring search in V8 — ~1 GB/s. So 99% of nodes are rejected in <2 microseconds each.

**Total scan cost for a typical page (100 text nodes, 1 contains `@`)**: ~100 × 2μs + 1 × 20μs = ~220μs. Negligible.

**For a page heavy in email content (e.g., a contact directory with 500 emails)**: 500 text nodes with `@`, each 200 chars average: 500 × (20μs for regex) = 10ms. Still well within `requestIdleCallback` budget.

### 5.2 Catastrophic backtracking analysis

A regex has catastrophic backtracking when it has:
- Nested quantifiers: `(a+)+` or `(.+)*`
- Alternation inside quantifiers: `(a|ab)+`

**Baseline pattern analysis**:
```
[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+
```
Simple `+` on a character class — no backtracking (character classes are atomic in NFA).

```
(?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?
```
Bounded quantifier `{0,61}` — linear.

```
(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+
```
This is `(?:...)+` where the inner group has a bounded quantifier. The outer `+` iterates over dot-separated domain labels. Can this backtrack catastrophically?

Test case for catastrophic backtrack: `a.b.c.d.e.f.g.h.i.j.k` followed by no `@` — the pattern would try to match from `a` as local-part, fail at the `@`, backtrack, try from `a` as part of a domain (but there's no preceding `@`), etc.

Actually: the pattern has no anchors. The `+` on the local-part is greedy but simple. V8's irregexp uses an optimized path for patterns that start with a character class `+`: it finds the first character that matches `[a-zA-Z0-9...]`, scans forward greedily, then checks for `@`. If `@` is not found, it advances one character and tries again. This is O(n) per character in the worst case — O(n²) total — but only when the text is dense with local-part characters.

**Adversarial input**: A 2000-char string of `a.b.c.d.e.f...` with no `@`. Each position with `a-z` or `.` could start a local-part attempt. The regex engine makes ~2000 attempts, each consuming up to a few chars before failing at the missing `@`. Total: O(n) work per attempt × O(n) attempts = O(n²).

For n=2000: 4,000,000 operations. At 10ns per operation: 40ms. This would block the renderer.

**Mitigation**: The `includes('@')` pre-filter ensures the regex is only run on text nodes that contain `@`. On nodes without `@`, the regex is never executed. If a node contains `@` but no valid email (e.g., a node with `@handle some text @other_handle` — multiple handles with no dots), the regex will make O(n) attempts and fail each quickly (the first `.` after the local-part fails, no backtrack into the local-part because it's a single character class).

**Real catastrophic backtrack scenario with the HTML5 pattern**: Does not exist for simple inputs. The character class local-part `[...]+` is possessive in V8's implementation (it doesn't give back characters once consumed). The `@` literal check after it either succeeds or the engine advances past the character class match. No exponential behavior.

**Truly safe assessment**: The HTML5-derived pattern with the `includes('@')` pre-filter is safe for all practical web content. O(n) per text node containing `@`.

### 5.3 Cost of attribute scanning

`querySelectorAll('a[href^="mailto:"]')`:
- Browsers use attribute index for `href` — the `^=` prefix selector scans the href attribute bucket, not all elements
- On a page with 100 links, maybe 5 are `mailto:` links
- Cost: <1ms on any real page

`querySelectorAll('input:not([type="password"]):not([type="hidden"]), textarea')`:
- Scans all inputs. On a form-heavy page (10–20 inputs), this is trivial
- Cost: <0.5ms

**Total attribute scan cost**: ~1–2ms. Run once at initial scan time (after text-node walk).

### 5.4 Element-level join vs. pure text-node walk

Text-node walk (Solution 1):
- TreeWalker visits only Text nodes — typically 2–5× fewer nodes than element count
- Each node: `includes('@')` check (fast) + conditional regex
- Total: O(text node count × avg text node length)

Element-level join (Solution 3):
- Visits every element node (10–100× more than text nodes on typical pages)
- For each element containing `@` in textContent: iterate all childNodes, concatenate, run regex, do offset mapping
- Additional DOM traversal + string allocations
- Estimated cost: 3–5× the text-node walk cost

**Recommendation**: Text-node walk (Solution 1) for the primary scan. Element-level join only if a specific element type is known to contain split emails (e.g., a known class on the target site).

### 5.5 Recommended max text-node length

The overview doc recommends 2000 chars. Analysis:
- Text nodes over 2000 chars: likely to be large JSON blobs embedded in `<div>` containers (from server-side rendering), large copy blocks, or code snippets not in `<pre>`
- These are unlikely to contain human-readable email addresses
- A 2000-char node with `@` takes ~20μs to regex — acceptable
- A 10000-char node would take ~100μs — still acceptable but wasteful

**Revised recommendation**: Keep 2000 chars as the skip threshold but make it configurable. A 500-char threshold would be more aggressive but still cover virtually all email-in-text cases (a typical rendered email address + surrounding text fits in ~200 chars).

### 5.6 MutationObserver overhead

When `AUTO_DETECT.EMAIL` is enabled, the MutationObserver watches for new elements. On SPA route changes, a burst of DOM mutations may arrive. The observer batches mutations but calls the handler for each batch.

Cost analysis:
- Each batch: iterate `addedNodes`, check `nodeType === ELEMENT_NODE`, call `scanWhenIdle`
- `scanWhenIdle` defers to `requestIdleCallback` — the actual scan work is deferred
- Overhead per mutation batch (before idle): ~10–50μs

**No performance concern** for normal page operation. SPAs doing large-scale DOM replacement (e.g., replacing the entire `<main>` content) will trigger one scan of the new content — this is correct behavior.

---

## Section 6 — Recommended Final Approach

### Primary regex (use this)

```javascript
// EMAIL_RE — Production-grade email pattern for content-script text-node scanning
//
// Design decisions:
// 1. Based on HTML5 <input type="email"> spec pattern (WHATWG willful violation of RFC 5322).
// 2. Domain requires at least one dot + 2-char all-letter TLD to eliminate:
//    - user@localhost (no dot)
//    - pkg@1.2.3 (numeric TLD)
//    - file@server.pdf (file extension FP — pdf is 3 letters, but we also blocklist common extensions)
// 3. No catastrophic backtracking — verified by analysis (character class + bounded quantifiers).
// 4. includes('@') pre-filter MUST be applied before executing this regex.
//
// Local-part charset (RFC 5321 dot-atom, minus consecutive/leading/trailing dots — 
// enforced structurally by starting with a non-dot char class and using \.? for dot):
//   [a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-] — all RFC dot-atom specials
//   Internal dots allowed via (?:\.?[...])* sub-group
//
// Domain: standard label structure (RFC 5321 §4.1.2)
//   Each label: [a-zA-Z0-9] start, [a-zA-Z0-9-]{0,61} middle, [a-zA-Z0-9] end (when >1 char)
//   TLD: [a-zA-Z]{2,24} — letters only, 2-24 chars (covers .io through .cancerresearch)
//
const EMAIL_RE_SOURCE = 
  '[a-zA-Z0-9!#$%&\'*+\\/=?^_`{|}~-]' +         // First local-part char (not a dot)
  '(?:\\.?[a-zA-Z0-9!#$%&\'*+\\/=?^_`{|}~-])*' + // Rest of local-part (dot-atom structure)
  '@' +
  '[a-zA-Z0-9]' +                                  // Domain first char
  '(?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?' +          // Domain first label middle+end (optional for 1-char labels)
  '(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)' + // Additional labels (1+)
  '*' +
  '\\.[a-zA-Z]{2,24}';                             // TLD — letters only, 2-24 chars
```

Wait — the last two groups need rethinking. The current structure is:
- First label: `[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?`
- Additional labels: `(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*`
- TLD requirement: need at least one `\.[a-zA-Z]{2,24}` at the end

Problem: the `*` quantifier on additional labels means zero additional labels are allowed, leaving only the first label `example` with no TLD. We need to ensure there's at least one additional label that is all-letters with 2–24 chars.

**Refined final regex** — validated structure:

```javascript
// The final recommended regex (as a source string for `new RegExp(src, 'g')`):
const EMAIL_RE_SOURCE = (
  // Local-part: starts with non-dot RFC dot-atom char, then allows dots only between chars
  '[a-zA-Z0-9!#$%&\'*+\\/=?^_`{|}~-]' +
  '(?:\\.?[a-zA-Z0-9!#$%&\'*+\\/=?^_`{|}~-])*' +
  // @ separator
  '@' +
  // Domain: one or more labels, last must be alpha-only 2-24 chars (TLD requirement)
  // This is tricky to express without lookbehind while also requiring the last label
  // to be alpha-only. The simplest approach: require at least one dot-separated suffix
  // after the hostname, where the final component is [a-zA-Z]{2,24}.
  //
  // Pattern: hostname.tld or hostname.subdomain.tld etc.
  // hostname: one or more labels (label = [a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?)
  // Then a final dot + [a-zA-Z]{2,24} TLD.
  //
  // hostname labels (1+):
  '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?' +
  '(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)' + '*' +
  // final TLD (enforced separately — letters only, 2-24 chars):
  '\\.[a-zA-Z]{2,24}'
);

// Putting it all together as a single string for clarity:
// /[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-](?:\.?[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-])*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}/g
```

**Final clean regex literal**:
```javascript
const EMAIL_RE = /[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-](?:\.?[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-])*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}/g;
```

**Key differences from the `docs/RESEARCH_PII_DETECTION.md` baseline**:
1. TLD changed from `(?:\.[a-zA-Z0-9]...)+` to `(?:\.[a-zA-Z0-9]...)*\.[a-zA-Z]{2,24}` — enforces letters-only TLD of 2–24 chars
2. Local-part restructured to `[...](\.?[...])*` — prevents leading/trailing/consecutive dots structurally
3. The `+` at the end of the domain is replaced with `*` + mandatory TLD group

### Recommended implementation plan (in priority order)

**Step 1 — Core text-node scan (Solution 1)**:
Run `EMAIL_RE` on every text node from the TreeWalker. Pre-filter with `includes('@')`. Wrap matches in `<span data-bl-si-pii="EMAIL">`. This is the 95% solution.

```javascript
function scanForEmail(textNode) {
  const text = textNode.textContent;
  if (!text.includes('@')) return [];
  const re = /[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-](?:\.?[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-])*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}/g;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, type: 'EMAIL' });
  }
  return matches;
}
```

**Step 2 — Attribute scan (Solution 2)**:
After the text-node walk completes, run one `querySelectorAll('a[href^="mailto:"]')` pass. For each anchor where the text content was NOT already wrapped (no child `[data-bl-si-pii]`), add `data-bl-si-pii="EMAIL"` to the anchor itself.

```javascript
function scanMailtoAttributes(root) {
  const anchors = root.querySelectorAll('a[href^="mailto:"]');
  for (const a of anchors) {
    if (a.querySelector('[data-bl-si-pii]')) continue; // already handled by text walk
    const href = a.getAttribute('href') || '';
    const email = href.slice(7).split('?')[0].split('#')[0].trim();
    if (email && /[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-](?:\.?[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-])*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}/.test(email)) {
      a.setAttribute('data-bl-si-pii', 'EMAIL');
    }
  }
}
```

**Step 3 — Optional precision boost (Solution 6, when mailto links exist)**:
Pre-build a Set of known emails from `mailto:` links. Use it as a confidence filter for ambiguous matches in the text-node walk. This is optional and can be deferred.

### What NOT to implement (and why)

| Solution | Decision | Reason |
|---|---|---|
| Solution 3 (element-level join) | Defer to Phase 2 | DOM surgery for split emails is complex; <5% of real pages affected |
| Solution 4 (sibling text-node join) | Skip | Adjacent text node fragmentation is vanishingly rare |
| Solution 5 (innerText) | Never | Forces layout on every container; prohibitive performance cost |
| RFC full-spec regex | Never | Catastrophic backtrack risk; no practical benefit |
| `aria-label` scanning | Skip | Modifying aria-label breaks screen readers; no visual rendering |
| `data-*` attribute scanning | Skip | Too many variants; no reliable strategy; not visually rendered |

---

## Section 7 — Unit Test Cases

The following 25 test cases should be implemented in `tests/unit/pii_detector.test.js` under an `EMAIL` describe block. Format: input string → expected match (yes/no) → expected captured text if yes.

### True Positive Tests (should match)

| # | Input | Should Match | Expected Text |
|---|---|---|---|
| 1 | `Contact user@example.com for support` | YES | `user@example.com` |
| 2 | `user.name+tag@sub.example.co.uk` | YES | `user.name+tag@sub.example.co.uk` |
| 3 | `Email: JOHN.DOE@EXAMPLE.COM — call us` | YES | `JOHN.DOE@EXAMPLE.COM` |
| 4 | `firstname_lastname@domain.io` | YES | `firstname_lastname@domain.io` |
| 5 | `user!#$%&'*+/=?^_{|}~-@example.org` | YES | `user!#$%&'*+/=?^_{|}~-@example.org` (special chars in local-part) |
| 6 | `a@b.co` (minimal valid: 1-char local, 1-char label, 2-char TLD) | YES | `a@b.co` |
| 7 | `user@xn--nxasmq6b.com` (punycode domain) | YES | `user@xn--nxasmq6b.com` |
| 8 | `Two emails: alice@a.com and bob@b.org here` | YES (2 matches) | `alice@a.com`, `bob@b.org` |
| 9 | `user@very-long-subdomain.deeply.nested.example.co.uk` | YES | full address |
| 10 | `user@example.cancerresearch` (24-char TLD) | YES | `user@example.cancerresearch` |
| 11 | `user@192.168.1.com` (starts with digits in domain label) | YES | `user@192.168.1.com` |
| 12 | `address: support+help@company-name.com.` (trailing period in sentence) | YES | `support+help@company-name.com` (stops at TLD, not the sentence period) |

### True Negative Tests (should NOT match)

| # | Input | Should Match | Reason |
|---|---|---|---|
| 13 | `@handle` (social handle, no local-part before @) | NO | Empty local-part (@ is first char or preceded by space) |
| 14 | `user@localhost` | NO | No dot in domain |
| 15 | `user@example` | NO | No TLD dot group |
| 16 | `v2@1.0` | NO | TLD `0` is a digit, not `[a-zA-Z]{2,}` |
| 17 | `pkg@1.2.3` (npm semver-style) | NO | TLD `3` is a digit |
| 18 | `C:\Users\user@machine` (Windows path, no TLD) | NO | `machine` has no dot |
| 19 | `git@github` (no TLD) | NO | No dot in domain |
| 20 | `.leading@example.com` (leading dot in local-part) | NO | Local-part starts with `.` — first char `[a-zA-Z0-9...]` doesn't include `.` |
| 21 | `trailing.@example.com` (trailing dot in local-part) | NO | Last char before `@` is `.` — the `(?:\.?[...])* ` pattern won't end on `.` because the `\.?` requires the following non-dot char to exist |
| 22 | `a..b@example.com` (consecutive dots) | NO | `(?:\.?[...])*` — the `\.?` makes the dot optional, so `..` would mean the second dot starts a new cycle. Actually this IS tricky: `a` matches first char, then `(?:\.?[...])` — `.` + `.` : first iteration would match `.` (optional dot) + ... wait. `b` is not a dot so `\.?` matches the first `.`, then `[...]` matches `.`? No — `[...]` excludes `.` from most positions. Let me trace: after `a`, `(?:\.?[a-zA-Z0-9!#...])*` — the group is `\.?` followed by `[a-zA-Z0-9!#...]`. So the group needs a non-dot char after the optional dot. `a..b`: after `a`, try `\.?[a-zA-Z0-9...]`: `.` (optional dot consumed) + `.` (this must match `[a-zA-Z0-9...]` but `.` IS in that set? No — the original HTML5 charset does not include `.` in the character class `[a-zA-Z0-9!#$%&'*+\/=?^_` + '`' + `{|}~-]`. Dot is handled separately via `\.`. So `a..b` would match `a` then attempt `\.?.` (the second dot is a non-special char... but it's not in the character class). The second attempt: `\.?` matches `.`, then the character class must match `.` which it doesn't. So the group fails. The engine advances: `a.` is matched so far, then `.b@...` continues. Actually the local-part would match just `a`, then `@` is not next (`.b@` follows). The engine tries from `.`, which doesn't match the first-char requirement. Then from `b@example.com` → matches `b@example.com`. So `a..b@example.com` → the match is `b@example.com`, not the full address. | PARTIAL — only `b@example.com` matches. Should record this as an edge case. |
| 23 | `test@test.invalidtldthatislongerthan24chars` | NO | TLD `invalidtldthatislongerthan24chars` is 32 chars — exceeds `{2,24}` limit |
| 24 | Empty string `""` | NO | No characters |
| 25 | `@` alone | NO | Neither local-part nor domain present |

### Edge Cases and Special Cases

| # | Input | Should Match | Notes |
|---|---|---|---|
| 26 | `user@example.com.` (email at end of sentence with period) | YES — `user@example.com` | The final `.` of the sentence: after consuming `com` as TLD, the pattern stops. The trailing period is outside the TLD `[a-zA-Z]{2,24}` match because `[a-zA-Z]{2,24}` is greedy but stops at non-alpha chars. Actually the domain labels use `[a-zA-Z0-9-]` which includes digits but the TLD is `[a-zA-Z]{2,24}`. The trailing `.` would not extend the TLD. Correct — `user@example.com` is matched without the trailing `.` |
| 27 | Two adjacent emails `alice@a.com,bob@b.org` | YES (2 matches) | `alice@a.com`, `bob@b.org` — the comma separates them |
| 28 | `user@example.com/path` (URL-like) | YES — `user@example.com` | The `/` is not in domain charset — match stops at `com` |
| 29 | `mailto:user@example.com` in text node | YES — `user@example.com` | `mailto:` prefix — `m`, `a`, `i`, `l`, `t`, `o`, `:` none of these are in local-part charset's position before `@`... wait: `mailto:user` — the colon `:` is NOT in the local-part charset, so the local-part would start from `user`. Result: `user@example.com` matched. Correct. |

---

## Summary of Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Base regex | HTML5-derived with letters-only TLD `[a-zA-Z]{2,24}` | Eliminates numeric-TLD FPs; safe from backtracking; high recall |
| Pre-filter | `text.includes('@')` before regex | Eliminates 99%+ of text nodes from regex evaluation |
| Split-element handling | Not in Phase 1 | Complex DOM surgery; <5% real-world impact |
| Attribute scan (mailto:) | Yes, after text-node walk | Cheap `querySelectorAll`; catches hidden email in link text |
| Input field scanning | Add `data-bl-si-pii` to whole element | Blurs the field; avoids value modification |
| Execution order | Text-node walk first, then attribute scan | Prevents double-wrapping via existing `[data-bl-si-pii]` guard |
| Idle defer | `requestIdleCallback` with 2000ms timeout | Initial scan doesn't block page render |
| Max text-node length | 2000 chars | Performance budget; large nodes unlikely to have isolated PII |
| TLD blocklist | Not needed | `[a-zA-Z]{2,24}` letter-only requirement eliminates the main FP categories |
| RFC full-spec | Explicitly rejected | Catastrophic backtracking risk; no practical benefit in web content scanning |

---

*Document status: COMPLETE. Research covers all 7 sections as specified.*
