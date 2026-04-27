# engine.js — contract

Top-level orchestrator + public facade for the blur engine. Implementation is split across `src/core/*` sub-modules; this file owns lifecycle (`handleSite`, `handleShadowRoot`, `handleIframe`, `teardown`, `unblurAll`) and re-exports every public method on `blsi.Engine` so external callers (`content_script`, `picker`, `reveal_controller`, `pii_detector`, popup, tests) talk to a single surface.

## Module identity

- File: `src/engine.js`
- Global: `blsi.Engine`
- Load order (manifest.json):
  1. `core/engine_state.js`
  2. `core/categories.js`
  3. `core/css_manager.js`
  4. `core/marker_engine.js`
  5. `core/observer.js`
  6. `core/target_engine.js`
  7. `engine.js`

## Sub-module contracts

| Sub-module | Contract |
|---|---|
| `core/engine_state.js` | `docs/contracts/core/engine_state.md` |
| `core/categories.js` | `docs/contracts/core/categories.md` |
| `core/css_manager.js` | `docs/contracts/core/css_manager.md` |
| `core/marker_engine.js` | `docs/contracts/core/marker_engine.md` |
| `core/observer.js` | `docs/contracts/core/observer.md` |
| `core/target_engine.js` | `docs/contracts/core/target_engine.md` |

Read the sub-module contract for the section you're modifying — this file documents orchestration + facade only.

## Public API (`blsi.Engine`)

### Orchestration (owned here)

| Method | Returns | Notes |
|---|---|---|
| `handleSite(settings)` | `Promise` | Single entry point. Reconciles document + shadow roots to the resolved settings snapshot. Mutex-guarded — concurrent calls dropped. Caller MUST `await`. |
| `handleShadowRoot(settings, shadowRoot)` | — | Per-root dispatch. Active path: injectRules + observeRoot + queue stamp work. Inactive path: `teardown(shadowRoot)`. Public for tests; production goes through `handleSite`. |
| `handleIframe(settings, iframeEl)` | — | Cross-origin iframes only. Stamps `data-bl-si-blur` on the `<iframe>`. Same-origin iframes self-handle via `all_frames:true`. |
| `teardown(root)` | — | Disconnects observer; removes injected styles; clears stamps; recurses into shadow roots. |
| `unblurAll()` | — | Alias for `teardown(document)` + `removeAllZoneOverlays()`. |
| `_setPickerActiveForObserver(v)` | — | Used by `content_script.setPickerActive` to keep `EngineState.pickerActive` in sync. |
| `get isPageBlurred()` | `boolean` | Reads `EngineState.isPageBlurred`. |
| `get blurredCount()` | `number` | Reads `EngineState.blurredCount`. |

### Re-exports

| Method | Implemented in |
|---|---|
| `applyBlur`, `removeBlur`, `isBlurred`, `isVisuallyBlurred`, `stampElements`, `tryBlurTextCheck`, `matchesActiveCategories`, `shouldBlurElement` | `marker_engine.js` |
| `injectRules`, `removeRules`, `isBlurAllActive`, `injectPickBlurRules`, `removePickBlurRules`, `injectPiiRules`, `removePiiRules`, `ensureSvgFilter` | `css_manager.js` |
| `observeRoot`, `subscribeMutations`, `unsubscribeMutations`, `hasSubscribers` | `observer.js` |
| `getZoneOverlays`, `resetCounters`, `allocateElementName`, `allocateStickyName`, `highlightItem`, `clearItemHighlight` | `target_engine.js` |
| `CATEGORY_SELECTORS` | `categories.js` |

## handleSite reconcile flow

Settings shape (resolved by `blsi.Model.resolve(host, url, tabId)` before being passed in):

```
{
  enabled, engage, blur_items,
  blur_categories, blur_mode, thorough_blur,
  pick_blur_enabled, pick_blur_type, pick_blur_color,
  blur_radius, highlight_color, transition_duration, redaction_color,
  // … plus pii_*, automate_*, screen_share_*
}
```

`engage` (boolean) is the page-wide engine gate — derived by `Model.resolve()` as `(enabled !== false) && (manual_blur || (automate_blur_active && !blur_present))`. `handleMainDocument` / `handleShadowRoot` / `handleIframe` read it directly; the `enabled` fold means callers don't need a separate `enabled` check.

1. Mutex acquired (`_handling`). Concurrent calls dropped.
2. **Deep-equals short-circuit**: if `settings` deep-equals `localCache`, return. Otherwise `localCache = settings` and continue. `teardown(document)` clears `localCache` so the next call always runs.
3. `EngineState.setCurrentSettings(settings)` — MO callback reads this for new shadow / iframe stamping.
4. `_applyCssVars(settings)` writes CSS custom properties on `:root`. Must run before `injectRules` (frosted mode reads radius via `_readCssRadius`).
5. **Extension disabled** (`enabled === false`): full teardown including items + zone overlays, return.
6. `handleMainDocument` reinjects + restamps unconditionally on the active path. `EngineState.setIsPageBlurred(engage)`.
7. **Items** (always reconciled): `TargetEngine.reconcileItems(blur_items)`. Picker blurs and sticky zones persist when blur-all is off.
8. **MO re-attach** if blur-all is off but a consumer still needs the document MO — either `getPickBlurDynamicActive()` is true OR `Observer.hasSubscribers()` (e.g. PII detector) returns true. `observeRoot(document)` is idempotent.
9. **Pick-blur CSS** injected/removed based on `pick_blur_enabled` + non-empty items.
10. Mutex released.

## State (owned here)

| Var | Default | Notes |
|---|---|---|
| `_handling` | `false` | Mutex flag. |
| `localCache` | `null` | Last fully-applied settings snapshot. `handleSite` short-circuits when the incoming settings deep-equal this value. Cleared by `teardown(document)` so the next call always runs. Replaces the prior `_lastReconcileKey` fingerprint — slider drags on `blur_radius` / `highlight_color` now go through `handleMainDocument` instead of being skipped. |

Cross-cutting state lives in `core/engine_state.js`.

## Edge cases

- **Mutex drops concurrent calls.** Every caller must `await`. Fire-and-forget invocations let two reconciles interleave and corrupt `_activeItems`.
- **Settings snapshot in MO callback**: stored on `EngineState`, read fresh per callback. Never capture in a closure.
- **Shadow attach via main_world_bridge**: `Observer.initShadowAttachListener()` registers the capture handler. MO does not fire on `attachShadow()` because it's a property assignment.
- **`unblurAll` cleans zones** alongside stamps. Calling `teardown(document)` directly leaves zone overlays in place — only `unblurAll` clears them.

## Why this module exists (Why)

External code talks to one stable surface (`blsi.Engine`). Sub-module splits stay invisible. This file is the single place to look for orchestration sequence + the public API map.

## How to apply (How)

- Adding a public method: implement in the appropriate sub-module, then re-export on the `blsi.Engine` object literal in `engine.js`. Update this contract's API table + the sub-module's contract.
- Changing reconcile order: edit `handleSite`. Sub-modules are stateless wrt. reconcile sequence — they expose primitives, not policy.
- Adding a new blur mode: extend `core/css_manager.js injectRules` only. No facade change needed unless the mode adds public API.
