# engine.tests.md

Test contract for `tests/unit/engine.test.js` — facade-level integration coverage for `blsi.Engine`.

## Scope

`engine.test.js` is the integration test suite. It exercises the public facade end-to-end (`handleSite`, `unblurAll`, `applyBlur`, etc.) without reaching into sub-module internals. Sub-module-specific assertions live (or will live, after Task #12) in `tests/unit/core/<module>.test.js` per the contracts under `docs/contracts/core/*.tests.md`.

## Coverage map

The test file mirrors the section markers (`§`) in the source. Run `grep -n "§" tests/unit/engine.test.js` to see the layout.

| Section | What it covers |
|---|---|
| `§CSS-INJECTION-TESTS` | `injectRules`/`removeRules`/`isBlurAllActive` across modes; pick-blur CSS; PII rule injection; reveal cascade overrides; `EXCLUDE` chain regressions. |
| `§STAMP-OBSERVER-TESTS` | `stampElements` (custom elements, ARIA roles, `<slot>` projection, structural-container text gate); `tryBlurTextCheck`; `applyBlur`/`removeBlur` count bookkeeping; `isBlurred`/`isVisuallyBlurred`; `matchesActiveCategories`; `shouldBlurElement`; observer attach via `observeRoot`. |
| `§ITEMS-ZONES-TESTS` | Counters; `applyItem`/`removeItem` for dynamic and sticky; zone overlay anchor (page vs screen); `getZoneOverlays`; popup-hover highlight. |
| `§ORCHESTRATOR-TESTS` | `handleSite` reconcile (active / inactive paths); shadow-root recursion; iframe stamping; teardown; `unblurAll` clears zones; settings-shape happy paths. |
| `mutation dispatcher` | `subscribeMutations` / `unsubscribeMutations` / `hasSubscribers`; subscriber-driven document-MO lifecycle (subscribe attaches, unsubscribe disconnects when no feature still needs the MO); blur-all toggle re-attach when subscribers exist; PII-only-mode regression (no engine-state holds the MO). |

## Test-level invariants

- Source loaded via `MODULE_PATH = '../../src/engine.js'` (post-rename).
- All sub-modules under `src/core/` MUST be loaded first via the `loadEngine()` helper. Order matters — match manifest.
- `beforeEach` clears DOM stamps + injected styles so tests are independent.
- `afterEach` calls `blsi.Engine.unblurAll()` to drop zones + observer state.

## Cross-test load dependencies

| Test file | What it loads from `src/core/` |
|---|---|
| `tests/unit/engine.test.js` | All seven sub-modules + `engine.js` |
| `tests/unit/reveal_controller.test.js` | All seven + `engine.js` (uses `Engine.applyBlur` and `Engine.unblurAll`) |
| `tests/unit/picker.test.js` | Mocks `blsi.Engine` directly — does not load real engine |
| `tests/unit/pii_detector.test.js` | Synthesises MutationRecord[] — does not depend on engine |

## Edge cases that matter

- `handleSite` mutex: concurrent (non-awaited) calls — second is dropped. Tests should `await` every call.
- Reconcile-key short-circuit: changing only `blur_radius` in gaussian mode skips DOM work but still applies CSS vars. Frosted mode rebuilds.
- Extension-disabled path (`enabled: false`) drops items AND zone overlays.

## Known gaps

- No timing test for idle-batched MO drain under fake timers (jsdom synchronous stub avoids).
- No regression test for `_handling` mutex under truly concurrent calls — would need promise interleaving.
- No standalone `ensureSvgFilter` shape test.
- ARIA role coverage limited to FORM (only category with roles today).

## Status — physical test split

`tests/unit/engine.test.js` currently holds the full ~1600-line suite (31 describe blocks). The structural code split (`engine.js` + `core/*`) landed first and tests stayed monolithic to keep the green count locked at 792 across every extraction step.

A physical split into `tests/unit/core/<module>.test.js` is a follow-up cleanup. It is purely a reorganisation: test bodies copy-pasted, only `MODULE_PATH` constants and the `loadEngine()` helper differ per file. Sub-module test contracts (`docs/contracts/core/<module>.tests.md`) already document which describe block belongs where, so the carve-out is mechanical.

Acceptance for the follow-up: total green count must equal exactly 792, and the union of describe-block titles across the new files must equal the original set (use `grep -h "^  describe(" tests/unit/{engine.test.js,core/*.test.js} | sort -u`).
