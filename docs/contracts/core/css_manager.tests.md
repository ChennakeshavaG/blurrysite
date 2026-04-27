# core/css_manager.tests.md

Test contract for `tests/unit/core/css_manager.test.js` (planned — extraction of CSS-related groups from `tests/unit/engine.test.js`).

## Coverage map (currently inside engine.test.js)

| Section / describe | What it asserts |
|---|---|
| `injectRules / blur modes` | Each mode (gaussian, frosted, redacted, censored) emits the expected CSS — filter / background / font-family declarations and the EXCLUDE chain. |
| `injectRules / category toggles` | Each category-on/off combination produces the right tag selector list. |
| `injectRules / shadow root` | `injectRules(shadowRoot, …)` lands the `<style>` inside the shadow root. |
| `removeRules / isBlurAllActive` | Round-trip: inject → active=true → remove → active=false. |
| `injectPickBlurRules` | `'frosted'` and `'color'` modes; `'blur'` is a no-op (static content.css covers it). |
| `injectPiiRules` | All four modes (`'blur'`, `'frosted'`, `'redacted'`, `'starred'`); reveal override comes after blur rule. |
| `getSelectors` | Cache hit on identical category fingerprint; rebuild on miss. |
| `ensureSvgFilter` | Replaces existing filter; works for shadow root container. |

## Edge cases that matter

- `EXCLUDE` chain regression: every always-blur tag selector includes `:not([data-bl-si-pii])`, `:not([data-bl-si-pick-blur])`, `:not([data-bl-si-reveal])`. Adding a competing blur system means adding a `:not(...)` to this chain.
- `getLastSelectorCache` returns `null` before any `getSelectors` call. `MarkerEngine.isBlurred` must guard.

## Known gaps

- No standalone test for `ensureSvgFilter` element shape (filter children, attribute values). Currently exercised indirectly via frosted-mode injection tests.
- No drift detection between `EXCLUDE` and the stamping guard set in `marker_engine.js`. Both must be updated together when adding a new attribute-based blur system.
