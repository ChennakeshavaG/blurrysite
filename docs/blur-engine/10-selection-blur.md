# Blur Engine — Selection Blur

Selection blur is a parallel blur system that allows users to blur arbitrary text they select with the mouse or keyboard. It is implemented in `src/selection_blur.js` as a fully independent module — not orchestrated by `blur_engine.js`. This document covers its architecture, the text-node wrapping algorithm, and how it coexists with the other blur systems.

---

## Architecture: Independent from Blur Engine

`selection_blur.js` (`blsi.SelectionBlur`) does not call `blur_engine.js` for stamping or CSS injection. It:
1. Reads `document.getSelection()` when `blurSelection()` is called
2. Wraps selected text nodes in `<span>` elements carrying `data-bl-si-blur="1"`
3. Manages a `_selections` array tracking all active selection blurs

The `data-bl-si-blur` attribute is the same attribute that blur-all's stamp pass uses. This means selection blurs participate in the existing CSS rules — both the static `content.css` gaussian rule and the injected `#bl-si-blur-styles` (if blur-all is ON) apply to selection blurs automatically.

**Why reuse `data-bl-si-blur`:** Selection blurs should visually match blur-all blurs. Users expect consistent appearance. Using a separate attribute would require separate CSS rules and break visual consistency across modes (gaussian, frosted, redacted, censored).

---

## `blurSelection()` — Selection Reading and Validation

```js
function blurSelection() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  if (_isExtensionUI(container)) return null;  // don't blur toolbar/toast text

  const text = selection.toString();
  if (!text || text.trim().length === 0) return null;

  const id = _generateId();  // 8-char hex
  const spans = _wrapRange(range, id);

  if (spans.length === 0) return null;

  const record = { id, text, spans };
  _selections.push(record);
  selection.removeAllRanges();  // clear selection highlight after blurring

  return { id, text };
}
```

**Validation gates:**
- `selection.isCollapsed` — cursor is positioned but nothing is selected; no text to blur
- `selection.rangeCount === 0` — no selection ranges (empty selection object)
- Empty/whitespace text — selection of only whitespace has no meaningful content to blur
- Extension UI container — prevents blurring the picker toolbar's labels

`selection.removeAllRanges()` clears the blue selection highlight after blurring, so users don't see the selection persisting over the blurred text.

---

## `_wrapRange(range, id)` — Text Node Wrapping

This is the most algorithmically complex function in `selection_blur.js`. It must handle selections that span multiple text nodes and partially-selected text nodes.

### The Right-to-Left Processing Order

Text nodes in a `Range` are collected, then processed **right-to-left** (from end to start):

```js
function _wrapRange(range, id) {
  // Collect all text nodes that overlap with the range
  const textNodes = _collectTextNodes(range);
  const spans = [];

  // Process right-to-left to preserve start offsets
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const tn = textNodes[i];
    if (_isExtensionUI(tn)) continue;

    let startOffset = 0;
    let endOffset = tn.textContent.length;

    if (tn === range.startContainer) startOffset = range.startOffset;
    if (tn === range.endContainer) endOffset = range.endOffset;

    if (startOffset >= endOffset) continue;

    // Split and wrap
    let targetNode = tn;
    if (endOffset < tn.textContent.length) {
      targetNode.splitText(endOffset);         // split off trailing text
    }
    if (startOffset > 0) {
      targetNode = targetNode.splitText(startOffset);  // split off leading text
    }

    const span = document.createElement('span');
    span.setAttribute('data-bl-si-selection', id);
    span.setAttribute('data-bl-si-blur', '1');
    span.textContent = targetNode.textContent;
    targetNode.parentNode.replaceChild(span, targetNode);
    spans.unshift(span);  // maintain document order
  }

  return spans;
}
```

**Why right-to-left:**

When processing left-to-right and using `splitText()`, the character offsets of preceding nodes can shift. Example:

```
Text: "Hello World"
Selection: "ello Wor"  (startOffset=1, endOffset=9)

Processing left-to-right:
1. splitText(1) on "Hello World" → ["H", "ello World"]
2. splitText(9) on "ello World" → ["ello Wor", "ld"]
   BUT: offset 9 was relative to original "Hello World", 
        not to "ello World" (which has different length)
```

Right-to-left processing avoids this: each split operates on a text node whose preceding text has not yet been modified.

**`splitText()` mechanics:**
1. `targetNode.splitText(endOffset)` — splits the text node at `endOffset`, creating a new text node with the trailing text. `targetNode` now contains only the text up to `endOffset`.
2. `targetNode = targetNode.splitText(startOffset)` — splits again at `startOffset`, creating a new node with the middle portion. `targetNode` now references the selected text.

After both splits, `targetNode` contains exactly the selected text (or the portion of this text node that falls within the selection).

**`replaceChild`:** The selected text node is replaced with a `<span>` containing the same text. The `<span>` carries both `data-bl-si-selection=id` (for selection blur tracking) and `data-bl-si-blur=1` (for CSS blur trigger).

### `_collectTextNodes(range)` — TreeWalker Based

```js
function _collectTextNodes(range) {
  const nodes = [];
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    null
  );
  let node = walker.nextNode();
  while (node) {
    if (range.intersectsNode(node)) {
      nodes.push(node);
    }
    node = walker.nextNode();
  }
  return nodes;
}
```

`range.intersectsNode(node)` returns true if the text node overlaps with the selection range. This handles the case where `commonAncestorContainer` has many text descendants but only some are within the selection.

---

## Selection Records

Each call to `blurSelection()` creates a record:

```js
{
  id: "a3f9b2c1",      // 8-char hex, unique per selection blur
  text: "ello Wor",    // original selected text
  spans: [span, span], // all wrapper spans for this selection blur
}
```

Multiple selection blurs can exist simultaneously. Each has its own `id` to prevent confusion during removal.

---

## `removeSelectionBlur(id)` — Targeted Removal

```js
function removeSelectionBlur(id) {
  const idx = _selections.findIndex(s => s.id === id);
  if (idx === -1) return false;

  const record = _selections[idx];
  _selections.splice(idx, 1);

  // Restore spans to text nodes
  for (const span of record.spans) {
    if (!span.parentNode) continue;
    const textNode = document.createTextNode(span.textContent);
    span.parentNode.replaceChild(textNode, span);
  }

  // Merge adjacent text nodes (normalize) to avoid fragmented DOM
  // document.normalize() is too broad — only normalize affected parents
  // (not implemented in current version; rely on browser GC behavior)

  return true;
}
```

Restores each `<span>` to a text node with the same content. The DOM structure is restored — adjacent text nodes may remain fragmented after multiple selection blurs on the same parent, but this is functionally correct.

---

## `getSelectionBlurs()` — Query Active Blurs

```js
function getSelectionBlurs() {
  return _selections.map(s => ({ id: s.id, text: s.text }));
}
```

Returns a snapshot of active selection blurs (without DOM span references — those are internal). Used by popup to display selection blur history.

---

## `clearAll()` — Remove All Selection Blurs

```js
function clearAll() {
  for (const record of _selections) {
    for (const span of record.spans) {
      if (!span.parentNode) continue;
      const textNode = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(textNode, span);
    }
  }
  _selections.length = 0;
}
```

Same restoration logic as `removeSelectionBlur`, applied to all records at once.

---

## Reveal System Interaction

Selection blur spans carry `data-bl-si-blur="1"` — the same attribute as blur-all text-check stamps. The reveal system's `findBlurredTarget` and `isVisuallyBlurred` work on both:

```js
// In blur_engine.js:
function isVisuallyBlurred(element) {
  if (element.dataset.blSiBlur || element.dataset.blSiPickBlur) return true;
  // ...
}
```

Hover/click reveal will reveal selection blurs exactly like blur-all blurs. `revealAncestorChain` will clear any parent filters.

The `[data-bl-si-reveal] [data-bl-si-blur]` cascade rule in the injected `#bl-si-blur-styles` (and the static `content.css`) applies to selection blur spans:

```css
[data-bl-si-reveal] [data-bl-si-blur] {
  filter: none !important;
  user-select: auto !important;
}
```

---

## Session-Only Persistence

Selection blurs are **not saved to `chrome.storage`**. They live only in `_selections` (in-memory) and the DOM. On page reload, selection blurs disappear.

This is intentional: selection blurs are ephemeral user actions. Unlike picker items (which persist across reloads via storage), selection blurs are used for temporary in-session privacy — "I'm about to share my screen, blur this text quickly."

---

## Integration with Blur Engine (Minimal Coupling)

`selection_blur.js` uses `data-bl-si-blur` which the engine reads in `isBlurred()`. But the selection blur module does not:
- Call `blur_engine.applyBlur()`
- Notify the engine of new blurred elements
- Register with the engine's item tracking

The engine's `stampElements` and MO callback skip elements already carrying `data-bl-si-blur`:
```js
if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return;
```

This prevents the stamp pass from attempting to re-stamp selection blur spans.

The engine's `teardown()` would clear selection blur spans if it cleared all `[data-bl-si-blur]` elements — but teardown is only called when blur-all turns off, and it clears by deleting `el.dataset.blSiBlur`. This would un-blur selection blurs too.

**Known consequence:** Turning blur-all OFF clears `data-bl-si-blur` from all elements including selection blur spans. After `teardown`, selection blur spans lose their attribute and become un-blurred, even though `_selections` still tracks them. Re-enabling blur-all won't restore them (the engine doesn't know about selection blurs).

This is a known limitation — selection blurs are intended as ephemeral and don't need to survive blur-all toggles.

---

## Interaction with Blur-All Mode (CSS)

When blur-all is active with different modes (frosted, redacted, censored), selection blur spans are affected:

| Blur-all mode | Effect on selection blur spans |
|---|---|
| Gaussian | Static `content.css` rule applies gaussian blur (matches `[data-bl-si-blur]`) |
| Frosted | Injected `#bl-si-blur-styles` applies `filter: url(#bl-si-frosted-filter)` |
| Redacted | Injected rule applies `background-color + color:transparent` — text invisible |
| Censored | Injected rule applies `font-family: "bl-si-censored-disc"` — disc glyphs |

Selection blurs are included in `[data-bl-si-blur]` rule coverage automatically. When blur-all is OFF, only the static `content.css` gaussian rule applies (the injection doesn't exist).

This behavior is intentional — selection blurs should match the current blur mode for visual consistency.
