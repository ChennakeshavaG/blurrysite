# core/observer.js — contract

MutationObserver lifecycle, idle-batched drain, and subscriber pub/sub.

## Module identity

- File: `src/core/observer.js`
- Global: `blsi.Observer`
- Load order: after `marker_engine.js`, before `target_engine.js`.

## Public API

### Observer lifecycle

| Method | Returns | Notes |
|---|---|---|
| `observeRoot(root)` | — | Idempotent. Attaches one MO per root, keyed in a WeakMap so detached shadow roots GC. Observation target is `root.body ?? root`; config `{ childList, subtree, characterData }`. |
| `disconnectObserver(root)` | — | Disconnects + removes the WeakMap entry. |

### Mutation dispatcher

| Method | Returns | Notes |
|---|---|---|
| `subscribeMutations(name, handler)` | — | `handler(MutationRecord[], root)` fired in registration order during the engine idle drain. Single subscriber per name (re-registering replaces). Side effect: calls `observeRoot(document)` so the subscriber is guaranteed to receive document mutations even when blur-all and pick-blur-dynamic are both off (idempotent — no-op if already observing). |
| `unsubscribeMutations(name)` | — | Side effect: when the last subscriber is removed AND the engine has no other reason to keep the document MO (`!isPageBlurred && !pickBlurDynamicActive`), disconnects the document observer. Keeps the lifecycle symmetric with `subscribeMutations`. |
| `hasSubscribers()` | `boolean` | True iff at least one subscriber is registered. Used by `engine.js` `handleSite` to decide whether to re-attach the document MO after a `handleMainDocument` teardown when subscribers (e.g. PII detector) still need it. |

### Shadow attach event bridge

| Method | Returns | Notes |
|---|---|---|
| `initShadowAttachListener()` | — | Registers a capture listener for `__blsi_shadow_attached` CustomEvents (dispatched by `main_world_bridge.js` on `attachShadow()` calls). MO does not fire on property assignment, so this is the only path that catches dynamically attached shadow roots. |
| `removeShadowAttachListener()` | — | |

### Orchestrator helpers (used by engine.js)

| Method | Returns | Notes |
|---|---|---|
| `clearPendingMutations(root)` | — | Drops buffered MutationRecord[] for the root being torn down. |
| `clearStampQueueForRoot(root)` | — | Cancels pending idle stamp work for the root. |
| `pushStampQueueItem(item)` | — | Item shape: `{ root, cats, thorough, mode, settings }`. |
| `scheduleStampIdle()` | — | No-op if an idle is already pending. |

## State

| Var | Type | Notes |
|---|---|---|
| `_observers` | `WeakMap<root, MutationObserver>` | Auto-GC. |
| `_stampQueue` | `Array<{ root, cats, thorough, mode, settings }>` | Drained in `requestIdleCallback`. Replaced (not appended) on every reconcile by orchestrator. |
| `_pendingMoNodes` | `Node[]` | Drained per idle. |
| `_subscribers` | `Map<string, fn>` | Insertion-order preserved. |
| `_pendingMutations` | `Map<root, MutationRecord[]>` | Cleared each idle. |
| `_stampIdlePending` / `_moIdlePending` | `boolean` | Single-flight idle gates. |
| `_shadowAttachHandler` | `function \| null` | Capture listener reference. |

## Cross-module dependencies

| Direction | Modules |
|---|---|
| Reads (at MO callback time) | `blsi.EngineState.{getIsPageBlurred, getPickBlurDynamicActive, getPickerActive, getCurrentSettings}`; `blsi.MarkerEngine.{stampElements, tryBlurTextCheck}`; `blsi.CssManager.injectRules`; `blsi.TargetEngine.tryPickBlurNode`; `blsi.Engine.{handleShadowRoot, handleIframe}` (looked up at call time so observer can load before engine.js) |
| Inbound calls | `engine.js` `handleMainDocument` / `handleShadowRoot` / `teardown`; `pii_detector.js` (via `Engine.subscribeMutations`) |

## Edge cases

- **Picker active gate**: when picker is open, the engine drain is suppressed but subscriber dispatch still fires. PII detector relies on this to keep wrapping typed text during picker mode.
- **Subscriber error isolation**: every subscriber call is `try/catch`-ed; one bad subscriber can't stall others. Errors land on `blsi.Logger.scope('engine').error('subscriber error', name, err)`.
- **Ancestor-coverage filter**: nodes whose subtree is already covered by an ancestor in the same batch are dropped before stamping. Prevents double-walking when a SPA inserts a container in one MO tick and its children in another before the idle fires.
- **Engine inactive sweep**: when both blur-all and pick-blur are off, the engine drain discards the node buffer for that idle tick (no stamping happens) but subscriber dispatch still runs.
- **Lazy facade lookup**: `blsi.Engine` is read inside the MO callback / stamp drain at call time — `engine.js` loads after observer in manifest order, so the global does not exist at observer's IIFE init.
- **Subscribe-driven document MO**: `subscribeMutations` attaches the document MO so subscribers (e.g. PII detector) receive mutations even when blur-all and pick-blur are both off. `unsubscribeMutations` disconnects it only if the engine has no other reason to keep it. Without this, a PII-only configuration would never see late-loading content because no caller would attach the MO.

## Why this module exists (Why)

One MO per root is the only correct design (per-shadow-root coverage), but the buffering, idle-drain coordination, and pub/sub are subtle. Owning all of it in one module keeps invariants close: the MO callback, the buffers it writes, and the drain that reads them are all in one file.

## How to apply (How)

- Adding a new subscriber: call `Observer.subscribeMutations('module-name', handler)` from `content_script.js` after the dependent module is enabled. Unsubscribe symmetrically on disable.
- Adding work to the engine drain: extend `_drainMoIdle`'s engine-drain branch. Keep the gate (`engineActive`) and the picker-active suppression intact.
- Changing observer config: update `obs.observe(target, …)` and re-test PII detector + late-loading dynamic pick-blur paths (both depend on `characterData: true`).
