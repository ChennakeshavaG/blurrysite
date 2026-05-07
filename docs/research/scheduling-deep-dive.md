# Scheduling Deep-Dive — `requestIdleCallback` Internals, Repo Audit, and Migration Plan

> Sibling of `docs/research/scheduling-alternatives.md` (the surface-level summary).
> This is the long-form version: how rIC actually works, every call site in this repo,
> deep mechanics of every alternative, and a side-by-side comparison feeding a phased plan.
> Date: 2026-05. Scope: Chrome + Firefox MV3 (no Safari target).

---

## Part I — How `requestIdleCallback` Actually Works

### I.1 The spec algorithm

Per the W3C `requestIdleCallback` spec:

1. **Queue the callback.** `requestIdleCallback(fn, { timeout })` appends `fn` to the document's *list of idle request callbacks* with a fresh handle. If `timeout > 0`, also queue a parallel "timeout task" that schedules forced invocation after `timeout` ms.
2. **Idle period start.** Defined as "user agent determined." The spec gives the UA total freedom: it *may* delay the period for power, *may* skip it entirely, *may* end it early.
3. **Compute deadline.** When the UA decides to start an idle period, it picks an end time. The spec only normatively states `deadline ≤ now + 50 ms`. Chromium's implementation uses `min(next_vsync, 50 ms)` — the deadline is whichever comes first: the next predicted frame boundary or 50 ms from now. For a 60 Hz display with a frame currently in progress, this is typically 5–15 ms; on a fully idle page Chrome will hand out the full 50 ms.
4. **Invoke callbacks.** For each callback queued *before this idle period started*, call `fn(deadline)` with `deadline.timeRemaining()` returning `max(0, end - now)` and `deadline.didTimeout = false`. The spec is explicit: callbacks queued *during* the current idle period are deferred to the next one. This is what enables the "self-reschedule" pattern observer.js uses.
5. **Forced timeout fire.** If the parallel timeout task fires before any idle period, invoke the callback with `deadline.timeRemaining() === 0` and `deadline.didTimeout = true`. Idle and timeout fires race — whichever happens first cancels the other.

> **The spec language is deliberately weak.** Phrases like "user agent may," "implementation defined," and "should be initially empty" appear throughout. Two browsers can both be spec-compliant while behaving very differently. Chrome's heuristic (frame-budget + 50 ms cap) is documentation, not specification.

### I.2 Where rIC sits in the event loop (Chromium)

Per `third_party/blink/renderer/core/scheduler/idle_deadline.cc` and the rendering pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│  Frame N                                                    │
├─────────────────────────────────────────────────────────────┤
│  1. process input events       (highest priority queue)     │
│  2. run rAF callbacks          (visual updates)             │
│  3. style + layout             (browser internal)           │
│  4. paint + composite          (browser internal)           │
│  5. INTER-FRAME IDLE WINDOW   ← rIC fires HERE              │
│      timeRemaining = next_vsync - now, capped at 50 ms      │
│  6. timer callbacks (setTimeout) — if budget left           │
│  7. microtasks                  (run after every task)      │
└─────────────────────────────────────────────────────────────┘
```

Two consequences for our codebase:

- **rIC fires *after* paint, not before.** A DOM write inside an rIC callback dirties layout for frame N+1, not frame N. The user sees the unstamped DOM for one extra frame compared to a sync write or a `MessageChannel.postMessage(null)` task.
- **`timeRemaining` is a *prediction*, not a contract.** Chromium computes it from a moving average of recent frame durations. Heavy GC, layout invalidations, or late-arriving input can blow through the predicted budget. The function will keep returning positive numbers right up until it returns 0.

### I.3 Throttling tiers (Chrome 88+)

This is the part that makes rIC unreliable for "must-eventually-run" work. Chrome chains three tiers based on tab visibility and recent activity:

| Tier | Triggers when | rIC effect |
|---|---|---|
| **No throttling** | Page visible, OR audio played in last 30 s | rIC fires per spec; idle periods normal |
| **Standard throttling** | Page hidden < 5 min, OR chain count < 5, OR WebRTC active | rIC backed by 1 Hz "wake-up" — callback runs at most ~1× per second; if `timeout` set, can preempt |
| **Intensive throttling** | Page hidden ≥ 5 min AND chain count ≥ 5 AND silent ≥ 30 s AND no WebRTC | rIC fires at most ~1× per minute |

"Chain count" = how many timers/idle-callbacks chained from each other since the last user input. Crucially, the chained-timer heuristic counts rICs that re-post rICs. Our `_processStampQueue` is exactly that — it self-reschedules. After the 5th hop, throttling kicks in even on a foreground-but-recently-idle tab.

**Exemption list**: open WebSocket, open RTCDataChannel, live MediaStreamTrack, active getDisplayMedia (the screen-share path uses this — but that exemption applies only to the *sharing tab*, not to other tabs in the same browser).

**For Blurry Site this means**: a user enables blur-all on a long-form article, doesn't interact for 5 minutes, then a SPA injects new DOM. Our MO callback buffers the nodes. Our `_runWhenIdle` schedules the drain. The drain may not fire for up to 60 seconds. The user sees unblurred content while reading.

### I.4 DOM-mutation caveats

MDN and the W3C spec both warn against DOM writes in rIC callbacks:

> "Avoid changing the DOM inside your idle callbacks: the time required to perform layout calculations and painting is not included in the timeRemaining()."

Reason: rIC's deadline predicts available time *before* layout/paint. If your callback dirties layout, the cost lands in the *next* frame and isn't reflected in `timeRemaining()`. A 5 ms callback that triggers a 30 ms layout pass will drop the next frame.

We violate this — `_processStampQueue` writes `data-bl-si-blur` attributes that are matched by `[data-bl-si-blur] { filter: blur(...) }` selectors. Each batch invalidates style. In practice it's fine because the layout cost is small (filter is a paint property, not a layout property — the `filter` property is in the "paint" stage, not "layout"). But the principle applies and limits how aggressive we can be in a single chunk.

### I.5 Browser support 2026

| Browser | rIC support | Throttling specifics |
|---|---|---|
| Chrome 47+ | Yes | Three-tier as above |
| Edge 79+ | Yes (Chromium) | Same as Chrome |
| Firefox 55+ | Yes | Less aggressive throttling (no formal "intensive" tier) |
| Safari | **No** (none planned) | n/a |

We don't target Safari. The Safari gap is irrelevant. Our concern is throttling in Chrome (where most users live).

---

## Part II — Repo Audit: Every Scheduling Primitive

This is exhaustive. Every `requestIdleCallback`, `setTimeout`, `requestAnimationFrame`, `Promise.then`, and `queueMicrotask` in `src/` and adjacent paths.

### II.1 `src/core/observer.js:63-69` — `_runWhenIdle(fn)` primitive

```js
function _runWhenIdle(fn) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn, { timeout: 300 });
  } else {
    setTimeout(fn, 0);
  }
}
```

**Two consumers, both inside this same file**:

#### II.1a `_processStampQueue` (observer.js:85-102) — initial stamping

| Aspect | Detail |
|---|---|
| **What it does** | Drains `_stampQueue` (entries: `{ root, cats, thorough, mode }`). Per entry calls `MarkerEngine.stampElements(root, cats, thorough)` — a `querySelectorAll('*')` pass that writes `data-bl-si-blur` attributes. Newly discovered shadow roots are pushed back onto the queue. |
| **Deadline check** | `if (deadline && deadline.timeRemaining() < 1) { _scheduleStampProcessing(); return; }` — yields back when budget runs out. |
| **Re-schedule** | Self-rescheduling via single-flight gate `_stampProcessScheduled`. |
| **Cancellation** | None. Once scheduled, fires unconditionally. No handle stored. |
| **Caller chain** | `Engine.handleSite` → `handleDocument` → `Obs.scheduleStampIdle()`. Also: MO drain when new shadow roots appear (loops back here). |
| **Failure mode** | Stamps don't apply. CSS injection happened synchronously upstream so blur-all rules (tag-based, `p { filter: blur() }`) still work. What breaks: per-element `[data-bl-si-blur]` writes for text-check elements (e.g. `<div>` with text) — these are needed for `isBlurred()` lookups (picker, context-menu unblur) and for elements that match by content rather than tag. |
| **Throttling exposure** | High. Self-rescheduling means chain-count blows past 5 quickly. After 5 minutes hidden, drain rate drops to 1/min. |
| **Tests** | `tests/setup.js:139` synchronous stub; assumed-immediate behaviour permeates `tests/unit/engine.test.js`. |
| **e2e** | `tests/e2e/observer_pipeline.spec.js:171-184` documents that headless Chrome rIC stalls without paint work; tests use `nudgePage()` to force a mutation that wakes the idle queue. |

#### II.1b `_processObservedChanges` (observer.js:186-214) — MO drain

| Aspect | Detail |
|---|---|
| **What it does** | Two phases: (a) engine work — pops nodes from `_engineNodeBuffer`, processes `ENGINE_CHUNK_SIZE = 500` per call, recurses if remainder; (b) subscriber dispatch — calls each subscriber callback with the buffered `MutationRecord[]`. Subscribers include the PII detector. |
| **Deadline check** | **None.** Reads `_engineWorkRemainder`/`_engineNodeBuffer` length but not `deadline.timeRemaining()`. Each chunk is full 500 nodes. |
| **Re-schedule** | Self-rescheduling via single-flight gate `_processScheduled` when `remaining` exists or when buffers are non-empty after dispatch. |
| **Cancellation** | None. |
| **Caller chain** | MO callback `_onMutations` (observer.js:133) → schedules. Engine work + subscriber bus both gated behind this idle. |
| **Failure mode** | Mutation-driven blur lags. Buffered records accumulate. PII subscriber doesn't fire — typed text in contenteditable stays unwrapped. |
| **Throttling exposure** | Same as II.1a. Worse, actually — every MO event re-posts. |
| **Tests** | Same sync stub. `tests/unit/engine.test.js:1657` comment notes "Two awaits flush both" — relies on stub firing synchronously. |

### II.2 `src/pii/pii.js:84` — chunked scan `schedule` variable

```js
var schedule = typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : setTimeout;
_runChunked(walker, 0, enabledTypes, onDone, schedule);
```

| Aspect | Detail |
|---|---|
| **What it does** | Walks `document.body` `TreeWalker(SHOW_ALL)` in chunks of `CHUNK_SIZE = 500` text nodes. Per node: regex match for email/numeric, splits text, wraps matches in `<span data-bl-si-pii>`. |
| **Deadline check** | **Not consulted.** Even with rIC, `_runChunked` ignores the `IdleDeadline`. Always processes a full chunk before yielding. |
| **Re-schedule** | Self-reschedules via stored handle `_chunkedIdleHandle` (pii.js:51). |
| **Cancellation** | `cancelChunkedScan()` (pii.js:114-122) — clears handle via `cancelIdleCallback` (or `clearTimeout` for fallback) and sets `_scanComplete = true`, discards `_pendingMutations`. Called by `content_script.applyState` on PII-disable. |
| **Caller chain** | `content_script.applyState` (line 657) → `PiiDetector.scan(document.body, types, onDone)` → `_runChunked`. Subscription to MO drain (`subscribeMutations('pii', handleMutations)`) is registered *before* the scan so dynamic mutations during chunk gaps are buffered in `_pendingMutations` and replayed on completion. |
| **Failure mode** | PII spans don't appear. User sees raw email/credit-card numbers on the page. Worse than blur-stamp lag because PII is the *whole point* of the feature. |
| **Throttling exposure** | High AND with no deadline check, every chunk is 500 nodes whether the browser is busy or not. On an idle page that's fine; on a page with active script (e.g. analytics, react re-renders), each chunk is potentially a 50 ms long task — INP killer. |
| **Tests** | `tests/setup.js:139` sync stub for default. `tests/unit/pii/pii.test.js:1474-1499` overrides — sets `global.requestIdleCallback = undefined` then uses `jest.useFakeTimers()` to drive `setTimeout` fallback chunk-by-chunk. Validates buffered mutation replay. |

### II.3 `src/content_script.js:659` — initial PII bootstrap

```js
_piiScanIdleHandle = setTimeout(runScan, 0);
```

| Aspect | Detail |
|---|---|
| **What it does** | Defers the *first* call to `PiiDetector.scan` past LCP. `runScan` (line 654) clears the handle then calls `scan(document.body, types, function onDone() {})`. |
| **Deadline check** | n/a (one-shot). |
| **Re-schedule** | None. The chunked scan that `scan()` initiates is II.2. |
| **Cancellation** | content_script.js:640-644 — `if (_piiScanIdleHandle != null) { cancelIdleCallback(_piiScanIdleHandle); ... clearTimeout(_piiScanIdleHandle); }` Note: tries `cancelIdleCallback` *first* even though `_piiScanIdleHandle` came from `setTimeout`. Safe in practice because `cancelIdleCallback(timeout_handle)` is a no-op on integer mismatch in all browsers, but conceptually wrong — should be `clearTimeout` only. |
| **Caller chain** | `applyState` decides PII enabled, schedules. Cancelled on every fresh `applyState` to avoid concurrent scans on rapid settings toggles. |
| **Failure mode** | First-load scan never starts. Subsequent mutations *would* fire `handleMutations`, but `handleMutations` no-ops when `PiiState.getActiveTypes() === null` — and only `scan()` seeds active types. So a never-fired bootstrap permanently disables PII for that load. |
| **Throttling exposure** | Low. `setTimeout(0)` with chain count 1 is in tier-1 (effectively no throttling) until tab is hidden 5 min — even then standard tier 1×/sec is fine for a one-shot. |
| **Tests** | No explicit test. Tests call `PiiDetector.scan()` directly, bypassing the bootstrap. |

### II.4 Adjacent timers (not rIC, but in the scheduling story)

Listed for completeness because the migration plan touches them where relevant.

| Site | File:line | Primitive | Purpose | Cancellation |
|---|---|---|---|---|
| Hover-reveal exit debounce | `src/reveal_controller.js:384, 487` | `setTimeout(_, 50)` | Tolerate cursor jitter on element boundaries | `_hoverExitTimer` cleared on re-enter / destroy |
| Picker badge auto-dismiss | `src/picker.js:107` | `setTimeout(_, 900)` | Show "Mode: …" badge for 900 ms | None — fire-and-forget |
| SPA URL-change debounce | `src/content_script.js:777-795` | `setTimeout(_, 150)` | Coalesce rapid `pushState`/`hashchange` | `_urlChangeTimer` cleared on next event |
| Zone-hover boundary check | `src/reveal_controller.js:361` | `requestAnimationFrame` | Coalesce mousemove → boundary recompute on next frame | Reentry guarded by `_rafPending` flag (no `cancelAnimationFrame` call) |
| Automate toast Promise chain | `src/automate/manager.js:150-158` | `Promise.resolve().then` | Wait for async stop-action provider before showing toast | None |
| Popup blob URL revoke | `popup/popup.js:164` | `setTimeout(_, 1000)` | Free `URL.createObjectURL` after download | None |
| Popup toast hide | `popup/popup_ui.js:28, 49` | `setTimeout(_, 220)` | Toast auto-hide | `_toastTimer` cleared on next toast |

None of these are rIC users. None are migration targets *unless* the same migration replaces `setTimeout` with `scheduler.postTask` for consistency — which I argue against in §V.

### II.5 Test infrastructure

`tests/setup.js:133-140`:

```js
global.requestIdleCallback = (fn) => { fn({ timeRemaining: () => 50 }); return 0; };
global.cancelIdleCallback  = () => {};
```

**Synchronous fire** with `timeRemaining() === 50`. Three implications:

- Every test sees stamp queue + MO drain + PII chunked scan complete in one tick. Tests don't need fake timers.
- `_processStampQueue`'s `deadline.timeRemaining() < 1` guard never trips — it always reads 50. The early-return path is never exercised in unit tests.
- Per-file overrides (e.g. `pii.test.js:1477-1478` which sets `requestIdleCallback = undefined`) only affect their own file because `setup.js` runs once per Jest worker.

`tests/setup.js:142-153` — rAF stub returns incrementing handle but **does not invoke the callback** (comment: "the video blur loop calls requestAnimationFrame recursively, so auto-executing would cause an infinite loop and OOM"). Tests assert that rAF was called, not what it does.

There is **no `scheduler.postTask` or `scheduler.yield` stub today.** Migrating any call site requires adding stubs that match the rIC stub's "fire synchronously" semantics, otherwise a hundred unit tests start failing.

### II.6 e2e behaviour

`tests/e2e/observer_pipeline.spec.js:158-222` — the only place we deal with *real* rIC. Comments document the workaround:

> "Headless Chrome's requestIdleCallback can stall on idle pages, so the test calls `nudgePage()` (a trivial DOM mutation with text content) to give the observer dispatcher an event to drain, which flushes the queue."

This is symptomatic of rIC's biggest failure mode: **on a fully idle page with no paint pressure, idle periods can be infrequent or skipped entirely.** Headless Chrome (no real display, no vsync) makes this worse but it happens in real browsers too on backgrounded tabs.

### II.7 Summary table (rIC sites only)

| # | Site | Deadline used? | Cancellable? | Throttle exposure | User-visible breakage if delayed |
|---|---|---|---|---|---|
| 1 | observer.js stamp queue | Yes (`< 1` ms guard) | No | High (chain count + hidden tab) | Picker/context-menu blur/unblur misses; tag-rule blur still works |
| 2 | observer.js MO drain | **No** | No | High | New DOM nodes don't blur; PII subscriber doesn't fire |
| 3 | pii.js chunked scan | **No** | Yes (`_chunkedIdleHandle`) | High | PII spans don't appear |
| 4 | content_script.js bootstrap | n/a (`setTimeout(0)`) | Yes (`_piiScanIdleHandle`) | Low | First-load PII permanently off until next `applyState` |

Two sites (#2, #3) ignore the deadline — they're idle-scheduled but use a fixed chunk size. That's exactly the workload `scheduler.yield()` is designed for.

---

## Part III — Deep Mechanics of Each Alternative

### III.1 `scheduler.postTask(callback, options)`

#### III.1.a Queue model

Per WICG spec §5.2, each `Scheduler` (one per global) maintains two maps:

- **Static priority task queue map** — keyed by the three priorities. Tasks posted with `{ priority: 'X' }` go here.
- **Dynamic priority task queue map** — keyed by `TaskSignal` instance. Tasks posted with a `TaskSignal` whose priority can change later go here.

The scheduler runs "the oldest, highest-priority runnable task across all maps."

#### III.1.b Effective priority table (the key insight)

Each task has both a *priority* (one of three) and a *continuation* flag (boolean). The two combine into a 6-level effective priority:

| Priority | Continuation? | Effective | Note |
|---|---|---|---|
| `'background'` | false | 0 (lowest) | Fresh background task |
| `'background'` | true | 1 | Continuation of a background task |
| `'user-visible'` | false | 2 | Default `postTask` priority |
| `'user-visible'` | true | 3 | Continuation of user-visible work |
| `'user-blocking'` | false | 4 | Fresh urgent task |
| `'user-blocking'` | true | 5 (highest) | Continuation of urgent work |

A continuation always runs before fresh tasks of the *same* priority. This is what makes `scheduler.yield()` non-starvable — you don't lose your turn by yielding.

#### III.1.c Abort + dynamic priority

`TaskController` extends `AbortController`. Pass `controller.signal` when posting; abort cancels the queued task. `controller.setPriority('user-blocking')` mutates priority of every task posted with that signal still in the queue. Useful for "this background scan just became foreground because the user opened the popup."

#### III.1.d How priorities map to the HTML task model

The spec is deliberately implementation-defined here. Chromium's mapping (per `third_party/blink/renderer/modules/scheduler`):

- `'user-blocking'` → posted to the high-priority task queue, runs ahead of timers and rAF.
- `'user-visible'` → posted to the default task queue, similar to `setTimeout(0)` but without the 4 ms nested clamp.
- `'background'` → posted to the *best-effort* queue, which is the same queue that `requestIdleCallback` uses on Chromium — meaning **`'background'` is subject to the same throttling as rIC**. This is the trap most articles don't mention.

The win for our codebase isn't "no throttling." It's "explicit priority, abort signals, yield continuations, and `'user-visible'` for chunked work that *shouldn't* be throttled."

#### III.1.e Browser support, May 2026

| Browser | First version | Notes |
|---|---|---|
| Chrome | 94 (Aug 2021) | All three priorities + TaskController + TaskSignal + setPriority |
| Edge | 94 | Chromium parity |
| Firefox | 121 (Dec 2023) | Full support |
| Safari | not shipped | None planned |

Realistic install base on Chrome MV3 in May 2026 is ≥ 110. Firefox MV3 minimum is 109; range 109-120 needs polyfill.

### III.2 `scheduler.yield()`

#### III.2.a Continuation queue mechanics

`await scheduler.yield()` does three things:

1. Wraps the current async function's continuation as a "scheduler task" with `isContinuation = true`.
2. Inherits priority from the surrounding `postTask` (or `'user-visible'` if called outside one).
3. Yields control back to the event loop.

When the scheduler picks the next task, the continuation has effective priority = base + 1 (per the table above). It runs before any fresh task of the same nominal priority that was queued during the yield.

#### III.2.b Worked example (the part that matters)

```js
// Two unrelated user-visible jobs, posted at the same time.
scheduler.postTask(async () => {
  console.log('A1');
  await scheduler.yield();
  console.log('A2');
});
scheduler.postTask(() => console.log('B'));
```

Output order: `A1`, `A2`, `B` — not `A1`, `B`, `A2`. The continuation `A2` has effective priority 3; the fresh task `B` has effective priority 2.

Compare with `setTimeout(0)`:

```js
setTimeout(async () => {
  console.log('A1');
  await new Promise(r => setTimeout(r, 0));
  console.log('A2');
}, 0);
setTimeout(() => console.log('B'), 0);
```

Output: `A1`, `B`, `A2`. The continuation joins the back of the timer queue.

For our chunked PII scan, this means: yielding mid-scan won't lose our place behind unrelated extension-side `postTask`s. We don't have many such tasks today, but it's a nice property.

#### III.2.c What yield does NOT give you

- It does **not** detect input pressure. You still have to choose when to call it. Yielding too often (every chunk) costs ~250 µs per yield (allocation + queue traversal). Yielding too rarely defeats the point.
- It does **not** inherit signal/abort by default in the polyfill (native impl does, polyfill doesn't).
- It does **not** make `'background'` work less throttled. Continuation + throttling are orthogonal.

#### III.2.d Common anti-pattern

Chrome's docs (and the WICG explainer) flag this:

```js
// WRONG — only yields when input is *already* pending
while (work.length) {
  process(work.shift());
  if (navigator.scheduling.isInputPending()) await scheduler.yield();
}
```

Problem: between two `isInputPending()` checks, input arrives but doesn't get dispatched until after the next chunk. Better:

```js
// Yield on time budget; isInputPending only as an EARLY trigger.
let chunkStart = performance.now();
while (work.length) {
  process(work.shift());
  const now = performance.now();
  const inputPending = navigator.scheduling
    && navigator.scheduling.isInputPending
    && navigator.scheduling.isInputPending();
  if (inputPending || now - chunkStart > 5) {
    await scheduler.yield();
    chunkStart = performance.now();
  }
}
```

5 ms is the target — keeps every chunk well under the 50 ms long-task threshold even with worst-case GC.

#### III.2.e Browser support, May 2026

| Browser | First version |
|---|---|
| Chrome | 129 (Sep 2024) |
| Edge | 129 |
| Firefox | 142 (preffed on by default; pref `dom.enable_web_task_scheduling`) |
| Safari | not shipped |

Below these versions the polyfill stands in (with the limitation that polyfilled continuations don't inherit priority — they're always `'user-visible'`).

### III.3 `navigator.scheduling.isInputPending()`

#### III.3.a What it actually queries

Chromium implementation (`InputEventQueue::HasPendingInputEvents`) checks the renderer's input event queue without flushing. The check is synchronous and fast (~50-200 ns per call per Chromium benchmarks; effectively a queue-length read).

Default arg: detects only **discrete** events — click, keydown, touchstart. Pass `{ includeContinuous: true }` to also detect mousemove/wheel/pointermove. For our PII scan, discrete-only is correct — we want to yield to a click, not to mouse drift.

#### III.3.b Known limitations

Per Chrome docs:

- **Cross-origin iframes with complex clip/mask CSS** can return false negatives — input events targeting them may not register.
- **Cross-process input** (touch on Android) may have a 1-2 ms latency between input arrival and `isInputPending` returning true.
- **Not a guarantee.** It's a hint. Don't use it as your only yield trigger (see III.2.d).

#### III.3.c API surface change

The function lives at `navigator.scheduling.isInputPending` today but is being moved to `Scheduler.isInputPending` per the spec. As of May 2026, both paths work in Chrome but the `navigator.scheduling` path is "soft-deprecated." Use a feature-detect pattern:

```js
const hasInputPending =
  (typeof scheduler !== 'undefined' && scheduler.isInputPending) ||
  (typeof navigator !== 'undefined' && navigator.scheduling && navigator.scheduling.isInputPending);

function inputPending() {
  if (!hasInputPending) return false;
  return hasInputPending.call(scheduler ?? navigator.scheduling);
}
```

#### III.3.d Browser support

Chromium-only (Chrome 87+, Edge 87+). Not in Firefox, not in Safari. No signal of intent. Treat as **Chromium-only optimisation** — design code paths to gracefully degrade to time-budget-only on Firefox.

### III.4 `MessageChannel.postMessage(null)` — the React/Lit trick

```js
const ch = new MessageChannel();
ch.port1.onmessage = () => doWork();
ch.port2.postMessage(null);
```

#### III.4.a Why it works

`postMessage` queues a task on the **DOM-manipulation task source** (per HTML spec §8.1.6.2), which is *not* the timer task source. Three consequences:

- **No 4 ms clamp.** `setTimeout(_, 0)` is clamped to 4 ms after 5 nested timers (HTML spec §8.6) and to 1 s in some background-throttle states. MessageChannel tasks aren't.
- **Different task queue** means different ordering relative to rendering — DOM-manip tasks can run before or after rAF depending on how the UA orders them.
- **Universal browser support.** Works in Safari too (the only universal "yield to event loop" primitive).

#### III.4.b Where the polyfill uses it

`scheduler-polyfill` uses MessageChannel as the underlying primitive for `'user-visible'` and `'user-blocking'` priorities (and a sliced-time variant for the priority queue). For `'background'` it falls back to rIC. So shipping the polyfill on Chrome-without-native-scheduler gets you no `'user-visible'` throttling — but you'd already be on Chrome 94+ in 2026, so the polyfill rarely fires in our case.

#### III.4.c When you'd reach for it directly

Only if you need universal browser support including Safari, OR if you want to bypass the polyfill's overhead. Neither applies to us — we don't target Safari, and our chunk overhead is dominated by the actual work, not the scheduling primitive.

### III.5 `queueMicrotask` / `Promise.resolve().then`

**Microtasks run within the current task's microtask checkpoint** — i.e. they don't yield to the event loop. They're useful for "do this after the current sync code finishes but before we return to the event loop." Wrong tool for chunking long work.

If we put `await Promise.resolve()` between PII chunks, we'd convert one sync long task into an async long task that *still* blocks input — microtasks have no upper bound on chain length, the task only completes when the microtask queue is drained.

Verdict: **do not use for chunking**. Useful elsewhere (deferred-write coalescing, DOM-batch queueing) but not for the migration.

### III.6 `requestAnimationFrame` for chunked work

Wrong tool. rAF fires *before* paint at ~16.7 ms intervals on a 60 Hz display. Two failure modes:

- **Long chunk** — chunk takes 20 ms, drops the next frame.
- **Idle waste** — chunks always run at 60 Hz cadence even when CPU is fully idle and could process much faster.

rAF is the right tool *only* for visual updates that must commit before paint (our zone-hover boundary detect at `reveal_controller.js:361` is a correct use; PII scanning would not be).

### III.7 Page Visibility API as a complement

`document.visibilityState` and the `visibilitychange` event let us *proactively* pause idle work when the tab is hidden, defeating throttling by simply not posting tasks in the background. Pairs well with any of the above primitives:

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') taskController?.abort();
  else if (resumeNeeded) restart();
});
```

We don't do this today. Doing so could *avoid* the throttling discussion entirely for the stamp queue: pause when hidden, resume on visible, never feel the 1/min penalty. Trade-off: a tab hidden for 5 minutes that gets a flood of mutations queues all of them up; on resume, we drain a large backlog. Acceptable for our workload (DOM stamping is cheap).

### III.8 Polyfill internals (`@google-chrome/scheduler-polyfill`)

- ~2 KB minified+gzip. Apache 2.0. UMD bundle vendorable as IIFE.
- `postTask`: maps `'user-blocking'/'user-visible'` → MessageChannel; `'background'` → `requestIdleCallback` (or `setTimeout(0)` if rIC absent).
- `yield`: implemented as `await postTask(continuationFn, { priority: 'user-visible' })`. **Continuations don't inherit priority** in the polyfill (vs native).
- `TaskController`: full impl of abort + setPriority. Priority change re-queues pending tasks.
- `isInputPending` is **not** polyfilled — it has no portable shim.

For Firefox 109-120 (pre-native), the polyfill gives us `postTask` correctness but priority ordering is best-effort. For Chrome with native (≥ 94), the polyfill is a no-op (it detects `self.scheduler` and bails).

---

## Part IV — Research vs Code: Per-Site Comparison

This part directly addresses the user's ask: what does the research tell us vs what each code site needs.

### IV.1 Site → Requirement → Best Tool matrix

| Site | What the site needs | What rIC delivers | What `postTask` delivers | What `yield` delivers | What `isInputPending` adds | Recommended |
|---|---|---|---|---|---|---|
| **observer.js stamp queue** (II.1a) | Drain a queue on idle. Yield to user input. Eventually run even on hidden tabs. Cancel-friendly. | Gives idle deadline. Misses throttling cap; uncancellable; chained. | `'background'` priority + `TaskController.signal` for abort. **Same throttle envelope as rIC** on Chrome. | If we make the loop async, yield-on-deadline lets us run as `'user-visible'` between chunks (no throttling) while overall posting at `'background'` (throttled) — best of both. | Detect input early. Optional. | **`postTask({priority:'user-visible'})` + `await scheduler.yield()` per 5 ms** + abort via TaskController. Drop `'background'` — we want responsiveness, not lowest priority. |
| **observer.js MO drain** (II.1b) | Same as II.1a but kicked off by MutationObserver. Currently runs at full chunk regardless of main-thread load. | Same. | Same. | Same. | Same. | Same as II.1a. Bonus: deadline check (`< 1 ms`) becomes `now - chunkStart > 5`. Currently absent — a bug we'd fix in passing. |
| **pii.js chunked scan** (II.2) | Walk a TreeWalker. Yield to input mid-scan. Cancellable. Survive long pages without blowing INP. | `setTimeout` fallback runs full 500-node chunks regardless of load — long-task violations on heavy pages. | `'user-visible'` posting + abort signal replaces `_chunkedIdleHandle`. | `await scheduler.yield()` between chunks gives non-starvable continuations. | High value here — discrete input (typing) should preempt chunks. | **`postTask({priority:'user-visible'}) + await scheduler.yield() with isInputPending() early-trigger`**. Replace `CHUNK_SIZE` (500) with a 5 ms time budget per chunk. |
| **content_script.js bootstrap** (II.3) | One-shot defer past LCP. Cancellable. | n/a — uses `setTimeout(0)`. | Equivalent to `setTimeout(0)`, gains TaskController abort. | n/a (one-shot). | n/a. | **No change.** Migration is cosmetic. Optional — only do it if we ship the polyfill anyway and want unified abort surface. |

### IV.2 Why I changed the recommendation from the previous doc

The previous doc (`scheduling-alternatives.md`) recommended `'background'` for the observer call sites. That was wrong. `'background'` on Chromium uses the same idle queue as rIC and inherits the same throttling. The whole point of migrating off rIC for those sites is to escape throttling-induced lag on backgrounded tabs and on chained-timer pages.

**Use `'user-visible'`** for the stamp + MO drain. The work is small per chunk (≤ 5 ms with yields), it's user-relevant (blur application), and it should not be deferred indefinitely.

Use `'background'` only for work where a 60-second delay during heavy idle throttling would be acceptable. We have no such work currently — even the PII scan is user-relevant in real-time.

### IV.3 What the research did NOT change

- **Don't migrate the bootstrap (II.3).** `setTimeout(0)` is correct. `postTask` adds no value.
- **Don't touch the unrelated timers in II.4.** They're UX timers, not work timers. Different domain.
- **Don't introduce `requestAnimationFrame` for any chunked work.** The current rAF use (zone-hover boundary detect) is the only correct rAF use in the codebase.
- **Don't use `queueMicrotask`/`Promise.resolve().then` as a yield primitive.** Microtasks don't yield to the event loop.

---

## Part V — Migration Plan

Phased so each phase ships independently, can be reverted independently, and produces an observable improvement.

### Phase 0 — Baseline measurement (½ day)

**Goal**: numbers before we touch anything, so we can measure the migration's effect.

Steps:
1. Add a debug-only `PerformanceObserver({ type: 'longtask' })` in `content_script.js` behind the existing `blsi.Logger` debug toggle.
2. Run the manual perf scenarios (`docs/perf/blur-reveal-audit.md` lists them — long-form article, GitHub diff, Gmail thread).
3. Record: count of long tasks > 50 ms during initial blur application; count during typing while PII is on; INP from `event-timing` PerformanceObserver.
4. Capture a CPU profile per scenario.

Gate for Phase 1: have a baseline doc at `docs/perf/scheduling-baseline-2026-05.md` with numbers.

### Phase 1 — Add scheduler abstraction + test stubs (½ day)

**Goal**: have a single seam to switch between native scheduler, polyfill, and test stub.

Steps:
1. Vendor `scheduler-polyfill` UMD build into `vendor/scheduler-polyfill.js`.
2. Add it as the **first** content_scripts entry in `manifest.json` (Chrome + Firefox manifests).
3. Add `tests/setup.js` stub:
   ```js
   global.scheduler = global.scheduler || {
     postTask: (fn, opts) => {
       if (opts && opts.signal && opts.signal.aborted) {
         return Promise.reject(opts.signal.reason);
       }
       try { return Promise.resolve(fn()); }
       catch (e) { return Promise.reject(e); }
     },
     yield: () => Promise.resolve(),
   };
   global.TaskController = global.TaskController || class {
     constructor() { this.signal = { aborted: false, reason: null, addEventListener: () => {} }; }
     abort(reason) { this.signal.aborted = true; this.signal.reason = reason; }
   };
   ```
4. Add a thin `src/core/scheduling.js` IIFE exposing `blsi.Scheduling`:
   ```js
   const BlurrySiteScheduling = (() => {
     'use strict';
     const hasNative = typeof scheduler !== 'undefined' && scheduler.postTask;
     const hasYield  = typeof scheduler !== 'undefined' && scheduler.yield;
     const hasInputPending =
       typeof navigator !== 'undefined' && navigator.scheduling
       && navigator.scheduling.isInputPending;

     function postTask(fn, opts) {
       if (hasNative) return scheduler.postTask(fn, opts);
       if (typeof requestIdleCallback !== 'undefined' && opts && opts.priority === 'background') {
         return new Promise((resolve, reject) => {
           const handle = requestIdleCallback(() => {
             try { resolve(fn()); } catch (e) { reject(e); }
           }, { timeout: 300 });
           if (opts && opts.signal) {
             opts.signal.addEventListener('abort', () => cancelIdleCallback(handle));
           }
         });
       }
       return new Promise((resolve, reject) => {
         setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, 0);
       });
     }

     async function yieldToBrowser() {
       if (hasYield) return scheduler.yield();
       return new Promise(resolve => setTimeout(resolve, 0));
     }

     function isInputPending() {
       if (!hasInputPending) return false;
       try { return navigator.scheduling.isInputPending(); }
       catch (_) { return false; }
     }

     return { postTask, yield: yieldToBrowser, isInputPending };
   })();
   blsi.Scheduling = BlurrySiteScheduling;
   ```
5. Add to `manifest.json` content_scripts load order between `constants.js` and `content_i18n.js` (early — depended on by observer + pii).
6. Update `src/CLAUDE.md` Module Globals table and load order section.
7. Write `docs/contracts/core/scheduling.md`.

Gate for Phase 2: green `npm run test:unit` with the new stubs in place but no migration yet.

### Phase 2 — Migrate `pii.js` chunked scan (1 day)

**Highest ROI** (II.2 — long sync chunks today, no deadline check, dominant INP impact).

Steps:
1. Replace the `_runChunked` recursion with an async loop:
   ```js
   async function _runChunked(walker, enabledTypes, controller) {
     let total = 0;
     let chunkStart = performance.now();
     let node;
     while ((node = walker.nextNode())) {
       if (controller.signal.aborted) return total;
       total += _processTextNode(node, enabledTypes);
       if (blsi.Scheduling.isInputPending() || performance.now() - chunkStart > 5) {
         await blsi.Scheduling.yield();
         chunkStart = performance.now();
       }
     }
     return total;
   }
   ```
2. Replace `_chunkedIdleHandle: number` with `_scanController: TaskController`.
3. `cancelChunkedScan()` becomes `_scanController?.abort()`.
4. `scan(rootEl, types, onDone)` becomes:
   ```js
   const controller = new TaskController({ priority: 'user-visible' });
   _scanController = controller;
   blsi.Scheduling.postTask(async () => {
     try {
       const total = await _runChunked(walker, enabledTypes, controller);
       _scanComplete = true;
       /* drain _pendingMutations as today */
       onDone(total);
     } catch (e) {
       if (controller.signal.aborted) return;
       throw e;
     }
   }, { priority: 'user-visible', signal: controller.signal });
   ```
5. Remove `CHUNK_SIZE = 500` constant. Replace docs reference in `docs/contracts/pii/pii.md` with the time-budget pattern.
6. Update `tests/unit/pii/pii.test.js`:
   - The override at line 1474-1499 (sets `requestIdleCallback = undefined`) needs replacement. New pattern: stub `scheduler.yield` to return a resolved promise; use `await flush()` between chunks.
   - Add tests: abort mid-scan via `controller.abort()`, verify `onDone` not called.
7. Update `docs/contracts/pii/pii.md` and `docs/contracts/pii/pii.tests.md`.

Acceptance:
- Long tasks > 50 ms during initial PII scan on 5k-node test page drop from baseline by ≥ 80%.
- Typing in contenteditable mid-scan: max keypress-to-paint latency drops measurably.
- Test coverage stays ≥ 91% on pii.js.

### Phase 3 — Migrate `observer.js` `_runWhenIdle` (1 day)

**Second-highest ROI** (II.1a + II.1b together — same primitive, two consumers).

Steps:
1. Replace `_runWhenIdle(fn)` with async-friendly variant:
   ```js
   function _runWhenIdle(fn) {
     blsi.Scheduling.postTask(fn, { priority: 'user-visible' });
   }
   ```
2. `_processStampQueue` becomes async and yields between roots:
   ```js
   async function _processStampQueue() {
     _stampProcessScheduled = false;
     let chunkStart = performance.now();
     while (_stampQueue.length > 0) {
       const { root, cats, thorough, mode } = _stampQueue.shift();
       const newShadowRoots = blsi.MarkerEngine.stampElements(root, cats, thorough);
       for (const sr of newShadowRoots) {
         blsi.CssManager.injectRules(sr, cats, mode);
         observeRoot(sr);
         _stampQueue.push({ root: sr, cats, thorough, mode });
       }
       if (blsi.Scheduling.isInputPending() || performance.now() - chunkStart > 5) {
         await blsi.Scheduling.yield();
         chunkStart = performance.now();
       }
     }
   }
   ```
3. `_processObservedChanges` similarly — async + yield. Add the deadline check that's currently *absent* (see II.1b — bug fixed in passing).
4. Update `docs/contracts/core/observer.md` (especially the `_stampQueue` row in the state table — drop "Drained in `requestIdleCallback`" wording).
5. Update `docs/perf/blur-reveal-audit.md` references to rIC.

Acceptance:
- `tests/e2e/observer_pipeline.spec.js` passes without the `nudgePage()` workaround (because `'user-visible'` doesn't depend on idle periods).
- Backgrounded-tab stamp lag (manual test: enable blur on Wikipedia, switch tabs for 6 min, return) — measurably better. Subjective but observable.

### Phase 4 — Visibility-aware proactive pause (½ day, optional)

Defeat throttling by not posting work in the background.

Steps:
1. In `core/scheduling.js`, expose a `pauseUntilVisible()` helper.
2. In `engine.handleSite`, listen `visibilitychange` once; on `'hidden'` abort the scan controller; on `'visible'` re-call `applyState`.
3. In `pii.scan`, check `document.visibilityState` before scheduling — if hidden, defer registration and re-schedule on `visible`.

Skip if Phase 2 + 3 acceptance criteria already met. This is belt-and-braces.

### Phase 5 — Bootstrap migration (II.3) (skip)

Don't migrate. `setTimeout(0)` is fine. Bikeshed. Do it only if a future PR is already touching `applyState` and wants unified abort semantics.

### Phase 6 — Telemetry follow-up (½ day)

Re-run Phase 0 measurements after Phase 2 + 3. Append to `docs/perf/scheduling-baseline-2026-05.md`. Decide on Phase 4.

### Total effort

~3 days for Phase 0 + 1 + 2 + 3 + 6. Phase 4 optional (+ ½ day). Phase 5 skip.

### Roll-out

- Land Phase 1 alone (no behaviour change, just plumbing) so the polyfill ships and we get crash data before any logic change.
- Wait one stable release.
- Land Phase 2 (PII first — easier to revert, smaller blast radius — content-script-only, no observer-pipeline changes).
- Wait one stable release.
- Land Phase 3.

### Revert plan

Each phase is one PR. Each PR can be reverted by `git revert` cleanly because the seam (`blsi.Scheduling`) lets call sites reference one module — no callers update during a revert.

---

## Part VI — Risks, Open Questions, Decision Log

### VI.1 Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Polyfill priority ordering wrong on Firefox 109-120 (~0.5% of FF MV3 users in 2026) | Low | Polyfill's MessageChannel-based ordering is correct enough for our workload; we don't depend on strict priority ordering between unrelated tasks |
| 2 | Sync test stub for `scheduler.yield` returns resolved promise — ordering differs from native (continuations skip the queue check entirely in tests) | Medium | Document explicitly in `tests/CLAUDE.md`. Add e2e test that exercises yield ordering with real Chrome. |
| 3 | `'user-visible'` posting could compete with rendering on a paint-heavy page (CSS animations, video) | Low-Medium | Time-budget kept at 5 ms per chunk well below the 16.7 ms frame budget. If observed, easy fix: drop to `'background'` for the stamp queue and accept the throttling. |
| 4 | `isInputPending()` returns false negatives in cross-origin iframes — typing in an embedded form may not preempt the scan | Low | We only call from main frame (PII scan is main-frame-bound today). Document; revisit if iframe support added. |
| 5 | Existing tests that mock `requestIdleCallback` will misalign with new code paths | High during migration | Phase 1 includes the new stub before any migration. Phase 2/3 each refresh the per-file test setup. |
| 6 | TaskController's signal is abort-only — no "pause and resume" — so visibility pause requires a new controller per resume | Low | Design `pauseUntilVisible` to issue a fresh controller; no API gap. |

### VI.2 Open questions

1. **Should `observer.js` MO drain split engine work and subscriber dispatch into separate `postTask` calls with different priorities?** Engine work (stamping) is `'user-visible'`. Subscriber dispatch (PII detector) is also `'user-visible'`. They could run in any order. Decision: keep them coupled in the same task for now — splitting adds complexity without clear win.

2. **Is `isInputPending()` worth the feature-detect indirection given Chromium-only support?** Decision: yes — the call is cheap (~100 ns) and the responsiveness win during heavy typing is measurable. Falls back to time-budget on Firefox.

3. **Polyfill or no polyfill for Chrome 94+ / Firefox 121+?** Polyfill ships ~2 KB and detects native at runtime (no-ops on supported browsers). Cost is ~2 KB content script size. Decision: ship the polyfill — the added safety on the long tail of versions outweighs 2 KB.

4. **Do we wire up the abort signal for `observer.js` callers?** Today nothing aborts the stamp drain. Decision: not in the migration. Wire abort *if and when* we add visibility-aware pause (Phase 4).

5. **Should we deprecate the `requestIdleCallback` test stub immediately or leave it for fallback paths?** Decision: leave it. Some code paths still hit `setTimeout` fallback (the polyfill's own internals) and the rIC stub is still observed by anything that polyfills against it.

### VI.3 Decision log

| Decision | Rationale | Alternative |
|---|---|---|
| Use `'user-visible'` not `'background'` for stamp + MO drain | `'background'` shares rIC's throttling on Chromium — defeats the migration goal | Stick with `'background'` and accept throttling — but then why migrate? |
| Use 5 ms time budget per chunk | Half the 50 ms long-task threshold; absorbs GC jitter | 10 ms — more throughput, more INP risk; 1 ms — too many yields, overhead dominates |
| Yield via `scheduler.yield()` not `await new Promise(setTimeout)` | Continuation runs ahead of fresh tasks of same priority — non-starvable | Bare `setTimeout(0)` — works but loses ordering; behind unrelated extension tasks |
| Use `isInputPending()` as early-yield trigger, not as sole condition | WICG explainer flags sole-condition use as anti-pattern (input may arrive between checks) | Skip `isInputPending` entirely and yield purely on time budget — works on Firefox, slightly worse on Chrome under heavy typing |
| Skip `setTimeout(0)` → `postTask` migration for the PII bootstrap | Bikeshed; no observable improvement | Do it for surface-uniformity — optional cleanup PR |
| Ship `scheduler-polyfill` to all browsers including Chrome 94+ / FF 121+ | 2 KB cost; native is detected and polyfill no-ops; long-tail safety | Don't ship — saves 2 KB; risks breakage on outlier browser versions |

---

## Part VII — Appendix

### VII.1 Quick reference: which API for which job

| Job | API | Why |
|---|---|---|
| Run a callback when main thread is idle | `postTask({priority:'background'})` | Explicit priority; Chromium routes to the same idle queue as rIC; abortable |
| Run a callback as soon as event loop is free, with priority over other queued work | `postTask({priority:'user-blocking'})` | Effective priority 4 — beats timers, rAF, normal tasks |
| Run a callback as soon as event loop is free, default priority | `postTask({priority:'user-visible'})` | Effective priority 2 — replaces `setTimeout(0)` cleanly |
| Yield mid-task and resume before any newly-queued same-priority work | `await scheduler.yield()` | Effective priority +1 vs fresh tasks |
| Defer work past LCP | `setTimeout(0)` | Simple, cancellable, no library |
| Yield to user input mid-loop | `await scheduler.yield()` triggered by 5 ms budget OR `isInputPending()` | Best INP profile |
| Visual work that must commit before paint | `requestAnimationFrame` | Frame-aligned |
| Do something after current sync code, no event-loop yield | `queueMicrotask` | Drains within current task |
| Universal "yield to event loop" no library | `MessageChannel.postMessage(null)` | No 4 ms clamp; works in Safari |

### VII.2 Glossary

- **Long task**: per the Long Tasks API, any task that occupies the main thread for > 50 ms.
- **INP** (Interaction to Next Paint): Core Web Vital measuring the worst-case latency between user input and the next visual update during the page lifetime.
- **Continuation**: in scheduler-API parlance, a task whose body is the resumption of an `await scheduler.yield()` — flagged with `isContinuation = true` and given a +1 effective priority.
- **Chain count**: per Chrome 88 timer-throttling docs, the number of nested timers/idle-callbacks that scheduled each other since the last user input. Reaches 5 → enters standard throttling tier.
- **Idle period**: per W3C `requestIdleCallback` spec, a window the UA grants between rendering steps for low-priority work. Length capped at 50 ms.

### VII.3 References

#### Specifications
- [W3C `requestIdleCallback` spec](https://w3c.github.io/requestidlecallback/)
- [WICG Prioritized Task Scheduling spec](https://wicg.github.io/scheduling-apis/)
- [WICG yield-and-continuation explainer](https://github.com/WICG/scheduling-apis/blob/main/explainers/yield-and-continuation.md)
- [WICG isInputPending spec](https://wicg.github.io/is-input-pending/)
- [HTML spec — task sources and timer clamping](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html)

#### Chrome / browser docs
- [Use `scheduler.yield()` to break up long tasks](https://developer.chrome.com/blog/use-scheduler-yield)
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
- [Better JS scheduling with isInputPending](https://developer.chrome.com/docs/capabilities/web-apis/isinputpending)
- [Heavy throttling of chained JS timers in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [Quick intensive timer throttling of loaded background pages — Chrome Status](https://chromestatus.com/feature/5580139453743104)
- [Chromium IdleDeadline source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/scheduler/idle_deadline.cc)

#### MDN
- [`Window.requestIdleCallback()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
- [`Scheduler.postTask()`](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask)
- [`Scheduler.yield()`](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)
- [`Scheduling.isInputPending()`](https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending)

#### Implementation references
- [`scheduler-polyfill` (GoogleChromeLabs)](https://github.com/GoogleChromeLabs/scheduler-polyfill)
- [Building a Faster Web Experience with the postTask Scheduler — Airbnb](https://medium.com/airbnb-engineering/building-a-faster-web-experience-with-the-posttask-scheduler-276b83454e91)
- [React's MessageChannel scheduling — facebook/react#14234](https://github.com/facebook/react/pull/14234)

#### Adjacent reads
- [Long Tasks API spec](https://w3c.github.io/longtasks/)
- [Page Visibility API spec](https://www.w3.org/TR/page-visibility/)
- [Picking the Right Tool for Maneuvering JavaScript's Event Loop — Alex MacArthur](https://macarthur.me/posts/navigating-the-event-loop/)
