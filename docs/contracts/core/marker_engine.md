# core/marker_engine.js — contract

Element-level blur stamping plus the predicates picker / reveal_controller use to ask "is this element blurred?". Everything that reads or writes `data-bl-si-blur` on a single element lives here.

## Module identity

- File: `src/core/marker_engine.js`
- Global: `blsi.MarkerEngine`
- Load order: after `css_manager.js`, before `observer.js`.

## Public API

| Method | Returns | Notes |
|---|---|---|
| `applyBlur(element)` | — | Idempotent. Stamps `data-bl-si-blur="1"`. Skips extension UI. Increments `EngineState.blurredCount`. |
| `removeBlur(element)` | — | Clears `data-bl-si-blur` AND `data-bl-si-pick-blur`. Decrements blurredCount only if the blur attribute was present. |
| `isBlurred(element)` | `boolean` | Stamped or always-blur tag match. **Does not match role-based CSS** — that gate lives in `isVisuallyBlurred`. |
| `isVisuallyBlurred(element)` | `boolean` | Superset of `isBlurred`: also matches role-based CSS rules + PII spans. Used by `reveal_controller` for ancestor / descendant walks. |
| `matchesActiveCategories(element, categories)` | `boolean` | Tag set + role set. |
| `shouldBlurElement(element, categories, thorough)` | `boolean` | Same as `matchesActiveCategories` but applies the text-content gate for `textCheck` tags. |
| `stampElements(root, categories, thorough, mode)` | `ShadowRoot[]` | One `querySelectorAll('*')` pass: stamps text-check elements + collects shadow roots. Stale stamps cleared inline. PII-stamped elements skipped. |
| `tryBlurTextCheck(element, thorough)` | — | Single-element variant for MO callbacks. |
| `rebuildTextCheckSet(categories)` | — | Sync the internal text-check tag set after a category-toggle change. Idempotent (caches a key). |
| `_isExtensionUI(element)` | `boolean` | True for the picker toolbar, toast, zone overlay, and any `[data-bl-si-zone]` element. Exported for `target_engine` to gate pick-blur stamps. |

## State

| Var | Default | Notes |
|---|---|---|
| `_textCheckSet` | empty Set | Rebuilt by `rebuildTextCheckSet` when category fingerprint changes. |
| `_lastTextCheckKey` | `null` | Memoisation key for the rebuild guard. |
| `_structuralTags` | `new Set(CATEGORY_SELECTORS.structure.textCheck)` | Tags that always require the text gate (never bypassed by `thorough`). |

## Cross-module dependencies

| Direction | Modules |
|---|---|
| Reads | `blsi.Categories.{CATEGORY_SELECTORS, CATEGORY_ORDER, DEFAULT_CATS}`; `blsi.CssManager.{getSelectors, getLastSelectorCache, isBlurAllActive}`; `blsi.ids.picker_toolbar`; `blsi.css.{toast, toolbar}` |
| Writes (via EngineState) | `incrementBlurredCount`, `decrementBlurredCount` |
| Inbound calls | `blsi.CssManager.injectRules → rebuildTextCheckSet`; `blsi.Observer` MO drain → `tryBlurTextCheck`; `blsi.Engine` orchestrator → `stampElements`; `blsi.TargetEngine.tryPickBlurNode` → `_isExtensionUI`; `picker.js` → `applyBlur`/`removeBlur`/`isBlurred`; `reveal_controller.js` → `isVisuallyBlurred` |

## Edge cases

- **Stamping ownership guard**: every stamp path skips elements already carrying `data-bl-si-pick-blur` or `data-bl-si-pii`. CSS `EXCLUDE` chain mirrors this. Both must stay in sync — see `css_manager.md`.
- **Custom elements**: hyphenated tag names never appear in `_textCheckSet`. The host gets stamped via the custom-element branch of `stampElements` (gated on `STRUCTURE` or `TEXT` active and meaningful text / thorough). Shadow root content is stamped separately via `_flushStampQueue` recursion in `observer.js`.
- **`<slot>` descendants**: inline / phrasing tags with a `<slot>` inside get stamped even without direct text — the slot projects light-DOM content visually.
- **Structural containers** (`div`, `section`, etc.): always require the text gate, even in `thorough` mode. Bypassing this caused nested-blur leaks on hover reveal.
- **Role match in `isVisuallyBlurred` only**: widening `isBlurred` to include role match would route picker / context-menu unblur paths through silent no-ops against storage. See contract Why below.

## Why this module exists (Why)

Stamping has a single contract: drive the count, gate by extension-UI / competing systems, return the right answer to picker click handlers. Splitting it out means picker / reveal_controller call into a small, testable surface instead of the monolithic engine.

## How to apply (How)

- Adding a new blur category: edit `Categories.CATEGORY_SELECTORS` only. `_structuralTags` derives automatically.
- Changing the stamping guard set: update both `stampElements` and `tryBlurTextCheck` (they share the inline `if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return;` line).
- Tests must seed `EngineState.setBlurredCount(0)` between cases if they verify count assertions.
