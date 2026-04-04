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
toggles and rebuilt only when `invalidateSelectorCache()` is called.

---

## 2. Categories

### 2.1 `text` — Core Text Content

**Default: ON**

**Always-blur:**

| Element | Rationale |
|---|---|
| `h1` - `h6` | Headings always carry text |
| `p` | Paragraphs always carry text |
| `blockquote` | Block-level quotes |
| `pre` | Preformatted text, code blocks — may contain API keys, logs, credentials |
| `figcaption` | Image/figure captions — always descriptive text |
| `summary` | Disclosure toggle label — HTML spec requires visible content |

**Text-check:**

| Element | Why text-check |
|---|---|
| `li` | May be empty or icon-only in navigation menus |
| `dt`, `dd` | Definition list terms/descriptions |
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

---

### 2.2 `media` — Images, Video, Canvas

**Default: ON**

**Always-blur:**

| Element | Blur mechanism |
|---|---|
| `img` | Direct `style.filter` on the element |
| `video` | Canvas overlay + `requestAnimationFrame` loop (bypasses DRM/cross-origin) |
| `canvas` | CSS class. Engine's own `pb-canvas-overlay` canvases are excluded by guard. |

**Excluded:**

| Element | Reason |
|---|---|
| `picture` | Inner `<img>` already blurred. Blurring `<picture>` double-blurs. |
| `svg` | Pervasive for icons. Blurring all SVGs makes sites unusable. Sensitive SVGs (diagrams with `<text>` elements) must be blurred manually via picker. |
| `audio` | Minimal visual surface — player controls only. |
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

**Text-check:**

| Element | Notes |
|---|---|
| `button` | Text-check avoids blurring icon-only buttons. In `form` (not `structure`) because buttons are interactive controls. |
| `output` | Dynamic calculated values |
| `fieldset` | Groups form controls — may have visible border/text |
| `legend` | Fieldset label text |

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
`nav`, `main`, `form`, `search`, `menu`, `hgroup`, `picture`, `dl`, `ol`, `ul`,
`table`, `tr`, `thead`, `tbody`, `tfoot`, `colgroup`, `col`

**Cannot be effectively blurred:**
`iframe` (cross-origin), `svg` (breaks icons), `embed`, `object` (plugin internals)

**Media element children:** `source`, `track` — not rendered independently

**Minimal visual surface:** `audio`, `datalist`, `meter`, `progress`, `map`, `area`

**CJK-specific:** `ruby`, `rt`, `rp` — common in Japanese/Chinese/Korean content.
Excluded to limit selector count. CJK users may encounter unblurred annotations.

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

---

## 6. Element Count

| Category | Default | Always-blur | Text-check | Total |
|---|---|---|---|---|
| text | ON | 11 | 31 | 42 |
| media | ON | 3 | 0 | 3 |
| form | OFF | 3 | 4 | 7 |
| table | ON | 1 | 2 | 3 |
| structure | ON | 0 | 9 | 9 |
| **Total** | | **18** | **46** | **64** |
