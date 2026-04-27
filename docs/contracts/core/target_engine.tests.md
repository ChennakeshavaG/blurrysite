# core/target_engine.tests.md

Test contract for `tests/unit/core/target_engine.test.js` (planned).

## Coverage map

| Section / describe | What it asserts |
|---|---|
| `reconcileItems` | Diff against `_activeItems` adds new + removes stale; `EngineState.pickBlurDynamicActive` flips correctly. |
| `applyItem dynamic` | Stamps `data-bl-si-pick-blur`; counter seeds from item name. |
| `applyItem sticky / page anchor` | `position: absolute` overlay; xPct re-projection on viewport-width change. |
| `applyItem sticky / screen anchor` | `position: fixed` overlay; raw x/y, no re-projection. |
| `tryPickBlurNode` | Stamps if element matches active dynamic item AND selector matches one element in document; skips extension UI. |
| `Counter allocation` | `allocateElementName` and `allocateStickyName(anchor)` are monotonic; `resetCounters` zeroes them. |
| `getZoneOverlays / removeAllZoneOverlays` | Tracking integrity; cleanup removes from DOM and Map. |
| `highlightItem / clearItemHighlight` | Dynamic by selector + fallback hit scan; sticky by id; class added/removed; scrollIntoView called when present. |

## Edge cases that matter

- `removeAllZoneOverlays` is idempotent; safe to call when no zones exist.
- Items with names from older naming schemes (`'Sticky N'`) seed the page-area counter — tests should cover that legacy path.
- `_applyDynamicItem` silently no-ops if the selector doesn't resolve uniquely. The MO drain catches the late case via `tryPickBlurNode`.

## Known gaps

- No test for transformed-ancestor edge case (zones misalign with absolute positioning under CSS transform).
- No test for popup highlight when item references a zone overlay that was removed since the popup last loaded.
