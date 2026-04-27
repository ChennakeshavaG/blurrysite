---
paths:
  - "src/*.js"
  - "popup/*.js"
  - "popup/renders/*.js"
  - "tests/unit/*.test.js"
  - "background.js"
  - "content_script.js"
---

# Module Contracts (Mandatory — Rule 5)

Every module has a contract at `docs/contracts/<module>.md`. Read it before making any change.
A hook fires on every Edit/Write to these files and reminds you of the relevant contract.

## What contracts document
- Module purpose and dependencies
- Every public function: params, returns, side effects, edge cases
- Module state (persistent variables, lifecycle)
- Private helpers (lighter coverage)

## Module → contract mapping

| File | Contract |
|---|---|
| `src/engine.js` | `docs/contracts/engine.md` |
| `src/core/engine_state.js` | `docs/contracts/core/engine_state.md` |
| `src/core/categories.js` | `docs/contracts/core/categories.md` |
| `src/core/css_manager.js` | `docs/contracts/core/css_manager.md` |
| `src/core/marker_engine.js` | `docs/contracts/core/marker_engine.md` |
| `src/core/observer.js` | `docs/contracts/core/observer.md` |
| `src/core/target_engine.js` | `docs/contracts/core/target_engine.md` |
| `src/selector_utils.js` | `docs/contracts/selector_utils.md` |
| `src/storage_model.js` | `docs/contracts/storage_model.md` |
| `src/constants.js` | `docs/contracts/constants.md` |
| `src/url_matcher.js` | `docs/contracts/url_matcher.md` |
| `src/shortcut_handler.js` | `docs/contracts/shortcut_handler.md` |
| `src/shortcut_label.js` | `docs/contracts/shortcut_label.md` |
| `src/action_registry.js` | `docs/contracts/action_registry.md` |
| `src/reveal_controller.js` | `docs/contracts/reveal_controller.md` |
| `src/picker.js` | `docs/contracts/picker.md` |
| `src/pii_detector.js` | `docs/contracts/pii_detector.md` |
| `src/content_i18n.js` | `docs/contracts/content_i18n.md` |
| `src/logger.js` | `docs/contracts/logger.md` |
| `src/auto_blur.js` | `docs/contracts/auto_blur.md` |
| `src/tab_privacy.js` | `docs/contracts/tab_privacy.md` |
| `src/fonts.js` | `docs/contracts/fonts.md` |
| `src/main_world_bridge.js` | `docs/contracts/main_world_bridge.md` |
| `src/screen_share.js` | `docs/contracts/screen_share.md` |
| `src/selection_blur.js` | `docs/contracts/selection_blur.md` |
| `src/screenshot.js` | `docs/contracts/screenshot.md` |
| `background.js` | `docs/contracts/background.md` |
| `content_script.js` | `docs/contracts/content_script.md` |
| `tests/unit/<module>.test.js` | `docs/contracts/<module>.tests.md` |
| `tests/unit/core/<module>.test.js` | `docs/contracts/core/<module>.tests.md` |

## Rules

1. **No contract = create it first.** If `docs/contracts/<module>.md` doesn't exist, write it before editing.
2. **Read before write.** Don't skim — contracts document edge cases that break dependents.
3. **Same-commit update.** After adding/modifying/removing any public function, update the contract.
4. **Test contracts.** Before modifying tests, read `docs/contracts/<module>.tests.md`. Update after changes.
5. **No other docs/ during implementation.** Contracts are the source of truth. Open other `docs/` only when planning a new feature.
