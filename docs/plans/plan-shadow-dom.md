# Plan: Shadow DOM Support — blur_engine.js

## Problem

`document.querySelectorAll` does not pierce shadow boundaries. Web components
(GitHub, Notion, YouTube comments, custom elements) host entire subtrees inside
shadow roots that are invisible to the current blur engine. blur-all silently
skips them.

---

## Goal

`handleSite(settings)` — single entry point — handles the document root AND
every open shadow root beneath it, identically. Shadow roots get their own
injected `<style>`, their own `MutationObserver`, their own stamp sweep. No
new public entry points; callers stay untouched.

---

## Design

### Core model

```
document root            shadow root A            shadow root B (nested)
─────────────────        ─────────────────        ─────────────────────
injectRules(root)        injectRules(srA)         injectRules(srB)
clear stale stamps       clear stale stamps       clear stale stamps
stampElements(root)      stampElements(srA)       stampElements(srB)
  → discovers [srA,srB?]   → discovers []           → discovers []
observeRoot(root)        observeRoot(srA)         observeRoot(srB)
  ↓ parallel dispatch
  handleDocument(srA)    handleDocument(srB)
  (srA & srB processed
   concurrently after
   root scan completes)
```

Each root is fully independent. `Promise.all` parallelises siblings.
The recursive call to nested shadow roots happens AFTER the parent root's
stamp sweep, not during — clean separation, no mid-loop dispatch.

---

## Function Contracts

### `stampElements(root, categories, thorough, mode)` — sync, returns `ShadowRoot[]`

- ONE `querySelectorAll('*')` pass on `root`.
- For each element:
  - If `el.shadowRoot` → push to returned array (smart discovery, piggybacked).
  - If tag in `_textCheckSet` → apply text-check stamp logic (unchanged).
- **Remove `shadowCb` parameter.** Caller (`handleDocument`) owns dispatch.
- Return value is `ShadowRoot[]` — callers that don't need it ignore it.
- Keeps working as a public function for unit tests that call it directly.

### `handleDocument(settings, root)` — **async**, one root

```
active = ENABLED !== false && BLUR_ALL_ACTIVE

── Inactive path ─────────────────────────────────────────
teardown(root)   [sync, recurses — see below]
return

── Active path ───────────────────────────────────────────
cats  = settings.BLUR_CATEGORIES || DEFAULT_CATS
mode  = settings.BLUR_MODE
thorough = !!settings.THOROUGH_BLUR

// 1. Inject CSS rules for this root
injectRules(root, cats, mode)

// 2. Clear stale text-check stamps in this root only
//    querySelectorAll('[data-bl-si-blur]') does NOT pierce shadow boundaries —
//    that's intentional: shadow root stamps are cleared when we recurse into them.
root.querySelectorAll('[data-bl-si-blur]').forEach(el => {
  if (!el.dataset.blSiPii) { delete el.dataset.blSiBlur; _clearMaskAttrs(el); }
})

// 3. Stamp text-check elements + discover shadow roots — ONE pass
const shadowRoots = stampElements(root, cats, thorough, mode)

// 4. Attach MutationObserver for this root
observeRoot(root)

// 5. Recurse into shadow roots — parallel, after this root is fully processed
if (shadowRoots.length) await Promise.all(shadowRoots.map(sr => handleDocument(settings, sr)))
```

Why async: `Promise.all` on sibling shadow roots allows parallel processing.
`handleDocument` called from the MO callback is fire-and-forget (MO is sync) —
acceptable, since `observeRoot` idempotency and per-element guards prevent corruption.

### `teardown(root)` — sync, recursive

```
disconnectObserver(root)
removeRules(root)

// ONE pass: clear stamps + collect shadow hosts for recursion
const shadowHosts = []
root.querySelectorAll('*').forEach(el => {
  if (el.dataset.blSiBlur && !el.dataset.blSiPii) { delete el.dataset.blSiBlur; _clearMaskAttrs(el); }
  if (el.shadowRoot) shadowHosts.push(el)
})

// SVG filter cleanup
const svg = root.querySelector?.('#' + SVG_FILTER_ID)
if (svg?.parentNode) svg.parentNode.removeChild(svg)

// Recurse into each shadow root
shadowHosts.forEach(h => teardown(h.shadowRoot))
```

Sync intentionally — teardown must be callable from sync contexts (unblurAll, inactive path).
querySelectorAll does NOT pierce boundaries, so we collect shadow hosts and recurse manually.

### `observeRoot(root)` — sync, idempotent

No structural change from current design. Key addition in the MO callback:

```
// Guard: if root already has an observer, it was already processed — skip
if (node.shadowRoot && _currentSettings && !_observers.has(node.shadowRoot)) {
  handleDocument(_currentSettings, node.shadowRoot)   // fire-and-forget (async)
}
```

The `!_observers.has(sr)` guard prevents re-processing a shadow root that
`handleDocument` already activated. Without it, every MO tick for an already-
observed shadow root would trigger a redundant re-scan.

### `injectRules(root, categories, mode)` — unchanged

`root.head ?? root` already handles both document (`<head>`) and shadow roots
(no `.head`, so styles go directly into the root). CSS custom properties
(`--bl-si-radius`, etc.) set on `:root` in the light DOM ARE inherited into
open shadow roots — no extra propagation needed.

### `handleSite(settings)` — minimal change

Replace the `handleDocument(settings, document)` call with `await handleDocument(settings, document)`.
`handleDocument` is now async and dispatches shadow roots recursively, so a single
`await` at the top level covers the full tree.

---

## Changes to Current Code

| Location | Change |
|---|---|
| `stampElements` signature | Remove `shadowCb` param. Return `ShadowRoot[]`. Collect `el.shadowRoot` in the existing `querySelectorAll('*')` loop. |
| `handleDocument` | Make `async`. Replace `stampElements(..., (sr) => handleDocument(...))` with `const srs = stampElements(...); ... await Promise.all(srs.map(...))`. |
| `observeRoot` MO callback | Add `!_observers.has(node.shadowRoot)` guard before calling `handleDocument` for new shadow hosts. |
| `handleSite` | Add `await` before `handleDocument(settings, document)`. |
| `teardown` | Replace current shadow recursion (which calls `teardown(el.shadowRoot)` inline in forEach) with collect-then-recurse pattern for clarity. Logic is identical — collect shadow hosts in the `*` pass, call teardown on each after the loop. |

Everything else (injectRules, removeRules, ensureSvgFilter, isBlurred, isVisuallyBlurred, zone overlays, item reconciliation) is **unchanged**.

---

## Interaction Analysis

### content_script.js — no changes needed

`_reconcile()` calls `await Engine.handleSite(...)` — already awaits. `handleSite`
becoming deeper-async (awaiting shadow root dispatch) is transparent to the caller.

### reveal_controller.js — known limitation (out of scope)

Reveal registers listeners on `document` at capture phase and reads `event.target`.
Shadow DOM events are **retargeted** at the shadow boundary — by the time the event
reaches document, `event.target` is the shadow host, not the deep element.
Reveal on elements inside shadow roots will not work without `event.composedPath()[0]`.
Document this as a known limitation; do NOT fix in this plan.

`isBlurAllActive()` checks `document.head` only. For alwaysBlur elements inside
shadow roots (visually blurred by CSS in the shadow root's injected `<style>`),
`isBlurred()` returns false. Reveal ancestor walks will miss them. Acceptable for
Phase 1 — reveal + picker can't reach inside shadow roots anyway due to retargeting.

### picker.js — known limitation (out of scope)

Same retargeting issue. `onClick` capture-phase listener on document gets shadow host,
not the clicked element. Shadow root elements are not pickeable in Phase 1.

### MutationObserver + async handleDocument

MO callbacks are synchronous. `handleDocument` called from MO is fire-and-forget.
Concurrent calls on the same root are harmless:
- `observeRoot` idempotency (`_observers.has(root)`) prevents double-observe.
- `el.dataset.blSiBlur` guard in stampElements prevents double-stamping.
- `injectRules` calls `removeRules` first (replace semantics — idempotent).

---

## Tests Needed

File: `tests/unit/blur_engine.test.js` — new `describe('shadow DOM')` block.

jsdom supports `attachShadow({ mode: 'open' })`. Tests can build real shadow roots.

| Test name | Asserts |
|---|---|
| `injectRules injects style into shadow root` | `sr.querySelector('#bl-si-blur-styles')` not null after `injectRules(sr, cats, mode)` |
| `removeRules removes style from shadow root` | null after inject then `removeRules(sr)` |
| `stampElements stamps text-check elements inside shadow root` | `<span>text</span>` inside sr gets `data-bl-si-blur` |
| `stampElements returns discovered shadow roots` | return value contains `sr` when host is inside root |
| `handleDocument active path injects rules and stamps inside shadow root` | sr has `#bl-si-blur-styles`; `<span>text</span>` inside sr has `data-bl-si-blur` |
| `handleDocument inactive path tears down shadow root` | after active then inactive: sr has no style, no stamps |
| `teardown removes stamps and rules recursively in nested shadow roots` | host → sr → nested host → nested sr: all cleared by single `teardown(document)` |
| `handleSite stamps elements inside shadow roots when blur-all active` | end-to-end: body has shadow host with `<span>text</span>` → after `handleSite({BLUR_ALL_ACTIVE:true,...})`, sr has style + stamp |
| `observeRoot guard prevents re-processing already-observed shadow root` | calling observeRoot(sr) twice does not create second observer |

Each new test needs a `docs/TEST_VALIDATION.md` entry per project rules.

---

## Docs to Update

| File | Section | What |
|---|---|---|
| `docs/LLD.md` | §2 blur_engine.js | Full replacement: state table, public API interface, handleSite/handleDocument/stampElements pseudocode. Remove videoOverlayMap, canvas overlay, blurAllContent. |
| `CLAUDE.md` | Module Globals — blur_engine row | Update `stampElements` signature (no shadowCb, returns ShadowRoot[]); confirm handleDocument, observeRoot, disconnectObserver in public API list |
| `docs/TEST_VALIDATION.md` | blur_engine section | Add entries for each new shadow DOM test |
| `CLAUDE.md` | Known Limitations | Add: reveal + picker don't work inside shadow roots (retargeting); isBlurAllActive() checks document.head only |

---

## Commit

One commit: `src/blur_engine.js` + `tests/unit/blur_engine.test.js` + `docs/LLD.md` + `CLAUDE.md` + `docs/TEST_VALIDATION.md`.

```
feat(blur-engine): shadow DOM support — injectRules + stamp + observe per root
```
