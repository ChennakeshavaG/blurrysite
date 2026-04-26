# selection_blur Contract

## Overview

Wraps user-selected text ranges in blur spans (`data-bl-si-blur="1"`) without blurring the entire containing element. Each blur gets a unique ID stored in `data-bl-si-selection` for targeted removal. Integrates with the blur engine's CSS rules via the `data-bl-si-blur` attribute. Text-node splitting is done right-to-left to preserve DOM offsets.

## Module State

| Variable | Description |
|---|---|
| `SEL_ATTR` | `'data-bl-si-selection'` — attribute on blur spans for identity/removal |
| `BLUR_ATTR` | `'data-bl-si-blur'` — attribute that triggers CSS blur (integrates with blur engine) |
| `_selections` | `Array<{id, text, spans}>` — all active selection blur records |
| `_idCounter` | `number` — monotonic counter for unique ID generation |

## Public API

### blurSelection()

**What**: Wraps the current document selection in blur spans.  
**Params**: none (reads `document.getSelection()` internally)  
**Returns**: `{ id: string, text: string } | null` — the new selection blur record, or `null` if nothing was blurred  
**Side effects**:
- Splits text nodes and inserts `<span data-bl-si-selection="id" data-bl-si-blur="1">` spans
- Clears the selection via `selection.removeAllRanges()`
- Pushes a record to `_selections`  
**Handles**:
- Collapsed or empty selection → returns `null`
- Selection inside extension UI (toolbar, toast, zones) → returns `null`
- Selection spanning multiple text nodes → each node gets its own span
- Empty text after trim → returns `null`

### init()

**What**: No-op placeholder — context menu integration is handled by `content_script.js`.  
**Params**: none  
**Returns**: `void`

### destroy()

**What**: Alias for `clearAll()` — removes all selection blurs.  
**Params**: none  
**Returns**: `void`  
**Side effects**: Calls `clearAll()`

### clearAll()

**What**: Removes all selection blur spans from the document, restoring original text.  
**Params**: none  
**Returns**: `void`  
**Side effects**:
- Queries all `[data-bl-si-selection]` spans, replaces each with a text node
- Calls `parent.normalize()` after each replacement to merge adjacent text nodes
- Clears `_selections = []`

### getSelectionBlurs()

**What**: Returns all active selection blur records (metadata only, no DOM refs).  
**Params**: none  
**Returns**: `Array<{ id: string, text: string }>` — shallow copies, no span references

### removeSelectionBlur(id)

**What**: Removes a specific selection blur by ID, restoring its text nodes.  
**Params**: `id` (string) — the selection blur ID from `blurSelection()`  
**Returns**: `void`  
**Side effects**:
- Queries `[data-bl-si-selection="id"]` spans, replaces each with a text node
- Calls `parent.normalize()` after each replacement
- Filters `_selections` to remove the matching record  
**Handles**: No-op if ID not found in DOM or `_selections`.

## Internal Functions

### _isExtensionUI(node)

**What**: Checks if a node is inside extension UI (toolbar, toast, zones).  
**Params**: `node` (Node) — text node or element  
**Returns**: `boolean`  
**Handles**: Text nodes → checks `parentElement`; guards toolbar by ID, `.bl-si-toast`, `.bl-si-toolbar`, `[data-bl-si-zone]`.

### _generateId()

**What**: Generates a unique selection blur ID.  
**Returns**: `string` — format: `'sel_<counter>_<6-char random>'`

### _wrapRange(range, id)

**What**: Splits and wraps all in-range text nodes with blur spans.  
**Params**: `range` (Range), `id` (string)  
**Returns**: `Element[]` — all created spans in document order  
**Side effects**: Splits text nodes, replaces with spans  
**Critical**: Processes text nodes **right-to-left** so earlier node offsets remain valid after `splitText()` calls.  
**Handles**: Extension UI nodes are skipped; empty text slices are skipped; partial text node selection (uses `startOffset`/`endOffset`).

## Invariants

- Spans carry BOTH `data-bl-si-selection` (for identity/removal) AND `data-bl-si-blur` (for CSS blur via blur engine rules).
- `_wrapRange` always processes text nodes last-to-first — violating this corrupts DOM offsets during multi-node selections.
- `parent.normalize()` is called after every span removal to merge adjacent text nodes — prevents fragmented text DOM.
- Each `blurSelection()` call produces a unique ID via `_generateId()` — IDs never repeat within a session.
- `_selections` tracks only metadata; DOM querying uses `[data-bl-si-selection]` attribute directly.
