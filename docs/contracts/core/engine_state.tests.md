# core/engine_state.tests.md

Test contract for `tests/unit/core/engine_state.test.js`.

## Coverage map (planned)

EngineState has no behaviour worth exhaustive testing on its own — it is a thin wrapper around five let-bindings. Coverage comes implicitly via:

- `tests/unit/blur_engine.test.js` — exercises every getter/setter through `Engine.handleSite`, `Engine.applyBlur`, `Engine.removeBlur`, `Engine.unblurAll`.
- `tests/unit/reveal_controller.test.js` — relies on `EngineState.getBlurredCount` accuracy via the facade.

A standalone `tests/unit/core/engine_state.test.js` is optional. Recommended scope when authored:

| describe | tests |
|---|---|
| `getters return defaults before any setter` | one test per var |
| `setters round-trip the value` | one test per var |
| `setIsPageBlurred coerces to boolean` | `setIsPageBlurred('truthy') → getIsPageBlurred() === true` |
| `increment / decrement` | three steps: 0 → 1 → 2 → 1 |

## Edge cases that matter

- Negative `blurredCount` is allowed (no clamp). Tests should not assume ≥ 0.
- `setCurrentSettings(null)` followed by `getCurrentSettings()` returns `null`, not `{}`.

## Known gaps

None today. The module is small enough that integration tests via the engine cover all paths.
