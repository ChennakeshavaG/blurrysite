# core/observer.tests.md

Test contract for `tests/unit/core/observer.test.js` (planned).

## Coverage map

| Section / describe | What it asserts |
|---|---|
| `observeRoot / disconnectObserver` | Idempotent attach; per-root WeakMap entry; observation target is `root.body ?? root`. |
| `subscribeMutations / unsubscribeMutations` | Single subscriber per name (re-register replaces); insertion order preserved. |
| `MO callback gates` | `pickerActive=true` suppresses engine drain; subscriber dispatch still runs while picker open. |
| `Engine drain` | Ancestor-coverage filter drops nested nodes; calls `MarkerEngine.tryBlurTextCheck` for blur-all; `TargetEngine.tryPickBlurNode` for dynamic pick-blur; recurses into shadow roots + iframes via `Engine.handleShadowRoot` / `handleIframe`. |
| `Subscriber dispatch` | Buckets per root; clears `_pendingMutations` after dispatch; subscriber error in one handler doesn't stall others (caught + logged). |
| `clearStampQueueForRoot / clearPendingMutations` | Used by orchestrator teardown — drops items / records for the torn-down root only. |
| `Shadow attach listener` | Capture-phase `__blsi_shadow_attached` event; only fires when `EngineState.isPageBlurred` is true. |

## Edge cases that matter

- Engine inactive (blur-all OFF, pick-blur OFF, no subscribers): MO callback returns early without buffering.
- Engine inactive but subscribers exist: subscriber dispatch still runs even though engine drain is skipped.
- `_facade()` returns `null` if `blsi.Engine` not yet loaded — callbacks gracefully skip facade calls. Important for tests that don't load engine.js.

## Known gaps

- No timing test for idle-callback batching under fake timers.
- No regression test for the "stale stamp queue cleared on teardown" path.
