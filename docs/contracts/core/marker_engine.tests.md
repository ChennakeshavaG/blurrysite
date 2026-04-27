# core/marker_engine.tests.md

Test contract for `tests/unit/core/marker_engine.test.js` (planned — extraction from `tests/unit/engine.test.js`).

## Coverage map

| Section / describe | What it asserts |
|---|---|
| `applyBlur / removeBlur / isBlurred` | Idempotent stamp; count bookkeeping; extension-UI guard. |
| `isVisuallyBlurred (vs isBlurred)` | Returns true for role-based CSS matches; for PII spans; tracks `data-bl-si-blur` and `data-bl-si-pick-blur`. |
| `stampElements` | One pass returns shadow roots; PII-stamped elements untouched; competing-attr guard skips `data-bl-si-pick-blur` and `data-bl-si-pii`; structural containers require text gate even in thorough mode; custom-element host stamping; `<slot>` projection. |
| `tryBlurTextCheck` | Single-element variant of stampElements (used by MO drain). Same gates. |
| `matchesActiveCategories` | Tag set + role set; respects category toggles. |
| `shouldBlurElement` | textCheck tags require text gate (or thorough); alwaysBlur tags don't; role match is alwaysBlur-equivalent. |
| `rebuildTextCheckSet` | Idempotent on identical fingerprint; rebuilds on category change. |

## Edge cases that matter

- `removeBlur` on an element with neither `data-bl-si-blur` nor `data-bl-si-pick-blur` is a no-op for the count.
- Stamping skips elements with `data-bl-si-pii` (independent ownership). Adding a new attribute-owned blur system requires updating both the stamp guard AND `EXCLUDE` in css_manager.
- `_isExtensionUI` covers picker toolbar id, toast class, toolbar class, and `[data-bl-si-zone]` attribute. Adding new extension UI elements requires extending this guard.

## Known gaps

- Role-match ARIA tests cover FORM (the only category with roles today). Adding roles to other categories needs new tests.
- Shadow DOM ARIA role match not directly tested.
