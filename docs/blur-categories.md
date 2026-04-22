# Blur Categories

How the blur engine decides which HTML elements to blur during "blur all" mode.
Each category is independently togglable via `settings.blurCategories`.

---

## 1. Two-Pass Blur Model

`blurAllContent(radius, options)` runs two passes per enabled category:

**Always-blur** — element blurred unconditionally. Its purpose guarantees visible
content (e.g. `<p>`, `<img>`, `<h1>`, `<input>`).

**Text-check** — element blurred only when `hasMeaningfulTextContent()` finds a
direct text-node child with non-whitespace content. This prevents blurring empty
layout containers, icon-only buttons, and decorative spans.

Selector strings for both passes are pre-joined and cached inside
`blur_engine.js`. The cache is keyed by a 5-bit string derived from the category
toggles and rebuilds automatically on key miss via `getSelectors(cats)`.

---

## 2. Categories

### 2.1 `text` — Core Text Content

**Default: ON**

**Always-blur:**

| Element | Rationale |
|---|---|
| `h1` - `h6` | Headings always carry text |
| `hgroup` | HTML Living Standard heading group — wraps `h1`–`h6` with optional `p` subheadings |
| `p` | Paragraphs always carry text |
| `blockquote` | Block-level quotes |
| `pre` | Preformatted text, code blocks — may contain API keys, logs, credentials |
| `figcaption` | Image/figure captions — always descriptive text |
| `summary` | Disclosure toggle label — HTML spec requires visible content |

**Text-check:**

| Element | Why text-check |
|---|---|
| `span` | Heavily used for icons, badges, decorative elements |
| `a` | May be icon-only (logo links, social icons) |
| `label` | May use hidden-label patterns. In `text` (not `form`) so labels blur even when `form` is off. |
| `em`, `strong` | Semantic emphasis |
| `b`, `i` | Presentational bold/italic — common in legacy HTML and CMS output |
| `u` | Underline — annotations, CJK proper nouns |
| `cite` | Citations and references |
| `q` | Inline quotations |
| `mark` | Highlighted text — search results, annotations |
| `abbr` | Abbreviations |
| `time` | Dates, timestamps |
| `address` | Contact information — emails, phone numbers, physical addresses |
| `small` | Fine print, legal disclaimers |
| `code` | Inline code — API keys, tokens, configuration values |
| `kbd`, `samp`, `var` | Keyboard input, sample output, variable names |
| `dfn` | Inline definition terms |
| `data` | Machine-readable values with human-readable text |
| `del`, `ins` | Tracked changes — deleted/inserted text still renders visibly |
| `s` | Strikethrough — redacted prices, corrections |
| `sub`, `sup` | Subscript/superscript — formulas, footnote references |
| `bdo`, `bdi` | Bidirectional text overrides/isolates |
| `ruby` | CJK annotation container — gates empty template markup |
| `rt` | Ruby annotation text (reading / meaning) — privacy-relevant in CJK content |
| `rp` | Ruby fallback parens for unsupported browsers |

---

### 2.2 `media` — Images, Video, Audio, Canvas

**Default: ON**

**Always-blur:**

| Element | Blur mechanism |
|---|---|
| `img` | `[data-bl-si-blur]` attribute + CSS `filter: blur(var(--bl-si-radius))` |
| `video` | Same CSS attribute path. DRM video is covered — CSS filter works on DRM streams since it never touches pixel data. |
| `audio` | Blurs visible player chrome (title, time, controls) without affecting playback |
| `canvas` | CSS filter. Engine's own `bl-si-canvas-overlay` canvases are excluded by guard. |

**Excluded:**

| Element | Reason |
|---|---|
| `picture` | Inner `<img>` already blurred. Blurring `<picture>` double-blurs. |
| `svg` | Pervasive for icons. Blurring all SVGs makes sites unusable. Sensitive SVGs (diagrams with `<text>` elements) must be blurred manually via picker. |
| `iframe` | Cross-origin security model prevents CSS injection. |
| `embed`, `object` | CSS filter cannot reach plugin internals. |

---

### 2.3 `form` — Form Inputs and Controls

**Default: OFF**

Off by default because CSS blur on interactive elements degrades usability: the
field is visually blurred but remains focusable, typeable, and copy-pasteable.

**Always-blur:**

| Element | Notes |
|---|---|
| `input` | All visible types. See effectiveness table below. |
| `textarea` | Multi-line text fields |
| `select` | Closed state only. Dropdown options are NOT blurred when opened (see section 5). |
| `progress` | Progress bars — numeric state (e.g. download %, upload %) |
| `meter` | Scalar gauges — numeric state (e.g. disk usage, rating) |

**Text-check:**

| Element | Notes |
|---|---|
| `button` | Text-check avoids blurring icon-only buttons. In `form` (not `structure`) because buttons are interactive controls. |
| `output` | Dynamic calculated values |
| `fieldset` | Groups form controls — may have visible border/text |
| `legend` | Fieldset label text |

**ARIA role coverage:**

SPAs on GitHub, Figma, Notion, Linear, etc. render interactive surfaces as `<div role="button">`, `<span role="checkbox">`, `<div role="slider">` — semantically interactive but tag-name `div` / `span`. The `form` category matches these via CSS attribute selectors in addition to tag names, so enabling `form` blurs both native controls AND their role-based equivalents.

| Role | Equivalent native | Notes |
|---|---|---|
| `button` | `<button>` | The most common SPA pattern |
| `checkbox` | `<input type="checkbox">` | |
| `radio` | `<input type="radio">` | |
| `switch` | — | WAI-ARIA 1.1 toggle |
| `textbox` | `<input type="text">` / `<textarea>` | contenteditable widgets |
| `searchbox` | `<input type="search">` | |
| `combobox` | `<select>` / type-ahead pickers | |
| `listbox` | `<select multiple>` | |
| `spinbutton` | `<input type="number">` | |
| `slider` | `<input type="range">` | |
| `menuitem`, `menuitemcheckbox`, `menuitemradio` | — | Popup menu entries |
| `option` | `<option>` | Listbox/combobox items |
| `tab` | — | Tab list entries |

The role list is defined in `src/blur_engine.js` → `CATEGORY_SELECTORS.FORM.roles`. `buildSelectors` emits each role as a `[role="X"]` attribute selector into the always-blur CSS rule — match happens at the browser level with no per-element JS loop. `matchesActiveCategories` and `shouldBlurElement` also consult a cached `roleSet` so picker / context menu paths stay consistent with the CSS rule.

**Blur effectiveness by input type:**

| Input type | Effective? | Notes |
|---|---|---|
| `text`, `email`, `url`, `search`, `tel` | Yes at 16px font. Marginal at 20px+ (see section 5). | Primary use case |
| `number` | Yes — short values | |
| `password` | Redundant — already dot-masked | Harmless for visual consistency |
| `date`, `datetime-local`, `time`, `month`, `week` | Yes — blurs picker display | |
| `color` | Marginal — swatch visible through blur | Low sensitivity |
| `range` | No text — slider position hints at value | Low sensitivity |
| `checkbox`, `radio` | No text — checked state visible | Low sensitivity |
| `file` | Yes — blurs displayed filename | |
| `hidden` | Not rendered | No effect |

---

### 2.4 `table` — Table Structure

**Default: ON**

**Always-blur:**

| Element | Notes |
|---|---|
| `caption` | Table title — describes what the data is about |

**Text-check:**

| Element | Notes |
|---|---|
| `td` | Data cells |
| `th` | Header cells |

**Why cell-level, not table-level:** Blurring the `<table>` element itself hides
grid lines and headers, breaks `position: sticky`, prevents per-cell
reveal-on-hover, and makes selective unblur impossible. Cell-level blur preserves
structure and interactivity.

**Excluded:** `table`, `tr`, `thead`, `tbody`, `tfoot` (too coarse), `colgroup`,
`col` (styling-only).

---

### 2.5 `structure` — Sectioning & Container Elements

**Default: ON**

All use text-check to avoid blurring empty layout wrappers.

**Text-check:**

| Element | Notes |
|---|---|
| `div` | Most common container. Text-check prevents blurring layout wrappers. |
| `section` | Named page sections |
| `article` | Self-contained content blocks |
| `aside` | Sidebars, pull quotes |
| `header` | Page or section headers (not `<head>`) |
| `footer` | Page or section footers |
| `figure` | Graphics containers — may have direct text alongside media |
| `details` | Disclosure widget containers |
| `dialog` | Native HTML modals/dialogs |
| `li` | List item — structural container for phrasing content. Previously in `text`; relocated here (2026-04) because `<li>` groups content rather than being phrasing itself, matching the semantics of `<div>`. Automatically joins `_structuralTags` so thorough mode never bypasses the text gate for it — prevents nested blur leaks on hover reveal. |
| `dt`, `dd` | Definition list terms and descriptions — same rationale as `<li>`: structural containers, not phrasing. |

**Excluded:**

| Element | Reason |
|---|---|
| `nav` | Blurring breaks page navigation. `<a>` elements inside nav are blurred individually via `text` category. |
| `main` | Layout wrapper — children handled by their own categories. Blurring applies a single filter over the entire content area. |
| `form` | Container element. Children handled by `form` and `text` categories. |
| `search` | Semantic container for search UI — children handled individually. |
| `menu` | Similar to `<ul>` — `<li>` children handled by `text` category. |

---

## 3. Text Content Detection

`hasMeaningfulTextContent(element)` iterates the element's direct `childNodes`
looking for `TEXT_NODE` entries with non-whitespace content. It does not recurse.

This function gates all text-check elements. It returns false on containers
where all text lives inside child elements (e.g. `<div><span>text</span></div>`).
This is intentional — it pushes blur to the leaf level, avoiding redundant
container-level blur that would stack with child-level blur and break granular
reveal-on-hover.

Coverage gaps from containers with only element children are resolved by the
expanded selector lists in the `text` category — even when a parent `<div>` is
skipped, its `<span>`, `<a>`, `<strong>` children are individually queried and
blurred.

---

## 4. Global Exclusions

Elements excluded from all categories.

**Not rendered / metadata:**
`html`, `body`, `head`, `title`, `script`, `style`, `noscript`, `template`,
`slot`, `link`, `meta`, `base`

**Void / decorative:** `br`, `hr`, `wbr`

**Covered by child-level blurring:**
`nav`, `main`, `form`, `search`, `menu`, `picture`, `dl`, `ol`, `ul`,
`table`, `tr`, `thead`, `tbody`, `tfoot`, `colgroup`, `col`

**Cannot be effectively blurred:**
`iframe` (cross-origin), `svg` (breaks icons), `embed`, `object` (plugin internals)

**Media element children:** `source`, `track` — not rendered independently

**Minimal visual surface:** `datalist`, `map`, `area`

**Form internals:** `option`, `optgroup` — inside `<select>`, blurred in closed
state only.

---

## 5. Known Limitations

| Limitation | Cause | Severity |
|---|---|---|
| `<select>` dropdown options visible when opened | Browser renders dropdown outside CSS filter context | High |
| SVG `<text>` elements in diagrams | SVGs excluded globally to preserve icons | Medium |
| Cross-origin `<iframe>` content | Browser security model | Medium |
| CSS-generated content (`::before`/`::after`) | Pseudo-elements exist only in render tree, not DOM | Low |
| `filter: blur(8px)` partially readable at 20px+ font | Blur radius insufficient for large text | Low |
| Form field values accessible via DevTools/JS | CSS blur is visual only | Low |
| Blurred `<input>` still focusable and typeable | CSS filter has no interaction side effects | Low |
| Web Components with closed shadow DOM | Cannot pierce closed shadow roots | Low |
| Custom elements with light-DOM text content (e.g. GitHub `<relative-time>`, `<gh-emoji>`, `<time-until>`, `<include-fragment>`) | `textCheckSelector` is built from an explicit tag-name allowlist sourced from MDN/WHATWG; custom elements registered via `customElements.define()` aren't in any spec inventory and so were never added. A generic fallback scan (any `tagName.includes('-')` element with meaningful direct text content) is tracked under roadmap §7.6 but deferred until user reports surface. | Medium |
| `position: sticky` stops sticking inside blurred containers | CSS `filter` creates new containing block — browser spec behaviour | Medium |

---

## 6. Element Count

| Category | Default | Always-blur | Text-check | ARIA roles | Total elements |
|---|---|---|---|---|---|
| text | ON | 12 | 31 | — | 43 |
| media | ON | 4 | 0 | — | 4 |
| form | OFF | 5 | 4 | 15 | 9 elements + 15 roles |
| table | ON | 1 | 2 | — | 3 |
| structure | ON | 0 | 12 | — | 12 |
| **Total** | | **22** | **49** | **15** | **71 elements + 15 roles** |

Changes from the 2026-04 audit (plan `snappy-twirling-tiger`):
- **+7 elements:** `hgroup` → text/always, `ruby`/`rt`/`rp` → text/textCheck, `audio` → media/always, `progress`/`meter` → form/always
- **Relocated:** `li`/`dt`/`dd` from text/textCheck to structure/textCheck
- **+15 ARIA roles** on form category (button, checkbox, radio, switch, textbox, searchbox, combobox, listbox, spinbutton, slider, menuitem, menuitemcheckbox, menuitemradio, option, tab)

---

## 7. Alternatives considered / Roadmap

These designs were evaluated during the 2026-04 audit and deliberately deferred. Recorded here so future contributors can evaluate them against evolving needs without re-running the audit.

### 7.1 Flatten `CATEGORY_SELECTORS` to per-element gate metadata

**Proposed shape:**
```js
TEXT: [
  { tag: "h1",   gate: "always" },
  { tag: "span", gate: "text" },
  { tag: "li",   gate: "text-structural" },   // never thorough-bypass
]
```

**Why considered:** the current `{alwaysBlur, textCheck}` split conflates three concepts — (a) always blur-worthy? (b) needs text-presence gate? (c) is a structural container exempt from thorough bypass? The flat shape makes each explicit per element and removes the separately-derived `_structuralTags` Set.

**Why deferred:** the current split is clean (zero duplicates, zero cross-category mismatches verified by audit). Flattening would rewrite `buildSelectors`, `blurTextCheckElements`, `tryBlurTextCheck`, and every test that references category shape — significant surface for no user-visible improvement.

**Revisit trigger:** a fourth gate mode is needed (e.g. `role-gated`, `aria-hidden-aware`, `input-type-specific`).

### 7.2 Standalone INTERACTIVE category

Adds a sixth user-visible toggle for `<dialog>` / `<details>` / `<summary>` / `<menu>` / `<output>` / `<progress>` / `<meter>`. Deferred because adds UI surface (translations, popup, settings validation) for marginal taxonomic clarity benefit — users currently get these blurred via the categories where they're already listed.

### 7.3 ARIA role coverage for non-FORM categories

Extend `roles` entries to TEXT (`heading`, `note`), TABLE (`grid`, `row`, `cell`, `gridcell`, `rowheader`, `columnheader`), STRUCTURE (`region`, `article`, `navigation`, `contentinfo`, `banner`, `main`, `complementary`), MEDIA (ARIA `role="img"` used for SVG art). Deferred to follow-up because FORM is the highest-impact category for SPA coverage; the data shape established in this pass supports mechanical extension later.

### 7.4 Shadow DOM penetration

`blurTextCheckElements` descends into `element.shadowRoot` when present; the MutationObserver registers child observers for each shadow root. Deferred — closed shadow roots are unreachable by design, and the perf cost on shadow-heavy sites (YouTube, Slack Web) needs measurement before commit. Current workaround: blur the shadow host directly via picker, which blurs the entire subtree transitively.

### 7.5 `_isExtensionUI` exclusion as CSS `:not()` selector

Move the runtime `_isExtensionUI(el)` check (up to 6 `closest()` calls per element) into the CSS rule at `injectBlurRules` using `:not(#bl-si-picker-toolbar):not(.bl-si-toast *)` etc. The EXCLUDE pseudo-class is already applied to the always-blur selector — extending it to data-attribute paths is straightforward but needs profiling first (CSS specificity costs may offset JS savings on small pages).

### 7.6 Generic custom-element text coverage

Surfaced post-audit when noticing GitHub's `<relative-time>` ships timestamps that the current engine doesn't blur. The MDN/WHATWG-based audit had no way to enumerate site-registered custom elements (`customElements.define('relative-time', ...)`), so none were added to `TEXT.textCheck`.

Two implementations to consider when the gap becomes user-visible:

- **Site-specific:** add known custom element tags (`relative-time`, `time-until`, `gh-emoji`, `include-fragment`, etc.) directly to `TEXT.textCheck`. Quick, brittle — every new site needs its own additions.
- **Generic fallback scan:** during `blurTextCheckElements`, pick up every element whose `tagName.includes('-')` (the spec requirement for custom element names) that has meaningful direct text content. The text gate filters out wrapper-only custom elements like `<auto-complete>`. Cost: one extra `document.querySelectorAll('*')` filtered at the JS level, bounded to reconcile time rather than per-keystroke. Generalizes to Notion, Slack, Figma, and any SPA shipping custom elements.

**Why deferred:** waiting for a user report that confirms which surface is actually missed in practice. If the gap shows up on GitHub first, the site-specific path is a 5-minute fix; if it shows up across multiple sites, the generic scan pays off. Decision deferred to "someone raises it post-release."
