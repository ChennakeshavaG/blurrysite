# Scheduling Alternatives to `requestIdleCallback`

> Status: research, not yet implemented.
> Scope: Chrome + Firefox MV3 content-script (no Safari target).
> Date: 2026-05.

## 1. TL;DR

The blur engine currently leans on `requestIdleCallback` (rIC) in three places. rIC is the wrong tool in two of them. Modern replacements:

| Call site | Today | Better in 2026 |
|---|---|---|
| `core/observer.js` — stamp queue drain (`_processStampQueue`) | `requestIdleCallback(fn, { timeout: 300 })` + `deadline.timeRemaining() < 1` | `scheduler.postTask(fn, { priority: 'background' })` + `await scheduler.yield()` between chunks |
| `pii/pii.js` — chunked PII scan (`_runChunked`, `CHUNK_SIZE = 500`) | `requestIdleCallback || setTimeout` (no deadline check) | `scheduler.yield()` loop with `priority: 'background'` (and an `isInputPending()` early-yield) |
| `content_script.js` — initial PII scan defer past LCP | `setTimeout(runScan, 0)` | `scheduler.postTask(runScan, { priority: 'background', delay: 0 })` *(or leave as-is — already correct)* |

Net win: lower INP, no rIC background-tab throttling on the engine path, deterministic continuation order, native AbortSignal cancellation. Cost: ~2 KB polyfill (`scheduler-polyfill`) for older Chrome/Firefox, no Safari support either way (extension doesn't target Safari).

---

## 2. Current rIC usage in this repo

Three call sites. Behaviour summary:

### 2.1 `src/core/observer.js:63-69` — stamp queue primitive

```js
function _runWhenIdle(fn) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn, { timeout: 300 });
  } else {
    setTimeout(fn, 0);
  }
}
```

Used by `_processStampQueue` (`observer.js:85-102`). Pulls from `_stampQueue` until `deadline.timeRemaining() < 1`, then re-schedules. Drains both initial document + newly attached shadow roots.

Properties needed:
- Yield to user input (typing, click) before next chunk.
- 300 ms safety timeout — must drain even on a busy page.
- Doesn't matter whether each chunk runs at next paint or 50 ms later — visible blur is already up via CSS injection; this pass only stamps `data-bl-si-blur` for text-check elements.

### 2.2 `src/pii/pii.js:84-112` — chunked PII scan

```js
var schedule = typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : setTimeout;
_runChunked(walker, 0, enabledTypes, onDone, schedule);
```

`_runChunked` walks 500 nodes per tick and re-schedules. **Does not consult `deadline.timeRemaining`** — every chunk processes the full `CHUNK_SIZE` regardless of how busy the main thread is. That's a foot-gun: when `setTimeout` is the fallback, every chunk is a 50 ms+ long task on heavy pages even if the browser had to drop a frame.

### 2.3 `src/content_script.js:659` — initial scan defer

```js
_piiScanIdleHandle = setTimeout(runScan, 0);
```

Already not rIC — used to delay the seed scan past LCP. Cancellable via `clearTimeout`. Functionally fine.

---

## 3. Why rIC is suboptimal

### 3.1 Background-tab throttling

Chrome aggressively throttles rIC in non-foreground tabs:
- Tab backgrounded ≥ 10 s → idle budget; callbacks gated on budget refill.
- Tab inactive ≥ 5 min → timers (incl. rIC fallback paths) capped at **1 fire/minute**.
- Audio playback / WebSocket / WebRTC → exempt (irrelevant for our content-script).

Effect: a user blurs a page, switches tabs, comes back 10 minutes later, and DOM that mutated in the background may not have been stamped. The MO callbacks themselves still fire (they're not gated), but the idle drain that processes them does. We mitigate today by putting CSS injection synchronously and only deferring the stamp pass — so visible blur is correct — but `data-bl-si-blur` attribute presence (used by `isBlurred()` for picker / context-menu paths) can lag.

### 3.2 Post-paint timing + DOM mutations

rIC fires *after* layout & paint. Per spec & MDN: doing DOM writes inside a rIC callback forces a reflow on the next frame. We do exactly this in `_processStampQueue` (`stampElements` writes `data-bl-si-blur` attributes). Today this happens to be cheap because `data-*` writes don't trigger style recalc unless an attribute selector targets the attribute — but `[data-bl-si-blur] { filter: blur(...) }` does target it, so each chunk schedules a style/layout pass. Yielding via `postTask`/`yield` lands the same writes earlier in the next frame's lifecycle (before paint), which is the correct slot for write-then-render.

### 3.3 No priority signal, no abort

rIC has one knob: `timeout`. There's no way to:
- Express "this is low priority — interrupt me if user types" beyond the implicit idle-period gate.
- Cancel a chain of rICs cleanly. We re-implement this with `_chunkedIdleHandle` + `cancelIdleCallback` per call site.

`scheduler.postTask` has explicit `'user-blocking' | 'user-visible' | 'background'` priorities, an `AbortSignal`, and runtime priority changes via `TaskController`.

### 3.4 Unreliable continuation

Per MDN: rIC "may be called several seconds later" without a `timeout`. Even with one, `timeRemaining()` is a hint, not a contract.

`scheduler.yield()` continuations are first in their priority queue — yielding mid-task does **not** lose your place behind unrelated `postTask`s.

---

## 4. The alternatives

### 4.1 `scheduler.postTask(callback, options)`

```js
scheduler.postTask(() => doWork(), {
  priority: 'background',           // 'user-blocking' | 'user-visible' | 'background'
  signal: abortController.signal,
  delay: 0,                         // optional ms before queueing
});
```

- Three explicit priorities; relative ordering is stable per spec.
- `'background'` runs on a dedicated low-priority task queue. Chromium subjects it to visibility-aware throttling similar to rIC's idle-period gating — so background tabs starve `'background'` work — but it does **not** literally call `requestIdleCallback`. `'user-visible'` (the polyfill's `yield` default) is **not** throttled the same way. Picking the priority is the entire point.
- `TaskSignal` extends `AbortSignal` — pass it once, use it for cancel + dynamic priority change.

**Browser support (May 2026)**: Chrome 94+ (Aug 2021), Edge 94+, Firefox 142+ (Aug 2025), Safari ✗.

### 4.2 `scheduler.yield()`

```js
async function drain(items) {
  for (const item of items) {
    process(item);
    if (someCheap_isLong_check()) await scheduler.yield();
  }
}
```

- Returns a promise; resolves on the *next* event-loop turn but with continuation priority **higher** than other queued tasks of the same priority. Inherits priority from the surrounding `postTask` (or defaults to `'user-visible'`).
- Replaces hand-rolled `await new Promise(r => setTimeout(r, 0))` and `requestAnimationFrame` yield tricks. Crucially: `setTimeout(r, 0)` puts the continuation *behind* every queued task, including unrelated work. `yield()` puts it ahead.
- Aimed squarely at INP: any sync chunk > 50 ms should yield.

**Browser support (May 2026)**: Chrome 129+, Firefox 142+, Safari ✗.

### 4.3 `navigator.scheduling.isInputPending()`

```js
while (workQueue.length) {
  process(workQueue.shift());
  if (navigator.scheduling.isInputPending()) {
    await scheduler.yield(); // or postTask continuation
    break;
  }
}
```

- Returns `true` if a user input is queued but not yet dispatched.
- Lets a long task self-yield only when needed — avoids the cost of yielding every chunk on idle pages.
- **Chromium-only** (Chrome 87+). Spec is being absorbed into `scheduler` namespace; `navigator.scheduling.isInputPending` is being deprecated. Treat as Chrome-only optimisation today.

### 4.4 `MessageChannel.postMessage(null)` (the React trick)

```js
const ch = new MessageChannel();
ch.port1.onmessage = doWork;
ch.port2.postMessage(null);    // schedules doWork as a task — no 4ms clamp
```

- Defeats the `setTimeout(_, 0)` minimum-delay clamp (4 ms after 5 nested timers, per HTML spec).
- Universal browser support.
- Pre-`scheduler.postTask` workhorse for React, Lit, others. Now mostly redundant where `scheduler.postTask` is shipped — but it's the polyfill's own `'user-visible'` fallback.

### 4.5 `requestAnimationFrame` chains

Wrong tool here. rAF fires *before* paint, ~16.6 ms apart. Good for animation, terrible for "drain a queue politely" — every rAF chunk competes with style/layout/paint, raising the risk of dropped frames if the chunk overruns 16 ms.

### 4.6 `queueMicrotask` / `Promise.resolve().then(fn)`

Microtasks run before the next task — they do **not** yield to the browser. Using one in a long loop converts a sync long task into an async long task and gains nothing for INP.

### 4.7 Web Workers

Out of scope. Our work is DOM-touching (stamping attributes, mutating PII spans). Workers can't touch DOM. OffscreenCanvas helps for canvas pipelines, none of which we have.

---

## 5. Browser support matrix (May 2026)

| API | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| `requestIdleCallback` | 47+ | 79+ | 55+ | ✗ (no signal of intent) |
| `scheduler.postTask` | 94+ (Aug 2021) | 94+ | 121+ (Dec 2023) | ✗ |
| `scheduler.yield` | 129+ | 129+ | 139+ (Aug 2025) | ✗ |
| `navigator.scheduling.isInputPending` | 87+ | 87+ | ✗ | ✗ |
| `MessageChannel` | universal | universal | universal | universal |

Blurry Site ships Chrome MV3 + Firefox MV3 only. Safari is not a target. Chromium ≥ 94 covers Manifest V3 (MV3 baseline is Chrome 88, but realistic install base is 94+ since MV2 sunset). Firefox MV3 baseline is 109; **the entire Prioritized Task Scheduling API (`postTask`, `yield`, `TaskController`, `TaskSignal`, `TaskPriorityChangeEvent`) shipped together in Firefox 142 on 2025-08-19** — earlier Firefox versions kept it behind a Nightly flag. So Firefox range 109–141 needs the polyfill for the whole surface; from 142 onward both `postTask` and `yield` are native.

---

## 6. Polyfill: `@google-chrome/scheduler-polyfill`

- 100% JS, Apache 2.0, ~2 KB minified+gzip.
- Polyfills `self.scheduler.postTask`, `scheduler.yield`, `TaskController`, `TaskSignal`, `TaskPriorityChangeEvent`. Exposes both `Window.scheduler` and `WorkerGlobalScope.scheduler`.
- Fallback chain: `'background'` → `requestIdleCallback`; `'user-visible'`/`'user-blocking'` → `MessageChannel`; absolute fallback → `setTimeout`.
- Limitations:
  - `'user-blocking'` has no real higher priority on browsers lacking native `scheduler` (degrades to MessageChannel queue).
  - `scheduler.yield` continuations don't inherit priority — they default to `'user-visible'`.
  - On browsers without rIC (Safari), `'background'` becomes `setTimeout` — no idle gating.

For this extension we'd ship the polyfill via `<script src="vendor/scheduler-polyfill.js">` in `manifest.json > content_scripts` ahead of `constants.js`. **MV3 service-worker context** also gets a `self.scheduler` shim — fine, but background.js currently doesn't need scheduling primitives.

> Note: the polyfill is published as an npm package. Since this repo has **no bundler** (vanilla JS, IIFE-only, see `CLAUDE.md`), we'd vendor the minified `dist/scheduler-polyfill.js` into `vendor/` and load it as a normal content script. The polyfill installs onto `self.scheduler` on load — drop-in for vanilla `<script>` usage. (It's an IIFE/global-installer, not technically a UMD wrapper.)

---

## 7. Recommended migration

Do not migrate all three sites in one PR. Order by risk and benefit.

### Phase 1 — `pii/pii.js` chunked scan (highest ROI)

Today's loop runs the full 500-node chunk every tick regardless of main-thread state. Replace `_runChunked` with an async loop that yields based on `isInputPending()` (Chrome) or a 5 ms budget (Firefox/polyfill):

```js
async function _runChunked(walker, enabledTypes, onDone) {
  let total = 0;
  let chunkStart = performance.now();
  let node;
  while ((node = walker.nextNode())) {
    total += _processTextNode(node, enabledTypes);
    const inputPending = navigator.scheduling
      && navigator.scheduling.isInputPending
      && navigator.scheduling.isInputPending();
    if (inputPending || performance.now() - chunkStart > 5) {
      await scheduler.yield();
      chunkStart = performance.now();
    }
  }
  _scanComplete = true;
  onDone(total);
}
```

Cancellation switches from `cancelIdleCallback(_chunkedIdleHandle)` to a `TaskController`:

```js
const controller = new TaskController({ priority: 'background' });
scheduler.postTask(() => _runChunked(walker, types, onDone), { signal: controller.signal });
// later:
controller.abort();
```

Tests already stub `requestIdleCallback` synchronously (`tests/setup.js:139`); we'd add a parallel synchronous stub for `scheduler.postTask`/`yield`.

**Why this site first**: `CHUNK_SIZE = 500` text-node processing is the longest sync block in the engine — exactly the path where `scheduler.yield()` improves INP measurably. Also self-contained (one file, one consumer).

### Phase 2 — `core/observer.js` stamp queue

Replace `_runWhenIdle` with `postTask('background')` + `yield()`. Keep the 300 ms timeout semantics by adding a `setTimeout(controller.abort, 300)` watchdog — though in practice we want the work to *complete*, so a better translation is:

```js
function _runWhenIdle(fn) {
  if (typeof scheduler !== 'undefined' && scheduler.postTask) {
    scheduler.postTask(fn, { priority: 'background' });
  } else if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn, { timeout: 300 });
  } else {
    setTimeout(fn, 0);
  }
}
```

Drain loop converts to async:

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
    if (performance.now() - chunkStart > 5) {
      await scheduler.yield();
      chunkStart = performance.now();
    }
  }
}
```

Risk: tests rely on `requestIdleCallback`'s synchronous stub (`tests/setup.js:139`). Need an equivalent synchronous `scheduler.yield` polyfill in test setup so promise chains resolve in one tick. Existing pattern: `global.scheduler = { postTask: (fn) => Promise.resolve().then(fn), yield: () => Promise.resolve() };`.

### Phase 3 — `content_script.js` initial defer

Lowest priority. `setTimeout(runScan, 0)` is already cheap and cancellable. If we want consistency:

```js
const controller = new TaskController({ priority: 'background' });
_piiScanIdleHandle = controller;
scheduler.postTask(runScan, { signal: controller.signal, delay: 0 });
// cancel:
_piiScanIdleHandle?.abort();
```

But this is bikeshedding — ship if Phase 1 + 2 land cleanly.

---

## 8. MV3 / extension caveats

- **Service worker (`background.js`)**: `self.scheduler` is exposed in service workers (Chrome 94+, alongside the original `postTask` ship) but our background.js has no long tasks today — skip.
- **Content script load order** (`manifest.json`): polyfill must load before `constants.js`. Add to `content_scripts[].js` array as the first entry.
- **MAIN-world bridge** (`main_world_bridge.js`): runs in page context, so it sees the page's own `scheduler` (or lack thereof). Don't ship the polyfill into the MAIN world unless we start using it there.
- **Firefox**: the full Prioritized Task Scheduling API (`postTask` + `yield` + `TaskController` + `TaskSignal` + `TaskPriorityChangeEvent`) shipped together in Firefox 142 on 2025-08-19; earlier versions kept it behind the `dom.enable_web_task_scheduling` Nightly flag. Firefox MV3 minimum is 109. Range 109–141 needs the polyfill. Realistic Firefox install base in May 2026 is 142+, but the polyfill costs ~2 KB so ship it unconditionally for long-tail ESR / older users.
- **CSP**: polyfill is plain JS, no `eval`/`new Function` — works under MV3's default CSP (`script-src 'self'`).

---

## 9. What we deliberately do not change

- **CSS injection** stays synchronous in `handleSite`. The whole point of "blur first, stamp later" is that visible blur appears in the same tick as the user action — never deferred to any scheduler.
- **MutationObserver callbacks** stay synchronous buffer-only (`_engineNodeBuffer.push`). The drain is what gets scheduled, not the buffer push.
- **`reveal_controller`** event handlers stay synchronous. Reveal/un-reveal is direct user input — no yielding allowed.

---

## 10. Open questions

- Is `scheduler.yield()` in Chrome 129+ INP-positive on our specific workload? Build a microbenchmark page (10k text nodes + PII keywords) before vs after, measure with `PerformanceObserver({ type: 'event' })`.
- Can we drop the `tests/setup.js` rIC stub entirely once both call sites migrate, or do we keep both (rIC + scheduler) stubs for the polyfill fallback path?
- Does the polyfill's `'background'` → `requestIdleCallback` mapping defeat the throttling fix? **Yes, on Chrome where `scheduler` is native this is moot — Chrome's native `scheduler.postTask('background')` uses a different idle queue with the same throttling characteristics. The fix isn't "no throttling," it's "explicit priority + better INP via yield()."** Be honest in the PR description.

---

## 11. References

- [Use `scheduler.yield()` to break up long tasks — Chrome for Developers](https://developer.chrome.com/blog/use-scheduler-yield)
- [Optimize long tasks — web.dev](https://web.dev/articles/optimize-long-tasks)
- [`Scheduler.postTask()` — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask)
- [`Scheduler.yield()` — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)
- [`Window.requestIdleCallback()` — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
- [`Scheduling.isInputPending()` — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending)
- [Better JS scheduling with `isInputPending()` — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/isinputpending)
- [GoogleChromeLabs/scheduler-polyfill](https://github.com/GoogleChromeLabs/scheduler-polyfill)
- [WICG/scheduling-apis explainers](https://github.com/WICG/scheduling-apis)
- [Heavy throttling of chained JS timers in Chrome 88 — Chrome for Developers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [Quick intensive timer throttling of loaded background pages — Chrome Status](https://chromestatus.com/feature/5580139453743104)
- [Building a Faster Web Experience with the postTask Scheduler — Airbnb Eng](https://medium.com/airbnb-engineering/building-a-faster-web-experience-with-the-posttask-scheduler-276b83454e91)
- [React's MessageChannel scheduling — facebook/react#14234](https://github.com/facebook/react/pull/14234)
