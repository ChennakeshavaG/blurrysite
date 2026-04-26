# selector_utils Contract

## Overview

Generates stable, unique CSS selectors for DOM elements so blur state can be persisted and restored across page loads. Returns selectors ordered structural→semantic — structural selectors are precise but fragile (break when DOM changes); semantic selectors are stable but coarser. Only selectors confirmed unique via `querySelectorAll().length === 1` are emitted.

## Selector Strategy Priority

| Index | Strategy | Example | Stability |
|---|---|---|---|
| 0 | Full body-rooted `nth-of-type` path | `body > div:nth-of-type(2) > p:nth-of-type(1)` | Fragile — breaks on DOM insertions |
| 1 | Nearest stable-ancestor-anchored path | `#parent-id > div:nth-of-type(2)` | More resilient |
| 2 | Class combo (`tag.c1.c2`) | `p.intro.main-text` | Stable if CSS classes are page-native |
| 3 | `[aria-label]` + tag | `button[aria-label="Submit"]` | Stable for designed ARIA |
| 4 | Stable `data-*` attributes | `[data-testid="submit-btn"]` | Stable for test/framework attrs |
| 5 | Unique `#id` | `#main-heading` | Most stable |

`STABLE_DATA_ATTRS` order: `data-testid`, `data-cy`, `data-id`, `data-name`, `data-key`, `data-component`, `name`.

## Public API

### getSelectors(element)

**What**: Returns an ordered array of unique CSS selectors for the element (structural→semantic).  
**Params**: `element` (Element)  
**Returns**: `string[]` — 0–6 selectors; empty array if none found  
**Side effects**: Multiple `querySelectorAll` calls for uniqueness verification  
**Handles**: `null`, non-Element, `document.body`, `document.documentElement` → returns `[]`. Deduplicates via `Set` — no duplicate selectors in output.

### getSelector(element)

**What**: Returns the first (most structural) unique selector, or `null`.  
**Params**: `element` (Element)  
**Returns**: `string|null` — `getSelectors(element)[0] ?? null`  
**Note**: Compat alias — prefer `getSelectors()` for new code to get the full ordered array for restore attempts.

### isSelectorStable(element)

**What**: Fast O(1) heuristic — does this element have any stable semantic signal?  
**Params**: `element` (Element)  
**Returns**: `boolean` — `true` if element has `id`, `aria-label`, non-`bl-si-` classes, or a recognized `data-*` attribute  
**Side effects**: none — no `querySelectorAll` calls  
**Used by**: `picker.js` hover handler to show "may not persist on reload" warning without a DOM scan.

### generateId()

**What**: Generates a short 8-character lowercase hex ID.  
**Params**: none  
**Returns**: `string` — 8-char hex (e.g. `'a3f2b91c'`)  
**Side effects**: Uses `crypto.getRandomValues` if available; falls back to `Math.random()`

### restoreSelector(selectorOrArray)

**What**: Finds the DOM element matching a stored selector (string or array).  
**Params**: `selectorOrArray` (string | string[]) — a single selector or ordered array  
**Returns**: `Element|null` — first element from the first uniquely-matching selector, or `null`  
**Handles**: Tries each selector in order; invalid/stale selectors (throws) are caught and skipped; non-unique matches (`.length !== 1`) are also skipped.

### restoreAllSelectors(selectors)

**What**: Batch version — maps an array of stored selectors back to elements.  
**Params**: `selectors` (Array<string | string[]>) — entries can be legacy `string` or new `string[]`  
**Returns**: `Element[]` — only elements found (null results filtered out)  
**Handles**: Non-array input → returns `[]`; unmatched entries silently skipped.

## Internal Functions

### buildNthChildPath(element)

**What**: Full body-rooted `nth-of-type` path (strategy 0). Walks up to body, building `:nth-of-type(n)` segments.  
**Returns**: `string|null`

### buildAnchoredPath(element)

**What**: Walks up to the nearest ancestor with a stable ID or `STABLE_DATA_ATTRS` entry, builds a shorter anchored path (strategy 1). Only emits if both the anchor and full path are unique.  
**Returns**: `string|null`

### buildClassSelector(element)

**What**: `tag.class1.class2` combo (strategy 2); filters out `bl-si-*` classes; tries with parent `#id` context if not unique.  
**Returns**: `string|null`

### buildAriaSelector(element)

**What**: `tag[aria-label="..."]` (strategy 3); skips labels longer than 80 characters.  
**Returns**: `string|null`

### buildDataAttrSelector(element)

**What**: Tries each `STABLE_DATA_ATTRS` in order; also tries tag-scoped variant (strategy 4).  
**Returns**: `string|null`

### buildIdSelector(element)

**What**: `#id` selector (strategy 5); only emits if unique.  
**Returns**: `string|null`

### cssEscape(value)

**What**: Escapes a CSS identifier using `CSS.escape()` if available; falls back to manual backslash escaping.

### isUnique(selector)

**What**: Returns `true` if `querySelectorAll(selector).length === 1`.  
**Handles**: Invalid CSS selectors (throws) → returns `false`.

## Invariants

- Only selectors with `querySelectorAll().length === 1` are included — never ambiguous.
- `getSelectors(body)`, `getSelectors(documentElement)`, `getSelectors(null)` always return `[]`.
- Output array is deduplicated — no two entries are the same string.
- `isSelectorStable` makes NO DOM queries — O(1) guaranteed.
- `restoreSelector` treats non-unique matches as no-match — never returns an ambiguous element.
- `bl-si-*` classes are always excluded from class selectors.
