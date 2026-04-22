# Performance Fixtures — Plan

## Overview

9 HTML fixture pages + 1 index manifest. Each page targets a specific measurable
performance dimension of the extension. All pages are self-contained (inline CSS,
data: URI images — no external deps, no CDN, no network).

---

## Fixture 1 — `page-text-heavy.html`

**Target feature:** TEXT + TABLE blur categories
**Key metric:** `blur_engine.stampElements()` duration, `tryBlurTextCheck()` cost, total elements stamped

### Element breakdown

| Element | Count | Blur behaviour |
|---|---|---|
| `<h1>` / `<h2>` / `<h3>` | 6 / 22 / 70 | Always blurred (no text gate) |
| `<p>` | 500 | Always blurred |
| `<blockquote>` | 20 | Always blurred |
| `<figcaption>` / `<address>` | 20 | Always blurred |
| `<span>` with meaningful text | 150 | Text-check gate |
| `<code>` / `<pre>` | 30 | Text-check gate |
| Financial table (20 rows × 10 cols) | 1 | `<td>` text-check gate |

### What this page simulates
A long-form content page (news article, report, dashboard summary). High heading
density drives always-blur path. Spans and inline code drive text-check path.
The financial table exercises TABLE category alongside TEXT in the same render pass.

### Open questions
- Scale `<p>` count up to 1000 if we want to find OOM or GC pauses?
- Include `<li>` / `<dt>` / `<dd>` from STRUCTURE category or keep this page TEXT+TABLE only?

---

## Fixture 2 — `page-pii-rich.html`

**Target feature:** `pii_detector.scan()`, TreeWalker throughput, false-positive suppression
**Key metric:** scan duration (ms), true match count, suppressed count accuracy

### Pattern breakdown

| Pattern type | Count | Expected outcome |
|---|---|---|
| Emails (`user@domain.tld`) | 400 | Detected |
| Phone-like groups (`111-222-3333`) | 100 | Detected |
| Currency prefix (`$1,234.56`, `€500`, `₹50,000`) | 100 | Detected |
| Comma-grouped numbers (`1,234,567`) | 80 | Detected |
| Version strings (`v1.2.3`, `2.14.0`) | 40 | **Suppressed** |
| Public prices (`$9.99/month`, `€29/year`) | 40 | **Suppressed** |
| Engagement counts (`1,234 followers`, `500 likes`) | 40 | **Suppressed** |

### What this page simulates
A data-dense CRM or admin page with lots of contact records. The suppression rows
validate that the detector's false-positive guards are working and measure their
regex overhead.

### Open questions
- Mix patterns inline in `<p>` text or isolate each pattern in its own `<span>`?
  Inline is more realistic; isolated makes it easier to count matches in tests.
- Include `email` and `numeric` on the same page or split into two pages?

---

## Fixture 3 — `page-comprehensive.html`

**Target feature:** All 5 blur categories simultaneously
**Key metric:** `handleDocument()` total duration, elements stamped per category

### Layout
Account dashboard with distinct sections per category.

| Category | Elements included |
|---|---|
| TEXT | h1–h3, p, blockquote, span, strong, em, code |
| MEDIA | img (data URI), video (poster only), canvas, inline svg |
| FORM | input (text/email/password/number), select, textarea, button |
| TABLE | data table with caption, thead, tbody, td, th |
| STRUCTURE | div, section, article, nav, aside |

### What this page simulates
A typical SaaS dashboard page that has everything at once. This is the worst-case
DOM for the extension — all categories on, no skipping.

### Open questions
- Should FORM be off by default in this fixture (matches the default settings where
  `blur_categories.form = false`) or enable everything for max stress?

---

## Fixture 4 — `page-reveal.html`

**Target feature:** Reveal controller (hover + click modes), ancestor/descendant cascade
**Key metric:** Latency from hover/click event → `data-bl-si-reveal` stamped (ms), 20 cycle average

### Element breakdown

| Structure | Count | Purpose |
|---|---|---|
| `<p class="reveal-target">` | 100 | Flat reveal targets, min-height: 60px |
| 3-level nested groups (`article > section > p`) | 20 | Tests ancestor + descendant cascade clearing |
| `<span>` inside blurred `<p>` | 50 | Tests inline-within-block reveal path |

### What this page simulates
A privacy-sensitive page where users hover to temporarily read individual items —
medical records viewer, confidential report, etc.

### Open questions
- Pre-blur elements via JS on load (call `blsi.BlurEngine.applyBlur()`) or rely on
  blur-all being active when the test runner sets storage?

---

## Fixture 5 — `page-picker.html`

**Target feature:** Picker activation, zone drawing (sticky-page + sticky-screen), zone overlay render
**Key metric:** Trigger → `bl-si-picker-active` on `<html>` (ms), zone draw gesture duration

### Layout
Dashboard with scrollable content (min 3000px tall):
- Sticky nav bar (top, fixed)
- 30% sidebar (left, fixed or sticky)
- Main content area (scrollable, varied elements)
- Right panel (fixed)

### What this tests
- Page-anchor zones: re-projection when viewport width changes (xPct/yPct math)
- Screen-anchor zones: correct fixed positioning during scroll
- Zone overlay alignment on a page with mixed positioning contexts

### Open questions
- Include elements with CSS `transform` on ancestors to stress the known zone
  misalignment limitation?

---

## Fixture 6 — `page-spa.html`

**Target feature:** MutationObserver reconcile, `handleSite()` re-run cost per route
**Key metric:** Reconcile duration per `history.pushState` navigation (ms), 5 routes

### Routes

| Route ID | Content | Element count |
|---|---|---|
| `text` | `<p>` paragraphs | 200 |
| `forms` | inputs + selects | 50 inputs, 20 selects |
| `table` | wide data table | 5 rows × 100 cols |
| `media` | data-URI images | 30 img |
| `mixed` | all categories | 40 each |

### API exposed on `window`
```js
window.navigateTo(routeId)  // replaces DOM + calls history.pushState + fires popstate
window.ROUTES               // array of route ids
```

### Open questions
- Expose `<a>` nav links for manual testing alongside `window.navigateTo()`?
- Should route swap be instant (innerHTML replace) or animated (fade) to test
  MutationObserver during partial DOM state?

---

## Fixture 7 — `page-forms.html`

**Target feature:** FORM category, ARIA role selector matching
**Key metric:** `stampElements()` count for native vs. ARIA-role elements

### Element breakdown

| Element | Count | Notes |
|---|---|---|
| `<input type="text/email/password/number">` | 24 | 6 each type |
| `<input type="checkbox/radio">` | 8 | in fieldset groups |
| `<select>` with 8 options | 11 | |
| `<textarea>` pre-filled | 4 | multi-line text |
| `<button>` (submit/reset/generic) | 16 | |
| `[role="button/checkbox/combobox/listbox"]` | 20 | SPA-style ARIA elements |
| `<fieldset>` + `<legend>` | 6 groups | |

### What this tests
The ARIA role CSS attribute selectors (`[role="button"]`, etc.) are the only selectors
that use attribute matching rather than tag matching. This measures whether the CSS
specificity + selector complexity adds observable overhead vs. tag selectors.

### Open questions
- None — this one is well-scoped.

---

## Fixture 8 — `page-media.html`

**Target feature:** MEDIA category, no-reflow confirmation, DRM-safe CSS blur
**Key metric:** `stampElements()` duration for media, CLS delta (should be 0 — blur adds no layout)

### Element breakdown

| Element | Count | Notes |
|---|---|---|
| `<img>` | 50 | data: URI, 50×50 colored squares |
| `<video>` | 10 | poster attribute only, no src |
| `<canvas>` | 5 | JS draws a rectangle on load |
| `<svg>` (inline) | 5 | path + circle shapes |
| `<audio>` | 3 | no src |
| `<picture>` | 5 | srcset variations (still data URI) |

### What this tests
CSS `filter: blur()` on media elements must not introduce layout shift. Video
elements with no src still render a placeholder box — blur applies via CSS class
same as any other media. Canvas `getContext()` draw happens before blur, blur
doesn't affect canvas pixel data.

### Open questions
- Make some images larger (200×200) to test that blur radius visually covers
  different-sized media?

---

## Fixture 9 — `page-shadow-dom.html` *(new, not in original set)*

**Target feature:** Shadow DOM traversal, per-root `injectRules()`, nested MutationObservers
**Key metric:** `injectRules()` call count, total shadow root traversal duration (ms)

### Structure breakdown

| Structure | Count | Notes |
|---|---|---|
| Custom elements with shadow roots (`<user-card>`, `<data-row>`) | 20 | Open shadow roots only |
| 3-level nested shadow chains | 5 | host → shadow → host → shadow → host → shadow |
| Dynamically inserted shadow hosts (JS on load) | 10 | Tests MutationObserver detecting new roots |
| Elements inside shadows that would blur in light DOM | ~150 | h2, p, img, input |

### What this tests
The extension injects CSS rules into every open shadow root it discovers. It also
sets up a MutationObserver on each root to detect further shadow hosts added
dynamically. This fixture measures whether that per-root overhead scales linearly
or has hidden quadratic cost.

### Open questions
- Include `<slot>` elements to test shadow projection blur paths?
- Is this fixture in scope for v1 of the perf suite, or defer to Phase 2?

---

## `index.json` — Page manifest

```json
{
  "serveBase": "https://perf.blurrysite.local",
  "pages": [
    {
      "id": "text-heavy",
      "file": "page-text-heavy.html",
      "description": "TEXT + TABLE category stress — 500p, 150 spans, financial table",
      "targeted_feature": "blur_engine.stampElements",
      "key_elements": { "p": 500, "h123": 98, "span": 150, "td": 200 }
    },
    {
      "id": "pii-rich",
      "file": "page-pii-rich.html",
      "description": "PII detector scan — 400 emails, 320 numeric, 120 suppressed",
      "targeted_feature": "pii_detector.scan",
      "key_elements": { "emails": 400, "numeric": 280, "suppressed": 120 }
    },
    {
      "id": "comprehensive",
      "file": "page-comprehensive.html",
      "description": "All 5 blur categories simultaneously — account dashboard",
      "targeted_feature": "blur_engine.handleDocument",
      "key_elements": { "categories": 5 }
    },
    {
      "id": "reveal",
      "file": "page-reveal.html",
      "description": "Reveal controller latency — 100 targets, nested cascade groups",
      "targeted_feature": "reveal_controller",
      "key_elements": { "reveal_targets": 100, "nested_groups": 20 }
    },
    {
      "id": "picker",
      "file": "page-picker.html",
      "description": "Picker activation + zone draw — dashboard layout, 3000px tall",
      "targeted_feature": "picker",
      "key_elements": { "scroll_height_px": 3000 }
    },
    {
      "id": "spa",
      "file": "page-spa.html",
      "description": "SPA navigation — 5 routes, MutationObserver reconcile per pushState",
      "targeted_feature": "blur_engine.observeRoot",
      "key_elements": { "routes": 5 }
    },
    {
      "id": "forms",
      "file": "page-forms.html",
      "description": "FORM category — 24 inputs, 11 selects, 20 ARIA-role elements",
      "targeted_feature": "blur_engine.stampElements (ARIA roles)",
      "key_elements": { "inputs": 24, "selects": 11, "aria_elements": 20 }
    },
    {
      "id": "media",
      "file": "page-media.html",
      "description": "MEDIA category — 50 img, 10 video, 5 canvas, 5 svg",
      "targeted_feature": "blur_engine.stampElements (media)",
      "key_elements": { "img": 50, "video": 10, "canvas": 5, "svg": 5 }
    },
    {
      "id": "shadow-dom",
      "file": "page-shadow-dom.html",
      "description": "Shadow DOM traversal — 20 custom elements, 5 nested chains, 10 dynamic inserts",
      "targeted_feature": "blur_engine.injectRules + observeRoot per shadow root",
      "key_elements": { "shadow_roots": 35, "dynamic_inserts": 10 }
    }
  ]
}
```

---

## Decisions needed before building

| # | Question | Options |
|---|---|---|
| 1 | Include `page-shadow-dom.html` (fixture 9)? | Yes — build now / Defer to Phase 2 |
| 2 | PII fixture: patterns inline in `<p>` text or isolated in `<span>`? | Inline (realistic) / Isolated (easier to count) |
| 3 | Comprehensive fixture: FORM category on or off by default? | On (max stress) / Off (matches default settings) |
| 4 | Reveal fixture: pre-blur via JS on load or rely on test runner storage? | JS on load (self-contained) / Storage (realistic) |
| 5 | SPA fixture: include `<a>` nav links for manual use? | Yes / No |
| 6 | Media fixture: all images 50×50 or mix of sizes? | All small / Mix (50×50, 200×200, 400×300) |
