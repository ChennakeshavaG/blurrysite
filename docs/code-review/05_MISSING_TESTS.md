# Code Review: Missing Test Coverage

## Critical (tests reference removed APIs)

| Test File | Issue |
|---|---|
| `tests/e2e/blur.spec.js` | 10+ assertions check `.bl-si-blurred` class (removed) |
| `tests/e2e/observer_pipeline.spec.js` | Calls `blurAllContent()` (removed from public API) |
| `tests/e2e/mutation_loop.spec.js` | References `bl-si-text-node-wrapper` (removed) |
| `tests/e2e/popup_flow.spec.js` | References `#blurCount`, `#listCount` (removed from HTML) |

## New functions with 0 test coverage

| Function | File | What to test |
|---|---|---|
| `injectBlurRules()` | blur_engine.js | Style creation, category filtering, frosted mode, exclusions |
| `removeBlurRules()` | blur_engine.js | Style removal, double-call safety |
| `blurTextCheckElements()` | blur_engine.js | Text gate, thorough mode, exclusion |
| `tryBlurTextCheck()` | blur_engine.js | Tag check, empty textCheckSet, idempotency |
| `isBlurAllActive()` | blur_engine.js | State tracking |
| `findClassedParent()` | picker.js | blsi-* filtering, fallback to self |
| `_revealElement()` | content_script.js | Inline style, descendant reveal |
| `_unrevealAll()` | content_script.js | Style cleanup, Set clearing |
| `findBlurredTarget()` | content_script.js | CSS-rule + data-attribute detection |

## Missing interaction tests

| Scenario | Why |
|---|---|
| Blur-all ON + picker blur + X button | Does element stay blurred by CSS rules? |
| Rapid toggle blur-all ON/OFF | Race between injectBlurRules/removeBlurRules |
| Settings change during active blur-all | Does applyState re-inject rules correctly? |
| SPA navigation with blur-all active | Do CSS rules persist? Do text-check stamps survive? |
| Rule modal open → save → open again | Listener stacking? |
| Renderer.updateAll() after external settings change | Are all control types synced? |
