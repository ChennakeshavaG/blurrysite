# core/target_engine.js — contract

User-defined blur targets: dynamic items, sticky zones, and the popup-hover highlight that lights up the page element corresponding to a popup list row.

## Module identity

- File: `src/core/target_engine.js`
- Global: `blsi.TargetEngine`
- Load order: after `observer.js`, before `engine.js`.

## Public API

### Item dispatch

| Method | Returns | Notes |
|---|---|---|
| `reconcileItems(desired)` | `{ added, removed }` | Diffs `desired` against `_activeItems`, applies / removes the delta. Sets `EngineState.pickBlurDynamicActive` based on whether any active item is dynamic. Picker blurs and sticky zones persist when blur-all is off. |
| `activeItemsSize()` | `number` | Used by orchestrator logging. |

### Counter allocation (picker callbacks)

| Method | Returns | Notes |
|---|---|---|
| `resetCounters()` | — | Clears element / page-area / screen-area counters. Called once on init. |
| `allocateElementName()` | `string` | `'Element <n>'` — for dynamic-item naming. |
| `allocateStickyName(anchor)` | `string` | `'Area on screen <n>'` or `'Area on page <n>'`. Counters seed on item apply via name parsing so allocation is monotonic across reloads. |

### Zone overlays

| Method | Returns | Notes |
|---|---|---|
| `getZoneOverlays()` | `HTMLElement[]` | Snapshot of currently-mounted zone overlays. |
| `removeAllZoneOverlays()` | — | Used by `engine.unblurAll()` and the extension-disabled path of `handleSite`. |

### Late-loading pick-blur stamping

| Method | Returns | Notes |
|---|---|---|
| `tryPickBlurNode(el)` | — | Called from `observer.js` MO drain. Stamps `data-bl-si-pick-blur` if the element matches any active dynamic item's selectors AND is uniquely matched by that selector in the document. Skips extension UI. |

### Popup hover highlight

| Method | Returns | Notes |
|---|---|---|
| `highlightItem(item)` | — | `item.item_type === 'dynamic'` → resolves selector, falls back to scanning hits for one with `[data-bl-si-pick-blur]`. `'sticky'` → looks up zone overlay by `id`. Stamps `bl-si-hover-highlight` and scrolls into view. |
| `clearItemHighlight()` | — | Removes the class and clears internal pointer. |

## State

| Var | Type | Notes |
|---|---|---|
| `_zoneOverlays` | `Map<string, HTMLElement>` | Keyed by `zoneData.id`. |
| `_activeItems` | `Map<string, item>` | Keyed by `_itemId(item)` — first selector for dynamic, `id` for sticky. |
| `_elementCounter` / `_pageAreaCounter` / `_screenAreaCounter` | `number` | High-water marks for naming. |
| `_highlightedEl` | `HTMLElement \| null` | Currently highlighted popup-hover target. |

## Zone anchors

| Anchor | Position | Coordinate system | Use case |
|---|---|---|---|
| `'page'` (default) | `position: absolute` | document | Scrolls with content. Re-projects X/width on viewport-width changes via `xPct` / `widthPct`. Y/height never re-projected (page height is unstable during load). |
| `'screen'` | `position: fixed` | viewport | Stays put during scroll. Raw x/y stable across pages. Best for screen-share privacy. |

The overlay element stamps `data-bl-si-zone-anchor="page" \| "screen"` and `data-bl-si-pick-blur="1"` so the static `content.css` rule + `injectPickBlurRules` reach it.

## Cross-module dependencies

| Direction | Modules |
|---|---|
| Reads | `blsi.MarkerEngine._isExtensionUI`; `blsi.SelectorUtils.restoreSelector`; `blsi.css.zone_overlay` |
| Writes (via EngineState) | `setPickBlurDynamicActive` |
| Inbound calls | `engine.handleSite` → `reconcileItems`, `removeAllZoneOverlays`; `observer.js` MO drain → `tryPickBlurNode`; `picker.js` callbacks → `allocateElementName` / `allocateStickyName` / `resetCounters`; `content_script.js` (popup messages) → `highlightItem` / `clearItemHighlight` |

## Edge cases

- **Counter seeding**: applying an item with an existing name parses the trailing digit and sets the high-water mark so subsequent allocations don't collide. Items with non-standard names (legacy `'Sticky N'`) seed the page-area counter.
- **Selector failures**: `restoreSelector` returns `null` if no selector matches uniquely. `_applyDynamicItem` silently leaves the page un-stamped — picker shows a "may not persist" warning at capture time. Re-trying as elements load happens via `tryPickBlurNode` in the MO drain.
- **Zone idempotency**: `createZoneOverlay` removes an existing overlay with the same id before creating the new one.
- **Picker on PII span**: `_applyDynamicItem` does not check for `data-bl-si-pii`. A dynamic-item selector that matches a PII span will stamp `data-bl-si-pick-blur` on top of `data-bl-si-pii`. Visually safe (both render blur), but the same element ends up owned by two systems. Cross-ref: `CLAUDE.md` Known Limitations row for similar EXCLUDE-chain edge cases.
- **Transformed ancestors**: page-anchored zones use `position: absolute`. CSS `transform` on an ancestor element changes the containing block — the zone misaligns relative to the document. `position: fixed` (screen anchor) is unaffected. See `CLAUDE.md` Known Limitations.

## Why this module exists (Why)

Zones, item dispatch, and highlight all manage user-named blur targets stored under `pick_and_blur.items`. Co-locating them keeps reconcile + counter + highlight semantics in one file rather than spread across the engine.

## How to apply (How)

- Adding a new item type: extend `applyItem` / `removeItem` / `_itemId` and add the type to `pick_and_blur.items` schema in `constants.js`.
- Changing zone anchor semantics: update `_applyStickyItem` (coordinate calc) and `createZoneOverlay` (CSS position). Re-test on transform-heavy pages — `position:absolute` zones can misalign on transformed ancestors (documented in CLAUDE.md Known Limitations).
