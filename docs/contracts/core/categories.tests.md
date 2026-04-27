# core/categories.tests.md

Test contract for `tests/unit/core/categories.test.js`.

## Coverage map (planned)

The module is data-only; coverage comes implicitly from existing engine tests that consume `CATEGORY_SELECTORS`. A standalone test file is optional but small and worthwhile for shape-stability:

| describe | tests |
|---|---|
| `CATEGORY_SELECTORS shape` | every key is `{ alwaysBlur, textCheck, roles? }`; arrays are frozen |
| `CATEGORY_ORDER` | exact order matches canonical fingerprint expectations: `['text','media','structure','form','table']` |
| `DEFAULT_CATS` | matches `blsi.DEFAULT_MODEL.blur_all.settings.blur_categories` reference |
| `frozen guards` | mutating any nested array or top-level key in strict mode throws |
| `tag membership invariants` | `li`/`dt`/`dd` in `structure.alwaysBlur` (not textCheck — drives `::marker` blur); `media.textCheck` is empty |

## Edge cases that matter

- The freezing is shallow per `Object.freeze`. Tests should assert `Object.isFrozen` on every nested level explicitly.
- `DEFAULT_CATS` is a reference to `blsi.DEFAULT_MODEL.blur_all.settings.blur_categories`, not a clone — tests must not mutate.

## Known gaps

- No drift detection between `CATEGORY_SELECTORS` and `docs/BLUR_CATEGORIES.md`. Adding new tags relies on humans updating both.
