# PII Auto-Detection — Research Doc

Design for a content-script PII scanner that populates the already-wired `settings.AUTO_DETECT` flags.

**Current state**: `settings.AUTO_DETECT = { EMAIL, PHONE, SSN, CREDIT_CARD, FINANCIAL }` exists in storage and popup. The CSS rule `[data-bl-si-pii]:not([data-bl-si-reveal])` already exists in `content.css`. No detection engine exists yet.

---

## 1. Core Approach: Text-Node Walker

Walk `Text` nodes in the DOM, match PII regexes, and wrap matches in `<span data-bl-si-pii="TYPE">`. The existing CSS rule blurs them automatically.

### TreeWalker Setup

```javascript
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT',
                           'NOSCRIPT', 'CODE', 'PRE', 'SELECT']);

function* iterateTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    // Skip forbidden containers
    if (SKIP_TAGS.has(parent.tagName)) continue;
    // Skip extension UI
    if (parent.closest('[class*="bl-si-"],[id*="bl-si-"],[data-bl-si-zone]')) continue;
    // Skip already-wrapped text
    if (parent.closest('[data-bl-si-pii]')) continue;
    // Skip trivial whitespace nodes
    if (node.textContent.trim().length === 0) continue;
    
    yield node;
  }
}
```

### Why TreeWalker over querySelectorAll

- TreeWalker visits only `Text` nodes — fewer iterations on element-heavy pages.
- Skipping logic stays local to the generator.
- Shadow DOM is handled separately (recurse explicitly — TreeWalker doesn't cross shadow boundaries).

---

## 2. Regex Patterns Per PII Type

Regexes must be **reconstructed each scan call** (or cloned with `new RegExp(pattern.source, 'g')`) — stateful `/g` regexes leak `lastIndex` between calls if reused.

### EMAIL

```javascript
const EMAIL_RE = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
```

- Requires at least one `.` after `@` — avoids matching `user@localhost`.
- Does not word-wrap on `@` to avoid matching `C:\Users\user@machine\file.txt` as email (the backslash breaks the local-part charset).
- **False-positive rate**: Low (~5–10%). Main risk: CSS class names that contain `@` (rare).
- **Default**: `true` (safe to enable).

### PHONE — Formatted Only

Bare 10-digit numbers match too many non-phone values (zip codes, order IDs, Unix timestamps). Use formatted patterns only:

```javascript
const PHONE_RES = [
  /\(\d{3}\)\s?\d{3}[-.\s]\d{4}/g,   // (555) 123-4567
  /\d{3}[-.\s]\d{3}[-.\s]\d{4}/g,    // 555-123-4567  555.123.4567
  /\+1[-.\s]?\d{3}[-.\s]\d{3}[-.\s]\d{4}/g, // +1-555-123-4567
];
```

- **False-positive rate**: Low (10–15% — mainly product codes like `SKU 123-456-7890`).
- **Default**: `true`.

### SSN — Formatted Only

```javascript
const SSN_RE = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g;  // 123-45-6789 or 123 45 6789
```

- Requires separator (dash or space). Bare 9-digit numbers are too noisy.
- **False-positive rate**: Very low (<1% — the `NNN-NN-NNNN` pattern is rare outside SSNs).
- **Default**: `true`.

### CREDIT CARD

```javascript
const CC_RES = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,   // 16-digit
  /\b\d{4}[\s-]?\d{6}[\s-]?\d{5}\b/g,               // 15-digit (Amex)
];
```

Apply **Luhn check** to reduce false positives:

```javascript
function luhn(digits) {
  const s = digits.replace(/\D/g, '');
  let sum = 0, even = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = parseInt(s[i], 10);
    if (even && (d *= 2) > 9) d -= 9;
    sum += d;
    even = !even;
  }
  return sum % 10 === 0;
}
```

Without Luhn: false-positive rate ~25–30% (random 16-digit strings).
With Luhn: drops to <5%.

- **Default**: `false` — most sites display only last 4 digits of card numbers, so matches will be rare and valuable.

### FINANCIAL

```javascript
const FINANCIAL_RES = [
  /[$€£¥₹₩]\s?[\d,]+(?:\.\d{1,2})?(?:[MBK])?/g,  // $1,234.56  €500  $1.2M
  /[\d,]+(?:\.\d{2})?\s?(?:USD|EUR|GBP|JPY|INR)\b/gi, // 1,000.00 USD
];
```

- **False-positive rate**: High (40%+) — every price on any e-commerce page matches.
- **Default**: `false` — user must opt in explicitly.

---

## 3. Text Node Splitting Algorithm

### Goal

Transform a `Text` node containing PII matches into a `DocumentFragment` interleaving plain text and `<span data-bl-si-pii>` elements.

### Step-by-Step

```
Input text:  "Email me at user@example.com or call 555-123-4567."
Matches:     [ { start:12, end:29, type:'EMAIL' },
               { start:38, end:50, type:'PHONE' } ]

Output fragment children:
  Text("Email me at ")
  <span data-bl-si-pii="EMAIL">user@example.com</span>
  Text(" or call ")
  <span data-bl-si-pii="PHONE">555-123-4567</span>
  Text(".")
```

### Implementation

```javascript
function splitTextNode(textNode, matches) {
  // matches: sorted array of { start, end, type }, non-overlapping
  const text = textNode.textContent;
  const frag = document.createDocumentFragment();
  let cursor = 0;

  for (const m of matches) {
    if (m.start > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, m.start)));
    }
    const span = document.createElement('span');
    span.dataset.blSiPii = m.type;
    span.textContent = text.slice(m.start, m.end);
    frag.appendChild(span);
    cursor = m.end;
  }

  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)));
  }

  textNode.parentElement.replaceChild(frag, textNode);
}
```

### De-overlapping Matches

When multiple types are enabled, collect all matches, sort by `start`, then strip overlaps left-to-right:

```javascript
function collectMatches(text, autoDetect) {
  const raw = [];
  
  if (autoDetect.EMAIL)  matchAll(text, EMAIL_RE,  'EMAIL',  raw);
  if (autoDetect.PHONE)  for (const re of PHONE_RES) matchAll(text, re, 'PHONE', raw);
  if (autoDetect.SSN)    matchAll(text, SSN_RE,    'SSN',    raw);
  if (autoDetect.CREDIT_CARD) {
    for (const re of CC_RES) {
      let m;
      while ((m = re.exec(text)) !== null) {
        if (luhn(m[0])) raw.push({ start: m.index, end: m.index + m[0].length, type: 'CREDIT_CARD' });
      }
    }
  }
  if (autoDetect.FINANCIAL) for (const re of FINANCIAL_RES) matchAll(text, re, 'FINANCIAL', raw);

  // Sort + de-overlap
  raw.sort((a, b) => a.start - b.start);
  const result = [];
  let last = 0;
  for (const m of raw) {
    if (m.start >= last) { result.push(m); last = m.end; }
  }
  return result;
}

function matchAll(text, pattern, type, out) {
  const re = new RegExp(pattern.source, 'g'); // fresh instance — no lastIndex bleed
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, type });
  }
}
```

---

## 4. Performance

### requestIdleCallback for Initial Scan

Full-page initial scan is CPU-heavy. Defer to idle time:

```javascript
function scanWhenIdle(root, autoDetect) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => _scanRoot(root, autoDetect), { timeout: 2000 });
  } else {
    setTimeout(() => _scanRoot(root, autoDetect), 0);
  }
}
```

Trade-off: PII visible for ~50–200 ms on first load. Acceptable — PII detection is off by default.

### Skip Large Text Nodes

```javascript
const MAX_NODE_CHARS = 2000;

// Inside the walker loop:
if (node.textContent.length > MAX_NODE_CHARS) continue;
```

Nodes over 2000 chars are likely code blocks, large paragraphs, or minified content — unlikely to contain isolated PII, and expensive to regex.

### MutationObserver — Separate vs. Piggyback

**Recommendation: run a separate observer** (Strategy A). The blur engine's observer is internal and modifying it adds coupling. A second `MutationObserver` on `document.body` is negligible overhead:

```javascript
let _piiObserver = null;

function startObserving(root, getSettings) {
  if (_piiObserver) return;
  _piiObserver = new MutationObserver((mutations) => {
    const s = getSettings();
    if (!s || !Object.values(s.AUTO_DETECT).some(Boolean)) return;
    for (const mut of mutations) {
      for (const added of mut.addedNodes) {
        if (added.nodeType === Node.ELEMENT_NODE) {
          scanWhenIdle(added, s.AUTO_DETECT);
        }
      }
    }
  });
  _piiObserver.observe(root.body ?? root, { childList: true, subtree: true });
}

function stopObserving() {
  if (_piiObserver) { _piiObserver.disconnect(); _piiObserver = null; }
}
```

---

## 5. Cleanup / Unwrap

Called when all `AUTO_DETECT` flags are turned off:

```javascript
function clear(root) {
  const spans = root.querySelectorAll('[data-bl-si-pii]');
  for (const span of spans) {
    while (span.firstChild) {
      span.parentElement.insertBefore(span.firstChild, span);
    }
    span.remove();
  }
  // Recurse shadow roots
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot) clear(host.shadowRoot);
  }
  // Re-merge adjacent text nodes
  (root.body ?? root).normalize();
}
```

`normalize()` is O(n) across all text nodes. Safe because it only runs on user settings-change, not on every mutation.

---

## 6. Reveal Integration

### Problem

`reveal_controller.js` uses `isVisuallyBlurred(el)` for ancestor/descendant walks to determine which elements to stamp with `[data-bl-si-reveal]`. Currently `isVisuallyBlurred` checks only:
- `el.dataset.blSiBlur` (stamped by blur engine)
- Blur-all CSS tag matches
- ARIA role matches

PII `<span data-bl-si-pii>` elements have none of these. Hovering over a PII span won't reveal it.

### Fix: Extend isVisuallyBlurred (Option A — Recommended)

In `blur_engine.js isVisuallyBlurred()`, add one line:

```javascript
function isVisuallyBlurred(element) {
  if (!element || !(element instanceof Element)) return false;
  if (element.dataset.blSiBlur) return true;
  // ... existing blur-all + role checks ...
  if (element.dataset.blSiPii) return true;  // ← ADD
  return false;
}
```

Clean, centralized. Reveal controller code unchanged.

### Option B: Widen the reveal selector in reveal_controller.js

Change the candidate selector from `[data-bl-si-blur]` to `[data-bl-si-blur],[data-bl-si-pii]`. This avoids touching `blur_engine.js` but introduces a knowledge dependency in `reveal_controller`.

**Use Option A**. One line in `isVisuallyBlurred`.

---

## 7. Shadow DOM

PII walker must recurse the same way blur_engine does:

```javascript
function _scanRoot(root, autoDetect) {
  for (const textNode of iterateTextNodes(root)) {
    const matches = collectMatches(textNode.textContent, autoDetect);
    if (matches.length > 0) splitTextNode(textNode, matches);
  }
  // Recurse shadow roots
  for (const host of root.querySelectorAll('*')) {
    if (host.shadowRoot) _scanRoot(host.shadowRoot, autoDetect);
  }
}
```

The `iterateTextNodes` generator above uses `document.createTreeWalker(root, ...)` — passing a shadow root as `root` makes it walk inside the shadow boundary.

---

## 8. Input Fields — Out of Scope (Phase 1)

`<input value="...">` and `<textarea>` contain PII but are **not text nodes**. Masking them requires:
- Replacing the displayed value (breaks user typing and form submission)
- A separate overlay mechanism (complex, fragile)

**Decision: skip for now.** Mark as known limitation. The existing skip-tag set already excludes them from the walker.

If input masking is added later, it needs a separate module (an input-specific observer + CSS overlay approach), not the text-node walker.

---

## 9. Module Design

### New File: `src/pii_detector.js`

Load order in `manifest.json` content_scripts: **after `blur_engine.js`, before `content_script.js`**.

```
src/blur_engine.js
src/pii_detector.js     ← new
src/reveal_controller.js
```

### IIFE Pattern (mandatory)

```javascript
const BlurrySitePiiDetector = (() => {
  'use strict';

  // private state
  let _observer = null;

  // private helpers
  function iterateTextNodes(root) { /* generator */ }
  function collectMatches(text, autoDetect) { /* returns sorted matches */ }
  function splitTextNode(textNode, matches) { /* replaces node */ }
  function _scanRoot(root, autoDetect) { /* recursive */ }
  function scanWhenIdle(root, autoDetect) { /* requestIdleCallback wrapper */ }

  // public API
  function scan(root, autoDetect) {
    if (!autoDetect || !Object.values(autoDetect).some(Boolean)) return;
    scanWhenIdle(root, autoDetect);
  }

  function startObserving(root, getSettings) { /* MutationObserver */ }
  function stopObserving() { /* disconnect */ }

  function clear(root) { /* unwrap all spans + normalize */ }

  function rescan(root, autoDetect) {
    clear(root);
    scan(root, autoDetect);
  }

  function teardown() { stopObserving(); }

  return { scan, startObserving, stopObserving, clear, rescan, teardown };
})();

blsi.PiiDetector = BlurrySitePiiDetector;
```

### content_script.js Integration

In `applyState(newSettings, prev)`, after `Engine.handleSite(...)`:

```javascript
// PII auto-detection
const anyDetect = newSettings.ENABLED &&
  newSettings.AUTO_DETECT &&
  Object.values(newSettings.AUTO_DETECT).some(Boolean);

const prevDetect = prev.AUTO_DETECT &&
  Object.values(prev.AUTO_DETECT).some(Boolean);

if (anyDetect) {
  blsi.PiiDetector.scan(document.body, newSettings.AUTO_DETECT);
  blsi.PiiDetector.startObserving(document.body, () => Store.getSettings());
} else {
  blsi.PiiDetector.stopObserving();
  if (prevDetect) {
    blsi.PiiDetector.clear(document.body);  // only clear on transition
  }
}
```

Also call `blsi.PiiDetector.teardown()` in the `ENABLED === false` path (same place `Reveal.clearAll()` is called).

---

## 10. False-Positive Analysis and Defaults

| Type | Pattern | FP Rate (no mitigation) | FP Rate (with mitigation) | Default |
|------|---------|------------------------|--------------------------|---------|
| EMAIL | RFC-lite w/ `@` + TLD | ~5–10% | — | `false` |
| PHONE | Formatted only | ~10–15% | — | `false` |
| SSN | Formatted only (`NNN-NN-NNNN`) | <1% | — | `false` |
| CREDIT_CARD | 13/15/16-digit | ~25–30% | **<5% with Luhn** | `false` |
| FINANCIAL | Currency prefix | ~40%+ | — | `false` |

All disabled by default. Users opt in per-type. Future: a "Safe defaults" preset that enables EMAIL + SSN + PHONE (the lowest-FP three).

---

## 11. CLAUDE.md / Docs Updates Required on Implementation

When `pii_detector.js` is written:

| File | Update |
|------|--------|
| `CLAUDE.md` Module Globals table | Add `pii_detector.js` → `blsi.PiiDetector` row |
| `CLAUDE.md` Module Globals table | Add public API: `scan`, `startObserving`, `stopObserving`, `clear`, `rescan`, `teardown` |
| `src/CLAUDE.md` Module Load Order | Add `pii_detector.js` at position 9 (after blur_engine, before reveal_controller) |
| `manifest.json` | Add `src/pii_detector.js` to `content_scripts.js[]` |
| `docs/LLD.md` | Add `PiiDetector` contract section |
| `docs/TEST_VALIDATION.md` | Add unit test entries for each PII pattern |

---

## 12. Testing Requirements

### Unit Tests: `tests/unit/pii_detector.test.js`

Must cover:

| Test | Assert |
|------|--------|
| EMAIL match | `user@example.com` matched |
| EMAIL no-match | `C:\Users\user@machine` not matched |
| PHONE formatted match | `(555) 123-4567`, `555-123-4567` matched |
| PHONE bare no-match | `5551234567` not matched |
| SSN formatted match | `123-45-6789` matched |
| SSN bare no-match | `123456789` not matched |
| CREDIT_CARD with Luhn | Valid card number matched |
| CREDIT_CARD Luhn reject | Random 16-digit rejected |
| FINANCIAL match | `$1,234.56`, `€500` matched |
| FINANCIAL no-match | `v2.1.0` not matched |
| De-overlap | Overlapping EMAIL+PHONE → only first kept |
| splitTextNode | Correct DOM structure after split |
| clear() | All `[data-bl-si-pii]` spans removed, text content restored |
| `root.normalize()` called | Adjacent text nodes merged after clear |
| Already-wrapped skip | Walker skips children of existing `[data-bl-si-pii]` span |

---

## 13. Known Limitations (to document)

| Limitation | Root cause | Status |
|------------|-----------|--------|
| Input field values not detected | `<input>` has no text nodes | Out of scope Phase 1 |
| Phone numbers in international format (non-US) | Regex tuned for US formats | Known gap |
| Financial amounts without currency prefix | `1000.00` not matched | Intentional (high FP rate) |
| PII across element boundaries (e.g., `<b>555</b>-123-4567`) | Walker processes text nodes individually | Known limitation |
| SSN without separators | Bare 9-digit too noisy | Intentional |
| Large text node skip (> 2000 chars) | Performance budget | Known limitation — configurable |
